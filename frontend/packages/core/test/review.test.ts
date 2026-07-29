// Typed review parsing (#214): grammar per contracts/review-report.md,
// exercised on synthetic reports and on every real report under runs/.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bySeverity, parseReview, standing } from '../src/view-model/review.ts'

const REPORT = `# Review Report: 01-core

<!-- Contract: produced by Reviewer. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit abc1234 (branch run/sample)

## Findings

### F1 — blocking — the parser accepts a flag it must reject
- **Where:** \`src/cli.py:105\`
- **Failure scenario:** running with --help exits 0 and writes to stdout,
  where the contract requires exit 2 on stderr.
- **Requirement:** R1

### F2 — minor (PLAUSIBLE) — a race between scan and hash
- **Where:** \`src/cli.py:52\`
- **Failure scenario:** an adversarial mid-scan mutation blocks the open.
- **Requirement:** none violated

## Coverage

Requirements R1-R3 checked.

## Boundary check

Inside the declared surface.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit def5678

## Finding resolutions

- **F1 — resolved.** The parser now rejects the flag.
- **F2 — stands as written** (minor, PLAUSIBLE, plan-accepted race).

## Boundary check (round 2)

Inside the declared surface.
`

describe('parseReview', () => {
  const report = parseReview('review-01.md', REPORT)

  it('binds to its task by the header, not the filename', () => {
    expect(report.task).toBe('01-core')
  })

  it('reads one round per delivered verdict, with its number and diff', () => {
    expect(report.rounds).toEqual([
      { round: 1, verdict: 'request-changes', diff: 'commit abc1234 (branch run/sample)', line: 5 },
      { round: 2, verdict: 'approve', diff: 'commit def5678', line: 34 },
    ])
  })

  it('carries the verdict in force — the last round’s', () => {
    expect(report.verdict).toBe('approve')
  })

  it('extracts findings with severity, title, and the contract fields verbatim', () => {
    const [f1, f2] = report.findings
    expect(f1!.id).toBe('F1')
    expect(f1!.severity).toBe('blocking')
    expect(f1!.title).toBe('the parser accepts a flag it must reject')
    expect(f1!.where).toBe('`src/cli.py:105`')
    expect(f1!.failureScenario).toContain('running with --help exits 0')
    // Wrapped continuation lines rejoin into the field.
    expect(f1!.failureScenario).toContain('the contract requires exit 2 on stderr.')
    expect(f1!.requirement).toBe('R1')
    expect(f1!.round).toBe(1)
    expect(f2!.severity).toBe('minor')
  })

  it('keeps a qualified severity cell verbatim and flags PLAUSIBLE', () => {
    const f2 = report.findings[1]!
    expect(f2.severityText).toBe('minor (PLAUSIBLE)')
    expect(f2.plausible).toBe(true)
    expect(report.findings[0]!.plausible).toBe(false)
  })

  it('attaches a later round’s disposition to the finding it names', () => {
    const [f1, f2] = report.findings
    expect(f1!.resolution).toMatchObject({ state: 'resolved', round: 2 })
    expect(f1!.resolution!.text).toContain('The parser now rejects the flag.')
    expect(f2!.resolution).toMatchObject({ state: 'stands', round: 2 })
  })

  it('keeps the finding block verbatim, heading through body', () => {
    expect(report.findings[0]!.block.split('\n')[0]).toBe(
      '### F1 — blocking — the parser accepts a flag it must reject',
    )
    expect(REPORT).toContain(report.findings[0]!.block)
  })

  it('ranks blocking first and lists what a later round left standing', () => {
    expect(bySeverity(report.findings).map((f) => f.id)).toEqual(['F1', 'F2'])
    expect(standing(report.findings).map((f) => f.id)).toEqual(['F2'])
  })

  it('parses the parenthesized heading variant real reports also use', () => {
    const r = parseReview('r.md', '**Verdict:** escalate\n\n### F1 (blocking) — a decomposition defect\n- **Where:** plan.md\n')
    expect(r.findings[0]).toMatchObject({ id: 'F1', severity: 'blocking', severityText: 'blocking', title: 'a decomposition defect' })
    expect(r.verdict).toBe('escalate')
  })

  it('keeps a heading that names no severity, reading the severity as unknown', () => {
    const r = parseReview('r.md', '### F1 — something odd happened\n')
    expect(r.findings[0]).toMatchObject({ id: 'F1', severity: 'unknown', title: 'something odd happened' })
  })

  it('ignores findings and verdicts inside fenced blocks', () => {
    const r = parseReview('r.md', '**Verdict:** approve\n\n```\n### F9 — blocking — not a finding\n**Verdict:** escalate\n```\n')
    expect(r.findings).toEqual([])
    expect(r.rounds).toHaveLength(1)
    expect(r.verdict).toBe('approve')
  })

  it('degrades to empty on input with no grammar at all', () => {
    const r = parseReview('r.md', 'just some prose\n')
    expect(r).toMatchObject({ task: null, rounds: [], findings: [], verdict: null })
  })
})

describe('the real reports under runs/', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..')
  const reports: { path: string; content: string }[] = []
  for (const slug of readdirSync(join(repoRoot, 'runs'), { withFileTypes: true })) {
    if (!slug.isDirectory()) continue
    for (const name of readdirSync(join(repoRoot, 'runs', slug.name))) {
      if (/^review-\d+.*\.md$/.test(name)) {
        reports.push({ path: `${slug.name}/${name}`, content: readFileSync(join(repoRoot, 'runs', slug.name, name), 'utf8') })
      }
    }
  }

  it('finds reports to parse', () => {
    expect(reports.length).toBeGreaterThan(5)
  })

  it('reads a verdict from every one of them', () => {
    const verdictless = reports
      .map(({ path, content }) => ({ path, report: parseReview(path, content) }))
      .filter(({ report }) => report.verdict === null)
      .map(({ path }) => path)
    expect(verdictless).toEqual([])
  })

  it('finds findings exactly where the report has finding headings', () => {
    // A clean approval says "None." under Findings and has no F headings —
    // zero findings is a correct parse there, not a miss.
    const mismatched = reports
      .map(({ path, content }) => ({
        path,
        parsed: parseReview(path, content).findings.length,
        headings: new Set(content.split('\n').flatMap((l) => /^#{1,6}\s*(F\d+)\b/.exec(l)?.[1] ?? [])).size,
      }))
      .filter(({ parsed, headings }) => parsed !== headings)
    expect(mismatched).toEqual([])
  })

  it('assigns every finding a ranked severity', () => {
    const unknown: string[] = []
    for (const { path, content } of reports) {
      for (const f of parseReview(path, content).findings) {
        if (f.severity === 'unknown') unknown.push(`${path} ${f.id}: ${f.severityText || f.title}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('quotes every finding block verbatim from its source', () => {
    for (const { path, content } of reports) {
      for (const f of parseReview(path, content).findings) {
        expect(content, `${path} ${f.id}`).toContain(f.block)
      }
    }
  })

  it('parses dupefind round 1 as the issue describes it', () => {
    const content = readFileSync(join(repoRoot, 'runs/dupefind/review-01.md'), 'utf8')
    const report = parseReview('review-01.md', content)
    expect(report.rounds.map((r) => r.verdict)).toEqual(['request-changes', 'approve'])
    expect(report.findings.map((f) => f.id)).toEqual(['F1', 'F2', 'F3', 'F4'])
    expect(report.findings[0]).toMatchObject({ severity: 'blocking', round: 1 })
    expect(report.findings[0]!.resolution).toMatchObject({ state: 'resolved', round: 2 })
    expect(standing(report.findings).map((f) => f.id)).toEqual(['F2', 'F3', 'F4'])
    expect(bySeverity(report.findings)[0]!.id).toBe('F1')
  })
})

describe('browser-safe leaf', () => {
  it('imports nothing — the host serves the parse as data', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/view-model/review.ts', import.meta.url)), 'utf8')
    expect(/^\s*import\b/m.test(src)).toBe(false)
  })
})
