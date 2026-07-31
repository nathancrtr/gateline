// Evidence-presence rollup (#165): a citation map over the record for the G2
// approver. Presence, never verdicts — the report's verdict cell renders as a
// verbatim quote attributed to the report ("report states: …"); nothing here
// computes a score, a meter, or a green/red count, so the approver reviews
// the evidence, not a gauge. Uncited criteria are the headline.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type CriterionEvidence, type EvidenceRollup, type Profile, type ReviewFinding, type ReviewReport } from '../api.ts'
import { FindingCard, VerdictChip, useReviews } from './findings.tsx'
import { useLexicon } from './lexicon.tsx'

const artifactLink = (src: string, slug: string, artifact: string, anchor?: string) =>
  `/runs/${src}/${slug}?tab=artifacts&artifact=${encodeURIComponent(artifact)}${anchor ? `&anchor=${anchor}` : ''}`

export function EvidenceRollupPanel({ src, slug }: { src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  if (!data?.hasVerification || data.criteria.length === 0) return null
  // A report written to another grammar (#256): "no evidence cites AC1.1" would
  // state as fact about the record something the parser has just said it cannot
  // determine. Stand down to the reason — the report's own markdown is directly
  // below this panel, so nothing is lost.
  if (data.withheld) {
    return (
      <p className="mt-3 rounded-[5px] border border-line bg-inset px-3 py-2.5 text-xs leading-[1.5] text-muted" data-evidence-withheld>
        Evidence citations not computed — {data.withheld}
      </p>
    )
  }
  const defined = data.criteria.filter((c) => c.defined)
  const unknown = data.criteria.filter((c) => !c.defined)
  const uncited = defined.filter((c) => c.evidence.length === 0 && !c.result)
  const cited = defined.filter((c) => c.evidence.length > 0 || c.result)
  return (
    <section className="mt-3 rounded-[5px] border border-line bg-inset px-3 py-2.5 text-xs" data-evidence-rollup>
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted">Evidence citations — computed from the record</p>
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
      className={`rounded-[5px] border px-3 py-2.5 ${cited || !hasVerification ? 'border-line bg-surface' : 'border-warn-line bg-warn-bg'}`}
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
          <span className="font-mono text-[11px] text-faint">Gaps</span> “{c.gap}”
        </p>
      )}

      {/* The proof itself, inline rather than a scroll away — the report's own
          bytes, open by default because it is the thing being approved. */}
      {c.evidence.map((a) => (
        <details key={`${a.label}-${a.line}`} open className="mt-1.5" data-evidence-block={a.label}>
          <summary className="cursor-pointer font-mono text-[11px] text-muted marker:text-faint">
            {a.label} ·{' '}
            <Link
              className="text-accent underline underline-offset-2"
              to={artifactLink(src, slug, a.artifact, `def-${a.label}`)}
              onClick={(e) => e.stopPropagation()}
            >
              {a.artifact}:{a.line}
            </Link>
          </summary>
          <pre className="mt-1 overflow-x-auto rounded-[4px] border border-line bg-inset p-2 font-mono text-[11.5px] leading-[1.5] text-ink">
            {a.block}
          </pre>
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
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted">
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
        <li key={r.path} className="rounded-[5px] border border-line bg-surface px-3 py-2.5" data-report={r.path}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link className="font-mono text-[11.5px] font-semibold text-accent underline underline-offset-2" to={artifactLink(src, slug, r.path)}>
              {r.path}
            </Link>
            {r.task && <span className="font-mono text-[11px] text-faint">{r.task}</span>}
            <VerdictChip verdicts={r.rounds.map((x) => x.verdict)} />
            <span className="ml-auto font-mono text-[11px] text-faint">
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
  const { data } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  const reports = useReviews(src, slug)
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
      <p className="font-mono text-[11px] uppercase tracking-wide text-muted">G2 packet — composed from the record</p>
      {!rollup.hasVerification && (
        <span className="font-mono text-[11px] text-faint">
          {profile === 'patch' ? 'patch profile runs no verifier — the reviews are the packet' : 'no verification report in the record'}
        </span>
      )}
    </div>
  )

  return (
    <section className="mt-3.5 rounded-[5px] border border-line bg-inset px-3 py-2.5" data-g2-packet>
      {header}
      {/* Contracts are forkable; the parser is not the authority on them. When
          the grammar does not match, say which grammar and stand down — the
          report itself renders as its own markdown one click away. */}
      {rollup.withheld && (
        <p className="mt-2 rounded-[4px] border border-warn-line bg-warn-bg px-2.5 py-2 text-[12px] leading-[1.5] text-warn" data-withheld>
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
    </section>
  )
}
