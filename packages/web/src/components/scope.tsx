// The scope control, the page heading under a scope, and the group heading
// (#498; docs/MULTI-REPO.md §9.1, §9.2). What is computed lives in
// `../scope.ts`; this file is the markup.
//
// Decision D7 holds throughout: a repository is told apart by its text, never
// by colour, glyph or mark. The control's entries, the page heading and the
// group headings name a repository by its display name, followed by its full
// id as an Address (docs/SEAM.md §5: an address never stands alone, it
// follows a name), and they count in the UI face. The one colour spent is
// the rail's existing "current" treatment, the signal blue on the entry the
// reader is on, which is where the blue already goes.
//
// Every piece is hidden when the set has one repository, so a single-
// repository deployment looks exactly as it did before the scope existed.

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom'
import { api, type UnreadableRepository } from '../api.ts'
import {
  badgeText,
  GROUP_BY_REPOSITORY,
  GROUP_PARAM,
  type Group,
  grouped,
  inScope,
  isScopedPage,
  type Repository,
  repositoriesOf,
  resolveScope,
  SCOPE_PARAM,
  type Scope,
  scopedHref,
  scopeId,
} from '../scope.ts'
import { RepositoryFacts, useEngineHealth, useSharedStanding } from './liveness.tsx'
import { Address, Count } from './vocabulary.tsx'

export interface ScopeState {
  /** False while the set, its names or its counts are still loading. */
  ready: boolean
  /** The set, in listing order (`compareRepositories`). Empty when it could not be read. */
  set: Repository[]
  /** True when the set has several repositories — or could not be read, where naming is never ambiguous. */
  several: boolean
  scope: Scope
  /** Whether this page is grouped by repository. */
  grouped: boolean
  /** The whole inbox's count, unscoped: items, whatever collapses into one row (#499). */
  total: number
  /** The scope's count of waiting decisions, or null when the page shows the whole set. */
  scoped: number | null
  /** The repositories that could not be read (§10), whose decisions no count includes. */
  unreadable: UnreadableRepository[]
}

/**
 * The scope, read from the URL alone (decision P9) and resolved against the
 * set. The set, with each repository's display name and mode, is
 * `/api/health`'s (#499); counts come from the inbox, which the rail already
 * fetches on every page, and so does the list of repositories that could not
 * be read. A server built before #499 lists bare ids, and a repository with
 * nothing waiting is then named by its id.
 *
 * `setKnown` — whether the served set itself is known — is `health.data !==
 * undefined` alone, not `ready` below: a page's full loading gate also waits
 * on the inbox, but resolving `?repo=` only needs to know what is served
 * (#551). While `/api/health` is still in flight, or has failed outright, the
 * set is not known, so the scope reads `loading` rather than guessing
 * `unknown` — a repository that never answers keeps the URL's scope forever,
 * which is the safe default.
 */
export function useScope(): ScopeState {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: Number.POSITIVE_INFINITY })
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  const ids = health.data?.sources ?? []
  const items = inbox.data?.items ?? []
  const unreadable = inbox.data?.unreadable ?? []
  const set = repositoriesOf(health.data?.repositories ?? ids, items, items, unreadable)
  const loaded = (q: { data?: unknown; isError: boolean }) => q.data !== undefined || q.isError
  const ready = loaded(health) && loaded(inbox)
  const setKnown = health.data !== undefined
  const several = health.data ? ids.length > 1 : true
  const scope = resolveScope(isScopedPage(pathname) ? params.get(SCOPE_PARAM) : null, set, setKnown)
  return {
    ready,
    set,
    several,
    scope,
    grouped: grouped(params, scope, set),
    total: items.length,
    scoped: scope.kind === 'one' ? inScope(items, scope).length : null,
    unreadable,
  }
}

/** The rows a page shows under the scope. */
export { inScope }

// ---------------------------------------------------------------------------
// The rail.

/**
 * Where a scope entry leads: the page the reader is on, under that
 * repository, keeping the page's grouping; from a page with no scope (a run,
 * the new-run form), the Inbox.
 */
function entryHref(pathname: string, params: URLSearchParams, repository: string | null): string {
  if (!isScopedPage(pathname)) return scopedHref('/', repository)
  const keep = new URLSearchParams(params)
  return scopedHref(pathname, repository, keep)
}

/**
 * The scope control: a list of links, one per repository of the set plus
 * one for all of them, each with its count of waiting decisions. Links,
 * because each entry is a place — a URL a reader can reload, bookmark, open
 * in a new tab or paste — and the scope lives in the URL alone; a select or
 * a set of buttons would make it a setting. The current entry takes the
 * rail's own current treatment and `aria-current`.
 *
 * A screen reader hears a navigation region named "Repository scope", then a
 * list of links, each its name and count: "All repositories, 30 waiting",
 * "demo-small, 3 waiting, current page".
 *
 * `strip` is the narrow form (below 768px, where the rail becomes the top
 * bar): the same links in one row that scrolls sideways inside itself, so the
 * bar keeps a fixed height and the page never scrolls sideways.
 *
 * A repository that could not be read (§10) is still listed, since it is
 * still served and its scope is still a place. It has no count, because its
 * count is unknown and `0` would claim that nothing waits there; it says in
 * words that it could not be read, and a screen reader hears "billing, could
 * not be read". The "All repositories" count is what could be read, and its
 * title says what it leaves out.
 *
 * Under each repository's link, the rail states its standing facts (#499):
 * its mode, and its engine where that is a plain fact (`RepositoryFacts`).
 * They sit outside the link, so a reader moving through the links hears each
 * place by its name and count alone. The strip leaves them out; at phone
 * width they are at the foot of the page. When every repository that could
 * be read shares its mode and engine state, no entry states them: the rail's
 * foot says them once for the set. A repository that could not be read keeps
 * its own mark either way.
 */
export function ScopeControl({ state, strip = false }: { state: ScopeState; strip?: boolean }) {
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const health = useEngineHealth()
  const shared = useSharedStanding(state.set)
  if (!state.several || state.set.length < 2) return null
  const current = scopeId(state.scope)
  const partial = state.unreadable.length > 0
  const entries: { id: string | null; name: string; waiting: number | null; title: string; repository: Repository | null }[] = [
    {
      id: null,
      name: 'All repositories',
      waiting: state.total,
      title: partial
        ? `Every repository this deployment serves. The count leaves out ${unreadableNames(state.unreadable)}, which could not be read`
        : 'Every repository this deployment serves',
      repository: null,
    },
    ...state.set.map((r) => ({ id: r.id, name: r.name, waiting: r.unreadable === undefined ? r.waiting : null, title: r.id, repository: r })),
  ]
  const onScopedPage = isScopedPage(pathname)
  return (
    <nav aria-label="Repository scope" data-scope-control>
      {!strip && <p className="mb-1 font-ui text-[11.5px] text-muted">Repositories</p>}
      <ul className={strip ? 'flex gap-4 overflow-x-auto whitespace-nowrap' : 'flex flex-col gap-1'}>
        {entries.map((e) => {
          const isCurrent = onScopedPage && (e.id === null ? current === null : current !== null && current === e.id)
          return (
            <li key={e.id ?? '*'} className={strip ? 'shrink-0' : ''} data-scope-item={e.id ?? ''}>
              <Link
                to={entryHref(pathname, params, e.id)}
                title={e.title}
                aria-current={isCurrent ? 'page' : undefined}
                data-scope-entry={e.id ?? ''}
                className={`flex items-baseline justify-between gap-3 py-[3px] font-ui text-[14px] ${isCurrent ? 'font-semibold text-accent' : 'text-muted hover:text-ink'}`}
              >
                {/* Cut with an ellipsis where it would crowd the count: at the
                    rail's width, and at 20 characters in the strip, the cap a
                    repository's name takes on rows. The title carries the id. */}
                <span className={strip ? 'inline-block max-w-[20ch] truncate align-bottom' : 'min-w-0 truncate'} data-scope-name>
                  {e.name}
                </span>
                {e.waiting === null ? (
                  // No count, since it is unknown. In the rail the words are
                  // the facts line under the link, and here only a screen
                  // reader hears them; the strip has no facts line and shows
                  // them in the count's place.
                  <span className={`font-ui text-[12px] text-warn ${strip ? '' : 'sr-only'}`} data-scope-count="unknown">
                    {strip ? 'could not be read' : ', could not be read'}
                  </span>
                ) : (
                  <span className="font-ui text-[12px] tabular-nums" data-scope-count={e.waiting}>
                    {e.waiting}
                    <span className="sr-only"> waiting</span>
                  </span>
                )}
              </Link>
              {!strip && e.repository && (shared === null || e.repository.unreadable !== undefined) && (
                <RepositoryFacts repository={e.repository} entry={health.data?.engines[e.repository.id]} now={health.data?.now} className="pb-1" />
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The unreadable repositories' names as a phrase: "billing", "billing and ledger", "billing, ledger and infra". */
export function unreadableNames(unreadable: readonly Pick<UnreadableRepository, 'sourceName' | 'source'>[]): string {
  const names = unreadable.map((u) => u.sourceName || u.source)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * The Inbox badge. It always counts the whole set; under a scope it reads as
 * two numbers, the scope's first — `3 of 30` — so a decision waiting outside
 * the scope stays visible as a number (§9.1). Screen readers hear it in words:
 * "3 waiting in demo-small, 30 in all repositories".
 */
export function InboxBadge({ state }: { state: ScopeState }) {
  const partial = state.unreadable.length > 0
  const text = badgeText(state.total, state.scoped, partial)
  if (text === null) return null
  if (state.scope.kind !== 'one' && !partial) return <span className="font-ui text-[12px] tabular-nums" data-inbox-badge>{text}</span>
  // With a repository that could not be read, the number is what could be
  // read. The badge keeps its size and says so in its title and to a screen
  // reader: the number alone would claim to be the whole set's.
  const left = partial ? `. Not counted: ${unreadableNames(state.unreadable)}, which could not be read` : ''
  const heard =
    state.scope.kind === 'one'
      ? `${state.scoped} waiting in ${state.scope.repository.name}, ${state.total} in all repositories${left}`
      : `${state.total} waiting${left}`
  return (
    <span className="font-ui text-[12px] tabular-nums" data-inbox-badge title={partial ? heard : undefined}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{heard}</span>
    </span>
  )
}

/** A rail link to one of the scoped pages, carrying the scope. */
export function ScopedNavLink({
  to,
  label,
  state,
  end,
  badge,
}: {
  to: string
  label: string
  state: ScopeState
  end?: boolean
  badge?: ReactNode
}) {
  return (
    <NavLink
      to={scopedHref(to, scopeId(state.scope))}
      end={end}
      className={({ isActive }) =>
        `flex items-baseline justify-between gap-3 py-[3px] font-ui text-[14px] ${isActive ? 'font-semibold text-accent' : 'text-muted hover:text-ink'}`
      }
    >
      <span>{label}</span>
      {badge}
    </NavLink>
  )
}

// ---------------------------------------------------------------------------
// The page.

/**
 * The repository a scoped page shows, stated once, above the page's title:
 * the display name, then the full id as its Address. The rows below leave the
 * name off (decision D7). Nothing is rendered unless the scope is one
 * repository.
 */
export function ScopeHeading({ scope }: { scope: Scope }) {
  if (scope.kind !== 'one') return null
  return (
    <p className="mb-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[12.5px] leading-[1.6]" data-scope-heading>
      <span className="font-semibold break-all text-ink" data-scope-heading-name>
        {scope.repository.name}
      </span>
      <Address className="break-all">{scope.repository.id}</Address>
    </p>
  )
}

/**
 * The line under a scoped page's description: how many decisions wait
 * outside the scope, on the Inbox, and the way back to the whole set on every
 * scoped page. `outside` is null where the page does not count decisions.
 */
export function ScopeLine({ scope, outside, path }: { scope: Scope; outside: number | null; path: string }) {
  const [params] = useSearchParams()
  if (scope.kind !== 'one') return null
  const all = new URLSearchParams(params)
  return (
    <p className="mt-1 font-ui text-[12.5px] text-muted" data-scope-line>
      {outside !== null && (
        <>
          <Count n={outside} one="decision is" many="decisions are" /> waiting in other repositories.{' '}
        </>
      )}
      <Link to={scopedHref(path, null, all)} className="text-accent underline underline-offset-2 hover:text-accent-hover" data-scope-all>
        Show all repositories
      </Link>
    </p>
  )
}

/**
 * `?repo=` named a repository this deployment does not serve. The page shows
 * every repository, and says so once, here; it never shows an empty page for
 * a mistyped or stale link. The caution field: something to look at, with
 * nothing wrong in the record.
 */
export function UnknownScopeNotice({ scope }: { scope: Scope }) {
  if (scope.kind !== 'unknown') return null
  return (
    <p className="mt-3 border border-warn-line bg-warn-bg px-2.5 py-2 font-ui text-[12.5px] leading-[1.5] break-words text-warn" role="status" data-scope-unknown>
      No repository <span className="font-mono break-all">{scope.asked}</span> is served here, so every repository is shown.
    </p>
  )
}

/**
 * The grouping toggle. A button that presses in, because grouping rearranges
 * the page the reader is on rather than going somewhere; its state is still
 * kept in the URL (`?group=repository`), so a grouped page reloads grouped
 * and can be linked. Shown only where grouping has something to group: a
 * joined page over several repositories. Under a one-repository scope it is
 * hidden, since one group would only repeat the page heading, and a disabled
 * control would offer a feature with nothing to do.
 *
 * A screen reader hears "Group by repository, toggle button, pressed" (or
 * "not pressed").
 */
export function GroupToggle({ state }: { state: ScopeState }) {
  const [params, setParams] = useSearchParams()
  if (!state.several || state.set.length < 2 || state.scope.kind === 'one') return null
  const on = state.grouped
  return (
    <button
      type="button"
      aria-pressed={on}
      data-group-toggle
      className={`pb-[3px] font-ui text-[12.5px] font-medium ${on ? 'text-ink shadow-[inset_0_-1.5px_0_var(--color-ink)]' : 'text-muted hover:text-ink'}`}
      onClick={() => {
        const next = new URLSearchParams(params)
        if (on) next.delete(GROUP_PARAM)
        else next.set(GROUP_PARAM, GROUP_BY_REPOSITORY)
        setParams(next)
      }}
    >
      Group by repository
    </button>
  )
}

/**
 * What a group heading is made of, in order: the display name, the full id
 * as its Address, and the counts. `counts` is the page's own sentence of
 * counts ("3 entries"; "4 runs, 2 need you"), composed by the page in the
 * cockpit's voice.
 */
export function GroupHeadingContent({ group, counts }: { group: Group<unknown>; counts: ReactNode }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-group-heading={group.repository.id}>
      <span className="font-mono text-[13.5px] font-semibold break-all text-ink" data-group-name>
        {group.repository.name}
      </span>
      <Address className="break-all">{group.repository.id}</Address>
      <span className="font-ui text-[12px] font-normal text-muted" data-group-counts>
        {counts}
      </span>
    </span>
  )
}
