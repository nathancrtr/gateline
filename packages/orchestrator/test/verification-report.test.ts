// The verifier's verdict line as the orchestrator reads it (#152): exactly
// one word, the last line in force, fences ignored — and never the first word
// of a sentence that merely begins with one.
import { describe, expect, it } from 'vitest'
import { parseVerificationReport } from '../src/verification-report.ts'

const report = (lines: string) => `# Verification Report: run\n\n${lines}\n\n## Results\n`

describe('parseVerificationReport', () => {
  it('reads each of the three words, case-insensitively', () => {
    for (const w of ['pass', 'Fail', 'ESCALATE']) expect(parseVerificationReport(report(`**Verdict:** ${w}`), 1).verdict).toBe(w.toLowerCase())
  })

  it('a line that only begins with a verdict word is unrecognized, not fail-open', () => {
    expect(parseVerificationReport(report('**Verdict:** fail — escalating AC3.2 to the human'), 1)).toMatchObject({ verdict: null, raw: 'fail — escalating AC3.2 to the human' })
    expect(parseVerificationReport(report('**Verdict:** pass | fail | escalate'), 1).verdict).toBeNull()
  })

  it('the last line governs: a re-verification appended with pass supersedes escalate', () => {
    expect(parseVerificationReport(report('**Verdict:** escalate\n\n# Re-verification\n**Verdict:** pass'), 1).verdict).toBe('pass')
  })

  it('ignores a verdict line inside a fence, and reports null with no raw when the report has none', () => {
    expect(parseVerificationReport(report('```\n**Verdict:** escalate\n```'), 1)).toEqual({ verdict: null, raw: null, lastTouched: 1 })
  })
})
