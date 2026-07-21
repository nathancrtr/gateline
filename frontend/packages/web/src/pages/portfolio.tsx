// I6: every run × source at a glance.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, formatAge } from '../api.ts'
import { BudgetMeter, GateLedger, PhaseChip } from '../components/chips.tsx'
import { PageStatus } from './inbox.tsx'

export function PortfolioPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs })
  if (isLoading) return <PageStatus text="Reading repositories…" />
  if (error) return <PageStatus text={`Could not load runs: ${(error as Error).message}`} bad />
  const { runs, now } = data!

  return (
    <div>
      <header className="mb-5 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Portfolio</h1>
        <span className="text-xs text-muted">{runs.length} runs</span>
      </header>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-raised text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-semibold">Run</th>
              <th className="px-3 py-2 font-semibold">Phase</th>
              <th className="px-3 py-2 font-semibold">Gates</th>
              <th className="px-3 py-2 text-right font-semibold">Tasks</th>
              <th className="px-3 py-2 text-right font-semibold">Rounds</th>
              <th className="px-3 py-2 font-semibold">Budget</th>
              <th className="px-3 py-2 text-right font-semibold">Updated</th>
              <th className="px-3 py-2 text-right font-semibold">Needs</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={`${run.source}/${run.slug}`} className="border-b border-line last:border-b-0 hover:bg-raised/60">
                <td className="px-4 py-2.5">
                  <Link to={`/runs/${run.source}/${run.slug}`} className="font-medium text-accent hover:underline">
                    {run.slug}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-faint">{run.source}</span>
                  {run.aheadOfOrigin != null && run.aheadOfOrigin > 0 && (
                    <span
                      className="ml-2 rounded-full bg-warn-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-warn"
                      title={`${run.aheadOfOrigin} commit(s) on ${run.ref} not yet pushed — origin consumers see an older run`}
                    >
                      ↑{run.aheadOfOrigin}
                    </span>
                  )}
                  {run.malformed && <p className="mt-0.5 text-xs text-bad">{run.malformed}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <PhaseChip phase={run.phase} pausedReason={run.pausedReason} />
                </td>
                <td className="px-3 py-2.5">
                  <GateLedger gates={run.gates} />
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">
                  {run.tasks.total ? `${run.tasks.done}/${run.tasks.total}` : '—'}
                </td>
                <td className={`px-3 py-2.5 text-right font-mono text-xs tabular-nums ${run.tasks.maxRounds >= 3 ? 'font-semibold text-bad' : ''}`}>
                  {run.tasks.total ? run.tasks.maxRounds : '—'}
                </td>
                <td className="px-3 py-2.5">
                  <BudgetMeter limit={run.budget.limit} spent={run.budget.spent} />
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-muted">{formatAge(run.updatedAt, now)}</td>
                <td className="px-3 py-2.5 text-right">
                  {run.needsHuman > 0 ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-surface">
                      {run.needsHuman}
                    </span>
                  ) : run.escalationsOpen > 0 ? (
                    <span className="font-mono text-[11px] text-bad">{run.escalationsOpen} esc</span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
