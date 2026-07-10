// I8: computed from state.yaml history — no scribe (R1). The gate table is
// the centerpiece: approval rate against the >90% over-triggering heuristic
// (FRONTEND.md §4.4), burden mix as an ordered sequential ramp, latency.
// Charts are plain HTML; the table itself is the accessibility relief.
import { useQuery } from '@tanstack/react-query'
import { api, type MetricsResponse } from '../api.ts'
import { PageStatus } from './inbox.tsx'

// Ordered burden ramp (sequential, one hue): lightness-monotonic in both
// modes, adjacent-pair CVD ΔE ≥ 22 (validated); gaps + legend + table give
// the low-contrast relief the validator demands.
const BURDEN_RAMP = {
  confirmation: 'light-dark(#cfe8e2, #2a5c52)',
  'light-correction': 'light-dark(#63b0a1, #4a9c8a)',
  'heavy-correction': 'light-dark(#0e7264, #8fdccb)',
} as const
const UNRECORDED = 'light-dark(#d9dedb, #3a423e)' // gray, not a ramp step

const BURDEN_LABELS: [keyof typeof BURDEN_RAMP, string][] = [
  ['confirmation', 'confirmation'],
  ['light-correction', 'light correction'],
  ['heavy-correction', 'heavy correction'],
]

function formatLatency(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`
  return `${(seconds / 86_400).toFixed(1)}d`
}

export function MetricsPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['metrics'], queryFn: api.metrics })
  if (isLoading) return <PageStatus text="Computing metrics from state history…" />
  if (error) return <PageStatus text={`Could not compute metrics: ${(error as Error).message}`} bad />
  const metrics = data!
  const total = metrics.decisions.length

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Metrics</h1>
        <span className="text-xs text-muted">computed from state.yaml git history — nothing is logged separately</span>
      </header>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-sm font-medium">No gate decisions recorded yet.</p>
          <p className="mt-1 text-xs text-muted">Decisions made through the app or CLI will appear here from their commits.</p>
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
      <h2 className="mb-1 text-sm font-semibold">Gate decisions</h2>
      <p className="mb-3 text-xs text-muted">
        Sustained approval above 90% means the gate is over-triggering (or reviews have gone reflexive) — its scope should move down the tier ladder.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-raised text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-semibold">Gate</th>
              <th className="px-3 py-2 text-right font-semibold">Decisions</th>
              <th className="px-3 py-2 font-semibold">Approval rate</th>
              <th className="px-3 py-2 font-semibold">Burden mix</th>
              <th className="px-3 py-2 text-right font-semibold">Median latency</th>
            </tr>
          </thead>
          <tbody>
            {metrics.perGate.map((g) => (
              <tr key={g.gate} className="border-b border-line last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs font-semibold">{g.gate}</td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">{g.decisions || '—'}</td>
                <td className="px-3 py-3">
                  {g.approvalRate === null ? (
                    <span className="text-xs text-faint">no decisions</span>
                  ) : (
                    <ApprovalMeter rate={g.approvalRate} overTriggering={g.overTriggering} />
                  )}
                </td>
                <td className="px-3 py-3">
                  <BurdenBar mix={g.burdenMix} unrecorded={g.burdenUnrecorded} total={g.decisions} />
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-muted">{formatLatency(g.medianLatencySeconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        {BURDEN_LABELS.map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: BURDEN_RAMP[key] }} />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNRECORDED }} />
          unrecorded (predates burden capture)
        </span>
      </div>
    </section>
  )
}

/** Meter with a threshold tick at 90%; fill turns warn past it (with a label — never color alone). */
function ApprovalMeter({ rate, overTriggering }: { rate: number; overTriggering: boolean }) {
  const pct = Math.round(rate * 100)
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-2 w-36 overflow-hidden rounded-full bg-raised">
        <span className={`block h-full rounded-full ${overTriggering ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        <span className="absolute inset-y-0 left-[90%] w-px bg-faint" title="90% over-triggering threshold" />
      </span>
      <span className="font-mono text-xs tabular-nums">{pct}%</span>
      {overTriggering && (
        <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn" title="sustained >90% approval — consider moving this gate down the tier ladder">
          ⚠ over-triggering?
        </span>
      )}
    </span>
  )
}

/** Ordered part-to-whole: sequential ramp segments with 2px surface gaps. */
function BurdenBar({ mix, unrecorded, total }: { mix: Record<string, number>; unrecorded: number; total: number }) {
  if (total === 0) return <span className="text-xs text-faint">—</span>
  const segments = [
    ...BURDEN_LABELS.map(([key, label]) => ({ label, n: mix[key] ?? 0, color: BURDEN_RAMP[key] })),
    { label: 'unrecorded', n: unrecorded, color: UNRECORDED },
  ].filter((s) => s.n > 0)
  return (
    <span className="flex h-4 w-44 gap-[2px] overflow-hidden rounded" role="img" aria-label={segments.map((s) => `${s.label}: ${s.n}`).join(', ')}>
      {segments.map((s) => (
        <span key={s.label} className="h-full" style={{ background: s.color, flexGrow: s.n }} title={`${s.label}: ${s.n} of ${total}`} />
      ))}
    </span>
  )
}

/** Review-round distribution: how often the loop converges in 1, 2, 3 rounds. */
function RoundsSection({ metrics }: { metrics: MetricsResponse }) {
  const counts = new Map<number, number>()
  for (const run of metrics.runs) for (const t of run.rounds) counts.set(t.rounds, (counts.get(t.rounds) ?? 0) + 1)
  const buckets = [0, 1, 2, 3].map((r) => ({
    label: r === 3 ? '3+ (cap)' : String(r),
    n: r === 3 ? [...counts].filter(([k]) => k >= 3).reduce((s, [, v]) => s + v, 0) : (counts.get(r) ?? 0),
  }))
  const max = Math.max(1, ...buckets.map((b) => b.n))
  const totalTasks = buckets.reduce((s, b) => s + b.n, 0)
  if (totalTasks === 0) return null
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">Review rounds per task</h2>
      <p className="mb-3 text-xs text-muted">Round 4 escalates by rule; tasks at 3+ usually mean a spec ambiguity, not an implementation defect.</p>
      <div className="flex max-w-md flex-col gap-1.5">
        {buckets.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{b.label}</span>
            <div className="h-4 flex-1 rounded bg-raised">
              <div
                className={`h-full rounded ${b.label.startsWith('3') && b.n > 0 ? 'bg-bad' : 'bg-accent'}`}
                style={{ width: `${(b.n / max) * 100}%`, minWidth: b.n > 0 ? '4px' : 0 }}
                title={`${b.n} task(s)`}
              />
            </div>
            <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-muted">{b.n || ''}</span>
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
      <h2 className="mb-1 text-sm font-semibold">Budget honesty</h2>
      <p className="mb-3 text-xs text-muted">Spend is whatever the run's orchestrator recorded. “Never updated” is a real finding — automated metering is a v1 prerequisite.</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-raised text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-semibold">Run</th>
              <th className="px-3 py-2 text-right font-semibold">Limit</th>
              <th className="px-3 py-2 text-right font-semibold">Recorded spend</th>
              <th className="px-3 py-2 font-semibold">Metering</th>
            </tr>
          </thead>
          <tbody>
            {metrics.runs.map((r) => (
              <tr key={`${r.source}/${r.slug}`} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2 font-mono text-xs">{r.source}/{r.slug}</td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{r.budget.limit === null ? '—' : `$${r.budget.limit}`}</td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{r.budget.spent === null ? '—' : `$${r.budget.spent}`}</td>
                <td className="px-3 py-2 text-xs">
                  {r.budget.everUpdated ? (
                    <span className="text-ok">✓ updated during the run</span>
                  ) : (
                    <span className="font-medium text-warn">⚠ never updated</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
