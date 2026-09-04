// Evidence-presence rollup (#165): for each acceptance criterion the spec
// defines, where in the record does evidence cite it? Derived at read time
// from the run's own artifacts — never stored, never judged. Gatehouse
// computes PRESENCE, not verdicts: the report's verdict cell travels as a
// verbatim quote attributed to the report; no aggregate score, meter, or
// pass/fail rollup is ever computed here. Uncited criteria are the headline —
// a factual statement about the record, not a computed failure.
//
// #256 promotes this from a citation map to the G2 packet itself, so a
// criterion now carries the two things the approver otherwise opened three
// files to find: the evidence block that proves it, verbatim, and the review
// findings that cite it. Both are still presence — the block is the report's
// own bytes and a finding reference names a finding the reviewer raised.
// Ordering findings by the report's own severity label is quoting; computing a
// verified/unverified ratio would not be, and is out of scope permanently.
import { type Lexicon } from './lexicon.ts'
import { SEVERITY_RANK, parseReview, type ReviewFinding } from './review.ts'

export interface EvidenceAnchor {
  /** Run-relative artifact path. */
  artifact: string
  /** 1-based line of the citation. */
  line: number
  /** The evidence-block label ('E1') or '' for a bare mention. */
  label: string
}

export interface EvidenceBlock extends EvidenceAnchor {
  /**
   * The evidence block verbatim — its `### E<k> — AC<n>.<m>` heading through
   * the end of its body. Carried so the G2 surface can show the proof inline
   * instead of linking a scroll away; it is a byte-identical slice of
   * verification-report.md, never a summary of one.
   */
  block: string
}

/** A finding raised against a criterion — a reference into the typed reviews. */
export interface FindingRef {
  /** Run-relative path of the review-NN.md that raised it. */
  artifact: string
  /** 'F1' — the finding's own id within that report. */
  id: string
}

export interface CriterionEvidence {
  id: string
  /** spec.md defines it; false → cited by the record but defined nowhere. */
  defined: boolean
  /** Evidence blocks (`### E<k> — AC<n>.<m>`) citing this criterion. */
  evidence: EvidenceBlock[]
  /** Verbatim cells from the report's Results-table row, if present. */
  result: { verdict: string; evidence: string } | null
  /** Verbatim line from the report's Gaps section mentioning this criterion. */
  gap: string | null
  /** review-NN.md lines citing this criterion — discussion, not evidence. */
  reviewMentions: EvidenceAnchor[]
  /**
   * Review findings whose own block cites this criterion, ordered by the
   * severity the reports themselves declare — blocking first, then by report
   * path, then by finding id. A resolved finding stays in the list: the record
   * raised it, and dropping it would make a word of it unreachable.
   */
  findings: FindingRef[]
}

export interface EvidenceRollup {
  hasVerification: boolean
  /**
   * The report's overall `**Verdict:**` line, verbatim (#152) — quoted and
   * attributed, never computed. Null when the report predates the line.
   */
  verdict: string | null
  /** Spec-defined criteria in definition order, then unknown citations. */
  criteria: CriterionEvidence[]
  /**
   * Why the structured view must withhold itself, or null when it applies.
   * Contracts are forkable, so a report may legitimately follow a grammar this
   * parser does not know; the contracts' own bounce rule turned on the UI is to
   * say so and fall back to the raw markdown, never to guess.
   */
  withheld: string | null
}

const AC_ID = /\bAC\d+\.\d+\b/g
const E_HEADING = /^#{1,6}\s*(E\d+)\s+—\s+(AC\d+\.\d+)/
const ANY_HEADING = /^#{1,6}\s/
const H2 = /^##\s+(.+?)\s*$/
const FENCE = /^\s*(```|~~~)/
const VERIFICATION = 'verification-report.md'
const VERDICT_LINE = /^\*{2}Verdict:\*{2}\s*(.+?)\s*$/

interface Line {
  text: string
  inFence: boolean
}

function toLines(text: string): Line[] {
  let inFence = false
  return text.split('\n').map((raw) => {
    if (FENCE.test(raw)) inFence = !inFence
    return { text: raw, inFence }
  })
}

/** The block from `start` up to the next heading outside a fence, trailing blanks trimmed. */
function blockFrom(lines: Line[], start: number): string {
  let end = start + 1
  while (end < lines.length && (lines[end]!.inFence || !ANY_HEADING.test(lines[end]!.text))) end++
  while (end > start + 1 && lines[end - 1]!.text.trim() === '') end--
  return lines
    .slice(start, end)
    .map((l) => l.text)
    .join('\n')
}

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
      e = { id, defined, evidence: [], result: null, gap: null, reviewMentions: [], findings: [] }
      byId.set(id, e)
      order.push(id)
    }
    return e
  }

  for (const def of input.lexicon.entries) if (def.kind === 'criterion') entry(def.id, true)

  let blocks = 0
  let rows = 0
  let verdict: string | null = null
  if (input.verification) {
    const lines = toLines(input.verification)
    let section = ''
    lines.forEach((line, i) => {
      if (line.inFence) return
      const text = line.text
      const v = VERDICT_LINE.exec(text)
      if (v && verdict === null) verdict = v[1]!
      const h2 = H2.exec(text)
      if (h2) section = h2[1]!
      const e = E_HEADING.exec(text)
      if (e) {
        blocks++
        entry(e[2]!, byId.has(e[2]!)).evidence.push({
          artifact: VERIFICATION,
          line: i + 1,
          label: e[1]!,
          block: blockFrom(lines, i),
        })
        return
      }
      // Results-table row keyed by a bare criterion id (contract grammar).
      const cells = text.split('|').map((c) => c.trim())
      if (cells.length >= 4 && /^AC\d+\.\d+$/.test(cells[1] ?? '')) {
        rows++
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

  // Findings first, so the severity order the reports declare survives the
  // join: sort every report's findings together, then attribute each to the
  // criteria its own block cites.
  const raised: { artifact: string; finding: ReviewFinding }[] = []
  for (const review of input.reviews ?? []) {
    for (const finding of parseReview(review.path, review.content).findings) {
      raised.push({ artifact: review.path, finding })
    }
  }
  raised.sort(
    (a, b) =>
      SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
      a.artifact.localeCompare(b.artifact) ||
      Number(a.finding.id.slice(1)) - Number(b.finding.id.slice(1)),
  )
  for (const { artifact, finding } of raised) {
    for (const id of new Set(finding.block.match(AC_ID) ?? [])) {
      entry(id, byId.has(id)).findings.push({ artifact, id: finding.id })
    }
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
    verdict,
    criteria: order.map((id) => byId.get(id)!),
    withheld:
      input.verification !== null && blocks === 0 && rows === 0
        ? 'verification-report.md follows neither the `### E<k> — AC<n>.<m>` evidence-block grammar nor the Results-table row grammar, so this view cannot say which criterion each piece of evidence proves.'
        : null,
  }
}
