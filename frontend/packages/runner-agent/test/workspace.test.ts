// Disposable workspace creation/cleanup (AC4.1, AC4.2): each dispatch gets
// its own clone, and that clone stops existing once the dispatch is done.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspace, getHead, harvestAndPush } from '../src/workspace.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

// Isolate from the operator's real ~/.gitconfig, same convention as
// server/test/runner-api.test.ts's makeRepo.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A real throwaway git repo with two commits on `branch` — a local path is
 *  a perfectly good `git clone` source, so this doubles as the "remote". */
function makeRepo(branch: string): { dir: string; firstOid: string; secondOid: string } {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-src-'))
  cleanups.push(dir)
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV })
  git(['init', '-q', '-b', branch])
  git(['config', 'user.name', 'Toy'])
  git(['config', 'user.email', 'toy@example.com'])
  writeFileSync(join(dir, 'file.txt'), 'v1')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'first'])
  const firstOid = git(['rev-parse', branch]).trim()
  writeFileSync(join(dir, 'file.txt'), 'v2')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'second'])
  const secondOid = git(['rev-parse', branch]).trim()
  return { dir, firstOid, secondOid }
}

describe('createWorkspace', () => {
  it('clones the branch into a fresh directory under workDir', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)

    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    expect(ws.path.startsWith(workDir)).toBe(true)
    expect(existsSync(ws.path)).toBe(true)
    expect(existsSync(join(ws.path, 'file.txt'))).toBe(true)
    const head = execFileSync('git', ['-C', ws.path, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: GIT_ENV }).trim()
    expect(head).toBe(repo.secondOid)

    await ws.remove()
  })

  it('removes the workspace directory on remove() (AC4.1)', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)

    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    expect(existsSync(ws.path)).toBe(true)
    await ws.remove()
    expect(existsSync(ws.path)).toBe(false)
  })

  it('checks out baseOid after cloning when provided', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)

    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir, baseOid: repo.firstOid })
    const head = execFileSync('git', ['-C', ws.path, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: GIT_ENV }).trim()
    // Pinned to the first commit, not the branch tip (second commit) — the
    // clone itself grabbed the tip; the checkout moved HEAD back.
    expect(head).toBe(repo.firstOid)
    expect(head).not.toBe(repo.secondOid)

    await ws.remove()
  })

  it('tolerates an unresolvable baseOid — the branch-tip clone remains usable (review-03.md F5)', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)

    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir, baseOid: 'deadbeef'.repeat(5) })
    expect(existsSync(ws.path)).toBe(true)
    const head = execFileSync('git', ['-C', ws.path, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: GIT_ENV }).trim()
    expect(head).toBe(repo.secondOid) // still the tip — the bad checkout never happened

    await ws.remove()
  })

  it('two consecutive createWorkspace calls produce two independent directories (AC4.2)', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)

    const first = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    const second = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    expect(first.path).not.toBe(second.path)
    expect(existsSync(first.path)).toBe(true)
    expect(existsSync(second.path)).toBe(true)

    // Never one checkout left mounted/reused/updated in place between
    // dispatches: removing one leaves the other completely untouched.
    await first.remove()
    expect(existsSync(first.path)).toBe(false)
    expect(existsSync(second.path)).toBe(true)

    await second.remove()
  })
})

describe('harvestAndPush (run "runner-agent" ADR-3, review-04.md round-2 F8/F9/F10)', () => {
  it('an unmatched pathspec alongside a matched one does not drop the matched file (F10)', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)
    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    const base = await getHead(ws)

    mkdirSync(join(ws.path, 'runs/toy'), { recursive: true })
    writeFileSync(join(ws.path, 'runs/toy/plan.md'), 'the plan')
    // 'runs/toy/tasks/' never got created — a single combined `git add -A --
    // plan.md tasks/` would fail atomically and drop plan.md too (verified
    // against real git: an unmatched pathspec makes the whole call exit 128
    // and stage nothing at all).
    const result = await harvestAndPush(ws, 'run/toy--harvest/architect-1', ['runs/toy/plan.md', 'runs/toy/tasks/'], base, BOT, 'toy', 'architect')

    expect(result.pushed).toBe(true)
    const content = execFileSync('git', ['-C', repo.dir, 'show', `${result.branch}:runs/toy/plan.md`], { encoding: 'utf8', env: GIT_ENV }).trim()
    expect(content).toBe('the plan')

    await ws.remove()
  })

  it('a harness commit alone (nothing left uncommitted) is still pushed — HEAD moved past base (F8)', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)
    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    const base = await getHead(ws)

    writeFileSync(join(ws.path, 'file.txt'), 'harness wrote and committed this')
    execFileSync('git', ['-C', ws.path, 'add', '-A'], { env: GIT_ENV })
    execFileSync('git', ['-C', ws.path, '-c', 'user.name=harness', '-c', 'user.email=harness@example.test', 'commit', '-q', '-m', 'harness commit'], { env: GIT_ENV })

    const result = await harvestAndPush(ws, 'run/toy--harvest/implementer-1', ['.'], base, BOT, 'toy', 'implementer')
    expect(result.pushed).toBe(true)
    expect(result.base).toBe(base)
    const content = execFileSync('git', ['-C', repo.dir, 'show', `${result.branch}:file.txt`], { encoding: 'utf8', env: GIT_ENV }).trim()
    expect(content).toBe('harness wrote and committed this')

    await ws.remove()
  })

  it('nothing committed and nothing matching the sweep reports pushed: false, base unchanged', async () => {
    const repo = makeRepo('run/toy')
    const workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-work-'))
    cleanups.push(workDir)
    const ws = await createWorkspace({ workDir, slug: 'toy', branch: 'run/toy', repoUrl: repo.dir })
    const base = await getHead(ws)

    const result = await harvestAndPush(ws, 'run/toy--harvest/analyst-1', ['runs/toy/spec.md'], base, BOT, 'toy', 'analyst')
    expect(result).toEqual({ pushed: false, branch: 'run/toy--harvest/analyst-1', base })

    await ws.remove()
  })
})
