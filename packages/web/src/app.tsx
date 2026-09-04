import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { api, formatAge, type EngineHealthEntry } from './api.ts'
import { pauseVoice } from './drift.ts'
import { useLiveInvalidation } from './use-live.ts'

function NavItem({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-[9px] rounded-[4px] px-[9px] py-[7px] text-xs transition-colors duration-[140ms] ${
          isActive ? 'bg-accent-tint text-accent-deep' : 'text-muted hover:bg-raised hover:text-ink'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isActive ? 'bg-accent' : 'bg-faint'
            }`}
          />
          <span className="flex-1">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-px font-mono text-[11px] font-semibold tabular-nums text-on-solid">
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
    <div className="mb-4 rounded-md border border-bad-line bg-bad-bg px-4 py-2.5 text-sm text-ink" role="alert">
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
        // Tone follows the cause, not the state (#222): a dirty tree is the
        // warn voice; the topology family, and an engine too old to say,
        // stay red.
        const voice = paused ? pauseVoice(entry) : null
        const alarmed = voice?.tone === 'bad'
        return (
          <span
            key={id}
            data-pause-tone={voice?.tone}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
              paused ? (alarmed ? 'border-bad-line bg-bad-bg text-bad' : 'border-warn-line bg-warn-bg text-warn') : 'border-line bg-surface text-ink'
            }`}
          >
            <span className={`${alarmed ? 'text-bad' : 'text-warn'} text-[9px] leading-none`}>●</span>
            {showId ? <span className="text-muted">{id}</span> : null}
            {paused && voice ? (
              // The monitor's own cause (which names the dirty paths, #222),
              // rendered in full and allowed to wrap: hiding it behind a
              // tooltip is the failure mode #185 exists to fix. Then the
              // consequence — the part that actually costs something — and,
              // when a dirty tree is also pinning the engine on stale code,
              // the upgrade queued behind it.
              <span>
                engine paused —{' '}
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
          </span>
        )
      })}
    </div>
  )
}

/**
 * What the engine is holding back and why (#97). A ceiling that clears
 * itself — the resource cap, the host spend window — defers a run rather
 * than pausing it, so nothing in the run's record says why it is not
 * moving; the heartbeat carries the reason instead. Rendered at the host
 * level because that is where the condition lives: the old shape wrote a
 * per-run escalation pointing at a state.yaml that contained no such
 * number, and the human who resolved it got the same card back on the next
 * tick. Warn tone, not alarm — nothing is wrong, the host is at its rate.
 */
function EngineDeferralChip() {
  const health = useQuery({ queryKey: ['engine-health'], queryFn: api.engineHealth, refetchInterval: 60_000 })
  const now = health.data?.now
  const rows = (Object.entries(health.data?.engines ?? {}) as [string, EngineHealthEntry | null][]).flatMap(([id, h]) =>
    (h?.deferrals ?? []).map((d) => ({ id, ...d })),
  )
  if (rows.length === 0 || now === undefined) return null
  const showId = new Set(rows.map((r) => r.id)).size > 1
  return (
    <div className="mb-4 flex flex-col gap-2" data-deferrals>
      {rows.map((d) => (
        <span
          key={`${d.id}:${d.slug}:${d.rule}`}
          className="inline-flex items-start gap-1.5 rounded-[5px] border border-warn-line bg-warn-bg px-2.5 py-1 text-xs font-medium text-warn"
        >
          <span className="text-[9px] leading-[1.7] text-warn">●</span>
          <span>
            {showId ? <span className="text-muted">{d.id} · </span> : null}
            engine holding back <b>{d.slug}</b> ({d.rule}) for {formatAge(Math.floor(Date.parse(d.since) / 1000), now)} — {d.reason}
          </span>
        </span>
      ))}
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
          <span className="gate-sigil mb-1.5 block" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
            </svg>
          </span>
          <span className="font-sans text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">Gatehouse</span>
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
        <span className="mr-2 flex items-center gap-1.5">
          <span className="gate-sigil" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
            </svg>
          </span>
          <span className="font-sans text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">Gatehouse</span>
        </span>
        <NavItem to="/" label="Inbox" badge={needs} end />
        <NavItem to="/portfolio" label="Portfolio" />
        <NavItem to="/metrics" label="Metrics" />
      </div>

      <main className="min-w-0 flex-1 px-6 py-6 max-md:pt-16">
        <EngineOutageBanner />
        <EngineDriftChip />
        <EngineDeferralChip />
        <Outlet />
      </main>
    </div>
  )
}
