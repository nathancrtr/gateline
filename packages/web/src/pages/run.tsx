// One run's story: header + gate ledger, then the surface the run's own state
// asks for — Decide, Record, History (#258). Those are three tasks, not three
// storage locations: the tab bar this replaced was `Artifacts | Diff | History`,
// a filesystem hierarchy standing in for the human's job at a gate.
// Decision affordances live in the cards (M2 wires them to POST /api/decisions).

// genesis-preview candidate (state.yaml gates.G1.notes): the run header's
// genesis line is display-only, rendered from data already in the run detail
// payload — readIntake reads the passthrough `intake:` block already on
// detail.state, and the genesis commit is the oldest entry already in
// detail.history. No new server data (ADR-6 rider, ADR-7).
import { readIntake, splitSections } from '@gateline/core/record'
import { useQuery } from '@tanstack/react-query'
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api, formatAge, formatWhen, type InboxItem, type Phase, PROFILE_PHASES, type RunDetailResponse, type RunSummary } from '../api.ts'
import { AgeBadge, BudgetMeter, Imp, KeyHints, KindChip, PhaseChip, PhaseSpine, ValidationBadge } from '../components/chips.tsx'
import { CloseRunPanel, ClosureRecordBlock } from '../components/close-run.tsx'
import { BOUNCED_INSTRUCTION, DecidePanel, INFLIGHT_INSTRUCTION, ROUND_CAP_INSTRUCTION } from '../components/decide.tsx'
import { DiffView } from '../components/diff-view.tsx'
import { EvidenceRollupPanel, G2Packet } from '../components/evidence.tsx'
import { FindingsPanel, useReviews, VerdictChip } from '../components/findings.tsx'
import { G1Packet } from '../components/g1.tsx'
import { CitedObjects, CitedText, LexiconProvider, useRunLexicon } from '../components/lexicon.tsx'
import { Markdown } from '../components/markdown.tsx'
import { RoundCapPanel } from '../components/rounds.tsx'
import { isAuditSection, itemCount } from '../fold.ts'
import { gateCardState } from '../gate-state.ts'
import { DIFF_SELECTION, decideTargetIndex, landingArtifact, resolveSurface, type Surface } from '../landing.ts'
import { collapseEngineSpans } from '../ledger-spans.ts'
import { EdgeFade, useScrollCue } from '../scroll-cue.tsx'
import { type KeyHint, useKeys } from '../use-keys.ts'
import { PageStatus } from './inbox.tsx'

const isReviewPath = (p: string) => /^review-\d+.*\.md$/.test(p)

/**
 * The record, in the order the pipeline wrote it (#285/4).
 *
 * The picker was alphabetical, which is not an order — it is the absence of
 * one, and it put `review-01.md` above `spec.md` so the run's narrative came
 * out as an accident of naming. Reading top to bottom is how anyone catches up
 * on a run they did not watch happen, so the list reads the way the run went:
 * brief, spec, plan, the work items, the reviews of them, the verification, the
 * release plan, and `state.yaml` last as the ledger that records all of it.
 *
 * Ranks, not a comparator table: a file the framework has not met yet lands
 * between the phases and the ledger rather than at an arbitrary end, and ties
 * inside a rank stay alphabetical, which is the right order for `tasks/*` and
 * `review-*` because their names are numbered.
 */
export function artifactRank(path: string): number {
  if (path === 'intent-brief.md') return 0
  if (path === 'spec.md') return 1
  if (path === 'plan.md') return 2
  if (path.startsWith('tasks/')) return 3
  if (isReviewPath(path)) return 4
  if (path === 'verification-report.md') return 5
  if (path === 'release-plan.md') return 6
  if (path === 'state.yaml') return 8
  return 7
}

export function orderArtifacts(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => artifactRank(a) - artifactRank(b) || a.localeCompare(b))
}

/** Bare grammar — words that carry no fact of their own, so a sentence built
 *  only from these plus words already on screen adds nothing to the screen. */
const GRAMMAR = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
])

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/**
 * Does `line` say only what `shown` has already said? (#294)
 *
 * This decides whether a decision card renders its subtitle. It is a plain
 * containment check over words and never a paraphrase check: if every word of
 * the line beyond bare grammar already appears in the text rendered above it,
 * the line is a restatement and is dropped. One new word anywhere — an
 * escalation's reason, a bounce's "Packet malformed", a paused run's "Resume" —
 * and the whole line renders verbatim, as it always did.
 *
 * Nothing becomes unreachable this way. The suppressed words are, by the test's
 * own definition, still on the page a few pixels above.
 */
export function restatesWhatIsShown(line: string, shown: string): boolean {
  const vocabulary = new Set(words(shown))
  const carried = words(line).filter((w) => !GRAMMAR.has(w))
  return carried.length > 0 && carried.every((w) => vocabulary.has(w))
}

/**
 * A decision card's problems, minus the ones its description has already said
 * (#285/1).
 *
 * The malformed-state card carried the YAML parse error twice — once as
 * `detail`, once as its single `problem` — because core writes the same string
 * into both, and the card rendered both slots without ever comparing them.
 * Byte equality is the whole test: a bounced gate's problems name the missing
 * contract sections, which appear nowhere in its description, and every one of
 * them still renders.
 */
export function visibleProblems(item: InboxItem): string[] {
  return item.problems.filter((p) => p.trim() !== item.detail.trim())
}

/**
 * The instruction a card with no button has to give, for the description slot
 * (#285/6).
 *
 * Round-cap, bounce and in-flight are the three cards Gatehouse cannot offer a
 * control for — one needs a spec edit, one needs the artifacts fixed, and the
 * third (#159) needs only the wait — so the sentence saying what to do instead
 * *is* their affordance. In-flight is tested first, because it is a gate with
 * `reviewable: false` and would otherwise fall into the bounce row and be told
 * its packet was malformed. It used to render
 * where the buttons would have gone, at the card foot, right-aligned and small,
 * which is the treatment for a footnote. Every other kind returns null and is
 * unchanged: its instruction is a button.
 */
export function cardInstruction(item: InboxItem): { text: string; tone: string } | null {
  if (item.kind === 'round-cap') return { text: ROUND_CAP_INSTRUCTION, tone: 'text-ink' }
  if (gateCardState(item) === 'inflight') return { text: INFLIGHT_INSTRUCTION, tone: 'font-medium text-muted' }
  if (item.kind === 'gate' && !item.reviewable) return { text: BOUNCED_INSTRUCTION, tone: 'font-medium text-bad' }
  return null
}

/**
 * Whether a ledger row still needs its burden pill (#285/2).
 *
 * The row reads `G1 approved by operator [burden: light-correction]` — the
 * commit subject, verbatim — and then drew a `light-correction` pill eight
 * pixels to its right, which is the same fact from a second source rather than
 * a second fact. The pill earns its place only where the subject does not carry
 * the word: the v0 runs (wordfreq/mdtoc/dupefind) predate the bracketed grammar
 * entirely, and there the decisions endpoint reading `state.yaml` is the only
 * place the burden exists.
 */
export function burdenPillNeeded(detail: string, burden: string): boolean {
  return !detail.includes(burden)
}

/**
 * The highest review-round count across the run's tasks — or an em dash when
 * there are no tasks to have a highest of (#285/5).
 *
 * `maxRounds` is a `reduce` over the task list seeded at 0, so a run with no
 * plan yet reported the seed and the strip read "Max rounds 0", which is a
 * broken-looking value standing where a fact should be. Zero *with* tasks is a
 * true count — nothing has been reviewed yet — and stays printed, which is also
 * what the portfolio's column has always done with the same number.
 */
export function roundsLabel(tasks: RunSummary['tasks']): string {
  return tasks.total > 0 ? `${tasks.maxRounds}/${tasks.roundCap}` : '—'
}

export function RunPage() {
  const { src, slug } = useParams<{ src: string; slug: string }>()
  const [params, setParams] = useSearchParams()

  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['run', src, slug],
    queryFn: () => api.run(src!, slug!),
    enabled: Boolean(src && slug),
  })
  const lexicon = useRunLexicon(src, slug)

  // Which surface the URL asks for and which it gets. Pure, so it runs before
  // the loading guards below; until the run loads nothing is pending, which is
  // why the rewrite effect waits for `data` rather than acting on that.
  const pending = (data?.items.length ?? 0) > 0
  const route = resolveSurface({ tab: params.get('tab'), artifact: params.get('artifact') }, { pending })

  // A link that named a retired container tab still works, and leaves a
  // canonical URL behind: `?tab=artifacts` and `?tab=diff` are the record, and
  // a `?tab=decide` that has aged out is too. Replace, never push — a redirect
  // the reader never asked for should not cost them a back button press.
  useEffect(() => {
    if (!data || !route.rewrite) return
    const next = new URLSearchParams(window.location.search)
    next.set('tab', route.surface)
    if (route.selection === null) next.delete('artifact')
    else next.set('artifact', route.selection)
    setParams(next, { replace: true })
  }, [data, route.rewrite, route.surface, route.selection, setParams])

  // e cycles artifacts; esc returns to the inbox unless a decision is open.
  const keyHandlers = useMemo(
    () => ({
      e: () => {
        // The same order the picker is in, so `e` walks the list the reader is
        // looking at rather than the alphabet behind it (#285/4).
        const paths = orderArtifacts(data?.artifacts ?? [])
        if (!paths.length) return
        const current = new URLSearchParams(window.location.search).get('artifact')
        const idx = current ? paths.indexOf(current) : -1
        const nextPath = paths[(idx + 1) % paths.length]!
        const next = new URLSearchParams(window.location.search)
        next.set('tab', 'record')
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
  // creation-seam's `intake:` block (every run staged via `gateline new`/`gateline
  // arm` or this web surface), the header names who staged it, from what, and
  // when — the record explaining why the run exists. Runs that predate the
  // seam have no intake block, so readIntake returns null and the line is
  // simply omitted.
  const genesisIntake = detail.state ? readIntake(detail.state) : null
  const genesisCommit = detail.history.length > 0 ? detail.history[detail.history.length - 1] : null
  const genesisProvenance = genesisIntake ? [genesisIntake.source, genesisIntake.ref, genesisIntake.url].filter((v): v is string => Boolean(v)) : []

  const setSurface = (s: Surface) => {
    const next = new URLSearchParams(params)
    next.set('tab', s)
    if (s !== 'record') next.delete('artifact')
    setParams(next, { replace: true })
  }

  // One layout, with the Decide surface present or absent. The page used to
  // fork its whole shape on this flag — a two-column rail when something was
  // pending, one flowing column when nothing was — because it could not predict
  // what a state needs. Since #249 closed the gate and profile vocabulary it
  // can, so the prediction moved into the surface and the fork went away with
  // the duplicate vitals it required. Status content is still never boxed: card
  // chrome belongs to the decision cards alone.
  const busy = items.length > 0

  // The inbox already encodes what it is calling you to decide (`?decide=G2`,
  // `esc-<n>`, `paused`, `staged`); until #216 the run page dropped it on the
  // floor. When it names a card that is still pending, that card is the one
  // the keyboard loop drives and the one focus lands on. A stale or unknown
  // value resolves to -1 and everything below behaves exactly as before.
  const decideIndex = decideTargetIndex(params.get('decide'), items)
  const primaryIndex = decideIndex >= 0 ? decideIndex : items.findIndex((x) => x.reviewable)

  // The run page's half of the keyboard loop, advertised (#284). `e` is only
  // offered when there is something for it to cycle, and `esc` says where it
  // actually goes rather than the vaguer "back": from an idle run page it is
  // the inbox, and the only case where it means something else — closing an
  // open decision form — is the case in which no hint is on screen at all.
  const pageHints: KeyHint[] = [
    ...(detail.artifacts.length > 0 ? ([['e', 'next artifact']] as KeyHint[]) : []),
    ['esc', 'inbox'],
  ]
  // Whether a decision card is showing them for us. `DecidePanel` renders the
  // hints for the primary card so they can vanish with the card's idle mode;
  // that only happens on the Decide surface, and only when a card is primary.
  const primaryCardHints = route.surface === 'decide' && primaryIndex >= 0

  // A run at rest — paused, staged, or one whose phase names no position at all
  // — keeps its chip beside the spine, because "not moving" is not a position
  // in the sequence and must not be drawn as one.
  const atRest =
    summary.phase === 'paused' || summary.phase === 'closed' || !PROFILE_PHASES[summary.profile].includes(summary.phase as Phase)

  // The `needs you` eyebrow that used to open this header is gone (#294). It
  // predates the spine, and its own justification — stating what the spine
  // cannot — stopped being true when #254 landed a spine that draws the gate on
  // the table. Between that spine, the `Decide` tab count and the card's own
  // chip, the fact had four voices above the fold and the eyebrow was the one
  // carrying no other content.
  const header = (
    <header className="mb-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-[28px] font-semibold leading-[1.15] text-ink">{summary.slug}</h1>
        <p className="min-w-0 font-ui text-[12.5px] leading-[1.6] text-muted">
          {genesisIntake && genesisCommit && (
            <>
              staged by{' '}
              {genesisIntake.staged_by ? <span className="font-medium text-ink">{genesisIntake.staged_by}</span> : null}
              {genesisIntake.staged_by ? ' · ' : ''}
              {formatWhen(genesisCommit.time)}
              {genesisProvenance.length > 0 && <> · from {genesisProvenance.join(' · ')}</>}
              {' · '}
            </>
          )}
          <BranchRef refName={summary.ref} kind={summary.kind} url={detail.branchUrl} />
        </p>
        {/* A run at rest keeps its chip beside the spine rather than in it:
            "not moving" is not a position in the sequence. */}
        {atRest && (
          <span className="ml-auto">
            <PhaseChip phase={summary.phase} pausedReason={summary.pausedReason} closure={summary.closure} />
          </span>
        )}
      </div>
      <div className="mt-[18px] flex flex-col items-start gap-2.5">
        {/* No sequence on an unreadable record (#294). Every cell of the spine
            is derived from `state.yaml`; when it will not parse, the summary
            falls back to defaults and the spine draws a confident full-profile
            nine-cell run that has not started — which is a claim, not a
            reading. The `unknown` chip and the error block below say the true
            thing, so the spine stands down rather than contradict them. #254
            landed after the malformed-state treatment and never met it. */}
        {detail.stateError ? (
          <p data-spine-unknown className="font-ui text-[11.5px] text-muted">sequence unknown — state.yaml unreadable</p>
        ) : (
          // `items` is what switches on the bounced-gate tooltip (#285/9).
          // #295 built the prop and could not turn it on: whether a packet is
          // malformed lives on the inbox item's `reviewable` flag, never on
          // `RunSummary`, so the spine can only learn it from the call site —
          // and the call site is here.
          <PhaseSpine summary={summary} items={items} />
        )}
      </div>
    </header>
  )

  // The banner marks the state and shows the bytes; the parse error itself is
  // said once, by the card (#285/1). All three of `stateError`, the card's
  // `detail` and the card's single `problem` are the same string byte for byte,
  // and this page rendered all three — the reader met one parse error three
  // times before reaching the file it is about. Nothing is lost: the words are
  // in the card a few hundred pixels down, and the excerpt they refer to is
  // here — carrying the parse error as its hover text, so the diagnosis stays
  // one gesture away on the Record and History surfaces too, where the card is
  // a tab click rather than a scroll.
  const stateErrorBlock = detail.stateError ? (
    <div className="mb-6 border border-bad-line bg-bad-bg px-3.5 py-3">
      <p className="text-[13px] font-semibold text-bad">Malformed run state</p>
      {detail.stateRaw && (
        <pre
          title={detail.stateError}
          className="mt-2.5 overflow-x-auto bg-inset p-2.5 font-mono text-[11.5px] leading-[1.5] text-ink"
        >{detail.stateRaw}</pre>
      )}
    </div>
  ) : null

  const board = summary.tasks.total > 0 && detail.state ? <TaskBoard state={detail.state} roundCap={summary.tasks.roundCap} /> : null

  // The lexicon covers the whole page, not just the artifact reader: a
  // decision card that names AC2.1 should resolve it where it stands (#252).
  return (
    <LexiconProvider value={lexicon}>
      <div className="mx-auto max-w-5xl">
        <div className="border-b border-line pb-7">
          {header}
          {stateErrorBlock}
          {summary.phase === 'closed' && <ClosureRecordBlock source={src!} slug={slug!} closure={summary.closure} />}
          <RunMetadata summary={summary} board={board} />
        </div>

        <nav className="mt-6 mb-[18px] flex gap-0.5 border-b border-line" data-surfaces>
          {busy && (
            <SurfaceTab surface="decide" label="Decide" count={items.length} current={route.surface} onSelect={setSurface} />
          )}
          <SurfaceTab surface="record" label="Record" count={detail.artifacts.length} current={route.surface} onSelect={setSurface} />
          <SurfaceTab surface="history" label="History" count={detail.history.length} current={route.surface} onSelect={setSurface} />
        </nav>

        {route.surface === 'decide' && (
          <section className="flex flex-col gap-4 pb-7 border-b border-line">
            {items.map((item, i) => (
              <NeedsYouCard
                key={`${item.kind}-${item.gate ?? item.escalationIndex ?? i}`}
                item={item}
                now={now}
                detail={detail}
                primary={i === primaryIndex}
                sentHere={i === decideIndex}
                pageHints={pageHints}
              />
            ))}
          </section>
        )}
        {route.surface === 'record' && (
          <RecordSurface
            detail={detail}
            selected={route.selection}
            onSelect={(p) => {
              const next = new URLSearchParams(params)
              next.set('tab', 'record')
              next.set('artifact', p)
              next.delete('anchor')
              setParams(next, { replace: true })
            }}
          />
        )}
        {route.surface === 'history' && <HistoryTab history={detail.history} src={src!} slug={slug!} />}
        {/* The page's own keys, wherever the primary card is not already
            carrying them (#284) — a surface with no decision on it, or one
            whose cards are all bounced and drive no keyboard loop. Above the
            close-run affordance, because a hint belongs with what it is a hint
            about and not under the one destructive control on the page. */}
        {!primaryCardHints && <KeyHints hints={pageHints} className="mt-3.5 text-right" />}
        <CloseRunPanel source={src!} slug={slug!} phase={summary.phase} />
      </div>
    </LexiconProvider>
  )
}

/** One surface in the bar. Decide carries a count only because a run can have
 *  more than one thing on the table at once — a gate and an aged escalation. */
function SurfaceTab({
  surface,
  label,
  count,
  current,
  onSelect,
}: {
  surface: Surface
  label: string
  count: number
  current: Surface
  onSelect: (s: Surface) => void
}) {
  const active = current === surface
  return (
    <button
      type="button"
      onClick={() => onSelect(surface)}
      data-surface={surface}
      aria-current={active ? 'page' : undefined}
      className={`px-4 py-2.5 font-ui text-[13.5px] font-medium border-b-2 -mb-px ${
        active ? 'border-accent text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {label}
      <span className="ml-1.5 font-ui text-[11px] text-faint">{count}</span>
    </button>
  )
}

/**
 * The run's standing facts, in one form (#258), and only the ones nothing else
 * on the page already carries (#254).
 *
 * The Gates column used to live here because the header's ledger strip had gate
 * provenance in a tooltip and nowhere else. The spine carries approver and date
 * in the open, so the column went with it — leaving budget, rounds, divergence
 * and freshness, which the spine genuinely cannot say.
 *
 * The columns size themselves rather than being pinned at 300px each: the old
 * three fixed widths wrapped in the 800–1000px band and left the right half of
 * the viewport empty under a header that was already the tallest thing on the
 * page.
 *
 * Vitals is one strip rather than a stack of label/value rows (#294). Three
 * hairline rows spent ~110px of the band above the fold on about forty
 * characters of fact, and on the run that most needs the space — a gate on the
 * table — that band is the last thing between the reader and the evidence.
 * Every fact is still here, in the same words: only the row scaffolding went.
 * The task board keeps its rows; tasks are the one thing in this band with
 * depth, and their count is what should set the band's height.
 */
function RunMetadata({ summary, board }: { summary: RunSummary; board: React.ReactNode }) {
  const diverged = summary.aheadOfOrigin != null && summary.aheadOfOrigin > 0
  return (
    <div data-run-metadata className="flex flex-wrap items-start gap-x-10 gap-y-7 text-[13px]">
      {board && <div className="min-w-0 max-w-[420px] flex-1 basis-[230px]">{board}</div>}
      {/* No 420px cap on this one: a strip wants the width a column did not,
          and the facts fit on one line only if it may take what the board
          leaves. Below about 1000px it wraps to two, which is the same
          graceful thing the rest of this band does. */}
      <section className="min-w-0 flex-1 basis-[340px]">
        <div className="font-ui text-[11px] text-muted pb-1.5">Vitals</div>
        <div
          data-vitals
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line py-[7px] font-ui text-[12.5px] text-muted"
        >
          {/* The meter is built as a column — bar over words — for the row it
              used to sit in. In a text strip that hangs its words below the
              line, so it is laid on its side here. A presentational override at
              the call site: the shared component the inbox and portfolio also
              render is untouched, and if its markup ever changes this simply
              stops applying. */}
          <span className="inline-flex items-center gap-1.5 [&>span]:flex-row [&>span]:items-center [&>span]:gap-1.5">
            {/* A run with no budget recorded reads "no budget", which is a
                sentence, not a value — labelling it "Budget no budget" is the
                one thing the strip can say that the two-column row could not. */}
            {summary.budget.limit !== null && 'Budget'}
            <BudgetMeter limit={summary.budget.limit} spent={summary.budget.spent} />
          </span>
          <Sep />
          {/* The observation and the rule, in one register the reader can
              parse: the busiest task's round count, over the cap it is
              judged against. "Max rounds" called the observation a limit,
              beside a Budget that really is one (#314). */}
          <span title="highest review-round count any task has reached, over the cap">
            Rounds <span className="tabular-nums text-ink">{roundsLabel(summary.tasks)}</span>
          </span>
          {diverged && (
            <>
              <Sep />
              <span>
                Divergence{' '}
                <span className={`tabular-nums ${(summary.behindOrigin ?? 0) > 0 ? 'text-bad' : 'text-warn'}`}>
                  ↑{summary.aheadOfOrigin}{(summary.behindOrigin ?? 0) > 0 && <>↓{summary.behindOrigin}</>}
                </span>
              </span>
            </>
          )}
          <Sep />
          <span>
            Updated{' '}
            <span className="tabular-nums text-ink">
              {summary.updatedAt ? `${formatAge(summary.updatedAt, Date.now() / 1000)} ago` : '—'}
            </span>
          </span>
        </div>
      </section>
    </div>
  )
}

/** The strip's divider. Decorative, so it is hidden from the reading order —
 *  a screen reader hears the facts, not the punctuation between them. */
function Sep() {
  return (
    <span aria-hidden="true" className="text-faint">
      ·
    </span>
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
  pageHints,
}: {
  item: InboxItem
  now: number
  detail: RunDetailResponse
  primary?: boolean
  sentHere?: boolean
  pageHints?: readonly KeyHint[]
}) {
  const urgent = item.since !== null && now - item.since > 3 * 86_400
  const ageLabel = `waiting ${formatAge(item.since, now)}`
  // `item.detail` is written for an inbox row, where "<slug> is waiting on G2"
  // is what tells you which run you are looking at. Here the slug is the H1, the
  // gate is in the chip, "waiting" is in the badge on the same line, and the
  // question is the title — so the line is words the reader has already read.
  const restated = restatesWhatIsShown(item.detail, `${item.title} ${item.slug} ${ageLabel}`)
  // A malformed-state `detail` is a parser's diagnostic, not a sentence: a
  // message, a blank line, the offending source line, and a caret under the
  // column it failed at. Flowed as prose that caret wraps to wherever the
  // measure happens to break and points at nothing — the "dangling caret" of
  // #285/1. Mono and pre-wrap put it back under the character it names, and
  // the string is still rendered byte for byte.
  const diagnostic = item.detail.includes('\n')
  const problems = visibleProblems(item)
  const instruction = cardInstruction(item)
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
    chipPaths.length > 0
      ? chipPaths.map((p) => {
          const report = isReviewPath(p) ? reports?.find((r) => r.path === p) : undefined
          const verdicts = (report?.rounds ?? []).map((r) => r.verdict).filter((v): v is NonNullable<typeof v> => v !== null)
          const verdictArc =
            verdicts.length === 0 ? null : verdicts.length > 1 && verdicts[0] !== verdicts[verdicts.length - 1] ? `${verdicts[0]} → ${verdicts[verdicts.length - 1]}` : verdicts[verdicts.length - 1]
          return (
            <Link
              key={p}
              to={`/runs/${item.source}/${item.slug}?tab=record&artifact=${encodeURIComponent(p)}`}
              className="imp hover:bg-inset"
            >
              {p}
              {/* The verdict rides inside the same impression as the name, in
                  the name-plus-code grammar: a chip nested in a chip stood
                  4px taller than its neighbours (measured, 2026-09-04). */}
              {verdictArc && <span className="text-muted"> · {verdictArc}</span>}
            </Link>
          )
        })
      : null
  // Three chromes for three states (#159). An in-flight card is neither the
  // lifted accent of something to decide nor the red of something broken: it is
  // a card at rest, waiting on a machine, and its eyebrow says so rather than
  // claiming the human's attention for work that is already moving.
  const gateState = gateCardState(item)
  const inflight = gateState === 'inflight' ? item.inflight : null
  // Three impressions for three states (#159). Something to decide is the
  // filled mark; a card waiting on a machine is dotted, at rest; a bounced
  // packet is hatched. The card itself is not boxed: it is a posting on the
  // page, ruled above, with its evidence and its affordance below.
  // No overflow-hidden on the card: the lexicon hover card (#252) is
  // absolutely positioned and would be clipped by it.
  return (
    <section
      className="relative border-t border-ink pt-5 first:border-t-0 first:pt-1"
      data-needs-card
      data-card-state={gateState ?? undefined}
      data-sent-here={sentHere ? 'true' : undefined}
      ref={cardRef}
      tabIndex={-1}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap">
          {inflight ? (
            <Imp tone="dot">
              waiting on {inflight.role}
              {item.gate ? ` · ${item.gate}` : ''}
            </Imp>
          ) : gateState === 'bounced' ? (
            <Imp tone="hatch">bounced{item.gate ? ` · ${item.gate}` : ''}</Imp>
          ) : (
            <Imp tone="fill">needs you{item.gate ? ` · ${item.gate}` : ''}</Imp>
          )}
          {/* On a gate the KindChip says `● G2` eight pixels from a chip that
              already says `NEEDS YOU · G2` (#294) — two markers, one fact. Every
              other kind names something the chip beside it does not: escalation,
              round-cap, paused, malformed, staged. The chip itself is unchanged
              and still earns its place in the inbox, where rows carry no gate
              label of their own. */}
          {item.kind !== 'gate' && <KindChip item={item} />}
          <span className="ml-auto">
            <AgeBadge label={ageLabel} urgent={urgent} />
          </span>
        </div>
        <h2 className="mt-3 mb-1.5 text-[22px] font-semibold leading-[1.2] text-ink">
          <CitedText>{item.title}</CitedText>
        </h2>
        {!restated &&
          (diagnostic ? (
            <pre className="max-w-[var(--measure)] overflow-x-auto whitespace-pre-wrap font-mono text-[12.5px] leading-[1.55] text-ink">
              {item.detail}
            </pre>
          ) : (
            <p className="max-w-[var(--measure)] text-[14.5px] text-ink leading-[1.55]">
              <CitedText>{item.detail}</CitedText>
            </p>
          ))}
        {instruction && (
          <p data-card-instruction className={`mt-1.5 max-w-[var(--measure)] text-[14.5px] leading-[1.55] ${instruction.tone}`}>
            {instruction.text}
          </p>
        )}
        {mentionedTask && (
          <p className="mt-1.5 font-ui text-[12px] text-muted">
            {mentionedTask.id} · {mentionedTask.status} · review round {mentionedTask.review_rounds}/{detail.summary.tasks.roundCap}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {problems.map((p) => (
              <li key={p} className="font-mono text-[12px] text-bad">
                ✕ {p}
              </li>
            ))}
          </ul>
        )}
        {/* G2's packet, composed in criterion order (#256). The one-line
            citation map this replaced still renders on verification-report.md
            itself, where the report's own markdown is already on screen. */}
        {/* G1's packet (#255): coverage against the plan's own mapping table,
            and the surface overlaps no dependency orders. A patch run has no
            plan.md and no spec, so its G1 keeps the brief-plus-work-item view. */}
        {item.kind === 'gate' && item.gate === 'G1' && detail.summary.profile !== 'patch' && (
          <G1Packet src={item.source} slug={item.slug} />
        )}
        {item.kind === 'gate' && item.gate === 'G2' && (
          <G2Packet src={item.source} slug={item.slug} profile={detail.summary.profile} />
        )}
        {/* A round cap asks what did not converge, which is a question about two
            rounds at once (#257). The chip list below still offers every report;
            this is the comparison the chips could not be. */}
        {item.kind === 'round-cap' && <RoundCapPanel src={item.source} slug={item.slug} task={mentionedTask?.id ?? null} />}
        <DecidePanel
          item={item}
          profile={detail.summary.profile}
          primary={primary}
          sentHere={sentHere}
          chips={chips}
          pageHints={pageHints}
        />
      </div>
    </section>
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

/** The task board shares the status grammar — mono label, hairline rows —
 * and, like all status content, is never boxed. */
function TaskBoard({ state, roundCap }: { state: NonNullable<RunDetailResponse['state']>; roundCap: number }) {
  const doneCount = state.tasks.filter((t) => t.status === 'done').length
  return (
    <section className="text-[13px]">
      <div className="font-ui text-[11px] text-muted pb-1.5">
        Task board · {doneCount} / {state.tasks.length} done
      </div>
      {state.tasks.map((t) => {
        const capped = t.review_rounds >= roundCap
        const tone = capped ? 'mark' : t.status === 'done' ? 'fill' : t.status === 'pending' ? 'dot' : ''
        return (
          <div key={t.id} className="flex items-center justify-between gap-3 py-[7px] border-t border-line">
            <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-ink">{t.id}</span>
            <span className="flex shrink-0 items-center gap-1.5">
              {t.review_rounds > 0 && (
                <span className={`font-ui text-[11.5px] tabular-nums ${capped ? 'font-semibold text-warn' : 'text-muted'}`} title="review rounds">
                  ⟲{t.review_rounds}
                </span>
              )}
              <Imp tone={tone}>
                {t.status === 'done' ? '✓ ' : ''}
                {t.status}
              </Imp>
            </span>
          </div>
        )
      })}
    </section>
  )
}

/**
 * Record — the run's committed output, and the answer to "show me the bytes"
 * (#258). The escape hatch and the fork fallback: whatever a structured surface
 * withholds itself over, the artifact it was reading is here in full.
 *
 * The change reads here too, as an entry below the artifacts rather than the
 * sibling `Diff` tab it used to be. It is not an artifact — nothing under
 * `runs/<slug>/` produced it — so it sits under its own heading, and it earns
 * its place in Gatehouse only as the surface-scoped view #270 built
 * (FRONTEND.md principle 7). `?tab=diff` links land here.
 */
function RecordSurface({
  detail,
  selected,
  onSelect,
}: {
  detail: RunDetailResponse
  selected: string | null
  onSelect: (path: string) => void
}) {
  const paths = orderArtifacts(detail.artifacts)
  const showDiff = selected === DIFF_SELECTION
  // An explicit selection always wins; otherwise the pending gate's own packet
  // decides what opens (#250), and only then does filename order get a say.
  const current =
    (showDiff ? null : selected) ??
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
    <div className="grid grid-cols-[280px_1fr] gap-0 max-lg:flex max-lg:flex-col border-b border-line">
      <nav className="border-r border-line bg-surface py-[18px] max-lg:w-full max-lg:border-r-0 max-lg:border-b max-lg:py-2.5">
        <div className={`${NAV_LABEL} max-lg:px-3 max-lg:pb-1`}>Artifacts · runs/{detail.summary.slug}/</div>
        <div className="max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-1 max-lg:px-3">
          <ul className="flex flex-col max-lg:contents">
            {paths.map((p) => {
              const v = detail.validations[p]
              return (
                <li key={p} className="max-lg:min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelect(p)}
                    data-artifact-entry={p}
                    data-selected={!showDiff && p === current ? 'true' : undefined}
                    className={navEntryClass(!showDiff && p === current)}
                  >
                    {v && <ValidationBadge ok={v.ok} missing={v.missing} />}
                    <span className="truncate">{p}</span>
                    {verdictsFor(p) && <span className="ml-auto max-lg:ml-1">{verdictsFor(p)}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-3.5 border-t border-line pt-3.5 max-lg:mt-0 max-lg:flex max-lg:items-center max-lg:border-t-0 max-lg:pt-0">
            <div className={`${NAV_LABEL} max-lg:px-2 max-lg:pb-0 max-lg:py-1.5 max-lg:shrink-0`}>The change</div>
            <button type="button" onClick={() => onSelect(DIFF_SELECTION)} data-select-diff className={navEntryClass(showDiff)}>
              <span className="truncate">diff by surface</span>
            </button>
          </div>
        </div>
        {!showDiff && current && detail.validations[current] && !detail.validations[current].ok && (
          <div className="mx-[18px] mt-3.5 border border-bad-line bg-bad-bg px-3 py-2.5 text-[12px] text-bad max-lg:mt-2.5">
            Fails its {detail.validations[current].contract} contract — missing: {detail.validations[current].missing.join(', ')}
          </div>
        )}
      </nav>
      <ReaderPane artifact={showDiff ? DIFF_SELECTION : current}>
        {showDiff ? (
          <DiffPane src={detail.summary.source} slug={detail.summary.slug} />
        ) : current ? (
          <ArtifactBody src={detail.summary.source} slug={detail.summary.slug} path={current} />
        ) : (
          <PageStatus text="No artifacts yet." />
        )}
      </ReaderPane>
    </div>
  )
}

/** The picker's two section labels. Full-width rail below, an inline caption in
 *  the strip above the reader. */
const NAV_LABEL = 'font-ui text-[10.5px] text-muted px-[18px] pb-2.5'

/**
 * One picker entry, in both of the picker's shapes — and the artifact entries
 * and the diff entry share it, so the two can no longer drift apart. Below `lg`
 * the rail becomes a wrapping strip, so the selected mark moves from the left
 * edge to the bottom edge: a left rule reads as a rail only when the entries are
 * stacked. Only the mark and the tint depend on `active`; the shape never does.
 */
export const RECORD_ENTRY_SHAPE =
  'flex w-full items-center gap-2.5 px-[18px] py-2.5 text-left font-mono text-[12.5px] border-l-2 ' +
  'max-lg:w-auto max-lg:max-w-full max-lg:border-l-0 max-lg:border-b-2 max-lg:px-2 max-lg:py-1.5'

export function navEntryClass(active: boolean) {
  return active
    ? `${RECORD_ENTRY_SHAPE} bg-accent-tint border-l-accent border-b-accent text-accent-deep font-semibold`
    : `${RECORD_ENTRY_SHAPE} border-l-transparent border-b-transparent text-ink hover:bg-inset hover:text-ink`
}

/**
 * The reader's own scroll container (#281). Whatever an artifact turns out to
 * contain — a results table wider than the measure, a long command in a code
 * block, a lexicon card hanging off the right of the reference it belongs to —
 * stops here instead of widening the page body. Containment is the point: a page
 * that scrolls sideways drags the header and the picker along with it, and below
 * `lg` the reader is the column that keeps its width — the picker is the one
 * that gives width up.
 *
 * The scroll cue (#312) follows the portfolio table's (#297): a fade on
 * whichever edge has content beyond it, measured live, drawn above the
 * content so the reader's own tinted blocks cannot paint over it. It was
 * deferred when this pane was written, and rightly then: the idle lexicon
 * card was `visibility: hidden` but still laid out, so the pane reported
 * 12px of phantom overflow at 1024px with nothing to scroll to, and a cue
 * off `scrollWidth` would have lied. #308 made the idle card `display: none`;
 * the reader's idle `scrollWidth` now equals its `clientWidth`, and any
 * overflow it reports is real content. The `idle-card-collapsed` rule in the
 * geometry sweep is what keeps that true.
 */
function ReaderPane({ children, artifact }: { children: ReactNode; artifact?: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const cue = useScrollCue(ref, [artifact])
  // `min-w-0` on the wrapper too: the reader is the column that yields width
  // below `lg`, and a wrapper without it would hold the column at its
  // content's width — the overflow then reaches the page body instead of
  // stopping here (the geometry sweep caught exactly that on state.yaml).
  return (
    <div className="relative min-w-0">
      <div ref={ref} data-reader className="min-w-0 overflow-x-auto">
        {children}
      </div>
      {cue.left && <EdgeFade edge="left" />}
      {cue.right && <EdgeFade edge="right" />}
    </div>
  )
}

/**
 * The contract's name in the reader's badge — and nothing when the badge would
 * only be echoing the filename beside it (#285/3).
 *
 * "runs/g2-pending/verification-report.md ✓ passes verification-report.md
 * contract" says one filename twice in one strip, and the second one is what
 * pushed the badge onto its own line in the narrow band. The path is already
 * naming the file, which is the reviewer's argument, and it applies exactly
 * where the two strings are the same string — `review-01.md` is checked against
 * `review-report.md`, and naming that is the badge telling the reader something
 * the path did not. Either way the full sentence is in the badge's hover text.
 *
 * A `null` contract — `retro.md` and anything else the framework checks for
 * presence only — has no name to print, and printing it left a double space
 * mid-sentence.
 */
export function contractBadgeName(path: string, contract: string | null): string {
  if (contract === null || contract === path.split('/').pop()) return ''
  return `${contract} `
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
    if (!anchor || !data) return
    const target = document.getElementById(anchor)
    // A definition inside a folded audit-time section (#217) opens its fold
    // before the jump, so a citation never lands on a closed heading.
    const fold = target?.closest('details')
    if (fold && !fold.open) fold.open = true
    target?.scrollIntoView({ block: 'start' })
  }, [anchor, data])
  if (isLoading) return <LoadingSkeleton text="Reading artifact…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  const { content, validation } = data!
  return (
    <article className="relative min-h-0 px-10 py-8 max-lg:px-4 max-lg:py-6">
      <div className="max-w-[var(--measure)]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[11.5px] text-muted pb-[18px] border-b border-line mb-[30px]">
          <span className="text-ink">runs/{slug}/{path}</span>
          <span
            className="ml-auto max-lg:ml-0 font-semibold"
            title={validation.contract ? `${validation.ok ? 'passes' : 'fails'} the ${validation.contract} contract` : undefined}
          >
            <span className={validation.ok ? 'text-ok' : 'text-bad'}>
              <span className="mr-1">{validation.ok ? '✓' : '✕'}</span>
              {validation.ok ? 'passes' : 'fails'} {contractBadgeName(path, validation.contract)}contract
            </span>
          </span>
        </div>
        {!validation.ok && (
          <p className="mb-4 border border-bad-line bg-bad-bg px-3 py-2 text-xs font-medium text-bad">
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
          <FoldedMarkdown content={content} path={path} audit={validation.audit ?? []} />
        ) : (
          <pre className="overflow-x-auto font-mono text-xs leading-5">{content}</pre>
        )}
      </div>
    </article>
  )
}

/**
 * The artifact, with its audit-time sections folded (#217). The contract
 * names them (`validation.audit`); each folds to its heading plus a count —
 * rows, items, or paragraphs, arithmetic over the text — and opens in place
 * to the verbatim section. Decide-time sections render as they always did.
 * A contract that names no audit-time section renders the artifact whole,
 * through the same single `Markdown` call as before: the split exists only
 * when there is something to fold.
 */
function FoldedMarkdown({ content, path, audit }: { content: string; path: string; audit: string[] }) {
  if (audit.length === 0) return <Markdown sourcePath={path}>{content}</Markdown>
  // One `.prose-artifact` wrapper for the whole artifact, however many
  // renders it takes: the styles are descendant rules, and the DOM keeps
  // reading as one artifact.
  return (
    <div className="prose-artifact">
      {splitSections(content).map((section, i) => {
        // Only an H2 can be audit-time: an H1 — a review's appended round —
        // opens its own section, so its verdict never hides under a fold.
        if (section.heading === null || section.depth !== 2 || !isAuditSection(section.heading, audit)) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: sections split from one static artifact body in document order; a heading can be null (the preamble) or repeat (review rounds).
            <Markdown key={i} sourcePath={path} unwrapped>
              {section.headingLine ? `${section.headingLine}\n${section.body}` : section.body}
            </Markdown>
          )
        }
        const count = itemCount(section.body)
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: see the case above — same static, document-order split.
          <details key={i} data-fold={section.heading} className="group mb-[18px]">
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 list-none [&::-webkit-details-marker]:hidden">
              {/* The heading's accessible name stays the heading; the glyph
                  and the count sit beside it, not inside it. */}
              <span aria-hidden="true" className="inline-block text-[0.7em] text-muted group-open:rotate-90">▶</span>
              <h2 className="!my-0">{section.heading}</h2>
              <span className="font-sans text-[13px] text-muted">
                {count.n} {count.unit} · audit-time, folded until opened
              </span>
            </summary>
            <Markdown sourcePath={path} unwrapped>
              {section.body}
            </Markdown>
          </details>
        )
      })}
    </div>
  )
}

function DiffPane({ src, slug }: { src: string; slug: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['diff', src, slug], queryFn: () => api.diff(src, slug) })
  if (isLoading) return <LoadingSkeleton text="Computing diff…" />
  if (error) return <PageStatus text={(error as Error).message} bad />
  if (data!.merged) return <PageStatus text="Run is merged — its change lives in the default branch history now." />
  return (
    <div className="px-[18px] py-[18px]">
      <DiffView files={data!.files} surface={data!.surface} />
    </div>
  )
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
const DECISION_KINDS = new Set(['gate-approved', 'gate-declined', 'escalation-resolved', 'paused', 'resumed', 'armed', 'staged', 'closed', 'reopened'])

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

  const rows = useMemo(() => collapseEngineSpans(history), [history])
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())

  if (history.length === 0) return <PageStatus text="No state history at this ref." />

  const renderRow = (i: number) => {
    const h = history[i]!
    const transition = Boolean(h.phase && i < history.length - 1 && history[i + 1]!.phase !== h.phase)
    const e = h.ledger
    const decided = DECISION_KINDS.has(e.kind)
    const extra = e.gate ? burdenByGate.get(e.gate) : undefined
    return (
      <li
        key={h.oid}
        data-ledger-actor={e.actor}
        data-ledger-kind={e.kind}
        className={`relative flex items-baseline gap-3 border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:border before:content-[''] ${
          transition
            ? 'before:border-ink before:bg-ink'
            : decided
              ? 'before:border-ink before:bg-ground'
              : 'before:border-dotted before:border-muted before:bg-ground'
        }`}
      >
        <span className="w-32 shrink-0 font-ui text-[11.5px] tabular-nums text-muted">{formatWhen(h.time)}</span>
        {/* A human's own decision is stamped onto the ledger — the one mark
            on this page that was pressed rather than printed. The words
            beside it are still the commit subject, verbatim. */}
        {decided && e.actor === 'human' && (
          <Imp tone="fill stamped" className="shrink-0">
            {e.gate ? `${e.gate} ${e.kind.replace('gate-', '')}` : e.kind.replace(/-/g, ' ')}
          </Imp>
        )}
        <span className={`min-w-0 flex-1 truncate text-[13px] ${LEDGER_TONE[e.actor] ?? ''}`} title={h.subject}>
          {e.detail}
        </span>
        {/* Burden and notes come from the decisions endpoint, quoted,
            never scored — and the pill is dropped when the commit
            subject beside it already says the same word (#285/2). The
            modern grammar writes `G1 approved by operator [burden:
            light-correction]`, so on those rows the pill was the fact
            restated eight pixels to its right. It still earns its place
            on the v0 runs, whose subjects predate the bracketed form and
            where the endpoint reading `state.yaml` is the only source. */}
        {extra?.burden && burdenPillNeeded(e.detail, extra.burden) && (
          <span className="shrink-0 border border-line px-1.5 py-px font-mono text-[10.5px] text-muted">{extra.burden}</span>
        )}
        {e.actor === 'orchestrator' && (
          <span className="shrink-0 font-ui text-[10.5px] text-faint" title="committed under the orchestrator's bot identity">
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
  }


  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setRaw((v) => !v)}
          className="font-ui text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          aria-pressed={raw}
        >
          {raw ? 'hide raw commits' : 'show raw commits'}
        </button>
      </div>
      <ol
        data-ledger
        className="relative ml-1.5 flex flex-col before:absolute before:bottom-1.5 before:left-1.5 before:top-1.5 before:w-0.5 before:bg-line before:content-['']"
      >
        {rows.map((r) => {
          if (r.kind === 'row') return renderRow(r.index)
          const expanded = open.has(r.from)
          return (
            <Fragment key={`span-${r.from}`}>
              {/* One review round or more of engine rows, folded (#283): the
                  ledger reads as the decision sequence by default, and the
                  engine's work between two decisions is summarized from its
                  own rows — counts and the metered figures they carry, nothing
                  more — until it is opened. Every row stays reachable. */}
              <li
                data-ledger-span={r.count}
                data-ledger-span-open={expanded ? 'true' : undefined}
                className="relative flex items-baseline gap-3 border-b border-line py-2.5 pl-7 text-sm last:border-b-0 before:absolute before:left-0.5 before:top-[15px] before:h-2.5 before:w-2.5 before:border before:border-dotted before:border-muted before:bg-ground before:content-['']"
              >
                <span className="w-32 shrink-0 font-ui text-[11.5px] tabular-nums text-muted">{formatWhen(history[r.from]!.time)}</span>
                <button
                  type="button"
                  onClick={() => setOpen((prev) => {
                    const next = new Set(prev)
                    if (next.has(r.from)) next.delete(r.from)
                    else next.add(r.from)
                    return next
                  })}
                  aria-expanded={expanded}
                  className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
                  title={expanded ? 'fold these rows' : 'show every row'}
                >
                  engine · {r.count} actions ·{' '}
                  {r.verbs.map(([verb, n]) => `${n} ${verb}${verb === 'metered' && r.meteredUsd !== null ? ` ($${r.meteredUsd.toFixed(2)})` : ''}`).join(' · ')}
                </button>
                {r.entered.map((phase, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a bounce cycle can revisit the same phase, so the name isn't unique; this is a fixed sequence from committed history.
                  <span key={k} className="shrink-0 font-mono text-[11px] text-accent-deep">→ {phase}</span>
                ))}
              </li>
              {expanded && Array.from({ length: r.count }, (_, k) => renderRow(r.from + k))}
            </Fragment>
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
