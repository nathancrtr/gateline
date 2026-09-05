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
  it('plans only runs whose G2 is on the table, with its packet landed, and whose PR carries an approval', async () => {
    const provider = providerWith({
      'run/g2-pending': APPROVAL, // G2 on the table, packet complete → planned
      'run/g3-pending': { ...APPROVAL, number: 8 }, // G2 already approved → skipped
      'run/g0-pending': { ...APPROVAL, number: 9 }, // still at spec → skipped
    })
    const plan = await planSync(ctx.source, provider)
    const slugs = plan.map((p) => p.slug).sort()
    expect(slugs).toEqual(['g2-pending'])
    expect(plan[0]!.message).toMatch(/synced from PR #/)
  })

  // #344: the draft PR exists from the moment the run is armed, so an Approve
  // on it can land long before G2 is anyone's question. Copying it in gave the
  // engine's D5 rule an approved gate to advance on, skipping the phases the
  // gate is supposed to gate.
  it('leaves a run that has not reached G2 alone, however early the PR was approved', async () => {
    const provider = providerWith({ 'run/g0-pending': APPROVAL, 'run/g1-pending': { ...APPROVAL, number: 8 } })
    expect(await planSync(ctx.source, provider)).toEqual([])
  })

  it('leaves a run in implement alone until G2’s own evidence has landed', async () => {
    // `escalated` is at implement with G0 and G1 signed — G2 is next by phase
    // order — but its one task is still in-progress and it has no reviews.
    const provider = providerWith({ 'run/escalated': APPROVAL })
    expect(await planSync(ctx.source, provider)).toEqual([])
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
