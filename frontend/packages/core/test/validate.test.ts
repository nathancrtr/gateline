import { describe, expect, it } from 'vitest'
import { contractFor, extractSections, validateArtifact, type ContractTemplates } from '../src/index.ts'

const noTemplates: ContractTemplates = { read: async () => null }

describe('contractFor', () => {
  it('maps run-relative paths to contract templates', () => {
    expect(contractFor('spec.md')).toBe('spec.md')
    expect(contractFor('review-01.md')).toBe('review-report.md')
    expect(contractFor('review-03-round2.md')).toBe('review-report.md')
    expect(contractFor('tasks/01-core.yaml')).toBe('work-item.yaml')
    expect(contractFor('retro.md')).toBeNull()
    expect(contractFor('release-plan.md')).toBeNull()
  })
})

describe('extractSections', () => {
  it('reads H2s and ignores headings inside code fences', () => {
    const md = '# T\n\n## Real\n\n```\n## Not a heading\n```\n\n## Also real\n'
    expect(extractSections(md)).toEqual(['Real', 'Also real'])
  })
})

describe('validateArtifact', () => {
  it('falls back to built-in sections when the repo has no contracts/', async () => {
    const good = '# Spec\n\n## Context\nx\n\n## Requirements\nx\n\n## Assumptions\nx\n\n## Out of scope\nx\n'
    const v = await validateArtifact('spec.md', good, noTemplates)
    expect(v.ok).toBe(true)
    expect(v.notes[0]).toMatch(/built-in/)
  })

  it('reports missing sections by name', async () => {
    const bad = '# Spec\n\n## Context\nx\n\n## Out of scope\nx\n'
    const v = await validateArtifact('spec.md', bad, noTemplates)
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(['Requirements', 'Assumptions'])
  })

  it('prefers the repo’s own template over built-ins (fork support)', async () => {
    const forked: ContractTemplates = {
      read: async (name) => (name === 'spec.md' ? '# Spec\n\n## Goals\n\n## Non-goals\n' : null),
    }
    const v = await validateArtifact('spec.md', '# S\n\n## Goals\nx\n\n## Non-goals\nx\n', forked)
    expect(v.ok).toBe(true)
    const v2 = await validateArtifact('spec.md', '# S\n\n## Context\nx\n\n## Requirements\nx\n\n## Assumptions\nx\n\n## Out of scope\nx\n', forked)
    expect(v2.ok).toBe(false)
    expect(v2.missing).toEqual(['Goals', 'Non-goals'])
  })

  it('validates work-item required keys', async () => {
    const v = await validateArtifact('tasks/01-x.yaml', 'id: 01-x\ntitle: t\nstatus: pending\n', noTemplates)
    expect(v.ok).toBe(false)
    expect(v.missing).toContain('scope')
    expect(v.missing).toContain('acceptance_tests')
  })

  it('flags unparseable YAML rather than guessing', async () => {
    const v = await validateArtifact('tasks/01-x.yaml', 'id: [unclosed\n', noTemplates)
    expect(v.ok).toBe(false)
    expect(v.notes.join(' ')).toMatch(/not valid YAML/)
  })
})
