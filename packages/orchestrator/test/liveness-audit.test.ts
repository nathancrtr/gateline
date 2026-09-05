// Liveness and safety audit of the reconcile loop (docs/ORCHESTRATOR.md §4.7).
//
// The loop is a state machine: `state.yaml` and the artifacts are the state,
// the derivation rules and the human verbs are the transitions, and two
// writers (engine, human) interleave on one branch under CAS. This file pins
// the properties that machine must have — one test per property — and, for
// each property the machine does not yet have, a reproduction marked
// `it.fails`: it passes today *because* the bug is there, and the moment a
// fix lands it fails, telling the fixer to remove the marker. Each carries
// the issue it is filed under.
//
// Findings are numbered as in the audit; the ones that hold today are
// asserted plainly.
import { describe, expect, it } from 'vitest'
import { LocalGitSource, deriveReadiness, planDecision, planSync, type RunState } from '@gateline/core'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import {
  agentCommit,
  appendToFile,
  FakeDispatcher,
  HUMAN,
  humanDecide,
  makeToyRepo,
  PLAN,
  reconcile,
  RELEASE_PLAN,
  REVIEW,
  SPEC,
  taskYaml,
  TEST_REGISTRY,
  toyRef,
  VERIFICATION,
  type Clock,
} from './engine.helper.ts'
import { assertStateInvariants, assertTerminalStays } from './invariants.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const makeEngine = (dir: string, dispatcher: FakeDispatcher, over: Partial<ConstructorParameters<typeof Engine>[0]> = {}) =>
  new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, ...over })

const readState = async (dir: string): Promise<RunState> => {
  const { state } = await new LocalGitSource('check', dir).readState(toyRef(dir))
  expect(state).not.toBeNull()
  return state!
}

/** Tick + drain n times, returning how many dispatches the fake saw in that span. */
async function ticks(engine: Engine, dispatcher: FakeDispatcher, n: number): Promise<number> {
  const before = dispatcher.calls.length
  for (let i = 0; i < n; i++) {
    await engine.tick()
    await engine.drain()
  }
  return dispatcher.calls.length - before
}

/** A cooperative agent for every role but the ones a test overrides. */
function cooperative(clock: Clock, overrides: Record<string, (req: { cwd: string; role: string; body: string }) => object> = {}) {
  let analystCalls = 0
  return (req: { cwd: string; role: string; body: string }) => {
    if (overrides[req.role]) return overrides[req.role]!(req)
    switch (req.role) {
      case 'analyst':
        analystCalls++
        agentCommit(req.cwd, clock, { 'runs/toy/spec.md': analystCalls === 1 ? SPEC : `${SPEC}\n<!-- revision ${analystCalls} -->\n` }, 'toy: spec')
        return {}
      case 'architect':
        agentCommit(req.cwd, clock, { 'runs/toy/plan.md': PLAN, 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py') }, 'toy: plan')
        return {}
      case 'implementer': {
        const round = /round (\d+)/.exec(req.body)?.[1] ?? '1'
        agentCommit(
          req.cwd,
          clock,
          { 'src/core.py': `# round ${round}\n`, 'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py', [], `round ${round} done`) },
          `toy: task 01-core round ${round}`,
        )
        return {}
      }
      case 'reviewer':
        agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': REVIEW('01-core', 'approve', 1) }, 'toy: review 01')
        return {}
      case 'verifier':
        agentCommit(req.cwd, clock, { 'runs/toy/verification-report.md': VERIFICATION }, 'toy: verification')
        return {}
      case 'ops':
        agentCommit(req.cwd, clock, { 'runs/toy/release-plan.md': RELEASE_PLAN }, 'toy: release plan')
        return {}
      default:
        return {}
    }
  }
}

/** Drive the toy run through G0 and G1 with one task, resting in implement. */
async function throughG1(dir: string, engine: Engine): Promise<void> {
  await reconcile(engine)
  await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
  await reconcile(engine)
  await humanDecide(dir, { action: 'approve', gate: 'G1', burden: 'confirmation' })
}

describe('F1 — the round cap has no in-grammar exit (#342)', () => {
  it.fails('resolving the round-cap escalation and resuming grants another round instead of re-pausing', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    // A reviewer that never converges and an implementer that always responds:
    // three rounds, then D4.
    let reviews = 0
    const dispatcher = new FakeDispatcher(
      cooperative(clock, {
        reviewer: (req) => {
          reviews++
          const verdict = REVIEW('01-core', 'request-changes', reviews)
          const content = reviews === 1 ? verdict : appendToFile(req.cwd, 'runs/toy/review-01.md', `\n# Round ${reviews}\n\n**Verdict:** request-changes\n\n## Findings\nStill.\n`)
          agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': content }, `toy: review round ${reviews}`)
          return {}
        },
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    try {
      await throughG1(dir, engine)
      await reconcile(engine)
      let state = await readState(dir)
      expect(state.paused_reason).toBe('round-cap')
      expect(state.tasks[0]!.review_rounds).toBe(3)

      // The human does what the card tells them: reads both sides and unblocks.
      await humanDecide(dir, { action: 'resolve-escalation', escalationIndex: 0, notes: 'spec ambiguity clarified in spec.md §R1' })
      await humanDecide(dir, { action: 'resume' })
      const dispatched = await ticks(engine, dispatcher, 2)
      state = await readState(dir)
      // Expected: the resolution grants a fresh round (or routes the task), so
      // the run either dispatches or rests on a human decision that exists.
      // Today: D4 re-fires on the same rounds count and re-pauses `round-cap`
      // — the only exits are a hand edit of review_rounds or task status.
      expect(state.paused_reason).not.toBe('round-cap')
      expect(dispatched).toBeGreaterThan(0)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F2 — a producer that lands nothing is re-dispatched without bound (#343)', () => {
  it.fails('D9: an analyst that returns without changing spec.md after a decline is not paid for every tick', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    let analystCalls = 0
    const dispatcher = new FakeDispatcher(
      cooperative(clock, {
        analyst: (req) => {
          analystCalls++
          // First call writes the spec; every later call concludes "the notes
          // are already addressed" and lands nothing.
          if (analystCalls === 1) agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
          return {}
        },
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'decline', gate: 'G0', notes: 'tighten R1' })
      await humanDecide(dir, { action: 'resume' })
      const redos = await ticks(engine, dispatcher, 4)
      // Expected: at most a bounce-cap's worth of redos, then a human. Today:
      // one paid dispatch per tick until cost_limit_usd trips DB.
      expect(redos).toBeLessThanOrEqual(2)
      const state = await readState(dir)
      expect(state.phase === 'paused' || state.escalations.some((e) => !e.resolved)).toBe(true)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it.fails('D13: a reviewer that delivers no verdict is not paid for every tick', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(cooperative(clock, { reviewer: () => ({}) }))
    const engine = makeEngine(dir, dispatcher)
    try {
      await throughG1(dir, engine)
      // Tick until the first reviewer dispatch: D5 advance, D19 seed, D11
      // implementer, then D13. Not `reconcile` — this loop never rests until
      // the budget cap stops it, which is the finding.
      for (let i = 0; i < 8 && !dispatcher.calls.some((c) => c.role === 'reviewer'); i++) await ticks(engine, dispatcher, 1)
      const before = dispatcher.calls.filter((c) => c.role === 'reviewer').length
      expect(before).toBe(1)
      await ticks(engine, dispatcher, 4)
      const reviews = dispatcher.calls.filter((c) => c.role === 'reviewer').length - before
      expect(reviews).toBeLessThanOrEqual(1)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F3 — a gate is decided in its own phase, in order (#344)', () => {
  it('planDecision refuses to approve a gate whose phase the run has not reached', async () => {
    const { dir } = makeToyRepo()
    const state = await readState(dir)
    expect(state.phase).toBe('spec')
    // G2 is not on the table in spec, so the approval is refused rather than
    // signed and advanced to release with implement and its verification
    // skipped. The message names the phase and the gate that is pending.
    expect(() => planDecision(state, { action: 'approve', gate: 'G2', burden: 'confirmation' }, HUMAN)).toThrow(/G0 is the gate awaiting a decision/)
  })

  it('PR-approval sync leaves G2 alone while the run has not reached implement', async () => {
    const { dir } = makeToyRepo()
    const source = new LocalGitSource('human', dir)
    const provider = { approval: async () => ({ number: 1, url: 'https://example.test/pr/1', reviewer: 'early-bird', submittedAt: new Date().toISOString() }) }
    const plan = await planSync(source, provider)
    // Nothing to sync: the packet G2 decides does not exist yet, so an early
    // Approve on the draft PR stays on the PR instead of becoming a gate entry
    // the engine's D5 rule would advance the run to done on.
    expect(plan).toHaveLength(0)
  })
})

describe('F4 — a terminal run is not moved by the engine (#345, fixed)', () => {
  it('a dispatch that fails after the human closed the run does not un-close it', { timeout: 60_000 }, async () => {
    const { dir } = makeToyRepo()
    let finish: (o: object) => void = () => {}
    const dispatcher = new FakeDispatcher(() => new Promise<object>((resolve) => (finish = resolve)))
    const engine = makeEngine(dir, dispatcher)
    try {
      await engine.tick() // analyst in flight
      await humanDecide(dir, { action: 'close', closure: 'obsolete', notes: 'need went away' })
      const closed = await readState(dir)
      expect(closed.phase).toBe('closed')
      finish({ ok: false, fatal: true, costUsd: null, tokensIn: null, tokensOut: null, error: 'boom' })
      await engine.drain()
      const after = await readState(dir)
      // The ledger must close (real usage); the phase must not move.
      expect(parseLedger(after)[0]!.cost_usd).not.toBeNull()
      assertTerminalStays(closed, after)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F5 — recency is read from wall clocks, not from the record (#346)', () => {
  it.fails('a resolution later in branch history counts even when its clock reads earlier than the verdict', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(
      cooperative(clock, {
        reviewer: (req) => {
          agentCommit(req.cwd, clock, { 'runs/toy/review-01.md': REVIEW('01-core', 'escalate', 1) }, 'toy: review escalates')
          return {}
        },
      }),
    )
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('human', dir)
    try {
      await throughG1(dir, engine)
      await reconcile(engine)
      let state = await readState(dir)
      expect(state.escalations[0]?.reason).toContain('reviewer escalated')

      // The human's machine runs a minute behind the committer that landed the
      // review (a laptop CLI against a hosted engine, or plain skew). The
      // resolution commit is still *after* the review in branch history.
      const reviewAt = (await source.lastTouched(toyRef(dir), ['review-01.md']))!.time * 1000
      const skewed = new Date(reviewAt - 60_000).toISOString()
      const write = await source.writeState(
        toyRef(dir),
        (doc) => {
          doc.setIn(['escalations', 0, 'resolved'], true)
          doc.setIn(['escalations', 0, 'resolved_by'], HUMAN.name)
          doc.setIn(['escalations', 0, 'resolved_at'], skewed)
          doc.setIn(['escalations', 0, 'resolution'], 'addressed')
          doc.setIn(['escalations', 0, 'disposition'], 're-review')
        },
        `state(toy): escalation #0 resolved by ${HUMAN.name} [disposition: re-review]`,
      )
      expect(write.ok).toBe(true)
      await humanDecide(dir, { action: 'resume' })
      const dispatched = await ticks(engine, dispatcher, 2)
      state = await readState(dir)
      // Expected: the record's own order says the human resolved after the
      // verdict, so the re-review dispatches. Today: D17 compares resolved_at
      // to the review commit's time, finds no resolution "after" it, and
      // re-escalates — the run pauses again with nothing left to resolve.
      expect(dispatched).toBeGreaterThan(0)
      expect(state.paused_reason).toBeNull()
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F6 — a standing refusal is bounded (#347, fixed)', () => {
  it('consecutive refusals of the same intent are bounded', { timeout: 60_000 }, async () => {
    const { dir } = makeToyRepo()
    const dispatcher = new FakeDispatcher(() => ({ ok: false, refused: true, costUsd: 0, tokensIn: null, tokensOut: null, error: 'nothing can spawn here' }))
    const engine = makeEngine(dir, dispatcher)
    try {
      await ticks(engine, dispatcher, 4)
      const state = await readState(dir)
      // Two refusals, then rule RF holds the dispatch back: nothing written,
      // the heartbeat carrying the condition, one probe per window instead of
      // a commit per tick for as long as it stands (#340's shape).
      expect(parseLedger(state).length).toBeLessThanOrEqual(2)
      expect(engine.deferrals()[0]).toMatchObject({ slug: 'toy', rule: 'RF' })
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F8 — the stale sweep is process-local (#349)', () => {
  it.fails('a second engine does not age out and re-dispatch a job that is alive in the first', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const hung = new FakeDispatcher(() => new Promise(() => {}))
    const first = makeEngine(dir, hung)
    await first.tick() // analyst in flight, alive in `first`

    const second = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock as Clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const other = makeEngine(dir, second, { staleMs: 0 })
    try {
      await other.tick()
      await other.drain()
      // Expected: nothing distinguishes this from a crashed engine today, so
      // the entry is aged and the analyst runs twice at once — the intent
      // commit's CAS guards the *commit*, not the job. The fix needs an
      // engine identity on the entry and a liveness signal to read.
      expect(second.calls).toHaveLength(0)
      const state = await readState(dir)
      assertStateInvariants(state)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F9 — `in-progress` with no open dispatch is a rest with no exit (#350)', () => {
  it.fails('a task stuck in-progress with nothing in flight is surfaced or aged, not rested on forever', { timeout: 120_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(cooperative(clock))
    const engine = makeEngine(dir, dispatcher)
    const source = new LocalGitSource('human', dir)
    try {
      await throughG1(dir, engine)
      await engine.tick() // D19 seeds tasks
      await engine.drain()
      const write = await source.writeState(toyRef(dir), (doc) => doc.setIn(['tasks', 0, 'status'], 'in-progress'), 'state(toy): hand-marked in-progress')
      expect(write.ok).toBe(true)
      await ticks(engine, dispatcher, 3)
      const state = await readState(dir)
      const { items } = await deriveReadiness(source, toyRef(dir))
      // Expected: either the engine treats it as stale after the role timeout
      // or a human is told. Today: D12 rests, the inbox is empty, forever.
      expect(items.length > 0 || state.tasks[0]!.status !== 'in-progress').toBe(true)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('F10 — a gate cannot be approved while its producer is being re-dispatched (#351)', () => {
  it('planDecision refuses an approval whose packet is about to be replaced', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    let analystCalls = 0
    let finish: (o: object) => void = () => {}
    const dispatcher = new FakeDispatcher((req) => {
      analystCalls++
      if (analystCalls === 1) {
        agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
        return {}
      }
      return new Promise<object>((resolve) => (finish = resolve)) // the redo, in flight
    })
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'decline', gate: 'G0', notes: 'tighten R1' })
      await humanDecide(dir, { action: 'resume' })
      await engine.tick() // D9 re-dispatch, now in flight
      const state = await readState(dir)
      expect(parseLedger(state).filter((e) => e.role === 'analyst' && e.cost_usd === null)).toHaveLength(1)
      // The open producer entry is the #159 signal, and approving the
      // superseded packet is refused on it — so the redo can no longer land a
      // spec nobody approved under an approved G0.
      expect(() => planDecision(state, { action: 'approve', gate: 'G0', burden: 'confirmation' }, HUMAN)).toThrow(/analyst is in flight/)
    } finally {
      finish({})
      await engine.drain()
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('what holds today (the properties the walk relies on)', () => {
  it('a closed run rests on D1 with an unresolved escalation and an approved gate in it', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(cooperative(clock))
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
      await humanDecide(dir, { action: 'close', closure: 'superseded', notes: 'later work overtook it' })
      const before = await readState(dir)
      const dispatched = await ticks(engine, dispatcher, 2)
      expect(dispatched).toBe(0)
      assertTerminalStays(before, await readState(dir))
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('a decline followed by resume re-opens the gate and re-dispatches the producer exactly once when it lands a change', { timeout: 60_000 }, async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher(cooperative(clock))
    const engine = makeEngine(dir, dispatcher)
    try {
      await reconcile(engine)
      await humanDecide(dir, { action: 'decline', gate: 'G0', notes: 'tighten R1' })
      await humanDecide(dir, { action: 'resume' })
      const redos = await ticks(engine, dispatcher, 3)
      expect(redos).toBe(1)
      const state = await readState(dir)
      expect(state.gates.G0.by).toBeNull()
      assertStateInvariants(state)
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })

  it('a bounded random walk of human decisions and cooperative dispatches keeps every state invariant', { timeout: 300_000 }, async () => {
    for (const seed of [11, 23]) {
      const { dir, clock } = makeToyRepo({ budget: 200 })
      let x = seed
      const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
      let failNext = false
      const dispatcher = new FakeDispatcher((req) => {
        // One dispatch in eight fails outright; the rest cooperate.
        if (failNext) {
          failNext = false
          return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'model outage' }
        }
        return cooperative(clock)(req)
      })
      const engine = makeEngine(dir, dispatcher)
      const source = new LocalGitSource('human', dir)
      try {
        let sinceHuman = 0
        for (let step = 0; step < 18; step++) {
          failNext = rand() < 0.125
          const outcomes = await engine.tick()
          await engine.drain()
          sinceHuman += outcomes.reduce((n, o) => n + o.launched, 0)
          const state = await readState(dir)
          assertStateInvariants(state)
          if (state.phase === 'done') break
          // Progress: without a human, paid dispatches stay bounded (a
          // cooperative pipeline needs at most a handful per phase).
          expect(sinceHuman, `seed ${seed}: ${sinceHuman} dispatches since the last human decision`).toBeLessThanOrEqual(8)

          const { items } = await deriveReadiness(source, toyRef(dir))
          const item = items[Math.floor(rand() * items.length)]
          if (!item) continue
          sinceHuman = 0
          if (item.kind === 'gate' && item.reviewable && item.gate) {
            if (rand() < 0.8) await humanDecide(dir, { action: 'approve', gate: item.gate, burden: 'confirmation' })
            else await humanDecide(dir, { action: 'decline', gate: item.gate, notes: `seed ${seed} step ${step}: redo` })
          } else if (item.kind === 'escalation' && item.escalationIndex !== null) {
            await humanDecide(dir, { action: 'resolve-escalation', escalationIndex: item.escalationIndex, notes: 'looked; carry on' })
          } else if (item.kind === 'paused') {
            const limit = state.budget?.cost_limit_usd ?? 0
            await humanDecide(dir, {
              action: 'resume',
              ...(item.pausedReason === 'budget-exhausted' ? { costLimitUsd: limit + 50 } : {}),
            })
          }
          assertStateInvariants(await readState(dir))
        }
      } finally {
        await removeRunCheckout(dir, 'run/toy')
      }
    }
  })
})
