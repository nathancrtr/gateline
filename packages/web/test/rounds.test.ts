// The round-cap comparison (#257). What is under test is the part that could
// quietly become a verdict: which findings are called still-open, what the
// later round is said to have done about each one, and when the whole view
// stands down rather than guessing.

import { parseReview } from '@gateline/core/view-model'
import { describe, expect, it } from 'vitest'
import type { ReviewReport } from '../src/api.ts'
import { compareRounds, reportsForTask } from '../src/rounds.ts'
import { ref } from './artifact-refs.helper.ts'

/** A report built the way a reviewer writes one, then parsed by core — the
 *  comparison must hold against the real parse, not a hand-built object. */
const report = (path: string, body: string): ReviewReport => parseReview(path, body) as ReviewReport

const F1 = `### F1 — blocking — retry loop can double-apply a migration
- **Where:** \`src/migrate.py:88\`
- **Failure scenario:** a retried step runs the same ALTER twice
- **Requirement:** R2/AC2.1`

const F2 = `### F2 — minor — the dry-run banner prints after the plan
- **Where:** \`src/migrate.py:12\`
- **Failure scenario:** an operator skimming the output reads the plan as live
- **Requirement:** R1/AC1.2`

const F3 = `### F3 — minor — the rollback path is untested
- **Where:** \`tests/test_migrate.py\`
- **Failure scenario:** a failed step leaves the schema half-applied`

const round = (n: number, findings: string) => `# Review Report: 01-core

**Verdict:** request-changes
**Round:** ${n} of 3
**Diff reviewed:** run branch tip

## Findings

${findings}

## Coverage
R1–R3 checked.
`

/** The file-per-round shape: dispositions land in a later file than the finding they name. */
const PER_FILE = [
  report('review-01.md', round(1, `${F1}\n\n${F2}`)),
  report('review-02.md', round(2, `${F1}\n\n- **F2 — stands (round 2):** the banner still prints inside the plan block.`)),
  report('review-03.md', round(3, `${F1}\n\n${F3}\n\n- **F2 — resolved (round 3):** the banner is the first line now.`)),
]

/** The appended shape roles/reviewer.md directs: one file, rounds appended. */
const APPENDED = [
  report(
    'review-01.md',
    `${round(1, `${F1}\n\n${F2}`)}
## Round 2

**Verdict:** request-changes
**Round:** 2 of 3

## Findings

- **F1 — stands (round 2):** the guard is still not idempotent.
- **F2 — resolved (round 2):** the banner is the first line now.
`,
  ),
]

const ok = (reports: ReviewReport[]) => {
  const result = compareRounds(reports)
  if (!result.ok) throw new Error(`expected a comparison, got: ${result.reason}`)
  return result
}
const ids = (items: { finding: { id: string } }[]) => items.map((i) => i.finding.id)

describe('the last two rounds, across files', () => {
  it('compares the two highest-numbered rounds', () => {
    const delta = ok(PER_FILE)
    expect(delta.earlier).toMatchObject({ round: 2, paths: ['review-02.md'] })
    expect(delta.later).toMatchObject({ round: 3, paths: ['review-03.md'], verdict: 'request-changes' })
  })

  it('a finding raised in both rounds is what did not converge, and leads', () => {
    const delta = ok(PER_FILE)
    expect(ids(delta.standing)).toEqual(['F1'])
    expect(delta.standing[0]).toMatchObject({ note: 'raised again', raisedIn: [1, 2, 3] })
  })

  it('a finding first raised in the final round is new, not persisting', () => {
    expect(ids(ok(PER_FILE).fresh)).toEqual(['F3'])
    expect(ok(PER_FILE).fresh[0]!.note).toBe('new')
  })

  it('a disposition in a later file closes the finding an earlier file raised', () => {
    const delta = ok(PER_FILE)
    expect(ids(delta.resolved)).toEqual(['F2'])
    expect(delta.resolved[0]!.disposition).toContain('the banner is the first line now')
  })

  it('the shown raising is the most recent wording, with its own artifact named', () => {
    expect(ok(PER_FILE).standing[0]!.path).toBe('review-03.md')
  })

  it('findings carry the requirement they cite, verbatim — the ambiguity lives there', () => {
    expect(ok(PER_FILE).standing[0]!.finding.requirement).toBe('R2/AC2.1')
  })
})

describe('the appended shape reads the same way', () => {
  it('a finding the later round marked stands is still open', () => {
    const delta = ok(APPENDED)
    expect(ids(delta.standing)).toEqual(['F1'])
    expect(delta.standing[0]!.note).toBe('marked stands')
  })

  it('a finding the later round resolved is folded out of the standing group', () => {
    expect(ids(ok(APPENDED).resolved)).toEqual(['F2'])
  })
})

describe('absence is never read as resolution', () => {
  it('a finding the later round did not mention is reported as not mentioned', () => {
    const delta = ok([
      report('review-01.md', round(1, `${F1}\n\n${F2}`)),
      report('review-02.md', round(2, F1)),
    ])
    const f2 = delta.standing.find((s) => s.finding.id === 'F2')
    expect(f2).toBeDefined()
    expect(f2!.note).toBe('not mentioned')
    expect(delta.resolved).toEqual([])
  })

  it('a finding closed before the compared window is not re-litigated', () => {
    const delta = ok([
      report('review-01.md', round(1, `${F1}\n\n${F2}`)),
      report('review-02.md', round(2, `${F1}\n\n- **F2 — resolved (round 2):** fixed.`)),
      report('review-03.md', round(3, F1)),
    ])
    // Rounds 2 and 3 are compared; F2 was closed in round 2, which is in the
    // window, so it shows as resolved rather than vanishing.
    expect(ids(delta.resolved)).toEqual(['F2'])
    expect(ids(delta.standing)).toEqual(['F1'])
  })
})

describe('ordering', () => {
  it('ranks standing findings by the report’s own severity label', () => {
    const delta = ok([
      report('review-01.md', round(1, `${F2}\n\n${F1}`)),
      report('review-02.md', round(2, `${F2}\n\n${F1}`)),
    ])
    expect(ids(delta.standing)).toEqual(['F1', 'F2'])
  })
})

describe('the comparison withholds itself rather than guessing', () => {
  it('one numbered round offers no comparison, and says so', () => {
    const result = compareRounds([report('review-01.md', round(1, F1))], [ref('review-01.md', '01-core', 1)])
    expect(result.ok).toBe(false)
    // Structured (#424): the grammar looked for, in the contract's spelling,
    // and the report it looked in; the panel composes the sentence.
    if (!result.ok)
      expect(result.reason).toEqual({
        grammar: 'a second numbered round',
        token: '**Round:** <n of 3>',
        lookedIn: expect.objectContaining({ kind: 'review-report', path: 'review-01.md', contractName: 'review report' }),
      })
  })

  it('a forked finding grammar withholds and names the grammar it looked for', () => {
    const forked = `# Review Report: 01-core

**Verdict:** request-changes
**Round:** 1 of 3

## Findings
* issue one — the retry is not idempotent

**Verdict:** request-changes
**Round:** 2 of 3

## Findings
* issue one, still
`
    const result = compareRounds([report('review-01.md', forked)])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatchObject({ grammar: 'a finding headed', token: '### F<n> — <severity> — <title>' })
    // No refs — a server older than the page — and it looked in nothing it can name.
    if (!result.ok) expect(result.reason.lookedIn).toBeNull()
  })

  it('no reports at all is withheld, not an empty comparison', () => {
    const result = compareRounds([])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toEqual({ grammar: 'a numbered round', token: '**Round:** <n of 3>', lookedIn: null })
  })
})

describe('scoping to one task', () => {
  it('keeps only the reports naming the task', () => {
    const other = report('review-02.md', round(1, F1).replace('01-core', '02-errors'))
    const scoped = reportsForTask([PER_FILE[0]!, other], '01-core')
    expect(scoped.map((r) => r.task)).toEqual(['01-core'])
  })

  it('falls back to every report when none names the task', () => {
    expect(reportsForTask(PER_FILE, 'nonexistent-task')).toEqual(PER_FILE)
  })
})
