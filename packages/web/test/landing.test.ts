// Where the run page points you: the landing artifact (#250) and the card an
// inbox link names (#216). Every profile/gate pair in DESIGN.md §4.1 is
// covered, plus every case that must fall through to the caller's own
// behavior rather than guess.
import { describe, expect, it } from 'vitest'
import type { InboxItem, Profile } from '../src/api.ts'
import { DIFF_SELECTION, decideTargetIndex, landingArtifact, resolveSurface } from '../src/landing.ts'
import { refs } from './artifact-refs.helper.ts'

function item(over: Partial<InboxItem>): InboxItem {
  return {
    kind: 'gate',
    gate: 'G0',
    source: 'repo',
    slug: 'run',
    title: 't',
    detail: 'd',
    since: null,
    reviewable: true,
    problems: [],
    packet: [],
    packetRefs: [],
    escalationIndex: null,
    ...over,
  } as InboxItem
}

// The refs are built the way the server builds them (#415); the cases stay
// in paths because that is what a reader recognises.
const land = (items: InboxItem[], profile: Profile, artifacts: string[]) =>
  landingArtifact({ items, profile, artifacts: refs(artifacts) })

const FULL = [
  'intent-brief.md',
  'plan.md',
  'release-plan.md',
  'review-01.md',
  'review-02.md',
  'spec.md',
  'state.yaml',
  'tasks/01-core.yaml',
  'verification-report.md',
]

describe('landingArtifact', () => {
  it('opens G0 on the spec, not the intent brief', () => {
    expect(land([item({ gate: 'G0' })], 'full', FULL)).toBe('spec.md')
  })

  it('opens G1 on the plan for standard and full', () => {
    expect(land([item({ gate: 'G1' })], 'full', FULL)).toBe('plan.md')
    expect(land([item({ gate: 'G1' })], 'standard', FULL)).toBe('plan.md')
  })

  it('opens G1 on the work item for a patch run, which has no plan', () => {
    const patch = ['intent-brief.md', 'state.yaml', 'tasks/01-fix.yaml']
    expect(land([item({ gate: 'G1' })], 'patch', patch)).toBe('tasks/01-fix.yaml')
  })

  it('opens G2 on the verification report when a verifier ran', () => {
    expect(land([item({ gate: 'G2' })], 'full', FULL)).toBe('verification-report.md')
  })

  it('opens G2 on the newest review for a patch run, which has no verifier', () => {
    const patch = ['intent-brief.md', 'review-01.md', 'review-02.md', 'state.yaml', 'tasks/01-fix.yaml']
    expect(land([item({ gate: 'G2' })], 'patch', patch)).toBe('review-02.md')
  })

  it('opens G3 on the release plan', () => {
    expect(land([item({ gate: 'G3' })], 'full', FULL)).toBe('release-plan.md')
  })

  it('opens a round cap on the round that failed to converge', () => {
    const artifacts = [...FULL, 'review-03.md']
    expect(land([item({ kind: 'round-cap', gate: null })], 'full', artifacts)).toBe('review-03.md')
  })

  it('lands a bounced gate on its packet — seeing what is malformed is the job', () => {
    expect(land([item({ gate: 'G0', reviewable: false, problems: ['spec.md: missing'] })], 'full', FULL)).toBe('spec.md')
  })

  it('has no opinion about states whose packet is state.yaml', () => {
    for (const kind of ['escalation', 'paused', 'staged', 'malformed'] as const) {
      expect(land([item({ kind, gate: null })], 'full', FULL)).toBeNull()
    }
  })

  it('has no opinion when nothing is pending', () => {
    expect(land([], 'full', FULL)).toBeNull()
  })

  it('falls through when the wanted artifact has not landed yet', () => {
    expect(land([item({ gate: 'G3' })], 'full', ['intent-brief.md', 'spec.md'])).toBeNull()
  })

  it('takes the first pending item that has an opinion', () => {
    const items = [item({ kind: 'escalation', gate: null }), item({ gate: 'G2' })]
    expect(land(items, 'full', FULL)).toBe('verification-report.md')
  })
})

describe('resolveSurface', () => {
  const at = (tab: string | null, artifact: string | null = null, pending = true) =>
    resolveSurface({ tab, artifact }, { pending })

  it('opens a run with something pending on Decide, and a quiet run on Record', () => {
    expect(at(null, null, true)).toEqual({ surface: 'decide', selection: null, rewrite: false })
    expect(at(null, null, false)).toEqual({ surface: 'record', selection: null, rewrite: false })
  })

  it('never offers an empty Decide surface — a stale link lands on the record', () => {
    expect(at('decide', null, false)).toEqual({ surface: 'record', selection: null, rewrite: true })
    expect(at('decide', null, true)).toEqual({ surface: 'decide', selection: null, rewrite: false })
  })

  it('keeps the retired container tabs working: artifacts is the record', () => {
    expect(at('artifacts', 'spec.md')).toEqual({ surface: 'record', selection: 'spec.md', rewrite: true })
    expect(at('artifacts', null)).toEqual({ surface: 'record', selection: null, rewrite: true })
  })

  it('keeps the retired container tabs working: diff is the record, with the change open', () => {
    expect(at('diff', null)).toEqual({ surface: 'record', selection: DIFF_SELECTION, rewrite: true })
    // The old Diff tab carried no artifact, so nothing is lost by the change winning.
    expect(at('diff', 'spec.md')).toEqual({ surface: 'record', selection: DIFF_SELECTION, rewrite: true })
  })

  it('leaves a canonical URL alone', () => {
    expect(at('record', 'spec.md')).toEqual({ surface: 'record', selection: 'spec.md', rewrite: false })
    expect(at('record', DIFF_SELECTION)).toEqual({ surface: 'record', selection: DIFF_SELECTION, rewrite: false })
    expect(at('history', null)).toEqual({ surface: 'history', selection: null, rewrite: false })
  })

  it('reads a bare ?artifact= as asking to read it, whatever else is pending', () => {
    expect(at(null, 'plan.md', true)).toEqual({ surface: 'record', selection: 'plan.md', rewrite: false })
  })

  it('treats an unknown tab as no tab at all, and does not rewrite what it did not name', () => {
    // #216's inbox links carry ?decide=, never ?tab=; a run with nothing pending
    // and no tab is simply a run being read.
    expect(at('nonsense', null, true)).toEqual({ surface: 'decide', selection: null, rewrite: true })
    expect(at(null, null, true).rewrite).toBe(false)
  })

  it('routes History the same whether or not anything is pending', () => {
    expect(at('history', null, true).surface).toBe('history')
    expect(at('history', null, false).surface).toBe('history')
  })
})

describe('decideTargetIndex', () => {
  const items = [
    item({ kind: 'escalation', gate: null, escalationIndex: 0 }),
    item({ kind: 'escalation', gate: null, escalationIndex: 1 }),
    item({ kind: 'gate', gate: 'G2' }),
  ]

  it('resolves each of the four shapes the inbox emits', () => {
    expect(decideTargetIndex('G2', items)).toBe(2)
    expect(decideTargetIndex('esc-1', items)).toBe(1)
    expect(decideTargetIndex('paused', [item({ kind: 'paused', gate: null })])).toBe(0)
    expect(decideTargetIndex('staged', [item({ kind: 'staged', gate: null })])).toBe(0)
  })

  it('does not confuse one escalation for another', () => {
    expect(decideTargetIndex('esc-0', items)).toBe(0)
    expect(decideTargetIndex('esc-2', items)).toBe(-1)
  })

  it('degrades to -1 for absent, empty, unknown, or already-decided values', () => {
    expect(decideTargetIndex(null, items)).toBe(-1)
    expect(decideTargetIndex('', items)).toBe(-1)
    expect(decideTargetIndex('G9', items)).toBe(-1)
    expect(decideTargetIndex('G0', items)).toBe(-1) // pending G2, so a stale G0 link finds nothing
    expect(decideTargetIndex('G2', [])).toBe(-1)
  })
})
