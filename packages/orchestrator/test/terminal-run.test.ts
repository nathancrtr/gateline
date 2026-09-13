// #345 / invariant I6 (ORCHESTRATOR.md §4.7): the engine never un-closes a
// run. A human may close a run — or a gate approval may carry it to `done` —
// while a dispatch is still out, and that dispatch may land badly: a failure,
// a fatal one, or an age-out after a restart. The close path still writes
// everything about the dispatch — the meter, because the usage was real and
// the ledger is the only account of it, and the task's own status, because a
// task left at `dispatched` with nothing in flight would strand the run if it
// were reopened (#350) — and nothing about the run: no escalation, no phase,
// no paused_reason.
import { rmSync } from 'node:fs'
import { LocalGitSource } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import { agentCommit, type Clock, deadEngineId, FakeDispatcher, humanDecide, makeToyRepo, PLAN, reconcile, SPEC, TEST_REGISTRY, taskYaml, toyRef } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

const makeEngine = (dir: string, dispatcher: FakeDispatcher, over: Partial<ConstructorParameters<typeof Engine>[0]> = {}) =>
  new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, ...over })

/**
 * A pipeline that cooperates up to the implementer, whose outcomes the test
 * scripts. The implementer closes the run from inside its own job when asked
 * to — a human's decision landing while the dispatch is genuinely in flight,
 * which is the race #345 is about.
 */
function upToImplement(clock: Clock, implementer: (call: number) => Promise<object> | object) {
  let calls = 0
  return (req: { cwd: string; role: string }) => {
    switch (req.role) {
      case 'analyst':
        agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
        return {}
      case 'architect':
        agentCommit(req.cwd, clock, { 'runs/toy/plan.md': PLAN, 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py') }, 'toy: plan')
        return {}
      case 'implementer':
        return implementer(++calls)
      default:
        return {}
    }
  }
}

/** Drive the toy run to its first implementer dispatch, gates approved by a human. */
async function toImplement(dir: string, engine: Engine, until: () => boolean): Promise<void> {
  await reconcile(engine)
  await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
  await reconcile(engine)
  await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
  for (let i = 0; i < 8 && !until(); i++) {
    await engine.tick()
    await engine.drain()
  }
  expect(until()).toBe(true)
}

/** A dispatcher whose one job hangs until the test resolves it. */
function heldDispatcher(): { dispatcher: FakeDispatcher; finish: (o: object) => void } {
  let resolve: (o: object) => void = () => {}
  const dispatcher = new FakeDispatcher(() => new Promise<object>((r) => (resolve = r)))
  return { dispatcher, finish: (o) => resolve(o) }
}

describe('a dispatch that lands on a closed run is metered and nothing else (#345)', () => {
  it('records the failure in the ledger and leaves the closure standing', { timeout: 60_000 }, async () => {
    const { dir } = toyRepo()
    const { dispatcher, finish } = heldDispatcher()
    const lines: string[] = []
    const engine = makeEngine(dir, dispatcher, { log: (l: string) => lines.push(l) })
    const source = new LocalGitSource('check', dir)
    try {
      await engine.tick() // analyst in flight
      await humanDecide(dir, { action: 'close', closure: 'obsolete', notes: 'the need went away' })

      // The in-flight analyst dies fatally, the way a vendor outage ends one.
      finish({ ok: false, fatal: true, costUsd: 2.5, tokensIn: 90_000, tokensOut: 4_000, error: 'model outage' })
      await engine.drain()

      const { state } = await source.readState(toyRef(dir))
      const [entry] = parseLedger(state)
      // The meter lands in full: real cost, real tokens, the failed flag.
      expect(entry).toMatchObject({ role: 'analyst', cost_usd: 2.5, tokens_in: 90_000, tokens_out: 4_000, failed: true })
      expect(state!.budget!.cost_spent_usd).toBe(2.5)
      // And nothing else does.
      expect(state!.phase).toBe('closed')
      expect(state!.paused_reason).toBeNull()
      expect(state!.closure).toMatchObject({ as: 'obsolete' })
      expect(state!.escalations).toHaveLength(0)
      expect(lines.join('\n')).toContain('failed against a closed run')
      expect(lines.join('\n')).toContain('nothing escalated')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('rests on a closed run for the rest of the process, dispatching nothing more', { timeout: 60_000 }, async () => {
    const { dir } = toyRepo()
    const { dispatcher, finish } = heldDispatcher()
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await engine.tick()
      await humanDecide(dir, { action: 'close', closure: 'abandoned', notes: 'walked away' })
      finish({ ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'boom' })
      await engine.drain()

      const before = await source.git.revParse('refs/heads/run/toy')
      const outcomes = await engine.tick()
      await engine.drain()
      expect(outcomes.find((o) => o.slug === 'toy')?.action.kind).toBe('rest')
      expect(dispatcher.calls).toHaveLength(1)
      expect(await source.git.revParse('refs/heads/run/toy')).toBe(before)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('holds the same for a run that reached done while the producer was out', { timeout: 60_000 }, async () => {
    const { dir } = toyRepo()
    const { dispatcher, finish } = heldDispatcher()
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('human', dir)
    try {
      await engine.tick()
      // The other terminal phase: a gate approval carries the run to `done`
      // while this dispatch is still in flight.
      const write = await source.writeState(toyRef(dir), (doc) => doc.setIn(['phase'], 'done'), 'state(toy): the run finished')
      expect(write.ok).toBe(true)

      finish({ ok: false, fatal: true, costUsd: null, tokensIn: null, tokensOut: null, error: 'harness died' })
      await engine.drain()

      const { state } = await source.readState(toyRef(dir))
      // Metered at the static estimate — a launched-then-lost dispatch may
      // genuinely have burned tokens (#155).
      expect(parseLedger(state)[0]).toMatchObject({ role: 'analyst', cost_usd: TEST_REGISTRY.estimates.analyst, failed: true })
      expect(state!.phase).toBe('done')
      expect(state!.paused_reason).toBeNull()
      expect(state!.escalations).toHaveLength(0)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('ages a lost dispatch out of a closed run without escalating it', { timeout: 60_000 }, async () => {
    const { dir } = toyRepo()
    const { dispatcher, finish } = heldDispatcher()
    // The first engine opens the entry under a pid that is no longer running
    // (#349): a restart reclaims an entry only when the engine that opened it
    // is dead, and this process is very much alive.
    const engine = makeEngine(dir, dispatcher, { engineId: deadEngineId() })
    const source = new LocalGitSource('check', dir)
    // A second engine stands in for the restart: the first engine's job is
    // alive here, so only a process that never launched it reads the open
    // entry as lost and sweeps it (§4.4's crash recovery).
    const restarted = makeEngine(dir, new FakeDispatcher(() => ({})), { staleMs: 0 })
    try {
      await engine.tick() // analyst in flight, alive in `engine`
      await humanDecide(dir, { action: 'close', closure: 'superseded', notes: 'another run shipped it' })

      await restarted.tick()
      await restarted.drain()

      const { state } = await source.readState(toyRef(dir))
      const [entry] = parseLedger(state)
      expect(entry).toMatchObject({ role: 'analyst', failed: true })
      expect(entry!.cost_usd).toBe(TEST_REGISTRY.estimates.analyst)
      expect(state!.phase).toBe('closed')
      expect(state!.paused_reason).toBeNull()
      expect(state!.escalations).toHaveLength(0)
    } finally {
      finish({ ok: true, costUsd: 0, tokensIn: null, tokensOut: null, error: null })
      await engine.drain()
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('the task an in-flight dispatch owns is still handed back (#345, #350)', () => {
  it('flips to in-review when the work landed, even though the run closed under it', { timeout: 120_000 }, async () => {
    const { dir, clock } = toyRepo()
    let calls = 0
    const dispatcher = new FakeDispatcher(
      upToImplement(clock, async () => {
        // The human closes the run while this implementer is out.
        await humanDecide(dir, { action: 'close', closure: 'already-delivered', notes: 'shipped by another path' })
        calls++
        return {}
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await toImplement(dir, engine, () => calls > 0)
      const { state } = await source.readState(toyRef(dir))
      expect(state!.phase).toBe('closed')
      expect(state!.tasks[0]).toMatchObject({ id: '01-core', status: 'in-review' })
      expect(state!.escalations).toHaveLength(0)
      expect(state!.paused_reason).toBeNull()
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('returns the task to pending on a failure, so a reopened run is not stranded at dispatched', { timeout: 120_000 }, async () => {
    const { dir, clock } = toyRepo()
    let calls = 0
    const dispatcher = new FakeDispatcher(
      upToImplement(clock, async () => {
        await humanDecide(dir, { action: 'close', closure: 'obsolete', notes: 'the need went away' })
        calls++
        return { ok: false, costUsd: 6, tokensIn: null, tokensOut: null, error: 'model outage' }
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await toImplement(dir, engine, () => calls > 0)
      const { state } = await source.readState(toyRef(dir))
      expect(state!.phase).toBe('closed')
      // `dispatched` with no open entry is the #350 shape — the one status a
      // reopened run could never derive its way out of.
      expect(state!.tasks[0]).toMatchObject({ id: '01-core', status: 'pending' })
      expect(parseLedger(state).find((e) => e.role === 'implementer')).toMatchObject({ cost_usd: 6, failed: true })
      expect(state!.escalations).toHaveLength(0)
      expect(state!.paused_reason).toBeNull()
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('says pending, not failed, on the failure that would have escalated', { timeout: 120_000 }, async () => {
    const { dir, clock } = toyRepo()
    let calls = 0
    const dispatcher = new FakeDispatcher(
      upToImplement(clock, async (call) => {
        // The first failure is an ordinary one on a live run: the task goes
        // back to pending and the engine spends its one retry. The human
        // closes the run while that retry is out, and it fails too — the
        // second failure, which on a live run marks the task `failed` and
        // escalates. `failed` is D20's pairing with that escalation, so
        // without the escalation it would be a status nothing can clear.
        if (call === 2) await humanDecide(dir, { action: 'close', closure: 'abandoned', notes: 'walked away mid-retry' })
        calls = call
        return { ok: false, costUsd: 6, tokensIn: null, tokensOut: null, error: `model outage ${call}` }
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('check', dir)
    try {
      await toImplement(dir, engine, () => calls > 1)
      const { state } = await source.readState(toyRef(dir))
      expect(state!.phase).toBe('closed')
      expect(state!.tasks[0]).toMatchObject({ id: '01-core', status: 'pending' })
      expect(parseLedger(state).filter((e) => e.role === 'implementer' && e.failed)).toHaveLength(2)
      expect(state!.escalations).toHaveLength(0)
      expect(state!.paused_reason).toBeNull()
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})
