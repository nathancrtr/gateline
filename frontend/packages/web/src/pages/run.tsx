// One run's story: header + gate ledger, the "needs you" panel, and tabs for
// artifacts, diff, and state history. Decision affordances live in the cards
// (M2 wires them to POST /api/decisions).
import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
// genesis-preview candidate (state.yaml gates.G1.notes): the run header's
// genesis line is display-only, rendered from data already in the run detail
// payload — readIntake reads the passthrough `intake:` block already on
// detail.state, and the genesis commit is the oldest entry already in
// detail.history. No new server data (ADR-6 rider, ADR-7).
import { readIntake } from '@agentic/core/record'
import { useKeys } from '../use-keys.ts'
import { api, formatAge, formatWhen, type InboxItem, type RunDetailResponse } from '../api.ts'
import { AgeBadge, BudgetMeter, GateLedger, KindChip, PhaseChip, ValidationBadge } from '../components/chips.tsx'
import { DecidePanel } from '../components/decide.tsx'
import { DiffView } from '../components/diff-view.tsx'
import { EvidenceRollupPanel } from '../components/evidence.tsx'
import { CitedObjects, LexiconProvider, useRunLexicon } from '../components/lexicon.tsx'
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
  const lexicon = useRunLexicon(src, slug)

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

  // The genesis line (genesis-preview candidate): whenever a run carries the
  // creation-seam's `intake:` block (every run staged via `agentic new`/`agentic
  // arm` or this web surface), the header names who staged it, from what, and
  // when — the record explaining why the run exists. Runs that predate the
  // seam have no intake block, so readIntake returns null and the line is
  // simply omitted.
  const genesisIntake = detail.state ? readIntake(detail.state) : null
  const genesisCommit = detail.history.length > 0 ? detail.history[detail.history.length - 1] : null
  const genesisProvenance = genesisIntake ? [genesisIntake.source, genesisIntake.ref, genesisIntake.url].filter((v): v is string => Boolean(v)) : []

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    if (t !== 'artifacts') next.delete('artifact')
    setParams(next, { replace: true })
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 grid grid-cols-[1fr_300px] gap-10 items-start border-b border-line pb-7">
        <div>
          <div className="font-mono text-[12px] tracking-[0.14em] uppercase text-accent-deep">
            {summary.phase} phase · {summary.profile} profile
            {items.length > 0 ? ' · needs you' : ''}
          </div>
          <h1 className="mt-2 mb-1.5 font-sans text-[46px] font-semibold leading-[1.06] tracking-[-0.02em]">{summary.slug}</h1>
          {genesisIntake && genesisCommit && (
            <p className="font-mono text-[12.5px] text-muted leading-[1.6]">
              staged by{' '}
              {genesisIntake.staged_by ? (
                <span className="font-medium text-[#4d4742]">{genesisIntake.staged_by}</span>
              ) : null}
              {genesisIntake.staged_by ? ' · ' : ''}
              {formatWhen(genesisCommit.time)}
              {genesisProvenance.length > 0 && <> · from {genesisProvenance.join(' · ')}</>}
              · branch <span className="font-mono">{summary.ref}</span>
            </p>
          )}
          <div className="flex items-center gap-3.5 flex-wrap mt-[18px]">
            <PhaseChip phase={summary.phase} pausedReason={summary.pausedReason} />
            <GateLedger gates={summary.gates} profile={summary.profile} />
          </div>
        </div>
        <aside className="rounded-md border border-line bg-surface px-3.5 py-1.5 shadow-[var(--shadow-soft)] text-[13px]">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted pt-2 pb-1.5">Run metadata</div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Phase</span>
            <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.phase}</span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Profile</span>
            <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.profile}</span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Gates</span>
            <span className="text-right">
              {(['G0', 'G1', 'G2', 'G3'] as const).map((g) => {
                const c = summary.gates[g]
                if (!c) return null
                const toneCls = c.approved ? 'text-ok' : c.decided ? 'text-bad' : 'text-warn'
                return (
                  <span key={g} className={`text-[12.5px] font-mono tabular-nums ${toneCls}`}>
                    {g}{c.approved ? '✓' : c.decided ? '✕' : '·'}{' '}
                  </span>
                )
              })}
            </span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Tasks</span>
            <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.tasks.done} / {summary.tasks.total}</span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Max rounds</span>
            <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.tasks.maxRounds}</span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Budget</span>
            <span className="text-right">
              <BudgetMeter limit={summary.budget.limit} spent={summary.budget.spent} />
            </span>
          </div>
          {summary.aheadOfOrigin != null && summary.aheadOfOrigin > 0 && (
            <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
              <span className="text-[12.5px] text-muted">Divergence</span>
              <span className={`text-[12.5px] font-mono tabular-nums text-right ${(summary.behindOrigin ?? 0) > 0 ? 'text-bad' : 'text-warn'}`}>
                ↑{summary.aheadOfOrigin}{(summary.behindOrigin ?? 0) > 0 && <>↓{summary.behindOrigin}</>}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Needs you</span>
            <span className={`text-[12.5px] font-mono tabular-nums text-right ${summary.needsHuman > 0 ? 'text-bad' : 'text-ok'}`}>{summary.needsHuman}</span>
          </div>
          <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
            <span className="text-[12.5px] text-muted">Updated</span>
            <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">
              {summary.updatedAt ? formatAge(summary.updatedAt, Date.now() / 1000) + ' ago' : '—'}
            </span>
          </div>
        </aside>
      </header>

      {detail.stateError && (
        <div className="mb-6 rounded-md border border-bad-line bg-bad-bg px-3.5 py-3">
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

      <nav className="mt-9 mb-[18px] flex gap-0.5 border-b border-line">
        <button
          onClick={() => setTab('artifacts')}
          className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
            tab === 'artifacts' ? 'border-accent text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Artifacts
          <span className="ml-1.5 font-mono text-[11px] text-faint">{detail.artifacts.length}</span>
        </button>
        <button
          onClick={() => setTab('diff')}
          className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
            tab === 'diff' ? 'border-accent text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          Diff
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2.5 text-[13.5px] font-medium border-b-2 -mb-px transition-colors ${
            tab === 'history' ? 'border-accent text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          History
          <span className="ml-1.5 font-mono text-[11px] text-faint">{detail.history.length}</span>
        </button>
      </nav>

      {tab === 'artifacts' && (
        <LexiconProvider value={lexicon}>
          <ArtifactsTab
            detail={detail}
            selected={artifact}
            onSelect={(p) => {
              const next = new URLSearchParams(params)
              next.set('tab', 'artifacts')
              next.set('artifact', p)
              next.delete('anchor')
              setParams(next, { replace: true })
            }}
          />
        </LexiconProvider>
      )}
      {tab === 'diff' && <DiffTab src={summary.source} slug={summary.slug} />}
      {tab === 'history' && <HistoryTab history={detail.history} />}
    </div>
  )
}

/** A pending decision, rendered as a stakes-varied card. Candidate A:
 *  4px accent left-rail + tinted ground + lifted shadow. Reviewable cards
 *  get accent-tint ground, bounced cards get bad-bg — no animation, no glow. */
function NeedsYouCard({ item, now, detail, primary }: { item: InboxItem; now: number; detail: RunDetailResponse; primary?: boolean }) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  return (
    <section
      className={`relative grid overflow-hidden rounded-lg ${
        item.reviewable
          ? 'grid-cols-[4px_1fr] bg-accent-tint border border-[#e9d3c4] shadow-[var(--shadow-lift)]'
          : 'grid-cols-[4px_1fr] bg-bad-bg border border-bad-line'
      }`}
      data-needs-card
    >
      <span
        className={`w-[4px] self-stretch ${item.reviewable ? 'bg-accent' : 'bg-bad'}`}
        aria-hidden="true"
      />
      <div className="px-7 py-[22px]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] uppercase text-accent-deep bg-white border border-[#e9d3c4] px-[9px] py-[3px] rounded-xs">
            <span className="inline-block w-[7px] h-[7px] rounded-full bg-accent" />
            Needs you{item.gate ? ` · ${item.gate}` : ''}
          </span>
          <KindChip item={item} />
          <span className="ml-auto">
            <AgeBadge label={`waiting ${formatAge(item.since, now)}`} urgent={urgent} />
          </span>
        </div>
        <h2 className="mt-2.5 mb-4 font-sans text-[26px] font-semibold tracking-[-0.015em] text-ink">{item.title}</h2>
        <p className="max-w-[76ch] text-[14.5px] text-[#4d4742] leading-[1.55]">{item.detail}</p>
        {item.problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {item.problems.map((p) => (
              <li key={p} className="font-mono text-[12px] text-bad">
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
                  className="rounded-xs border border-line-cool bg-surface px-2 py-0.5 font-mono text-[11.5px] text-muted hover:border-accent hover:text-accent-deep"
                >
                  {p}
                </Link>
              ))}
          </div>
        )}
        {item.kind === 'gate' && item.gate === 'G2' && <EvidenceRollupPanel src={item.source} slug={item.slug} />}
        <DecidePanel item={item} primary={primary} />
      </div>
    </section>
  )
}

function TaskBoard({ state }: { state: NonNullable<RunDetailResponse['state']> }) {
  const doneCount = state.tasks.filter((t) => t.status === 'done').length
  return (
    <section className="mt-[26px] mb-6">
      <div className="font-mono text-[11px] tracking-[0.12em] uppercase text-muted mb-2.5">
        Task board · {state.tasks.length} task{state.tasks.length !== 1 ? 's' : ''} · {doneCount} review-approved
      </div>
      <div className="flex gap-2.5 flex-wrap">
        {state.tasks.map((t) => {
          const capped = t.review_rounds >= 3
          const statusChip = capped
            ? 'font-bold text-bad bg-bad-bg border-bad-line'
            : t.status === 'done'
              ? 'text-ok bg-ok-bg border-ok-line'
              : 'text-muted bg-inset border-line'
          return (
            <span
              key={t.id}
              className="inline-flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-[var(--shadow-soft)]"
            >
              <span className="font-mono text-[12.5px] text-ink font-medium">{t.id}</span>
              <span className={`rounded-xs border px-2 py-0.5 text-[11.5px] font-semibold ${statusChip}`}>
                {t.status === 'done' ? '✓ ' : ''}{t.status}
              </span>
              {t.review_rounds > 0 && (
                <span className={`font-mono text-[11.5px] tabular-nums ${capped ? 'font-bold text-bad' : 'text-muted'}`} title="review rounds">
                  ⟲{t.review_rounds}
                </span>
              )}
            </span>
          )
        })}
      </div>
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
    <div className="grid grid-cols-[280px_1fr] gap-0 max-md:flex max-md:flex-col border-b border-line">
      <nav className="border-r border-line bg-surface py-[18px] max-md:w-full max-md:border-r-0">
        <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase text-muted px-[18px] pb-2.5">
          Artifacts · runs/{detail.summary.slug}/
        </div>
        <ul className="flex flex-col max-md:flex-row max-md:flex-wrap">
          {paths.map((p) => {
            const v = detail.validations[p]
            return (
              <li key={p}>
                <button
                  onClick={() => onSelect(p)}
                  className={`flex w-full items-center gap-2.5 px-[18px] py-2.5 text-left font-mono text-[12.5px] border-l-2 transition-colors ${
                    p === current
                      ? 'bg-accent-tint border-l-accent text-accent-deep font-semibold'
                      : 'border-l-transparent text-[#4d4742] hover:bg-inset hover:text-ink'
                  }`}
                >
                  {v && <ValidationBadge ok={v.ok} missing={v.missing} />}
                  <span className="truncate">{p}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {current && detail.validations[current] && !detail.validations[current].ok && (
          <div className="mx-[18px] mt-3.5 rounded-sm border border-bad-line bg-bad-bg px-3 py-2.5 text-[12px] text-bad">
            Fails its {detail.validations[current].contract} contract — missing: {detail.validations[current].missing.join(', ')}
          </div>
        )}
      </nav>
      <div className="min-w-0">
        {current ? (
          <ArtifactBody src={detail.summary.source} slug={detail.summary.slug} path={current} />
        ) : (
          <PageStatus text="No artifacts yet." />
        )}
      </div>
    </div>
  )
}

function ArtifactBody({ src, slug, path }: { src: string; slug: string; path: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['artifact', src, slug, path],
    queryFn: () => api.artifact(src, slug, path),
  })
  // Jump-to-definition (#163): the anchor param lands on the def-<id> heading
  // ids the lexicon rehype stage stamps onto R/ADR definition headings.
  const [params] = useSearchParams()
  const anchor = params.get('anchor')
  useEffect(() => {
    if (anchor && data) document.getElementById(anchor)?.scrollIntoView({ block: 'start' })
  }, [anchor, data])
  if (isLoading) return <LoadingSkeleton text="Reading artifact…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  const { content, validation } = data!
  return (
    <article className="bg-reading-bg py-10 px-14 relative min-h-0">
      <div className="mx-auto max-w-[76ch]">
        <div className="flex items-center gap-2.5 font-mono text-[11.5px] text-muted pb-[18px] border-b border-line mb-[30px]">
          <span className="text-[#4d4742]">runs/{slug}/{path}</span>
          <span className="ml-auto font-semibold">
            {validation.ok ? (
              <span className="text-ok"><span className="mr-1">✓</span>passes {validation.contract} contract</span>
            ) : (
              <span className="text-bad"><span className="mr-1">✕</span>fails {validation.contract} contract</span>
            )}
          </span>
        </div>
        {!validation.ok && (
          <p className="mb-4 rounded-sm border border-bad-line bg-bad-bg px-3 py-2 text-xs font-medium text-bad">
            Fails its {validation.contract} contract — missing: {validation.missing.join(', ')}
          </p>
        )}
        <CitedObjects content={content} path={path} />
        {path === 'verification-report.md' && (
          <div className="mb-4">
            <EvidenceRollupPanel src={src} slug={slug} />
          </div>
        )}
        {path.endsWith('.md') ? (
          <Markdown sourcePath={path}>{content}</Markdown>
        ) : (
          <pre className="overflow-x-auto font-mono text-xs leading-5">{content}</pre>
        )}
      </div>
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
              transition ? 'before:border-accent before:bg-accent' : 'before:border-faint before:bg-inset'
            }`}
          >
            <span className="w-32 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">{formatWhen(h.time)}</span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{h.subject}</span>
            {transition && <span className="shrink-0 font-mono text-[11px] text-accent-deep">→ {h.phase}</span>}
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
