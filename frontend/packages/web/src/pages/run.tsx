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

  if (isLoading) return <LoadingSkeleton text="Reading run…" />
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
      <header className="mb-5 flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-line pb-4">
        <h1 className="font-mono text-xl font-semibold tracking-[0.06em]">{summary.slug}</h1>
        <PhaseChip phase={summary.phase} pausedReason={summary.pausedReason} />
        <GateLedger gates={summary.gates} />
        <span className="ml-auto flex items-center gap-4">
          <BudgetMeter limit={summary.budget.limit} spent={summary.budget.spent} />
          <span className="font-mono text-xs text-faint" title={`read at ${summary.ref}`}>
            {summary.source} · {summary.ref}
          </span>
        </span>
      </header>

      {detail.stateError && (
        <div className="mb-6 rounded-[5px] border border-bad bg-bad-soft px-3.5 py-3">
          <p className="text-[13px] font-semibold text-bad">Malformed run state</p>
          <p className="mt-1 text-xs text-muted">{detail.stateError}</p>
          {detail.stateRaw && (
            <pre className="mt-2.5 overflow-x-auto rounded-[4px] bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink">{detail.stateRaw}</pre>
          )}
        </div>
      )}

      {items.length > 0 && (
        <section className="mb-[22px] flex flex-col gap-[22px]">
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

      <nav className="mb-[18px] mt-8 flex gap-1 border-b border-line">
        {(['artifacts', 'diff', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.06em] transition-colors ${
              tab === t ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-ink'
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

/** A pending decision, rendered as a card with its decide affordances. The
 * page's only live object: bg-surface + accent rail carrying .pulse-panel's
 * static glow ring and 2.8s pulse — bounced items lose the rail's glow and
 * the motion class entirely (no approval to draw the eye to). */
function NeedsYouCard({ item, now, detail, primary }: { item: InboxItem; now: number; detail: RunDetailResponse; primary?: boolean }) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  return (
    <section
      className={`relative rounded-md border border-l-[3px] bg-surface px-[18px] py-4 ${
        item.reviewable ? 'pulse-panel border-accent' : 'border-bad shadow-[0_0_0_1px_var(--color-bad-soft)]'
      }`}
      data-needs-card
    >
      <div className="flex items-center gap-3">
        <KindChip item={item} />
        <span className="text-[15px] font-semibold">{item.title}</span>
        <span className="ml-auto">
          <AgeBadge label={`waiting ${formatAge(item.since, now)}`} urgent={urgent} />
        </span>
      </div>
      <p className="mt-2 max-w-[76ch] text-sm text-muted">{item.detail}</p>
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
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.packet
            .filter((p) => detail.artifacts.includes(p) || p === 'state.yaml')
            .map((p) => (
              <Link
                key={p}
                to={`/runs/${item.source}/${item.slug}?tab=artifacts&artifact=${encodeURIComponent(p)}`}
                className="rounded border border-line bg-inset px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
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
    <section className="mb-6 flex flex-wrap gap-2">
      {state.tasks.map((t) => {
        const capped = t.review_rounds >= 3
        return (
          <span key={t.id} className="inline-flex items-center gap-2 rounded-[5px] border border-line bg-surface px-2.5 py-1.5 text-xs">
            <span className="font-mono">{t.id}</span>
            <span className={capped ? 'font-bold text-bad' : t.status === 'done' ? 'text-ok' : 'text-muted'}>{t.status}</span>
            {t.review_rounds > 0 && (
              <span className={`font-mono tabular-nums ${capped ? 'font-bold text-bad' : 'text-faint'}`} title="review rounds">
                ⟲{t.review_rounds}
              </span>
            )}
          </span>
        )
      })}
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
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
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
  if (isLoading) return <LoadingSkeleton text="Reading artifact…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  const { content, validation } = data!
  return (
    <article className="max-w-[76ch] rounded-md border border-line bg-surface px-6 py-5">
      {!validation.ok && (
        <p className="mb-4 rounded-[5px] border border-bad bg-bad-soft px-3 py-2 text-xs font-medium text-bad">
          Fails its {validation.contract} contract — missing: {validation.missing.join(', ')}
        </p>
      )}
      {path.endsWith('.md') ? <Markdown>{content}</Markdown> : <pre className="overflow-x-auto font-mono text-xs leading-5">{content}</pre>}
    </article>
  )
}

function DiffTab({ src, slug }: { src: string; slug: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['diff', src, slug], queryFn: () => api.diff(src, slug) })
  if (isLoading) return <LoadingSkeleton text="Computing diff…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  if (data!.merged) return <PageStatus text="Run is merged — its change lives in the default branch history now." />
  return <DiffView files={data!.files} />
}

/** The instrument log: a signal spine down the left (an accent-colored node
 * marks each phase transition, per candidate-b's run-history.html) built
 * from Tailwind's before: pseudo-element utilities — static border,
 * background, and shadow only; no new motion is defined here. */
function HistoryTab({ history }: { history: RunDetailResponse['history'] }) {
  if (history.length === 0) return <PageStatus text="No state history at this ref." />
  return (
    <ol className="relative ml-1.5 flex flex-col before:absolute before:bottom-1.5 before:left-1.5 before:top-1.5 before:w-0.5 before:bg-line before:content-['']">
      {history.map((h, i) => {
        const transition = Boolean(h.phase && i < history.length - 1 && history[i + 1]!.phase !== h.phase)
        return (
          <li
            key={h.oid}
            className={`relative flex items-baseline gap-3 border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:content-[''] ${
              transition ? 'before:border-accent before:bg-accent before:shadow-[0_0_10px_var(--glow)]' : 'before:border-faint before:bg-inset'
            }`}
          >
            <span className="w-32 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">{formatWhen(h.time)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{h.subject}</span>
            {transition && <span className="shrink-0 font-mono text-[11px] text-accent">→ {h.phase}</span>}
            <span className="w-24 shrink-0 truncate text-right text-[11.5px] text-muted">{h.author}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{h.oid.slice(0, 7)}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Loading treatment shared by the run/artifact/diff reads: a few .skel
 * sweep lines above the preserved PageStatus text (per the mockups' "Loading
 * · signal sweep" states). */
function LoadingSkeleton({ text }: { text: string }) {
  return (
    <div>
      <div className="mx-auto flex max-w-sm flex-col gap-2.5 pt-10">
        <span className="skel block h-3.5 w-[70%]" />
        <span className="skel block h-3.5 w-[90%]" />
        <span className="skel block h-3.5 w-[60%]" />
      </div>
      <PageStatus text={text} />
    </div>
  )
}
