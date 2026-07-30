// Evidence-presence rollup (#165): for each acceptance criterion the spec
// defines, where in the record does evidence cite it? Derived at read time
// from the run's own artifacts — never stored, never judged. Gatehouse
// computes PRESENCE, not verdicts: the report's verdict cell travels as a
// verbatim quote attributed to the report; no aggregate score, meter, or
// pass/fail rollup is ever computed here. Uncited criteria are the headline —
// a factual statement about the record, not a computed failure.
import { type Lexicon } from './lexicon.ts'

export interface EvidenceAnchor {
  /** Run-relative artifact path. */
  artifact: string
  /** 1-based line of the citation. */
  line: number
  /** The evidence-block label ('E1') or '' for a bare mention. */
  label: string
}

export interface CriterionEvidence {
  id: string
  /** spec.md defines it; false → cited by the record but defined nowhere. */
  defined: boolean
  /** Evidence blocks (`### E<k> — AC<n>.<m>`) citing this criterion. */
  evidence: EvidenceAnchor[]
  /** Verbatim cells from the report's Results-table row, if present. */
  result: { verdict: string; evidence: string } | null
  /** Verbatim line from the report's Gaps section mentioning this criterion. */
  gap: string | null
  /** review-NN.md lines citing this criterion — discussion, not evidence. */
  reviewMentions: EvidenceAnchor[]
}

export interface EvidenceRollup {
  hasVerification: boolean
  /** Spec-defined criteria in definition order, then unknown citations. */
  criteria: CriterionEvidence[]
}

const AC_ID = /\bAC\d+\.\d+\b/g
const E_HEADING = /^#{1,6}\s*(E\d+)\s+—\s+(AC\d+\.\d+)/
const H2 = /^##\s+(.+?)\s*$/
const FENCE = /^\s*(```|~~~)/
const VERIFICATION = 'verification-report.md'

export function buildEvidenceRollup(input: {
  lexicon: Lexicon
  verification: string | null
  reviews?: { path: string; content: string }[]
}): EvidenceRollup {
  const byId = new Map<string, CriterionEvidence>()
  const order: string[] = []
  const entry = (id: string, defined: boolean): CriterionEvidence => {
    let e = byId.get(id)
    if (!e) {
      e = { id, defined, evidence: [], result: null, gap: null, reviewMentions: [] }
      byId.set(id, e)
      order.push(id)
    }
    return e
  }

  for (const def of input.lexicon.entries) if (def.kind === 'criterion') entry(def.id, true)

  if (input.verification) {
    let inFence = false
    let section = ''
    input.verification.split('\n').forEach((text, i) => {
      if (FENCE.test(text)) inFence = !inFence
      if (inFence) return
      const h2 = H2.exec(text)
      if (h2) section = h2[1]!
      const e = E_HEADING.exec(text)
      if (e) {
        entry(e[2]!, byId.has(e[2]!)).evidence.push({ artifact: VERIFICATION, line: i + 1, label: e[1]! })
        return
      }
      // Results-table row keyed by a bare criterion id (contract grammar).
      const cells = text.split('|').map((c) => c.trim())
      if (cells.length >= 4 && /^AC\d+\.\d+$/.test(cells[1] ?? '')) {
        const row = entry(cells[1]!, byId.has(cells[1]!))
        row.result ??= { verdict: cells[2] ?? '', evidence: cells[3] ?? '' }
        return
      }
      if (section === 'Gaps') {
        for (const m of text.match(AC_ID) ?? []) {
          const row = entry(m, byId.has(m))
          row.gap ??= text.trim()
        }
      }
    })
  }

  for (const review of input.reviews ?? []) {
    review.content.split('\n').forEach((text, i) => {
      for (const m of new Set(text.match(AC_ID) ?? [])) {
        entry(m, byId.has(m)).reviewMentions.push({ artifact: review.path, line: i + 1, label: '' })
      }
    })
  }

  // `entry()` created unknown citations with defined = the id's prior
  // existence in the map — for a first sighting mid-record that is false,
  // which is exactly right; spec-defined ids stay first, in spec order.
  return {
    hasVerification: input.verification !== null,
    criteria: order.map((id) => byId.get(id)!),
  }
}
