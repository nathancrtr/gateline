// The escalation packet (#407): what the escalating role wrote, paired with
// the record that says an escalation is open.
//
// An escalation is two facts in two places. `state.escalations[i]` is the
// engine's record that the run is paused for a human, with one `reason`
// line. For a role-originated escalation that line is a pointer —
// `reviewer escalated task 04-fixture-label — see review-04.md` — and the
// decision itself is in the report the pointer names, in the `## Escalation`
// section #405 gave it. The card rendered the pointer and a chip, and the
// human chose a route before seeing what was asked.
//
// This module joins the two. It reads who escalated and about what from the
// reason line — not from `from_role`, which names the writer (the engine)
// rather than the asker — finds the report the line names, and lifts its
// Escalation section out for the card. An engine-originated escalation (a
// round cap, a bounce cap, a landing cap, a missing phase) has no report
// behind it: the reason is the whole packet, and the card already shows it.
//
// Presence, not verdicts. Nothing here recommends a route, ranks the options,
// or restates the section in its own words. A report that predates #405, or
// is off its grammar, withholds the packet and says which grammar it looked
// for; the reason line and the chip stay.
import type { Escalation } from '../record/schema.ts'
import { verdictLines } from '../record/validate.ts'
import { type EscalationSection, extractEscalation, type ReviewReport, standing } from './review.ts'
import { type WithheldReason, withheldIn } from './withheld.ts'

export interface EscalationOrigin {
  /** The role the reason line names as the escalator, or `from_role`, or null. */
  role: string | null
  /** The task the reason line names (`escalated task <id>`), or null. */
  task: string | null
  /** The report the reason line names (`see <path>`), or the verifier's report when the role is the verifier, or null. */
  artifact: string | null
}

export interface EscalationPacket {
  /** Index into `state.escalations`. */
  index: number
  /** The engine's `reason`, verbatim. */
  reason: string
  /** The record's `from_role`, verbatim — who wrote the entry. */
  fromRole: string | null
  /** Who escalated, per the reason line. */
  role: string | null
  task: string | null
  /** The report the packet reads, when the reason names one and the record has it. */
  artifact: string | null
  /** `role` when a report is behind this escalation; `engine` when the reason is the whole packet. */
  origin: 'role' | 'engine'
  /** The report's Escalation section, verbatim and parsed, or null. */
  section: EscalationSection | null
  /** The report's verdict in force, verbatim word, or null. */
  reportVerdict: string | null
  /** Standing findings in the review, or null when the report is not a review. */
  standingFindings: number | null
  /** Why the section view must withhold itself, or null — looked for in the report (#424). */
  withheld: WithheldReason | null
}

const ESCALATED_BY = /^(\S+)\s+escalated\b/i
const TASK = /\bescalated task\s+(\S+)/i
const SEE = /\bsee\s+(\S+?\.md)\b/i

/** Who escalated, about what, and where — read from the reason line. */
export function describeEscalation(reason: string, fromRole: string | null, artifacts: readonly string[]): EscalationOrigin {
  const by = ESCALATED_BY.exec(reason)?.[1]?.toLowerCase() ?? null
  const role = by ?? (fromRole && fromRole !== 'orchestrator' ? fromRole : null)
  const task = TASK.exec(reason)?.[1] ?? null
  const named = SEE.exec(reason)?.[1] ?? null
  let artifact: string | null = null
  if (named && artifacts.includes(named)) artifact = named
  else if (role === 'verifier' && artifacts.includes('verification-report.md')) artifact = 'verification-report.md'
  return { role, task, artifact }
}

/**
 * Compose the packet for one escalation from the run's own artifacts. The
 * verification report arrives as text because no typed parse of it carries
 * the section; the reviews arrive parsed because `parseReview` already does.
 */
export function buildEscalationPacket(input: {
  index: number
  escalation: Escalation
  artifacts: readonly string[]
  reviews: readonly ReviewReport[]
  verification: string | null
}): EscalationPacket {
  const { role, task, artifact } = describeEscalation(input.escalation.reason, input.escalation.from_role, input.artifacts)
  const base = {
    index: input.index,
    reason: input.escalation.reason,
    fromRole: input.escalation.from_role,
    role,
    task,
    artifact,
  }
  if (artifact === null) {
    return { ...base, origin: 'engine', section: null, reportVerdict: null, standingFindings: null, withheld: null }
  }

  let section: EscalationSection | null = null
  let reportVerdict: string | null = null
  let standingFindings: number | null = null
  if (artifact === 'verification-report.md') {
    if (input.verification !== null) {
      section = extractEscalation(input.verification)
      reportVerdict = verdictLines(input.verification).at(-1)?.trim().split(/\s+/)[0]?.toLowerCase() ?? null
    }
  } else {
    const review = input.reviews.find((r) => r.path === artifact)
    if (review) {
      section = review.escalation
      reportVerdict = review.verdict
      standingFindings = standing(review.findings).length
    }
  }
  // A report that predates the section, or one off its grammar: the contracts
  // require the section under an escalate verdict, and the report is one click
  // away from the withheld view.
  const withheld = section === null ? withheldIn({ grammar: 'a section headed', token: '## Escalation' }, artifact) : null
  return { ...base, origin: 'role', section, reportVerdict, standingFindings, withheld }
}
