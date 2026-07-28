// Review-report parsing (#214): grammar per contracts/review-report.md, but
// exercised primarily against the real committed artifacts under runs/ — the
// task's mandated survey found far more grammar variance there than the
// contract alone suggests (round headers, section names, and especially the
// free-form resolution vocabulary, including the negation trap this file's
// own acceptance test pins).
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildReviewReport } from '../src/view-model/review-report.ts'

const SYNTHETIC = `# Review Report: sample-task

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit abc123 (branch run/sample)

## Findings

### F1 — blocking (repo integrity / process — NOT a defect in the reviewed diff) — a nested-parenthetical qualifier must not break the severity/title split
- **Where:** \`src/a.ts:10\`
- **Failure scenario:** a concrete input that trips the defect
- **Requirement:** R1

### F2 — minor (PLAUSIBLE) — a qualified minor finding
- **Where:** \`src/b.ts:20\`
- **Failure scenario:** none confirmed
- **Requirement:** R2

## Coverage
Clean, checked R1-R2.

## Boundary check
In bounds.

---

## Round 2 — 2026-07-21

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit def456

## Finding resolutions

- **F1 — NOT genuinely resolved.** The mechanism exists but misses the prompted case.
- **F2 (minor, PLAUSIBLE) — RESOLVED.** Fixed and mutant-verified.

## Coverage
Delta reviewed.

## Boundary check
In bounds.
`

describe('buildReviewReport', () => {
  const report = buildReviewReport(SYNTHETIC)!

  it('extracts each round\'s verdict, round-of-total, and diff reviewed', () => {
    expect(report.rounds).toEqual([
      { round: 1, of: 3, verdictText: 'request-changes', verdict: 'request-changes', diffReviewed: 'commit abc123 (branch run/sample)', line: 3 },
      { round: 2, of: 3, verdictText: 'approve', verdict: 'approve', diffReviewed: 'commit def456', line: expect.any(Number) },
    ])
  })

  it('splits severity from title on the first top-level em dash, so a qualifier\'s own internal dash does not break the split', () => {
    const f1 = report.findings.find((f) => f.id === 'F1')!
    expect(f1.severity).toBe('blocking')
    expect(f1.severityText).toBe('blocking (repo integrity / process — NOT a defect in the reviewed diff)')
    expect(f1.title).toBe('a nested-parenthetical qualifier must not break the severity/title split')
  })

  it('extracts Where/Failure scenario/Requirement verbatim', () => {
    const f2 = report.findings.find((f) => f.id === 'F2')!
    expect(f2.severityText).toBe('minor (PLAUSIBLE)')
    expect(f2.where).toBe('`src/b.ts:20`')
    expect(f2.failureScenario).toBe('none confirmed')
    expect(f2.requirement).toBe('R2')
  })

  it('a NOT genuinely resolved line does NOT classify the finding as resolved (the negation trap)', () => {
    const f1 = report.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions).toHaveLength(1)
    expect(f1.resolutions[0]).toMatchObject({ round: 2, resolved: false, status: 'open' })
    expect(f1.resolutions[0]!.text).toContain('NOT genuinely resolved')
    expect(f1.resolved).toBe(false)
  })

  it('a confident, unnegated resolved match classifies the finding as resolved', () => {
    const f2 = report.findings.find((f) => f.id === 'F2')!
    expect(f2.resolved).toBe(true)
    expect(f2.resolutions[0]).toMatchObject({ round: 2, resolved: true, status: 'resolved' })
  })

  it('(round-2 F1) a contraction negation ("isn\'t resolved") does NOT classify as resolved', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 1

## Findings

### F1 — blocking — a defect
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

## Finding resolutions

- **F1 — still isn't resolved.** The mechanism exists but misses the case.
`)!
    const f1 = out.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions[0]).toMatchObject({ resolved: false, status: 'open' })
    expect(f1.resolved).toBe(false)
  })

  it('(round-2 F1) "cannot be resolved without a spec change" does NOT classify as resolved', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 1

## Findings

### F1 — blocking — a defect
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

## Finding resolutions

- **F1 — cannot be resolved without a spec change.**
`)!
    const f1 = out.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions[0]).toMatchObject({ resolved: false, status: 'open' })
    expect(f1.resolved).toBe(false)
  })

  it('(round-2 F2) the "(severity, resolved)" parenthetical shape classifies as resolved even with no dash-tail status', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 1

## Findings

### F1 — blocking — a defect
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

## Resolution of round-1 findings

- **F1 (blocking, resolved)** — \`x.ts:1-4\`. Traced and killed.
`)!
    const f1 = out.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions[0]).toMatchObject({ resolved: true, status: 'resolved' })
    expect(f1.resolved).toBe(true)
  })

  it('(round-2 F3) an explicit negative marker without the word "resolved" classifies as the confident "open" status, not "unclassified"', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 1

## Findings

### F1 — minor — a defect
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

## Finding resolutions

- **F1 — unresolved.** Carried forward.
`)!
    const f1 = out.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions[0]).toMatchObject({ resolved: false, status: 'open' })
  })

  it('(round-2 F3) free-form text the parser cannot confidently place either way classifies as "unclassified", distinct from a confident "open"', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 1

## Findings

### F1 — minor — a defect
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

## Finding resolutions

- **F1 — stands as written** (minor, plan-accepted). Not gating.
`)!
    const f1 = out.findings.find((f) => f.id === 'F1')!
    expect(f1.resolutions[0]).toMatchObject({ resolved: false, status: 'unclassified' })
    expect(f1.resolved).toBe(false)
  })

  it('sorts findings blocking-first even when the source declares major/minor before blocking', () => {
    const out = of(`**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** x

## Findings

### F1 — minor — a minor issue
- **Where:** \`x:1\`
- **Failure scenario:** n/a
- **Requirement:** R1

### F2 — blocking — a blocking issue
- **Where:** \`x:2\`
- **Failure scenario:** n/a
- **Requirement:** R2
`)!
    expect(out.findings.map((f) => f.id)).toEqual(['F2', 'F1'])
  })

  it('degrades to null on input with no recognizable round', () => {
    expect(buildReviewReport('just some prose, no grammar here')).toBeNull()
    expect(buildReviewReport(null)).toBeNull()
    expect(buildReviewReport('')).toBeNull()
  })

  it('never throws on garbage input', () => {
    expect(() => buildReviewReport('**Verdict:**\n**Round:** not-a-number of\n### F — —\n')).not.toThrow()
    expect(() => buildReviewReport('#'.repeat(5000))).not.toThrow()
  })
})

function of(text: string) {
  return buildReviewReport(text)
}

describe('real finished runs', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..')
  const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

  it('dupefind review-01.md: 4 findings across 2 rounds, F1 resolved in round 2, F2-F4 still standing', () => {
    const report = buildReviewReport(read('runs/dupefind/review-01.md'))!
    expect(report.rounds.map((r) => r.verdict)).toEqual(['request-changes', 'approve'])

    const byId = new Map(report.findings.map((f) => [f.id, f]))
    expect([...byId.keys()].sort()).toEqual(['F1', 'F2', 'F3', 'F4'])

    expect(byId.get('F1')).toMatchObject({ severity: 'blocking', round: 1, resolved: true })
    expect(byId.get('F1')!.resolutions[0]).toMatchObject({ round: 2, resolved: true, status: 'resolved' })

    for (const id of ['F2', 'F3', 'F4']) {
      expect(byId.get(id)!.resolved).toBe(false)
      // Their round-2 disposition is free-form ('stands as written') — the
      // parser can't confidently call these open or resolved, so they're
      // `unclassified`, not silently folded into 'open' (round-2 F3).
      expect(byId.get(id)!.resolutions[0]).toMatchObject({ status: 'unclassified', resolved: false })
    }
  })

  it('(round-2 F2) wordfreq review-03.md: the "(severity, resolved)" parenthetical shape classifies both F1 and F2 as resolved', () => {
    const report = buildReviewReport(read('runs/wordfreq/review-03.md'))!
    const byId = new Map(report.findings.map((f) => [f.id, f]))
    for (const id of ['F1', 'F2']) {
      const f = byId.get(id)!
      expect(f.resolved, id).toBe(true)
      expect(f.resolutions[0], id).toMatchObject({ round: 2, resolved: true, status: 'resolved' })
    }
  })

  it('(round-2 F3) runner-agent review-04.md: an explicit "unresolved"/"open" marker classifies as the confident "open" status', () => {
    const report = buildReviewReport(read('runs/runner-agent/review-04.md'))!
    const byId = new Map(report.findings.map((f) => [f.id, f]))
    const f2 = byId.get('F2')!
    const unresolvedEntry = f2.resolutions.find((r) => r.text.includes('unresolved'))
    expect(unresolvedEntry).toBeDefined()
    expect(unresolvedEntry).toMatchObject({ resolved: false, status: 'open' })
  })

  it("F1's severity sorts ahead of the three minor findings", () => {
    const report = buildReviewReport(read('runs/dupefind/review-01.md'))!
    expect(report.findings[0]).toMatchObject({ id: 'F1', severity: 'blocking' })
    expect(report.findings.slice(1).every((f) => f.severity === 'minor')).toBe(true)
  })

  it('the real negation trap (runner-agent review-04.md) does not classify F1 as resolved', () => {
    const report = buildReviewReport(read('runs/runner-agent/review-04.md'))!
    const f1 = report.findings.find((f) => f.id === 'F1')!
    const negated = f1.resolutions.find((r) => r.text.includes('NOT genuinely resolved'))!
    expect(negated).toBeDefined()
    expect(negated.resolved).toBe(false)
    expect(f1.resolved).toBe(false)
  })

  it('the whole corpus (runs/*/review-*.md) parses without throwing, and no finding text is fabricated', () => {
    const runsDir = join(repoRoot, 'runs')
    const files: string[] = []
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(runsDir, entry.name)
      let names: string[]
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) if (/^review-\d+.*\.md$/.test(name)) files.push(join(dir, name))
    }
    // The task named 29 as the survey count; the corpus has grown since (47
    // at the time of writing). Assert "at least the surveyed set", not an
    // exact count, so new finished runs don't make this test stale.
    expect(files.length).toBeGreaterThanOrEqual(29)

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      let threw = false
      let report: ReturnType<typeof buildReviewReport> = null
      try {
        report = buildReviewReport(text)
      } catch {
        threw = true
      }
      expect(threw, file).toBe(false)
      if (!report) continue
      for (const finding of report.findings) {
        expect(text, `${file} ${finding.id} heading`).toContain(finding.heading)
        expect(text, `${file} ${finding.id} definition`).toContain(finding.definition)
        for (const resolution of finding.resolutions) {
          expect(text, `${file} ${finding.id} resolution`).toContain(resolution.text)
        }
      }
    }
  })
})

describe('browser-safe leaf', () => {
  it('review-report.ts imports nothing — its exports may be served as data', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/view-model/review-report.ts', import.meta.url)), 'utf8')
    expect(/^\s*import\b/m.test(src)).toBe(false)
  })
})
