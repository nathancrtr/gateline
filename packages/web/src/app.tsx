import { useQuery } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router-dom'
import { api, type EngineHealthEntry, formatAge } from './api.ts'
import { pauseVoice } from './drift.ts'
import { useLiveInvalidation } from './use-live.ts'

/** One entry in the rack: the name, and the count where there is one. Plain
 *  type; the active entry is the one in the signal blue, as on the site. */
function NavItem({ to, label, badge, end }: { to: string; label: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-baseline justify-between gap-3 py-[3px] font-ui text-[14px] ${isActive ? 'font-semibold text-accent' : 'text-muted hover:text-ink'}`
      }
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="font-ui text-[12px] tabular-nums">{badge}</span>}
    </NavLink>
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
    <div className="mb-4 border-t border-b border-mark py-2.5 text-sm text-ink" role="alert">
      <span className="font-semibold text-bad">The orchestrator does not appear to be running.</span>{' '}
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
    <div className="mb-4 flex flex-col gap-2">
      {drifted.map(([id, h]) => {
        const entry = h as EngineHealthEntry
        const paused = entry.codeState === 'paused'
        // Tone follows the cause, not the state (#222): a dirty tree is the
        // warn voice; the topology family, and an engine too old to say,
        // stay red. The rule above and below takes the voice's colour, the
        // heading word takes it in the red case; the words carry the rest.
        const voice = paused ? pauseVoice(entry) : null
        const alarmed = voice?.tone === 'bad'
        return (
          <p
            key={id}
            data-pause-tone={voice?.tone}
            className={`border-t border-b py-2 text-xs ${paused ? (alarmed ? 'border-mark' : 'border-warn') : 'border-line'} ${alarmed ? 'text-ink' : 'text-muted'}`}
          >
            {showId ? <span className="font-mono text-muted">{id} · </span> : null}
            {paused && voice ? (
              // The monitor's own cause (which names the dirty paths, #222),
              // rendered in full and allowed to wrap: hiding it behind a
              // tooltip is the failure mode #185 exists to fix.
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
 * level because that is where the condition lives. Quiet, not alarm —
 * nothing is wrong, the host is at its rate.
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
        <p key={`${d.id}:${d.slug}:${d.rule}`} className="border-t border-b border-line py-2 text-xs text-muted">
          {showId ? <span className="font-mono">{d.id} · </span> : null}
          engine holding back <b className="text-ink">{d.slug}</b> ({d.rule}) for {formatAge(Math.floor(Date.parse(d.since) / 1000), now)} —{' '}
          {d.reason}
        </p>
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
      {/* The rack: name, the three surfaces with their counts, and the one
          line of voice. Same page as the content, a rule between. */}
      <aside className="sticky top-0 flex h-dvh w-[200px] shrink-0 flex-col gap-[26px] border-r border-line py-[30px] pl-[26px] pr-[22px] max-md:hidden">
        <div>
          <div className="flex items-center gap-2">
            <Sigil size={16} />
            <span className="wordmark text-[16px] leading-none text-ink">Gatehouse</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-[1.35] text-muted">pipeline decisions</p>
        </div>
        <nav className="flex flex-col gap-1">
          <NavItem to="/" label="Inbox" badge={needs} end />
          <NavItem to="/portfolio" label="Portfolio" />
          <NavItem to="/metrics" label="Metrics" />
        </nav>
        <div className="mt-auto font-ui text-[10.5px] leading-[1.6] text-muted">
          The repo is the database.
          <br />
          Every view renders git.
        </div>
      </aside>

      {/* Mobile top nav. It sits over the body's ink band, so it carries the band itself. */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center gap-4 border-b border-t-[3px] border-line border-t-ink bg-ground px-4 py-2.5 md:hidden">
        <span className="mr-2 flex items-center gap-1.5">
          <Sigil size={14} />
          <span className="wordmark text-[15px] leading-none text-ink">Gatehouse</span>
        </span>
        <NavItem to="/" label="Inbox" badge={needs} end />
        <NavItem to="/portfolio" label="Portfolio" />
        <NavItem to="/metrics" label="Metrics" />
      </div>

      <main className="min-w-0 flex-1 px-8 py-[30px] max-md:px-4 max-md:pt-16">
        <EngineOutageBanner />
        <EngineDriftChip />
        <EngineDeferralChip />
        <Outlet />
      </main>
    </div>
  )
}
