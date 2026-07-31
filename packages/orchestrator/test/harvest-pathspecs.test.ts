// Role-scoped harvest pathspecs — the shared mapping run "runner-agent"
// ADR-3 (the remote worker) and #182 (the local non-isolated harvest-commit,
// engine.ts) both consume. See harvest.test.ts for the local harvest-commit
// mechanism's own integration tests through a real Engine.
import { describe, expect, it } from 'vitest'
import { harvestPathspecs } from '../src/harvest.ts'

describe('harvestPathspecs', () => {
  it('scopes analyst to its own spec.md', () => {
    expect(harvestPathspecs('runs', 'toy', 'analyst', null)).toEqual(['runs/toy/spec.md'])
  })

  it('scopes architect to plan.md and the tasks directory', () => {
    expect(harvestPathspecs('runs', 'toy', 'architect', null)).toEqual(['runs/toy/plan.md', 'runs/toy/tasks/'])
  })

  it('scopes reviewer to a glob covering every round of a known task', () => {
    expect(harvestPathspecs('runs', 'toy', 'reviewer', '01-core')).toEqual(['runs/toy/review-01*.md'])
  })

  it('scopes reviewer to every review file when no task number is known', () => {
    expect(harvestPathspecs('runs', 'toy', 'reviewer', null)).toEqual(['runs/toy/review-*.md'])
  })

  it('scopes verifier to its own verification-report.md', () => {
    expect(harvestPathspecs('runs', 'toy', 'verifier', null)).toEqual(['runs/toy/verification-report.md'])
  })

  it('scopes ops to its own release-plan.md', () => {
    expect(harvestPathspecs('runs', 'toy', 'ops', null)).toEqual(['runs/toy/release-plan.md'])
  })

  it('harvests everything for implementer (task-specific surface, spanning arbitrary source files, policed by review not git)', () => {
    expect(harvestPathspecs('runs', 'toy', 'implementer', '01-core')).toEqual(['.'])
  })

  it('scopes a role with no fixed artifact to the run\'s own directory (default fallback)', () => {
    expect(harvestPathspecs('runs', 'toy', 'historian', null)).toEqual(['runs/toy/'])
  })

  it('honors a non-default runsRoot (integrate.py --layout prefixed hosts)', () => {
    expect(harvestPathspecs('.gateline/runs', 'toy', 'analyst', null)).toEqual(['.gateline/runs/toy/spec.md'])
  })
})
