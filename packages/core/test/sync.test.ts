// PR-approval sync: plan (dry-run) and apply against the fixture repo, with a
// fake provider standing in for GitHub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySync, planSync, planSyncForSource, type PrApproval, type PrProvider } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext

beforeEach(async () => {
  ctx = await makeFixture()
})
afterEach(() => dropFixture(ctx))

const providerWith = (byBranch: Record<string, PrApproval>): PrProvider => ({
  approval: async (branch) => byBranch[branch] ?? null,
})

const APPROVAL: PrApproval = {
  number: 7,
  url: 'https://github.example/pr/7',
  reviewer: 'reviewer-jane',
  submittedAt: '2026-07-08T14:30:00Z',
}

describe('planSync', () => {
  it('plans only undecided-G2 runs whose PR carries an approval', async () => {
    const provider = providerWith({
      'run/g2-pending': APPROVAL, // G2 undecided → planned
      'run/g3-pending': { ...APPROVAL, number: 8 }, // G2 already approved → skipped
      'run/g0-pending': { ...APPROVAL, number: 9 }, // G2 undecided too — sync records the fact
    })
    const plan = await planSync(ctx.source, provider)
    const slugs = plan.map((p) => p.slug).sort()
    expect(slugs).toEqual(['g0-pending', 'g2-pending'])
    expect(plan[0]!.message).toMatch(/synced from PR #/)
  })

  it('plans nothing when no PR is approved', async () => {
    expect(await planSync(ctx.source, providerWith({}))).toEqual([])
  })
})

describe('applySync', () => {
  it('records the PR reviewer and review time, preserves comments, leaves phase alone', async () => {
    const provider = providerWith({ 'run/g2-pending': APPROVAL })
    const plan = await planSync(ctx.source, provider)
    const results = await applySync(ctx.source, plan)
    expect(results).toHaveLength(1)
    expect(results[0]!.ok).toBe(true)

    const ref = (await ctx.source.listRuns()).find((r) => r.slug === 'g2-pending')!
    const { state, raw } = await ctx.source.readState(ref)
    expect(state!.gates.G2).toMatchObject({
      approved: true,
      by: 'reviewer-jane',
      at: '2026-07-08T14:30:00Z',
    })
    expect(state!.gates.G2.notes).toContain('PR #7')
    expect(state!.gates.G2.burden).toBeNull() // sync cannot know review burden
    expect(state!.phase).toBe('implement') // recording a fact is not orchestrating
    expect(raw).toContain('# a gate entry is written ONLY by the named human')

    // Idempotent: a second sync finds nothing to do.
    expect(await planSync(ctx.source, provider)).toEqual([])
  })
})

describe('planSyncForSource', () => {
  it("returns 'local-only' without ever invoking the provider factory when the source is local-only", async () => {
    const localOnlySource = Object.assign(Object.create(Object.getPrototypeOf(ctx.source)), ctx.source, {
      localOnly: true,
    })
    const factory = vi.fn(() => providerWith({ 'run/g2-pending': APPROVAL }))

    const result = await planSyncForSource(localOnlySource, factory)

    expect(result).toBe('local-only')
    expect(factory).not.toHaveBeenCalled()
  })

  it('delegates to planSync and returns its plan when localOnly is absent', async () => {
    const provider = providerWith({ 'run/g2-pending': APPROVAL })
    const factory = vi.fn(() => provider)

    const result = await planSyncForSource(ctx.source, factory)

    expect(factory).toHaveBeenCalledTimes(1)
    expect(result).toEqual(await planSync(ctx.source, provider))
  })
})
