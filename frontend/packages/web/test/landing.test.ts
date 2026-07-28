// The gate's packet decides the landing artifact (#250). Every profile/gate
// pair in DESIGN.md §4.1 is covered, plus the cases that must fall through to
// the caller's own default rather than guess.
import { describe, expect, it } from 'vitest'
import type { InboxItem, Profile } from '../src/api.ts'
import { landingArtifact } from '../src/landing.ts'

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
    escalationIndex: null,
    ...over,
  } as InboxItem
}

const land = (items: InboxItem[], profile: Profile, artifacts: string[]) =>
  landingArtifact({ items, profile, artifacts })

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
