import { describe, expect, it } from 'vitest'
import { contractFor, extractAudience, extractSections, missingSections, validateArtifact, type ContractTemplates } from '../src/index.ts'

const noTemplates: ContractTemplates = { read: async () => null }

describe('contractFor', () => {
  it('maps run-relative paths to contract templates', () => {
    expect(contractFor('spec.md')).toBe('spec.md')
    expect(contractFor('review-01.md')).toBe('review-report.md')
    expect(contractFor('review-03-round2.md')).toBe('review-report.md')
    expect(contractFor('tasks/01-core.yaml')).toBe('work-item.yaml')
    expect(contractFor('retro.md')).toBeNull()
  })

  it('G3’s packet has a contract too (#260) — presence is no longer the whole check', () => {
    expect(contractFor('release-plan.md')).toBe('release-plan.md')
  })
})

describe('extractSections', () => {
  it('reads H2s and ignores headings inside code fences', () => {
    const md = '# T\n\n## Real\n\n```\n## Not a heading\n```\n\n## Also real\n'
    expect(extractSections(md)).toEqual(['Real', 'Also real'])
  })
})

describe('missingSections', () => {
  it('reports no missing sections on an exact match', () => {
    const md = '# Brief\n\n## Problem\nx\n\n## Motivation\nx\n'
    expect(missingSections(md, ['Problem', 'Motivation'])).toEqual([])
  })

  it('matches headings case- and punctuation-insensitively (normalize semantics)', () => {
    const md = '# Brief\n\n## Out-of-Scope!!\nx\n'
    expect(missingSections(md, ['Out of scope'])).toEqual([])
  })

  it('ignores headings inside fenced code blocks (extractSections semantics)', () => {
    const md = '# Brief\n\n```\n## Constraints\n```\n'
    expect(missingSections(md, ['Constraints'])).toEqual(['Constraints'])
  })

  it('reports every required section as missing for empty content', () => {
    expect(missingSections('', ['Problem', 'Motivation'])).toEqual(['Problem', 'Motivation'])
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

  it('bounces a release plan missing its required sections (#260)', async () => {
    const thin = '# Release Plan: run\n\n## Release steps\n1. Ship it.\n'
    const v = await validateArtifact('release-plan.md', thin, noTemplates)
    expect(v.ok).toBe(false)
    expect(v.missing).toEqual(['CI health', 'Rollback plan', 'Verification after release', 'Blast radius'])
  })

  it('passes a release plan carrying every section', async () => {
    const full =
      '# Release Plan: run\n\n## CI health\nx\n\n## Release steps\n1. x\n\n## Rollback plan\nx\n\n## Verification after release\nx\n\n## Blast radius\nx\n'
    expect((await validateArtifact('release-plan.md', full, noTemplates)).ok).toBe(true)
  })

  it('reads the repo’s own release-plan contract, so a fork keeps its own sections', async () => {
    const forked: ContractTemplates = {
      read: async (name) => (name === 'release-plan.md' ? '# Release Plan\n\n## Steps\n\n## Undo\n' : null),
    }
    const v = await validateArtifact('release-plan.md', '# R\n\n## Steps\nx\n\n## Undo\nx\n', forked)
    expect(v.ok).toBe(true)
    expect(v.notes).toEqual([])
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

describe('AUDIENCE (#217)', () => {
  it('parses the annotation line into normalized heading → audience', () => {
    const tpl = '# Review\n\n<!-- prose\n     AUDIENCE: Coverage=audit; Boundary check=audit -->\n\n## Findings\n\n## Coverage\n\n## Boundary check\n'
    expect(extractAudience(tpl)).toEqual({ coverage: 'audit', 'boundary check': 'audit' })
  })

  it('ignores an unknown audience word and a pair without =', () => {
    expect(extractAudience('AUDIENCE: Coverage=later; Findings')).toEqual({})
  })

  it('reads the line with content after the comment close, and never inside a fence', () => {
    expect(extractAudience('<!-- AUDIENCE: Coverage=audit --> ## trailing')).toEqual({ coverage: 'audit' })
    expect(extractAudience('```\nAUDIENCE: Coverage=audit\n```\n')).toEqual({})
  })

  it('a template with the line yields its audit-time sections, spelled as the template spells them', async () => {
    const templates: ContractTemplates = {
      read: async () => '# Review\n\n<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->\n\n## Findings\n\n## Coverage\n\n## Boundary check\n',
    }
    const v = await validateArtifact('review-01.md', '## Findings\n\n## Coverage\n\n## Boundary check\n', templates)
    expect(v.ok).toBe(true)
    expect(v.audit).toEqual(['Coverage', 'Boundary check'])
  })

  it('a template without the line folds nothing — it renders exactly as before', async () => {
    const templates: ContractTemplates = { read: async () => '# Review\n\n## Findings\n\n## Coverage\n\n## Boundary check\n' }
    const v = await validateArtifact('review-01.md', '## Findings\n\n## Coverage\n\n## Boundary check\n', templates)
    expect(v.audit).toEqual([])
  })

  it('no contracts/ at all falls back to the built-in audit list, as it does for sections', async () => {
    const v = await validateArtifact('spec.md', '## Context\n\n## Requirements\n\n## Assumptions\n\n## Out of scope\n', noTemplates)
    expect(v.audit).toEqual(['Out of scope'])
    expect((await validateArtifact('plan.md', '## Approach\n', noTemplates)).audit).toEqual([])
  })

  it('the repository\'s own contracts carry the line the built-ins mirror', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const read = (name: string) => readFileSync(resolve(import.meta.dirname, '../../../contracts', name), 'utf8')
    expect(extractAudience(read('review-report.md'))).toEqual({ coverage: 'audit', 'boundary check': 'audit' })
    expect(extractAudience(read('spec.md'))).toEqual({ 'out of scope': 'audit' })
  })
})
