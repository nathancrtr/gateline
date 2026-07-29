// The derivation rules against real files: every fixture run state derives
// the action the design table calls for — the acceptance twin of the
// per-row unit tests in derive.test.ts.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { generateFixtureRepo } from '@agentic/fixtures'
import { LocalGitSource } from '@agentic/core'
import { deriveAll } from '../src/tick.ts'
import type { DerivedAction } from '../src/derive.ts'

const dir = mkdtempSync(join(tmpdir(), 'agentic-orch-fixture-'))
generateFixtureRepo(dir)
const source = new LocalGitSource('fixture', dir)
const estimates = { analyst: 2, architect: 5, implementer: 8, reviewer: 4, verifier: 6, ops: 2 }

afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function actions(): Promise<Record<string, DerivedAction>> {
  const out: Record<string, DerivedAction> = {}
  for (const { ref, action } of await deriveAll(source, { estimates })) out[ref.slug] = action
  return out
}

describe('dry-run tick over the fixture repo', () => {
  it('derives the designed action for every fixture state', async () => {
    const bySlug = await actions()

    // Gate waits are rest states — that is the point of a stateless reconciler.
    expect(bySlug['g0-pending']).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(bySlug['g1-pending']).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(bySlug['g2-pending']).toMatchObject({ kind: 'rest', rule: 'D10' })
    expect(bySlug['g3-pending']).toMatchObject({ kind: 'rest', rule: 'D10' })

    // Humans own escalations, pauses, and malformed state; the engine rests.
    expect(bySlug['escalated']).toMatchObject({ kind: 'rest', rule: 'D3' })
    expect(bySlug['paused-budget']).toMatchObject({ kind: 'rest', rule: 'D2' })
    expect(bySlug['bad-state']).toMatchObject({ kind: 'rest', rule: 'D0' })
    expect(bySlug['done-merged']).toMatchObject({ kind: 'rest', rule: 'D1' })

    // The round-cap breach escalates and pauses.
    expect(bySlug['round-cap']).toMatchObject({ kind: 'escalate', rule: 'D4', pause: 'round-cap' })

    // The malformed spec bounces back to the analyst naming its missing sections.
    const bounce = bySlug['malformed-spec']!
    expect(bounce).toMatchObject({ kind: 'dispatch', rule: 'D7' })
    if (bounce.kind === 'dispatch') {
      expect(bounce.dispatches[0]!.role).toBe('analyst')
      expect(bounce.dispatches[0]!.bounce).toMatchObject({ kind: 'malformed', artifact: 'spec.md' })
      const missing = (bounce.dispatches[0]!.bounce as { missing: string[] }).missing
      expect(missing).toContain('Requirements')
      expect(missing).toContain('Assumptions')
    }
  })

  it('reads the hand-recorded v0 ledger of the merged run (M0 exit shape)', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'done-merged')!
    const { observeRun } = await import('../src/observe.ts')
    const obs = await observeRun(source, ref, { estimates })
    expect(obs.ledger).toHaveLength(5)
    expect(obs.ledgerSpentUsd).toBeCloseTo(6.4, 5)
    expect(obs.openDispatches).toHaveLength(0)
    // The copilot-reviewed entry meters by static estimate: tokens null, cost real.
    const reviewer = obs.ledger.find((e) => e.role === 'reviewer')!
    expect(reviewer.tokens_in).toBeNull()
    expect(reviewer.cost_usd).toBe(1.1)
  })
})
