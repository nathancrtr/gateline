// describeRun: run artifacts -> draft-PR title and body (#202). Pure — no git,
// no `gh`; the I/O half is covered in pr-ensure.test.ts.
import { describe, expect, it } from 'vitest'
import { describeRun, GENERATED_MARKER, isGeneratedBody, requirementNames, sectionBody } from '../src/index.ts'

const brief = `# Intent Brief: CSV export is unusable at scale

<!-- Contract: all four sections required. -->

## Problem
Exporting rows by hand is slow and error-prone.

## Motivation
Saves roughly an afternoon per release.

## Constraints
Must run offline.

## Out of scope
Importing.
`

const spec = `# Specification: Streaming CSV export

## Context
The exporter buffers the whole result set in memory.

## Requirements

### R1 — Stream rows to disk
AC1.1 — the exporter never holds more than one page in memory.

### R2 — Progress reporting
AC2.1 — the CLI prints rows written.

## Assumptions
Rows fit the current schema.

## Out of scope
Import.
`

const base = { slug: 'csv-export', runDir: 'runs/csv-export', profile: 'standard' as const }

describe('describeRun', () => {
  it('titles from the intent brief H1 and carries its four sections', () => {
    const d = describeRun({ ...base, brief, spec: null })

    expect(d.title).toBe('CSV export is unusable at scale')
    expect(d.from).toBe('intent-brief.md')
    expect(d.body).toContain(GENERATED_MARKER)
    expect(d.body).toContain('## Problem\n\nExporting rows by hand is slow and error-prone.')
    expect(d.body).toContain('## Motivation')
    expect(d.body).toContain('## Constraints')
    expect(d.body).toContain('## Out of scope')
  })

  it('drops the contract guidance comments the brief template carries', () => {
    const d = describeRun({ ...base, brief, spec: null })

    expect(d.body).not.toContain('all four sections required')
  })

  it('records profile, gates, and run dir in the footer', () => {
    const d = describeRun({ ...base, brief, spec: null })

    expect(d.body).toContain('Run `csv-export` · profile `standard` · gates G0 G1 G2 · record `runs/csv-export/`')
    expect(d.body).toContain('`runs/csv-export/intent-brief.md`')
  })

  it('prefers the spec once one exists, listing its requirement names', () => {
    const d = describeRun({ ...base, brief, spec })

    expect(d.title).toBe('Streaming CSV export')
    expect(d.from).toBe('spec.md')
    expect(d.body).toContain('## Context\n\nThe exporter buffers the whole result set in memory.')
    expect(d.body).toContain('- R1 — Stream rows to disk')
    expect(d.body).toContain('- R2 — Progress reporting')
    // Acceptance criteria and assumptions belong to the record, not the PR body.
    expect(d.body).not.toContain('AC1.1')
    expect(d.body).not.toContain('Rows fit the current schema')
  })

  it('falls back to the brief when the spec is a bare stub', () => {
    const d = describeRun({ ...base, brief, spec: '# Specification: <title>\n\n## Context\n\n## Requirements\n' })

    expect(d.title).toBe('CSV export is unusable at scale')
    expect(d.from).toBe('intent-brief.md')
  })

  it('falls back to run/<slug> when the brief H1 is the template placeholder', () => {
    const d = describeRun({ ...base, brief: '# Intent Brief: <title>\n\n## Problem\nReal text.\n', spec: null })

    expect(d.title).toBe('run/csv-export')
    expect(d.from).toBe('intent-brief.md')
    expect(d.body).toContain('## Problem\n\nReal text.')
  })

  it('still produces a body when no artifact is readable at all', () => {
    const d = describeRun({ ...base, profile: null, brief: null, spec: null })

    expect(d.title).toBe('run/csv-export')
    expect(d.from).toBe('slug')
    expect(d.body).toContain(GENERATED_MARKER)
    expect(d.body).toContain('Run `csv-export` · record `runs/csv-export/`')
    expect(d.body).not.toContain('profile')
  })

  it('is deterministic — the same artifacts describe identically (the no-op refresh guarantee)', () => {
    expect(describeRun({ ...base, brief, spec })).toEqual(describeRun({ ...base, brief, spec }))
  })

  it('truncates a long section at a line boundary rather than mid-word', () => {
    const long = `# Intent Brief: Long\n\n## Problem\n${'- a fairly wordy bullet about the problem\n'.repeat(60)}`
    const d = describeRun({ ...base, brief: long, spec: null })

    expect(d.body).toContain('…')
    expect(d.body).toContain('- a fairly wordy bullet about the problem …')
    expect(d.body.length).toBeLessThan(1500)
  })

  it('honors a prefixed host layout in the record path', () => {
    const d = describeRun({ ...base, runDir: '.agentic/runs/csv-export', brief, spec: null })

    expect(d.body).toContain('record `.agentic/runs/csv-export/`')
    expect(d.body).toContain('`.agentic/runs/csv-export/intent-brief.md`')
  })
})

describe('isGeneratedBody', () => {
  it('recognizes a body it produced, and nothing else', () => {
    expect(isGeneratedBody(describeRun({ ...base, brief, spec: null }).body)).toBe(true)
    expect(isGeneratedBody('## Summary\nA human wrote this.')).toBe(false)
    expect(isGeneratedBody('')).toBe(false)
    expect(isGeneratedBody(null)).toBe(false)
    expect(isGeneratedBody(undefined)).toBe(false)
  })
})

describe('sectionBody', () => {
  it('reads to the next heading of the same or higher level', () => {
    expect(sectionBody(brief, 'Problem')).toBe('Exporting rows by hand is slow and error-prone.')
    expect(sectionBody(spec, 'Requirements')).toContain('### R1 — Stream rows to disk')
    expect(sectionBody(spec, 'Requirements')).not.toContain('## Assumptions')
  })

  it('matches heading names insensitive to case and punctuation', () => {
    expect(sectionBody(brief, 'out-of-scope')).toBe('Importing.')
  })

  it('returns null for an absent, empty, or comment-only section', () => {
    expect(sectionBody(brief, 'Risks')).toBeNull()
    expect(sectionBody('## Problem\n\n', 'Problem')).toBeNull()
    expect(sectionBody('## Problem\n<!-- what hurts -->\n', 'Problem')).toBeNull()
    expect(sectionBody(null, 'Problem')).toBeNull()
  })

  it('ignores headings inside fenced code blocks', () => {
    const md = '## Problem\nreal\n\n```\n## Problem\nfenced\n```\n\n## Next\nother\n'
    expect(sectionBody(md, 'Problem')).toBe('real\n\n```\n## Problem\nfenced\n```')
  })
})

describe('requirementNames', () => {
  it('reads the contract grammar and skips placeholders', () => {
    expect(requirementNames(spec)).toEqual(['R1 — Stream rows to disk', 'R2 — Progress reporting'])
    expect(requirementNames('### R1 — <short name>\n')).toEqual([])
    expect(requirementNames(null)).toEqual([])
  })
})
