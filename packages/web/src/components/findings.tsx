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
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type ReviewFinding, type ReviewReport, type Severity, type Verdict } from '../api.ts'

const SEVERITY_RANK: Record<Severity, number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

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
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${VERDICT_TONE[last]}`}
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
      className={`inline-flex shrink-0 items-center rounded-xs border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${SEVERITY_TONE[finding.severity]}`}
      title={finding.severityText || finding.severity}
    >
      {finding.severityText || finding.severity}
    </span>
  )
}

/**
 * One finding, verbatim. Exported because G2's packet surface (#256) renders
 * the same card under the criterion the finding cites — the finding is the
 * same object in both places and must not grow a second rendering.
 */
export function FindingCard({ finding, source }: { finding: ReviewFinding; source?: string }) {
  const resolved = finding.resolution?.state === 'resolved'
  const [open, setOpen] = useState(!resolved)
  return (
    <li className={`rounded-[5px] border px-3 py-2 ${resolved ? 'border-line bg-surface' : 'border-line bg-inset'}`} data-finding={finding.id}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`shrink-0 font-mono text-[11.5px] font-semibold ${resolved ? 'text-faint' : 'text-ink'}`}>{finding.id}</span>
        <SeverityChip finding={finding} />
        {/* Named only where the card leaves its own report — under a criterion,
            "which review raised this" is not otherwise on screen. */}
        {source && <span className="shrink-0 font-mono text-[10.5px] text-faint">{source}</span>}
        {finding.round !== null && <span className="shrink-0 font-mono text-[10.5px] text-faint">round {finding.round}</span>}
        <span className={`min-w-0 flex-1 text-[12.5px] ${resolved ? 'text-muted line-through decoration-faint' : 'text-ink'}`}>
          {finding.title}
        </span>
        {finding.resolution && (
          <button
            onClick={() => setOpen((v) => !v)}
            className={`shrink-0 rounded-full border px-[7px] py-px font-mono text-[10.5px] font-semibold leading-none ${
              resolved ? 'border-ok-line bg-ok-bg text-ok' : 'border-warn-line bg-warn-bg text-warn'
            }`}
            title={finding.resolution.text}
          >
            {finding.resolution.state}
            {finding.resolution.round !== null ? ` (round ${finding.resolution.round})` : ''}
            {open ? ' ▾' : ' ▸'}
          </button>
        )}
      </div>
      {open && (
        <dl className="mt-1.5 flex flex-col gap-1 text-[12px] leading-[1.5]">
          {finding.where && <Field label="Where">{finding.where}</Field>}
          {finding.failureScenario && <Field label="Failure scenario">{finding.failureScenario}</Field>}
          {finding.requirement && <Field label="Requirement">{finding.requirement}</Field>}
          {finding.resolution && <Field label={`Round ${finding.resolution.round ?? '?'}`}>{finding.resolution.text}</Field>}
        </dl>
      )}
    </li>
  )
}

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 text-muted">{children}</dd>
    </div>
  )
}

/** Blocking first, then by id — the order the contract already ranks them in. */
function ranked(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(a.id.slice(1)) - Number(b.id.slice(1)),
  )
}

export function useReviews(src: string, slug: string): ReviewReport[] | undefined {
  const { data } = useQuery({ queryKey: ['reviews', src, slug], queryFn: () => api.reviews(src, slug) })
  return data?.reports
}

/** The findings panel above a review artifact's own markdown. */
export function FindingsPanel({ src, slug, path }: { src: string; slug: string; path: string }) {
  const reports = useReviews(src, slug)
  const report = reports?.find((r) => r.path === path)
  if (!report) return null
  const standing = report.findings.filter((f) => f.resolution?.state !== 'resolved')
  return (
    <section className="mb-4 rounded-[5px] border border-line bg-surface px-3 py-2.5" data-findings>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
          Findings{report.task ? ` · ${report.task}` : ''}
        </p>
        <VerdictChip verdicts={report.rounds.map((r) => r.verdict)} />
        <span className="ml-auto font-mono text-[11px] text-faint">
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
