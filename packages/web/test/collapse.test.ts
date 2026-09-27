// The inbox's collapsed rows, computed (#499; docs/MULTI-REPO.md §9.3).
// `src/collapse.ts` is pure, so it is tested with literal items and literal
// expected values: where a collapsed row sits, which items it carries, which
// kinds never collapse, where the keyboard stops, and how `?expand=` is read
// and written.
import { describe, expect, it } from 'vitest'
import type { InboxItem } from '../src/api.ts'
import { expandedOf, inboxEntries, inboxStops, toggleExpanded } from '../src/collapse.ts'

const WEBSITE = 'local/website'
const DEMO = 'local/demo'

const item = (slug: string, kind: InboxItem['kind'], source = WEBSITE) => ({ slug, kind, source, sourceName: source.slice(6) }) as InboxItem

/** An oldest-first list: website's four unreadable runs interleaved with other kinds. */
const list = [
  item('esc', 'escalation', DEMO),
  item('broken-1', 'malformed'),
  item('g0', 'gate'),
  item('broken-2', 'malformed'),
  item('bad', 'malformed', DEMO),
  item('broken-3', 'malformed'),
  item('esc-w', 'escalation'),
  item('broken-4', 'malformed'),
  item('staged', 'staged', DEMO),
]

/** Entries as short strings: an item by its slug, a collapsed row as `[source: slugs]`. */
const show = (entries: ReturnType<typeof inboxEntries>) =>
  entries.map((e) => (e.kind === 'item' ? e.item.slug : `[${e.source}: ${e.items.map((i) => i.slug).join(' ')}]`))

describe('inboxEntries', () => {
  it('puts the collapsed row where the oldest of its items was, carrying all of them in order', () => {
    expect(show(inboxEntries(list, [{ source: WEBSITE }]))).toEqual([
      'esc',
      '[local/website: broken-1 broken-2 broken-3 broken-4]',
      'g0',
      'bad',
      'esc-w',
      'staged',
    ])
  })

  it('collapses nothing when the server names no repository, or predates the field', () => {
    const plain = list.map((i) => i.slug)
    expect(show(inboxEntries(list, []))).toEqual(plain)
    expect(show(inboxEntries(list, undefined))).toEqual(plain)
  })

  it('never collapses a gate, an escalation or any kind but malformed, whatever the server says', () => {
    const gates = [item('g0', 'gate'), item('g1', 'gate'), item('g2', 'gate'), item('g3', 'gate'), item('e', 'escalation')]
    expect(show(inboxEntries(gates, [{ source: WEBSITE }]))).toEqual(['g0', 'g1', 'g2', 'g3', 'e'])
  })

  it('leaves another repository’s unreadable run a row of its own', () => {
    expect(show(inboxEntries(list, [{ source: WEBSITE }]))).toContain('bad')
  })
})

describe('inboxStops', () => {
  const entries = inboxEntries(list, [{ source: WEBSITE }])
  const stops = (expanded: Set<string>) => inboxStops(entries, expanded).map((s) => (s.kind === 'item' ? s.item.slug : `[${s.source}]`))

  it('makes a closed row one stop', () => {
    expect(stops(new Set())).toEqual(['esc', '[local/website]', 'g0', 'bad', 'esc-w', 'staged'])
  })

  it('follows an open row with each of its items, as ordinary stops', () => {
    expect(stops(new Set([WEBSITE]))).toEqual(['esc', '[local/website]', 'broken-1', 'broken-2', 'broken-3', 'broken-4', 'g0', 'bad', 'esc-w', 'staged'])
  })
})

describe('the expanded state in the URL', () => {
  it('reads every expand parameter, without case', () => {
    expect([...expandedOf(new URLSearchParams('expand=Local%2FWebsite&expand=local%2Fdemo'))]).toEqual(['local/website', 'local/demo'])
  })

  it('opens and closes one row, keeping the scope, the grouping and the other rows', () => {
    const opened = toggleExpanded(new URLSearchParams('repo=local%2Fwebsite&group=repository'), WEBSITE)
    expect(opened.toString()).toBe('repo=local%2Fwebsite&group=repository&expand=local%2Fwebsite')
    const both = toggleExpanded(opened, DEMO)
    expect(both.getAll('expand')).toEqual([WEBSITE, DEMO])
    expect(toggleExpanded(both, 'LOCAL/WEBSITE').toString()).toBe('repo=local%2Fwebsite&group=repository&expand=local%2Fdemo')
  })
})
