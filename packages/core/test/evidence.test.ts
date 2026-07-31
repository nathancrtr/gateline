// Evidence-presence rollup (#165): presence, never verdicts — verified on
// synthetic records and the real finished runs.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildEvidenceRollup } from '../src/view-model/evidence.ts'
import { buildLexicon } from '../src/view-model/lexicon.ts'

const SPEC = `# Specification: sample

## Requirements

### R1 — Core behavior
**Acceptance criteria:**
- [ ] AC1.1 — the documented output appears
- [ ] AC1.2 — never verified, deliberately

### R2 — Error handling
**Acceptance criteria:**
- [ ] AC2.1 — malformed input exits non-zero
`

const VERIFICATION = `# Verification Report: sample

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC9.9 | unverifiable | see E2 |

### E1 — AC1.1
\`\`\`
$ tool sample.txt
### E9 — AC1.2 (inside a fence — not an evidence block)
\`\`\`

### E2 — AC9.9
\`\`\`
$ tool mystery
\`\`\`

## Gaps
AC1.2 could not be verified — no fixture reproduces the timing window.
`

// Two reports, deliberately out of severity order on disk and out of path
// order by severity, so the join has something to sort.
const REVIEW_01 = `# Review Report: 01-core

**Verdict:** request-changes
**Round:** 1 of 3

## Findings

### F1 — minor — output column is misaligned
- **Where:** \`src/core.py:11\`
- **Requirement:** AC1.1

## Coverage
AC1.1 exercised by reading; AC1.2 not assessed.
`

const REVIEW_02 = `# Review Report: 02-errors

**Verdict:** request-changes
**Round:** 1 of 3

## Findings

### F1 — blocking — malformed input exits zero
- **Where:** \`src/errors.py:7\`
- **Failure scenario:** garbage input exits 0, so callers cannot tell
- **Requirement:** AC2.1

### F2 — major — the cap is checked after parsing
- **Requirement:** AC1.1
`

const lexicon = buildLexicon({ spec: SPEC })
const rollup = buildEvidenceRollup({
  lexicon,
  verification: VERIFICATION,
  reviews: [
    { path: 'review-01.md', content: REVIEW_01 },
    { path: 'review-02.md', content: REVIEW_02 },
  ],
})
const byId = new Map(rollup.criteria.map((c) => [c.id, c]))

describe('buildEvidenceRollup', () => {
  it('keeps spec-defined criteria first, in definition order', () => {
    expect(rollup.criteria.map((c) => c.id)).toEqual(['AC1.1', 'AC1.2', 'AC2.1', 'AC9.9'])
    expect(rollup.hasVerification).toBe(true)
  })

  it('anchors evidence blocks and quotes Results cells verbatim', () => {
    const ac11 = byId.get('AC1.1')!
    expect(ac11.evidence).toHaveLength(1)
    expect(ac11.evidence[0]).toMatchObject({ artifact: 'verification-report.md', line: 10, label: 'E1' })
    expect(ac11.result).toEqual({ verdict: 'verified', evidence: 'see E1' })
  })

  it('carries the evidence block byte-identical, fenced content and all (#256)', () => {
    const block = byId.get('AC1.1')!.evidence[0]!.block
    expect(block).toBe(
      ['### E1 — AC1.1', '```', '$ tool sample.txt', '### E9 — AC1.2 (inside a fence — not an evidence block)', '```'].join('\n'),
    )
    // Verbatim means a slice, not a reconstruction: it appears in the source.
    expect(VERIFICATION).toContain(block)
  })

  it('uncited criteria carry no evidence and surface their Gaps line verbatim', () => {
    const ac12 = byId.get('AC1.2')!
    expect(ac12.evidence).toEqual([])
    expect(ac12.result).toBeNull()
    expect(ac12.gap).toBe('AC1.2 could not be verified — no fixture reproduces the timing window.')
    const ac21 = byId.get('AC2.1')!
    expect(ac21.evidence).toEqual([])
    expect(ac21.gap).toBeNull()
  })

  it('flags citations of criteria the spec never defined', () => {
    const unknown = byId.get('AC9.9')!
    expect(unknown.defined).toBe(false)
    expect(unknown.evidence.map((a) => a.label)).toEqual(['E2'])
  })

  it('ignores evidence headings inside code fences', () => {
    expect(byId.get('AC1.2')!.evidence).toEqual([])
  })

  it('review mentions are anchored separately as discussion, not evidence', () => {
    expect(byId.get('AC1.1')!.reviewMentions).toEqual([
      { artifact: 'review-01.md', line: 10, label: '' },
      { artifact: 'review-01.md', line: 13, label: '' },
      { artifact: 'review-02.md', line: 14, label: '' },
    ])
    expect(byId.get('AC1.2')!.reviewMentions).toHaveLength(1)
  })

  it('joins the findings that cite a criterion, in the reports’ own severity order (#256)', () => {
    // blocking → major → minor, across reports; a citation anywhere in the
    // finding's block counts, which is where `**Requirement:**` lives.
    expect(byId.get('AC1.1')!.findings).toEqual([
      { artifact: 'review-02.md', id: 'F2' },
      { artifact: 'review-01.md', id: 'F1' },
    ])
    expect(byId.get('AC2.1')!.findings).toEqual([{ artifact: 'review-02.md', id: 'F1' }])
    // Mentioned only in prose outside any finding → discussed, not found against.
    expect(byId.get('AC1.2')!.findings).toEqual([])
  })

  it('no verification report → criteria listed, hasVerification false, nothing withheld', () => {
    // The patch profile runs no verifier, so an absent report is the ordinary
    // shape of that record — never an error and never a withheld view.
    const bare = buildEvidenceRollup({ lexicon, verification: null })
    expect(bare.hasVerification).toBe(false)
    expect(bare.withheld).toBeNull()
    expect(bare.criteria).toHaveLength(3)
    expect(bare.criteria.every((c) => c.evidence.length === 0)).toBe(true)
  })

  it('a report matching the parser’s grammar withholds nothing', () => {
    expect(rollup.withheld).toBeNull()
  })

  it('withholds itself, with a reason, when the report follows another grammar (#256)', () => {
    // A fork may legitimately write its verification report some other way.
    // The contracts' bounce rule turned on the UI: say so, never guess.
    const forked = buildEvidenceRollup({
      lexicon,
      verification: '# Verification Report: sample\n\n## Results\n\nEverything checked out; see the transcript below.\n',
    })
    expect(forked.hasVerification).toBe(true)
    expect(forked.withheld).toMatch(/evidence-block grammar/)
    expect(forked.criteria.every((c) => c.evidence.length === 0 && c.result === null)).toBe(true)
  })
})

describe('real finished runs', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
  const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

  it('dupefind: every evidence block resolves to a spec-defined criterion', () => {
    const r = buildEvidenceRollup({
      lexicon: buildLexicon({ spec: read('runs/dupefind/spec.md') }),
      verification: read('runs/dupefind/verification-report.md'),
    })
    const withEvidence = r.criteria.filter((c) => c.evidence.length > 0)
    expect(withEvidence.length).toBeGreaterThan(0)
    expect(withEvidence.every((c) => c.defined)).toBe(true)
    expect(withEvidence.every((c) => c.evidence.every((a) => /^E\d+$/.test(a.label)))).toBe(true)
  })
})
