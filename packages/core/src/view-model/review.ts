// Typed review reports (#214): findings, severities, verdicts, and rounds,
// extracted from a run's own review-NN.md. Grammar per contracts/review-report.md
// — `**Verdict:**` / `**Round:**` lines, `### F<n> — <severity> — <title>`
// headings, and the `- **F<n> — resolved|stands ...**` disposition lines a
// later round appends.
//
// Rounds append within one file (roles/reviewer.md: never overwrite earlier
// rounds), so a report is a sequence of rounds and a finding raised in round 1
// may be dispositioned in round 2. Every field here is a verbatim slice of the
// committed artifact: nothing is summarized, reworded, or judged, and no text
// in the report becomes unreachable.
//
// Real reports under runs/ carry two heading shapes and qualified severities —
// `### F1 — minor (PLAUSIBLE) — ...` and `### F1 (blocking) — ...` — so both
// parse, and the severity cell is kept verbatim alongside the ranked token.
//
// Browser-safe leaf: zero imports, enforced by review.test.ts, so hosts can
// serve the parse as plain data to clients that must not bundle the core
// runtime (see web/src/api.ts).

export const VERDICTS = ['approve', 'request-changes', 'escalate'] as const
export type Verdict = (typeof VERDICTS)[number]

export const SEVERITIES = ['blocking', 'major', 'minor', 'unknown'] as const
export type Severity = (typeof SEVERITIES)[number]

/** Blocking first — the contract ranks findings most-severe first. */
export const SEVERITY_RANK: Record<Severity, number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

export interface ReviewResolution {
  /** How a later round dispositioned the finding. */
  state: 'resolved' | 'stands'
  /** The round that said so, or null when the report numbers no rounds. */
  round: number | null
  /** The disposition line, verbatim. */
  text: string
  /** 1-based line of the disposition. */
  line: number
}

export interface ReviewFinding {
  /** 'F1' */
  id: string
  severity: Severity
  /** The severity cell verbatim, e.g. 'minor (PLAUSIBLE)'. */
  severityText: string
  /** True when the reviewer marked the finding PLAUSIBLE rather than proven. */
  plausible: boolean
  title: string
  /** Contract fields, verbatim and without their bold label. Null when absent. */
  where: string | null
  failureScenario: string | null
  requirement: string | null
  /** The round that raised it, or null when the report numbers no rounds. */
  round: number | null
  /** 1-based line of the heading. */
  line: number
  /** The whole finding, heading through the end of its body, verbatim. */
  block: string
  /** The latest disposition from a later round, or null. */
  resolution: ReviewResolution | null
}

export interface ReviewRound {
  round: number | null
  verdict: Verdict | null
  /** The `**Diff reviewed:**` value, verbatim. */
  diff: string | null
  /** 1-based line of the round's verdict. */
  line: number
}

/** A disposition line, with the finding it names — including one whose finding
 *  was raised in a different file (see `ReviewReport.dispositions`). */
export interface ReviewDisposition extends ReviewResolution {
  id: string
}

export interface ReviewReport {
  /** Run-relative artifact path. */
  path: string
  /** Task id from the first `# Review Report: <id>` header, or null. */
  task: string | null
  rounds: ReviewRound[]
  /** Findings in document order. Callers sort; the record's order is kept here. */
  findings: ReviewFinding[]
  /**
   * Every `- **F<n> — resolved|stands ...**` line in this report, in document
   * order, whether or not it names a finding this file raised.
   *
   * `finding.resolution` can only carry the ones that attach within the file,
   * which is the whole story when rounds append to one report as
   * `roles/reviewer.md` directs. Where a run instead keeps a file per round,
   * round 3's "F2 — resolved" names a finding round 2's file raised, and
   * dropping it would make a decided part of the record unreachable — the one
   * thing no view here is allowed to do (#261).
   */
  dispositions: ReviewDisposition[]
  /** The verdict in force: the last round's. */
  verdict: Verdict | null
  /**
   * The `## Escalation` section (#405) — what the reviewer wrote for the
   * human who resolves it — or null when the report carries none. The
   * contract requires it exactly when the verdict in force is `escalate`;
   * a report predating the section, or off its grammar, reads as null and
   * the surface withholds itself rather than guessing.
   */
  escalation: EscalationSection | null
}

const FENCE = /^\s*(```|~~~)/
const ANY_HEADING = /^#{1,6}\s/
const HEADER = /^#\s+Review Report:\s*(.+?)\s*$/
const VERDICT_LINE = /^\*{2}Verdict:\*{2}\s*([a-z-]+)/i
const ROUND_LINE = /^\*{2}Round:\*{2}\s*(\d+)/i
const DIFF_LINE = /^\*{2}Diff reviewed:\*{2}\s*(.+?)\s*$/i
const FINDING_HEADING = /^#{1,6}\s*(F\d+)\b\s*(?:\(([^)]*)\))?\s*(?:—\s*(.*))?$/
const RESOLUTION = /^\s*[-*]\s*\*{0,2}(F\d+)\s*—\s*(resolved|stands)/i
const LIST_ITEM = /^\s*[-*]\s/
const FIELD = /^\s*[-*]\s*\*{2}([^*]+?):?\*{2}\s*(.*)$/

interface Line {
  text: string
  /** 1-based. */
  n: number
  inFence: boolean
}

function toLines(text: string): Line[] {
  let inFence = false
  return text.split('\n').map((raw, i) => {
    if (FENCE.test(raw)) inFence = !inFence
    return { text: raw, n: i + 1, inFence }
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

/** A list item plus its wrapped continuation lines. */
function itemFrom(lines: Line[], start: number): string[] {
  const out = [lines[start]!.text]
  let i = start + 1
  while (
    i < lines.length &&
    lines[i]!.text.trim() !== '' &&
    (lines[i]!.inFence || (!ANY_HEADING.test(lines[i]!.text) && !LIST_ITEM.test(lines[i]!.text)))
  ) {
    out.push(lines[i]!.text)
    i++
  }
  return out
}

const normalizeField = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '')

/** The ranked severity token inside a severity cell that may carry qualifiers. */
function severityOf(cell: string): Severity {
  const lower = cell.toLowerCase()
  if (lower.includes('blocking')) return 'blocking'
  if (lower.includes('major')) return 'major'
  if (lower.includes('minor')) return 'minor'
  return 'unknown'
}

const hasSeverityToken = (s: string) => severityOf(s) !== 'unknown'

/** Split a finding heading's remainder into its severity cell and title. */
function splitRemainder(remainder: string, parenthesized: string | undefined): { severityText: string; title: string } {
  // `### F1 (blocking) — <title>` — the parenthetical is the severity cell.
  if (parenthesized !== undefined && hasSeverityToken(parenthesized)) {
    return { severityText: parenthesized.trim(), title: remainder.trim() }
  }
  // `### F1 — <severity> — <title>` — the contract shape.
  const dash = remainder.indexOf('—')
  if (dash !== -1) {
    const head = remainder.slice(0, dash).trim()
    if (hasSeverityToken(head)) return { severityText: head, title: remainder.slice(dash + 1).trim() }
  }
  // A heading that names no severity is not malformed enough to drop: keep the
  // whole remainder as the title and let the severity read as unknown.
  return { severityText: parenthesized?.trim() ?? '', title: remainder.trim() }
}

/**
 * Parse one review report. Absent or off-grammar input degrades to fewer
 * findings and rounds, never an error — a report the parser cannot read still
 * renders as its own markdown at the layer above.
 */
export function parseReview(path: string, content: string): ReviewReport {
  const lines = toLines(content)
  const header = lines.find((l) => !l.inFence && HEADER.test(l.text))
  // Appended rounds may restate the header with a round suffix; the id is the
  // part before it (matching the orchestrator's long-standing reading).
  const task = header ? HEADER.exec(header.text)![1]!.split('—')[0]!.trim() : null

  const rounds: ReviewRound[] = []
  const findings: ReviewFinding[] = []
  const dispositions: ReviewDisposition[] = []
  const byId = new Map<string, ReviewFinding>()

  // A round begins at each Verdict line. Anything before the first one is a
  // preamble whose findings carry no round number.
  let round: ReviewRound | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.inFence) continue

    const verdict = VERDICT_LINE.exec(line.text)
    if (verdict) {
      const value = verdict[1]!.toLowerCase()
      round = {
        round: null,
        verdict: (VERDICTS as readonly string[]).includes(value) ? (value as Verdict) : null,
        diff: null,
        line: line.n,
      }
      rounds.push(round)
      continue
    }
    if (round) {
      const n = ROUND_LINE.exec(line.text)
      if (n && round.round === null) {
        round.round = Number(n[1])
        continue
      }
      const d = DIFF_LINE.exec(line.text)
      if (d && round.diff === null) {
        round.diff = d[1]!
        continue
      }
    }

    const resolution = RESOLUTION.exec(line.text)
    if (resolution) {
      const entry: ReviewDisposition = {
        id: resolution[1]!,
        state: resolution[2]!.toLowerCase() as 'resolved' | 'stands',
        round: round?.round ?? null,
        text: itemFrom(lines, i).join('\n').trim(),
        line: line.n,
      }
      dispositions.push(entry)
      const target = byId.get(entry.id)
      if (target) target.resolution = { state: entry.state, round: entry.round, text: entry.text, line: entry.line }
      continue
    }

    const heading = FINDING_HEADING.exec(line.text)
    if (!heading) continue
    const id = heading[1]!
    // A later round restating a finding heading does not mint a second
    // finding — the first raising is the one the record carries.
    if (byId.has(id)) continue

    const { severityText, title } = splitRemainder(heading[3] ?? '', heading[2])
    const block = blockFrom(lines, i)
    const fields: Record<string, string> = {}
    for (let j = i + 1; j < i + block.split('\n').length; j++) {
      if (lines[j]!.inFence) continue
      const field = FIELD.exec(lines[j]!.text)
      if (!field) continue
      const body = itemFrom(lines, j)
      body[0] = field[2]!
      fields[normalizeField(field[1]!)] = body.map((t) => t.trim()).join(' ').trim()
    }

    const finding: ReviewFinding = {
      id,
      severity: severityOf(severityText),
      severityText,
      plausible: /plausible/i.test(severityText) || /plausible/i.test(title),
      title,
      where: fields.where ?? null,
      failureScenario: fields.failurescenario ?? null,
      requirement: fields.requirement ?? null,
      round: round?.round ?? null,
      line: line.n,
      block,
      resolution: null,
    }
    findings.push(finding)
    byId.set(id, finding)
  }

  return {
    path,
    task,
    rounds,
    findings,
    dispositions,
    verdict: rounds.at(-1)?.verdict ?? null,
    escalation: extractEscalation(content),
  }
}

/** Findings ordered as the contract ranks them: blocking first, then by id. */
export function bySeverity(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(a.id.slice(1)) - Number(b.id.slice(1)),
  )
}

/** Findings a later round has not closed — what is still open at the gate. */
export function standing(findings: ReviewFinding[]): ReviewFinding[] {
  return findings.filter((f) => f.resolution?.state !== 'resolved')
}

// --- The Escalation section (#405) -----------------------------------------
//
// Before this, an `escalate` verdict had no home for its reason. The
// reviewer's contract fixed the verdict word and said "say so plainly"; the
// verifier's said "name the condition in Gaps". Each escalation then landed
// wherever its author chose — an improvised bold paragraph above Findings, a
// bullet in Gaps — and nothing could put it on the card. The engine's own
// record carried one line: `reviewer escalated task <id> — see review-NN.md`.
//
// Both report contracts now require a `## Escalation` section exactly when
// the verdict in force is `escalate` (validate.ts enforces the `REQUIRED
// WHEN:` line). Its grammar: bold-label fields — `**Diff verdict:**` (review
// only), `**Traces to:**`, `**Outside every remaining surface:**` (review),
// `**Criteria affected:**` (verification) — a prose paragraph, and a bulleted
// list of options. The reader lives here rather than in its own file because
// this file is the browser-safe leaf, and the verification report shares the
// same section shape.
//
// Presence, not verdicts: the section is lifted out verbatim and its fields
// named; nothing ranks the options or recommends a route. A report with more
// than one Escalation section (a round that escalated again) yields the last —
// the one in force, the reading rounds get above.

export interface EscalationSection {
  /** The section body, verbatim, without its heading line. */
  body: string
  /**
   * `**Diff verdict:**` value, lower-cased, when it is one of the two words the
   * review contract allows. Null on a verification report, or when absent or
   * off-grammar — the value as written is still in `fields`.
   */
  diffVerdict: 'approve' | 'request-changes' | null
  /** `**Traces to:**` value, verbatim. */
  tracesTo: string | null
  /** Every bold-label field in the section, keyed by label as written, values verbatim. */
  fields: Record<string, string>
  /** The prose outside the fields and the options, verbatim, trimmed. */
  prose: string
  /** The bulleted options, one per list item, verbatim, continuation lines joined. */
  options: string[]
  /** 1-based line of the section heading. */
  line: number
}

const ESCALATION_HEADING = /^##\s+Escalation\s*#*\s*$/i
const H1_OR_H2 = /^#{1,2}\s/
const SECTION_FIELD = /^\*\*([^*]+?):\*\*\s*(.*)$/
const OPTION_ITEM = /^\s*[-*]\s+(.*\S)\s*$/
const OPTION_CONTINUATION = /^\s{2,}(\S.*)$/

/** The last `## Escalation` section of a report, or null when there is none. */
export function extractEscalation(markdown: string): EscalationSection | null {
  const lines = toLines(markdown)
  let start = -1
  for (const l of lines) if (!l.inFence && ESCALATION_HEADING.test(l.text)) start = l.n - 1
  if (start < 0) return null
  // The section runs to the next H1 or H2 outside a fence — an H1 opens a
  // section too, so a round appended after it never reads as part of it.
  let end = start + 1
  while (end < lines.length && (lines[end]!.inFence || !H1_OR_H2.test(lines[end]!.text))) end++
  const bodyLines = lines.slice(start + 1, end).map((l) => l.text)

  const fields: Record<string, string> = {}
  const proseLines: string[] = []
  const options: string[] = []
  let inList = false
  for (const raw of bodyLines) {
    const field = SECTION_FIELD.exec(raw.trim())
    if (field && !inList) {
      if (!(field[1]! in fields)) fields[field[1]!] = field[2]!.trim()
      continue
    }
    const item = OPTION_ITEM.exec(raw)
    if (item) {
      options.push(item[1]!)
      inList = true
      continue
    }
    const cont = OPTION_CONTINUATION.exec(raw)
    if (inList && cont && options.length > 0) {
      options[options.length - 1] = `${options[options.length - 1]} ${cont[1]}`
      continue
    }
    if (raw.trim() === '') inList = false
    if (!inList) proseLines.push(raw)
  }

  const dv = fields['Diff verdict']?.trim().toLowerCase() ?? null
  return {
    body: bodyLines.join('\n').trim(),
    diffVerdict: dv === 'approve' || dv === 'request-changes' ? dv : null,
    tracesTo: fields['Traces to'] ?? null,
    fields,
    // The list's lead-in sentence ("The options as I see them:") is prose
    // too; keeping it is the verbatim reading.
    prose: proseLines.join('\n').trim(),
    options,
    line: start + 1,
  }
}
