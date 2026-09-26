// I6: every run × source at a glance.

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useRef } from 'react'
import { Link } from 'react-router-dom'
import { api, formatAge, type NeedFact, type RunSummary } from '../api.ts'
import { BudgetMeter, GateLedger, Imp, type ImpTone, KIND_GLYPH, kindTone, PhaseChip } from '../components/chips.tsx'
import { UnreadableState } from '../components/unreadable-state.tsx'
import { gateCardState } from '../gate-state.ts'
import { EdgeFade, useScrollCue } from '../scroll-cue.tsx'
import { PageStatus } from './inbox.tsx'

// The ledger's column heads: small, muted, on the rule.
const TH = 'text-left font-ui font-normal text-[11.5px] text-muted pr-2.5 pb-1.5 border-b border-ink whitespace-nowrap'
const TD = 'pr-2.5 py-[12px] border-b border-line align-top'
const NUM = 'pr-2.5 py-[12px] border-b border-line align-top text-right font-ui text-[12.5px] tabular-nums text-ink'

/**
 * What the mark at the left edge of a run row says (#297).
 *
 * This used to be the last cell of the last column, which is the one place it
 * could not survive: the table is wider than its wrapper from about 1000px
 * down, so the column the page exists for was the first thing clipped — and
 * clipped silently. Deciding the mark here rather than inline keeps it
 * testable.
 *
 * The mark takes the texture of what is waiting (#452), through the inbox's
 * own `kindTone`, so a row and its inbox chip never disagree: a ready gate is
 * the signal blue, a stuck run the caution ink, an unreadable record hatched,
 * and the machine's turn or a run at rest dotted. Never `fill`, which is for a
 * decision taken. When several things wait, core has already put the most
 * urgent first (`NEED_PRECEDENCE`); the count is all of them.
 *
 * The colour must not carry what the words do not (SEAM.md §5). Most kinds
 * are named beside the mark already: the phase chip says `staged`, `paused`
 * or `unknown`, and the gate ledger shows the gate. An escalation and a round
 * cap share the caution tone and nothing else on the row names them, so those
 * two carry their inbox glyph, ⚑ or ⟲, inside the mark: the same glyphs that
 * tell them apart on the inbox chip.
 *
 * It reads `needs` alone. A closed run's escalations stay open in its record,
 * but the closure answered them, so the run is quiet here (#452).
 */
export type NeedsYouMark =
  | { kind: 'needs'; count: number; lead: NeedFact | null; tone: ImpTone; glyph: string; label: string }
  | { kind: 'quiet'; count: 0; label: string }

/** The lead item in the record's words: its kind, and for a gate its code and state. */
function leadWords(need: NeedFact): string {
  if (need.kind !== 'gate') return need.kind
  const state = gateCardState(need)
  const gate = `${need.gate ?? 'a'} gate`
  return state === 'bounced' ? `${gate}, bounced` : state === 'inflight' ? `${gate}, superseded` : gate
}

export function needsYouMark(run: Pick<RunSummary, 'needs' | 'needsHuman'>): NeedsYouMark {
  // A server built before #452 sends no `needs`: the count, with no kind.
  const count = run.needs?.length ?? run.needsHuman
  if (count === 0) return { kind: 'quiet', count: 0, label: 'nothing needs you' }
  const items = `${count} ${count === 1 ? 'item needs' : 'items need'} you`
  const lead = run.needs?.[0] ?? null
  if (!lead) return { kind: 'needs', count, lead, tone: '', glyph: '', label: items }
  const what = leadWords(lead)
  return {
    kind: 'needs',
    count,
    lead,
    tone: kindTone(lead),
    glyph: lead.kind === 'escalation' || lead.kind === 'round-cap' ? KIND_GLYPH[lead.kind] : '',
    label: count === 1 ? `${items} (${what})` : `${items} (${what} first)`,
  }
}

export { scrollCue } from '../scroll-cue.tsx'

/**
 * The table's pane: the same contained horizontal scroll as before, plus the
 * cue that says it is scrolling. The fade sits above the rows rather than in
 * the pane's background, and the hint line spells out in words what the fade
 * only implies.
 */
function ScrollPane({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const cue = useScrollCue(ref)
  const clipped = cue.left || cue.right
  return (
    <div className="mt-[22px]">
      <div className="relative">
        <div ref={ref} className="overflow-x-auto" {...(clipped ? { role: 'region', 'aria-label': label, tabIndex: 0 } : {})}>
          {children}
        </div>
        {cue.left && <EdgeFade edge="left" radius="" />}
        {cue.right && <EdgeFade edge="right" radius="" />}
      </div>
      {clipped && <p className="mt-[7px] text-[11.5px] text-muted">Wider than the pane — scroll sideways for the remaining columns.</p>}
    </div>
  )
}

/**
 * The left-edge mark. Fixed width so every slug starts at the same x: the
 * marks then read as a rail down the left edge, which is the scan the page
 * exists for. A quiet run leaves the slot empty — absence says it.
 */
export function NeedsYou({ mark }: { mark: NeedsYouMark }) {
  if (mark.kind === 'quiet') return <span aria-hidden="true" className="w-[34px] shrink-0" />
  return (
    <span className="w-[34px] shrink-0" title={mark.label}>
      <Imp tone={mark.tone} className="tabular-nums" data-needs-you={mark.lead?.kind}>
        {mark.glyph}
        {mark.count}
      </Imp>
    </span>
  )
}

export function PortfolioPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs })

  if (isLoading) {
    return (
      <div>
        <div className="border-t border-ink">
          {[130, 110, 150].map((w, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: three static skeleton placeholder rows, never reordered or data-backed.
            <div key={i} className="flex items-center gap-4 border-b border-line py-[12px]">
              <span className="skel h-[21px] w-[22px]" />
              <span className="skel h-[14px]" style={{ width: w }} />
              <span className="skel h-[14px] w-[60px]" />
              <span className="skel h-[21px] w-[120px]" />
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
  const needs = runs.filter((r) => needsYouMark(r).kind !== 'quiet').length

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-4">
        <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Portfolio</h1>
        <Link to="/portfolio/new" className="btn ml-auto self-center">
          New run
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-muted">Each run's progress through its gates, recomputed from its branch.</p>

      {runs.length === 0 ? (
        <div className="mt-[22px] border-t border-ink px-2 py-16 text-center">
          <span className="gate-sigil mb-3 block" aria-hidden="true">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="36" height="36">
              <rect x="3.5" y="3" width="2.6" height="18" fill="currentColor" />
              <rect x="17.9" y="3" width="2.6" height="18" fill="currentColor" />
              <rect x="3.5" y="8.6" width="17" height="2.2" fill="currentColor" />
            </svg>
          </span>
          <h3 className="text-[20px] font-semibold text-ink">No runs staged yet.</h3>
          <p className="mx-auto mt-1.5 mb-4 max-w-[48ch] text-[13.5px] text-muted">
            The pipeline is empty — no branches under <code className="font-mono">run/</code>. Stage the first run and the agents
            will begin at the spec gate.
          </p>
          <Link to="/portfolio/new" className="btn">
            Stage the first run
          </Link>
        </div>
      ) : (
        <ScrollPane label="Runs, by source">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13.5px]">
            <thead>
              <tr>
                <th className={TH}>
                  <span className="sr-only">Needs you</span>
                </th>
                <th className={TH}>run</th>
                <th className={TH}>phase</th>
                <th className={TH}>gates</th>
                <th className={`${TH} text-right`}>tasks</th>
                <th className={`${TH} text-right`}>rounds</th>
                <th className={TH}>budget</th>
                <th className={`${TH} text-right`}>updated</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={`${run.source}/${run.slug}`} className="hover:bg-inset">
                  <td className={`${TD} w-[34px]`}>
                    {/* The wrapper is what the geometry sweep measures the
                        mark through (`td > div > span`), so it stays. */}
                    <div className="flex">
                      <NeedsYou mark={needsYouMark(run)} />
                    </div>
                  </td>
                  <td className={`${TD} min-w-[170px]`}>
                    <div className="min-w-0">
                      <Link to={`/runs/${run.source}/${run.slug}`} className="font-mono text-[13.5px] font-semibold text-ink hover:underline">
                        {run.slug}
                      </Link>
                      <div className="mt-[2px] font-ui text-[11.5px] text-muted">
                        {run.source} · {run.profile}
                      </div>
                      {/* Why the state could not be read, from core's fact
                          (#435): the parser's message as a Diagnostic under
                          its producer, as the decide card sets it, with `<pre>`
                          keeping the caret under its column; any other case in
                          the cockpit's words with the file as the Address. It
                          was once a red row line, flowed, with the caret
                          collapsed onto the line before it. */}
                      {run.unreadable && (
                        <div className="mt-1.5 max-w-[46ch]">
                          <UnreadableState problem={run.unreadable} src={run.source} slug={run.slug} />
                        </div>
                      )}
                      {run.aheadOfOrigin != null && run.aheadOfOrigin > 0 && (run.behindOrigin ?? 0) > 0 ? (
                        <Imp
                          tone="mark"
                          className="mt-1"
                          title={`${run.ref} has diverged from origin: ${run.aheadOfOrigin} local-only commit(s), ${run.behindOrigin} on origin only — reconcile the branch (#99)`}
                        >
                          ↑{run.aheadOfOrigin}↓{run.behindOrigin}
                        </Imp>
                      ) : run.aheadOfOrigin != null && run.aheadOfOrigin > 0 ? (
                        <Imp className="mt-1" title={`${run.aheadOfOrigin} commit(s) on ${run.ref} not yet pushed — origin consumers see an older run`}>
                          ↑{run.aheadOfOrigin}
                        </Imp>
                      ) : null}
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
                        <span className="text-muted">/{run.tasks.total}</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className={`${NUM} ${run.tasks.maxRounds >= run.tasks.roundCap ? 'font-semibold text-warn' : 'text-muted'}`}>
                    {run.tasks.total ? run.tasks.maxRounds : '—'}
                  </td>
                  <td className={TD}>
                    <BudgetMeter limit={run.budget.limit} spent={run.budget.spent} />
                  </td>
                  <td className={`${NUM} text-[12.5px] text-muted`}>{formatAge(run.updatedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2 text-[12px] text-muted">
            <span className="tabular-nums">
              {runs.length} {runs.length === 1 ? 'run' : 'runs'}
              {needs > 0 ? ` · ${needs} need${needs === 1 ? 's' : ''} you` : ''}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                approved <Imp tone="ok">✓</Imp>
              </span>
              <span>
                declined <Imp tone="struck mark">✕</Imp>
              </span>
              <span>
                pending <Imp>·</Imp>
              </span>
              <span>
                bounced <Imp tone="dot">⚠</Imp>
              </span>
              <span>
                not reached <Imp tone="dot">·</Imp>
              </span>
            </span>
          </div>
        </ScrollPane>
      )}
    </div>
  )
}
