// #461, end to end over a real repository: what counts as a change, and what
// a change costs. A page that has been loaded stays warm until the run it
// shows moves.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { LocalGitSource, type RunRef } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { RefPrints } from '../src/prints.ts'

let fixture: FixtureRepo
let source: LocalGitSource
let prints: RefPrints
let app: Hono
let readState: MockInstance<(ref: RunRef) => ReturnType<LocalGitSource['readState']>>

const git = (args: string[], dir = fixture.dir) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })

/** Commit one file to `branch` from a throwaway worktree, leaving the main checkout alone. */
function commitOn(branch: string, path: string, content: string, create = false): void {
  const wt = `${fixture.dir}-wt`
  git(['worktree', 'add', '-q', ...(create ? ['-b', branch, wt, 'main'] : [wt, branch])])
  try {
    mkdirSync(join(wt, dirname(path)), { recursive: true })
    writeFileSync(join(wt, path), content)
    git(['add', '-A'], wt)
    git(['commit', '-q', '-m', `touch ${path}`], wt)
  } finally {
    git(['worktree', 'remove', '--force', wt])
  }
}

interface Item {
  kind: string
  slug: string
  gate: string
}

/** The fields these tests read, across the routes they load. */
interface Body {
  runs: { slug: string; phase: string }[]
  items: Item[]
  artifacts: string[]
  state: { gates: Record<string, { approved: boolean }> }
}

const load = async (path: string): Promise<Body> => {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return (await res.json()) as Body
}

/** The slugs whose state was read since the last call — which runs were derived again. */
const derived = () => {
  const slugs = [...new Set(readState.mock.calls.map(([ref]) => ref.slug))].sort()
  readState.mockClear()
  return slugs
}

let runs: string[]
let a: string
let b: string

beforeEach(async () => {
  fixture = generateFixtureRepo()
  source = new LocalGitSource('local/demo', fixture.dir)
  prints = new RefPrints([source])
  app = createApp({ sources: [source], prints })
  readState = vi.spyOn(source, 'readState')
  const branches = fixture.runs.filter((r) => r.branch !== null).map((r) => r.slug)
  expect(branches.length).toBeGreaterThanOrEqual(2)
  ;[a, b] = branches as [string, string]
  runs = (await load('/api/runs')).runs.map((r) => r.slug).sort()
  await load(`/api/repos/local/demo/-/runs/${a}`)
  await load(`/api/repos/local/demo/-/runs/${b}`)
  await prints.changes()
  derived()
})

afterEach(async () => {
  rmSync(`${fixture.dir}-wt`, { recursive: true, force: true })
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('what counts as a change', () => {
  it('an index refresh is not one', async () => {
    writeFileSync(join(fixture.dir, 'README.md'), '# fixture\n\nedited, uncommitted\n')
    git(['status', '--short'])
    git(['add', 'README.md'])
    expect(await prints.changes()).toEqual([])
    await load('/api/runs')
    await load(`/api/repos/local/demo/-/runs/${a}`)
    expect(derived()).toEqual([])
  })

  it('a commit on a branch no view reads is not one', async () => {
    commitOn('web/unrelated', 'notes.md', 'unrelated work\n', true)
    expect(await prints.changes()).toEqual([])
    await load('/api/runs')
    await load(`/api/repos/local/demo/-/runs/${a}`)
    expect(derived()).toEqual([])
  })

  it('a commit on a run branch is one, naming the repository and the run', async () => {
    commitOn(`run/${a}`, `runs/${a}/note.md`, 'a note\n')
    expect(await prints.changes()).toEqual([{ source: 'local/demo', slug: a }])
    expect(await prints.changes()).toEqual([])
  })

  it('a commit on the default branch is one', async () => {
    commitOn('web/to-merge', 'notes.md', 'merged work\n', true)
    git(['update-ref', 'refs/heads/main', 'refs/heads/web/to-merge'])
    git(['reset', '-q', '--hard', 'main'])
    expect(await prints.changes()).toEqual([{ source: 'local/demo', slug: null }])
  })
})

describe('what a change costs', () => {
  it('a commit on one run derives that run again and no other', async () => {
    commitOn(`run/${a}`, `runs/${a}/note.md`, 'a note\n')
    prints.markDirty()

    const portfolio = await load('/api/runs')
    expect(portfolio.runs.map((r) => r.slug).sort()).toEqual(runs)
    expect(derived()).toEqual([a])

    await load(`/api/repos/local/demo/-/runs/${b}`)
    expect(derived()).toEqual([])

    const detail = await load(`/api/repos/local/demo/-/runs/${a}`)
    expect(detail.artifacts).toContain('note.md')
  })

  it('a commit on the default branch derives every run again', async () => {
    commitOn('web/to-merge', 'notes.md', 'merged work\n', true)
    git(['update-ref', 'refs/heads/main', 'refs/heads/web/to-merge'])
    git(['reset', '-q', '--hard', 'main'])
    prints.markDirty()
    await load('/api/runs')
    expect(derived()).toEqual(runs)
  })

  it('time alone derives the runs in flight again, and leaves the finished ones', async () => {
    const phases = new Map((await load('/api/runs')).runs.map((r) => [r.slug, r.phase]))
    const finished = runs.filter((slug) => ['done', 'closed'].includes(phases.get(slug) ?? ''))
    expect(finished.length).toBeGreaterThan(0)
    expect(finished.length).toBeLessThan(runs.length)
    for (const slug of runs) await load(`/api/repos/local/demo/-/runs/${slug}`)
    derived()

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 })
    try {
      await load('/api/runs')
      for (const slug of runs) await load(`/api/repos/local/demo/-/runs/${slug}`)
    } finally {
      vi.useRealTimers()
    }
    expect(derived()).toEqual(runs.filter((slug) => !finished.includes(slug)))
  })

  it('a decision shows on the next read without waiting for anything', async () => {
    const inbox = await load('/api/inbox')
    const item = inbox.items.find((i) => i.kind === 'gate')
    if (!item) throw new Error('the fixture has no gate waiting')
    const res = await app.request('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'local/demo', slug: item.slug, action: 'approve', gate: item.gate, burden: 'confirmation' }),
    })
    expect(res.status).toBe(200)
    const after = await load(`/api/repos/local/demo/-/runs/${item.slug}`)
    expect(after.state.gates[item.gate]?.approved).toBe(true)
    const stillWaiting = (await load('/api/inbox')).items.filter(
      (i) => i.kind === 'gate' && i.slug === item.slug && i.gate === item.gate,
    )
    expect(stillWaiting).toEqual([])
  })
})
