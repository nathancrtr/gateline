// #103 push-then-launch: origin is the linearization point. A rejected push
// means another writer moved the branch past the tip this derivation
// observed — the engine must not act on it (no launch), must not let its
// stale bookkeeping compound (drop + sync where safe), and must recover to
// origin's truth on the next derivation. The 2026-07-15 incident: 30 minutes
// of silently rejected pushes while humans and the engine wrote to
// divergent histories.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { agentCommit, type Clock, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

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

/** A competing writer: clone origin, mutate run/toy's state.yaml, push back. */
function remoteWrite(bare: string, mutate: (state: string) => string): string {
  const clone = `${bare}-writer-${Math.random().toString(36).slice(2, 8)}`
  cleanups.push(clone)
  execFileSync('git', ['clone', '--quiet', bare, clone])
  git(clone, ['checkout', '-q', 'run/toy'])
  const path = join(clone, 'runs', 'toy', 'state.yaml')
  writeFileSync(path, mutate(readFileSync(path, 'utf8')))
  git(clone, ['-c', 'user.name=Human', '-c', 'user.email=human@example.test', 'commit', '-aqm', 'state(toy): edited by Human'])
  git(clone, ['push', '-q', 'origin', 'run/toy'])
  return git(clone, ['rev-parse', 'HEAD'])
}

const makeEngine = (dir: string, dispatcher: FakeDispatcher, over: Partial<ConstructorParameters<typeof Engine>[0]> = {}) =>
  new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, push: true, ...over })

describe('push-then-launch (#103)', () => {
  it('a rejected intent push launches nothing, drops the stale intent, and self-heals next tick', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    git(dir, ['checkout', '-q', 'main']) // orchestrator clones sit on main, not the run branch
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher)

    // Origin moves past the engine's (stale) local branch before it acts.
    const remoteTip = remoteWrite(bare, (s) => s.replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 60'))

    const first = await engine.tick()
    await engine.drain()

    // Nothing launched: origin never accepted the intent.
    expect(dispatcher.calls.length).toBe(0)
    expect(first.find((o) => o.slug === 'toy')?.launched).toBe(0)
    expect(first.find((o) => o.slug === 'toy')?.detail).toContain('nothing launched')
    // The stale intent was dropped and the branch fast-forwarded to origin.
    expect(git(dir, ['rev-parse', 'run/toy'])).toBe(remoteTip)
    expect(git(dir, ['show', 'run/toy:runs/toy/state.yaml'])).toContain('cost_limit_usd: 60')
    expect(engine.pushHealth().get('run/toy')).toBe(1)

    // Next tick derives from origin's truth: intent accepted, dispatch runs.
    const second = await engine.tick()
    await engine.drain()
    expect(second.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(dispatcher.calls.length).toBe(1)
    expect(engine.pushHealth().get('run/toy')).toBeUndefined()
    // Everything the engine wrote reached origin.
    expect(git(bare, ['rev-parse', 'refs/heads/run/toy'])).toBe(git(dir, ['rev-parse', 'run/toy']))
  })

  it('a closing commit rejected on the plumbing path is re-closed on origin’s tip', async () => {
    const { dir } = toyRepo()
    // Seed an aged open ledger entry (a dispatch lost to a crash), then give
    // the repo an origin that carries it.
    git(dir, ['checkout', '-q', 'run/toy'])
    const statePath = join(dir, 'runs', 'toy', 'state.yaml')
    writeFileSync(
      statePath,
      readFileSync(statePath, 'utf8').replace(
        '  cost_spent_usd: 0',
        `  cost_spent_usd: 0
  ledger:
    - {at: 2020-01-01T00:00:00Z, role: analyst, task: null, round: null,
       adapter: fake, model: fake/model, tokens_in: null, tokens_out: null,
       cost_usd: null}`,
      ),
    )
    git(dir, ['-c', 'user.name=T', '-c', 'user.email=t@example.test', 'commit', '-aqm', 'state(toy): open entry'])
    git(dir, ['checkout', '-q', 'main'])
    const bare = addOrigin(dir)

    // Origin moves independently before the engine ages the entry out.
    remoteWrite(bare, (s) => s.replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 60'))

    const engine = makeEngine(dir, new FakeDispatcher(() => ({})))
    await engine.tick() // sweepStale → close as failed → push rejected → drop, sync, retry on origin's tip
    await engine.drain()

    expect(git(bare, ['rev-parse', 'refs/heads/run/toy'])).toBe(git(dir, ['rev-parse', 'run/toy']))
    const originState = git(bare, ['show', 'refs/heads/run/toy:runs/toy/state.yaml'])
    expect(originState).toContain('cost_limit_usd: 60') // the human's edit survived
    expect(originState).toContain('failed: true') // and the aged entry closed on top of it
    expect(engine.pushHealth().get('run/toy')).toBeUndefined()
  })

  it('a closing commit under a live checkout stays local and counts against push health', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    git(dir, ['checkout', '-q', 'main'])
    // The agent's own dispatch is when origin moves: the intent push has
    // already been accepted, the run checkout exists (held branch), and the
    // closing meter's push will be rejected with no safe way to drop.
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      remoteWrite(bare, (s) => s.replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 60'))
      return {}
    })
    const engine = makeEngine(dir, dispatcher)

    await engine.tick()
    await engine.drain()

    expect(dispatcher.calls.length).toBe(1)
    // Closed locally — usage is never discarded …
    const local = git(dir, ['show', 'run/toy:runs/toy/state.yaml'])
    expect(local).toContain('cost_usd: 1.25')
    // … but origin was not clobbered and the rejection is on the books.
    expect(engine.pushHealth().get('run/toy')).toBeGreaterThanOrEqual(1)
    expect(git(bare, ['show', 'refs/heads/run/toy:runs/toy/state.yaml'])).toContain('cost_limit_usd: 60')
  })
})
