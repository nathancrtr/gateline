// Which repositories' unreadable runs collapse (#499; docs/MULTI-REPO.md
// §9.3, decision P10). Pure over a list of inbox items, so the items are
// built by hand and every expected value is written out.
import { describe, expect, it } from 'vitest'
import { inboxCollapses } from '../src/view-model/portfolio.ts'
import type { InboxItem } from '../src/view-model/readiness.ts'

/** An inbox item with only what the rule reads: kind, repository, age. */
function item(kind: InboxItem['kind'], source: string, since: number | null, slug = `${kind}-${since}`): InboxItem {
  return { kind, source, sourceName: source.split('/').at(-1)!, since, slug } as InboxItem
}

const WEBSITE = 'github.com/acme/website'
const BILLING = 'github.com/acme/billing'

describe('inboxCollapses', () => {
  it('collapses four malformed items from one repository', () => {
    const items = [item('malformed', WEBSITE, 100), item('malformed', WEBSITE, 200), item('malformed', WEBSITE, 300), item('malformed', WEBSITE, 400)]
    expect(inboxCollapses(items)).toEqual([{ source: WEBSITE, sourceName: 'website', kind: 'malformed', count: 4, since: 100 }])
  })

  it('does not collapse three', () => {
    const items = [item('malformed', WEBSITE, 100), item('malformed', WEBSITE, 200), item('malformed', WEBSITE, 300)]
    expect(inboxCollapses(items)).toEqual([])
  })

  it('counts per repository: two repositories with two each do not collapse', () => {
    const items = [item('malformed', WEBSITE, 100), item('malformed', BILLING, 150), item('malformed', WEBSITE, 200), item('malformed', BILLING, 250)]
    expect(inboxCollapses(items)).toEqual([])
  })

  it('never counts a gate, an escalation or any other kind toward the collapse', () => {
    const items = [
      item('malformed', WEBSITE, 100),
      item('gate', WEBSITE, 110),
      item('gate', WEBSITE, 120),
      item('escalation', WEBSITE, 130),
      item('malformed', WEBSITE, 140),
      item('round-cap', WEBSITE, 150),
      item('paused', WEBSITE, 160),
      item('staged', WEBSITE, 170),
      item('malformed', WEBSITE, 180),
    ]
    expect(inboxCollapses(items)).toEqual([])
    // Six gates alone from one repository: nothing collapses.
    expect(inboxCollapses([1, 2, 3, 4, 5, 6].map((n) => item('gate', WEBSITE, n)))).toEqual([])
  })

  it('takes the oldest age, wherever it sits, and ignores unknown ones', () => {
    const items = [item('malformed', WEBSITE, 500), item('malformed', WEBSITE, null), item('malformed', WEBSITE, 90), item('malformed', WEBSITE, 700)]
    expect(inboxCollapses(items)[0]!.since).toBe(90)
    const unknown = [null, null, null, null].map((s, i) => item('malformed', WEBSITE, s, `u${i}`))
    expect(inboxCollapses(unknown)).toEqual([{ source: WEBSITE, sourceName: 'website', kind: 'malformed', count: 4, since: null }])
  })

  it('lists several repositories in the order their rows sit: oldest first, unknown last', () => {
    const five = (source: string, since: number | null) => [0, 1, 2, 3, 4].map((i) => item('malformed', source, since === null ? null : since + i, `${source}-${i}`))
    const items = [...five(WEBSITE, 300), ...five(BILLING, 100), ...five('local/tools', null)]
    expect(inboxCollapses(items).map((c) => [c.source, c.count, c.since])).toEqual([
      [BILLING, 5, 100],
      [WEBSITE, 5, 300],
      ['local/tools', 5, null],
    ])
  })
})
