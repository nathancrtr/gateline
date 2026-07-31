// One run's story: header + gate ledger, the "needs you" panel, and tabs for
// artifacts, diff, and state history. Decision affordances live in the cards
// (M2 wires them to POST /api/decisions).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
// genesis-preview candidate (state.yaml gates.G1.notes): the run header's
// genesis line is display-only, rendered from data already in the run detail
// payload — readIntake reads the passthrough `intake:` block already on
// detail.state, and the genesis commit is the oldest entry already in
// detail.history. No new server data (ADR-6 rider, ADR-7).
import { readIntake } from '@agentic/core/record'
import { useKeys } from '../use-keys.ts'
import { decideTargetIndex, landingArtifact } from '../landing.ts'
import { PROFILE_GATES, api, formatAge, formatWhen, type InboxItem, type Profile, type RunDetailResponse, type RunSummary } from '../api.ts'
import { AgeBadge, BudgetMeter, GateLedger, KindChip, PhaseChip, ValidationBadge } from '../components/chips.tsx'
import { DecidePanel } from '../components/decide.tsx'
import { DiffView } from '../components/diff-view.tsx'
import { EvidenceRollupPanel } from '../components/evidence.tsx'
import { FindingsPanel, VerdictChip, useReviews } from '../components/findings.tsx'
import { CitedObjects, CitedText, LexiconProvider, useRunLexicon } from '../components/lexicon.tsx'
import { Markdown } from '../components/markdown.tsx'
import { PageStatus } from './inbox.tsx'

type Tab = 'artifacts' | 'diff' | 'history'

const isReviewPath = (p: string) => /^review-\d+.*\.md$/.test(p)

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

  // Two page modes, chosen by whether anything needs a human (the brief's
  // A4: density follows the job). Busy — decisions pending — is a two-column
  // band closed by a full-width rule: cards left, quiet status rail right.
  // Quiet is one column: the status facts flow horizontally under the header
  // and the record (tabs) rises. Status content is never boxed — card chrome
  // belongs to the decision cards alone, so no box edge is left waiting to
  // align with another.
  const busy = items.length > 0

  // The inbox already encodes what it is calling you to decide (`?decide=G2`,
  // `esc-<n>`, `paused`, `staged`); until #216 the run page dropped it on the
  // floor. When it names a card that is still pending, that card is the one
  // the keyboard loop drives and the one focus lands on. A stale or unknown
  // value resolves to -1 and everything below behaves exactly as before.
  const decideIndex = decideTargetIndex(params.get('decide'), items)
  const primaryIndex = decideIndex >= 0 ? decideIndex : items.findIndex((x) => x.reviewable)

  const header = (
    <header className="mb-6">
      <div className="font-mono text-[12px] tracking-[0.14em] uppercase text-accent-deep">
        {summary.phase} phase · {summary.profile} profile
        {busy ? ' · needs you' : ''}
      </div>
      <h1 className="mt-2 mb-1.5 font-sans text-[46px] font-semibold leading-[1.06] tracking-[-0.02em]">{summary.slug}</h1>
      <p className="font-mono text-[12.5px] text-muted leading-[1.6]">
        {genesisIntake && genesisCommit && (
          <>
            staged by{' '}
            {genesisIntake.staged_by ? (
              <span className="font-medium text-[#4d4742]">{genesisIntake.staged_by}</span>
            ) : null}
            {genesisIntake.staged_by ? ' · ' : ''}
            {formatWhen(genesisCommit.time)}
            {genesisProvenance.length > 0 && <> · from {genesisProvenance.join(' · ')}</>}
            {' · '}
          </>
        )}
        <BranchRef refName={summary.ref} kind={summary.kind} url={detail.branchUrl} />
      </p>
      <div className="flex items-center gap-3.5 flex-wrap mt-[18px]">
        <PhaseChip phase={summary.phase} pausedReason={summary.pausedReason} />
        <GateLedger gates={summary.gates} profile={summary.profile} />
      </div>
    </header>
  )

  const stateErrorBlock = detail.stateError ? (
    <div className="mb-6 rounded-md border border-bad-line bg-bad-bg px-3.5 py-3">
      <p className="text-[13px] font-semibold text-bad">Malformed run state</p>
      <p className="mt-1 text-xs text-muted">{detail.stateError}</p>
      {detail.stateRaw && (
        <pre className="mt-2.5 overflow-x-auto rounded-[4px] bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink">{detail.stateRaw}</pre>
      )}
    </div>
  ) : null

  const board = summary.tasks.total > 0 && detail.state ? <TaskBoard state={detail.state} /> : null

  // The lexicon covers the whole page, not just the artifact reader: a
  // decision card that names AC2.1 should resolve it where it stands (#252).
  return (
    <LexiconProvider value={lexicon}>
      <div className="mx-auto max-w-5xl">
        {busy ? (
          <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-10 items-start max-md:flex max-md:flex-col border-b border-line pb-7">
            <div className="min-w-0 max-md:w-full">
              {header}
              {stateErrorBlock}
              <section className="flex flex-col gap-4">
                {items.map((item, i) => (
                  <NeedsYouCard
                    key={`${item.kind}-${item.gate ?? item.escalationIndex ?? i}`}
                    item={item}
                    now={now}
                    detail={detail}
                    primary={i === primaryIndex}
                    sentHere={i === decideIndex}
                  />
                ))}
              </section>
            </div>
            <aside className="md:sticky md:top-6 max-md:w-full min-w-0">
              <RunFacts summary={summary} />
              {board && <div className="mt-7">{board}</div>}
            </aside>
          </div>
        ) : (
          <div className="border-b border-line pb-7">
            {header}
            {stateErrorBlock}
            <div className="flex flex-wrap items-start gap-x-14 gap-y-7 text-[13px]">
              <section className="w-[300px]">
                <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted pb-1.5">Gates</div>
                <GateLines gates={summary.gates} profile={summary.profile} rows />
              </section>
              {board && <div className="w-[300px]">{board}</div>}
              <section className="w-[230px]">
                <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted pb-1.5">Vitals</div>
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
                  <span className="text-[12.5px] text-muted">Updated</span>
                  <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">
                    {summary.updatedAt ? formatAge(summary.updatedAt, Date.now() / 1000) + ' ago' : '—'}
                  </span>
                </div>
              </section>
            </div>
          </div>
        )}

        <nav className="mt-6 mb-[18px] flex gap-0.5 border-b border-line">
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
        )}
        {tab === 'diff' && <DiffTab src={summary.source} slug={summary.slug} />}
        {tab === 'history' && <HistoryTab history={detail.history} src={src!} slug={slug!} />}
      </div>
    </LexiconProvider>
  )
}

/** A pending decision, rendered as a stakes-varied card. Candidate A:
 *  4px accent left-rail + tinted ground + lifted shadow. Reviewable cards
 *  get accent-tint ground, bounced cards get bad-bg — no animation, no glow. */
function NeedsYouCard({
  item,
  now,
  detail,
  primary,
  sentHere,
}: {
  item: InboxItem
  now: number
  detail: RunDetailResponse
  primary?: boolean
  sentHere?: boolean
}) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  // Arriving from an inbox link: bring the named card into view and give it
  // focus, so the decision is where the eye and the keyboard already are.
  const cardRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!sentHere) return
    cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    cardRef.current?.focus({ preventScroll: true })
  }, [sentHere])
  // The card names artifacts and tasks in prose; resolve those mentions from
  // data already in the detail payload so the card answers "what happened,
  // where do I look" without a trip to the tabs.
  const reports = useReviews(item.source, item.slug)
  const prose = `${item.title} ${item.detail}`
  const mentioned = detail.artifacts.filter((p) => !item.packet.includes(p) && prose.includes(p))
  const chipPaths = [...item.packet.filter((p) => detail.artifacts.includes(p) || p === 'state.yaml'), ...mentioned]
  const mentionedTask = detail.state?.tasks.find((t) => prose.includes(t.id)) ?? null
  // A packet chip that names a review carries what that review concluded
  // (#215) — the G2 approver should not have to open three files to learn
  // that one of them said request-changes.
  const chips =
    chipPaths.length > 0 ? (
      <>
        {chipPaths.map((p) => {
          const report = isReviewPath(p) ? reports?.find((r) => r.path === p) : undefined
          return (
            <Link
              key={p}
              to={`/runs/${item.source}/${item.slug}?tab=artifacts&artifact=${encodeURIComponent(p)}`}
              className="inline-flex items-center gap-1.5 rounded-xs border border-line-cool bg-surface px-2 py-0.5 font-mono text-[11.5px] text-muted hover:border-accent hover:text-accent-deep"
            >
              {p}
              {report && report.rounds.length > 0 && <VerdictChip verdicts={report.rounds.map((r) => r.verdict)} />}
            </Link>
          )
        })}
      </>
    ) : null
  // No overflow-hidden on the card: the lexicon hover card (#252) is
  // absolutely positioned and would be clipped by it. The accent rail rounds
  // its own left corners instead, which is all the clip was ever doing.
  return (
    <section
      className={`relative grid rounded-lg ${
        item.reviewable
          ? 'grid-cols-[4px_1fr] bg-accent-tint border border-[#e9d3c4] shadow-[var(--shadow-lift)]'
          : 'grid-cols-[4px_1fr] bg-bad-bg border border-bad-line'
      }`}
      data-needs-card
      data-sent-here={sentHere ? 'true' : undefined}
      ref={cardRef}
      tabIndex={-1}
    >
      <span
        className={`w-[4px] self-stretch rounded-l-[7px] ${item.reviewable ? 'bg-accent' : 'bg-bad'}`}
        aria-hidden="true"
      />
      <div className="min-w-0 px-6 py-4">
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
        <h2 className="mt-2 mb-1.5 font-sans text-[24px] font-semibold leading-[1.2] tracking-[-0.015em] text-ink">
          <CitedText>{item.title}</CitedText>
        </h2>
        <p className="max-w-[76ch] text-[14.5px] text-[#4d4742] leading-[1.55]">
          <CitedText>{item.detail}</CitedText>
        </p>
        {mentionedTask && (
          <p className="mt-1.5 font-mono text-[12px] text-muted">
            {mentionedTask.id} · {mentionedTask.status} · review round {mentionedTask.review_rounds}/3
          </p>
        )}
        {item.problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {item.problems.map((p) => (
              <li key={p} className="font-mono text-[12px] text-bad">
                ✕ {p}
              </li>
            ))}
          </ul>
        )}
        {item.kind === 'gate' && item.gate === 'G2' && <EvidenceRollupPanel src={item.source} slug={item.slug} />}
        <DecidePanel item={item} profile={detail.summary.profile} primary={primary} sentHere={sentHere} chips={chips} />
      </div>
    </section>
  )
}

/** Gate provenance lines — who decided each gate, and when. Right-aligned
 * stack in the busy rail; `rows` renders them as hairline rows for the quiet
 * facts block. */
function GateLines({ gates, profile, rows = false }: { gates: RunSummary['gates']; profile: Profile; rows?: boolean }) {
  return (
    <>
      {PROFILE_GATES[profile].map((g) => {
        const c = gates[g]
        if (!c) return null
        const toneCls = c.approved ? 'text-ok' : c.decided ? 'text-bad' : 'text-warn'
        return (
          <span key={g} className={`text-[12px] font-mono tabular-nums ${toneCls} ${rows ? 'block border-t border-line py-[7px]' : ''}`}>
            {g} {c.approved ? '✓' : c.decided ? '✕' : '·'}
            {c.decided ? (
              <span className="text-muted"> {c.by ?? '—'}{c.at ? ` · ${String(c.at).slice(0, 10)}` : ''}</span>
            ) : (
              <span className="text-faint"> pending</span>
            )}
          </span>
        )
      })}
    </>
  )
}

/**
 * The ref the run is read at, linked to its page on the git host when one can
 * be named (#267). #259's principle 7 is why this is a link and not a view: a
 * branch page is commodity — commits, files, the associated PR — and the host
 * will always do it better. The link is also the prerequisite for retiring the
 * generic views, so it has to exist before anything is deleted.
 *
 * `url === null` is the ordinary case, not an error: a local-only source, a
 * repo with no origin, a remote this cannot resolve without guessing, or a
 * merged run whose branch is gone. The ref still shows — the fact is the fact —
 * it simply is not a link.
 *
 * A `default`-kind run is the one case where the word matters: its run branch
 * no longer exists, and the ref shown is the default branch the record is now
 * read *at*. Calling that "branch main" would name the wrong branch.
 */
function BranchRef({ refName, kind, url }: { refName: string; kind: RunSummary['kind']; url: string | null }) {
  const label = kind === 'default' ? 'read at' : 'branch'
  if (!url) return <>{label} <span className="font-mono">{refName}</span></>
  return (
    <>
      {label}{' '}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        data-branch-link
        className="font-mono text-accent underline underline-offset-2 hover:text-ink"
        title={`Open ${refName} on the git host`}
      >
        {refName} ↗
      </a>
    </>
  )
}

/** The busy-mode status rail: quiet, unboxed key/value rows — mono labels
 * and hairlines only, deliberately not a card, so nothing competes with the
 * decision cards or leaves a box edge waiting to align with one. */
function RunFacts({ summary }: { summary: RunSummary }) {
  return (
    <div className="text-[13px]">
      <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted pb-1.5">Run metadata</div>
      <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
        <span className="text-[12.5px] text-muted">Phase</span>
        <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.phase}</span>
      </div>
      <div className="flex justify-between items-center gap-3 py-[7px] border-t border-line">
        <span className="text-[12.5px] text-muted">Profile</span>
        <span className="text-[12.5px] text-ink font-mono tabular-nums text-right">{summary.profile}</span>
      </div>
      <div className="flex justify-between gap-3 py-[7px] border-t border-line">
        <span className="text-[12.5px] text-muted">Gates</span>
        <span className="flex flex-col items-end gap-[3px] text-right">
          <GateLines gates={summary.gates} profile={summary.profile} />
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
    </div>
  )
}

/** The task board shares the status grammar — mono label, hairline rows —
 * and, like all status content, is never boxed. */
function TaskBoard({ state }: { state: NonNullable<RunDetailResponse['state']> }) {
  const doneCount = state.tasks.filter((t) => t.status === 'done').length
  return (
    <section className="text-[13px]">
      <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted pb-1.5">
        Task board · {doneCount} / {state.tasks.length} done
      </div>
      {state.tasks.map((t) => {
        const capped = t.review_rounds >= 3
        const statusChip = capped
          ? 'font-bold text-bad bg-bad-bg border-bad-line'
          : t.status === 'done'
            ? 'text-ok bg-ok-bg border-ok-line'
            : 'text-muted bg-inset border-line'
        return (
          <div key={t.id} className="flex items-center justify-between gap-3 py-[7px] border-t border-line">
            <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-ink">{t.id}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {t.review_rounds > 0 && (
                <span className={`font-mono text-[11.5px] tabular-nums ${capped ? 'font-bold text-bad' : 'text-muted'}`} title="review rounds">
                  ⟲{t.review_rounds}
                </span>
              )}
              <span className={`rounded-xs border px-2 py-0.5 text-[11px] font-semibold ${statusChip}`}>
                {t.status === 'done' ? '✓ ' : ''}{t.status}
              </span>
            </span>
          </div>
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
  // An explicit selection always wins; otherwise the pending gate's own packet
  // decides what opens (#250), and only then does filename order get a say.
  const current =
    selected ??
    landingArtifact({ items: detail.items, profile: detail.summary.profile, artifacts: paths }) ??
    paths.find((p) => p.endsWith('.md')) ??
    paths[0] ??
    null
  // Verdict chips on the review entries (#215): what the review concluded,
  // without opening it. Reports load lazily; until they do, the list is
  // exactly what it was.
  const reports = useReviews(detail.summary.source, detail.summary.slug)
  const verdictsFor = (path: string) => {
    const report = reports?.find((r) => r.path === path)
    if (!report || report.rounds.length === 0) return null
    return <VerdictChip verdicts={report.rounds.map((r) => r.verdict)} compact />
  }
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
                  {verdictsFor(p) && <span className="ml-auto">{verdictsFor(p)}</span>}
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
        {isReviewPath(path) && <FindingsPanel src={src} slug={slug} path={path} />}
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

/** Actor treatment: a human decision reads as the decision it is; the engine's
 * verbs sit back in mono. The distinction is a fact of the grammar — the
 * `G<N> approved by <name>` form is reserved for named humans (AGENTS.md) and
 * the orchestrator structurally never writes `gates.*`. */
const LEDGER_TONE: Record<string, string> = {
  human: 'text-ink font-medium',
  orchestrator: 'font-mono text-[12px] text-muted',
  unknown: 'text-muted',
}

/** Verbs that carry a decision, and so earn a filled marker on the spine. */
const DECISION_KINDS = new Set(['gate-approved', 'gate-declined', 'escalation-resolved', 'paused', 'resumed', 'armed', 'staged'])

/**
 * The decision ledger (#268): `state.yaml`'s history read as the decisions and
 * dispatches it records, not as a commit log. Per #259 / FRONTEND.md §4.1, time,
 * subject, author and short oid are the host's job — phase transitions, gate
 * approvals under the `G<N> approved by <name>` grammar, and the orchestrator's
 * verbs are what no host can represent.
 *
 * Verbatim and reachable (#261's standing rule): every word rendered comes
 * byte-identical from the record — `detail` is the raw remainder of the commit
 * subject and the extracted fields are substrings of it — and the raw commit
 * columns stay one toggle away rather than being deleted. Nothing here is
 * summarized and no verdict is computed.
 *
 * Gate decisions are enriched from the decisions endpoint, which reads
 * `state.yaml` *content* rather than subjects — this is what keeps the ledger
 * useful on the v0 runs (wordfreq/mdtoc/dupefind), whose commits predate the
 * `state(<slug>):` grammar and therefore all read as `other`.
 */
function HistoryTab({ history, src, slug }: { history: RunDetailResponse['history']; src: string; slug: string }) {
  const [raw, setRaw] = useState(false)
  // A run whose state.yaml is schema-invalid still renders its ledger (#198
  // precedent): parsing reads commit subjects only and never touches the state,
  // so a failed decisions fetch degrades this view rather than emptying it.
  const { data: decisions } = useQuery({
    queryKey: ['decisions', src, slug],
    queryFn: () => api.decisions(src, slug),
    enabled: Boolean(src && slug),
    retry: false,
  })

  const burdenByGate = useMemo(() => {
    const m = new Map<string, { burden: string | null; notes: string | null }>()
    for (const d of decisions?.decisions ?? []) m.set(d.gate, { burden: d.burden, notes: d.notes })
    return m
  }, [decisions])

  if (history.length === 0) return <PageStatus text="No state history at this ref." />

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          className="font-mono text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          aria-pressed={raw}
        >
          {raw ? 'hide raw commits' : 'show raw commits'}
        </button>
      </div>
      <ol
        data-ledger
        className="relative ml-1.5 flex flex-col before:absolute before:bottom-1.5 before:left-1.5 before:top-1.5 before:w-0.5 before:bg-line before:content-['']"
      >
        {history.map((h, i) => {
          const transition = Boolean(h.phase && i < history.length - 1 && history[i + 1]!.phase !== h.phase)
          const e = h.ledger
          const decided = DECISION_KINDS.has(e.kind)
          const extra = e.gate ? burdenByGate.get(e.gate) : undefined
          return (
            <li
              key={h.oid}
              data-ledger-actor={e.actor}
              data-ledger-kind={e.kind}
              className={`relative flex items-baseline gap-3 border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:content-[''] ${
                transition
                  ? 'before:border-accent before:bg-accent'
                  : decided
                    ? 'before:border-accent before:bg-inset'
                    : 'before:border-faint before:bg-inset'
              }`}
            >
              <span className="w-32 shrink-0 font-mono text-[11.5px] tabular-nums text-faint">{formatWhen(h.time)}</span>
              <span className={`min-w-0 flex-1 truncate text-[13px] ${LEDGER_TONE[e.actor] ?? ''}`} title={h.subject}>
                {e.detail}
              </span>
              {/* Burden and notes come from the decisions endpoint, quoted, never scored. */}
              {extra?.burden && (
                <span className="shrink-0 rounded-xs border border-line px-1.5 py-px font-mono text-[10.5px] text-muted">{extra.burden}</span>
              )}
              {e.actor === 'orchestrator' && (
                <span className="shrink-0 font-mono text-[10.5px] text-faint" title="committed under the orchestrator's bot identity">
                  engine
                </span>
              )}
              {transition && <span className="shrink-0 font-mono text-[11px] text-accent-deep">→ {h.phase}</span>}
              {raw && (
                <>
                  <span className="w-24 shrink-0 truncate text-right text-[11.5px] text-muted">{h.author}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{h.oid.slice(0, 7)}</span>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </div>
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
