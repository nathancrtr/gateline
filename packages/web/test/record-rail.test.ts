// The Record rail's entries name kinds, not files (#401). The order they read
// in is pinned in polish.test.ts; this file pins the words.
import { describe, expect, it } from 'vitest'
import type { ReviewReport } from '../src/api.ts'
import { railGroups, railLabel } from '../src/record-rail.ts'

const report = (path: string, task: string | null, round: number | null = null): ReviewReport =>
  ({
    path,
    task,
    rounds: round === null ? [] : [{ round, verdict: 'approve', diff: null, line: 1 }],
    findings: [],
    dispositions: [],
    verdict: null,
    escalation: null,
  }) as ReviewReport

describe('railLabel', () => {
  it('names the one-per-run kinds by their kind', () => {
    expect(railLabel('intent-brief.md')).toEqual({ text: 'Brief', literal: false })
    expect(railLabel('spec.md')).toEqual({ text: 'Spec', literal: false })
    expect(railLabel('plan.md')).toEqual({ text: 'Plan', literal: false })
    expect(railLabel('verification-report.md')).toEqual({ text: 'Verification', literal: false })
    expect(railLabel('release-plan.md')).toEqual({ text: 'Release plan', literal: false })
  })

  it('names a work item by its id, without the directory or the extension', () => {
    expect(railLabel('tasks/06-pages-workflow.yaml')).toEqual({ text: '06-pages-workflow', literal: false })
  })

  it('shows a work item off the NN-slug grammar as its own stem', () => {
    expect(railLabel('tasks/hotfix.yaml')).toEqual({ text: 'hotfix', literal: true })
  })

  it('keeps state.yaml as the one deliberate filename', () => {
    expect(railLabel('state.yaml')).toEqual({ text: 'state.yaml', literal: true })
  })

  it('shows a file the framework has no position for as the file it is', () => {
    expect(railLabel('retro.md')).toEqual({ text: 'retro.md', literal: true })
    expect(railLabel('notes/scratch.txt')).toEqual({ text: 'notes/scratch.txt', literal: true })
  })

  it('names a review by the task its header names', () => {
    const reports = [report('review-01.md', '01-core'), report('review-02.md', '02-errors')]
    expect(railLabel('review-01.md', reports)).toEqual({ text: '01-core', literal: false })
    expect(railLabel('review-02.md', reports)).toEqual({ text: '02-errors', literal: false })
  })

  it('falls back to the stem while reports are loading, and when a header is unreadable', () => {
    expect(railLabel('review-01.md')).toEqual({ text: 'review-01', literal: true })
    expect(railLabel('review-01.md', [report('review-01.md', null)])).toEqual({ text: 'review-01', literal: true })
  })

  it('keeps a file-per-round record distinct by carrying each round', () => {
    const reports = [report('review-01.md', '01-core', 1), report('review-02.md', '01-core', 2), report('review-03.md', '01-core', 3)]
    expect(railLabel('review-01.md', reports).text).toBe('01-core · round 1')
    expect(railLabel('review-03.md', reports).text).toBe('01-core · round 3')
  })

  it('falls back to the stem when rounds share a task but carry no round number', () => {
    const reports = [report('review-01.md', '01-core'), report('review-02.md', '01-core')]
    expect(railLabel('review-02.md', reports)).toEqual({ text: 'review-02', literal: true })
  })
})

describe('railGroups', () => {
  it('gathers the numbered families under one caption each and leaves the rest alone', () => {
    const paths = ['state.yaml', 'review-02.md', 'tasks/02-errors.yaml', 'spec.md', 'tasks/01-core.yaml', 'review-01.md', 'intent-brief.md']
    const reports = [report('review-01.md', '01-core'), report('review-02.md', '02-errors')]
    expect(railGroups(paths, reports)).toEqual([
      { caption: null, entries: [{ path: 'intent-brief.md', text: 'Brief', literal: false }] },
      { caption: null, entries: [{ path: 'spec.md', text: 'Spec', literal: false }] },
      {
        caption: 'Work items · 2',
        entries: [
          { path: 'tasks/01-core.yaml', text: '01-core', literal: false },
          { path: 'tasks/02-errors.yaml', text: '02-errors', literal: false },
        ],
      },
      {
        caption: 'Reviews · 2',
        entries: [
          { path: 'review-01.md', text: '01-core', literal: false },
          { path: 'review-02.md', text: '02-errors', literal: false },
        ],
      },
      { caption: null, entries: [{ path: 'state.yaml', text: 'state.yaml', literal: true }] },
    ])
  })

  it('gives a family with no members no caption', () => {
    expect(railGroups(['spec.md', 'state.yaml']).every((g) => g.caption === null)).toBe(true)
  })

  it('reads in the record order, whatever order it was handed', () => {
    const paths = railGroups(['state.yaml', 'plan.md', 'intent-brief.md']).flatMap((g) => g.entries.map((e) => e.path))
    expect(paths).toEqual(['intent-brief.md', 'plan.md', 'state.yaml'])
  })
})
