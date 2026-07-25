// ensureDraftPr: best-effort, never-throwing draft-PR ensure over `gh`, all
// exercised through the injected exec seam — no real `gh` is ever shelled
// out to (CI has no authed `gh`).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDraftPr, GENERATED_MARKER } from '../src/index.ts'

let dir: string

function git(args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

/** Simulates a branch that has been pushed to origin: a local branch plus a matching remote-tracking ref. */
function pushBranch(branch: string): void {
  git(['branch', branch])
  const sha = git(['rev-parse', branch]).trim()
  git(['update-ref', `refs/remotes/origin/${branch}`, sha])
}

/** Same, but with a run record committed on the branch — what the description is read from. */
function pushRunBranch(branch: string, files: Record<string, string>): void {
  git(['checkout', '-q', '-b', branch])
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${branch}): staged`])
  const sha = git(['rev-parse', branch]).trim()
  git(['update-ref', `refs/remotes/origin/${branch}`, sha])
  git(['checkout', '-q', 'main'])
}

const TOY_STATE = 'run: toy\nbranch: run/toy\nphase: spec\nprofile: standard\ngates:\n  G0: { approved: false, by: null, at: null, notes: null }\ntasks: []\nescalations: []\n'
const TOY_BRIEF = '# Intent Brief: Toy exporter is unusable at scale\n\n## Problem\nExporting by hand is slow.\n\n## Motivation\nSaves an afternoon.\n\n## Constraints\nOffline.\n\n## Out of scope\nImporting.\n'
const TOY_RUN = { 'runs/toy/state.yaml': TOY_STATE, 'runs/toy/intent-brief.md': TOY_BRIEF }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-pr-ensure-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Operator'])
  git(['config', 'user.email', 'operator@example.test'])
  git(['commit', '--allow-empty', '-q', '-m', 'root'])
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ensureDraftPr', () => {
  it('creates a draft PR when gh pr list finds none', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
    pushBranch('run/toy')
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) return '[]'
      if (args.includes('create')) return 'https://github.com/acme/widgets/pull/9\n'
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('created')
    expect(result.note).toMatch(/run\/toy/)
    const createCall = exec.mock.calls.find(([, args]) => args.includes('create'))
    expect(createCall).toBeDefined()
    const [, createArgs] = createCall!
    expect(createArgs).toEqual(
      expect.arrayContaining(['--draft', '--head', 'run/toy', '--base', 'main', '--title', 'run/toy']),
    )
    expect(createArgs.join(' ')).toContain('runs/toy/')
  })

  it('reports exists and never calls create when a PR is already listed (AC8.1 idempotency, unit half)', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
    pushBranch('run/toy')
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) return JSON.stringify([{ number: 42, title: 'run/toy', body: 'hand written', state: 'OPEN' }])
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(result.note).toContain('42')
    expect(exec.mock.calls.some(([, args]) => args.includes('create'))).toBe(false)
  })

  it('skips with a note when no remote is configured', async () => {
    const exec = vi.fn(async () => {
      throw new Error('gh should not be invoked')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('skipped')
    expect(result.note).toMatch(/remote/i)
    expect(exec).not.toHaveBeenCalled()
  })

  it('skips with a note when the branch has not been pushed to origin', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
    git(['branch', 'run/toy']) // local only — no refs/remotes/origin/run/toy
    const exec = vi.fn(async () => {
      throw new Error('gh should not be invoked')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('skipped')
    expect(result.note).toMatch(/not pushed/i)
    expect(exec).not.toHaveBeenCalled()
  })

  it('skips with a note when gh itself fails (missing binary, unauthed, network)', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
    pushBranch('run/toy')
    const exec = vi.fn(async () => {
      throw new Error('gh: command not found')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('skipped')
    expect(result.note).toContain('command not found')
  })

  it('local-only mode short-circuits before any git or gh work, even on the leak-shape repo (origin exists, branch already pushed)', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
    pushBranch('run/toy')
    const exec = vi.fn(async () => {
      throw new Error('gh should not be invoked')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec, localOnly: true })

    expect(result).toEqual({ status: 'skipped', note: 'local-only mode — draft-PR ensure suppressed' })
    expect(exec).not.toHaveBeenCalled()
  })

  it('local-only wins even before the origin check, on a remoteless dir', async () => {
    const exec = vi.fn(async () => {
      throw new Error('gh should not be invoked')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec, localOnly: true })

    expect(result).toEqual({ status: 'skipped', note: 'local-only mode — draft-PR ensure suppressed' })
    expect(exec).not.toHaveBeenCalled()
  })
})

/** #202: the description is read off the run branch and refreshed while the framework still owns it. */
describe('ensureDraftPr descriptions', () => {
  beforeEach(() => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'])
  })

  /** Returns [exec, calls-of-`gh pr <verb>`]. `listed` is the PR `gh pr list` reports, if any. */
  function ghStub(listed: object | null) {
    return vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) return JSON.stringify(listed ? [listed] : [])
      if (args.includes('create')) return 'https://github.com/acme/widgets/pull/9\n'
      if (args.includes('edit')) return ''
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
    })
  }

  const argOf = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

  it('titles a new PR from the run branch intent brief instead of the slug', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = ghStub(null)

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('created')
    expect(result.note).toContain('intent-brief.md')
    const [, args] = exec.mock.calls.find(([, a]) => a.includes('create'))!
    expect(argOf(args, '--title')).toBe('Toy exporter is unusable at scale')
    const body = argOf(args, '--body')!
    expect(body).toContain(GENERATED_MARKER)
    expect(body).toContain('Exporting by hand is slow.')
    expect(body).toContain('profile `standard`')
  })

  it('refreshes a generated description once the spec lands', async () => {
    pushRunBranch('run/toy', { ...TOY_RUN, 'runs/toy/spec.md': '# Specification: Streaming toy export\n\n## Context\nThe exporter buffers everything.\n\n### R1 — Stream rows\n' })
    const exec = ghStub({ number: 42, title: 'run/toy', body: `${GENERATED_MARKER}\n\nstale`, state: 'OPEN' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(result.note).toContain('refreshed from spec.md')
    const [, args] = exec.mock.calls.find(([, a]) => a.includes('edit'))!
    expect(args).toContain('42')
    expect(argOf(args, '--title')).toBe('Streaming toy export')
    expect(argOf(args, '--body')).toContain('- R1 — Stream rows')
  })

  it('never edits a description a human has taken over', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = ghStub({ number: 42, title: 'Hand-written title', body: '## Summary\nA human wrote this.', state: 'OPEN' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(result.note).toContain('human-authored')
    expect(exec.mock.calls.some(([, args]) => args.includes('edit'))).toBe(false)
  })

  it('adopts a PR still wearing the pre-#202 one-line body', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = ghStub({ number: 42, title: 'run/toy', body: 'Draft PR for `run/toy` — see `runs/toy/` for the run record.', state: 'OPEN' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.note).toContain('refreshed from intent-brief.md')
    const [, args] = exec.mock.calls.find(([, a]) => a.includes('edit'))!
    expect(argOf(args, '--title')).toBe('Toy exporter is unusable at scale')
  })

  it('issues no edit when the description is already current', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const first = ghStub(null)
    await ensureDraftPr(dir, 'run/toy', 'toy', { exec: first })
    const [, createArgs] = first.mock.calls.find(([, a]) => a.includes('create'))!
    const current = { number: 42, title: argOf(createArgs, '--title')!, body: argOf(createArgs, '--body')!, state: 'OPEN' }
    const exec = ghStub(current)

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.note).toContain('already current')
    expect(exec.mock.calls.some(([, args]) => args.includes('edit'))).toBe(false)
  })

  it('opens a replacement when the only PR is merged — a run outliving its PR keeps a review surface (#207)', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = ghStub({ number: 42, title: 'run/toy', body: `${GENERATED_MARKER}\n\nstale`, state: 'MERGED' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('created')
    expect(result.note).toContain('replaces #42, which is merged')
    expect(exec.mock.calls.some(([, args]) => args.includes('edit'))).toBe(false)
    const [, args] = exec.mock.calls.find(([, a]) => a.includes('create'))!
    expect(argOf(args, '--title')).toBe('Toy exporter is unusable at scale')
  })

  it('opens a replacement when the only PR is closed', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = ghStub({ number: 42, title: 'run/toy', body: 'closed by hand', state: 'CLOSED' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('created')
    expect(result.note).toContain('replaces #42, which is closed')
  })

  it('prefers the open PR when a dead one is also listed, and creates nothing', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('list'))
        return JSON.stringify([
          { number: 43, title: 'run/toy', body: 'Draft PR for `run/toy` — see `runs/toy/` for the run record.', state: 'MERGED' },
          { number: 44, title: 'run/toy', body: `${GENERATED_MARKER}\n\nstale`, state: 'OPEN' },
        ])
      if (args.includes('edit')) return ''
      throw new Error(`unexpected gh invocation: ${args.join(' ')}`)
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(result.note).toContain('#44')
    expect(exec.mock.calls.some(([, args]) => args.includes('create'))).toBe(false)
  })

  it('does not open a second replacement once one exists, because the new PR is open', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const first = ghStub({ number: 42, title: 'run/toy', body: `${GENERATED_MARKER}\n\nstale`, state: 'MERGED' })
    await ensureDraftPr(dir, 'run/toy', 'toy', { exec: first })
    const [, createArgs] = first.mock.calls.find(([, a]) => a.includes('create'))!
    const exec = ghStub({ number: 45, title: argOf(createArgs, '--title')!, body: argOf(createArgs, '--body')!, state: 'OPEN' })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(exec.mock.calls.some(([, args]) => args.includes('create'))).toBe(false)
  })

  it('reports a failed refresh in the note without throwing (AC8.2 holds for the edit path)', async () => {
    pushRunBranch('run/toy', TOY_RUN)
    const exec = vi.fn(async (_cmd: string, args: string[]) => {
      if (args.includes('list')) return JSON.stringify([{ number: 42, title: 'run/toy', body: `${GENERATED_MARKER}\n\nstale`, state: 'OPEN' }])
      throw new Error('gh: could not edit pull request')
    })

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('exists')
    expect(result.note).toContain('refresh failed')
    expect(result.note).toContain('could not edit')
  })

  it('falls back to the slug title when the branch carries no readable run record', async () => {
    pushBranch('run/toy')
    const exec = ghStub(null)

    const result = await ensureDraftPr(dir, 'run/toy', 'toy', { exec })

    expect(result.status).toBe('created')
    const [, args] = exec.mock.calls.find(([, a]) => a.includes('create'))!
    expect(argOf(args, '--title')).toBe('run/toy')
    expect(argOf(args, '--body')).toContain('runs/toy/')
  })
})
