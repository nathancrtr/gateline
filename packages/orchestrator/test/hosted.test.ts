// Hosted mode: every orchestrator commit reaches origin (--push), and
// unattended dispatch is bounded by the host ceiling (--spend-limit-usd)
// and the per-run-budget requirement (--require-budget).
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { LocalGitSource } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { agentCommit, type Clock, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

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

/** Seed one closed ledger entry on the toy run, opened `at`, so the host window has history to measure. */
async function seedLedger(dir: string, at: string, costUsd: number): Promise<void> {
  const human = new LocalGitSource('t', dir)
  const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
  const wrote = await human.writeState(
    ref,
    (doc) => doc.setIn(['budget', 'ledger', 0], { at, role: 'analyst', task: null, round: null, cost_usd: costUsd }),
    'state(toy): seeded ledger',
  )
  expect(wrote.ok).toBe(true)
}

describe('--spend-limit-usd: the host-wide ceiling (HB, #97)', () => {
  it('defers a dispatch that would cross the cap — nothing written, nothing paused, the reason on the heartbeat', async () => {
    const { dir } = toyRepo({ budget: 50 })
    const dispatcher = new FakeDispatcher(() => ({}))
    const lines: string[] = []
    // analyst estimate in TEST_REGISTRY is $2; a $1 host cap must hold it back.
    const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 1, log: (l) => lines.push(l) })

    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const before = await source.git.revParse(ref.ref)

    const outcomes = await engine.tick()
    await engine.drain()

    const toy = outcomes.find((o) => o.slug === 'toy')!
    expect(toy.action.kind).toBe('rest')
    expect(toy.action.rule).toBe('HB')
    expect(toy.wrote).toBe(false)
    expect(dispatcher.calls.length).toBe(0)
    // The old shape paused the run and escalated a host-level condition into
    // one run's record (#97): a resolve-and-resume changed none of the inputs
    // and the next tick re-derived the same refusal. Now the run is untouched…
    expect(await source.git.revParse(ref.ref)).toBe(before)
    const { state } = await source.readState(ref)
    expect(state?.phase).toBe('spec')
    expect(state?.escalations ?? []).toHaveLength(0)
    // …and the condition is reported where it lives: the engine, for the heartbeat.
    const deferrals = engine.deferrals()
    expect(deferrals).toHaveLength(1)
    expect(deferrals[0]).toMatchObject({ slug: 'toy', rule: 'HB' })
    expect(deferrals[0]!.reason).toContain('--spend-limit-usd $1')
    expect(deferrals[0]!.reason).toContain('over the last 24 hours')
    expect(Date.parse(deferrals[0]!.since)).not.toBeNaN()
    expect(lines.join('\n')).toContain('deferred, not paused')
  })

  it('measures a rolling window: spend outside it no longer counts, spend inside it does', async () => {
    const now = new Date('2026-09-04T12:00:00Z')
    const hourAgo = new Date(now.getTime() - 3_600_000).toISOString()
    const twoDaysAgo = new Date(now.getTime() - 48 * 3_600_000).toISOString()

    // $10 closed two days ago against a $5 cap: outside the 24h window, so the
    // $2 analyst dispatch fits and goes out.
    {
      const { dir, clock } = toyRepo({ budget: 50 })
      await seedLedger(dir, twoDaysAgo, 10)
      const dispatcher = new FakeDispatcher((req) => {
        agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
        return {}
      })
      const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 5, now: () => now })
      const outcomes = await engine.tick()
      await engine.drain()
      expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
      expect(engine.deferrals()).toHaveLength(0)
    }

    // The same $10 an hour ago is inside the window: deferred.
    {
      const { dir } = toyRepo({ budget: 50 })
      await seedLedger(dir, hourAgo, 10)
      const dispatcher = new FakeDispatcher(() => ({}))
      const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 5, now: () => now })
      const outcomes = await engine.tick()
      await engine.drain()
      expect(outcomes.find((o) => o.slug === 'toy')?.action.rule).toBe('HB')
      expect(dispatcher.calls.length).toBe(0)
      expect(engine.deferrals()[0]?.reason).toContain('ledger $10.00 in the window')
    }

    // A narrower window (--spend-window 0.5h) lets the hour-old spend age out.
    {
      const { dir, clock } = toyRepo({ budget: 50 })
      await seedLedger(dir, hourAgo, 10)
      const dispatcher = new FakeDispatcher((req) => {
        agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
        return {}
      })
      const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 5, spendWindowMs: 30 * 60_000, now: () => now })
      const outcomes = await engine.tick()
      await engine.drain()
      expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    }
  })

  it('a deferral keeps its first-seen time across ticks and clears once the dispatch fits', async () => {
    const now = new Date('2026-09-04T12:00:00Z')
    const { dir, clock } = toyRepo({ budget: 50 })
    await seedLedger(dir, new Date(now.getTime() - 3_600_000).toISOString(), 10)
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    let clockNow = now
    const engine = makeEngine(dir, dispatcher, { spendLimitUsd: 5, now: () => clockNow })

    await engine.tick()
    const first = engine.deferrals()[0]!
    clockNow = new Date(now.getTime() + 60_000)
    await engine.tick()
    expect(engine.deferrals()[0]).toMatchObject({ slug: 'toy', rule: 'HB', since: first.since })

    // The window rolls past the seeded spend: the dispatch fits, the deferral is gone.
    clockNow = new Date(now.getTime() + 25 * 3_600_000)
    const outcomes = await engine.tick()
    await engine.drain()
    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(engine.deferrals()).toHaveLength(0)
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

describe('--no-budget-enforcement: meter always, pause never (#109)', () => {
  it('dispatches past the per-run and host caps, and the ledger still meters', async () => {
    // A $1 per-run cap and a $1 host cap both sit under the analyst's $2
    // estimate — with enforcement on this is a DB/HB pause; off, it dispatches.
    const { dir, clock } = toyRepo({ budget: 1 })
    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { budgetEnforcement: false, spendLimitUsd: 1 })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(dispatcher.calls.length).toBe(1)

    // Metering is unconditional: the closing commit still records real cost.
    const source = new LocalGitSource('t', dir)
    const ref = (await source.listRuns()).find((r) => r.slug === 'toy')!
    const { state } = await source.readState(ref)
    expect(state?.phase).not.toBe('paused')
    const ledger = parseLedger(state!)
    expect(ledger.length).toBe(1)
    expect(ledger[0]?.cost_usd).toBe(1.25)
  })

  it('overrides --require-budget: a run with no cap at all still dispatches', async () => {
    const { dir, clock } = toyRepo()
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    const dropped = await human.writeState(ref, (doc) => doc.setIn(['budget', 'cost_limit_usd'], null), 'state(toy): drop budget cap')
    expect(dropped.ok).toBe(true)

    const dispatcher = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { requireBudget: true, budgetEnforcement: false })

    const outcomes = await engine.tick()
    await engine.drain()

    expect(outcomes.find((o) => o.slug === 'toy')?.launched).toBe(1)
    expect(dispatcher.calls.length).toBe(1)
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
