// Typed parsing of review-report artifacts (#214): rounds, verdicts, findings,
// and cross-round resolution state, extracted verbatim from a run's own
// review-NN.md. Grammar per contracts/review-report.md, but written against the
// real committed artifacts under runs/ — which vary far more than the contract
// alone suggests (see the survey notes on each regex below). This module is a
// browser-safe leaf — zero imports, enforced by review-report.test.ts — so
// hosts can serve a parsed report as plain data to clients that must not
// bundle the core runtime (see web/src/api.ts). Derived at read time, never
// stored; every field is a slice of the committed artifact, never a
// paraphrase. Malformed or unrecognized input degrades to `null` so the
// caller falls back to today's prose rendering — this parser never throws.

export type Verdict = 'approve' | 'request-changes' | 'escalate' | 'unknown'

export interface ReviewRound {
  /** Round number as declared by the round's own `**Round:**` field, or (when
   * that field is absent) inferred from a `Round <n>` heading token. */
  round: number
  /** The 'of <m>' half of the round field, when present. */
  of?: number
  /** Verbatim text after `**Verdict:**`, trimmed — may carry parentheticals
   * ('approve (round 2; round 1 verdict: escalate — preserved below)'). */
  verdictText: string
  /** The recognized verdict token the text leads with, or 'unknown' when it
   * doesn't parse to one of the three grammar values. */
  verdict: Verdict
  /** Verbatim text after `**Diff reviewed:**`, trimmed. */
  diffReviewed?: string
  /** 1-based line where this round's segment starts. */
  line: number
}

export type FindingSeverity = 'blocking' | 'major' | 'minor' | 'unknown'

export interface FindingResolution {
  /** Round whose text carried this resolution statement. */
  round: number
  /** true only on a confident, negation-aware "resolved" match. Anything
   * else — including a plain substring hit inside a negated or unrelated
   * phrase — is false, per the "bias toward still open" rule: a false
   * "resolved" is a correctness bug, a false "open" is only mild noise. */
  resolved: boolean
  /** Verbatim resolution text (the bullet or heading block), unfolded. */
  text: string
  /** 1-based line. */
  line: number
}

export interface ReviewFinding {
  /** 'F1', 'F12', ... */
  id: string
  /** Round the finding was first declared in. */
  round: number
  /** Normalized severity token, for sorting/filtering. */
  severity: FindingSeverity
  /** Verbatim severity field, qualifier included ('minor (PLAUSIBLE)',
   * 'blocking (escalation driver)'). */
  severityText: string
  /** Verbatim one-line defect description (the heading's tail). */
  title: string
  /** Verbatim finding heading line. */
  heading: string
  /** Verbatim '**Where:**' field body, continuation lines joined. */
  where?: string
  /** Verbatim '**Failure scenario:**' field body. */
  failureScenario?: string
  /** Verbatim '**Requirement:**' field body. */
  requirement?: string
  /** Verbatim finding block: the heading through its fields, as committed. */
  definition: string
  /** 1-based line where the finding heading starts. */
  line: number
  /** Resolution statements found in later text, in document order. Empty
   * when the finding is never mentioned again. */
  resolutions: FindingResolution[]
  /** The current disposition: the last resolution's `resolved` value, or
   * false when there is none — a finding is never resolved by default. */
  resolved: boolean
}

export interface ReviewReport {
  /** Rounds in document order (which is always round-ascending in practice). */
  rounds: ReviewRound[]
  /** Findings ordered severity-first (blocking, major, minor, unknown),
   * stable within a severity by original document order. */
  findings: ReviewFinding[]
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

const ANY_HEADING = /^#{1,6}\s/
const FENCE = /^\s*(```|~~~)/

// Round metadata. Reliable across the whole survey (46 of 47 real artifacts
// carry it once per round; the one holdout still parses, just with fewer
// segments — see review-report.test.ts).
const ROUND_FIELD = /^\*\*Round:\*\*\s*(\d+)(?:\s+of\s+(\d+))?/i
const VERDICT_FIELD = /^\*\*Verdict:\*\*\s*(.+?)\s*$/i
const DIFF_FIELD = /^\*\*Diff reviewed:\*\*\s*(.+?)\s*$/i

// Round headers are NOT uniform (survey: '# Round 2', '# Round 2 (of 3)',
// '## Round 2 — 2026-07-21', '## Round 2 (verify)', a title suffix
// '# Review Report: <task> — Round 2'). Anchor on the 'Round <n>' token
// (space-delimited) at heading level, not a fixed level or exact string.
// Space-delimited is deliberate: subsection headings that discuss an earlier
// round use a hyphen instead ('## Round-1 findings status', '### Round-2
// coverage') and must NOT be read as a new round's start.
const HEADING_ROUND = /^#{1,6}\s.*\bRound\s+(\d+)\b(?:\s*\(of\s+(\d+)\))?/

// A freshly declared finding: '### F<n> — <severity>[ (qualifier)] — <title>'.
// The severity/qualifier segment can itself contain a parenthetical with its
// own em dash ('blocking (repo integrity / process — NOT a defect …)'), so
// the split into severity-text vs. title happens separately, dash-depth-aware
// (splitTopLevelDash), not inside this regex.
const FINDING_HEADING = /^#{2,6}\s*F(\d+)\s+—\s+(.+?)\s*$/
const SEVERITY_WORD = /^(blocking|major|minor)\b/i

// A finding restated as a heading in a later round, carrying its
// disposition directly: '### F<n> (<severity>[, ...]) — RESOLVED' / 'NOT
// RESOLVED' / 'STANDS, deferred as dispositioned'. Distinguished from
// FINDING_HEADING by the parenthetical sitting directly against the id (no
// dash before it) — real fresh-finding headings never do that in the survey.
const RESOLUTION_HEADING = /^#{2,6}\s*F(\d+)\s*\(([^)]*)\)\s*—\s*(.+?)\s*$/

// A resolution bullet, one or more ids: '- **F1 — resolved.**',
// '- **F1 (blocking) — RESOLVED.**', '- **F3, F4, F5, F6 — still open, …**',
// '- **F4 resolved** — …', '- **F1 (blocking)** — **resolved.**' (second
// bold span; see RESOLUTION_BULLET_TAIL below for that last shape).
const RESOLUTION_BULLET = /^[-*]\s*\*\*(F\d+(?:\s*,\s*F\d+)*)\s*(?:\(([^)]*)\))?\s*[-—]?\s*([^*\n]*)\*\*/
const RESOLUTION_BULLET_TAIL = /^\s*[-—]\s*\*\*([^*\n]*)\*\*/
const FINDING_ID = /F\d+/g

// Confident, negation-aware "resolved" classification. Biased toward "still
// open": a false "resolved" is a correctness bug, a false "open" is only
// mild noise (task #214). 'unresolved' never matches RESOLVED_WORD — \b
// requires a boundary before 'resolved', which the leading 'un' denies.
const RESOLVED_WORD = /\bresolved\b/i
const NEGATED_RESOLVED = /\b(?:not|never)\b[^.\n]{0,40}\bresolved\b/i

function classifyResolved(text: string): boolean {
  return RESOLVED_WORD.test(text) && !NEGATED_RESOLVED.test(text)
}

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

/** The block from `start` up to (not including) the next heading outside a
 * fence, or `end` — trailing blank lines trimmed. Verbatim — no reflow. */
function blockFrom(lines: Line[], start: number, end: number): string {
  let stop = start + 1
  while (stop < end && (lines[stop]!.inFence || !ANY_HEADING.test(lines[stop]!.text))) stop++
  while (stop > start + 1 && lines[stop - 1]!.text.trim() === '') stop--
  return lines
    .slice(start, stop)
    .map((l) => l.text)
    .join('\n')
}

/** A list item plus its wrapped continuation lines: ends at a blank line, a
 * heading, the next top-level list item, or `end`. */
function itemFrom(lines: Line[], start: number, end: number): string {
  let stop = start + 1
  while (
    stop < end &&
    lines[stop]!.text.trim() !== '' &&
    (lines[stop]!.inFence || (!ANY_HEADING.test(lines[stop]!.text) && !/^\s*[-*]\s/.test(lines[stop]!.text)))
  )
    stop++
  return lines
    .slice(start, stop)
    .map((l) => l.text)
    .join('\n')
}

/** First heading index after `start`, outside a fence, capped at `end`. */
function nextHeadingIndex(lines: Line[], start: number, end: number): number {
  let i = start + 1
  while (i < end && (lines[i]!.inFence || !ANY_HEADING.test(lines[i]!.text))) i++
  return i
}

/** Split on the first em dash at parenthesis-depth 0 — so a qualifier's own
 * internal em dash ('(repo integrity / process — NOT a defect …)') is not
 * mistaken for the severity/title boundary. */
function splitTopLevelDash(text: string): [string, string] | null {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === '—' && depth === 0) return [text.slice(0, i).trim(), text.slice(i + 1).trim()]
  }
  return null
}

/** A finding field's verbatim value ('Where', 'Failure scenario',
 * 'Requirement'), continuation lines joined into one sentence. Tolerates the
 * label variants seen in the wild ('Where fixed', 'Failure scenario
 * (PLAUSIBLE)') without matching unrelated labels ('Requirement coverage'
 * belongs to a Coverage bullet, not a finding field). */
function fieldValue(lines: Line[], start: number, end: number, label: string): string | undefined {
  const re = new RegExp(`^-\\s*\\*\\*${label}(?:\\s+\\w+)?\\s*(?:\\([^)]*\\))?:?\\*\\*\\s*(.*)$`, 'i')
  for (let i = start + 1; i < end; i++) {
    if (lines[i]!.inFence) continue
    const m = re.exec(lines[i]!.text)
    if (!m) continue
    const item = itemFrom(lines, i, end)
    const rest = item
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
    const value = [m[1]!.trim(), ...rest].join(' ').trim()
    return value || undefined
  }
  return undefined
}

interface RoundGroup {
  /** 0-based line index where the round's segment starts. */
  line: number
  round: number
  of?: number
}

/** The grammar orders `**Verdict:**` immediately before `**Round:**`
 * (contracts/review-report.md). When a round's boundary is anchored on the
 * Round field itself (no heading precedes it — true of every implicit
 * round 1, which has no header at all), back up over a directly preceding
 * Verdict line so the segment's own verdict is not left outside its range. */
function backUpToVerdict(lines: Line[], i: number): number {
  let start = i
  for (let j = i - 1; j >= 0 && i - j <= 2; j--) {
    if (lines[j]!.inFence) continue
    if (VERDICT_FIELD.test(lines[j]!.text)) {
      start = j
      break
    }
    if (lines[j]!.text.trim() === '') continue
    break
  }
  return start
}

/** Round-segment boundaries: primarily the round's own `**Round:**` field
 * (uniform across the survey), with a heading-token fallback merged in when
 * within a few lines of it (or standing alone, for the one artifact whose
 * round-2 segment carries no field at all). */
function findRoundGroups(lines: Line[]): RoundGroup[] {
  const raw: (RoundGroup & { fromField: boolean })[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.inFence) continue
    const rf = ROUND_FIELD.exec(line.text)
    if (rf) {
      raw.push({
        line: backUpToVerdict(lines, i),
        round: Number(rf[1]),
        of: rf[2] ? Number(rf[2]) : undefined,
        fromField: true,
      })
      continue
    }
    const hr = HEADING_ROUND.exec(line.text)
    if (hr) raw.push({ line: i, round: Number(hr[1]), of: hr[2] ? Number(hr[2]) : undefined, fromField: false })
  }
  if (raw.length === 0) return []

  const WINDOW = 6
  const merged: (RoundGroup & { fromField: boolean })[] = []
  for (const b of raw) {
    const last = merged[merged.length - 1]
    if (last && b.line - last.line <= WINDOW) {
      if (b.fromField && !last.fromField) {
        last.round = b.round
        last.fromField = true
      }
      if (last.of === undefined && b.of !== undefined) last.of = b.of
      continue
    }
    merged.push({ ...b })
  }
  return merged.map(({ line, round, of }) => ({ line, round, of }))
}

/** Record a resolution for each id a resolution line names — a single
 * bullet can carry several ('F3, F4, F5, F6 — still open, …'). */
function recordResolutions(
  out: Map<string, FindingResolution[]>,
  ids: string[],
  round: number,
  status: string,
  text: string,
  line: number,
): void {
  const resolved = classifyResolved(status)
  for (const id of ids) {
    const list = out.get(id)
    const entry: FindingResolution = { round, resolved, text, line }
    if (list) list.push(entry)
    else out.set(id, [entry])
  }
}

function scanResolutions(lines: Line[], start: number, end: number, round: number, out: Map<string, FindingResolution[]>): void {
  for (let i = start; i < end; i++) {
    const line = lines[i]!
    if (line.inFence) continue

    const rh = RESOLUTION_HEADING.exec(line.text)
    if (rh) {
      const status = rh[3]!.trim()
      const blockEnd = nextHeadingIndex(lines, i, end)
      recordResolutions(out, [`F${rh[1]}`], round, status, blockFrom(lines, i, blockEnd), i + 1)
      continue
    }

    const rb = RESOLUTION_BULLET.exec(line.text)
    if (!rb) continue
    const ids = rb[1]!.match(FINDING_ID) ?? []
    if (ids.length === 0) continue
    let status = (rb[3] ?? '').trim()
    if (!status) {
      const tail = RESOLUTION_BULLET_TAIL.exec(line.text.slice(rb[0].length))
      if (tail) status = tail[1]!.trim()
    }
    recordResolutions(out, ids, round, status, itemFrom(lines, i, end), i + 1)
  }
}

/** Parse a review-report artifact's full text into rounds, verdicts, and
 * findings (with cross-round resolution state). Every field is a verbatim
 * slice of `text`. Returns `null` when the text doesn't carry at least one
 * recognizable round — the caller falls back to prose rendering. Never
 * throws. */
export function buildReviewReport(text: string | null | undefined): ReviewReport | null {
  try {
    if (!text) return null
    const lines = toLines(text)
    const groups = findRoundGroups(lines)
    if (groups.length === 0) return null

    const rounds: ReviewRound[] = []
    const findingsById = new Map<string, ReviewFinding>()
    const findingsOrder: ReviewFinding[] = []
    const resolutionsById = new Map<string, FindingResolution[]>()

    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!
      const segStart = group.line
      const segEnd = gi + 1 < groups.length ? groups[gi + 1]!.line : lines.length

      let verdictText = ''
      let verdict: Verdict = 'unknown'
      let diffReviewed: string | undefined
      for (let i = segStart; i < segEnd; i++) {
        if (lines[i]!.inFence) continue
        if (!verdictText) {
          const vm = VERDICT_FIELD.exec(lines[i]!.text)
          if (vm) {
            verdictText = vm[1]!.trim()
            const vt = /^(approve|request-changes|escalate)\b/i.exec(verdictText)
            verdict = vt ? (vt[1]!.toLowerCase() as Verdict) : 'unknown'
          }
        }
        if (diffReviewed === undefined) {
          const dm = DIFF_FIELD.exec(lines[i]!.text)
          if (dm) diffReviewed = dm[1]!.trim()
        }
      }
      rounds.push({ round: group.round, of: group.of, verdictText, verdict, diffReviewed, line: segStart + 1 })

      for (let i = segStart; i < segEnd; i++) {
        if (lines[i]!.inFence) continue
        const fm = FINDING_HEADING.exec(lines[i]!.text)
        if (!fm) continue
        const split = splitTopLevelDash(fm[2]!)
        const severityText = (split ? split[0] : fm[2]!).trim()
        const title = (split ? split[1] : '').trim()
        const sev = SEVERITY_WORD.exec(severityText)
        if (!sev) continue
        const id = `F${fm[1]}`
        if (findingsById.has(id)) continue
        const blockEnd = nextHeadingIndex(lines, i, segEnd)
        const finding: ReviewFinding = {
          id,
          round: group.round,
          severity: sev[1]!.toLowerCase() as FindingSeverity,
          severityText,
          title,
          heading: lines[i]!.text.trim(),
          where: fieldValue(lines, i, blockEnd, 'Where'),
          failureScenario: fieldValue(lines, i, blockEnd, 'Failure scenario'),
          requirement: fieldValue(lines, i, blockEnd, 'Requirement'),
          definition: blockFrom(lines, i, blockEnd),
          line: i + 1,
          resolutions: [],
          resolved: false,
        }
        findingsById.set(id, finding)
        findingsOrder.push(finding)
      }

      scanResolutions(lines, segStart, segEnd, group.round, resolutionsById)
    }

    for (const finding of findingsOrder) {
      const resolutions = resolutionsById.get(finding.id) ?? []
      finding.resolutions = resolutions
      finding.resolved = resolutions.length > 0 ? resolutions[resolutions.length - 1]!.resolved : false
    }

    findingsOrder.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])

    return { rounds, findings: findingsOrder }
  } catch {
    return null
  }
}
