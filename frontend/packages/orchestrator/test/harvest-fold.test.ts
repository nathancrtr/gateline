// Harvest-branch folding (run "runner-agent" ADR-3/ADR-4, review-04.md F1):
// the control plane, not the remote worker, is the one that ever writes the
// run branch. `foldHarvestBranch` fetches a worker-pushed branch and rebases
// it in as the sole writer; `engine.ts`'s `launch()` uses it in place of the
// local per-task fold for a `managesOwnWorkspace` dispatcher, and skips the
// local checkout entirely (the worker owns its own).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalGitSource } from '@agentic/core'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import type { Dispatcher, DispatchOutcome, DispatchRequest } from '../src/seam.ts'
import { foldHarvestBranch } from '../src/workspace.ts'
import { makeToyRepo, TEST_REGISTRY, toyRef } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV }).trim()

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  cleanups.push(bare)
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  return bare
}

/** Plays the remote worker: clone origin at `runBranch`, write `files` on
 *  top, commit, push to `harvestBranch`. Returns the base (pre-harvest) OID. */
function pushHarvest(bare: string, runBranch: string, harvestBranch: string, files: Record<string, string>): string {
  const clone = `${bare}-worker-${Math.random().toString(36).slice(2, 8)}`
  cleanups.push(clone)
  execFileSync('git', ['clone', '--quiet', '--branch', runBranch, bare, clone], { env: GIT_ENV })
  const base = git(clone, ['rev-parse', 'HEAD'])
  for (const [path, content] of Object.entries(files)) {
    const full = join(clone, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  git(clone, ['add', '-A'])
  git(clone, ['-c', 'user.name=worker', '-c', 'user.email=worker@example.test', 'commit', '-q', '-m', 'harvested artifacts'])
  git(clone, ['push', '-q', 'origin', `HEAD:refs/heads/${harvestBranch}`])
  return base
}

describe('foldHarvestBranch', () => {
  it('fetches the pushed harvest branch, rebases it onto the run tip, CASes the ref, and deletes both harvest refs', async () => {
    const { dir } = makeToyRepo()
    cleanups.push(dir)
    const bare = addOrigin(dir)
    const runTipBefore = git(dir, ['rev-parse', 'run/toy'])

    const base = pushHarvest(bare, 'run/toy', 'run/toy--harvest/analyst-1', { 'runs/toy/spec.md': 'harvested' })
    expect(base).toBe(runTipBefore) // the worker's clone was at the same tip

    const result = await foldHarvestBranch(dir, 'run/toy', { branch: 'run/toy--harvest/analyst-1', base })
    expect(result).toMatchObject({ ok: true, conflict: false })

    // The run branch now carries the harvested file, and moved past the pre-fold tip.
    expect(git(dir, ['show', 'run/toy:runs/toy/spec.md'])).toBe('harvested')
    expect(git(dir, ['rev-parse', 'run/toy'])).not.toBe(runTipBefore)

    // Cleanup: no local worktree/branch left behind, and origin's harvest branch is gone.
    expect(git(dir, ['worktree', 'list'])).not.toContain('harvest')
    expect(git(dir, ['branch', '--list', 'harvest-*'])).toBe('')
    expect(() => git(bare, ['rev-parse', 'refs/heads/run/toy--harvest/analyst-1'])).toThrow()
  })

  it('a rebase conflict (overlapping file-contact surfaces) reports conflict: true and aborts cleanly', async () => {
    const { dir } = makeToyRepo()
    cleanups.push(dir)
    const bare = addOrigin(dir)

    const base = pushHarvest(bare, 'run/toy', 'run/toy--harvest/a-1', { 'runs/toy/spec.md': 'from worker' })

    // The run branch itself moves past `base` with a conflicting edit to the
    // same file before the fold runs — a real overlapping-surface scenario.
    git(dir, ['checkout', '-q', 'run/toy'])
    const full = join(dir, 'runs/toy/spec.md')
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, 'from control plane')
    git(dir, ['add', '-A'])
    git(dir, ['-c', 'user.name=op', '-c', 'user.email=op@example.test', 'commit', '-q', '-m', 'conflicting local edit'])
    git(dir, ['checkout', '-q', 'main'])

    const result = await foldHarvestBranch(dir, 'run/toy', { branch: 'run/toy--harvest/a-1', base })
    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.message).toContain('overlapping file-contact surfaces')

    // No leftover rebase-in-progress state or worktree.
    expect(git(dir, ['worktree', 'list'])).not.toContain('harvest')
  })
})

describe('engine.ts launch() — managesOwnWorkspace dispatcher (run "runner-agent" ADR-3/ADR-4)', () => {
  class FakeRemoteDispatcher implements Dispatcher {
    readonly adapter = 'fake-remote'
    readonly managesOwnWorkspace = true
    readonly calls: DispatchRequest[] = []
    constructor(private readonly bare: string) {}
    async dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
      this.calls.push(req)
      const branch = `${req.branch}--harvest/${req.role}-${Date.now()}`
      const base = pushHarvest(this.bare, req.branch!, branch, { 'runs/toy/spec.md': 'from the workstation' })
      return { ok: true, costUsd: 0.42, tokensIn: 100, tokensOut: 20, error: null, harvest: { branch, base } }
    }
  }

  it('skips the local checkout, folds the harvest branch into the run branch, and pushes it to origin', async () => {
    const { dir } = makeToyRepo()
    cleanups.push(dir)
    const bare = addOrigin(dir)
    git(dir, ['checkout', '-q', 'main'])

    const dispatcher = new FakeRemoteDispatcher(bare)
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, push: true })

    await engine.tick()
    await engine.drain()

    expect(dispatcher.calls).toHaveLength(1)
    // No local worktree checkout was ever created for this run — just the main checkout itself.
    expect(git(dir, ['worktree', 'list']).split('\n')).toHaveLength(1)

    // The harvested file landed on the run branch, and reached origin.
    expect(git(dir, ['show', 'run/toy:runs/toy/spec.md'])).toBe('from the workstation')
    expect(git(bare, ['rev-parse', 'refs/heads/run/toy'])).toBe(git(dir, ['rev-parse', 'run/toy']))

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    const ledger = parseLedger(state)
    expect(ledger).toMatchObject([{ role: 'analyst', cost_usd: 0.42, failed: false }])
  })
})
