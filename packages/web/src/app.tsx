import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { type EngineHealthEntry, formatAge } from './api.ts'
import { hasFacts, RepositoryFacts, useEngineHealth } from './components/liveness.tsx'
import { useServedRepositories } from './components/repository.tsx'
import { InboxBadge, ScopeControl, ScopedNavLink, type ScopeState, useScope } from './components/scope.tsx'
import { pauseVoice } from './drift.ts'
import { DEFERRAL_LIMIT_WORDS, driftOf, livenessOf } from './liveness.ts'
import { useLiveInvalidation } from './use-live.ts'

/**
 * The rack's three surfaces. Plain type; the active entry is the one in the
 * signal blue, as on the site. Each link carries the scope (#498), so moving
 * between Inbox, Portfolio and Metrics keeps it; the Inbox's count is the
 * whole set's, and under a scope reads `3 of 30`.
 */
function NavItems({ state }: { state: ScopeState }) {
  return (
    <>
      <ScopedNavLink to="/" label="Inbox" state={state} end badge={<InboxBadge state={state} />} />
      <ScopedNavLink to="/portfolio" label="Portfolio" state={state} />
      <ScopedNavLink to="/metrics" label="Metrics" state={state} />
    </>
  )
}

function Sigil({ size }: { size: number }) {
  return (
    <span className="gate-sigil" aria-hidden="true">
      <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}>
        <rect x="3.5" y="3" width="2.6" height="18" fill="currentColor" />
        <rect x="17.9" y="3" width="2.6" height="18" fill="currentColor" />
        <rect x="3.5" y="8.6" width="17" height="2.2" fill="currentColor" />
      </svg>
    </span>
  )
}

/** A repository named in a mark: its display name, its full id on hover (docs/SEAM.md §2: an address follows a name). */
function Named({ id, name }: { id: string; name: string }) {
  return (
    <span className="font-semibold" title={id} data-named-repository={id}>
      {name}
    </span>
  )
}

/** "a", "a and b", "a, b and c", as React nodes. */
function andList(nodes: ReactNode[]): ReactNode[] {
  return nodes.flatMap((node, i) => (i === 0 ? [node] : [i === nodes.length - 1 ? ' and ' : ', ', node]))
}

/**
 * The Airflow lesson (#100): decisions landing with no engine consuming them
 * must read as an outage, never as "waiting on gate". Raised for a
 * repository where an engine is expected and is not reporting: a `dispatch`
 * repository whose heartbeat is stale or was never written (MULTI-REPO.md
 * §9.5, #499). A `view` or `decide` repository expects no engine, so its
 * heartbeat — absent, stale or fresh — is a plain fact beside its name in the
 * rail, and never this banner. A repository whose mode the server does not
 * state keeps the rule from before modes: a stale heartbeat is an outage.
 *
 * Names each repository by its display name, the full id on hover.
 */
function EngineOutageBanner() {
  const health = useEngineHealth()
  const served = useServedRepositories()
  const engines = health.data?.engines ?? {}
  const now = health.data?.now
  const ids = served.ids.length > 0 ? served.ids : Object.keys(engines)
  const silent = ids.filter((id) => livenessOf(served.modeOf(id), engines[id]) === 'silent')
  if (silent.length === 0 || now === undefined) return null
  const heartbeat = (id: string) => {
    const entry = engines[id]
    return entry ? `${formatAge(Math.floor(Date.parse(entry.at) / 1000), now)} ago` : null
  }
  const one = silent.length === 1
  return (
    <div className="mb-4 border-t border-b border-mark py-2.5 text-sm text-ink" role="alert" data-engine-outage>
      <span className="font-semibold text-bad">
        The orchestrator does not appear to be running in {andList(silent.map((id) => <Named key={id} id={id} name={served.nameOf(id)} />))}.
      </span>{' '}
      Decisions will be recorded but nothing will dispatch —{' '}
      {one
        ? heartbeat(silent[0]!) === null
          ? 'no heartbeat has been written.'
          : `last heartbeat ${heartbeat(silent[0]!)}.`
        : `last heartbeat ${silent.map((id) => `${served.nameOf(id)} ${heartbeat(id) ?? 'never'}`).join(', ')}.`}
    </div>
  )
}

const shortOid = (oid: string | undefined) => (oid ? oid.slice(0, 7) : '?')

/**
 * Self-supersede (#141): the heartbeat carries the commit the engine loaded
 * at start (`commit`) and the code tree's on-disk HEAD as of its last
 * boundary check (`codeHead`). Drift is derived purely from those two
 * fields — no server-side git call. `paused` is the load-bearing state: the
 * engine is deliberately idle, refusing to dispatch on a mixed/dirty code
 * tree, and reads as a stronger tone than plain drift.
 *
 * Shown once, naming no repository (MULTI-REPO.md §9.5, #499). Each engine
 * writes it into its own repository's heartbeat, but it describes the one
 * code checkout the process runs from; `driftOf` says which heartbeat speaks
 * for it. Shares the ['engine-health'] query with the banner — react-query
 * dedupes the fetch by key, so this is not a second request.
 */
function EngineDriftChip() {
  const health = useEngineHealth()
  const entry = driftOf(health.data?.engines ?? {})
  if (entry === null) return null
  const paused = entry.codeState === 'paused'
  // Tone follows the cause, not the state (#222): a dirty tree is the warn
  // voice; the topology family, and an engine too old to say, stay red. The
  // rule above and below takes the voice's colour, the heading word takes it
  // in the red case; the words carry the rest.
  const voice = paused ? pauseVoice(entry) : null
  const alarmed = voice?.tone === 'bad'
  return (
    <div className="mb-4 flex flex-col gap-2" data-engine-drift>
      <p
        data-pause-tone={voice?.tone}
        className={`border-t border-b py-2 text-xs ${paused ? (alarmed ? 'border-mark' : 'border-warn') : 'border-line'} ${alarmed ? 'text-ink' : 'text-muted'}`}
      >
        {paused && voice ? (
          // The monitor's own cause (which names the dirty paths, #222),
          // rendered in full and allowed to wrap: hiding it behind a tooltip
          // is the failure mode #185 exists to fix.
          <span>
            <b className={`font-semibold ${alarmed ? 'text-bad' : 'text-ink'}`}>engine paused</b> —{' '}
            {entry.codeReason ?? (
              <>
                code tree at <code className="font-mono">{shortOid(entry.codeHead)}</code> not clean
              </>
            )}{' '}
            (engine at <code className="font-mono">{shortOid(entry.commit)}</code>, tree at{' '}
            <code className="font-mono">{shortOid(entry.codeHead)}</code>). {voice.consequence}
            {entry.codeUpgradeBlocked && (
              <>
                {' '}
                An upgrade to <code className="font-mono">{shortOid(entry.codeHead)}</code> is queued behind the dirty tree.
              </>
            )}
          </span>
        ) : (
          <span>
            engine at <code className="font-mono">{shortOid(entry.commit)}</code> · main at <code className="font-mono">{shortOid(entry.codeHead)}</code>
          </span>
        )}
      </p>
    </div>
  )
}

/** Which limit held a dispatch (#513), in words, or its token as written when the words are not known. */
function LimitWords({ limit }: { limit: string }) {
  if (Object.hasOwn(DEFERRAL_LIMIT_WORDS, limit)) return <>{DEFERRAL_LIMIT_WORDS[limit]}</>
  return (
    <>
      the limit <code className="font-mono">{limit}</code>
    </>
  )
}

/**
 * What the engine is holding back and why (#97). A ceiling that clears
 * itself — the resource cap, the host spend window — defers a run rather
 * than pausing it, so nothing in the run's record says why it is not
 * moving; the heartbeat carries the reason instead. Rendered at the host
 * level because that is where the condition lives. Quiet, not alarm —
 * nothing is wrong, the host is at its rate.
 *
 * Each mark says which limit held the run, when the governor names one
 * (#513), and names the run's repository by display name when the set has
 * several, as a row does; the full id is on hover. The repository is the one
 * whose heartbeat carried the deferral, which is the repository its engine
 * runs in.
 */
function EngineDeferralChip({ several }: { several: boolean }) {
  const health = useEngineHealth()
  const served = useServedRepositories()
  const now = health.data?.now
  const rows = (Object.entries(health.data?.engines ?? {}) as [string, EngineHealthEntry | null][]).flatMap(([id, h]) =>
    (h?.deferrals ?? []).map((d) => ({ id, ...d })),
  )
  if (rows.length === 0 || now === undefined) return null
  return (
    <div className="mb-4 flex flex-col gap-2" data-deferrals>
      {rows.map((d) => (
        <p key={`${d.id}:${d.slug}:${d.rule}`} className="border-t border-b border-line py-2 text-xs text-muted" data-deferral={d.slug}>
          engine holding back <b className="text-ink">{d.slug}</b>
          {several && (
            <>
              {' '}
              in <Named id={d.id} name={served.nameOf(d.id)} />
            </>
          )}{' '}
          ({d.rule}
          {d.limit !== undefined && (
            <>
              , held by <LimitWords limit={d.limit} />
            </>
          )}
          ) for {formatAge(Math.floor(Date.parse(d.since) / 1000), now)} — {d.reason}
        </p>
      ))}
    </div>
  )
}

/**
 * The one repository's standing facts, at the rail's foot, when the set has
 * one and there is no scope control to carry them (#499): its mode, and its
 * engine where that is a plain fact. The foot is where the rail's own
 * standing text already sits, below everything a reader acts on.
 */
function RailFootFacts({ state }: { state: ScopeState }) {
  const health = useEngineHealth()
  const repository = state.set[0]
  if (state.several || state.set.length !== 1 || !repository) return null
  return <RepositoryFacts repository={repository} entry={health.data?.engines[repository.id]} now={health.data?.now} className="mb-3" />
}

/**
 * Below 768px the rail is a top bar with room for navigation only, so the
 * standing facts it carries at the side sink to the foot of the page: each
 * repository's name when the set has several, and its facts. Alarms stay at
 * the top of the page, where the banner is.
 */
function PageFootFacts({ state }: { state: ScopeState }) {
  const health = useEngineHealth()
  const several = state.several && state.set.length > 1
  const rows = state.set.map((r) => ({ r, facts: <RepositoryFacts repository={r} entry={health.data?.engines[r.id]} now={health.data?.now} /> }))
  if (!state.set.some((r) => hasFacts(r, health.data?.engines[r.id]))) return null
  return (
    <footer className="mt-10 border-t border-line pt-3 md:hidden" data-page-foot-facts>
      {several ? (
        <ul className="flex flex-col gap-2">
          {rows.map(({ r, facts }) => (
            <li key={r.id}>
              <p className="font-ui text-[12.5px] text-ink" title={r.id}>
                {r.name}
              </p>
              {facts}
            </li>
          ))}
        </ul>
      ) : (
        rows[0]!.facts
      )}
    </footer>
  )
}

export function App() {
  useLiveInvalidation()
  const scope = useScope()
  const several = scope.several && scope.set.length > 1

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl">
      {/* The rack: name, the scope (#498) when the set has several
          repositories, the three surfaces with their counts, and the one line
          of voice. Same page as the content, a rule between. */}
      <aside className="sticky top-0 flex h-dvh w-[200px] shrink-0 flex-col gap-[26px] overflow-y-auto border-r border-line py-[30px] pl-[26px] pr-[22px] max-md:hidden">
        <div>
          <div className="flex items-center gap-2">
            <Sigil size={16} />
            <span className="wordmark text-[16px] leading-none text-ink">Gatehouse</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-[1.35] text-muted">pipeline decisions</p>
        </div>
        <ScopeControl state={scope} />
        <nav className="flex flex-col gap-1">
          <NavItems state={scope} />
        </nav>
        <div className="mt-auto">
          <RailFootFacts state={scope} />
          <div className="font-ui text-[10.5px] leading-[1.6] text-muted">
            The repo is the database.
            <br />
            Every view renders git.
          </div>
        </div>
      </aside>

      {/* Mobile top nav. It sits over the body's ink band, so it carries the
          band itself. With several repositories the scope is its second row,
          as it is the rack's second block. */}
      <div className="fixed inset-x-0 top-0 z-10 border-b border-t-[3px] border-line border-t-ink bg-ground px-4 md:hidden" data-top-bar>
        <div className="flex items-center gap-4 py-2.5">
          <span className="mr-2 flex items-center gap-1.5">
            <Sigil size={14} />
            <span className="wordmark text-[15px] leading-none text-ink">Gatehouse</span>
          </span>
          <NavItems state={scope} />
        </div>
        {several && (
          <div className="border-t border-line py-1.5">
            <ScopeControl state={scope} strip />
          </div>
        )}
      </div>

      <main className={`min-w-0 flex-1 px-8 py-[30px] max-md:px-4 ${several ? 'max-md:pt-[104px]' : 'max-md:pt-16'}`}>
        <EngineOutageBanner />
        <EngineDriftChip />
        <EngineDeferralChip several={several} />
        <Outlet />
        <PageFootFacts state={scope} />
      </main>
    </div>
  )
}
