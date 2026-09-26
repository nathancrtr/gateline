// I8: computed from state.yaml history — no scribe (R1). The gate table is
// the centerpiece: approval rate against the >90% over-triggering heuristic
// (FRONTEND.md §4.4), burden mix as an ordered sequential ramp, latency.
// Charts are plain HTML; the table itself is the accessibility relief.
import { useQuery } from '@tanstack/react-query'
import { api, type MetricsResponse } from '../api.ts'
import { Imp } from '../components/chips.tsx'
import { usd } from '../money.ts'
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
  const { data, isLoading, error } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics })

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
  const total = metrics.decisions.length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-9">
      <header>
        <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Metrics</h1>
        <p className="mt-1 text-[13px] text-muted">Computed from state.yaml git history — nothing is logged separately.</p>
      </header>

      {total === 0 ? (
        <div className="border-t border-ink px-4 py-[34px] text-center">
          <p className="text-[15px] font-semibold">No gate decisions recorded yet.</p>
          <p className="mt-1.5 text-xs text-muted">Decisions made through the app or CLI will appear here from their commits.</p>
        </div>
      ) : (
        <GateTable metrics={metrics} />
      )}

      <RoundsSection metrics={metrics} />
      <BudgetSection metrics={metrics} />
    </div>
  )
}

function GateTable({ metrics }: { metrics: MetricsResponse }) {
  return (
    <section>
      <h2 className="mb-[3px] text-[15px] font-semibold">Gate decisions</h2>
      <p className="mb-3 max-w-[var(--measure)] text-xs text-muted">
        Sustained approval above 90% means the gate is over-triggering (or reviews have gone reflexive) — its scope should move down the tier ladder.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className={TH}>gate</th>
              <th className={`${TH} text-right`}>decisions</th>
              <th className={TH}>approval rate</th>
              <th className={TH}>burden mix</th>
              <th className={`${TH} text-right`}>median latency</th>
            </tr>
          </thead>
          <tbody>
            {metrics.perGate.map((g) => (
              <tr key={g.gate}>
                <td className={`${TD} font-mono text-xs font-semibold`}>{g.gate}</td>
                <td className={`${TD} text-right font-ui text-xs tabular-nums`}>{g.decisions || '—'}</td>
                <td className={TD}>
                  {g.approvalRate === null ? (
                    <span className="text-xs text-muted">no decisions</span>
                  ) : (
                    <ApprovalMeter rate={g.approvalRate} overTriggering={g.overTriggering} />
                  )}
                </td>
                <td className={TD}>
                  <BurdenBar mix={g.burdenMix} unrecorded={g.burdenUnrecorded} total={g.decisions} />
                </td>
                <td className={`${TD} text-right font-ui text-xs tabular-nums text-muted`}>{formatLatency(g.medianLatencySeconds)}</td>
              </tr>
            ))}
          </tbody>
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
    </section>
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
function RoundsSection({ metrics }: { metrics: MetricsResponse }) {
  const counts = new Map<number, number>()
  for (const run of metrics.runs) for (const t of run.rounds) counts.set(t.rounds, (counts.get(t.rounds) ?? 0) + 1)
  const cap = metrics.roundCap
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
function BudgetSection({ metrics }: { metrics: MetricsResponse }) {
  if (metrics.runs.length === 0) return null
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
              <th className={TH}>run</th>
              <th className={`${TH} text-right`}>limit</th>
              <th className={`${TH} text-right`}>recorded spend</th>
              <th className={`${TH} pl-3`}>metering</th>
            </tr>
          </thead>
          <tbody>
            {metrics.runs.map((r) => (
              <tr key={`${r.source}/${r.slug}`}>
                <td className={`${TD} font-mono text-xs`}>
                  {r.source}/{r.slug}
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
