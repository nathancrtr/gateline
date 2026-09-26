// What a file in a run directory is (#415): the one place a path's kind is
// derived. The table covers every artifact path the contracts define, and the
// odd shapes the record actually holds.
import { describe, expect, it } from 'vitest'
import {
  ARTIFACT_KINDS,
  type ArtifactDescription,
  artifactRef,
  artifactRefs,
  contractFor,
  describeArtifact,
  g2PacketReady,
  parseReview,
} from '../src/index.ts'

type Row = [path: string, expected: ArtifactDescription]

const TABLE: Row[] = [
  // The one-per-run kinds, at the paths the contracts fix for them.
  ['intent-brief.md', { kind: 'intent-brief', id: null, contract: 'intent-brief.md', contractName: 'intent brief', family: 'gate', format: 'markdown' }],
  ['spec.md', { kind: 'spec', id: null, contract: 'spec.md', contractName: 'spec', family: 'gate', format: 'markdown' }],
  ['plan.md', { kind: 'plan', id: null, contract: 'plan.md', contractName: 'plan', family: 'gate', format: 'markdown' }],
  [
    'verification-report.md',
    { kind: 'verification-report', id: null, contract: 'verification-report.md', contractName: 'verification report', family: 'gate', format: 'markdown' },
  ],
  ['release-plan.md', { kind: 'release-plan', id: null, contract: 'release-plan.md', contractName: 'release plan', family: 'gate', format: 'markdown' }],
  ['state.yaml', { kind: 'state', id: null, contract: 'state.yaml', contractName: 'run state', family: 'ledger', format: 'yaml' }],
  // Contracts exist for these two, but they are presence-only today.
  // A sweep's delta is read by a human reviewing a gate-less sweep branch.
  ['docs-delta.md', { kind: 'docs-delta', id: null, contract: null, contractName: 'docs delta', family: 'other', format: 'markdown' }],
  [
    'integration-profile.md',
    { kind: 'integration-profile', id: null, contract: null, contractName: 'integration profile', family: 'gate', format: 'markdown' },
  ],
  // Work items: tasks/NN-slug.yaml, named by the id the filename carries.
  ['tasks/01-core.yaml', { kind: 'work-item', id: '01-core', contract: 'work-item.yaml', contractName: 'work item', family: 'work-items', format: 'yaml' }],
  [
    'tasks/06-pages-workflow.yaml',
    { kind: 'work-item', id: '06-pages-workflow', contract: 'work-item.yaml', contractName: 'work item', family: 'work-items', format: 'yaml' },
  ],
  // Off the NN-slug grammar: still checked as a work item, and its stem is still a name.
  ['tasks/hotfix.yaml', { kind: 'work-item', id: 'hotfix', contract: 'work-item.yaml', contractName: 'work item', family: 'work-items', format: 'yaml' }],
  // Nested under tasks/: the stem is a path, so there is no name to give it.
  ['tasks/sub/01-x.yaml', { kind: 'work-item', id: null, contract: 'work-item.yaml', contractName: 'work item', family: 'work-items', format: 'yaml' }],
  // Review reports: review-NN.md, and the suffixed shapes real runs hold.
  ['review-01.md', { kind: 'review-report', id: '01', contract: 'review-report.md', contractName: 'review report', family: 'reviews', format: 'markdown' }],
  ['review-04.md', { kind: 'review-report', id: '04', contract: 'review-report.md', contractName: 'review report', family: 'reviews', format: 'markdown' }],
  [
    'review-03-round2.md',
    { kind: 'review-report', id: '03-round2', contract: 'review-report.md', contractName: 'review report', family: 'reviews', format: 'markdown' },
  ],
  [
    'review-01-candidate-import-desk-r1.md',
    {
      kind: 'review-report',
      id: '01-candidate-import-desk-r1',
      contract: 'review-report.md',
      contractName: 'review report',
      family: 'reviews', format: 'markdown',
    },
  ],
  // Everything else is `other`: presence-only, shown as the file it is.
  ['retro.md', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'markdown' }],
  ['sweep.yaml', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'yaml' }],
  ['notes/scratch.txt', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
  ['screenshots/inbox.png', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
  // A contract's filename away from where the contract puts it is not a second one.
  ['design/spec.md', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'markdown' }],
  ['design/review-01.md', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'markdown' }],
  ['review-notes.md', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'markdown' }],
  ['review-01.yaml', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'yaml' }],
  ['tasks/01-core.md', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'markdown' }],
  ['tasks/.yaml', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'yaml' }],
  // A path is arbitrary input: an inherited property name is not a kind.
  ['constructor', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
  ['toString', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
  ['__proto__', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
  ['hasOwnProperty', { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format: 'text' }],
]

describe('describeArtifact', () => {
  it.each(TABLE)('%s', (path, expected) => {
    expect(describeArtifact(path)).toEqual(expected)
  })

  it('covers every kind in the closed set', () => {
    expect(new Set(TABLE.map(([, d]) => d.kind))).toEqual(new Set(ARTIFACT_KINDS))
  })

  // Stated independently of the table above: `contractFor` wraps
  // `describeArtifact`, so checking one against the other would be circular.
  it.each([
    ['intent-brief.md', 'intent-brief.md'],
    ['spec.md', 'spec.md'],
    ['plan.md', 'plan.md'],
    ['tasks/01-core.yaml', 'work-item.yaml'],
    ['tasks/hotfix.yaml', 'work-item.yaml'],
    ['review-01.md', 'review-report.md'],
    ['review-03-round2.md', 'review-report.md'],
    ['verification-report.md', 'verification-report.md'],
    ['release-plan.md', 'release-plan.md'],
    ['state.yaml', 'state.yaml'],
    ['docs-delta.md', null],
    ['integration-profile.md', null],
    ['retro.md', null],
    ['design/spec.md', null],
    ['constructor', null],
  ])('contractFor(%s) is %s', (path, contract) => {
    expect(contractFor(path)).toBe(contract)
  })
})

describe('g2PacketReady reads the review kind', () => {
  const state = { profile: 'patch', tasks: [{ status: 'review-approved' }] } as unknown as Parameters<typeof g2PacketReady>[0]
  it('counts a suffixed review report and ignores a look-alike', () => {
    expect(g2PacketReady(state, ['review-03-round2.md'])).toBe(true)
    expect(g2PacketReady(state, ['review-notes.md', 'design/review-01.md'])).toBe(false)
  })
})

describe('artifactRef', () => {
  it('carries the description, the path, and no review subject for a non-review', () => {
    expect(artifactRef('tasks/01-core.yaml')).toEqual({
      kind: 'work-item',
      id: '01-core',
      path: 'tasks/01-core.yaml',
      contract: 'work-item.yaml',
      contractName: 'work item',
      family: 'work-items',
      format: 'yaml',
      reviewOf: null,
    })
  })

  it('leaves a review unresolved until its report is read', () => {
    expect(artifactRef('review-02.md').reviewOf).toBeNull()
  })

  it('names the task a review reviews, from its own header, with its round', () => {
    const report = parseReview('review-02.md', '# Review Report: 02-errors\n\n**Verdict:** approve\n**Round:** 2\n')
    expect(artifactRef('review-02.md', report).reviewOf).toEqual({ task: '02-errors', round: 2 })
  })

  it('is at the latest round a report carries — rounds append to one report', () => {
    const report = parseReview(
      'review-01.md',
      [
        '# Review Report: 01-core',
        '',
        '**Verdict:** request-changes',
        '**Round:** 1',
        '',
        '# Review Report: 01-core — round 2',
        '',
        '**Verdict:** request-changes',
        '**Round:** 2',
        '',
        '# Review Report: 01-core — round 3',
        '',
        '**Verdict:** approve',
        '**Round:** 3',
        '',
      ].join('\n'),
    )
    expect(report.rounds.map((r) => r.round)).toEqual([1, 2, 3])
    expect(artifactRef('review-01.md', report).reviewOf).toEqual({ task: '01-core', round: 3 })
  })

  it('says so when the header is unreadable, rather than guessing a task', () => {
    const report = parseReview('review-02.md', 'no header here\n')
    expect(artifactRef('review-02.md', report).reviewOf).toEqual({ task: null, round: null })
  })

  it('resolves a whole run in the order given, matching reports by path', () => {
    const reports = [parseReview('review-01.md', '# Review Report: 01-core\n')]
    const refs = artifactRefs(['spec.md', 'review-01.md', 'review-02.md'], reports)
    expect(refs.map((r) => r.path)).toEqual(['spec.md', 'review-01.md', 'review-02.md'])
    expect(refs[1]!.reviewOf).toEqual({ task: '01-core', round: null })
    expect(refs[2]!.reviewOf).toBeNull()
  })
})
