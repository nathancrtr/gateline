// Evidence-presence rollup (#165): a citation map over the record for the G2
// approver. Presence, never verdicts — the report's verdict cell renders as a
// verbatim quote attributed to the report ("report states: …"); nothing here
// computes a score, a meter, or a green/red count, so the approver reviews
// the evidence, not a gauge. Uncited criteria are the headline.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, type CriterionEvidence } from '../api.ts'

const artifactLink = (src: string, slug: string, artifact: string, anchor?: string) =>
  `/runs/${src}/${slug}?tab=artifacts&artifact=${encodeURIComponent(artifact)}${anchor ? `&anchor=${anchor}` : ''}`

export function EvidenceRollupPanel({ src, slug }: { src: string; slug: string }) {
  const { data } = useQuery({ queryKey: ['evidence', src, slug], queryFn: () => api.evidence(src, slug) })
  if (!data?.hasVerification || data.criteria.length === 0) return null
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
