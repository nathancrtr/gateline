// Hosted mode: every orchestrator commit reaches origin (--push), and
// unattended dispatch is bounded by the host ceiling (--spend-limit-usd)
// and the per-run-budget requirement (--require-budget).
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalGitSource } from '@agentic/core'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { agentCommit, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY, type Clock } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toyRepo(opts: { budget?: number } = {}) {
  const made = makeToyRepo(opts)
  cleanups.push(made.dir)
  return made
}

/** Give the toy repo a bare origin so pushes have somewhere to land. */
function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  cleanups.push(bare)
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  return bare
}

const refAt = (repo: string, ref: string) => execFileSync('git', ['-C', repo, 'rev-parse', ref], { encoding: 'utf8' }).trim()

function makeEngine(dir: string, dispatcher: FakeDispatcher, over: Partial<ConstructorParameters<typeof Engine>[0]> = {}): Engine {
  return new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, ...over })
}

describe('--push: origin carries every orchestrator write', () => {
  it('intent, agent work, and the closing meter all reach origin', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { push: true })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    // The closing (metered) commit went through the worktree write path while
    // the run checkout existed; origin must still have it.
    const localTip = refAt(dir, 'refs/heads/run/toy')
    expect(refAt(bare, 'refs/heads/run/toy')).toBe(localTip)
    const originState = execFileSync('git', ['-C', bare, 'show', 'refs/heads/run/toy:runs/toy/state.yaml'], { encoding: 'utf8' })
    expect(originState).toContain('cost_usd: 1.25')
  })

  it('a failed push is a warning, not a stop: the write still lands locally', async () => {
    const { dir, clock } = toyRepo()
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `${dir}-missing.git`])
    const lines: string[] = []
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { push: true, log: (l) => lines.push(l) })

    await engine.tick()
    await engine.drain()

    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const { state } = await source.readState(ref)
    expect(parseLedger(state!).length).toBeGreaterThan(0)
    expect(lines.join('\n')).toContain('metered analyst')
  })
})

describe('--spend-limit-usd: the host-wide ceiling (HB)', () => {
  it('downgrades a dispatch to an escalation and pauses when the projection exceeds the cap', async () => {
    const { dir } = toyRepo({ budget: 50 })
    const dispatcher = new FakeDispatcher(() => ({}))
    // analyst estimate in TEST_REGISTRY is $2; a $1 host cap must refuse it.
    const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 1 })

    const outcomes = await engine.tick()
    await engine.drain()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('escalate')
    expect(toy.action.rule).toBe('HB')
    expect(dispatcher.calls.length).toBe(0)

    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const { state } = await source.readState(ref)
    expect(state?.phase).toBe('paused')
    expect(state?.paused_reason).toBe('budget-exhausted')
    expect(state?.escalations?.[0]?.reason).toContain('host spend')
  })

  it('dispatches normally when the projection fits under the cap', async () => {
    const { dir, clock } = toyRepo({ budget: 50 })
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 100 })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(dispatcher.calls.length).toBe(1)
  })
})

describe('--require-budget: no ceiling, no dispatch (RB)', () => {
  it('escalates and pauses a run whose cost_limit_usd is unset', async () => {
    const { dir } = toyRepo()
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    const dropped = await human.writeState(ref, (doc) => doc.setIn(['budget', 'cost_limit_usd'], null), 'state(toy): drop budget cap')
    expect(dropped.ok).toBe(true)

    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = makeEngine(dir, dispatcher, { requireBudget: true })

    const outcomes = await engine.tick()
    await engine.drain()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('escalate')
    expect(toy.action.rule).toBe('RB')
    expect(dispatcher.calls.length).toBe(0)

    const { state } = await human.readState(ref)
    expect(state?.phase).toBe('paused')
    expect(state?.paused_reason).toBe('budget-exhausted')
  })
})

describe('hosted clone: a run that exists only as a remote-tracking ref', () => {
  // The M2 csvpeek wedge: a hosted machine clones from origin, so a newly
  // pushed run/<slug> branch exists only as refs/remotes/origin/run/<slug>
  // until the first write materializes it. The engine must dispatch such a
  // run — pinning only refs/heads silently skips it on every tick.
  it('dispatches, materializes the local branch, and pushes the bookkeeping', async () => {
    const { dir, clock } = toyRepo()
    const bare = addOrigin(dir)
    execFileSync('git', ['-C', dir, 'push', '--quiet', 'origin', 'run/toy'])

    const clone = `${dir}-clone`
    cleanups.push(clone)
    execFileSync('git', ['clone', '--quiet', bare, clone])
    execFileSync('git', ['-C', clone, 'config', 'user.name', BOT.name])
    execFileSync('git', ['-C', clone, 'config', 'user.email', BOT.email])
    expect(() => refAt(clone, 'refs/heads/run/toy')).toThrow() // remote-only

    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(clone, dispatcher, { push: true })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    // Local branch was materialized by the intent write, and every commit —
    // intent, agent work, closing meter — reached origin.
    const localTip = refAt(clone, 'refs/heads/run/toy')
    expect(refAt(bare, 'refs/heads/run/toy')).toBe(localTip)
    const originState = execFileSync('git', ['-C', bare, 'show', 'refs/heads/run/toy:runs/toy/state.yaml'], { encoding: 'utf8' })
    expect(originState).toContain('cost_usd: 1.25')
  })
})
