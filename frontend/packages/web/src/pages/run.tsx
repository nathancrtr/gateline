// One run's story: header + gate ledger, the "needs you" panel, and tabs for
// artifacts, diff, and state history. Decision affordances live in the cards
// (M2 wires them to POST /api/decisions).
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useKeys } from '../use-keys.ts'
import { api, formatAge, formatWhen, type InboxItem, type RunDetailResponse } from '../api.ts'
import { AgeBadge, BudgetMeter, GateLedger, KindChip, PhaseChip, ValidationBadge } from '../components/chips.tsx'
import { DecidePanel } from '../components/decide.tsx'
import { DiffView } from '../components/diff-view.tsx'
import { Markdown } from '../components/markdown.tsx'
import { PageStatus } from './inbox.tsx'

type Tab = 'artifacts' | 'diff' | 'history'

export function RunPage() {
  const { src, slug } = useParams<{ src: string; slug: string }>()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) ?? 'artifacts'
  const artifact = params.get('artifact')

  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', src, slug],
    queryFn: () => api.run(src!, slug!),
    enabled: Boolean(src && slug),
  })

  // e cycles artifacts; esc returns to the inbox unless a decision is open.
  const keyHandlers = useMemo(
    () => ({
      e: () => {
        const paths = data?.artifacts ?? []
        if (!paths.length) return
        const current = new URLSearchParams(window.location.search).get('artifact')
        const idx = current ? paths.indexOf(current) : -1
        const nextPath = paths[(idx + 1) % paths.length]!
        const next = new URLSearchParams(window.location.search)
        next.set('tab', 'artifacts')
        next.set('artifact', nextPath)
        setParams(next, { replace: true })
      },
      Escape: () => {
        if (document.body.dataset.deciding !== 'true') void navigate('/')
      },
    }),
    [data, navigate, setParams],
  )
  useKeys(keyHandlers, Boolean(data))

  if (isLoading) return <PageStatus text="Reading run…" />
  if (error) return <PageStatus text={`Could not load run: ${(error as Error).message}`} bad />
  const detail = data!
  const { summary, items, now } = detail

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    if (t !== 'artifacts') next.delete('artifact')
    setParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{summary.slug}</h1>
        <PhaseChip phase={summary.phase} pausedReason={summary.pausedReason} />
        <GateLedger gates={summary.gates} />
        <span className="ml-auto flex items-center gap-4">
          {summary.aheadOfOrigin != null && summary.aheadOfOrigin > 0 && (
            <span
              className="rounded-full bg-warn-soft px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-warn"
              title={`${summary.aheadOfOrigin} commit(s) on ${summary.ref} not yet pushed — origin consumers see an older run`}
            >
              ↑{summary.aheadOfOrigin} unpushed
            </span>
          )}
          <BudgetMeter limit={summary.budget.limit} spent={summary.budget.spent} />
          <span className="font-mono text-xs text-faint" title={`read at ${summary.ref}`}>
            {summary.source} · {summary.ref}
          </span>
        </span>
      </header>

      {detail.stateError && (
        <div className="mb-6 rounded-lg border border-bad/40 bg-bad-soft px-4 py-3 text-sm">
          <p className="font-semibold text-bad">Malformed run state</p>
          <p className="mt-1 text-muted">{detail.stateError}</p>
          {detail.stateRaw && <pre className="mt-3 overflow-x-auto rounded bg-surface p-3 font-mono text-xs">{detail.stateRaw}</pre>}
        </div>
      )}

      {items.length > 0 && (
        <section className="mb-6 flex flex-col gap-3">
          {items.map((item, i) => (
            <NeedsYouCard
              key={`${item.kind}-${item.gate ?? item.escalationIndex ?? i}`}
              item={item}
              now={now}
              detail={detail}
              primary={i === items.findIndex((x) => x.reviewable)}
            />
          ))}
        </section>
      )}

      {summary.tasks.total > 0 && detail.state && <TaskBoard state={detail.state} />}

      <nav className="mb-4 mt-8 flex gap-1 border-b border-line">
        {(['artifacts', 'diff', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm capitalize transition-colors ${
              tab === t ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === 'artifacts' && (
        <ArtifactsTab
          detail={detail}
          selected={artifact}
          onSelect={(p) => {
            const next = new URLSearchParams(params)
            next.set('tab', 'artifacts')
            next.set('artifact', p)
            setParams(next, { replace: true })
          }}
        />
      )}
      {tab === 'diff' && <DiffTab src={summary.source} slug={summary.slug} />}
      {tab === 'history' && <HistoryTab history={detail.history} />}
    </div>
  )
}

/** A pending decision, rendered as a card with its decide affordances. */
function NeedsYouCard({ item, now, detail, primary }: { item: InboxItem; now: number; detail: RunDetailResponse; primary?: boolean }) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  return (
    <section
      className={`rounded-lg border px-4 py-3 ${item.reviewable ? 'border-accent/40 bg-accent-soft/40' : 'border-bad/40 bg-bad-soft'}`}
      data-needs-card
    >
      <div className="flex items-center gap-3">
        <KindChip item={item} />
        <span className="text-sm font-semibold">{item.title}</span>
        <span className="ml-auto">
          <AgeBadge label={`waiting ${formatAge(item.since, now)}`} urgent={urgent} />
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{item.detail}</p>
      {item.problems.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {item.problems.map((p) => (
            <li key={p} className="text-xs font-medium text-bad">
              ✕ {p}
            </li>
          ))}
        </ul>
      )}
      {item.packet.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {item.packet
            .filter((p) => detail.artifacts.includes(p) || p === 'state.yaml')
            .map((p) => (
              <Link
                key={p}
                to={`/runs/${item.source}/${item.slug}?tab=artifacts&artifact=${encodeURIComponent(p)}`}
                className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent/50 hover:text-accent"
              >
                {p}
              </Link>
            ))}
        </div>
      )}
      <DecidePanel item={item} primary={primary} />
    </section>
  )
}

function TaskBoard({ state }: { state: NonNullable<RunDetailResponse['state']> }) {
  return (
    <section className="flex flex-wrap gap-2">
      {state.tasks.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs">
          <span className="font-mono">{t.id}</span>
          <span className={t.status === 'done' ? 'text-ok' : 'text-muted'}>{t.status}</span>
          {t.review_rounds > 0 && (
            <span className={`font-mono tabular-nums ${t.review_rounds >= 3 ? 'font-semibold text-bad' : 'text-faint'}`} title="review rounds">
              ⟲{t.review_rounds}
            </span>
          )}
        </span>
      ))}
    </section>
  )
}

function ArtifactsTab({
  detail,
  selected,
  onSelect,
}: {
  detail: RunDetailResponse
  selected: string | null
  onSelect: (path: string) => void
}) {
  const paths = detail.artifacts
  const current = selected ?? paths.find((p) => p.endsWith('.md')) ?? paths[0] ?? null
  return (
    <div className="flex gap-5 max-md:flex-col">
      <nav className="w-56 shrink-0 max-md:w-full">
        <ul className="flex flex-col gap-0.5 max-md:flex-row max-md:flex-wrap">
          {paths.map((p) => {
            const v = detail.validations[p]
            return (
              <li key={p}>
                <button
                  onClick={() => onSelect(p)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                    p === current ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-raised hover:text-ink'
                  }`}
                >
                  <span className="truncate">{p}</span>
                  {v && <ValidationBadge ok={v.ok} missing={v.missing} />}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="min-w-0 flex-1">{current ? <ArtifactBody src={detail.summary.source} slug={detail.summary.slug} path={current} /> : <PageStatus text="No artifacts yet." />}</div>
    </div>
  )
}

function ArtifactBody({ src, slug, path }: { src: string; slug: string; path: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['artifact', src, slug, path],
    queryFn: () => api.artifact(src, slug, path),
  })
  if (isLoading) return <PageStatus text="Reading artifact…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  const { content, validation } = data!
  return (
    <article className="rounded-lg border border-line bg-surface px-6 py-5">
      {!validation.ok && (
        <p className="mb-4 rounded-md bg-bad-soft px-3 py-2 text-xs font-medium text-bad">
          Fails its {validation.contract} contract — missing: {validation.missing.join(', ')}
        </p>
      )}
      {path.endsWith('.md') ? <Markdown>{content}</Markdown> : <pre className="overflow-x-auto font-mono text-xs leading-5">{content}</pre>}
    </article>
  )
}

function DiffTab({ src, slug }: { src: string; slug: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['diff', src, slug], queryFn: () => api.diff(src, slug) })
  if (isLoading) return <PageStatus text="Computing diff…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  if (data!.merged) return <PageStatus text="Run is merged — its change lives in the default branch history now." />
  return <DiffView files={data!.files} />
}

function HistoryTab({ history }: { history: RunDetailResponse['history'] }) {
  if (history.length === 0) return <PageStatus text="No state history at this ref." />
  return (
    <ol className="flex flex-col">
      {history.map((h, i) => (
        <li key={h.oid} className="flex items-baseline gap-3 border-b border-line py-2.5 text-sm last:border-b-0">
          <span className="w-32 shrink-0 font-mono text-xs tabular-nums text-faint">{formatWhen(h.time)}</span>
          <span className="min-w-0 flex-1 truncate">{h.subject}</span>
          {h.phase && i < history.length - 1 && history[i + 1]!.phase !== h.phase && (
            <span className="shrink-0 font-mono text-[11px] text-accent">→ {h.phase}</span>
          )}
          <span className="w-24 shrink-0 truncate text-right text-xs text-muted">{h.author}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{h.oid.slice(0, 7)}</span>
        </li>
      ))}
    </ol>
  )
}
