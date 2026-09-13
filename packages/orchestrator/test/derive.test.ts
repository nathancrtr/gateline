// One test per derivation-table row (docs/ORCHESTRATOR.md §4.2) — the same
// discipline the frontend's readiness table keeps. Observations are built
// directly so each row is exercised in isolation.

import { BranchOrder, type CommitInfo, type Disposition, type GateEntry, PROFILES, type RunState, STAGED_REASON, type Validation } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ESTIMATE_USD, deriveAction, LANDING_CAP, roundCapReason, VERIFIER_ESCALATION_REASON } from '../src/derive.ts'
import { idleDispatchCounts, type LedgerEntry, type RunObservation, type TaskFileInfo } from '../src/observe.ts'
import type { ReviewInfo } from '../src/review-report.ts'

const gate = (over: Partial<GateEntry> = {}): GateEntry => ({ approved: false, by: null, at: null, notes: null, burden: null, ...over })

const state = (over: Partial<RunState> = {}): RunState =>
  ({
    run: 'toy',
    branch: 'run/toy',
    phase: 'spec',
    paused_reason: null,
    budget: { cost_limit_usd: 50, cost_spent_usd: 0 },
    gates: { G0: gate(), G1: gate(), G2: gate(), G3: gate() },
    tasks: [],
    escalations: [],
    ...over,
  }) as RunState

const ok: Validation = { contract: 'spec.md', ok: true, missing: [], notes: [] }
const bad = (...missing: string[]): Validation => ({ contract: 'spec.md', ok: false, missing, notes: [] })

const obs = (over: Partial<RunObservation> = {}): RunObservation => ({
  slug: 'toy',
  state: state(),
  stateError: null,
  artifacts: ['intent-brief.md'],
  validations: {},
  reviews: [],
  verification: null,
  lastTouched: {},
  lastTouchedOid: {},
  lastNonStateCommit: null,
  lastNonStateOid: null,
  // No branch to read: every recency check in these hand-built rows falls back
  // to the timestamps written into them, which is exactly what #346 keeps as
  // the fallback. The branch-order semantics have their own rows below.
  order: new BranchOrder(),
  resolutionCommits: [],
  ledgerCommits: [],
  declineEvents: {},
  bounceCounts: {},
  ledger: [],
  openDispatches: [],
  idleDispatches: new Map(),
  ledgerSpentUsd: 0,
  taskFiles: new Map(),
  inFlightSurfaces: [],
  estimates: { orchestrator: 0.5, analyst: 2, architect: 5, implementer: 8, reviewer: 4, verifier: 6, ops: 2 },
  enforceBudget: true,
  ...over,
})

const taskFile = (id: string, over: Partial<TaskFileInfo> = {}): [string, TaskFileInfo] => [
  id,
  { path: `tasks/${id}.yaml`, surface: [`src/${id}.py`], dependsOn: [], ...over },
]

/** A dispatch that closed ok — what rule DL counts when nothing landed after it (#343). */
const closedOk = (role: string, task: string | null, at: string): LedgerEntry => ({
  at,
  role,
  task,
  round: 1,
  adapter: 'claude-code',
  model: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: 2,
  failed: false,
  refused: false,
  engine: null,
})

/**
 * The real counting rule from observe, so a DL test exercises what the engine
 * computes rather than a hand-written map. Everything the count reads is
 * optional; what is left out simply has no landing to be newer than.
 */
const idle = (over: Partial<Parameters<typeof idleDispatchCounts>[0]> = {}) =>
  idleDispatchCounts({ ledger: [], reviews: [], taskFiles: new Map(), lastTouched: {}, escalations: [], ...over })

/** A resolved escalation, as the record spells one. */
const resolved = (reason: string, at: string, disposition: Disposition | null = null) => ({
  at: null,
  from_role: 'orchestrator',
  reason,
  resolved: true,
  resolved_by: 'op',
  resolved_at: at,
  resolution: 'looked; carry on',
  disposition,
})

/** A closed-failed implementer ledger entry — the D20 timestamp anchor. */
const failedAttempt = (task: string, at: string): LedgerEntry => ({
  at,
  role: 'implementer',
  task,
  round: 1,
  adapter: 'claude-code',
  model: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: 8,
  failed: true,
  refused: false,
  engine: null,
})

describe('the derivation table, one rule per row', () => {
  it('D0 — malformed state rests; a human owns it', () => {
    const a = deriveAction(obs({ state: null, stateError: 'not yaml' }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D0' })
  })

  it('D1 — done rests', () => {
    expect(deriveAction(obs({ state: state({ phase: 'done' }) }))).toMatchObject({ kind: 'rest', rule: 'D1' })
  })

  it('D1 — a closed run rests, and the rest names the disposition (#200)', () => {
    const s = state({
      phase: 'closed',
      closure: { as: 'already-delivered', by: 'Nathan Carter', at: '2026-08-01T00:00:00Z', reason: 'shipped elsewhere' },
    } as Partial<RunState>)
    const a = deriveAction(obs({ state: s }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D1' })
    expect(a.why).toContain('already-delivered')
  })

  it('D1 — a closed run rests ahead of the escalation and round-cap rules, not after them (#200)', () => {
    // The same facts on a live run would escalate (D3) or cap (D4). A closure
    // answers them wholesale, so neither may fire on a run a human has ended.
    const s = state({
      phase: 'closed',
      closure: { as: 'abandoned', by: 'Nathan Carter', at: '2026-08-01T00:00:00Z', reason: 'walked away' },
      escalations: [{ at: null, from_role: 'orchestrator', reason: 'failed twice', resolved: false, resolved_by: null, resolved_at: null, resolution: null, disposition: null }],
      tasks: [{ id: '01-core', status: 'in-review', review_rounds: 5 }],
    } as Partial<RunState>)
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'rest', rule: 'D1' })
  })

  it('D21 — closed is a legal phase in every profile, so it never trips the profile invariant (#200)', () => {
    for (const profile of PROFILES) {
      const s = state({
        phase: 'closed',
        profile,
        closure: { as: 'obsolete', by: 'Nathan Carter', at: '2026-08-01T00:00:00Z', reason: 'need went away' },
      } as Partial<RunState>)
      expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'rest', rule: 'D1' })
    }
  })

  it('D2 — paused rests; resume is a human decision', () => {
    const a = deriveAction(obs({ state: state({ phase: 'paused', paused_reason: 'budget-exhausted' }) }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D2' })
  })

  it('D2 — an approve-and-hold rests even though the signed gate would otherwise converge forward (D5) and dispatch (D6)', () => {
    const s = state({
      phase: 'paused',
      paused_reason: 'awaiting design-candidate selection',
      gates: { G0: gate({ approved: true, by: 'Operator', at: '2026-07-15T00:00:00Z' }), G1: gate(), G2: gate(), G3: gate() },
    })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'spec.md'] }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D2' })
  })

  it('D2 — a freshly staged run (plan.md scaffold: paused/staged, all profile gates undecided, no tasks) rests for every profile (AC5.3)', () => {
    for (const profile of PROFILES) {
      const s = state({ phase: 'paused', paused_reason: STAGED_REASON, profile, tasks: [] })
      const a = deriveAction(obs({ state: s }))
      expect(a.kind).not.toBe('dispatch')
      expect(a.kind).not.toBe('escalate')
      expect(a).toMatchObject({ kind: 'rest', rule: 'D2' })
    }
  })

  it('D3 — unresolved escalation rests', () => {
    const s = state({
      escalations: [{ at: null, from_role: 'verifier', reason: 'x', resolved: false, resolved_by: null, resolved_at: null, resolution: null, disposition: null }],
    })
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'rest', rule: 'D3' })
  })

  it('D4 — round cap escalates and pauses', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }] })
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })
  })

  it('D4 — an approve on the cap round is convergence, not a round-cap failure; D16 records it', () => {
    // The fleetview-intake regression: rounds bookkeeping lands one tick before
    // the status transition, so the task sits at rounds == cap, in-review, with
    // the approve verdict already delivered.
    const s = state({ phase: 'implement', tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'approve'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'record', rule: 'D16', updates: [{ field: 'task-status', task: '01-x', to: 'review-approved' }] })
  })

  it('D4 — the approve exemption is narrow: a request-changes at the cap still escalates', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'request-changes'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })
  })

  it('D4 — a resolution newer than the latest verdict grants another round: D4 stands down and the loop dispatches (#342)', () => {
    // Before #342 nothing a human could decide changed either fact D4 reads,
    // so resolve-and-resume landed straight back on the same pause. The
    // escalation's own resolution is now the input, exactly as D17 and D20
    // read theirs.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }],
      escalations: [resolved(roundCapReason('01-x', 3), '1970-01-01T00:10:00.000Z')], // epoch 600 > lastTouched 500
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'request-changes'], lastTouched: 500 }],
      }),
    )
    expect(a.kind).toBe('dispatch')
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'implementer', task: '01-x', round: 4 })
  })

  it('D4 — a resolution older than the latest verdict is a stale acknowledgment: the cap still escalates (#342)', () => {
    // The next verdict past the cap is a newer fact than the resolution that
    // granted the round it came from, so the engine asks again — one human
    // decision per extra round, which is the point of the cap.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-x', status: 'in-review', review_rounds: 4 }],
      escalations: [resolved(roundCapReason('01-x', 3), '1970-01-01T00:10:00.000Z')], // epoch 600 < lastTouched 900
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'request-changes', 'request-changes'], lastTouched: 900 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })
  })

  it('D4 — a disposition on the granting resolution routes the extra round, through D17’s own helper (#342)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }],
      escalations: [resolved(roundCapReason('01-x', 3), '1970-01-01T00:10:00.000Z', 're-review')],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'request-changes'], lastTouched: 500 }],
        lastNonStateCommit: null, // the #188 guard would rest; the disposition is the human override
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D4' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-x', round: 4 })
  })

  it('D4 — disposition return-to-implement on the granting resolution sends the round to the implementer with the report (#342)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }],
      escalations: [resolved(roundCapReason('01-x', 3), '1970-01-01T00:10:00.000Z', 'return-to-implement')],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-x')]),
        reviews: [{ path: 'review-01.md', task: '01-x', verdicts: ['request-changes', 'request-changes', 'request-changes'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D4' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({
      role: 'implementer',
      task: '01-x',
      round: 4,
      bounce: { kind: 'review', report: 'review-01.md' },
    })
  })

  it('D5 — gate approved but phase not advanced converges via bookkeeping', () => {
    const s = state({ phase: 'spec', gates: { G0: gate({ approved: true, by: 'op' }), G1: gate(), G2: gate(), G3: gate() } })
    const a = deriveAction(obs({ state: s }))
    expect(a).toMatchObject({ kind: 'record', rule: 'D5', updates: [{ field: 'phase', to: 'plan' }] })
  })

  it('D6 — producer artifact absent dispatches the producing role', () => {
    const a = deriveAction(obs({}))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.role).toBe('analyst')
  })

  it('D7 — malformed artifact bounces, naming the missing sections', () => {
    const a = deriveAction(obs({ artifacts: ['intent-brief.md', 'spec.md'], validations: { 'spec.md': bad('Requirements', 'Assumptions') } }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D7' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.bounce).toMatchObject({ kind: 'malformed', missing: ['Requirements', 'Assumptions'] })
  })

  it('D8 — the same artifact bounced twice is a contract dispute', () => {
    const a = deriveAction(
      obs({ artifacts: ['intent-brief.md', 'spec.md'], validations: { 'spec.md': bad('Requirements') }, bounceCounts: { 'spec.md': 2 } }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D8', pause: 'escalation' })
  })

  it('D9 — a decline newer than the artifact re-dispatches the producer with the notes', () => {
    const a = deriveAction(
      obs({
        artifacts: ['intent-brief.md', 'spec.md'],
        validations: { 'spec.md': ok },
        lastTouched: { 'spec.md': 100 },
        declineEvents: { G0: { at: 200, notes: 'requirement R2 is wrong', redone: false } },
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D9' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.bounce).toMatchObject({ kind: 'gate-declined', gate: 'G0', notes: 'requirement R2 is wrong' })
  })

  it('D9 does not fire once the producer has redone the artifact', () => {
    const a = deriveAction(
      obs({
        artifacts: ['intent-brief.md', 'spec.md'],
        validations: { 'spec.md': ok },
        lastTouched: { 'spec.md': 300 },
        declineEvents: { G0: { at: 200, notes: 'stale decline', redone: true } },
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('D10 — a well-formed packet with the gate undecided rests', () => {
    const a = deriveAction(obs({ artifacts: ['intent-brief.md', 'spec.md'], validations: { 'spec.md': ok } }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('plan phase — plan.md without tasks still needs the architect', () => {
    const s = state({ phase: 'plan', gates: { G0: gate({ approved: true, by: 'op' }), G1: gate(), G2: gate(), G3: gate() } })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'spec.md', 'plan.md'], validations: { 'plan.md': ok } }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.role).toBe('architect')
  })

  it('D11 — parallel implementers launch as one set, disjoint surfaces only', () => {
    const s = state({
      phase: 'implement',
      gates: { G0: gate({ approved: true, by: 'op' }), G1: gate({ approved: true, by: 'op' }), G2: gate(), G3: gate() },
      tasks: [
        { id: '01-a', status: 'pending', review_rounds: 0 },
        { id: '02-b', status: 'pending', review_rounds: 0 },
        { id: '03-c', status: 'pending', review_rounds: 0 },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        artifacts: ['spec.md', 'plan.md', 'tasks/01-a.yaml', 'tasks/02-b.yaml', 'tasks/03-c.yaml'],
        taskFiles: new Map([
          taskFile('01-a', { surface: ['src/a.py'] }),
          taskFile('02-b', { surface: ['src/b.py'] }),
          taskFile('03-c', { surface: ['src/a.py'] }), // overlaps 01-a → serialized
        ]),
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(a.kind === 'dispatch' && a.dispatches.map((d) => d.task)).toEqual(['01-a', '02-b'])
  })

  it('D11 respects depends_on: a task with an incomplete dependency waits', () => {
    const s = state({
      phase: 'implement',
      tasks: [
        // `dispatched`, not `in-progress`: the engine writes the former, and
        // since #350 the latter with no ledger entry behind it is a D25
        // bookkeeping transition rather than an in-flight rest.
        { id: '01-a', status: 'dispatched', review_rounds: 0 },
        { id: '02-b', status: 'pending', review_rounds: 0 },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a'), taskFile('02-b', { dependsOn: ['01-a'], surface: ['src/b.py'] })]),
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D12' })
  })

  it('D12 — a dispatched task is in flight; the run rests', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'dispatched', review_rounds: 0 }] })
    expect(deriveAction(obs({ state: s, taskFiles: new Map([taskFile('01-a')]) }))).toMatchObject({ kind: 'rest', rule: 'D12' })
  })

  it('D12 — an open ledger dispatch rests the producing phase', () => {
    const a = deriveAction(obs({ openDispatches: [{ role: 'analyst', task: null, at: '2026-07-10T00:00:00Z' }] }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D12' })
  })

  it('D13 — in-review with no verdict for the current round dispatches the reviewer', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 0 }] })
    const a = deriveAction(obs({ state: s, taskFiles: new Map([taskFile('01-a')]) }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 1 })
  })

  it('D14 — request-changes with no implementer response dispatches the implementer with the report', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['request-changes'], lastTouched: 500 }],
        lastTouched: { 'tasks/01-a.yaml': 400 },
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({
      role: 'implementer',
      task: '01-a',
      round: 2,
      bounce: { kind: 'review', report: 'review-01.md' },
    })
  })

  it('D15 — request-changes with a newer implementer response dispatches the verify round', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['request-changes'], lastTouched: 500 }],
        lastTouched: { 'tasks/01-a.yaml': 600 },
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D16 — an approve verdict records review-approved', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['approve'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'record', rule: 'D16', updates: [{ field: 'task-status', task: '01-a', to: 'review-approved' }] })
  })

  it('D17 — a reviewer escalate verdict escalates and pauses', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D17', pause: 'escalation' })
  })

  it('D17 — a resolution older than the escalate verdict still escalates (the verdict is the newer fact)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:05:00.000Z', // epoch 300 < lastTouched 500
          resolution: 'stale resolution from an earlier round',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D17', pause: 'escalation' })
  })

  it('D17 — a resolution newer than the escalate verdict, with a code commit landed since, dispatches the re-review round instead of re-escalating', () => {
    // The fleetview-design regression: resolve+resume re-escalated identically
    // every tick because the escalate verdict stands in an append-only artifact.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
          resolution: 'condition repaired on the branch',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: 700, // a real commit landed after the verdict
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 — a resolution newer than the escalate verdict but no commit has landed since rests instead of dispatching (#188 zero-delta guard)', () => {
    // The runner-agent regression: nothing checked that anything actually
    // changed in the tree, so a resolve+resume with no fix on the branch burned
    // a capped review round against a byte-identical range.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
          resolution: 'acknowledged, but nothing landed yet',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: null, // no non-state.yaml commit at all
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D17' })
    expect((a as { why: string }).why).toMatch(/nothing has landed since the verdict/)
  })

  it('D17 — a plan.md-only commit after the verdict counts as a landed delta (docs-side remedies count, #188)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
          resolution: 'plan corrected to match the intended surface',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: 700, // e.g. a plan.md or tasks/ edit landed after the verdict
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 — a state.yaml-only commit after the verdict never counts as a landed delta (#188)', () => {
    // lastNonStateCommit is derived excluding state.yaml, so a resolution
    // commit that only edits state.yaml (marking the escalation resolved)
    // must not, by itself, look newer than the verdict — this observation
    // shape (older-than-verdict, as lastTouched excludes state.yaml history
    // entirely) is what a real repo produces in that case.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
          resolution: 'acknowledged only',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: 300, // stale: predates the escalate verdict itself
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D17' })
  })

  it('D17 — disposition re-review dispatches immediately, bypassing the #188 zero-delta guard (#189)', () => {
    // The human's disposition choice IS the judgment the guard exists to
    // stand in for when no one has looked — no non-state.yaml commit at all,
    // yet the re-review still dispatches.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
          resolution: 'condition confirmed addressed; verify now',
          disposition: 're-review',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: null, // no commit has landed at all — the guard would normally rest
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 — disposition return-to-implement with no implementer response yet dispatches the implementer with the review report (#189)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600
          resolution: 'send back to the implementer first',
          disposition: 'return-to-implement',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastTouched: { 'tasks/01-a.yaml': 400 }, // predates the resolution — not yet responded
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({
      role: 'implementer',
      task: '01-a',
      round: 2,
      bounce: { kind: 'review', report: 'review-01.md' },
    })
  })

  it('D17 — disposition return-to-implement with a task-file touch newer than the resolution dispatches the verify round (#189)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600
          resolution: 'send back to the implementer first',
          disposition: 'return-to-implement',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastTouched: { 'tasks/01-a.yaml': 700 }, // newer than the resolution — implementer responded
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 — with two matching resolutions, the LATEST resolution disposition governs the routing (#189)', () => {
    // An earlier acknowledgment-only resolution (no disposition, so the
    // legacy guarded path) is superseded by a later resolution that names a
    // disposition — the later resolution is what actually unblocks the run.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 — earlier acknowledgment
          resolution: 'acknowledged only, no disposition yet',
          disposition: null,
        },
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:15:00.000Z', // epoch 900 — the later, governing resolution
          resolution: 'condition confirmed addressed; verify now',
          disposition: 're-review',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastNonStateCommit: null, // the legacy guard on the first resolution would rest; the later re-review disposition overrides it
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D13' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D22 — disposition re-plan with no amendment landed yet dispatches the architect in amendment mode (#190)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600
          resolution: 'this is a decomposition defect — send to the architect',
          disposition: 're-plan',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastTouched: {}, // neither plan.md nor the task file has moved since the resolution
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D22' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({
      role: 'architect',
      task: null,
      round: null,
      bounce: { kind: 'amendment', report: 'review-01.md', note: 'this is a decomposition defect — send to the architect', task: '01-a' },
    })
  })

  it('D12 — disposition re-plan with an architect already dispatched rests instead of double-dispatching (#190)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z',
          resolution: 'send to the architect',
          disposition: 're-plan',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        openDispatches: [{ role: 'architect', task: null, at: '2026-01-01T00:00:00.000Z' }],
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D12' })
  })

  it('D23 — disposition re-plan with plan.md touched newer than the resolution raises a fresh acknowledgment escalation (#190)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600
          resolution: 'send to the architect',
          disposition: 're-plan',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastTouched: { 'plan.md': 700 }, // newer than the resolution — the amendment landed
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D23', pause: 'escalation' })
    expect((a as { reason: string }).reason).toMatch(/task 01-a/)
  })

  it('D23 — a tasks/*.yaml touch (not just plan.md) newer than the resolution also counts as the amendment landing (#190)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [
        {
          at: null,
          from_role: 'orchestrator',
          reason: 'reviewer escalated task 01-a — see review-01.md',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z',
          resolution: 'widen the surface',
          disposition: 're-plan',
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
        lastTouched: { 'tasks/01-a.yaml': 700 }, // the task file itself was widened
      }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D23', pause: 'escalation' })
  })

  it('end-to-end: escalate → resolve(re-plan) → architect dispatch → amendment lands → ack escalation → resolve(return-to-implement) → implementer dispatch (#190)', () => {
    const baseState = {
      phase: 'implement' as const,
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
    }
    const review: ReviewInfo = { path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }
    const taskFiles = new Map([taskFile('01-a')])

    // 1. Reviewer escalate verdict, unresolved — escalate and pause.
    const step1 = deriveAction(obs({ state: state(baseState), taskFiles, reviews: [review] }))
    expect(step1).toMatchObject({ kind: 'escalate', rule: 'D17', pause: 'escalation' })

    // 2. Human resolves with disposition re-plan — dispatch the architect in amendment mode.
    const rePlanResolution = {
      at: null,
      from_role: 'orchestrator',
      reason: 'reviewer escalated task 01-a — see review-01.md',
      resolved: true,
      resolved_by: 'op',
      resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600
      resolution: 'decomposition defect — send to the architect',
      disposition: 're-plan' as const,
    }
    const step2 = deriveAction(
      obs({ state: state({ ...baseState, escalations: [rePlanResolution] }), taskFiles, reviews: [review] }),
    )
    expect(step2).toMatchObject({ kind: 'dispatch', rule: 'D22' })
    expect(step2.kind === 'dispatch' && step2.dispatches[0]).toMatchObject({
      role: 'architect',
      bounce: { kind: 'amendment', report: 'review-01.md', task: '01-a' },
    })

    // 3. Architect dispatch in flight — rest (D12 shape).
    const step3 = deriveAction(
      obs({
        state: state({ ...baseState, escalations: [rePlanResolution] }),
        taskFiles,
        reviews: [review],
        openDispatches: [{ role: 'architect', task: null, at: '2026-01-01T00:00:00.000Z' }],
      }),
    )
    expect(step3).toMatchObject({ kind: 'rest', rule: 'D12' })

    // 4. Amendment lands (plan.md widened past the resolution) — raise a fresh escalation, pause.
    const step4 = deriveAction(
      obs({
        state: state({ ...baseState, escalations: [rePlanResolution] }),
        taskFiles,
        reviews: [review],
        lastTouched: { 'plan.md': 700 },
      }),
    )
    expect(step4).toMatchObject({ kind: 'escalate', rule: 'D23', pause: 'escalation' })
    const ackReason = (step4 as { reason: string }).reason
    expect(ackReason).toMatch(/task 01-a/)

    // 5. Human acknowledges with return-to-implement — the LATEST matching
    //    resolution now governs, routing through #189's machinery unchanged.
    const ackResolution = {
      at: null,
      from_role: 'orchestrator',
      reason: ackReason,
      resolved: true,
      resolved_by: 'op',
      resolved_at: '1970-01-01T00:13:20.000Z', // epoch 800 — after the re-plan resolution
      resolution: 'amendment acknowledged — return to the implementer',
      disposition: 'return-to-implement' as const,
    }
    const step5 = deriveAction(
      obs({
        state: state({ ...baseState, escalations: [rePlanResolution, ackResolution] }),
        taskFiles,
        reviews: [review],
        lastTouched: { 'plan.md': 700 }, // the amendment stays landed; no implementer response yet
      }),
    )
    expect(step5).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(step5.kind === 'dispatch' && step5.dispatches[0]).toMatchObject({
      role: 'implementer',
      task: '01-a',
      round: 2,
      bounce: { kind: 'review', report: 'review-01.md' },
    })
  })

  it('D20 — a failed task whose naming escalation resolved after the last failure returns to pending', () => {
    // The #147 recovery: the engine froze the task at `failed` when its
    // implementer failed twice; the resolution is the unblocking input.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'failed', review_rounds: 0 }],
      escalations: [
        {
          at: '1970-01-01T00:06:00.000Z',
          from_role: 'orchestrator',
          reason: 'implementer (01-a) failed twice: model outage',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z', // after the 00:05 failure below
          resolution: 'outage over — retry',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        ledger: [failedAttempt('01-a', '1970-01-01T00:03:00.000Z'), failedAttempt('01-a', '1970-01-01T00:05:00.000Z')],
      }),
    )
    expect(a).toMatchObject({ kind: 'record', rule: 'D20', updates: [{ field: 'task-status', task: '01-a', to: 'pending' }] })
  })

  it('D20 — a resolution older than the last failure rests frozen (it acknowledged an earlier escalation)', () => {
    // The re-fire guard: after a D20 recovery the old resolution stays in
    // state; a fresh pair of failures must not be unblocked by it.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'failed', review_rounds: 0 }],
      escalations: [
        {
          at: '1970-01-01T00:02:00.000Z',
          from_role: 'orchestrator',
          reason: 'implementer (01-a) failed twice: model outage',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:04:00.000Z', // before the 00:05 failure below
          resolution: 'unblocked',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        ledger: [failedAttempt('01-a', '1970-01-01T00:05:00.000Z')],
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D20' })
  })

  it('D20 — a resolution naming a different task rests frozen', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'failed', review_rounds: 0 }],
      escalations: [
        {
          at: '1970-01-01T00:06:00.000Z',
          from_role: 'orchestrator',
          reason: 'implementer (02-b) failed twice: model outage',
          resolved: true,
          resolved_by: 'op',
          resolved_at: '1970-01-01T00:10:00.000Z',
          resolution: 'unblocked',
          disposition: null,
        },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        ledger: [failedAttempt('01-a', '1970-01-01T00:05:00.000Z')],
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D20' })
  })

  it('D20 — a frozen task does not block other tasks from dispatching', () => {
    const s = state({
      phase: 'implement',
      tasks: [
        { id: '01-a', status: 'failed', review_rounds: 0 },
        { id: '02-b', status: 'pending', review_rounds: 0 },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a'), taskFile('02-b')]),
        ledger: [failedAttempt('01-a', '1970-01-01T00:05:00.000Z')],
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D11' })
    expect(a.kind === 'dispatch' && a.dispatches).toHaveLength(1)
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'implementer', task: '02-b' })
  })

  it('D19 — implement phase with empty state.tasks seeds it from the task files', () => {
    const s = state({ phase: 'implement', tasks: [] })
    const a = deriveAction(
      obs({
        state: s,
        artifacts: ['spec.md', 'plan.md', 'tasks/01-a.yaml', 'tasks/02-b.yaml'],
        taskFiles: new Map([taskFile('01-a'), taskFile('02-b')]),
      }),
    )
    expect(a).toMatchObject({ kind: 'record', rule: 'D19', updates: [{ field: 'seed-tasks', ids: ['01-a', '02-b'] }] })
  })

  it('D18 — all tasks review-complete with no verification dispatches the verifier', () => {
    const s = state({
      phase: 'implement',
      tasks: [
        { id: '01-a', status: 'review-approved', review_rounds: 1 },
        { id: '02-b', status: 'review-approved', review_rounds: 1 },
      ],
    })
    const a = deriveAction(obs({ state: s, artifacts: ['spec.md', 'plan.md'] }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.role).toBe('verifier')
  })

  it('G2 rests once the verification report has landed well-formed', () => {
    const s = state({ phase: 'integrate', tasks: [{ id: '01-a', status: 'verified', review_rounds: 1 }] })
    const a = deriveAction(
      obs({
        state: s,
        artifacts: ['spec.md', 'plan.md', 'verification-report.md'],
        validations: { 'verification-report.md': { contract: 'verification-report.md', ok: true, missing: [], notes: [] } },
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('release phase — no release plan dispatches ops; a well-formed one rests at G3', () => {
    const s = state({ phase: 'release' })
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    const rested = deriveAction(
      obs({
        state: s,
        artifacts: ['release-plan.md'],
        validations: { 'release-plan.md': { contract: null, ok: true, missing: [], notes: [] } },
      }),
    )
    expect(rested).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('DL — a producer that closed ok LANDING_CAP times with its artifact still absent escalates instead of dispatching again (#343)', () => {
    const ledger = [closedOk('analyst', null, '1970-01-01T00:01:00.000Z'), closedOk('analyst', null, '1970-01-01T00:02:00.000Z')]
    const a = deriveAction(obs({ ledger, idleDispatches: idle({ ledger }) }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DL', pause: 'escalation' })
    expect(a.kind === 'escalate' && a.reason).toBe(`analyst returned ${LANDING_CAP}× without landing spec.md — a human should look`)
  })

  it('DL — one closed-ok dispatch that landed nothing is under the cap; the producer is dispatched again (#343)', () => {
    const ledger = [closedOk('analyst', null, '1970-01-01T00:01:00.000Z')]
    expect(deriveAction(obs({ ledger, idleDispatches: idle({ ledger }) }))).toMatchObject({ kind: 'dispatch', rule: 'D6' })
  })

  it('DL — a dispatch that landed its artifact does not count: the entry predates the commit (#343)', () => {
    // Every dispatch opens its ledger entry before the agent runs, so a
    // producer that committed leaves an entry older than what it landed.
    const ledger = [closedOk('analyst', null, '1970-01-01T00:01:00.000Z'), closedOk('analyst', null, '1970-01-01T00:02:00.000Z')]
    const a = deriveAction(
      obs({
        ledger,
        lastTouched: { 'spec.md': 200 }, // epoch 200s — newer than both entries
        idleDispatches: idle({ ledger, lastTouched: { 'spec.md': 200 } }),
      }),
    )
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
  })

  it('DL — a reviewer that delivers no verdict is capped the same way (#343)', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 0 }] })
    const ledger = [closedOk('reviewer', '01-a', '1970-01-01T00:01:00.000Z'), closedOk('reviewer', '01-a', '1970-01-01T00:02:00.000Z')]
    const a = deriveAction(obs({ state: s, taskFiles: new Map([taskFile('01-a')]), ledger, idleDispatches: idle({ ledger }) }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DL', pause: 'escalation' })
    // The task is named `on <id>`, never `task <id>` or `(<id>)`: D17 and D20
    // key on those, and an escalation two rules both claim is a loop.
    expect(a.kind === 'escalate' && a.reason).toContain('reviewer on 01-a returned')
    expect(a.kind === 'escalate' && a.reason).not.toContain('task 01-a')
    expect(a.kind === 'escalate' && a.reason).not.toContain('(01-a)')
  })

  it('DL — a round whose review answered it resets the implementer count: the loop moved, whatever the work item says (#343)', () => {
    // The dupefind shape, which every v0 run has: the implementer landed code
    // and no response note. The code is outside the run directory and the
    // observation cannot see it — but the reviewer's answer to that round can
    // only exist because the round produced something, so it counts.
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const ledger = [closedOk('implementer', '01-a', '1970-01-01T00:01:00.000Z'), closedOk('implementer', '01-a', '1970-01-01T00:02:00.000Z')]
    const facts = {
      ledger,
      taskFiles: new Map([taskFile('01-a')]),
      reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['request-changes'], lastTouched: 150 }] as ReviewInfo[],
      lastTouched: { 'tasks/01-a.yaml': 10, 'review-01.md': 150 }, // the round-2 verdict, newer than both dispatches
    }
    const a = deriveAction(obs({ state: s, ...facts, idleDispatches: idle(facts) }))
    expect(a.kind).toBe('dispatch')
  })

  it('DL — an implementer that never touches its work item is capped on the re-dispatch path (#343)', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }] })
    const ledger = [closedOk('implementer', '01-a', '1970-01-01T00:01:00.000Z'), closedOk('implementer', '01-a', '1970-01-01T00:02:00.000Z')]
    // Both entries are newer than everything the task's record holds — neither
    // a response note nor a review of the round landed after either dispatch.
    const facts = {
      ledger,
      taskFiles: new Map([taskFile('01-a')]),
      reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['request-changes'], lastTouched: 20 }] as ReviewInfo[],
      lastTouched: { 'tasks/01-a.yaml': 10, 'review-01.md': 20 },
    }
    const a = deriveAction(obs({ state: s, ...facts, idleDispatches: idle(facts) }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DL', pause: 'escalation' })
    expect(a.kind === 'escalate' && a.reason).toContain('without landing tasks/01-a.yaml')
  })

  it('DL — resolving the landing escalation resets the count, so resume does not walk straight back into the cap (#343)', () => {
    const ledger = [closedOk('analyst', null, '1970-01-01T00:01:00.000Z'), closedOk('analyst', null, '1970-01-01T00:02:00.000Z')]
    const escalations = [resolved('analyst returned 2× without landing spec.md — a human should look', '1970-01-01T00:03:00.000Z')]
    const s = state({ escalations } as Partial<RunState>)
    const a = deriveAction(obs({ state: s, ledger, idleDispatches: idle({ ledger, escalations: s.escalations }) }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
  })

  it('D25 — in-progress with no open dispatch behind it goes back to pending (#350)', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-progress', review_rounds: 0 }] })
    const a = deriveAction(obs({ state: s, taskFiles: new Map([taskFile('01-a')]) }))
    expect(a).toMatchObject({ kind: 'record', rule: 'D25', updates: [{ field: 'task-status', task: '01-a', to: 'pending' }] })
  })

  it('D25 — in-progress WITH an open dispatch is still in flight; the task rests (#350)', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-a', status: 'in-progress', review_rounds: 0 }] })
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        openDispatches: [{ role: 'implementer', task: '01-a', at: '1970-01-01T00:01:00.000Z' }],
      }),
    )
    expect(a).toMatchObject({ kind: 'rest', rule: 'D12' })
  })

  it('DB — a dispatch that projects past the cap pauses budget-exhausted instead', () => {
    const s = state({ budget: { cost_limit_usd: 10, cost_spent_usd: 0 } })
    const a = deriveAction(obs({ state: s, ledgerSpentUsd: 9 })) // + analyst estimate 2 → 11 > 10
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DB', pause: 'budget-exhausted' })
  })

  it('DB counts open dispatches at their estimate — conservative by design', () => {
    const s = state({
      phase: 'implement',
      budget: { cost_limit_usd: 10, cost_spent_usd: 0 },
      tasks: [
        { id: '01-a', status: 'dispatched', review_rounds: 0 },
        { id: '02-b', status: 'pending', review_rounds: 0 },
      ],
    })
    const a = deriveAction(
      obs({
        state: s,
        ledgerSpentUsd: 0,
        openDispatches: [{ role: 'implementer', task: '01-a', at: null }],
        taskFiles: new Map([taskFile('01-a', { surface: ['src/a.py'] }), taskFile('02-b', { surface: ['src/b.py'] })]),
      }),
    ) // open 8 + new 8 = 16 > 10
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DB', pause: 'budget-exhausted' })
  })

  it('DB is skipped when enforcement is off (#109) — the same over-cap projection dispatches', () => {
    const s = state({ budget: { cost_limit_usd: 10, cost_spent_usd: 0 } })
    const a = deriveAction(obs({ state: s, ledgerSpentUsd: 9, enforceBudget: false })) // same numbers as the DB pause above
    expect(a).toMatchObject({ kind: 'dispatch' })
  })

  it('a role with no registry estimate is costed at the conservative default', () => {
    const s = state({ budget: { cost_limit_usd: 4, cost_spent_usd: 0 } })
    const a = deriveAction(obs({ state: s, estimates: {} }))
    expect(DEFAULT_ESTIMATE_USD).toBeGreaterThan(4)
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DB' })
  })
})

// Run profiles (DESIGN.md §4.1): the same table, parameterized by state.profile.
describe('profile-parameterized derivation', () => {
  const patchState = (over: Partial<RunState> = {}): RunState => state({ profile: 'patch', phase: 'plan', ...over })

  it('D21 — a decided gate outside the profile escalates: profiles never downgrade mid-run', () => {
    const s = patchState({
      gates: { G0: gate({ approved: true, by: 'Operator', at: '2026-07-01T00:00:00Z' }), G1: gate(), G2: gate(), G3: gate() },
    })
    const a = deriveAction(obs({ state: s }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D21', pause: 'escalation' })
    expect((a as { reason: string }).reason).toMatch(/never downgrade/)
  })

  it('D21 — a phase outside the profile sequence escalates (patch has no spec phase)', () => {
    const a = deriveAction(obs({ state: patchState({ phase: 'spec' }) }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D21' })
  })

  it('D21 — a patch run with no work item escalates: the human authors it at init', () => {
    const a = deriveAction(obs({ state: patchState(), artifacts: ['intent-brief.md'] }))
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D21' })
    expect((a as { reason: string }).reason).toMatch(/work item/)
  })

  it('patch plan phase rests with the packet on the table — no architect exists to dispatch', () => {
    const a = deriveAction(obs({ state: patchState(), artifacts: ['intent-brief.md', 'tasks/01-fix.yaml'] }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('post-arm patch — the scaffolded tasks/01-<slug>.yaml stub is load-bearing: rests at D10, never the D21 no-work-item escalation (AC4.2)', () => {
    const a = deriveAction(obs({ state: patchState(), artifacts: ['intent-brief.md', 'tasks/01-toy.yaml'] }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('D5 patch — G1 approved advances to implement, as in full', () => {
    const s = patchState({
      gates: { G0: gate(), G1: gate({ approved: true, by: 'Operator', at: '2026-07-01T00:00:00Z' }), G2: gate(), G3: gate() },
    })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'tasks/01-fix.yaml'] }))
    expect(a).toMatchObject({ kind: 'record', rule: 'D5', updates: [{ field: 'phase', to: 'implement' }] })
  })

  it('D5 reduced profiles — G2 approved advances to done, not release (the merge is the release)', () => {
    for (const profile of ['patch', 'standard'] as const) {
      const s = state({
        profile,
        phase: 'integrate',
        gates: {
          G0: gate({ approved: profile === 'standard', by: profile === 'standard' ? 'Operator' : null }),
          G1: gate({ approved: true, by: 'Operator' }),
          G2: gate({ approved: true, by: 'Operator', at: '2026-07-02T00:00:00Z' }),
          G3: gate(),
        },
        tasks: [{ id: '01-fix', status: 'done', review_rounds: 1 }],
      })
      const a = deriveAction(obs({ state: s }))
      expect(a).toMatchObject({ kind: 'record', rule: 'D5', updates: [{ field: 'phase', to: 'done' }] })
    }
  })

  it('patch implement tail — all tasks review-complete rests; no verifier is ever dispatched', () => {
    const s = patchState({
      phase: 'implement',
      gates: { G0: gate(), G1: gate({ approved: true, by: 'Operator' }), G2: gate(), G3: gate() },
      tasks: [{ id: '01-fix', status: 'review-approved', review_rounds: 1 }],
    })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'tasks/01-fix.yaml', 'review-01.md'] }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('standard implement tail still dispatches the verifier — only patch drops it', () => {
    const s = state({
      profile: 'standard',
      phase: 'implement',
      gates: { G0: gate({ approved: true, by: 'Operator' }), G1: gate({ approved: true, by: 'Operator' }), G2: gate(), G3: gate() },
      tasks: [{ id: '01-fix', status: 'review-approved', review_rounds: 1 }],
    })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'spec.md', 'plan.md', 'tasks/01-fix.yaml', 'review-01.md'] }))
    expect(a).toMatchObject({ kind: 'dispatch', dispatches: [{ role: 'verifier' }] })
  })

  it('upgrade backfill — a patch run upgraded to standard derives the analyst dispatch for the missing spec', () => {
    // The human edited profile: patch → standard and resumed into spec (the
    // stateless reconciler needs no special upgrade handling: the missing
    // artifact under the heavier profile derives as an ordinary D6 dispatch).
    const s = state({
      profile: 'standard',
      phase: 'spec',
      gates: { G0: gate(), G1: gate({ approved: true, by: 'Operator' }), G2: gate(), G3: gate() },
    })
    const a = deriveAction(obs({ state: s, artifacts: ['intent-brief.md', 'tasks/01-fix.yaml'] }))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6', dispatches: [{ role: 'analyst' }] })
  })
})

describe('D24 — the verifier\'s escalation channel (#152)', () => {
  const verified = () =>
    obs({
      state: state({ phase: 'implement', tasks: [{ id: '01-a', status: 'review-approved', review_rounds: 1 }] }),
      taskFiles: new Map([taskFile('01-a')]),
      artifacts: ['spec.md', 'plan.md', 'tasks/01-a.yaml', 'review-01.md', 'verification-report.md'],
      validations: { 'verification-report.md': { contract: 'verification-report.md', ok: true, missing: [], notes: [] } },
    })

  it('an escalate verdict escalates and pauses, naming the report', () => {
    const o = verified()
    o.verification = { verdict: 'escalate', raw: 'escalate', lastTouched: 500 }
    expect(deriveAction(o)).toMatchObject({ kind: 'escalate', rule: 'D24', pause: 'escalation', reason: VERIFIER_ESCALATION_REASON })
  })

  it('a resolution newer than the report returns the packet to the table (D10), failed rows and all', () => {
    const o = verified()
    o.verification = { verdict: 'escalate', raw: 'escalate', lastTouched: 500 }
    o.state!.escalations = [
      {
        at: null,
        from_role: 'orchestrator',
        reason: VERIFIER_ESCALATION_REASON,
        resolved: true,
        resolved_by: 'op',
        resolved_at: '1970-01-01T00:10:00.000Z', // epoch 600 > lastTouched 500
        resolution: 'spec amended; the G2 human will weigh the failed row',
        disposition: null,
      },
    ]
    expect(deriveAction(o)).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('a resolution older than the report still escalates — the report is the newer fact', () => {
    const o = verified()
    o.verification = { verdict: 'escalate', raw: 'escalate', lastTouched: 500 }
    o.state!.escalations = [
      {
        at: null,
        from_role: 'orchestrator',
        reason: VERIFIER_ESCALATION_REASON,
        resolved: true,
        resolved_by: 'op',
        resolved_at: '1970-01-01T00:05:00.000Z', // epoch 300 < 500
        resolution: 'an earlier report',
        disposition: null,
      },
    ]
    expect(deriveAction(o)).toMatchObject({ kind: 'escalate', rule: 'D24' })
  })

  it('pass, fail, and a report without the line all leave G2 on the table — fail is the human\'s to weigh', () => {
    for (const verdict of ['pass', 'fail', null] as const) {
      const o = verified()
      o.verification = { verdict, raw: verdict, lastTouched: 500 }
      expect(deriveAction(o), String(verdict)).toMatchObject({ kind: 'rest', rule: 'D10' })
    }
  })

  it('a malformed report bounces before its verdict is read', () => {
    const o = verified()
    o.verification = { verdict: 'escalate', raw: 'escalate', lastTouched: 500 }
    o.validations['verification-report.md'] = { contract: 'verification-report.md', ok: false, missing: ['Gaps'], notes: [] }
    expect(deriveAction(o)).toMatchObject({ rule: 'D7' })
  })
})

describe('recency is branch order, not a wall clock (#346)', () => {
  // Three machines stamp the facts these rules compare: the one that served
  // the human's decision (`resolved_at`), the committer that landed the
  // artifact, and the engine host that wrote the ledger. A hosted engine with
  // a laptop CLI is the documented topology, so every row below gives the
  // record an order that CONTRADICTS the clocks, and asserts the record wins.
  const commit = (oid: string, time: number): CommitInfo => ({ oid, time, author: 'a', email: 'a@t', subject: oid })
  /** A branch, listed newest first, as `git log` yields it. */
  const branch = (...oids: string[]) => new BranchOrder(oids.map((oid, i) => commit(oid, 9000 - i)))
  /** An escalation resolved at a clock time that may disagree with its commit. */
  const resolvedAt = (reason: string, epochSec: number, disposition: Disposition | null = null) =>
    resolved(reason, new Date(epochSec * 1000).toISOString(), disposition)

  const escalated = (over: Partial<RunObservation> = {}) =>
    obs({
      state: state({
        phase: 'implement',
        tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
        escalations: [resolvedAt('reviewer escalated task 01-a — see review-01.md', 100, 're-review')],
      } as Partial<RunState>),
      taskFiles: new Map([taskFile('01-a')]),
      reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['escalate'], lastTouched: 500 }],
      lastTouchedOid: { 'review-01.md': 'review' },
      ...over,
    })

  it('D17 — a resolution the branch places after the verdict counts, though its clock reads earlier', () => {
    // The human's laptop is a minute behind the committer that landed the
    // review; the resolution commit is still the branch's newer fact.
    const a = deriveAction(escalated({ order: branch('resolve', 'review'), resolutionCommits: [commit('resolve', 100)] }))
    expect(a).toMatchObject({ kind: 'dispatch' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'reviewer', task: '01-a', round: 2 })
  })

  it('D17 — a resolution the branch places before the verdict does not count, though its clock reads later', () => {
    // The mirror image, and the half that matters for safety: a resolution
    // that predates the verdict must not route a round the human never saw.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [resolvedAt('reviewer escalated task 01-a — see review-01.md', 9_000, 're-review')],
    } as Partial<RunState>)
    const a = deriveAction(
      escalated({ state: s, order: branch('review', 'resolve'), resolutionCommits: [commit('resolve', 9_000)] }),
    )
    expect(a).toMatchObject({ kind: 'escalate', rule: 'D17', pause: 'escalation' })
  })

  it('D4 — the round cap stands down on a resolution the branch places after the latest verdict (#342)', () => {
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 3 }],
      escalations: [resolvedAt(roundCapReason('01-a', 3), 100)],
    } as Partial<RunState>)
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        reviews: [{ path: 'review-01.md', task: '01-a', verdicts: ['request-changes'], lastTouched: 500 }],
        lastTouchedOid: { 'review-01.md': 'review' },
        order: branch('resolve', 'review'),
        resolutionCommits: [commit('resolve', 100)],
      }),
    )
    // Not the round-cap escalation: the grant stands and the implement rules
    // take the task — round 4 goes back to the implementer with the report.
    expect(a).toMatchObject({ kind: 'dispatch' })
    expect(a.kind === 'dispatch' && a.dispatches[0]).toMatchObject({ role: 'implementer', task: '01-a', round: 4 })
  })

  it('D24 — the verifier’s escalation clears on a resolution the branch places after the report (#152)', () => {
    const o = obs({
      state: state({
        phase: 'implement',
        tasks: [{ id: '01-a', status: 'review-approved', review_rounds: 1 }],
        escalations: [resolvedAt(VERIFIER_ESCALATION_REASON, 100)],
      } as Partial<RunState>),
      taskFiles: new Map([taskFile('01-a')]),
      artifacts: ['spec.md', 'plan.md', 'tasks/01-a.yaml', 'review-01.md', 'verification-report.md'],
      validations: { 'verification-report.md': { contract: 'verification-report.md', ok: true, missing: [], notes: [] } },
      verification: { verdict: 'escalate', raw: 'escalate', lastTouched: 500 },
      lastTouchedOid: { 'verification-report.md': 'report' },
      order: branch('resolve', 'report'),
      resolutionCommits: [commit('resolve', 100)],
    })
    expect(deriveAction(o)).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('D20 — a frozen task thaws on a resolution the branch places after the failure that froze it (#147)', () => {
    const ledger = [failedAttempt('01-a', '1970-01-01T02:30:00.000Z')] // epoch 9000: later than the resolution's clock
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'failed', review_rounds: 0 }],
      escalations: [resolvedAt('implementer failed twice (01-a) — a human should look', 100)],
    } as Partial<RunState>)
    const a = deriveAction(
      obs({
        state: s,
        taskFiles: new Map([taskFile('01-a')]),
        ledger,
        ledgerCommits: [{ open: commit('dispatch', 8_000), close: commit('failure', 9_000) }],
        order: branch('resolve', 'failure', 'dispatch'),
        resolutionCommits: [commit('resolve', 100)],
      }),
    )
    expect(a).toMatchObject({ kind: 'record', rule: 'D20' })
  })

  it('DL — the landing cap counts by the dispatch’s own intent commit, not by the ledger’s clock (#343)', () => {
    // The engine host runs behind the committer, so both entries carry an `at`
    // older than spec.md's commit time — the shape that left the counter at
    // zero and re-dispatched an idle producer every tick.
    const ledger = [closedOk('analyst', null, '1970-01-01T00:01:00.000Z'), closedOk('analyst', null, '1970-01-01T00:02:00.000Z')]
    const shared = {
      ledger,
      lastTouched: { 'spec.md': 9_000 },
      lastTouchedOid: { 'spec.md': 'spec' },
      ledgerCommits: [
        { open: commit('open-1', 60), close: commit('close-1', 61) },
        { open: commit('open-2', 120), close: commit('close-2', 121) },
      ],
      order: branch('close-2', 'open-2', 'close-1', 'open-1', 'spec'),
    }
    const counts = idle(shared)
    expect(counts.get('analyst|')).toBe(2)
    expect(deriveAction(obs({ ...shared, idleDispatches: counts }))).toMatchObject({ kind: 'escalate', rule: 'DL' })
  })

  it('DL — a dispatch whose intent commit predates the landing never counts, whatever its clock says', () => {
    // The productive dispatch: it opens, the artifact lands, it closes. The
    // count is read off the OPENING commit for exactly this reason — counting
    // by the close would score every successful producer as idle.
    const ledger = [closedOk('analyst', null, '1970-01-01T02:30:00.000Z')] // epoch 9000, newer than the commit
    const counts = idle({
      ledger,
      lastTouched: { 'spec.md': 200 },
      lastTouchedOid: { 'spec.md': 'spec' },
      ledgerCommits: [{ open: commit('open-1', 100), close: commit('close-1', 300) }],
      order: branch('close-1', 'spec', 'open-1'),
    })
    expect(counts.get('analyst|')).toBeUndefined()
  })

  it('an observation the branch cannot place falls back to the clocks it does have', () => {
    // Every hand-built row above this describe block relies on this: no order
    // index, so the timestamps decide, exactly as they did before #346.
    const s = state({
      phase: 'implement',
      tasks: [{ id: '01-a', status: 'in-review', review_rounds: 1 }],
      escalations: [resolvedAt('reviewer escalated task 01-a — see review-01.md', 600, 're-review')],
    } as Partial<RunState>)
    expect(deriveAction(escalated({ state: s }))).toMatchObject({ kind: 'dispatch' })
  })
})
