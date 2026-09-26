// The run header (title, genesis line, phase spine), the vitals strip, the
// task board, the surface tab bar, and the loading skeleton shared by the
// run/artifact/diff reads. Split out of pages/run.tsx (#413) as a pure
// move — no behaviour, markup, or string changed; pages/run.tsx re-exports
// every symbol below so no import path a test already uses had to change.
//
// This is also where the record layer's `readIntake` moved to: it is used
// only by the genesis line inside `RunHeader`, so the value import moved with
// its one caller (see the RECORD_VALUE_IMPORTERS comment in boundary.test.ts).
import { readIntake } from '@gateline/core/record'
import { formatAge, formatWhen, type Phase, PROFILE_PHASES, type RunDetailResponse, type RunSummary } from '../../api.ts'
import { BudgetMeter, Imp, PhaseChip, PhaseSpine } from '../../components/chips.tsx'
import type { Surface } from '../../landing.ts'
import { PageStatus } from '../inbox.tsx'

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
export function RunMetadata({ summary, board }: { summary: RunSummary; board: React.ReactNode }) {
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
export function BranchRef({ refName, kind, url }: { refName: string; kind: RunSummary['kind']; url: string | null }) {
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
export function TaskBoard({ state, roundCap }: { state: NonNullable<RunDetailResponse['state']>; roundCap: number }) {
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

/** One surface in the bar. Decide carries a count only because a run can have
 *  more than one thing on the table at once — a gate and an aged escalation. */
export function SurfaceTab({
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

// genesis-preview candidate (state.yaml gates.G1.notes): the run header's
// genesis line is display-only, rendered from data already in the run detail
// payload — readIntake reads the passthrough `intake:` block already on
// detail.state, and the genesis commit is the oldest entry already in
// detail.history. No new server data (ADR-6 rider, ADR-7).

// The `needs you` eyebrow that used to open this header is gone (#294). It
// predates the spine, and its own justification — stating what the spine
// cannot — stopped being true when #254 landed a spine that draws the gate on
// the table. Between that spine, the `Decide` tab count and the card's own
// chip, the fact had four voices above the fold and the eyebrow was the one
// carrying no other content.
export function RunHeader({ summary, detail }: { summary: RunSummary; detail: RunDetailResponse }) {
  // The genesis line (genesis-preview candidate): whenever a run carries the
  // creation-seam's `intake:` block (every run staged via `gateline new`/`gateline
  // arm` or this web surface), the header names who staged it, from what, and
  // when — the record explaining why the run exists. Runs that predate the
  // seam have no intake block, so readIntake returns null and the line is
  // simply omitted.
  const genesisIntake = detail.state ? readIntake(detail.state) : null
  const genesisCommit = detail.history.length > 0 ? detail.history[detail.history.length - 1] : null
  const genesisProvenance = genesisIntake ? [genesisIntake.source, genesisIntake.ref, genesisIntake.url].filter((v): v is string => Boolean(v)) : []

  // A run at rest — paused, staged, or one whose phase names no position at all
  // — keeps its chip beside the spine, because "not moving" is not a position
  // in the sequence and must not be drawn as one.
  const atRest =
    summary.phase === 'paused' || summary.phase === 'closed' || !PROFILE_PHASES[summary.profile].includes(summary.phase as Phase)

  return (
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
          <PhaseSpine summary={summary} items={detail.items} />
        )}
      </div>
    </header>
  )
}

/** Loading treatment shared by the run/artifact/diff reads: a few .skel
 * sweep lines above the preserved PageStatus text (per the mockups' "Loading
 * · signal sweep" states). */
export function LoadingSkeleton({ text }: { text: string }) {
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
