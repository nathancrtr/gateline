// Review findings as structured cards (#215), over the typed parse from #214.
//
// Design rule, normative here: a view may reorder, group, fold, badge, and
// diff — but every word shown is verbatim from the committed artifact, and
// every word in the record stays reachable. The report's own markdown renders
// below this panel untouched, so folding is never truncation. Deterministic
// derivation only; no summarization.
//
// Severity ordering quotes the report's own severity cell — it does not judge
// the finding. Nothing here computes a score, a count-based verdict, or a
// pass/fail rollup, matching the line evidence.tsx draws for G2.
//
// This is also the module the three decide-packet surfaces (evidence.tsx,
// g1.tsx, rounds.tsx) share: `FindingCard` is the row all three render, and
// `Inline` and `PacketSweep` are the two pieces of quoting chrome all three
// need. Chrome that only one surface uses stays in that surface's own file.

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { api, type ReviewFinding, type ReviewReport, type Severity, type Verdict } from '../api.ts'
import { CitedText } from './lexicon.tsx'

const SEVERITY_RANK: Record<Severity, number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

// ---------------------------------------------------------------------------
// Quoting chrome shared by the packet surfaces.

/**
 * Inline markdown inside a quoted line (#282).
 *
 * A quoted slice of an artifact arrives as markdown, so `**…**` and `` `…` ``
 * are syntax rather than words. Dropping the slice into a text node printed
 * the marks themselves — a finding's disposition read `- **F2 — stands (round
 * 2):** …`, asterisks and all — which is the packet disagreeing with the
 * Record reader about the same bytes. Verbatim is still the rule: every word
 * survives byte-identical, and only the marks around them stop being content.
 *
 * Two marks, because two are what the contracts' grammar actually uses. Text
 * outside them still runs through the lexicon, so a finding that cites AC2.1
 * resolves it where it stands.
 */
export function Inline({ children }: { children: string }) {
  const re = /\*\*([^*]+?)\*\*|`([^`]+?)`/g
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of children.matchAll(re)) {
    if (m.index > last) parts.push(<CitedText key={key++}>{children.slice(last, m.index)}</CitedText>)
    parts.push(
      m[1] !== undefined ? (
        <strong key={key++} className="font-semibold text-ink">
          <CitedText>{m[1]}</CitedText>
        </strong>
      ) : (
        <code key={key++} className="bg-inset px-1 font-mono text-[11px] text-ink">
          {m[2]}
        </code>
      ),
    )
    last = m.index + m[0].length
  }
  if (parts.length === 0) return <CitedText>{children}</CitedText>
  if (last < children.length) parts.push(<CitedText key={key++}>{children.slice(last)}</CitedText>)
  return <>{parts}</>
}

/** A disposition is quoted out of a markdown list, so it arrives carrying its
 *  bullet. The bullet is the list's syntax, not the reviewer's word. */
export const unbulleted = (text: string) => text.replace(/^\s*[-*]\s+/, '')

/** The same line where markup cannot go — a `title` attribute holds text and
 *  nothing else, so the marks come off there rather than being shown raw. */
export const plainQuote = (text: string) =>
  unbulleted(text).replace(/\*\*([^*]+?)\*\*|`([^`]+?)`/g, (_m, bold?: string, code?: string) => bold ?? code ?? '')

/** The frame every decide packet draws itself in, and the label it hangs on
 *  the frame. Shared so the pending state and the loaded state of one packet
 *  cannot drift apart — the whole point of #299 is that they are one card. */
export const PACKET_FRAME = 'mt-3.5 border border-line bg-inset px-3 py-2.5'
export const PACKET_LABEL = 'font-ui text-[11px] text-muted'

/**
 * The in-flight body of a decide packet (#299).
 *
 * Every packet used to render nothing until its query resolved, so a gate card
 * painted in a shape byte-identical to the legitimately packet-less G0 and G3
 * cards and then shifted when the evidence arrived. The packet was the only
 * part of the card with no loading representation — artifact reads already had
 * one — and it is the card's reason to exist. Sweep lines inside the frame say
 * "not here yet"; no frame at all says "there is none". Those are different
 * facts and the operator is entitled to both.
 *
 * Approve/Decline stay enabled behind this: the point is honesty about pending
 * content, not gating the human.
 *
 * The frame carries `aria-busy` and these lines are hidden from the tree — a
 * sweep is a visual placeholder with nothing to read. Deliberately not a
 * `role="status"` region: this renders inside the decide card, which already
 * has one for the commit result, and a second would make "the card's status"
 * ambiguous to a screen reader and to anything else asking for it.
 */
export function PacketSweep() {
  return (
    <div className="mt-2 flex flex-col gap-2" data-packet-pending aria-hidden="true">
      <span className="skel block h-3.5 w-[70%]" />
      <span className="skel block h-3.5 w-[90%]" />
      <span className="skel block h-3.5 w-[60%]" />
    </div>
  )
}

const SEVERITY_TONE: Record<Severity, string> = {
  blocking: 'border-bad-line bg-bad-bg text-bad',
  major: 'border-warn-line bg-warn-bg text-warn',
  minor: 'border-line bg-inset text-muted',
  unknown: 'border-line bg-inset text-faint',
}

const VERDICT_TONE: Record<Verdict, string> = {
  approve: 'border-ok-line bg-ok-bg text-ok',
  'request-changes': 'border-warn-line bg-warn-bg text-warn',
  escalate: 'border-info-line bg-info-bg text-info',
}

/**
 * One report's verdict. By default it shows the arc across rounds — a report
 * that went request-changes → approve says something a single token cannot.
 * `compact` shows only the verdict in force, for the artifact list where the
 * filename must keep its width.
 */
export function VerdictChip({ verdicts, compact = false }: { verdicts: (Verdict | null)[]; compact?: boolean }) {
  const shown = verdicts.filter((v): v is Verdict => v !== null)
  if (shown.length === 0) return null
  const last = shown[shown.length - 1]!
  const arc = shown.length > 1 && !compact
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${VERDICT_TONE[last]}`}
      title={shown.length > 1 ? `rounds: ${shown.join(' → ')}` : `verdict: ${last}`}
    >
      {arc ? `${shown[0]} → ${last}` : last}
      {compact && shown.length > 1 && <span className="ml-1 opacity-60">·{shown.length}</span>}
    </span>
  )
}

function SeverityChip({ finding }: { finding: ReviewFinding }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${SEVERITY_TONE[finding.severity]}`}
      title={finding.severityText || finding.severity}
    >
      {finding.severityText || finding.severity}
    </span>
  )
}

/**
 * One finding, verbatim. Exported because G2's packet surface (#256) and the
 * round-cap comparison (#257) render the same card — under the criterion it
 * cites, and under what the last two rounds did about it. The finding is the
 * same object in all three places and must not grow a second rendering.
 *
 * `note` and `extra` are slots, not variants: a caller adds what its own
 * surface knows (which rounds raised this; a disposition written in another
 * file) without this card learning about that surface.
 */
export function FindingCard({
  finding,
  source,
  note,
  extra,
  defaultOpen,
}: {
  finding: ReviewFinding
  source?: string
  note?: ReactNode
  extra?: ReactNode
  /** Overrides the default fold, for a caller that knows something the finding
   *  does not — a disposition written in a different file (#257). */
  defaultOpen?: boolean
}) {
  const resolved = finding.resolution?.state === 'resolved'
  const [open, setOpen] = useState(defaultOpen ?? !resolved)
  // Collapsible whenever there is a fold to undo: its own disposition, or a
  // caller that folded it.
  const collapsible = finding.resolution !== null || defaultOpen === false
  return (
    <li className={`border px-3 py-2 ${resolved ? 'border-line bg-surface' : 'border-line bg-inset'}`} data-finding={finding.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`shrink-0 font-mono text-[11.5px] font-semibold ${resolved ? 'text-faint' : 'text-ink'}`}>{finding.id}</span>
        <SeverityChip finding={finding} />
        {/* Named only where the card leaves its own report — under a criterion,
            "which review raised this" is not otherwise on screen. */}
        {source && <span className="shrink-0 font-mono text-[10.5px] text-faint">{source}</span>}
        {finding.round !== null && <span className="shrink-0 font-ui text-[10.5px] text-faint">round {finding.round}</span>}
        {note}
        {/* The words, and the control that folds them, travel together (#296).
            Everything above is `shrink-0`, so while the title was a bare
            `min-w-0 flex-1` item it was the only thing the row could squeeze:
            as the metadata grew (round-cap adds a note pill and a rounds list)
            the title kept its place on the line and collapsed into a sliver,
            rendering one word per line beside empty row space. `flex-wrap`
            never rescued it, because an item that can shrink to zero always
            "fits" — the wrap the row already had could not fire for it.
            The fix is a floor. A min-width raises this group's hypothetical
            main size, which is what flexbox breaks lines on, so once 24ch no
            longer fits the group drops to its own line — with the disposition
            button, which is why the two are one item and not two. The
            `min(…,100%)` guard keeps the floor from overflowing a container
            narrower than the floor itself. */}
        <span className="flex min-w-[min(24ch,100%)] flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className={`min-w-[min(24ch,100%)] flex-1 text-[12.5px] ${resolved ? 'text-muted line-through decoration-faint' : 'text-ink'}`}
            data-finding-title
          >
            {finding.title}
          </span>
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`shrink-0 border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${
                finding.resolution === null
                  ? 'border-line bg-surface text-muted'
                  : resolved
                    ? 'border-ok-line bg-ok-bg text-ok'
                    : 'border-warn-line bg-warn-bg text-warn'
              }`}
              title={finding.resolution ? plainQuote(finding.resolution.text) : undefined}
            >
              {finding.resolution === null
                ? 'details'
                : `${finding.resolution.state}${finding.resolution.round !== null ? ` (round ${finding.resolution.round})` : ''}`}
              {open ? ' ▾' : ' ▸'}
            </button>
          )}
        </span>
      </div>
      {open && (
        <dl className="mt-1.5 flex flex-col gap-1 text-[12px] leading-[1.5]">
          {finding.where && <Field label="Where">{finding.where}</Field>}
          {finding.failureScenario && <Field label="Failure scenario">{finding.failureScenario}</Field>}
          {finding.requirement && <Field label="Requirement">{finding.requirement}</Field>}
          {/* The disposition is a list item in the report — `- **F2 — stands
              (round 2):** …` — so it arrives with its bullet and its bold run
              intact (#282). Both are markup; the words after them are not. */}
          {finding.resolution && (
            <Field label={`Round ${finding.resolution.round ?? '?'}`}>{unbulleted(finding.resolution.text)}</Field>
          )}
          {extra}
        </dl>
      )}
    </li>
  )
}

/** Field values run through the lexicon (#252): a finding that cites R2/AC2.1
 *  resolves it where it stands, which is the whole point at a round cap — the
 *  requirement is where the suspected ambiguity lives. They are quoted out of
 *  markdown, so they run through `Inline` on the way (#282) — a Where cell is
 *  usually a path in backticks, and backticks are not part of the path. */
function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="shrink-0 font-ui text-[10.5px] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-muted">
        <Inline>{children}</Inline>
      </dd>
    </div>
  )
}

/** Blocking first, then by id — the order the contract already ranks them in. */
function ranked(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(a.id.slice(1)) - Number(b.id.slice(1)),
  )
}

/** The typed reports, with the read's own in-flight state. A packet has to tell
 *  "no reports yet" from "no reports at all" (#299); every other caller only
 *  ever wanted the reports, and keeps `useReviews`. */
export function useReviewsQuery(src: string, slug: string): { reports: ReviewReport[] | undefined; pending: boolean } {
  const { data, isPending } = useQuery({ queryKey: ['reviews', src, slug], queryFn: () => api.reviews(src, slug) })
  return { reports: data?.reports, pending: isPending }
}

export function useReviews(src: string, slug: string): ReviewReport[] | undefined {
  return useReviewsQuery(src, slug).reports
}

/** The findings panel above a review artifact's own markdown. */
export function FindingsPanel({ src, slug, path }: { src: string; slug: string; path: string }) {
  const reports = useReviews(src, slug)
  const report = reports?.find((r) => r.path === path)
  if (!report) return null
  const standing = report.findings.filter((f) => f.resolution?.state !== 'resolved')
  return (
    <section className="mb-4 border border-line bg-surface px-3 py-2.5" data-findings>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="font-ui text-[11px] text-muted">
          Findings{report.task ? ` · ${report.task}` : ''}
        </p>
        <VerdictChip verdicts={report.rounds.map((r) => r.verdict)} />
        <span className="ml-auto font-ui text-[11px] text-faint">
          {report.findings.length === 0
            ? 'none raised'
            : `${standing.length} standing of ${report.findings.length} · ${report.rounds.length} round${report.rounds.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {report.findings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {ranked(report.findings).map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </ul>
      )}
    </section>
  )
}
