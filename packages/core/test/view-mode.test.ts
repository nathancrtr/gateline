// A `view` repository is written to by nothing (#495, docs/MULTI-REPO.md
// §7.3). The rule lives in the source's own write methods, so every caller —
// the server's routes, the CLI's verbs, PR-review sync — meets it without
// having to remember it. `decide` and `dispatch` record decisions; a source
// built with no mode (the engine's own) refuses nothing. Messages are literals.
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applySync, LocalGitSource, planDecision, planRunScaffold, type RepositoryMode, type RunSource } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
beforeAll(async () => {
  ctx = await makeFixture()
})
afterAll(() => dropFixture(ctx))

const who = { name: 'Fixture Operator', email: 'operator@example.test' }
const source = (mode?: RepositoryMode) =>
  new LocalGitSource('github.com/acme/billing', ctx.repo.dir, { displayName: 'billing', ...(mode ? { mode } : {}) })
const tip = (branch: string) =>
  execFileSync('git', ['-C', ctx.repo.dir, 'rev-parse', '--verify', '--quiet', branch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const REFUSAL =
  'billing (github.com/acme/billing) is in view mode: it is read here and nothing is written to it. ' +
  'To record decisions in it, set `mode: decide` on its entry in the config file'

async function approveG0(s: RunSource) {
  const ref = (await s.listRuns()).find((r) => r.slug === 'g0-pending')!
  const { state } = await s.readState(ref)
  const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, who)
  return { ref, result: await s.writeState(ref, planned.mutate, planned.message) }
}

const scaffold = (slug: string) =>
  planRunScaffold({
    slug,
    title: 'CSV export',
    profile: 'standard',
    briefMarkdown: '# Intent Brief: CSV export\n\n## Problem\nx\n\n## Motivation\nx\n\n## Constraints\nx\n\n## Out of scope\nx\n',
    costLimitUsd: 10,
    intake: { source: null, ref: null, url: null, clientKey: null },
    stagedBy: who.name,
  })

describe('a view source refuses every write', () => {
  it('writeState: refused, and the branch does not move', async () => {
    const before = tip('run/g0-pending')
    const { result } = await approveG0(source('view'))
    expect(result).toEqual({ ok: false, reason: 'view-mode', message: REFUSAL })
    expect(tip('run/g0-pending')).toBe(before)
  })

  it('stageRun: refused, and no branch is minted', async () => {
    const outcome = await source('view').stageRun(scaffold('view-staged'), who)
    expect(outcome).toEqual({ outcome: 'refused', reason: 'view-mode', message: REFUSAL })
    expect(() => tip('run/view-staged')).toThrow()
  })

  it('PR-review sync (applySync, the webhook and `sync --live` path): refused per entry', async () => {
    const results = await applySync(source('view'), [
      {
        source: 'github.com/acme/billing',
        slug: 'g2-pending',
        gate: 'G2',
        approval: { number: 7, url: 'https://github.com/acme/billing/pull/7', reviewer: 'reviewer', submittedAt: '2026-09-26T00:00:00Z' },
        message: 'state(g2-pending): G2 approved by reviewer via PR #7',
      },
    ])
    expect(results.map((r) => [r.ok, r.error])).toEqual([[false, REFUSAL]])
  })
})

describe('decide and dispatch record decisions, and no mode restricts nothing', () => {
  it.each(['decide', 'dispatch', undefined] as const)('mode %s: writeState and stageRun succeed', async (mode) => {
    const fx = await makeFixture()
    try {
      const s = new LocalGitSource('github.com/acme/billing', fx.repo.dir, mode ? { mode } : {})
      const { result } = await approveG0(s)
      expect(result.ok).toBe(true)
      const staged = await s.stageRun(scaffold(`staged-${mode ?? 'none'}`), who)
      expect(staged.outcome).toBe('created')
    } finally {
      await dropFixture(fx)
    }
  })
})
