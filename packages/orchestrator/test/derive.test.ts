// One test per derivation-table row (docs/ORCHESTRATOR.md §4.2) — the same
// discipline the frontend's readiness table keeps. Observations are built
// directly so each row is exercised in isolation.
import { describe, expect, it } from 'vitest'
import { PROFILES, STAGED_REASON, type GateEntry, type RunState, type Validation } from '@gateline/core'
import { deriveAction, DEFAULT_ESTIMATE_USD, VERIFIER_ESCALATION_REASON } from '../src/derive.ts'
import type { LedgerEntry, RunObservation, TaskFileInfo } from '../src/observe.ts'
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
  lastNonStateCommit: null,
  declineEvents: {},
  bounceCounts: {},
  ledger: [],
  openDispatches: [],
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
        { id: '01-a', status: 'in-progress', review_rounds: 0 },
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
