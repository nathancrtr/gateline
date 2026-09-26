// The escalation packet (#407): the record's one-line reason joined with the
// report it names. What is under test is the join — who is read as the asker,
// which report is behind the line, when the packet is the engine's reason
// alone — and that a report without its section withholds rather than guesses.
import { describe, expect, it } from 'vitest'
import { buildEscalationPacket, describeEscalation, parseReview } from '../src/index.ts'

const artifacts = ['intent-brief.md', 'spec.md', 'plan.md', 'tasks/04-fixture-label.yaml', 'review-04.md', 'verification-report.md', 'state.yaml']

const REVIEW = `# Review Report: 04-fixture-label

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** eac2e95

## Escalation

**Diff verdict:** request-changes
**Traces to:** R3 / ADR-5
**Outside every remaining surface:** \`packages/web/src/pages/metrics.tsx\` — no remaining task names it

The third requirement says every page carries the label; the plan enumerated three surfaces and the demo ships a fourth.

The options as I see them:
- widen task 04's surface by the metrics page
- amend R3 to name the three surfaces in scope

## Findings

### F1 — major — the markup test cannot tell visible text from hover-only text
- **Where:** \`packages/web/test/fixture-label.test.ts:22\`
- **Failure scenario:** the text moves into a title attribute and 3/3 still pass
- **Requirement:** R3 / AC3.2

### F2 — minor — substring matches survive
- **Where:** \`packages/web/test/fixture-label.test.ts:15\`
- **Failure scenario:** includes() passes 3/3
- **Requirement:** R3 / AC3.1

## Coverage

Read the whole diff.

## Boundary check

Inside the surface.
`

const VERIFICATION = `# Verification Report: run

**Verdict:** escalate
**Change verified:** run branch tip

## Escalation

**Traces to:** R2 / AC2.1
**Criteria affected:** AC2.1

The sample input the second requirement points at does not exist.

The options as I see them:
- amend AC2.1 to name an input that exists
- add the referenced fixture under a task that owns it

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC2.1 | unverifiable | see Gaps |

## Beyond the happy path

Nothing.

## Gaps

- AC2.1 unverifiable.
`

const esc = (reason: string, from_role: string | null = 'orchestrator') => ({
  at: '2026-09-25T23:37:38.219Z',
  from_role,
  reason,
  resolved: false,
  resolved_by: null,
  resolved_at: null,
  resolution: null,
  disposition: null,
})

describe('describeEscalation', () => {
  it("reads the asker, the task and the report from the engine's reviewer line", () => {
    expect(describeEscalation('reviewer escalated task 04-fixture-label — see review-04.md', 'orchestrator', artifacts)).toEqual({
      role: 'reviewer',
      task: '04-fixture-label',
      artifact: 'review-04.md',
    })
  })

  it("reads the verifier's line, whose report is named after the dash", () => {
    const reason = 'verifier escalated — a failure traces to the spec, plan, or gate process, not the implementation; see verification-report.md'
    expect(describeEscalation(reason, 'orchestrator', artifacts)).toEqual({ role: 'verifier', task: null, artifact: 'verification-report.md' })
  })

  it("falls back to from_role when the line names no role, and never to the engine's identity", () => {
    expect(describeEscalation('contract dispute — needs a human', 'reviewer', artifacts).role).toBe('reviewer')
    expect(describeEscalation('implementer failed twice', 'orchestrator', artifacts).role).toBeNull()
    expect(describeEscalation('implementer failed twice', null, artifacts).role).toBeNull()
  })

  it("infers the verifier's report from the role when the line names none, and only when the record has it", () => {
    const reason = 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo'
    expect(describeEscalation(reason, 'verifier', artifacts).artifact).toBe('verification-report.md')
    expect(describeEscalation(reason, 'verifier', ['spec.md']).artifact).toBeNull()
  })

  it('names no report the record does not hold', () => {
    expect(describeEscalation('reviewer escalated task 09-x — see review-09.md', 'orchestrator', artifacts).artifact).toBeNull()
  })
})

describe('buildEscalationPacket', () => {
  it("joins a reviewer's escalation with its report's section, verdicts and standing findings", () => {
    const p = buildEscalationPacket({
      index: 0,
      escalation: esc('reviewer escalated task 04-fixture-label — see review-04.md'),
      artifacts,
      reviews: [parseReview('review-04.md', REVIEW)],
      verification: null,
    })
    expect(p.origin).toBe('role')
    expect(p.role).toBe('reviewer')
    expect(p.task).toBe('04-fixture-label')
    expect(p.artifact).toBe('review-04.md')
    expect(p.fromRole).toBe('orchestrator')
    expect(p.reason).toBe('reviewer escalated task 04-fixture-label — see review-04.md')
    expect(p.section?.tracesTo).toBe('R3 / ADR-5')
    expect(p.section?.diffVerdict).toBe('request-changes')
    expect(p.section?.options).toHaveLength(2)
    expect(p.reportVerdict).toBe('escalate')
    expect(p.standingFindings).toBe(2)
    expect(p.withheld).toBeNull()
  })

  it("joins the verifier's escalation with its report, read from the text", () => {
    const p = buildEscalationPacket({
      index: 0,
      escalation: esc('AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo', 'verifier'),
      artifacts,
      reviews: [],
      verification: VERIFICATION,
    })
    expect(p.origin).toBe('role')
    expect(p.artifact).toBe('verification-report.md')
    expect(p.section?.fields['Criteria affected']).toBe('AC2.1')
    expect(p.section?.diffVerdict).toBeNull()
    expect(p.reportVerdict).toBe('escalate')
    expect(p.standingFindings).toBeNull()
    expect(p.withheld).toBeNull()
  })

  it('is the engine reason alone when no report is behind it', () => {
    const p = buildEscalationPacket({
      index: 1,
      escalation: esc('phase "release" does not exist in profile standard'),
      artifacts,
      reviews: [],
      verification: null,
    })
    expect(p.origin).toBe('engine')
    expect(p.section).toBeNull()
    expect(p.withheld).toBeNull()
    expect(p.artifact).toBeNull()
  })

  it('withholds, naming the section, when the report predates #405', () => {
    const legacy = REVIEW.replace(/## Escalation[\s\S]*?(?=## Findings)/, '')
    const p = buildEscalationPacket({
      index: 0,
      escalation: esc('reviewer escalated task 04-fixture-label — see review-04.md'),
      artifacts,
      reviews: [parseReview('review-04.md', legacy)],
      verification: null,
    })
    expect(p.origin).toBe('role')
    expect(p.section).toBeNull()
    expect(p.withheld).toMatch(/review-04\.md carries no Escalation section/)
    // The report's own facts still travel: the human still gets the verdict and the link.
    expect(p.reportVerdict).toBe('escalate')
    expect(p.standingFindings).toBe(2)
  })
})
