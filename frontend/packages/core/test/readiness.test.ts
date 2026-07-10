// One test per row of the plan §2.3 readiness table, against the fixture repo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deriveReadiness, buildPortfolio, type RunRef } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
let refs: Map<string, RunRef>

beforeAll(async () => {
  ctx = await makeFixture()
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

describe('run discovery', () => {
  it('finds every fixture run, branch-backed and merged', () => {
    const slugs = [...refs.keys()].sort()
    expect(slugs).toEqual([
      'bad-state',
      'done-merged',
      'escalated',
      'g0-pending',
      'g1-pending',
      'g2-pending',
      'g3-pending',
      'malformed-spec',
      'paused-budget',
      'round-cap',
    ])
    expect(refs.get('done-merged')!.kind).toBe('default')
    expect(refs.get('g0-pending')!.kind).toBe('branch')
  })
})

describe('readiness derivation (§2.3, one row per test)', () => {
  const gateItem = async (slug: string) => {
    const { items } = await deriveReadiness(ctx.source, refs.get(slug)!)
    return items
  }

  it('G0 ready: phase=spec ∧ spec present ∧ well-formed ∧ ¬G0', async () => {
    const items = await gateItem('g0-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: true })
    expect(items[0]!.packet).toEqual(['intent-brief.md', 'spec.md'])
    expect(items[0]!.since).toBeGreaterThan(0)
  })

  it('G1 ready: phase=plan ∧ plan + tasks present ∧ ¬G1', async () => {
    const items = await gateItem('g1-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G1', reviewable: true })
    expect(items[0]!.packet).toContain('plan.md')
    expect(items[0]!.packet).toContain('tasks/01-core.yaml')
  })

  it('G2 ready: all tasks complete ∧ reviews + verification present ∧ ¬G2', async () => {
    const items = await gateItem('g2-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G2', reviewable: true })
    expect(items[0]!.packet).toContain('verification-report.md')
    expect(items[0]!.packet).toContain('review-01.md')
  })

  it('G3 ready: phase=release ∧ release-plan present ∧ ¬G3', async () => {
    const items = await gateItem('g3-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G3', reviewable: true })
  })

  it('escalation: unresolved escalations[] entry surfaces with age', async () => {
    const items = await gateItem('escalated')
    const esc = items.find((i) => i.kind === 'escalation')
    expect(esc).toBeDefined()
    expect(esc!.escalationIndex).toBe(0)
    expect(esc!.detail).toMatch(/unverifiable/)
    expect(esc!.since).toBeGreaterThan(0)
  })

  it('round-cap: review_rounds ≥ 3 on an unfinished task', async () => {
    const items = await gateItem('round-cap')
    const cap = items.find((i) => i.kind === 'round-cap')
    expect(cap).toBeDefined()
    expect(cap!.title).toContain('01-core')
    expect(cap!.packet).toContain('review-03.md')
  })

  it('paused: phase=paused surfaces resume/kill decision', async () => {
    const items = await gateItem('paused-budget')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused' })
    expect(items[0]!.title).toContain('budget-exhausted')
  })

  it('R3: malformed spec yields a NON-reviewable gate item (bounce)', async () => {
    const items = await gateItem('malformed-spec')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G0', reviewable: false })
    expect(items[0]!.problems.join(' ')).toMatch(/Requirements/)
    expect(items[0]!.problems.join(' ')).toMatch(/Assumptions/)
  })

  it('malformed state.yaml surfaces as a malformed-run item, never guessed around', async () => {
    const items = await gateItem('bad-state')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'malformed', reviewable: false })
  })

  it('done run needs nothing', async () => {
    const items = await gateItem('done-merged')
    expect(items).toHaveLength(0)
  })
})

describe('inbox ordering', () => {
  it('ranks oldest first: the 7-day-old escalation leads the queue', async () => {
    const { inbox, runs } = await buildPortfolio([ctx.source])
    expect(inbox.length).toBeGreaterThanOrEqual(8)
    expect(inbox[0]!.slug).toBe('escalated')
    expect(inbox[0]!.kind).toBe('escalation')
    const done = runs.find((r) => r.slug === 'done-merged')!
    expect(done.needsHuman).toBe(0)
    expect(done.gates.G3.approved).toBe(true)
  })
})
