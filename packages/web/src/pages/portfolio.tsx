// I6: every run × source at a glance.
import { type ReactNode, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, formatAge, type RunSummary } from '../api.ts'
import { BudgetMeter, GateLedger, PhaseChip } from '../components/chips.tsx'
import { PageStatus } from './inbox.tsx'
import { EdgeFade, useScrollCue } from '../scroll-cue.tsx'

// Candidate A header: sans, medium weight, tight letter-spacing.
const TH =
  'text-left font-sans font-medium text-[11px] tracking-[0.1em] uppercase text-muted px-3 py-3.5 border-b border-line whitespace-nowrap'
const TD = 'px-3 py-[14px]'
const NUM = 'px-3 py-[14px] text-right font-mono text-[12.5px] tabular-nums text-[#4d4742]'

/**
 * What the mark at the left edge of a run row says (#297).
 *
 * This used to be the last cell of the last column, which is the one place it
 * could not survive: the table is wider than its wrapper from about 1000px
 * down, so the column the page exists for was the first thing clipped — and
 * clipped silently. Deciding the mark here rather than inline keeps the
 * precedence testable: readiness first (it already counts escalations that
 * have become someone's move), then escalations that have not, then quiet.
 */
export type NeedsYouMark =
  | { kind: 'needs'; count: number; label: string }
  | { kind: 'escalation'; count: number; label: string }
  | { kind: 'quiet'; count: 0; label: string }

export function needsYouMark(run: Pick<RunSummary, 'needsHuman' | 'escalationsOpen'>): NeedsYouMark {
  if (run.needsHuman > 0) {
    const n = run.needsHuman
    return { kind: 'needs', count: n, label: `${n} ${n === 1 ? 'item needs' : 'items need'} you` }
  }
  if (run.escalationsOpen > 0) {
    const n = run.escalationsOpen
    return { kind: 'escalation', count: n, label: `${n} open escalation${n === 1 ? '' : 's'}` }
  }
  return { kind: 'quiet', count: 0, label: 'nothing needs you' }
}

export { scrollCue } from '../scroll-cue.tsx'

/**
 * The table's pane: the same contained horizontal scroll as before, plus the
 * cue that says it is scrolling. The fade sits above the rows rather than in
 * the pane's background, so a tinted row (a malformed run) cannot paint over
 * it, and the hint line spells out in words what the fade only implies.
 */
function ScrollPane({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const cue = useScrollCue(ref)
  const clipped = cue.left || cue.right
  return (
    <div className="mt-[30px]">
      <div className="relative">
        <div
          ref={ref}
          className="overflow-x-auto rounded-lg border border-line bg-inset p-[6px]"
          {...(clipped ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}
        >
          {children}
        </div>
        {cue.left && <EdgeFade edge="left" radius="rounded-l-lg" />}
        {cue.right && <EdgeFade edge="right" radius="rounded-r-lg" />}
      </div>
      {clipped && (
        <p className="mt-[7px] text-[11.5px] text-muted">
          Wider than the pane — scroll sideways for the remaining columns.
        </p>
      )}
    </div>
  )
}

/**
 * The left-edge mark. Fixed width so every slug starts at the same x: the
 * marks then read as a rail down the left edge, which is the scan the page
 * exists for. A quiet run leaves the slot empty — absence says it, and a
 * dashed placeholder on every calm row was noise competing with the badges.
 */
function NeedsYou({ mark }: { mark: NeedsYouMark }) {
  if (mark.kind === 'quiet') return <span aria-hidden="true" className="w-[38px] shrink-0" />
  if (mark.kind === 'escalation') {
    return (
      <span
        className="mt-[3px] w-[38px] shrink-0 whitespace-nowrap font-mono text-[11px] font-semibold text-bad"
        title={mark.label}
      >
        {mark.count} esc
      </span>
    )
  }
  return (
    <span className="mt-px w-[38px] shrink-0" title={mark.label}>
      <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-[#8a3a1e] bg-accent px-[6px] font-sans text-[12px] font-bold tabular-nums text-white">
        {mark.count}
      </span>
    </span>
  )
}

export function PortfolioPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs })

  if (isLoading) {
    return (
      <div>
        <div className="overflow-hidden rounded-lg border border-line bg-inset p-[6px]">
          {[130, 110, 150].map((w, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-3 py-[14px] last:border-b-0">
              <span className="skel h-[22px] w-[22px] rounded-full" />
              <span className="skel h-[14px]" style={{ width: w }} />
              <span className="skel h-[14px] w-[60px]" />
              <span className="skel h-[22px] w-[120px]" />
              <span className="skel h-[14px] flex-1" />
            </div>
          ))}
        </div>
        <PageStatus text="Reading repositories…" />
      </div>
    )
  }
  if (error) return <PageStatus text={`Could not load runs: ${(error as Error).message}`} bad />
  const { runs, now } = data!

  return (
    <div>
      <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-accent-deep mb-[10px]">
        All runs · all sources
      </div>
      <div className="flex items-baseline gap-[18px] flex-wrap">
        <h1 className="font-sans text-[50px] font-semibold leading-[1.04] tracking-[-0.02em] text-ink">
          Portfolio
        </h1>
        <div className="ml-auto flex gap-[28px] items-baseline">
          <div className="flex flex-col items-end">
            <span className="font-sans font-medium text-[34px] text-ink leading-none tracking-[-0.02em] tabular-nums">
              {runs.length}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              runs
            </span>
          </div>
          <Link
            to="/portfolio/new"
            className="inline-flex items-center gap-2 font-sans text-[13.5px] font-semibold px-4 py-[9px] rounded-sm bg-accent text-white border border-[#8a3a1e] shadow-[var(--shadow-soft)] hover:bg-[#8e3d20] self-center"
          >
            <span className="font-normal text-[16px] leading-none">+</span>{' '}
            New run
          </Link>
        </div>
      </div>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-[1.6] text-[#4d4742]">
        The gate ledger is the heart of the portfolio: each run's progress
        through its phase gates, recomputed live from its branch. Scan calmly;
        open a run when one calls for your attention.
      </p>

      {/* Gate cell legend */}
      <div className="flex gap-[18px] items-center mt-[14px] flex-wrap text-[12px] text-muted">
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[14px] w-[14px] rounded-[4px] border border-ok-line bg-ok-bg" />
          approved ✓
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[14px] w-[14px] rounded-[4px] border border-bad-line bg-bad-bg" />
          declined ✕
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[14px] w-[14px] rounded-[4px] border border-dashed border-pend-line bg-pend-bg" />
          pending ·
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[14px] w-[14px] rounded-[4px] border border-dashed border-bad-line bg-bad-bg" />
          bounced
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[14px] w-[14px] rounded-[4px] border border-dashed border-line-cool bg-transparent" />
          gate absent
        </span>
      </div>

      {runs.length === 0 ? (
        <div className="mt-[30px] rounded-lg border border-dashed border-line-cool bg-surface px-[60px] py-[60px] text-center">
          <span className="flex justify-center mb-3.5" aria-hidden="true">
            <span className="gate-sigil text-accent">
            <svg viewBox="0 0 24 24" width="44" height="44">
              <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
              <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
            </svg>
          </span>
          </span>
          <h3 className="font-sans font-semibold text-[32px] tracking-[-0.02em] mt-[14px] mb-2 text-ink">
            No runs staged yet.
          </h3>
          <p className="text-muted max-w-[48ch] mx-auto mb-[18px] text-[15px]">
            The pipeline is empty — no branches under{' '}
            <code className="font-mono">run/</code>. Stage the first run and the
            agents will begin at the spec gate.
          </p>
          <Link
            to="/portfolio/new"
            className="inline-flex items-center gap-2 font-sans text-[13.5px] font-semibold px-4 py-[9px] rounded-sm bg-accent text-white border border-[#8a3a1e] shadow-[var(--shadow-soft)] hover:bg-[#8e3d20]"
          >
            <span className="font-normal text-[16px] leading-none">+</span>{' '}
            Stage the first run
          </Link>
        </div>
      ) : (
        <ScrollPane label="Runs, by source">
          <table className="w-full min-w-[780px] border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr>
                <th className={TH}>Needs you · Run</th>
                <th className={TH}>Phase</th>
                <th className={TH}>Gates</th>
                <th className={`${TH} text-right`}>Tasks</th>
                <th className={`${TH} text-right`}>Rounds</th>
                <th className={TH}>Budget</th>
                <th className={`${TH} text-right`}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={`${run.source}/${run.slug}`}
                  className={`border-b border-line last:border-b-0 transition-colors hover:bg-[#fbf8f3] ${
                    run.malformed ? 'bg-[#fbf3ed]' : ''
                  }`}
                >
                  <td className={`${TD} min-w-[190px]`}>
                    <div className="flex items-start gap-[9px]">
                      <NeedsYou mark={needsYouMark(run)} />
                      <div className="min-w-0">
                        <Link
                          to={`/runs/${run.source}/${run.slug}`}
                          className="font-mono text-[13.5px] font-medium text-ink hover:underline"
                        >
                          {run.slug}
                        </Link>
                        <div className="font-mono text-[11.5px] text-muted mt-[2px]">
                          {run.source}
                        </div>
                        {run.malformed && (
                          <div className="font-mono text-[11.5px] text-bad mt-[3px] before:content-['✕_']">
                            {run.malformed}
                          </div>
                        )}
                        {run.aheadOfOrigin != null && run.aheadOfOrigin > 0 && (run.behindOrigin ?? 0) > 0 ? (
                          <span
                            className="mt-1 inline-flex font-mono text-[11.5px] font-semibold px-[7px] py-[2px] rounded-sm border border-bad-line bg-bad-bg text-bad"
                            title={`${run.ref} has diverged from origin: ${run.aheadOfOrigin} local-only commit(s), ${run.behindOrigin} on origin only — reconcile the branch (#99)`}
                          >
                            ↑{run.aheadOfOrigin}↓{run.behindOrigin}
                          </span>
                        ) : run.aheadOfOrigin != null && run.aheadOfOrigin > 0 ? (
                          <span
                            className="mt-1 inline-flex font-mono text-[11.5px] font-semibold px-[7px] py-[2px] rounded-sm border border-warn-line bg-warn-bg text-warn"
                            title={`${run.aheadOfOrigin} commit(s) on ${run.ref} not yet pushed — origin consumers see an older run`}
                          >
                            ↑{run.aheadOfOrigin}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className={TD}>
                    <PhaseChip phase={run.phase} pausedReason={run.pausedReason} closure={run.closure} />
                  </td>
                  <td className={TD}>
                    <GateLedger gates={run.gates} profile={run.profile} />
                  </td>
                  <td className={NUM}>
                    {run.tasks.total ? (
                      <>
                        <span className="text-ink">{run.tasks.done}</span>
                        /{run.tasks.total}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td
                    className={`${NUM} ${
                      run.tasks.maxRounds >= 3 ? 'font-semibold text-bad' : 'text-muted'
                    }`}
                  >
                    {run.tasks.total ? run.tasks.maxRounds : '—'}
                  </td>
                  <td className={TD}>
                    <BudgetMeter limit={run.budget.limit} spent={run.budget.spent} />
                  </td>
                  <td className={`${NUM} text-muted text-[12.5px]`}>
                    {formatAge(run.updatedAt, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollPane>
      )}
    </div>
  )
}
