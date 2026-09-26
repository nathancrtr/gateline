// #421: the engine asks core what a run file is (`describeArtifact`), the same
// question Gatehouse asks, instead of keeping its own regexes. These rows pin
// the edges where the old copies disagreed with core — a file that looks like
// a work item or a review report by prefix but is not one by the contracts'
// grammar — at each site that used to test the path itself: observation,
// the plan phase's work-item check, and shadow's "did this dispatch land".

import { execFileSync } from 'node:child_process'
import { BranchOrder, type GateEntry, LocalGitSource, type RunState } from '@gateline/core'
import { describe, expect, it } from 'vitest'
import { type DispatchIntent, deriveAction } from '../src/derive.ts'
import { observeRun, type RunObservation } from '../src/observe.ts'
import { dispatchLanded } from '../src/shadow.ts'
import { agentCommit, makeToyRepo, toyRef } from './engine.helper.ts'

const WORK_ITEM = 'id: 01-a\ntitle: A\nfile_contact_surface: [src/a.py]\ndepends_on: []\n'
const REVIEW = '# Review Report: 01-a\n\n**Verdict:** approve\n'

describe('observation classifies run files with describeArtifact (#421)', () => {
  it('reads only root-level review-<nn>*.md reports and tasks/<name>.yaml work items', async () => {
    const { dir, clock } = makeToyRepo()
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'run/toy'])
    agentCommit(
      dir,
      clock,
      {
        'runs/toy/tasks/01-a.yaml': WORK_ITEM,
        'runs/toy/tasks/.yaml': WORK_ITEM, // no name: not a work item
        'runs/toy/tasks/README.md': '# notes\n',
        'runs/toy/review-01.md': REVIEW,
        'runs/toy/review-01/notes.md': REVIEW, // under a review-looking directory: not a report
      },
      'toy: architect and reviewer landed',
    )
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])

    const obs = await observeRun(new LocalGitSource('check', dir), toyRef(dir), { estimates: {} })
    expect(obs.artifacts).toEqual(expect.arrayContaining(['tasks/.yaml', 'review-01/notes.md']))
    expect(obs.reviews.map((r) => r.path)).toEqual(['review-01.md'])
    expect([...obs.taskFiles.values()].map((f) => f.path)).toEqual(['tasks/01-a.yaml'])
    expect(Object.keys(obs.validations).sort()).toEqual(['review-01.md', 'tasks/01-a.yaml'])
  })
})

const gate = (over: Partial<GateEntry> = {}): GateEntry => ({ approved: false, by: null, at: null, notes: null, burden: null, ...over })

const planObs = (profile: 'patch' | 'full', artifacts: string[]): RunObservation => ({
  slug: 'toy',
  state: {
    run: 'toy',
    branch: 'run/toy',
    phase: 'plan',
    profile,
    paused_reason: null,
    budget: { cost_limit_usd: 50, cost_spent_usd: 0 },
    // patch has no G0; a decided one there would trip the profile invariant (also D21).
    gates: { G0: profile === 'patch' ? gate() : gate({ approved: true, by: 'op' }), G1: gate(), G2: gate(), G3: gate() },
    tasks: [],
    escalations: [],
    closure: null,
  } as RunState,
  stateError: null,
  artifacts,
  validations: Object.fromEntries(artifacts.map((p) => [p, { contract: p, ok: true, missing: [], notes: [] }])),
  reviews: [],
  verification: null,
  lastTouched: {},
  lastTouchedOid: {},
  lastNonStateCommit: null,
  lastNonStateOid: null,
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
})

describe("the plan phase counts work items by describeArtifact's kind (#421)", () => {
  it('a nameless tasks/.yaml is no work item: the architect is still owed one', () => {
    const a = deriveAction(planObs('full', ['intent-brief.md', 'spec.md', 'plan.md', 'tasks/.yaml']))
    expect(a).toMatchObject({ kind: 'dispatch', rule: 'D6' })
    expect(a.kind === 'dispatch' && a.dispatches[0]!.role).toBe('architect')
  })

  it('with a real work item beside it, the plan packet rests at G1', () => {
    const a = deriveAction(planObs('full', ['intent-brief.md', 'spec.md', 'plan.md', 'tasks/.yaml', 'tasks/01-a.yaml']))
    expect(a).toMatchObject({ kind: 'rest', rule: 'D10' })
  })

  it('patch: a nameless tasks/.yaml does not stand in for the human-authored work item', () => {
    expect(deriveAction(planObs('patch', ['intent-brief.md', 'tasks/.yaml']))).toMatchObject({
      kind: 'escalate',
      rule: 'D21',
      reason: expect.stringContaining('patch run has no work item'),
    })
    expect(deriveAction(planObs('patch', ['intent-brief.md', 'tasks/01-fix.yaml']))).toMatchObject({ kind: 'rest', rule: 'D10' })
  })
})

describe("shadow's landing test classifies with describeArtifact (#421)", () => {
  const intent = (role: DispatchIntent['role'], task: string | null = null): DispatchIntent => ({
    role,
    task,
    round: null,
    bounce: null,
    lands: 'x',
    reason: 'test',
  })
  const landed = (d: DispatchIntent, ...changed: string[]) =>
    dispatchLanded(d, { changed, runDir: 'runs/toy', runsRoot: 'runs', prevState: null, nextState: null })

  it('reviewer: a root-level review-<nn>*.md report, nothing else review-shaped', () => {
    expect(landed(intent('reviewer', '01-a'), 'runs/toy/review-01.md')).toBe(true)
    expect(landed(intent('reviewer', '01-a'), 'runs/toy/review-01-candidate-r1.md')).toBe(true)
    expect(landed(intent('reviewer', '01-a'), 'runs/toy/review-01.txt')).toBe(false)
    expect(landed(intent('reviewer', '01-a'), 'runs/toy/review-01/notes.md')).toBe(false)
  })

  it('architect: plan.md or a work item, not any file under tasks/', () => {
    expect(landed(intent('architect'), 'runs/toy/plan.md')).toBe(true)
    expect(landed(intent('architect'), 'runs/toy/tasks/01-a.yaml')).toBe(true)
    expect(landed(intent('architect'), 'runs/toy/tasks/README.md')).toBe(false)
  })

  it("implementer: code, or the dispatch's own work item by the id its filename carries", () => {
    expect(landed(intent('implementer', '01-a'), 'src/a.py')).toBe(true)
    expect(landed(intent('implementer', '01-a'), 'runs/toy/tasks/01-a.yaml')).toBe(true)
    // A sibling whose name merely contains the task id is another work item.
    expect(landed(intent('implementer', '01-a'), 'runs/toy/tasks/01-a-followup.yaml')).toBe(false)
    expect(landed(intent('implementer', '01-a'), 'runs/toy/tasks/01-a.md')).toBe(false)
    expect(landed(intent('implementer', '01-a'), 'runs/toy/tasks/02-b.yaml')).toBe(false)
  })
})
