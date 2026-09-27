// The inbox's collapsed rows (#499; docs/MULTI-REPO.md §9.3, decision P10,
// provisional), computed.
//
// Which repositories collapse is core's rule, sent on `/api/inbox` as
// `collapsed`: a repository whose `malformed` items number more than three.
// This file places the row and holds the items it stands for; the sentence on
// the row is composed in `pages/inbox.tsx`.
//
// Three commitments, each checked by `web/test/collapse.test.ts`:
//
// - **A collapsed row stands for items; it replaces none.** Every item stays
//   in the page's list, and the row carries all of them, in their order, to
//   reveal in place. Counts are of items everywhere: the kind filters, the
//   rail's badge, the scope control and the group headings are computed
//   from the items before this file sees them.
// - **The row sits where its oldest item sat.** The list is oldest first, so
//   the row takes the position of the first of its items and its age is that
//   item's.
// - **Only `malformed` collapses.** A gate, an escalation and every other
//   kind are always rows of their own, whatever `collapsed` says.
//
// The expanded state lives in the URL, as `?expand=<repository id>`, one per
// open row, so an open row can be linked and survives a reload — as the scope
// and the grouping do.
//
// Pure functions only.

import type { InboxCollapse, InboxItem } from './api.ts'

/** The query parameter an open collapsed row travels in; repeated, one per repository. */
export const EXPAND_PARAM = 'expand'

/** The one kind that collapses (core's `COLLAPSED_KIND`, repeated because the browser imports no core values). */
const COLLAPSIBLE: InboxItem['kind'] = 'malformed'

/** One line of the inbox: an item, or one repository's collapsed items. */
export type InboxEntry =
  | { kind: 'item'; item: InboxItem }
  | {
      kind: 'collapsed'
      /** The repository id: what `?expand=` names. */
      source: string
      sourceName: string
      /** The items the row stands for, in the list's order, oldest first. */
      items: InboxItem[]
    }

/**
 * The entries for a list of items, in the list's order. `collapsed` names
 * the repositories whose `malformed` items show as one row; each such row
 * takes the place of the first of those items in `items`, and the rest of
 * them are carried by the row instead of appearing again. A repository not
 * named in `collapsed`, and every item of another kind, is an entry of its
 * own. `items` is whatever the page shows — scoped, filtered, or one group's
 * rows — and the row holds the items of that list.
 */
export function inboxEntries(items: readonly InboxItem[], collapsed: readonly Pick<InboxCollapse, 'source'>[] | undefined): InboxEntry[] {
  const collapsing = new Set((collapsed ?? []).map((c) => c.source))
  const rows = new Map<string, Extract<InboxEntry, { kind: 'collapsed' }>>()
  const out: InboxEntry[] = []
  for (const item of items) {
    if (item.kind !== COLLAPSIBLE || !collapsing.has(item.source)) {
      out.push({ kind: 'item', item })
      continue
    }
    const row = rows.get(item.source)
    if (row) {
      row.items.push(item)
      continue
    }
    const fresh = { kind: 'collapsed' as const, source: item.source, sourceName: item.sourceName, items: [item] }
    rows.set(item.source, fresh)
    out.push(fresh)
  }
  return out
}

/** The repositories whose rows are open, from the URL. */
export function expandedOf(params: URLSearchParams): Set<string> {
  return new Set(params.getAll(EXPAND_PARAM).map((id) => id.toLowerCase()))
}

/** Whether one collapsed row is open. Ids compare without case, as everywhere (MULTI-REPO.md §6). */
export const isExpanded = (expanded: ReadonlySet<string>, source: string): boolean => expanded.has(source.toLowerCase())

/** The page's parameters with one row opened or closed, keeping everything else. */
export function toggleExpanded(params: URLSearchParams, source: string): URLSearchParams {
  const next = new URLSearchParams(params)
  const open = next.getAll(EXPAND_PARAM)
  next.delete(EXPAND_PARAM)
  const without = open.filter((id) => id.toLowerCase() !== source.toLowerCase())
  for (const id of without) next.append(EXPAND_PARAM, id)
  if (without.length === open.length) next.append(EXPAND_PARAM, source)
  return next
}

/**
 * One place the keyboard cursor (`j`/`k`/`enter`) can stop: a collapsed row,
 * which `enter` opens or closes, or an item, which `enter` opens. A closed
 * row is one stop; an open one is its own stop followed by each of its items.
 */
export type InboxStop = { kind: 'collapsed'; source: string } | { kind: 'item'; item: InboxItem }

/** The stops, in the order they are drawn. */
export function inboxStops(entries: readonly InboxEntry[], expanded: ReadonlySet<string>): InboxStop[] {
  const out: InboxStop[] = []
  for (const entry of entries) {
    if (entry.kind === 'item') {
      out.push(entry)
      continue
    }
    out.push({ kind: 'collapsed', source: entry.source })
    if (isExpanded(expanded, entry.source)) for (const item of entry.items) out.push({ kind: 'item', item })
  }
  return out
}
