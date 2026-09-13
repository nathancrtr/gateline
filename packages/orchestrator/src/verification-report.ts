// The verifier's escalation channel (#152). The reviewer had one — a verdict
// line the orchestrator reads (D17) — and the verifier had only prose: a
// report could fail two criteria and write "escalating both to the human" in
// Gaps, and D10 would arm G2 as a plain approval item, indistinguishable from
// a clean pass. The contract now carries one overall `**Verdict:**` line, and
// this reads it through the same parser Gatehouse quotes it with. The word
// must be exactly one of the three: "fail — escalating AC3.2" is not `fail`,
// it is a deviation, and validation bounces it. Reports that predate the line
// parse as `null` and behave as they always did.
import { type VerificationVerdict, verdictLines, verificationVerdict } from '@gateline/core/record'

export interface VerificationInfo {
  /** The overall verdict in force (the last line's), or null when absent or unrecognized. */
  verdict: VerificationVerdict | null
  /** The last verdict line's text as written, or null when the report carries none. */
  raw: string | null
  /** Commit epoch seconds when the report last changed, or null. */
  lastTouched: number | null
}

export function parseVerificationReport(content: string, lastTouched: number | null): VerificationInfo {
  const raw = verdictLines(content).at(-1) ?? null
  return { verdict: verificationVerdict(raw), raw, lastTouched }
}
