// One test per row of the plan §2.3 readiness table, against the fixture repo.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deriveReadiness, buildPortfolio, ROUND_CAP, type RunRef } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
let refs: Map<string, RunRef>

// Staged and other-reason paused runs are added directly to the fixture repo
// (not the shared @gateline/fixtures generator — plan ADR-8 keeps that
// count-sensitive for server/e2e assertions); this mirrors divergence.test.ts's
// idiom of extending `ctx.repo.dir` with git commands from the test itself.
function addPausedRun(dir: string, slug: string, pausedReason: string | null): void {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  const runDir = join(dir, 'runs', slug)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'intent-brief.md'),
    '# Intent Brief: paused fixture\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n',
    'utf8',
  )
  writeFileSync(
    join(runDir, 'state.yaml'),
    `run: ${slug}
branch: run/${slug}
phase: paused
profile: patch
paused_reason: ${pausedReason ?? 'null'}

budget:
  cost_limit_usd: 25
  cost_spent_usd: 0
  ledger: []

gates:
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}

tasks:
  []

escalations:
  []
`,
    'utf8',
  )
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): artifacts`])
  git(['checkout', '-q', 'main'])
}

beforeAll(async () => {
  ctx = await makeFixture()
  addPausedRun(ctx.repo.dir, 'staged-run', 'staged')
  addPausedRun(ctx.repo.dir, 'paused-declined', 'gate-declined')
  addPausedRun(ctx.repo.dir, 'paused-other-reason', 'round-cap')
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

describe('run discovery', () => {
  it('finds every fixture run, branch-backed and merged', () => {
    const slugs = [...refs.keys()].sort()
    expect(slugs).toEqual([
      'bad-state',
      'closed-delivered',
      'done-merged',
      'escalated',
      'forked-contract',
      'g0-pending',
      'g1-pending',
      'g2-pending',
      'g3-pending',
      'malformed-release',
      'malformed-spec',
      'patch-g1-pending',
      'patch-g2-pending',
      'paused-budget',
      'paused-declined',
      'paused-other-reason',
      'round-cap',
      'staged-run',
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

  it('G3 bounces a release plan missing its contract’s sections (#260)', async () => {
    // Rule R3 at the last gate. Until release-plan.md had a contract this run
    // was reviewable: the file existed, so the gate was ready.
    const items = await gateItem('malformed-release')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G3', reviewable: false })
    expect(items[0]!.problems.join(' ')).toContain('release-plan.md: missing required sections')
    expect(items[0]!.problems.join(' ')).toContain('Rollback plan')
  })

  it('patch G1 ready: no plan.md — the brief + work item are the packet, G0 absorbed into the question', async () => {
    const items = await gateItem('patch-g1-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G1', reviewable: true })
    expect(items[0]!.packet).toEqual(['intent-brief.md', 'tasks/01-hotfix.yaml'])
    expect(items[0]!.title).toContain('Is this the change we want, scoped this way?')
  })

  it('patch G2 ready: reviews alone are the packet — no verification-report required', async () => {
    const items = await gateItem('patch-g2-pending')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'gate', gate: 'G2', reviewable: true })
    expect(items[0]!.packet).toEqual(['review-01.md'])
  })

  it('escalation: unresolved escalations[] entry surfaces with age', async () => {
    const items = await gateItem('escalated')
    const esc = items.find((i) => i.kind === 'escalation')
    expect(esc).toBeDefined()
    expect(esc!.escalationIndex).toBe(0)
    expect(esc!.detail).toMatch(/unverifiable/)
    expect(esc!.since).toBeGreaterThan(0)
  })

  it('round-cap: review_rounds ≥ ROUND_CAP on an unfinished task', async () => {
    const items = await gateItem('round-cap')
    const cap = items.find((i) => i.kind === 'round-cap')
    expect(cap).toBeDefined()
    expect(cap!.title).toContain('01-core')
    expect(cap!.packet).toContain('review-03.md')
  })

  it('the summary carries the cap the round-cap item was judged against, so no surface retypes it (#314)', async () => {
    const { runs } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'round-cap')!
    expect(row.tasks.roundCap).toBe(ROUND_CAP)
    expect(row.tasks.maxRounds).toBeGreaterThanOrEqual(row.tasks.roundCap)
    const fresh = runs.find((r) => r.slug === 'g1-pending')!
    expect(fresh.tasks).toMatchObject({ maxRounds: 0, roundCap: ROUND_CAP })
  })

  it('paused: phase=paused surfaces resume/kill decision', async () => {
    const items = await gateItem('paused-budget')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused' })
    expect(items[0]!.title).toContain('budget-exhausted')
  })

  it('staged: paused_reason=staged yields exactly one staged item, never a paused one (AC6.1, ADR-4)', async () => {
    const items = await gateItem('staged-run')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'staged',
      gate: null,
      title: 'Run staged: awaiting arm',
      detail: 'Arm to start the run — dispatch begins and the budget starts metering',
      reviewable: true,
      problems: [],
      escalationIndex: null,
    })
    expect(items[0]!.packet).toEqual(['state.yaml', 'intent-brief.md'])
    expect(items[0]!.since).toBeGreaterThan(0)
    expect(items.some((i) => i.kind === 'paused')).toBe(false)
    // A staged run, like a paused one, surfaces no gate item.
    expect(items.some((i) => i.kind === 'gate')).toBe(false)
  })

  it('paused with another reason still yields a paused item, not staged (mid-flight pauses unchanged)', async () => {
    const items = await gateItem('paused-other-reason')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'paused' })
    expect(items[0]!.title).toContain('round-cap')
    expect(items.some((i) => i.kind === 'staged')).toBe(false)
  })

  it('declined: paused_reason=gate-declined needs nothing — the human already answered (#200)', async () => {
    // The card this used to show said "Resume, or decline the pending gate to
    // end the run" to someone who had just declined the gate.
    expect(await gateItem('paused-declined')).toEqual([])
  })

  it('declined runs stay in the portfolio and off the inbox — decided is not deleted (#200)', async () => {
    const { runs, inbox } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'paused-declined')
    expect(row).toMatchObject({ phase: 'paused', pausedReason: 'gate-declined', needsHuman: 0 })
    expect(inbox.some((i) => i.slug === 'paused-declined')).toBe(false)
  })

  it('closed: phase=closed needs nothing, even with an unresolved escalation on the run (#200)', async () => {
    // The fixture carries an open escalation and a failed task. Both would
    // raise items on any other run; a closure answers them wholesale, so the
    // rule short-circuits ahead of every other row rather than after them.
    expect(await gateItem('closed-delivered')).toEqual([])
  })

  it('closed runs keep their disposition on the portfolio row and stay off the inbox (#200)', async () => {
    const { runs, inbox } = await buildPortfolio([ctx.source])
    const row = runs.find((r) => r.slug === 'closed-delivered')
    expect(row).toMatchObject({ phase: 'closed', needsHuman: 0 })
    // The disposition rides on the summary: every surface that renders
    // "closed" needs to say why in the same breath.
    expect(row!.closure).toMatchObject({ as: 'already-delivered', by: 'operator' })
    expect(row!.closure!.reason).toMatch(/landed by another path/)
    expect(inbox.some((i) => i.slug === 'closed-delivered')).toBe(false)
  })

  it('the paused card offers closing rather than telling the human to decline a gate (#200)', async () => {
    const items = await gateItem('paused-budget')
    expect(items[0]!.detail).toBe('Resume the run, or close it with a disposition saying why it ends here')
  })

  it('a run paused FOR an escalation shows the escalation, not a second card restating it', async () => {
    const items = await gateItem('escalated')
    expect(items.filter((i) => i.kind === 'escalation')).toHaveLength(1)
    expect(items.some((i) => i.kind === 'paused')).toBe(false)
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
