// #104: the engine owns its own freshness. A standalone orchestrator (no
// co-located server fetch loop) must still see decisions humans make against
// origin — a materialized local run branch that nothing fast-forwards would
// otherwise feed yesterday's state to every derivation (the 2026-07-15
// split-brain incident). Sync is ff-only: divergence is refused and left for
// a human, never resolved silently.
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { agentCommit, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY, type Clock } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG } }).trim()

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  cleanups.push(bare)
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  return bare
}

/** A second writer: clone origin, mutate run/toy's state.yaml, push back. */
function remoteWrite(bare: string, mutate: (state: string) => string): string {
  const clone = `${bare}-writer`
  cleanups.push(clone)
  execFileSync('git', ['clone', '--quiet', bare, clone])
  git(clone, ['checkout', '-q', 'run/toy'])
  const path = join(clone, 'runs', 'toy', 'state.yaml')
  const current = execFileSync('cat', [path], { encoding: 'utf8' })
  writeFileSync(path, mutate(current))
  git(clone, ['-c', 'user.name=Human', '-c', 'user.email=human@example.test', 'commit', '-aqm', 'state(toy): cost_limit_usd raised by Human'])
  git(clone, ['push', '-q', 'origin', 'run/toy'])
  return git(clone, ['rev-parse', 'HEAD'])
}

/** Detach HEAD so run/toy is no longer checked out: a real orchestrator
 *  clone sits on main, and fetch refuses to move any checked-out branch. */
function parkOnDefault(dir: string): void {
  git(dir, ['checkout', '-q', '--detach'])
}

describe('engine.syncFromRemote (#104)', () => {
  it('fast-forwards a materialized local run branch to a remote decision', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, push: true })
    await engine.tick()
    await engine.drain()
    parkOnDefault(dir)

    const remoteTip = remoteWrite(bare, (s) => s.replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 100'))
    expect(git(dir, ['rev-parse', 'run/toy'])).not.toBe(remoteTip) // stale before sync

    await engine.syncFromRemote()

    expect(git(dir, ['rev-parse', 'run/toy'])).toBe(remoteTip)
    const state = git(dir, ['show', 'run/toy:runs/toy/state.yaml'])
    expect(state).toContain('cost_limit_usd: 100')
  })

  it('refuses a diverged local branch instead of clobbering it', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, push: true })
    await engine.tick()
    await engine.drain()
    parkOnDefault(dir)

    // Local unpushed commit (simulating #103's rejected-push residue) …
    const base = git(dir, ['rev-parse', 'run/toy'])
    const tree = git(dir, ['rev-parse', `${base}^{tree}`])
    const localTip = git(dir, ['commit-tree', tree, '-p', base, '-m', 'local-only bookkeeping'])
    git(dir, ['update-ref', 'refs/heads/run/toy', localTip, base])
    // … while origin moves independently.
    remoteWrite(bare, (s) => s.replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 100'))

    await engine.syncFromRemote() // must not throw, must not move the diverged ref

    expect(git(dir, ['rev-parse', 'run/toy'])).toBe(localTip)
  })

  it('tolerates a clone with no origin', async () => {
    const { dir } = toyRepo()
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: new FakeDispatcher(() => ({})), registry: TEST_REGISTRY })
    await expect(engine.syncFromRemote()).resolves.toBeUndefined()
  })
})
