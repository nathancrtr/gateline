import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { api, formatAge, type EngineHealthEntry } from './api.ts'
import { useLiveInvalidation } from './use-live.ts'

function NavItem({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-[9px] rounded-[4px] px-[9px] py-[7px] text-xs transition-colors duration-[140ms] ${
          isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isActive ? 'bg-accent shadow-[0_0_8px_var(--glow)]' : 'bg-faint'
            }`}
          />
          <span className="flex-1">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="pulse-glow rounded-full bg-accent px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-on-solid">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

/**
 * The Airflow lesson (#100): decisions landing with no engine consuming them
 * must read as an outage, never as "waiting on gate". Shown only when an
 * engine has reported on this deployment before and has gone silent —
 * viewer-only installs (no heartbeat file, engines[id] === null) get nothing.
 */
function EngineOutageBanner() {
  const health = useQuery({ queryKey: ['engine-health'], queryFn: api.engineHealth, refetchInterval: 60_000 })
  const stale = Object.entries(health.data?.engines ?? {}).filter(([, h]) => h?.stale)
  if (stale.length === 0) return null
  return (
    <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-2.5 text-sm text-ink" role="alert">
      <span className="font-semibold">The orchestrator does not appear to be running.</span>{' '}
      Decisions will be recorded but nothing will dispatch — last heartbeat{' '}
      {stale.map(([id, h]) => `${formatAge(Math.floor(Date.parse(h!.at) / 1000), health.data!.now)} ago (${id})`).join(', ')}.
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
 * tree, and reads as a stronger tone than plain drift. Shares the
 * ['engine-health'] query with EngineOutageBanner — react-query dedupes the
 * fetch by key, so this is not a second request.
 */
function EngineDriftChip() {
  const health = useQuery({ queryKey: ['engine-health'], queryFn: api.engineHealth, refetchInterval: 60_000 })
  const engines = Object.entries(health.data?.engines ?? {}) as [string, EngineHealthEntry | null][]
  const drifted = engines.filter(
    ([, h]) => h && (h.codeState === 'paused' || (h.commit !== undefined && h.codeHead !== undefined && h.commit !== h.codeHead)),
  )
  if (drifted.length === 0) return null
  const showId = drifted.length > 1
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {drifted.map(([id, h]) => {
        const entry = h as EngineHealthEntry
        const paused = entry.codeState === 'paused'
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              paused ? 'border-bad/40 bg-bad-soft text-bad' : 'border-line bg-surface text-ink'
            }`}
          >
            <span className={`${paused ? 'text-bad' : 'text-warn'} text-[9px] leading-none`}>●</span>
            {showId ? <span className="text-muted">{id}</span> : null}
            {paused ? (
              <span>
                engine paused — code tree at <code className="font-mono">{shortOid(entry.codeHead)}</code> not clean (engine at{' '}
                <code className="font-mono">{shortOid(entry.commit)}</code>)
              </span>
            ) : (
              <span>
                engine at <code className="font-mono">{shortOid(entry.commit)}</code> · main at <code className="font-mono">{shortOid(entry.codeHead)}</code>
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function App() {
  useLiveInvalidation()
  const inbox = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  const needs = inbox.data?.items.length

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl">
      <aside className="sticky top-0 flex h-dvh w-48 shrink-0 flex-col gap-[22px] border-r border-line bg-surface px-3 py-4 max-md:hidden">
        <div className="px-2 py-1.5">
          <span className="font-mono text-[15px] font-semibold uppercase leading-none tracking-[0.16em]">Gate</span>
          <p className="mt-1.5 text-[10.5px] leading-[1.35] text-faint">pipeline decisions</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          <NavItem to="/" label="Inbox" badge={needs} end />
          <NavItem to="/portfolio" label="Portfolio" />
          <NavItem to="/metrics" label="Metrics" />
        </nav>
        <div className="mt-auto p-2 font-mono text-[10px] leading-[1.6] text-faint">
          The repo is the database.
          <br />
          Every view renders git.
        </div>
      </aside>

      {/* Mobile top nav */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center gap-1 border-b border-line bg-ground/90 px-3 py-2 backdrop-blur md:hidden">
        <span className="mr-2 font-mono text-[15px] font-semibold uppercase leading-none tracking-[0.16em]">Gate</span>
        <NavItem to="/" label="Inbox" badge={needs} end />
        <NavItem to="/portfolio" label="Portfolio" />
        <NavItem to="/metrics" label="Metrics" />
      </div>

      <main className="min-w-0 flex-1 px-6 py-6 max-md:pt-16">
        <EngineOutageBanner />
        <EngineDriftChip />
        <Outlet />
      </main>
    </div>
  )
}
