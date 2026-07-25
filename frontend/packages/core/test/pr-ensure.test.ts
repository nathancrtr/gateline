// ensureDraftPr: best-effort, never-throwing draft-PR ensure over `gh`, all
// exercised through the injected exec seam — no real `gh` is ever shelled
// out to (CI has no authed `gh`).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureDraftPr } from '../src/index.ts'

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
      if (args.includes('list')) return JSON.stringify([{ number: 42 }])
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
