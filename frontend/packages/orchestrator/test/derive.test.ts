// One test per derivation-table row (docs/ORCHESTRATOR.md §4.2) — the same
// discipline the frontend's readiness table keeps. Observations are built
// directly so each row is exercised in isolation.
import { describe, expect, it } from 'vitest'
import type { GateEntry, RunState, Validation } from '@agentic/core'
import { deriveAction, DEFAULT_ESTIMATE_USD } from '../src/derive.ts'
import type { RunObservation, TaskFileInfo } from '../src/observe.ts'

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
  lastTouched: {},
  declineEvents: {},
  bounceCounts: {},
  ledger: [],
  openDispatches: [],
  ledgerSpentUsd: 0,
  taskFiles: new Map(),
  inFlightSurfaces: [],
  estimates: { orchestrator: 0.5, analyst: 2, architect: 5, implementer: 8, reviewer: 4, verifier: 6, ops: 2 },
  ...over,
})

const taskFile = (id: string, over: Partial<TaskFileInfo> = {}): [string, TaskFileInfo] => [
  id,
  { path: `tasks/${id}.yaml`, surface: [`src/${id}.py`], dependsOn: [], ...over },
]

describe('the derivation table, one rule per row', () => {
  it('D0 — malformed state rests; a human owns it', () => {
    const a = deriveAction(obs({ state: null, stateError: 'not yaml' }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D0' })
  })

  it('D1 — done rests', () => {
    expect(deriveAction(obs({ state: state({ phase: 'done' }) }))).toMatchObject({ kind: 'rest', rule: 'D1' })
  })

  it('D2 — paused rests; resume is a human decision', () => {
    const a = deriveAction(obs({ state: state({ phase: 'paused', paused_reason: 'budget-exhausted' }) }))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D2' })
  })

  it('D3 — unresolved escalation rests', () => {
    const s = state({ escalations: [{ at: null, from_role: 'verifier', reason: 'x', resolved: false, resolved_by: null, resolved_at: null, resolution: null }] })
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'rest', rule: 'D3' })
  })

  it('D4 — round cap escalates and pauses', () => {
    const s = state({ phase: 'implement', tasks: [{ id: '01-x', status: 'in-review', review_rounds: 3 }] })
    expect(deriveAction(obs({ state: s }))).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })
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
        declineEvents: { G0: { at: 200, notes: 'requirement R2 is wrong' } },
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
        declineEvents: { G0: { at: 200, notes: 'stale decline' } },
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

  it('a role with no registry estimate is costed at the conservative default', () => {
    const s = state({ budget: { cost_limit_usd: 4, cost_spent_usd: 0 } })
    const a = deriveAction(obs({ state: s, estimates: {} }))
    expect(DEFAULT_ESTIMATE_USD).toBeGreaterThan(4)
    expect(a).toMatchObject({ kind: 'escalate', rule: 'DB' })
  })
})
