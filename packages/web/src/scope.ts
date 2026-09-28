// The scope and the grouping, computed (#498; docs/MULTI-REPO.md §9.1, §9.2).
//
// Inbox, Portfolio and Metrics are joined across the set by default (decision
// D4). A scope narrows all three to one repository, and grouping sections a
// joined page by repository. Both are computed here, on the client, from the
// rows the API already returns: every row carries `source` (the repository
// id) and `sourceName` (its display name). The API takes no `repo` parameter,
// because the rail's Inbox badge needs the whole set's count whatever the
// scope, and the data is small at operator scale. The set itself, with each
// repository's display name and mode, is `/api/health`'s (#499), so a
// repository with nothing on the page is still named.
//
// The scope lives in the URL only, as `?repo=<repository id>` (decision P9):
// nothing here reads or writes browser storage, so a fresh visit always shows
// everything and no forgotten setting can hide a decision.
//
// Pure functions only. The pages and the rail call these; the markup lives in
// `components/scope.tsx`.

import type { RepositoryMode } from './api.ts'

/** The query parameter the scope travels in. */
export const SCOPE_PARAM = 'repo'
/** The query parameter grouping travels in, and its one value. */
export const GROUP_PARAM = 'group'
export const GROUP_BY_REPOSITORY = 'repository'

/** Ids that differ only in case name one repository (MULTI-REPO.md §6). */
export const sameRepository = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** One repository of the set, as the scope control and a group heading show it. */
export interface Repository {
  id: string
  /** The display name: `/api/health`'s, else the rows'; the id when neither has named it. */
  name: string
  /** Decisions waiting in it: its inbox entries. Zero, and not a count, when `unreadable` is set. */
  waiting: number
  /** What this deployment may do in it (§7.3), from `/api/health`; null or absent when not stated. */
  mode?: RepositoryMode | null
  /**
   * Why it could not be read (§10), on one line, when it could not. Its
   * count of waiting decisions is then unknown, and an interface shows none
   * rather than `0`.
   */
  unreadable?: string
}

/** One served repository as `/api/health` lists it (#499), or its bare id from a server built before. */
export type Served = string | { id: string; name?: string; mode?: RepositoryMode | null }

/** What a row needs to be scoped and grouped: its repository id, and the name core gave it. */
export interface Sourced {
  source: string
  sourceName?: string
}

/**
 * The order repositories are listed in, everywhere: the scope control, the
 * groups on Inbox and Portfolio, and the CLI's groups. By display name,
 * without case, then by id. A reader finds a repository by the name printed
 * for it, so the list is alphabetical by that name; it does not follow the
 * config file, whose order differs from `--repo` flags on the command line,
 * or the counts, which would reorder the groups each time a decision arrived.
 * `packages/cli/src/main.ts` repeats this comparison, and both packages test
 * it with literal lists.
 */
export function compareRepositories(a: { id: string; name: string }, b: { id: string; name: string }): number {
  const an = a.name.toLowerCase()
  const bn = b.name.toLowerCase()
  if (an !== bn) return an < bn ? -1 : 1
  const ai = a.id.toLowerCase()
  const bi = b.id.toLowerCase()
  return ai < bi ? -1 : ai > bi ? 1 : 0
}

/**
 * The set, in listing order. `served` is what `/api/health` says is served —
 * the set as configured, whether or not each repository has runs — with each
 * repository's display name and mode (#499). A server built before #499
 * sends bare ids; display names then come from any rows that carry one
 * (`named`), and a repository no row names is shown by its id, which is
 * never ambiguous. `waiting` is the whole inbox, unscoped, which each
 * repository's count is taken from. `unreadable` names the repositories that
 * could not be read (§10), whose count is unknown.
 */
export function repositoriesOf(
  served: readonly Served[],
  named: readonly Sourced[],
  waiting: readonly Sourced[],
  unreadable: readonly { source: string; error: string }[] = [],
): Repository[] {
  const set = new Map<string, Repository>()
  const found = new Set<string>()
  for (const entry of served) {
    const { id, name, mode } = typeof entry === 'string' ? { id: entry, name: undefined, mode: undefined } : entry
    const key = id.toLowerCase()
    if (set.has(key)) continue
    set.set(key, { id, name: name || id, waiting: 0, ...(mode !== undefined ? { mode } : {}) })
    if (name) found.add(key)
  }
  for (const row of named) {
    const key = row.source.toLowerCase()
    const repository = set.get(key)
    if (repository && row.sourceName && !found.has(key)) {
      repository.name = row.sourceName
      found.add(key)
    }
  }
  for (const row of waiting) {
    const repository = set.get(row.source.toLowerCase())
    if (repository) repository.waiting += 1
  }
  for (const u of unreadable) {
    const repository = set.get(u.source.toLowerCase())
    if (repository) repository.unreadable = u.error
  }
  return [...set.values()].sort(compareRepositories)
}

/**
 * What the page is showing.
 * - `all`: the whole set. Also what a scope equal to the whole set resolves
 *   to, so a one-repository deployment given `?repo=<its id>` looks exactly
 *   as it does without it.
 * - `one`: one repository of a set of several.
 * - `unknown`: `?repo=` named a repository this deployment does not serve.
 *   Every repository is shown, and the page says once that the one named is
 *   not served here, rather than showing an empty page.
 * - `loading`: `?repo=` asked for a repository, and the served set is not
 *   known yet — `/api/health` has neither answered nor failed. "Not loaded
 *   yet" and "not a repository served here" are different states (#551): a
 *   `loading` scope is never `unknown`, and it carries `asked` through
 *   unresolved rather than guessing. A repository that never answers (a
 *   failed `/api/health`) reads the same way, forever, which is the safe
 *   default — a link keeps the scope it was given rather than dropping it.
 */
export type Scope =
  | { kind: 'all' }
  | { kind: 'one'; repository: Repository }
  | { kind: 'unknown'; asked: string }
  | { kind: 'loading'; asked: string }

/**
 * The scope `?repo=` asks for, against the set. `setKnown` is false while the
 * served set has not yet been read (or could not be): until then, an asked-for
 * repository cannot be told apart from one this deployment does not serve, so
 * the scope is reported `loading` rather than `unknown` (#551).
 */
export function resolveScope(asked: string | null, set: readonly Repository[], setKnown = true): Scope {
  if (asked === null || asked.trim() === '') return { kind: 'all' }
  if (!setKnown) return { kind: 'loading', asked }
  const repository = set.find((r) => sameRepository(r.id, asked))
  if (!repository) return { kind: 'unknown', asked }
  return set.length > 1 ? { kind: 'one', repository } : { kind: 'all' }
}

/** The rows the scope shows, in the order they came. */
export function inScope<T extends Sourced>(rows: readonly T[], scope: Scope): T[] {
  if (scope.kind !== 'one') return [...rows]
  return rows.filter((row) => sameRepository(row.source, scope.repository.id))
}

/**
 * The scope's repository id, for a link to carry: the resolved repository
 * when the scope is `one`, and the URL's own asked-for id, unchanged, while
 * it is still `loading` (#551) — a click in that window must not lose it.
 * Null when the page shows the whole set outright, or when the id turned out
 * to name nothing served here.
 */
export const scopeId = (scope: Scope): string | null =>
  scope.kind === 'one' ? scope.repository.id : scope.kind === 'loading' ? scope.asked : null

/** One group: a repository of the set and its rows, in the order they came. */
export interface Group<T> {
  repository: Repository
  rows: T[]
}

/**
 * The rows grouped by repository, one group per repository of the set in
 * listing order, and each group's rows in the order the page gave them
 * (oldest first on the inbox, most recent first on the portfolio). A
 * repository with no rows still has its group, so the page states that it
 * has none rather than leaving it out. A row whose repository is not in the
 * set is kept in a group of its own at the end, named by its id, so grouping
 * never drops a row.
 */
export function groupRows<T extends Sourced>(rows: readonly T[], set: readonly Repository[]): Group<T>[] {
  const groups = set.map((repository) => ({ repository, rows: [] as T[] }))
  const byId = new Map(groups.map((g) => [g.repository.id.toLowerCase(), g]))
  const strays: Group<T>[] = []
  for (const row of rows) {
    const key = row.source.toLowerCase()
    let group = byId.get(key)
    if (!group) {
      group = { repository: { id: row.source, name: row.sourceName || row.source, waiting: 0 }, rows: [] }
      byId.set(key, group)
      strays.push(group)
    }
    group.rows.push(row)
  }
  return [...groups, ...strays]
}

/**
 * Whether the page groups. Only a joined page of several repositories can:
 * under a one-repository scope there is one group, whose heading would repeat
 * the page heading, and with one repository in the set there is nothing to
 * group.
 */
export function grouped(params: URLSearchParams, scope: Scope, set: readonly Repository[]): boolean {
  return params.get(GROUP_PARAM) === GROUP_BY_REPOSITORY && scope.kind !== 'one' && set.length > 1
}

/** The pages the scope applies to. Any other page (a run, the new-run form) has no scope. */
export const SCOPED_PAGES = ['/', '/portfolio', '/metrics'] as const
export const isScopedPage = (pathname: string): boolean => (SCOPED_PAGES as readonly string[]).includes(pathname)

/**
 * A link to `path` under `repository` (an id, or null for the whole set).
 * `keep` carries the current page's other parameters (grouping) when the
 * link stays on the same page; a link to another page carries the scope and
 * nothing else.
 */
export function scopedHref(path: string, repository: string | null, keep?: URLSearchParams): string {
  const params = new URLSearchParams(keep)
  if (repository === null) params.delete(SCOPE_PARAM)
  else params.set(SCOPE_PARAM, repository)
  const q = params.toString()
  return q ? `${path}?${q}` : path
}

/**
 * The rail's Inbox badge: the whole set's count, and under a scope the
 * scope's count first — `3 of 30`. Counts are of items, whatever the inbox
 * collapses into one row (#499). With nothing waiting there is no badge,
 * unless some repository could not be read (`partial`): then nothing is
 * known to be waiting there, and the badge says `0` with the reason beside
 * it rather than disappearing.
 */
export function badgeText(total: number, scoped: number | null, partial = false): string | null {
  if (total === 0 && !partial) return null
  return scoped === null ? String(total) : `${scoped} of ${total}`
}

/**
 * How much of what a page shows could be read (§10): `all`, `some` (one or
 * more repositories in view could not be), or `none` (not one could). In
 * view means the scope's repository, or the whole set. An empty page says
 * "nothing is waiting" only when everything in view was read.
 */
export function readInView(scope: Scope, set: readonly Repository[]): 'all' | 'some' | 'none' {
  const shown = scope.kind === 'one' ? [scope.repository] : set
  const unread = shown.filter((r) => r.unreadable !== undefined).length
  if (unread === 0) return 'all'
  return unread === shown.length ? 'none' : 'some'
}

/** The browser tab's title on a scoped page: the page, then the repository — so two tabs can be told apart. */
export function scopeTitle(page: string, scope: Scope): string | null {
  return scope.kind === 'one' ? `${page} · ${scope.repository.name} — Gatehouse` : null
}
