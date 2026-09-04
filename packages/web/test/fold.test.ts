// Folding audit-time sections (#217): what splits, what counts, and that a
// fold never loses a word.
import { describe, expect, it } from 'vitest'
import { isAuditSection, itemCount, splitSections } from '../src/fold.ts'

const review = `# Review Report: 01-core

**Verdict:** approve
**Round:** 1 of 3

## Findings

### F1 — minor — a nit
- **Where:** \`a.py:1\`

## Coverage
Requirement coverage R1–R2 checked.

| Requirement | Where | Mechanism checked | Status |
|---|---|---|---|
| R1 | \`a.py:3\` | the thing | ✓ |
| R2 | \`a.py:9\` | the other thing | ✓ |

## Boundary check
Diff stayed inside the declared surface.
\`\`\`
## not a heading
\`\`\`
`

describe('splitSections', () => {
  it('splits at H2s outside fences and keeps the preamble when it says something', () => {
    const sections = splitSections(review)
    expect(sections.map((s) => s.heading)).toEqual([null, 'Findings', 'Coverage', 'Boundary check'])
    expect(sections[0]!.body).toContain('**Verdict:** approve')
    expect(sections[3]!.body).toContain('## not a heading')
  })

  it('loses no line: the sections re-join to the artifact', () => {
    const sections = splitSections(review)
    const rejoined = sections.map((s) => (s.headingLine ? `${s.headingLine}\n${s.body}` : s.body)).join('\n')
    expect(rejoined).toBe(review)
  })

  it('drops an empty preamble', () => {
    expect(splitSections('## Only\ntext\n').map((s) => s.heading)).toEqual(['Only'])
  })
})

describe('isAuditSection', () => {
  it('matches the way the validator matches headings', () => {
    expect(isAuditSection('Boundary check', ['Coverage', 'Boundary check'])).toBe(true)
    expect(isAuditSection('Boundary-Check!', ['Boundary check'])).toBe(true)
    expect(isAuditSection('Findings', ['Coverage'])).toBe(false)
  })
})

describe('itemCount', () => {
  it('counts table rows when the section is a table, excluding the header and rule', () => {
    const coverage = splitSections(review).find((s) => s.heading === 'Coverage')!.body
    expect(itemCount(coverage)).toEqual({ n: 2, unit: 'rows' })
  })

  it('counts list items when the section is a list', () => {
    expect(itemCount('- a\n- b\n- c\n')).toEqual({ n: 3, unit: 'items' })
    expect(itemCount('1. a\n')).toEqual({ n: 1, unit: 'item' })
  })

  it('counts paragraphs otherwise, ignoring fenced blocks', () => {
    expect(itemCount('one.\n\ntwo.\n```\n- not an item\n```\n')).toEqual({ n: 2, unit: 'paragraphs' })
  })
})
