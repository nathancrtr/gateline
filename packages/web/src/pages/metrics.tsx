// I8: computed from state.yaml history — no scribe (R1). The gate table is
// the centerpiece: approval rate against the >90% over-triggering heuristic
// (FRONTEND.md §4.4), burden mix as an ordered sequential ramp, latency.
// Charts are plain HTML; the table itself is the accessibility relief.
//
// Several repositories (#499; docs/MULTI-REPO.md §9.4, decision P11): the
// gate is the unit of the table. With no scope, each gate is one row group:
// its total across the set leads, and each repository's figures follow it,
// indented and in the muted ink, with no hairline between them, so the eye
// reads a gate and then its parts. The flag is drawn on repository rows and
// never on a total that pools several. Under a scope, the table is the
// scope's repository's own figures, one row per gate, as a one-repository
// set shows it.
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api, type GateMetrics, type MetricsResponse, type RunMetricsSummary } from '../api.ts'
import { Imp } from '../components/chips.tsx'
import { fullRunName, REPOSITORY_COLUMN, REPOSITORY_FOLD, RepositoryName, useDocumentTitle } from '../components/repository.tsx'
import { inScope, ScopeHeading, ScopeLine, UnknownScopeNotice, useScope } from '../components/scope.tsx'
import { usd } from '../money.ts'
import { compareRepositories, type Scope, scopeTitle } from '../scope.ts'
import { PageStatus } from './inbox.tsx'

// Ordered burden ramp: one hue (the ink) at three textures — solid, hatched,
// dotted — with the surface showing through as 2px gaps between segments.
// Texture, not lightness, is what orders the steps: burden is a category,
// not a gate state, so it gets no colour, and a fourth state is a texture
// rather than a hue.
// The legend and the table are the low-contrast relief.
const BURDEN_TEXTURE = {
  confirmation: 'tx-solid',
  'light-correction': 'tx-hatch',
  'heavy-correction': 'tx-dots',
} as const
const UNRECORDED_TEXTURE = 'tx-none' // a dotted outline, not a ramp step

const BURDEN_LABELS: [keyof typeof BURDEN_TEXTURE, string][] = [
  ['confirmation', 'confirmation'],
  ['light-correction', 'light correction'],
  ['heavy-correction', 'heavy correction'],
]

const TH = 'whitespace-nowrap pr-3 pb-1.5 text-left font-ui text-[11.5px] font-normal text-muted border-b border-ink'
const TD = 'pr-3 py-2.5 border-b border-line align-top'

function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${(seconds / 86_400).toFixed(1)}d`
}

export function MetricsPage() {
  const { data, isLoading: metricsLoading, error } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics })
  const scope = useScope()
  const isLoading = metricsLoading || !scope.ready
  useDocumentTitle(scopeTitle('Metrics', scope.scope))

  if (isLoading) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-2.5">
        <span className="skel block h-3.5 w-3/5" />
        <span className="skel block h-9 w-full" />
        <span className="skel block h-9 w-full" />
        <PageStatus text="Computing metrics from state history…" />
      </div>
    )
  }
  if (error) return <PageStatus text={`Could not compute metrics: ${(error as Error).message}`} bad />
  const metrics = data!
  // Every section follows the scope (#498, #499). The run-level sections'
  // rows are runs, each carrying its repository. The gate table takes the
  // figures core computed for the scope's repository, or, with no scope over
  // several repositories, each gate's total and each repository's figures.
  const runs = inScope(metrics.runs, scope.scope)
  const decided = inScope(metrics.decisions, scope.scope).length
  const one = scope.scope.kind === 'one'
  const form = gateTableForm(metrics, scope.scope, scope.several && scope.set.length > 1)

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-9">
      <header>
        <ScopeHeading scope={scope.scope} />
        <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Metrics</h1>
        <p className="mt-1 text-[13px] text-muted">Computed from state.yaml git history — nothing is logged separately.</p>
        <ScopeLine scope={scope.scope} outside={null} path="/metrics" />
        <UnknownScopeNotice scope={scope.scope} />
      </header>

      {decided === 0 ? (
        <div className="border-t border-ink px-4 py-[34px] text-center">
          <p className="text-[15px] font-semibold">No gate decisions recorded yet.</p>
          <p className="mt-1.5 text-xs text-muted">Decisions made through the app or CLI will appear here from their commits.</p>
        </div>
      ) : (
        <GateTable form={form} rateMinDecisions={metrics.rateMinDecisions} />
      )}

      <RoundsSection runs={runs} roundCap={metrics.roundCap} />
      <BudgetSection runs={runs} showRepository={scope.several && !one} />
    </div>
  )
}

/** One repository's figures at one gate, named. */
interface RepositoryRow {
  source: string
  sourceName: string
  figures: GateMetrics
}

/**
 * What the gate table shows (docs/MULTI-REPO.md §9.4, decision P11).
 * - `plain`: one row per gate. Either the whole set when it has one
 *   repository, where the total is that repository's figure and carries its
 *   flag, or the scope's repository's own figures.
 * - `grouped`: no scope over several repositories. Each gate is a group:
 *   the total, which carries no flag, then one row per repository.
 * - `unsplit`: a scope, and a server built before #499 that sent no
 *   per-repository figures, so none can be shown for the scope.
 */
export type GateTableForm =
  | { kind: 'plain'; rows: GateMetrics[] }
  | { kind: 'grouped'; groups: { total: GateMetrics; repositories: RepositoryRow[] }[] }
  | { kind: 'unsplit' }

export function gateTableForm(metrics: MetricsResponse, scope: Scope, several: boolean): GateTableForm {
  const breakdown = metrics.perRepository
  if (scope.kind === 'one') {
    if (!breakdown) return { kind: 'unsplit' }
    return { kind: 'plain', rows: inScope(breakdown, scope)[0]?.perGate ?? [] }
  }
  if (!several || !breakdown) return { kind: 'plain', rows: metrics.perGate }
  // Listed as everywhere else: by display name without case, then by id.
  const listed = [...breakdown].sort((a, b) => compareRepositories({ id: a.source, name: a.sourceName }, { id: b.source, name: b.sourceName }))
  return {
    kind: 'grouped',
    groups: metrics.perGate.map((total) => ({
      total,
      repositories: listed.flatMap((r) => {
        const figures = r.perGate.find((g) => g.gate === total.gate)
        return figures ? [{ source: r.source, sourceName: r.sourceName, figures }] : []
      }),
    })),
  }
}

/** A row's place in its gate's group. The rows of one group share one hairline, under the last. */
type RowPlace = 'alone' | 'first' | 'inside' | 'last'

function cellClass(place: RowPlace): string {
  const top = place === 'alone' || place === 'first' ? 'pt-2.5' : 'pt-1'
  const bottom = place === 'alone' || place === 'last' ? 'pb-2.5 border-b border-line' : 'pb-1'
  return `pr-3 align-top ${top} ${bottom}`
}

function GateTable({ form, rateMinDecisions }: { form: GateTableForm; rateMinDecisions: number | undefined }) {
  const grouped = form.kind === 'grouped'
  const rows = form.kind === 'plain' ? form.rows : form.kind === 'grouped' ? form.groups.flatMap((g) => [g.total, ...g.repositories.map((r) => r.figures)]) : []
  const tooFew = rateMinDecisions !== undefined && rows.some((g) => g.decisions > 0 && g.approvalRate === null)
  return (
    <section>
      <h2 className="mb-[3px] text-[15px] font-semibold">Gate decisions</h2>
      <p className="mb-[3px] max-w-[var(--measure)] text-xs text-muted">
        Sustained approval above 90% means the gate is over-triggering (or reviews have gone reflexive) — its scope should move down the tier ladder.
      </p>
      {grouped && (
        <p className="mb-[3px] max-w-[var(--measure)] text-xs text-muted" data-gate-grouping>
          Each gate shows its total across all repositories, then each repository’s own figures. Over-triggering is judged for each repository, because a
          total that pools several can hide a gate that over-triggers in one of them.
        </p>
      )}
      {tooFew && (
        <p className="mb-[3px] max-w-[var(--measure)] text-xs text-muted" data-gate-sample>
          A rate needs at least {rateMinDecisions} decisions. A row with fewer shows its counts only.
        </p>
      )}
      {form.kind === 'unsplit' ? (
        <p className="mt-3 max-w-[var(--measure)] font-ui text-[12.5px] text-ink" data-gate-unsplit>
          This server sends gate figures for all repositories together, so none can be shown for one repository until it is updated.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[660px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={TH}>{grouped ? 'gate and repository' : 'gate'}</th>
                <th className={`${TH} text-right`}>decisions</th>
                <th className={TH}>approval rate</th>
                <th className={TH}>burden mix</th>
                <th className={`${TH} text-right`}>median latency</th>
              </tr>
            </thead>
            {form.kind === 'plain' ? (
              <tbody>
                {form.rows.map((g) => (
                  <GateRow key={g.gate} figures={g} place="alone" showFlag>
                    <span className="font-mono text-xs font-semibold">{g.gate}</span>
                  </GateRow>
                ))}
              </tbody>
            ) : (
              form.groups.map(({ total, repositories }) => (
                // One row group per gate: the total leads, and its
                // repositories follow it, indented, in the muted ink.
                <tbody key={total.gate} data-gate-group={total.gate}>
                  <GateRow figures={total} place={repositories.length ? 'first' : 'alone'} showFlag={false} total>
                    <span className="whitespace-nowrap">
                      <span className="font-mono text-xs font-semibold">{total.gate}</span>
                      <span className="ml-2 font-ui text-[11.5px] text-muted">all repositories</span>
                    </span>
                  </GateRow>
                  {repositories.map((r, i) => (
                    <GateRow
                      key={r.source}
                      figures={r.figures}
                      place={i === repositories.length - 1 ? 'last' : 'inside'}
                      showFlag
                      repository={r.source}
                    >
                      <span className="block pl-4">
                        <span className="sr-only">{total.gate}, </span>
                        <RepositoryName className="font-mono text-xs" source={r.source} sourceName={r.sourceName} />
                      </span>
                    </GateRow>
                  ))}
                </tbody>
              ))
            )}
          </table>
          <div className="flex flex-wrap items-center gap-4 py-2.5 text-[11.5px] text-muted">
            {BURDEN_LABELS.map(([key, label]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className={`h-[11px] w-[11px] border border-ink ${BURDEN_TEXTURE[key]}`} />
                {label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-[11px] w-[11px] border border-ink ${UNRECORDED_TEXTURE}`} />
              unrecorded (predates burden capture)
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <span className="h-[11px] w-[2px] bg-mark" />
              90% threshold
            </span>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * One row of the gate table. `showFlag` is false on a total that pools
 * several repositories: core leaves that total's flag down, and the table
 * draws none there whatever it is sent.
 */
function GateRow({
  figures: g,
  place,
  showFlag,
  total = false,
  repository,
  children,
}: {
  figures: GateMetrics
  place: RowPlace
  showFlag: boolean
  total?: boolean
  repository?: string
  children: ReactNode
}) {
  const td = cellClass(place)
  return (
    <tr data-gate-row={g.gate} data-gate-total={total || undefined} data-gate-repository={repository}>
      <th scope="row" className={`${td} text-left font-normal`}>
        {children}
      </th>
      <td className={`${td} text-right font-ui text-xs tabular-nums`}>{g.decisions || '—'}</td>
      <td className={td}>
        <RateCell figures={g} showFlag={showFlag} />
      </td>
      <td className={td}>
        {g.decisions > 0 && g.approvalRate === null ? (
          <BurdenCounts mix={g.burdenMix} unrecorded={g.burdenUnrecorded} />
        ) : (
          <BurdenBar mix={g.burdenMix} unrecorded={g.burdenUnrecorded} total={g.decisions} />
        )}
      </td>
      <td className={`${td} text-right font-ui text-xs tabular-nums text-muted`}>{formatLatency(g.medianLatencySeconds)}</td>
    </tr>
  )
}

/**
 * The approval rate, or, below the sample core rates from, the counts alone
 * in the cockpit's words: three decisions never read as 100%.
 */
function RateCell({ figures: g, showFlag }: { figures: GateMetrics; showFlag: boolean }) {
  if (g.decisions === 0) return <span className="text-xs text-muted">no decisions</span>
  if (g.approvalRate === null) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-ui text-xs" data-gate-too-few>
        <span className="tabular-nums">
          {g.approvals} of {g.decisions} approved
        </span>
        <span className="text-muted">too few to rate</span>
      </span>
    )
  }
  return <ApprovalMeter rate={g.approvalRate} overTriggering={showFlag && g.overTriggering} />
}

/**
 * The burden mix of a row too small to rate: counts beside the legend's
 * textures, because a bar would draw proportions from two or three decisions.
 */
function BurdenCounts({ mix, unrecorded }: { mix: Record<string, number>; unrecorded: number }) {
  const parts = [
    ...BURDEN_LABELS.map(([key, label]) => ({ label, n: mix[key] ?? 0, texture: BURDEN_TEXTURE[key] })),
    { label: 'unrecorded', n: unrecorded, texture: UNRECORDED_TEXTURE },
  ].filter((s) => s.n > 0)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 font-ui text-xs tabular-nums" data-burden-counts>
      {parts.map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5" title={`${s.label}: ${s.n}`}>
          <span className={`h-[11px] w-[11px] border border-ink ${s.texture}`} aria-hidden="true" />
          <span className="sr-only">{s.label}: </span>
          {s.n}
        </span>
      ))}
    </span>
  )
}

/** Meter with a threshold tick at 90%; fill takes the red past it (with a label — never color alone). */
function ApprovalMeter({ rate, overTriggering }: { rate: number; overTriggering: boolean }) {
  const pct = Math.round(rate * 100)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="relative h-2 w-[140px] border border-line">
        <span className={`block h-full ${overTriggering ? 'bg-mark' : 'bg-ink'}`} style={{ width: `${pct}%` }} />
        <span className="absolute -inset-y-1 left-[90%] w-0.5 bg-mark" title="90% over-triggering threshold" />
      </span>
      <span className="font-ui text-xs tabular-nums">{pct}%</span>
      {overTriggering && (
        <Imp tone="mark" title="sustained >90% approval — consider moving this gate down the tier ladder">
          over-triggering?
        </Imp>
      )}
    </span>
  )
}

/** Ordered part-to-whole: textured segments with 2px surface gaps. */
function BurdenBar({ mix, unrecorded, total }: { mix: Record<string, number>; unrecorded: number; total: number }) {
  if (total === 0) return <span className="text-xs text-muted">—</span>
  const segments = [
    ...BURDEN_LABELS.map(([key, label]) => ({ label, n: mix[key] ?? 0, texture: BURDEN_TEXTURE[key] })),
    { label: 'unrecorded', n: unrecorded, texture: UNRECORDED_TEXTURE },
  ].filter((s) => s.n > 0)
  return (
    <span className="flex h-3 w-[180px] gap-[2px]" role="img" aria-label={segments.map((s) => `${s.label}: ${s.n}`).join(', ')}>
      {segments.map((s) => (
        <span key={s.label} className={`h-full border border-ink ${s.texture}`} style={{ flexGrow: s.n }} title={`${s.label}: ${s.n} of ${total}`} />
      ))}
    </span>
  )
}

/** Review-round distribution: how often the loop converges in 1, 2, 3 rounds. */
function RoundsSection({ runs, roundCap }: { runs: RunMetricsSummary[]; roundCap: number }) {
  const counts = new Map<number, number>()
  for (const run of runs) for (const t of run.rounds) counts.set(t.rounds, (counts.get(t.rounds) ?? 0) + 1)
  const cap = roundCap
  const buckets = Array.from({ length: cap + 1 }, (_, r) => ({
    label: r === cap ? `${cap}+ (cap)` : String(r),
    n: r === cap ? [...counts].filter(([k]) => k >= cap).reduce((s, [, v]) => s + v, 0) : (counts.get(r) ?? 0),
    capped: r === cap,
  }))
  const max = Math.max(1, ...buckets.map((b) => b.n))
  const totalTasks = buckets.reduce((s, b) => s + b.n, 0)
  if (totalTasks === 0) return null
  return (
    <section>
      <h2 className="mb-[3px] text-[15px] font-semibold">Review rounds per task</h2>
      <p className="mb-3 max-w-[var(--measure)] text-xs text-muted">
        Round {cap + 1} escalates by rule; tasks at {cap}+ usually mean a spec ambiguity, not an implementation defect.
      </p>
      <div className="flex max-w-[440px] flex-col gap-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-right font-ui text-xs tabular-nums text-muted">{b.label}</span>
            <div className="h-3.5 flex-1 border border-line">
              <div
                className={`h-full ${b.capped && b.n > 0 ? 'bg-mark' : 'bg-ink'}`}
                style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n > 0 ? '4px' : 0 }}
                title={`${b.n} task(s)`}
              />
            </div>
            <span className="w-[26px] shrink-0 font-ui text-xs tabular-nums text-muted">{b.n || ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Budget honesty: "never updated" is itself the finding (the wordfreq lesson). */
function BudgetSection({ runs, showRepository }: { runs: RunMetricsSummary[]; showRepository: boolean }) {
  if (runs.length === 0) return null
  return (
    <section>
      <h2 className="mb-[3px] text-[15px] font-semibold">Budget honesty</h2>
      <p className="mb-3 max-w-[var(--measure)] text-xs text-muted">
        Spend is whatever the run's orchestrator recorded. “Never updated” is a real finding — automated metering is a v1 prerequisite.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              {/* A register, like the Portfolio (#497): the repository is its
                  own column, left of the run, when the set has several. */}
              {showRepository && <th className={`${TH} ${REPOSITORY_COLUMN}`}>repository</th>}
              <th className={TH}>run</th>
              <th className={`${TH} text-right`}>limit</th>
              <th className={`${TH} text-right`}>recorded spend</th>
              <th className={`${TH} pl-3`}>metering</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={`${r.source}/${r.slug}`}>
                {showRepository && (
                  <td className={`${TD} ${REPOSITORY_COLUMN}`}>
                    <RepositoryName className="font-mono text-xs" source={r.source} sourceName={r.sourceName} />
                  </td>
                )}
                <td className={`${TD} font-mono text-xs`} title={fullRunName(r.source, r.slug)}>
                  {r.slug}
                  {/* Below 1280px the column folds under the slug. */}
                  {showRepository && <RepositoryName className={`${REPOSITORY_FOLD} mt-[2px]`} source={r.source} sourceName={r.sourceName} />}
                </td>
                <td className={`${TD} text-right font-ui text-xs tabular-nums`}>{r.budget.limit === null ? '—' : usd(r.budget.limit)}</td>
                <td className={`${TD} text-right font-ui text-xs tabular-nums`}>{r.budget.spent === null ? '—' : usd(r.budget.spent)}</td>
                <td className={`${TD} pl-3 text-xs`}>
                  {r.budget.everUpdated ? <Imp>✓ updated during the run</Imp> : <Imp tone="hatch">never updated</Imp>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
