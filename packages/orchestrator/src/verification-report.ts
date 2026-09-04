// The verifier's escalation channel (#152). The reviewer had one — a verdict
// line the orchestrator reads (D17) — and the verifier had only prose: a
// report could fail two criteria and write "escalating both to the human" in
// Gaps, and D10 would arm G2 as a plain approval item, indistinguishable from
// a clean pass. The contract now carries one overall `**Verdict:**` line, and
// this reads it. Reports that predate the line parse as `null` and behave as
// they always did.

export const VERIFICATION_VERDICTS = ['pass', 'fail', 'escalate'] as const
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number]

export interface VerificationInfo {
  /** The overall verdict, or null when the report carries no recognizable line. */
  verdict: VerificationVerdict | null
  /** Commit epoch seconds when the report last changed, or null. */
  lastTouched: number | null
}

export function parseVerificationReport(content: string, lastTouched: number | null): VerificationInfo {
  const m = /^\*{2}Verdict:\*{2}\s*([a-z]+)/im.exec(content)
  const v = m?.[1]!.toLowerCase()
  const verdict = v && (VERIFICATION_VERDICTS as readonly string[]).includes(v) ? (v as VerificationVerdict) : null
  return { verdict, lastTouched }
}
