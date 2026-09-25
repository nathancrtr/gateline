// Evidence-presence rollup (#165): a citation map over the record for the G2
// approver. Presence, never verdicts — the report's verdict cell renders as a
// verbatim quote attributed to the report ("report states: …"); nothing here
// computes a score, a meter, or a green/red count, so the approver reviews
// the evidence, not a gauge. Uncited criteria are the headline.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type CriterionEvidence, type EvidenceRollup, type Profile, type ReviewFinding, type ReviewReport } from '../api.ts'
import { DIFF_SELECTION } from '../landing.ts'
import { boundaryLine, fileLabel } from '../surface.ts'
import { FindingCard, Inline, PACKET_FRAME, PACKET_LABEL, PacketSweep, useReviews, VerdictChip } from './findings.tsx'
import { useLexicon } from './lexicon.tsx'

const artifactLink = (src: string, slug: string, artifact: string, anchor?: string) =>
  `/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(artifact)}${anchor ? `&anchor=${anchor}` : ''}`

export function EvidenceRollupPanel({ src, slug }: { src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  if (!data?.hasVerification || data.criteria.length === 0) return null
  // A report written to another grammar (#256): "no evidence cites AC1.1" would
  // state as fact about the record something the parser has just said it cannot
  // determine. Stand down to the reason — the report's own markdown is directly
  // below this panel, so nothing is lost.
  if (data.withheld) {
    return (
      <p className="mt-3 border border-line bg-inset px-3 py-2.5 text-xs leading-[1.5] text-muted" data-evidence-withheld>
        Evidence citations not computed — {data.withheld}
      </p>
    )
  }
  const defined = data.criteria.filter((c) => c.defined)
  const unknown = data.criteria.filter((c) => !c.defined)
  const uncited = defined.filter((c) => c.evidence.length === 0 && !c.result)
  const cited = defined.filter((c) => c.evidence.length > 0 || c.result)
  return (
    <section className="mt-3 border border-line bg-inset px-3 py-2.5 text-xs" data-evidence-rollup>
      <p className="font-ui text-[11px] text-muted">Evidence citations — computed from the record</p>
      <ReportVerdict rollup={data} />
      {uncited.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold text-warn">No verification evidence cites:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {uncited.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-semibold">{c.id}</span>
                {c.gap ? (
                  <span className="min-w-0 text-muted">Gaps: “{c.gap}”</span>
                ) : (
                  <span className="text-faint">and no Gaps entry mentions it</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {cited.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {cited.map((c) => (
            <EvidenceRow key={c.id} c={c} src={src} slug={slug} />
          ))}
        </ul>
      )}
      {unknown.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold text-warn">Cited by the record, defined in no spec:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {unknown.map((c) => (
              <EvidenceRow key={c.id} c={c} src={src} slug={slug} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** The first word of a Results verdict cell, lower-cased: `verified (with a note)` reads as `verified`. */
const verdictWord = (cell: string) => cell.trim().split(/\s+/)[0]?.toLowerCase() ?? ''

/**
 * The report's own words about itself (#152): its overall verdict line, and
 * every Results row whose verdict cell does not begin with "verified". Quoted
 * and attributed — the report said it — so a non-clean report is visually
 * distinct from a clean pass without the panel judging anything. A report
 * with no verdict line says so too: absence is a fact of the record, and
 * the one the approver most needs to notice on a report written today.
 * Rendered on the G2 card and on the report's own rollup.
 */
export function ReportVerdict({ rollup }: { rollup: EvidenceRollup }) {
  if (!rollup.hasVerification) return null
  const notVerified = rollup.criteria.filter((c) => c.result && verdictWord(c.result.verdict) !== 'verified')
  const alarmed = rollup.verdict !== null && rollup.verdict.trim().toLowerCase() !== 'pass'
  return (
    <div data-report-verdict-block>
      {rollup.verdict === null ? (
        <p className="mt-1.5 text-muted" data-report-verdict="">
          The report states no overall verdict — written before the verdict line existed, or without it.
        </p>
      ) : (
        <p className={`mt-1.5 ${alarmed ? 'font-semibold text-bad' : 'text-muted'}`} data-report-verdict={rollup.verdict}>
          The report states its verdict: <span className="font-mono">“{rollup.verdict}”</span>
        </p>
      )}
      {notVerified.length > 0 && (
        <div className="mt-2" data-not-verified>
          <p className="font-semibold text-warn">
            Results rows whose verdict cell is not “verified”: {notVerified.length === 1 ? 'one criterion' : `${notVerified.length} criteria`}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {notVerified.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-semibold">{c.id}</span>
                <span className="text-muted">
                  report states: <span className="font-mono">{c.result!.verdict.trim() ? `“${c.result!.verdict}”` : '(empty cell)'}</span>
                  {c.result!.evidence && <> — <span className="font-mono">“{c.result!.evidence}”</span></>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function EvidenceRow({ c, src, slug }: { c: CriterionEvidence; src: string; slug: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-mono font-semibold">{c.id}</span>
      {c.evidence.map((a) => (
        <Link
          key={`${a.label}-${a.line}`}
          className="font-mono text-[11px] text-accent underline underline-offset-2"
          to={artifactLink(src, slug, a.artifact, `def-${a.label}`)}
        >
          {a.label}
        </Link>
      ))}
      {c.result && (
        <span className="text-muted">
          report states: <span className="font-mono">“{c.result.verdict}”</span>
        </span>
      )}
      {c.reviewMentions.length > 0 && (
        <span className="text-faint">
          discussed in{' '}
          {c.reviewMentions.map((a, i) => (
            <span key={`${a.artifact}:${a.line}`}>
              {i > 0 && ', '}
              <Link className="underline underline-offset-2" to={artifactLink(src, slug, a.artifact)}>
                {a.artifact}:{a.line}
              </Link>
            </span>
          ))}
        </span>
      )}
      {c.gap && <span className="min-w-0 text-muted">Gaps: “{c.gap}”</span>}
    </li>
  )
}

// ---------------------------------------------------------------------------
// G2's primary surface (#256).
//
// The rollup above answers "which criteria does the record cite?" in one line
// each. That was filed as a panel inside the G2 card, and it was also the only
// gate-specific branch on the whole run page — the existence proof that a gate
// deserves a surface of its own. This is that surface: the G2 packet composed
// in spec order, so the approver reads criterion → evidence → findings without
// assembling three files by hand.
//
// The rules the epic (#261) makes standing, restated because this surface sits
// closest to the line:
//
//   Verbatim and reachable. Every word here is a byte-identical slice of a
//   committed artifact — the criterion from spec.md via the lexicon, the
//   verdict and evidence cells from the report's Results row, the `### E`
//   block, the finding as the reviewer wrote it. The full artifacts stay one
//   click away, so folding is never truncation.
//
//   Presence, not verdicts. Nothing here scores, counts toward a threshold, or
//   tints by outcome. The report's verdict cell is quoted and attributed, not
//   turned into a green chip: 'verified' is the report's word, and a fork may
//   write another. Ordering findings by the report's own severity label is
//   quoting. "83% verified" is out of scope permanently.
//
// Two shapes, chosen by the record rather than by a profile switch: a spine of
// criteria when the spec defines any, and a spine of reports when it does not.
// A `patch` run reaches the second by construction — it runs no analyst and no
// verifier, so the reviews ARE the packet — with no missing-verifier error,
// because an absent verification report is that profile's ordinary shape.

const SEVERITY_ORDER: Record<ReviewFinding['severity'], number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

/** Index the typed reports so a criterion's finding refs resolve to findings. */
function findingIndex(reports: ReviewReport[] | undefined): Map<string, ReviewFinding> {
  const m = new Map<string, ReviewFinding>()
  for (const r of reports ?? []) for (const f of r.findings) m.set(`${r.path}#${f.id}`, f)
  return m
}

/** The report's own words about a criterion — quoted, attributed, untinted. */
function ResultLine({ result }: { result: NonNullable<CriterionEvidence['result']> }) {
  return (
    <p className="mt-1 text-[12px] leading-[1.5] text-muted">
      <span className="font-mono text-[11px] text-faint">verification-report.md states</span>{' '}
      <span className="font-mono text-ink">“{result.verdict}”</span>
      {result.evidence && (
        <>
          {' · evidence '}
          <span className="font-mono">“{result.evidence}”</span>
        </>
      )}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Quoting an evidence block (#282).

const FENCE = /^\s*(?:```|~~~)/
const HEADING_MARK = /^#{1,6}\s*/

interface BlockSegment {
  kind: 'code' | 'text'
  text: string
}

/**
 * Split an evidence block into the pieces it is actually made of.
 *
 * `EvidenceBlock.block` is a byte-identical slice of verification-report.md,
 * which means it arrives as markdown: a `### E<k> — AC<n>.<m>` heading and one
 * or more fenced blocks holding the command that was run. Dropping the whole
 * thing into a `<pre>` printed the fence rows as content — a literal ``` line
 * above and below every command — and the heading's `###` with them. The
 * Record reader renders the same bytes as a real code block, so the defect was
 * never in the artifact; it was this layer showing syntax where the reader
 * shows structure.
 *
 * Segmented rather than run through `Markdown`: `prose-artifact` is a 16.5px
 * serif reading surface with 26px heading margins, and this sits inside an
 * 11.5px card. The words are identical either way; only the chrome differs.
 *
 * `restated` is the heading this block would carry if it said nothing beyond
 * its own label and criterion — both of which the card already shows verbatim,
 * in the summary above and in the criterion id. When that is all the heading
 * says it is dropped; when the reviewer wrote more, the extra words are kept
 * and only the `#` marks go.
 */
function evidenceSegments(block: string, restated?: string): BlockSegment[] {
  const lines = block.split('\n')
  const first = lines[0]
  if (first !== undefined && HEADING_MARK.test(first)) {
    const words = first.replace(HEADING_MARK, '').trim()
    lines[0] = words.replace(/\s+/g, ' ') === restated ? '' : words
  }
  const segments: BlockSegment[] = []
  let buffer: string[] = []
  let kind: BlockSegment['kind'] = 'text'
  const flush = () => {
    while (buffer.length > 0 && buffer[0]!.trim() === '') buffer.shift()
    while (buffer.length > 0 && buffer[buffer.length - 1]!.trim() === '') buffer.pop()
    if (buffer.length > 0) segments.push({ kind, text: buffer.join('\n') })
    buffer = []
  }
  for (const line of lines) {
    if (FENCE.test(line)) {
      flush()
      kind = kind === 'code' ? 'text' : 'code'
      continue
    }
    buffer.push(line)
  }
  flush()
  return segments
}

/** The proof itself: the command as a code block, the reviewer's prose as prose. */
function EvidenceBody({ block, restated }: { block: string; restated: string }) {
  return (
    <>
      {evidenceSegments(block, restated).map((segment, i) =>
        segment.kind === 'code' ? (
          <pre
            // biome-ignore lint/suspicious/noArrayIndexKey: segment text can repeat (e.g. two blank lines); this is a fixed, one-time parse of block/restated, never reordered.
            key={i}
            className="mt-1 overflow-x-auto border border-line bg-inset p-2 font-mono text-[11.5px] leading-[1.5] text-ink"
          >
            {segment.text}
          </pre>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: see the code-segment case above.
          <p key={i} className="mt-1 whitespace-pre-wrap text-[12px] leading-[1.5] text-muted">
            <Inline>{segment.text}</Inline>
          </p>
        ),
      )}
    </>
  )
}

/** One criterion: the spec's words, the report's words, the proof, the findings. */
function CriterionPacket({
  c,
  src,
  slug,
  hasVerification,
  findings,
}: {
  c: CriterionEvidence
  src: string
  slug: string
  hasVerification: boolean
  findings: Map<string, ReviewFinding>
}) {
  const lex = useLexicon()
  // The criterion verbatim from spec.md. Absent only when the record cites an
  // id the spec never defined — which is itself the fact worth showing.
  const text = lex?.byId.get(c.id)?.at(-1)?.body ?? null
  const cited = c.evidence.length > 0 || c.result !== null
  const raised = c.findings.map((ref) => ({ ref, finding: findings.get(`${ref.artifact}#${ref.id}`) }))
  return (
    <li
      className={`border px-3 py-2.5 ${cited || !hasVerification ? 'border-line bg-surface' : 'border-warn-line bg-warn-bg'}`}
      data-criterion={c.id}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[11.5px] font-semibold text-ink">{c.id}</span>
        {text ? (
          <span className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-ink">{text}</span>
        ) : (
          <span className="min-w-0 flex-1 text-[12.5px] text-warn">cited by the record, defined in no spec</span>
        )}
        {c.defined && (
          <Link
            className="ml-auto shrink-0 font-mono text-[10.5px] text-accent underline underline-offset-2"
            to={artifactLink(src, slug, 'spec.md', `def-R${c.id.slice(2).split('.')[0]}`)}
          >
            spec.md
          </Link>
        )}
      </div>

      {hasVerification && !cited && (
        <p className="mt-1 text-[12px] font-semibold text-warn">
          No verification evidence cites it
          {c.gap ? '' : ' — and no Gaps entry mentions it'}
        </p>
      )}
      {c.result && <ResultLine result={c.result} />}
      {c.gap && (
        <p className="mt-1 text-[12px] leading-[1.5] text-muted">
          <span className="font-ui text-[11px] text-faint">Gaps</span> “{c.gap}”
        </p>
      )}

      {/* The proof itself, inline rather than a scroll away — the report's own
          bytes, open by default because it is the thing being approved. */}
      {c.evidence.map((a) => (
        <details key={`${a.label}-${a.line}`} open className="mt-1.5" data-evidence-block={a.label}>
          <summary className="cursor-pointer font-ui text-[11px] text-muted marker:text-faint">
            {a.label} ·{' '}
            <Link
              className="text-accent underline underline-offset-2"
              to={artifactLink(src, slug, a.artifact, `def-${a.label}`)}
              onClick={(e) => e.stopPropagation()}
            >
              {a.artifact}:{a.line}
            </Link>
          </summary>
          <EvidenceBody block={a.block} restated={`${a.label} — ${c.id}`} />
        </details>
      ))}

      {raised.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {raised.map(({ ref, finding }) =>
            finding ? (
              <FindingCard key={`${ref.artifact}#${ref.id}`} finding={finding} source={ref.artifact} />
            ) : (
              <li key={`${ref.artifact}#${ref.id}`} className="font-mono text-[11.5px] text-muted">
                <Link className="underline underline-offset-2" to={artifactLink(src, slug, ref.artifact)}>
                  {ref.artifact} · {ref.id}
                </Link>
              </li>
            ),
          )}
        </ul>
      )}
    </li>
  )
}

/** Findings that cite no criterion — reachable here, not only in the reports. */
function UnattributedFindings({
  reports,
  claimed,
  src,
  slug,
}: {
  reports: ReviewReport[]
  claimed: Set<string>
  src: string
  slug: string
}) {
  const loose = reports.flatMap((r) =>
    r.findings.filter((f) => !claimed.has(`${r.path}#${f.id}`)).map((f) => ({ path: r.path, finding: f })),
  )
  if (loose.length === 0) return null
  loose.sort(
    (a, b) =>
      SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] ||
      a.path.localeCompare(b.path) ||
      Number(a.finding.id.slice(1)) - Number(b.finding.id.slice(1)),
  )
  return (
    <div className="mt-3" data-unattributed-findings>
      <p className="font-ui text-[11px] text-muted">
        Findings citing no criterion
        <Link className="ml-2 normal-case text-accent underline underline-offset-2" to={artifactLink(src, slug, loose[0]!.path)}>
          open the reports
        </Link>
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {loose.map(({ path, finding }) => (
          <FindingCard key={`${path}#${finding.id}`} finding={finding} source={path} />
        ))}
      </ul>
    </div>
  )
}

/** The report spine: what a run with no acceptance criteria has instead. */
function ReportsPacket({ reports, src, slug }: { reports: ReviewReport[]; src: string; slug: string }) {
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {reports.map((r) => (
        <li key={r.path} className="border border-line bg-surface px-3 py-2.5" data-report={r.path}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link className="font-mono text-[11.5px] font-semibold text-accent underline underline-offset-2" to={artifactLink(src, slug, r.path)}>
              {r.path}
            </Link>
            {r.task && <span className="font-mono text-[11px] text-faint">{r.task}</span>}
            <VerdictChip verdicts={r.rounds.map((x) => x.verdict)} />
            <span className="ml-auto font-ui text-[11px] text-faint">
              {r.findings.length === 0 ? 'no findings raised' : `${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {r.findings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {[...r.findings]
                .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || Number(a.id.slice(1)) - Number(b.id.slice(1)))
                .map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * G2's packet, composed. Renders inside the G2 decision card in place of the
 * one-line rollup that used to sit there.
 *
 * `profile` is used for one thing only — naming why a patch run has no
 * verification column — never to decide what to parse. What renders follows
 * from the record: contracts are forkable, so a report that does not match the
 * grammar withholds the structured view and says so rather than guessing.
 */
export function G2Packet({ src, slug, profile }: { src: string; slug: string; profile: Profile }) {
  const { data, isPending } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  const reports = useReviews(src, slug)
  // The frame and its label do not depend on the read, so they render now
  // (#299) — what is pending is the packet's content, not its identity. A G2
  // card that renders nothing here is shaped exactly like a G0 card, which has
  // no packet at all, and the operator cannot tell the two apart.
  if (isPending) {
    return (
      <section className={PACKET_FRAME} data-g2-packet aria-busy="true">
        <p className={PACKET_LABEL}>G2 packet — composed from the record</p>
        <PacketSweep />
      </section>
    )
  }
  if (!data) return null

  const rollup: EvidenceRollup = data
  const findings = findingIndex(reports)
  const claimed = new Set(rollup.criteria.flatMap((c) => c.findings.map((f) => `${f.artifact}#${f.id}`)))
  const defined = rollup.criteria.filter((c) => c.defined)
  const unknown = rollup.criteria.filter((c) => !c.defined)
  // Uncited criteria are the headline: a fact about the record, not a computed
  // failure, and the one thing an approver most needs before saying yes.
  const uncited = rollup.hasVerification ? defined.filter((c) => c.evidence.length === 0 && !c.result) : []
  const rest = defined.filter((c) => !uncited.includes(c))
  const ordered = [...uncited, ...rest, ...unknown]

  const header = (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <p className={PACKET_LABEL}>G2 packet — composed from the record</p>
      {!rollup.hasVerification && (
        <span className="font-ui text-[11px] text-faint">
          {profile === 'patch' ? 'patch profile runs no verifier — the reviews are the packet' : 'no verification report in the record'}
        </span>
      )}
    </div>
  )

  return (
    <section className={PACKET_FRAME} data-g2-packet>
      {header}
      {/* The report's own verdict, on the card itself (#152): the fleetview-
          design approver decided G2 without seeing two failed criteria. */}
      <ReportVerdict rollup={rollup} />
      {/* Contracts are forkable; the parser is not the authority on them. When
          the grammar does not match, say which grammar and stand down — the
          report itself renders as its own markdown one click away. */}
      {rollup.withheld && (
        <p className="mt-2 border border-warn-line bg-warn-bg px-2.5 py-2 text-[12px] leading-[1.5] text-warn" data-withheld>
          Criterion view withheld — {rollup.withheld}{' '}
          <Link className="text-accent underline underline-offset-2" to={artifactLink(src, slug, 'verification-report.md')}>
            read verification-report.md
          </Link>
        </p>
      )}
      {!rollup.withheld && ordered.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {ordered.map((c) => (
            <CriterionPacket key={c.id} c={c} src={src} slug={slug} hasVerification={rollup.hasVerification} findings={findings} />
          ))}
        </ul>
      )}
      {(rollup.withheld || ordered.length === 0) && reports && reports.length > 0 && (
        <ReportsPacket reports={reports} src={src} slug={slug} />
      )}
      {!rollup.withheld && ordered.length > 0 && reports && (
        <UnattributedFindings reports={reports} claimed={claimed} src={src} slug={slug} />
      )}
      <BoundaryCheck src={src} slug={slug} />
    </section>
  )
}

/**
 * The diff's place in G2's packet (#270). DESIGN.md §4 names the diff as part
 * of what G2 approves, and #256 deferred which form it takes to #259; the answer
 * was the contact-surface-scoped view. The card carries the one fact that view
 * exists to produce — did the change stay inside what the plan declared — and
 * routes to the diff itself rather than reprinting it under the criterion spine.
 *
 * Presence, not verdicts, to the end: "N outside every declared surface" is a
 * fact about the record. It is not called a breach, and a clean count is not
 * called a pass — an amendment may have widened a surface legitimately.
 */
function BoundaryCheck({ src, slug }: { src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['diff', src, slug], queryFn: () => api.diff(src, slug) })
  if (!data || data.merged) return null
  const line = boundaryLine(data.files, data.surface)
  if (!line || line.changed === 0) return null

  return (
    <p className="mt-2.5 border-t border-line pt-2 text-[12px] leading-[1.55] text-muted" data-boundary-check>
      <span className="font-ui text-[11px] text-muted">boundary</span>{' '}
      <span className="text-ink">{line.changed}</span> changed file{line.changed === 1 ? '' : 's'};{' '}
      {line.undeclared.length === 0 ? (
        <>every one falls under a declared contact surface.</>
      ) : (
        <>
          <span className="text-warn">{line.undeclared.length}</span> outside every declared surface —{' '}
          <span className="font-mono text-[11.5px] text-warn">{line.undeclared.map(fileLabel).join(', ')}</span>.
        </>
      )}{' '}
      <Link className="text-accent underline underline-offset-2" to={`/runs/${src}/${slug}?tab=record&artifact=${encodeURIComponent(DIFF_SELECTION)}`}>
        read the diff by surface
      </Link>
    </p>
  )
}
