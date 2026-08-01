// The round-cap comparison (#257): what did not converge across the last two
// review rounds.
//
// A round cap asks one narrow question — three rounds, still not converged, so
// which finding keeps coming back? DESIGN.md §4 says the answer is usually a
// spec ambiguity rather than an implementation defect, and that is a claim a
// human can only test by holding two rounds side by side. The card used to
// offer five filename chips into a one-at-a-time reader, which made it a memory
// exercise.
//
// Two rules bound what this may say, both inherited from #261:
//
//   * Verbatim and reachable. This groups, orders and badges findings; every
//     word rendered from them comes byte-identical out of the committed report,
//     and the reports stay one click away in full.
//   * Presence, not verdicts. A finding the later round did not mention is
//     reported as not mentioned — never as resolved. Only a disposition line
//     the reviewer actually wrote closes a finding, and the group headings say
//     what the record shows rather than scoring convergence.
//
// Both report shapes are read. `roles/reviewer.md` directs the reviewer to
// append each round to one file, and a run may instead keep a file per round;
// findings are matched by `F<n>` and rounds by their `**Round:**` number, so
// either shape compares the same way.
//
// Pure and type-only by design, like landing.ts and spine.ts.
import type { ReviewFinding, ReviewReport, Severity, Verdict } from './api.ts'

const SEVERITY_RANK: Record<Severity, number> = { blocking: 0, major: 1, minor: 2, unknown: 3 }

/** What the later round did about a finding — a fact about the record, not a judgment. */
export type RoundNote = 'raised again' | 'marked stands' | 'not mentioned' | 'new' | 'marked resolved'

export interface RoundFinding {
  /** The most recent raising of this id, verbatim from the record. */
  finding: ReviewFinding
  /** The artifact the shown raising came from. */
  path: string
  /** Every round that raised this id, ascending. */
  raisedIn: number[]
  note: RoundNote
  /** The disposition text a reviewer wrote about it, verbatim; null when none. */
  disposition: string | null
}

export interface RoundSide {
  round: number
  /** Artifacts carrying this round — one file per round, or one file carrying all of them. */
  paths: string[]
  verdict: Verdict | null
}

export interface RoundDelta {
  ok: true
  earlier: RoundSide
  later: RoundSide
  /** Open in both rounds — what did not converge. Severity-ranked. */
  standing: RoundFinding[]
  /** First raised in the later round. */
  fresh: RoundFinding[]
  /** Closed by a disposition written in the compared window. */
  resolved: RoundFinding[]
}

export interface RoundWithheld {
  ok: false
  /** Why no comparison is offered, in plain words, for the panel to show. */
  reason: string
}

export type RoundComparison = RoundDelta | RoundWithheld

interface Group {
  id: string
  raisings: { finding: ReviewFinding; path: string; round: number | null }[]
  disposition: { state: 'resolved' | 'stands'; round: number | null; text: string } | null
}

/**
 * The reports that belong to one task. A report naming no task is kept — it may
 * be the only one there is — and a task no report names falls back to all of
 * them rather than to nothing: a run's reviews are the run's reviews, and an
 * unmatched task id is a reason to show more, not less.
 */
export function reportsForTask(reports: ReviewReport[], task: string | null): ReviewReport[] {
  if (task === null) return reports
  const owned = reports.filter((r) => r.task === task || r.task === null)
  return owned.length > 0 ? owned : reports
}

/** Every numbered round across the reports, ascending. */
function roundNumbers(reports: ReviewReport[]): number[] {
  const seen = new Set<number>()
  for (const report of reports) {
    for (const round of report.rounds) if (round.round !== null) seen.add(round.round)
    // A round that numbered itself only in a disposition line still happened.
    for (const d of report.dispositions) if (d.round !== null) seen.add(d.round)
  }
  return [...seen].sort((a, b) => a - b)
}

function sideFor(reports: ReviewReport[], round: number): RoundSide {
  const paths: string[] = []
  let verdict: Verdict | null = null
  for (const report of reports) {
    const match = report.rounds.filter((r) => r.round === round)
    if (match.length === 0) continue
    paths.push(report.path)
    verdict = match[match.length - 1]!.verdict ?? verdict
  }
  return { round, paths, verdict }
}

/** Findings grouped by id across every report, with the latest disposition each carries. */
function groupById(reports: ReviewReport[]): Map<string, Group> {
  const groups = new Map<string, Group>()
  const group = (id: string): Group => {
    const existing = groups.get(id)
    if (existing) return existing
    const fresh: Group = { id, raisings: [], disposition: null }
    groups.set(id, fresh)
    return fresh
  }
  for (const report of reports) {
    for (const finding of report.findings) group(finding.id).raisings.push({ finding, path: report.path, round: finding.round })
    // Dispositions from every report, including ones naming a finding this file
    // did not raise — the file-per-round shape puts them there by construction.
    for (const d of report.dispositions) {
      const g = group(d.id)
      const later = g.disposition === null || (d.round ?? 0) >= (g.disposition.round ?? 0)
      if (later) g.disposition = { state: d.state, round: d.round, text: d.text }
    }
  }
  return groups
}

const rank = (a: RoundFinding, b: RoundFinding) =>
  SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] || Number(a.finding.id.slice(1)) - Number(b.finding.id.slice(1))

/**
 * The last two rounds of one task's review, compared.
 *
 * Withheld rather than guessed in two cases, each named for the panel: a record
 * that numbers fewer than two rounds has nothing to compare, and one whose
 * findings do not match the contract's heading grammar is a forked contract,
 * where the honest move is to stand down and let the reports speak.
 */
export function compareRounds(reports: ReviewReport[]): RoundComparison {
  const rounds = roundNumbers(reports)
  if (rounds.length < 2) {
    return {
      ok: false,
      reason:
        rounds.length === 0
          ? 'the reports number no rounds, so there are no two rounds to compare'
          : `the record carries one numbered round (round ${rounds[0]}), so there is nothing to compare it against`,
    }
  }
  const earlierRound = rounds[rounds.length - 2]!
  const laterRound = rounds[rounds.length - 1]!
  const groups = [...groupById(reports).values()].filter((g) => g.raisings.length > 0)
  if (groups.length === 0) {
    return { ok: false, reason: 'no findings in the record match the `### F<n> — <severity> — <title>` grammar' }
  }

  const standing: RoundFinding[] = []
  const fresh: RoundFinding[] = []
  const resolved: RoundFinding[] = []

  for (const group of groups) {
    const raisedIn = group.raisings.map((r) => r.round).filter((r): r is number => r !== null).sort((a, b) => a - b)
    // The latest raising is the wording in force; earlier ones stay in the
    // reports, which the panel links to.
    const shown = [...group.raisings].sort((a, b) => (a.round ?? 0) - (b.round ?? 0)).at(-1)!
    const first = raisedIn[0] ?? null
    const closed = group.disposition?.state === 'resolved'
    const closedInWindow = closed && (group.disposition!.round === null || group.disposition!.round >= earlierRound)
    const entry: RoundFinding = {
      finding: shown.finding,
      path: shown.path,
      raisedIn,
      note: 'not mentioned',
      disposition: group.disposition?.text ?? null,
    }

    if (closedInWindow) {
      resolved.push({ ...entry, note: 'marked resolved' })
      continue
    }
    // Closed before the window: already settled, and not part of this question.
    if (closed) continue

    if (first === laterRound) {
      fresh.push({ ...entry, note: 'new' })
      continue
    }
    if (first === null) {
      // A finding raised in a report that numbers no rounds still stands
      // against the later round; it just cannot say which round raised it.
      standing.push(entry)
      continue
    }
    const note: RoundNote = raisedIn.includes(laterRound)
      ? 'raised again'
      : group.disposition?.state === 'stands' && group.disposition.round === laterRound
        ? 'marked stands'
        : 'not mentioned'
    standing.push({ ...entry, note })
  }

  return {
    ok: true,
    earlier: sideFor(reports, earlierRound),
    later: sideFor(reports, laterRound),
    standing: standing.sort(rank),
    fresh: fresh.sort(rank),
    resolved: resolved.sort(rank),
  }
}
