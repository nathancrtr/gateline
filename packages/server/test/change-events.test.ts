// #496: a `change` event names what moved — the repository, and the run when
// the prints know it — so a client refreshes only what reads it. Expected
// events are literals.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RunSource, ViewRefs } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAnnouncer } from '../src/announce.ts'
import type { ChangeEvent, RefChange } from '../src/contract.ts'
import { startServer } from '../src/main.ts'
import { RefPrints } from '../src/prints.ts'

/** A source whose refs are whatever the test sets, read through `viewRefs` like any other. */
function refsSource(id: string) {
  let shared = 'refs/heads/main aaa'
  let runs = new Map<string, string>([
    ['csv-export', 'refs/heads/run/csv-export 111'],
    ['refunds', 'refs/heads/run/refunds 222'],
  ])
  let failing = false
  const source = {
    id,
    viewRefs: async (): Promise<ViewRefs> => {
      if (failing) throw new Error('fatal: cannot read refs')
      const perRun = [...runs.values()].sort()
      return { shared, runs: new Map(runs), all: [shared, ...perRun].join('\n') }
    },
  } as unknown as RunSource
  return {
    source,
    moveRun: (slug: string, oid: string) => {
      runs = new Map(runs).set(slug, `refs/heads/run/${slug} ${oid}`)
    },
    dropRun: (slug: string) => {
      runs = new Map(runs)
      runs.delete(slug)
    },
    moveDefault: (oid: string) => {
      shared = `refs/heads/main ${oid}`
    },
    fail: (on: boolean) => {
      failing = on
    },
  }
}

describe('RefPrints.changes', () => {
  it('names the repository and the run whose refs moved, and nothing about the other repository', async () => {
    const a = refsSource('github.com/acme/billing')
    const b = refsSource('github.com/acme/ledger')
    const prints = new RefPrints([a.source, b.source])
    expect(await prints.changes()).toEqual([])
    a.moveRun('csv-export', '333')
    expect(await prints.changes()).toEqual([{ source: 'github.com/acme/billing', slug: 'csv-export' }])
    expect(await prints.changes()).toEqual([])
  })

  it('announces a default-branch move as the repository without a run, covering its runs', async () => {
    const a = refsSource('github.com/acme/billing')
    const prints = new RefPrints([a.source])
    await prints.changes()
    a.moveDefault('bbb')
    a.moveRun('refunds', '444')
    expect(await prints.changes()).toEqual([{ source: 'github.com/acme/billing', slug: null }])
  })

  it('coalesces what moved since the last event, ordered by repository then slug', async () => {
    const a = refsSource('github.com/acme/billing')
    const b = refsSource('github.com/acme/ledger')
    const prints = new RefPrints([a.source, b.source])
    await prints.changes()
    b.moveRun('refunds', '555')
    a.moveRun('refunds', '666')
    a.moveRun('csv-export', '777')
    b.moveRun('new-run', '888')
    a.dropRun('csv-export')
    expect(await prints.changes()).toEqual([
      { source: 'github.com/acme/billing', slug: 'csv-export' },
      { source: 'github.com/acme/billing', slug: 'refunds' },
      { source: 'github.com/acme/ledger', slug: 'new-run' },
      { source: 'github.com/acme/ledger', slug: 'refunds' },
    ])
  })

  it('says the repository changed when more than sixteen of its runs moved at once', async () => {
    const a = refsSource('github.com/acme/billing')
    const prints = new RefPrints([a.source])
    await prints.changes()
    for (let i = 0; i < 16; i++) a.moveRun(`run-${String(i).padStart(2, '0')}`, 'fff')
    expect((await prints.changes()).length).toBe(16)
    for (let i = 0; i < 17; i++) a.moveRun(`run-${String(i).padStart(2, '0')}`, 'eee')
    expect(await prints.changes()).toEqual([{ source: 'github.com/acme/billing', slug: null }])
  })

  it('a repository whose refs cannot be read no longer hides a change in another', async () => {
    const a = refsSource('github.com/acme/billing')
    const b = refsSource('github.com/acme/ledger')
    const prints = new RefPrints([a.source, b.source])
    await prints.changes()
    a.fail(true)
    b.moveRun('refunds', '999')
    expect(await prints.changes()).toEqual([
      { source: 'github.com/acme/billing', slug: null },
      { source: 'github.com/acme/ledger', slug: 'refunds' },
    ])
    b.moveRun('csv-export', 'abc')
    expect(await prints.changes()).toEqual([{ source: 'github.com/acme/ledger', slug: 'csv-export' }])
    a.fail(false)
    expect(await prints.changes()).toEqual([{ source: 'github.com/acme/billing', slug: null }])
  })
})

describe('createAnnouncer', () => {
  it('sends one event per pass that found something, and folds triggers during a pass into one more', async () => {
    const answers: RefChange[][] = [
      [{ source: 'github.com/acme/billing', slug: 'csv-export' }],
      [
        { source: 'github.com/acme/billing', slug: 'refunds' },
        { source: 'github.com/acme/ledger', slug: null },
      ],
      [],
    ]
    let release: () => void = () => {}
    const changes = vi.fn(async () => {
      if (changes.mock.calls.length === 1) await new Promise<void>((r) => (release = r))
      return answers.shift() ?? []
    })
    const sent: ChangeEvent[] = []
    const announce = createAnnouncer({ changes }, (event) => sent.push(event))
    const first = announce()
    // Three triggers while the first pass is reading: one more pass, not three.
    const joined = [announce(), announce(), announce()]
    release()
    await Promise.all([first, ...joined])
    expect(changes).toHaveBeenCalledTimes(2)
    expect(sent).toEqual([
      { changes: [{ source: 'github.com/acme/billing', slug: 'csv-export' }] },
      {
        changes: [
          { source: 'github.com/acme/billing', slug: 'refunds' },
          { source: 'github.com/acme/ledger', slug: null },
        ],
      },
    ])
    await announce()
    expect(changes).toHaveBeenCalledTimes(3)
    expect(sent).toHaveLength(2)
  })

  it('a failed read is a warning, not a lost announcer', async () => {
    const warnings: string[] = []
    const changes = vi
      .fn<() => Promise<RefChange[]>>()
      .mockRejectedValueOnce(new Error('git for-each-ref failed'))
      .mockResolvedValueOnce([{ source: 'local/scratch', slug: null }])
    const sent: ChangeEvent[] = []
    const announce = createAnnouncer({ changes }, (e) => sent.push(e), (l) => warnings.push(l))
    await announce()
    await announce()
    expect(warnings).toEqual(['warning: reading refs failed: git for-each-ref failed'])
    expect(sent).toEqual([{ changes: [{ source: 'local/scratch', slug: null }] }])
  })
})

describe('the event stream, end to end over two repositories', () => {
  let alpha: FixtureRepo
  let bravo: FixtureRepo
  let slug: string

  const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })

  /** Commit one file to `branch` from a throwaway worktree, leaving the main checkout alone. */
  const commitOn = (dir: string, branch: string, path: string, create = false) => {
    const wt = `${dir}-wt`
    git(dir, ['worktree', 'add', '-q', ...(create ? ['-b', branch, wt, 'main'] : [wt, branch])])
    try {
      mkdirSync(join(wt, dirname(path)), { recursive: true })
      writeFileSync(join(wt, path), `${path}\n`)
      git(wt, ['add', '-A'])
      git(wt, ['commit', '-q', '-m', `touch ${path}`])
    } finally {
      git(dir, ['worktree', 'remove', '--force', wt])
      rmSync(wt, { recursive: true, force: true })
    }
  }

  beforeAll(() => {
    alpha = generateFixtureRepo(undefined, { name: 'alpha' })
    bravo = generateFixtureRepo(undefined, { name: 'bravo' })
    slug = alpha.runs.find((r) => r.branch !== null)!.slug
  })
  afterAll(async () => {
    for (const f of [alpha, bravo]) await rm(f.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('a commit on a run branch names that repository and run; a default-branch commit names the repository alone', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = await startServer({ repoOverrides: [alpha.dir, bravo.dir], port: 0, host: '127.0.0.1', push: false })
    log.mockRestore()
    const abort = new AbortController()
    try {
      const res = await fetch(`${server.url}/api/events`, { signal: abort.signal })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      /** The data of the next `change` event, waiting at most ten seconds. */
      const nextChange = async (): Promise<unknown> => {
        const deadline = Date.now() + 10_000
        for (;;) {
          const end = buffer.indexOf('\n\n')
          if (end !== -1) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            if (frame.startsWith('event: change\n')) return JSON.parse(frame.slice(frame.indexOf('data: ') + 'data: '.length))
            continue
          }
          if (Date.now() > deadline) throw new Error(`no change event; stream so far: ${JSON.stringify(buffer)}`)
          const { value, done } = await reader.read()
          if (done) throw new Error('stream ended')
          buffer += decoder.decode(value, { stream: true })
        }
      }

      commitOn(alpha.dir, `run/${slug}`, `runs/${slug}/note.md`)
      expect(await nextChange()).toEqual({ changes: [{ source: 'local/alpha', slug }] })

      commitOn(alpha.dir, 'web/to-merge', 'notes.md', true)
      git(alpha.dir, ['update-ref', 'refs/heads/main', 'refs/heads/web/to-merge'])
      expect(await nextChange()).toEqual({ changes: [{ source: 'local/alpha', slug: null }] })
    } finally {
      abort.abort()
      server.close()
    }
  })
})
