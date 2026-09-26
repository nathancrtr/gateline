// The Escalation section (#405): required exactly when the verdict in force
// is `escalate`, read for the fields the contract fixes. What is under test
// is the conditional rule — that it bites under the verdict and stays quiet
// otherwise, including on an earlier round's section left behind — and that
// the reader lifts the section out verbatim without ranking anything.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUILTIN_CONDITIONAL_SECTIONS, type ContractTemplates, extractConditional, validateArtifact } from '../src/index.ts'
import { extractEscalation, parseReview } from '../src/view-model/review.ts'

const none: ContractTemplates = { read: async () => null }
const repoContract = (name: string) => readFileSync(fileURLToPath(new URL(`../../../contracts/${name}`, import.meta.url)), 'utf8')
const repo: ContractTemplates = { read: async (name) => repoContract(name) }

const ESCALATION = `## Escalation

**Diff verdict:** request-changes
**Traces to:** R3 / ADR-5
**Outside every remaining surface:** \`packages/web/src/pages/metrics.tsx\` — task 04's surface is the five label files; 05 and 06 do not name it

The third requirement says every page rendering a fixture run carries the label, and the plan
enumerates three surfaces and stops. The metrics page is a fourth, and no remaining task owns it.

The options as I see them:
- widen task 04's surface by the metrics page: one gated render on the run cell,
  one test
- amend R3 to name the three surfaces in scope and record the metrics table out of scope
`

const review = (verdict: string, sections: string) => `# Review Report: 04-fixture-label

**Verdict:** ${verdict}
**Round:** 1 of 3
**Diff reviewed:** eac2e95

${sections}
## Findings

### F1 — major — the markup test cannot tell visible text from hover-only text
- **Where:** \`packages/web/test/fixture-label.test.ts:22\`
- **Failure scenario:** the text moves into a title attribute and 3/3 still pass
- **Requirement:** R3 / AC3.2

## Coverage

Read the whole diff.

## Boundary check

Inside the surface.
`

const verification = (verdict: string, sections: string) => `# Verification Report: run

**Verdict:** ${verdict}
**Change verified:** run branch tip

${sections}
## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC2.1 | unverifiable | see Gaps |

## Beyond the happy path

Nothing.

## Gaps

- AC2.1 unverifiable.
`

describe('REQUIRED WHEN (#405)', () => {
  it('parses the annotation line into normalized heading → verdict', () => {
    expect(extractConditional('<!-- REQUIRED WHEN: Escalation=escalate -->')).toEqual({ escalation: 'escalate' })
    expect(extractConditional('REQUIRED WHEN: Escalation=escalate; Rollback drill=fail')).toEqual({
      escalation: 'escalate',
      'rollback drill': 'fail',
    })
  })

  it('never reads the line from inside a fence, and ignores a pair without =', () => {
    expect(extractConditional('```\nREQUIRED WHEN: Escalation=escalate\n```')).toEqual({})
    expect(extractConditional('REQUIRED WHEN: Escalation')).toEqual({})
  })

  it("the repository's own contracts carry the line the built-ins mirror", () => {
    for (const name of ['review-report.md', 'verification-report.md']) {
      const fromTemplate = extractConditional(repoContract(name))
      const builtin = Object.fromEntries(
        Object.entries(BUILTIN_CONDITIONAL_SECTIONS[name]!).map(([h, v]) => [h.toLowerCase(), v]),
      )
      expect(fromTemplate).toEqual(builtin)
    }
  })
})

describe('validateArtifact with a conditional section (#405)', () => {
  it('a review whose verdict is escalate and has no Escalation section is malformed, naming the section', async () => {
    const v = await validateArtifact('review-01.md', review('escalate', ''), repo)
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(['Escalation (required when Verdict is escalate)'])
  })

  it('the same review with the section passes', async () => {
    const v = await validateArtifact('review-01.md', review('escalate', ESCALATION), repo)
    expect(v.ok).toBe(true)
  })

  it('a review under any other verdict does not need the section', async () => {
    for (const verdict of ['approve', 'request-changes']) {
      const v = await validateArtifact('review-01.md', review(verdict, ''), repo)
      expect(v.ok).toBe(true)
    }
  })

  it('a section an earlier round left behind is history, not a deviation', async () => {
    const appended = `${review('escalate', ESCALATION)}
# Round 2

**Verdict:** approve
**Round:** 2 of 3

## Verify round
- **F1 — resolved** — the assertion now pins the visible text
`
    const v = await validateArtifact('review-01.md', appended, repo)
    expect(v.ok).toBe(true)
  })

  it('the conditional section is not among the unconditionally required ones', async () => {
    // A review with every unconditional section and no Escalation, under
    // approve: exactly what every finished run's approving review looks like.
    const v = await validateArtifact('review-01.md', review('approve', ''), repo)
    expect(v.missing).toEqual([])
  })

  it('the verifier report follows the same rule', async () => {
    const bare = await validateArtifact('verification-report.md', verification('escalate', ''), repo)
    expect(bare.ok).toBe(false)
    expect(bare.missing).toEqual(['Escalation (required when Verdict is escalate)'])
    const withSection = await validateArtifact(
      'verification-report.md',
      verification('escalate', '## Escalation\n\n**Traces to:** R2 / AC2.1\n**Criteria affected:** AC2.1\n\nThe input does not exist.\n\n- amend AC2.1\n'),
      repo,
    )
    expect(withSection.ok).toBe(true)
    expect((await validateArtifact('verification-report.md', verification('fail', ''), repo)).ok).toBe(true)
  })

  it('a report with no verdict line has no verdict in force and needs no conditional section', async () => {
    const legacy = review('escalate', '').replace('**Verdict:** escalate\n', '')
    expect((await validateArtifact('review-01.md', legacy, repo)).ok).toBe(true)
  })

  it('falls back to the built-in conditional map when the repo has no contracts/', async () => {
    const v = await validateArtifact('review-01.md', review('escalate', ''), none)
    expect(v.ok).toBe(false)
    expect(v.missing).toContain('Escalation (required when Verdict is escalate)')
  })

  it("a fork whose template carries no REQUIRED WHEN line requires every H2 it lists, unconditionally", async () => {
    const fork: ContractTemplates = {
      read: async () => '# Review Report\n\n## Escalation\n\n## Findings\n\n## Coverage\n\n## Boundary check\n',
    }
    const v = await validateArtifact('review-01.md', review('approve', ''), fork)
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(['Escalation'])
  })
})

describe('extractEscalation', () => {
  it('lifts the section out verbatim, with its fields, prose and options', () => {
    const e = extractEscalation(review('escalate', ESCALATION))!
    expect(e).not.toBeNull()
    expect(e.diffVerdict).toBe('request-changes')
    expect(e.tracesTo).toBe('R3 / ADR-5')
    expect(e.fields['Outside every remaining surface']).toMatch(/^`packages\/web\/src\/pages\/metrics\.tsx`/)
    expect(e.prose).toBe(
      'The third requirement says every page rendering a fixture run carries the label, and the plan\nenumerates three surfaces and stops. The metrics page is a fourth, and no remaining task owns it.\n\nThe options as I see them:',
    )
    expect(e.options).toEqual([
      "widen task 04's surface by the metrics page: one gated render on the run cell, one test",
      'amend R3 to name the three surfaces in scope and record the metrics table out of scope',
    ])
    expect(e.line).toBe(7)
    expect(e.body.startsWith('**Diff verdict:** request-changes')).toBe(true)
    expect(e.body.endsWith('record the metrics table out of scope')).toBe(true)
  })

  it('is null when the report carries no section, and reads a heading only outside fences', () => {
    expect(extractEscalation(review('approve', ''))).toBeNull()
    expect(extractEscalation('```\n## Escalation\n- fenced\n```\n')).toBeNull()
  })

  it('reports an off-grammar diff verdict as null while keeping the value as written', () => {
    const e = extractEscalation('## Escalation\n\n**Diff verdict:** approve, mostly\n\nprose\n')!
    expect(e.diffVerdict).toBeNull()
    expect(e.fields['Diff verdict']).toBe('approve, mostly')
  })

  it('yields the last section when a later round escalated again', () => {
    const twice = `${review('escalate', ESCALATION)}
# Round 2

**Verdict:** escalate

## Escalation

**Diff verdict:** approve
**Traces to:** ADR-2

Still unowned.

- re-plan
`
    const e = extractEscalation(twice)!
    expect(e.diffVerdict).toBe('approve')
    expect(e.tracesTo).toBe('ADR-2')
    expect(e.options).toEqual(['re-plan'])
  })

  it('stops at the next H1 as well as the next H2', () => {
    const e = extractEscalation('## Escalation\n\n**Traces to:** R1\n\n- one\n\n# Round 2\n\n- not an option\n')!
    expect(e.options).toEqual(['one'])
  })
})

describe('parseReview carries the section', () => {
  it('as `escalation`, null on a report without one', () => {
    expect(parseReview('review-04.md', review('escalate', ESCALATION)).escalation?.tracesTo).toBe('R3 / ADR-5')
    expect(parseReview('review-01.md', review('approve', '')).escalation).toBeNull()
  })
})
