// Lexicon extraction (#163): grammar per contracts/spec.md + plan.md (#162),
// exercised on synthetic artifacts and on the real finished runs.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildLexicon, criterionRequirement, ID_PATTERN, resolveId, scanIds } from '../src/view-model/lexicon.ts'

const SPEC = `# Specification: sample

## Context
Prose for the approver.

## Requirements

### R1 — Core behavior
The core behavior, stated as prose for the approver.
**Acceptance criteria:**
- [ ] AC1.1 — running the tool produces the documented output
- [ ] AC1.2 — a wrapped criterion whose text continues
  onto an indented second line

### R2 — Error handling
**Acceptance criteria:**
- [x] AC2.1 — malformed input exits non-zero

## Assumptions

\`\`\`
### R99 — inside a fence, not a definition
- [ ] AC99.9 — also not a definition
\`\`\`
`

const PLAN = `# Technical Plan: sample

## Approach
Cites R1 and AC1.1.

## Decisions (ADRs)

### ADR-1: Pure core, thin shell
- **Choice:** keep logic pure.
- **Rejected:** logic in the CLI — untestable.

### ADR-2 (amendment, 2026-07-08): Pure core, amended
- **Choice:** the amended shape.

### ADR-2: Original decision
- **Choice:** superseded by nothing — this tests document order, not realism.

### ADR-3: No Choice bullet
Prose rationale only, outside the contract's bullet shape.

## Risks
None.
`

describe('buildLexicon', () => {
  const lex = buildLexicon({ spec: SPEC, plan: PLAN })

  it('extracts requirements with short names; the block stops before the criteria list', () => {
    const r1 = resolveId(lex, 'R1')!
    expect(r1).toMatchObject({ kind: 'requirement', shortName: 'Core behavior', artifact: 'spec.md', line: 8 })
    expect(r1.definition).toContain('### R1 — Core behavior')
    expect(r1.definition).not.toContain('AC1.2')
    expect(r1.definition).not.toContain('Acceptance criteria')
    expect(r1.body).toBe('The core behavior, stated as prose for the approver.')
  })

  it('extracts criteria including wrapped continuation lines', () => {
    const ac = resolveId(lex, 'AC1.2')!
    expect(ac.kind).toBe('criterion')
    expect(ac.definition).toContain('onto an indented second line')
    expect(ac.body).toBe('a wrapped criterion whose text continues onto an indented second line')
    expect(resolveId(lex, 'AC2.1')!.body).toBe('malformed input exits non-zero')
  })

  it('extracts decisions, carrying the amendment qualifier', () => {
    expect(resolveId(lex, 'ADR-1')).toMatchObject({ kind: 'decision', shortName: 'Pure core, thin shell', artifact: 'plan.md' })
    const amended = lex.entries.filter((e) => e.id === 'ADR-2')
    expect(amended).toHaveLength(2)
    expect(amended[0]!.qualifier).toBe('amendment, 2026-07-08')
  })

  it('resolveId returns the last definition in document order', () => {
    expect(resolveId(lex, 'ADR-2')!.shortName).toBe('Original decision')
  })

  it("a decision's body is its Choice line; the argument stays behind the click-through", () => {
    expect(resolveId(lex, 'ADR-1')!.body).toBe('keep logic pure.')
    expect(resolveId(lex, 'ADR-1')!.body).not.toContain('Rejected')
    expect(resolveId(lex, 'ADR-1')!.definition).toContain('**Rejected:**')
  })

  it('a decision without a Choice bullet falls back to its full body', () => {
    expect(resolveId(lex, 'ADR-3')!.body).toBe("Prose rationale only, outside the contract's bullet shape.")
  })

  it('ignores definitions inside code fences', () => {
    expect(resolveId(lex, 'R99')).toBeUndefined()
    expect(resolveId(lex, 'AC99.9')).toBeUndefined()
  })

  it('degrades to empty on absent input', () => {
    expect(buildLexicon({}).entries).toEqual([])
    expect(buildLexicon({ spec: null, plan: null }).entries).toEqual([])
  })
})

describe('scanIds', () => {
  it('returns unique ids in first-appearance order, including fenced text', () => {
    expect(scanIds('R2 then AC1.1 (R2 again) and ADR-3\n```\nR7 in evidence\n```')).toEqual(['R2', 'AC1.1', 'ADR-3', 'R7'])
  })

  it('does not match ids embedded in words', () => {
    expect(scanIds('CR5 PR12 MACR1.1')).toEqual([])
  })

  it('exposes the same grammar as ID_PATTERN for clients that receive it as data', () => {
    expect(new RegExp(ID_PATTERN, 'g').test('cites AC10.2')).toBe(true)
  })
})

describe('criterionRequirement', () => {
  it('maps a criterion to its requirement by numbering', () => {
    expect(criterionRequirement('AC10.2')).toBe('R10')
    expect(criterionRequirement('AC1.1')).toBe('R1')
  })
})

describe('real finished runs', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
  const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

  it('dupefind: requirements, criteria, and decisions all resolve', () => {
    const lex = buildLexicon({ spec: read('runs/dupefind/spec.md'), plan: read('runs/dupefind/plan.md') })
    const r4 = resolveId(lex, 'R4')!
    expect(r4.kind).toBe('requirement')
    expect(r4.shortName.length).toBeGreaterThan(0)
    expect(r4.body).toMatch(/^Files of size 0 bytes/)
    expect(r4.definition).not.toContain('AC4.1')
    expect(resolveId(lex, 'AC5.1')?.kind).toBe('criterion')
    const adr6 = resolveId(lex, 'ADR-6')!
    expect(adr6.kind).toBe('decision')
    expect(adr6.body.length).toBeGreaterThan(0)
    expect(adr6.body).not.toContain('**Rejected:**')
  })

  it('amended ADRs carry their qualifiers (mdtoc in-place, wordfreq appended)', () => {
    const mdtoc = buildLexicon({ plan: read('runs/mdtoc/plan.md') })
    expect(resolveId(mdtoc, 'ADR-4')?.qualifier).toContain('amended')
    const wordfreq = buildLexicon({ plan: read('runs/wordfreq/plan.md') })
    expect(resolveId(wordfreq, 'ADR-8')?.qualifier).toContain('amendment')
    expect(resolveId(wordfreq, 'ADR-4')?.qualifier).toBeUndefined()
  })
})

describe('browser-safe leaf', () => {
  it('lexicon.ts imports nothing — its exports may be served as data and its grammar shared with the browser', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/view-model/lexicon.ts', import.meta.url)), 'utf8')
    expect(/^\s*import\b/m.test(src)).toBe(false)
  })
})
