// Folding audit-time sections (#217): which headings fold and what the
// count says. The split itself is core's and tested there.
import { describe, expect, it } from 'vitest'
import { splitSections } from '@gateline/core/record'
import { isAuditSection, itemCount } from '../src/fold.ts'

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

---

# Round 2
**Verdict:** approve

## Coverage (round 2)
Re-checked R1.
`

describe('isAuditSection', () => {
  it('matches the way the validator matches headings, and a round-qualified repeat', () => {
    expect(isAuditSection('Boundary check', ['Coverage', 'Boundary check'])).toBe(true)
    expect(isAuditSection('Boundary-Check!', ['Boundary check'])).toBe(true)
    expect(isAuditSection('Coverage (round 2)', ['Coverage'])).toBe(true)
    expect(isAuditSection('Findings', ['Coverage'])).toBe(false)
    expect(isAuditSection('Coverage gaps', ['Coverage'])).toBe(false)
  })
})

describe('the fold over a multi-round review', () => {
  it('the appended round opens its own section: its verdict is never under the previous fold', () => {
    const sections = splitSections(review)
    const round2 = sections.find((s) => s.heading === 'Round 2')!
    expect(round2.depth).toBe(1)
    expect(round2.body).toContain('**Verdict:** approve')
    expect(sections.find((s) => s.heading === 'Boundary check')!.body).not.toContain('Round 2')
  })
})

describe('itemCount', () => {
  const body = (heading: string) => splitSections(review).find((s) => s.heading === heading)!.body

  it('counts table rows when the section is a table, excluding the header and rule', () => {
    expect(itemCount(body('Coverage'))).toEqual({ n: 2, unit: 'rows' })
  })

  it('counts list items when the section is a list', () => {
    expect(itemCount('- a\n- b\n- c\n')).toEqual({ n: 3, unit: 'items' })
    expect(itemCount('1. a\n')).toEqual({ n: 1, unit: 'item' })
  })

  it('counts paragraphs otherwise — not rules, comments, table lines, or fenced blocks', () => {
    expect(itemCount('one.\n\ntwo.\n```\n- not an item\n```\n')).toEqual({ n: 2, unit: 'paragraphs' })
    expect(itemCount(body('Boundary check'))).toEqual({ n: 1, unit: 'paragraph' })
    expect(itemCount('<!-- note -->\n\n---\n\n| only | header |\n|---|---|\n')).toEqual({ n: 0, unit: 'paragraphs' })
  })
})
