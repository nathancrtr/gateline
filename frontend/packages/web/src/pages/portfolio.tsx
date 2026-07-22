// I6: every run × source at a glance.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, formatAge } from '../api.ts'
import { BudgetMeter, GateLedger, PhaseChip } from '../components/chips.tsx'
import { PageStatus } from './inbox.tsx'

// Instrument-grid rhythm: tight cells, mono uppercase inset heads (candidate-b
// portfolio.html .grid thead th).
const TH = 'border-b border-line bg-inset px-3 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] whitespace-nowrap text-muted'
const TD = 'px-3 py-2'
const NUM = 'px-3 py-2 text-right font-mono text-xs tabular-nums'

export function PortfolioPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['runs'], queryFn: api.runs })

  if (isLoading) {
    return (
      <div>
        <div className="overflow-hidden rounded-[5px] border border-line bg-surface">
          {[130, 110, 150].map((w, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-b-0">
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
      <header className="mb-[22px] flex items-end gap-4 border-b border-line pb-[14px]">
        <h1 className="font-mono text-xl font-semibold uppercase tracking-[0.14em]">Portfolio</h1>
        <span className="ml-auto text-xs text-muted">{runs.length} runs</span>
      </header>
      {runs.length === 0 ? (
        <div className="rounded-[5px] border border-line bg-surface px-4 py-[34px] text-center">
          <span aria-hidden="true" className="mb-3 block font-mono text-lg tracking-[0.2em] text-accent">
            [ ]
          </span>
          <p className="text-[15px] font-semibold">No runs found.</p>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-muted">
            No <code className="font-mono">runs/&lt;slug&gt;</code> directories on any tracked source yet. Start one
            with the orchestrator, or point Gate at a repo that has runs.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[5px] border border-line bg-surface">
          <table className="w-full min-w-[820px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`${TH} text-left`}>Run</th>
                <th className={`${TH} text-left`}>Phase</th>
                <th className={`${TH} text-left`}>Gates</th>
                <th className={`${TH} text-right`}>Tasks</th>
                <th className={`${TH} text-right`}>Rounds</th>
                <th className={`${TH} text-left`}>Budget</th>
                <th className={`${TH} text-right`}>Updated</th>
                <th className={`${TH} text-right`}>Needs</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={`${run.source}/${run.slug}`} className="border-b border-line last:border-b-0 hover:bg-raised">
                  <td className={TD}>
                    <Link to={`/runs/${run.source}/${run.slug}`} className="font-semibold text-accent hover:underline">
                      {run.slug}
                    </Link>
                    <span className="ml-2 font-mono text-[11px] text-faint">{run.source}</span>
                    {run.aheadOfOrigin != null && run.aheadOfOrigin > 0 && (
                      <span
                        className="ml-2 rounded-full bg-warn-soft px-1.5 py-[3px] font-mono text-[11px] font-semibold tabular-nums text-warn"
                        title={`${run.aheadOfOrigin} commit(s) on ${run.ref} not yet pushed — origin consumers see an older run`}
                      >
                        ↑{run.aheadOfOrigin}
                      </span>
                    )}
                    {run.malformed && <p className="mt-[3px] text-[11.5px] text-bad">{run.malformed}</p>}
                  </td>
                  <td className={TD}>
                    <PhaseChip phase={run.phase} pausedReason={run.pausedReason} />
                  </td>
                  <td className={TD}>
                    <GateLedger gates={run.gates} />
                  </td>
                  <td className={NUM}>{run.tasks.total ? `${run.tasks.done}/${run.tasks.total}` : '—'}</td>
                  <td className={`${NUM} ${run.tasks.maxRounds >= 3 ? 'font-semibold text-bad' : ''}`}>
                    {run.tasks.total ? run.tasks.maxRounds : '—'}
                  </td>
                  <td className={TD}>
                    <BudgetMeter limit={run.budget.limit} spent={run.budget.spent} />
                  </td>
                  <td className={`${NUM} text-muted`}>{formatAge(run.updatedAt, now)}</td>
                  <td className="px-3 py-2 text-right">
                    {run.needsHuman > 0 ? (
                      <span
                        className="inline-flex min-w-[22px] justify-center rounded-full bg-accent px-2 py-[3px] font-mono text-[11px] font-bold tabular-nums text-on-solid shadow-[0_0_8px_var(--glow)]"
                      >
                        {run.needsHuman}
                      </span>
                    ) : run.escalationsOpen > 0 ? (
                      <span className="font-mono text-[11px] font-semibold text-bad">{run.escalationsOpen} esc</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
