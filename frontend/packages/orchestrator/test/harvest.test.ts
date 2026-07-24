// Role-scoped harvest pathspecs (run "runner-agent" ADR-3, review-04.md F1).
import { describe, expect, it } from 'vitest'
import { harvestPathspecs } from '../src/harvest.ts'

describe('harvestPathspecs', () => {
  it('scopes analyst to its own spec.md', () => {
    expect(harvestPathspecs('runs', 'toy', 'analyst', null)).toEqual(['runs/toy/spec.md'])
  })

  it('scopes architect to plan.md and the tasks directory', () => {
    expect(harvestPathspecs('runs', 'toy', 'architect', null)).toEqual(['runs/toy/plan.md', 'runs/toy/tasks/'])
  })

  it('scopes reviewer to a glob covering every review round', () => {
    expect(harvestPathspecs('runs', 'toy', 'reviewer', '01-core')).toEqual(['runs/toy/review-*.md'])
  })

  it('scopes ops to its own release-plan.md', () => {
    expect(harvestPathspecs('runs', 'toy', 'ops', null)).toEqual(['runs/toy/release-plan.md'])
  })

  it('harvests everything for implementer (task-specific surface, policed by review not git)', () => {
    expect(harvestPathspecs('runs', 'toy', 'implementer', '01-core')).toEqual(['.'])
  })

  it('harvests everything for verifier (may commit tests, not just its report)', () => {
    expect(harvestPathspecs('runs', 'toy', 'verifier', null)).toEqual(['.'])
  })

  it('harvests everything for a role with no fixed artifact (default fallback)', () => {
    expect(harvestPathspecs('runs', 'toy', 'historian', null)).toEqual(['.'])
  })

  it('honors a non-default runsRoot (integrate.py --layout prefixed hosts)', () => {
    expect(harvestPathspecs('.agentic/runs', 'toy', 'analyst', null)).toEqual(['.agentic/runs/toy/spec.md'])
  })
})
