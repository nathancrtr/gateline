// The Record rail's entries name kinds, not files (#401). The order they read
// in is pinned in polish.test.ts; this file pins the words. What each file is
// arrives as an ArtifactRef (#415) — built here the way the server builds it.
import { describe, expect, it } from 'vitest'
import { railGroups, railLabel } from '../src/record-rail.ts'
import { ref, refs } from './artifact-refs.helper.ts'

const label = (path: string) => railLabel(ref(path))

describe('railLabel', () => {
  it('names the one-per-run kinds by their kind, `state.yaml` among them (#425, docs/SEAM.md §8.3)', () => {
    expect(label('intent-brief.md')).toEqual({ text: 'Brief', face: 'label' })
    expect(label('spec.md')).toEqual({ text: 'Spec', face: 'label' })
    expect(label('plan.md')).toEqual({ text: 'Plan', face: 'label' })
    expect(label('verification-report.md')).toEqual({ text: 'Verification', face: 'label' })
    expect(label('release-plan.md')).toEqual({ text: 'Release plan', face: 'label' })
    expect(label('state.yaml')).toEqual({ text: 'Ledger', face: 'label' })
  })

  it('names a work item by its id, in the code face, without the directory or the extension (#425, §8.2)', () => {
    expect(label('tasks/06-pages-workflow.yaml')).toEqual({ text: '06-pages-workflow', face: 'name' })
  })

  it('names a work item off the NN-slug grammar by its own stem, never its filename', () => {
    expect(label('tasks/hotfix.yaml')).toEqual({ text: 'hotfix', face: 'name' })
  })

  it('shows only a work item nested under tasks/, which has no name, as the file it is', () => {
    expect(label('tasks/sub/01-x.yaml')).toEqual({ text: 'tasks/sub/01-x.yaml', face: 'path' })
  })

  it('shows a file the framework has no position for as the file it is', () => {
    expect(label('retro.md')).toEqual({ text: 'retro.md', face: 'path' })
    expect(label('notes/scratch.txt')).toEqual({ text: 'notes/scratch.txt', face: 'path' })
  })

  it('names a review by the task its header names, in the code face, from the ref alone', () => {
    const all = [ref('review-01.md', '01-core'), ref('review-02.md', '02-errors')]
    expect(railLabel(all[0]!, all)).toEqual({ text: '01-core', face: 'name' })
    expect(railLabel(all[1]!, all)).toEqual({ text: '02-errors', face: 'name' })
  })

  it('names a review whose header is unreadable, or was not read, by its id — never its filename', () => {
    expect(railLabel(ref('review-01.md', null))).toEqual({ text: '01', face: 'name' })
    expect(label('review-01.md')).toEqual({ text: '01', face: 'name' })
  })

  it('keeps a file-per-round record distinct by carrying each round', () => {
    const all = [ref('review-01.md', '01-core', 1), ref('review-02.md', '01-core', 2), ref('review-03.md', '01-core', 3)]
    expect(railLabel(all[0]!, all).text).toBe('01-core · round 1')
    expect(railLabel(all[2]!, all).text).toBe('01-core · round 3')
  })

  it('carries each report\'s id when rounds share a task but state no round number', () => {
    const all = [ref('review-01.md', '01-core'), ref('review-02.md', '01-core')]
    expect(railLabel(all[0]!, all)).toEqual({ text: '01-core · 01', face: 'name' })
    expect(railLabel(all[1]!, all)).toEqual({ text: '01-core · 02', face: 'name' })
  })
})

describe('railGroups', () => {
  it('gathers the numbered families under one caption each and leaves the rest alone', () => {
    const given = [
      ref('state.yaml'),
      ref('review-02.md', '02-errors'),
      ref('tasks/02-errors.yaml'),
      ref('spec.md'),
      ref('tasks/01-core.yaml'),
      ref('review-01.md', '01-core'),
      ref('intent-brief.md'),
    ]
    expect(railGroups(given)).toEqual([
      { caption: null, entries: [{ path: 'intent-brief.md', text: 'Brief', face: 'label' }] },
      { caption: null, entries: [{ path: 'spec.md', text: 'Spec', face: 'label' }] },
      {
        caption: 'Work items · 2',
        entries: [
          { path: 'tasks/01-core.yaml', text: '01-core', face: 'name' },
          { path: 'tasks/02-errors.yaml', text: '02-errors', face: 'name' },
        ],
      },
      {
        caption: 'Reviews · 2',
        entries: [
          { path: 'review-01.md', text: '01-core', face: 'name' },
          { path: 'review-02.md', text: '02-errors', face: 'name' },
        ],
      },
      { caption: null, entries: [{ path: 'state.yaml', text: 'Ledger', face: 'label' }] },
    ])
  })

  it('labels a review by its task on the first render — there is no second, relabelling one', () => {
    // The rail used to take the reports as a second argument and relabel
    // once they loaded (#401). It takes only the refs now: the label a
    // review has on first paint is the label it keeps.
    const [group] = railGroups([ref('review-04.md', '02-record-scaffold-and-arm')])
    expect(group!.entries[0]!.text).toBe('02-record-scaffold-and-arm')
  })

  it('gives a family with no members no caption', () => {
    expect(railGroups(refs(['spec.md', 'state.yaml'])).every((g) => g.caption === null)).toBe(true)
  })

  it('reads in the record order, whatever order it was handed', () => {
    const order = railGroups(refs(['state.yaml', 'plan.md', 'intent-brief.md'])).flatMap((g) => g.entries.map((e) => e.path))
    expect(order).toEqual(['intent-brief.md', 'plan.md', 'state.yaml'])
  })
})
