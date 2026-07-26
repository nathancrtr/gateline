// Best-effort escalation recovery (R1) — parseRunState's schema-failure
// branch — and the two view-model derivations that read the recovered list
// (R2, R3). Inline YAML strings exercise the parser directly (AC1.1–AC1.4);
// a test-local fixture run (git branch + hand-written state.yaml, the
// `addPausedRun` idiom from readiness.test.ts) exercises the view-model
// plumbing end to end (AC2.3). This file does not touch readiness.test.ts or
// the shared @agentic/fixtures generator — those belong to other tasks.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildPortfolio, deriveReadiness, parseRunState, type RunRef } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

describe('parseRunState best-effort escalation recovery (R1)', () => {
  it('AC1.1: an out-of-enum phase with well-formed escalations recovers the list; state stays null, error unchanged', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: bogus-phase
profile: patch
gates:
  G1: {approved: false}
  G2: {approved: false}
tasks: []
escalations:
  - at: '2026-07-01T00:00:00Z'
    from_role: implementer
    reason: something broke
    resolved: false
  - at: '2026-07-02T00:00:00Z'
    from_role: verifier
    reason: second thing
    resolved: true
`
    const result = parseRunState(yaml)
    expect(result.state).toBeNull()
    expect(result.error).toMatch(/does not match the contract/)
    expect(result.error).toMatch(/phase/)
    expect(result.bestEffortEscalations).toEqual([
      {
        at: '2026-07-01T00:00:00Z',
        from_role: 'implementer',
        reason: 'something broke',
        resolved: false,
        resolved_by: null,
        resolved_at: null,
        resolution: null,
      },
      {
        at: '2026-07-02T00:00:00Z',
        from_role: 'verifier',
        reason: 'second thing',
        resolved: true,
        resolved_by: null,
        resolved_at: null,
        resolution: null,
      },
    ])
  })

  it('AC1.3: a malformed escalation entry (resolved as a string) recovers nothing, even though a well-formed sibling entry sits right beside it', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: plan
profile: patch
gates:
  G1: {approved: false}
  G2: {approved: false}
tasks: []
escalations:
  - at: '2026-07-01T00:00:00Z'
    from_role: implementer
    reason: a well-formed sibling entry
    resolved: false
  - reason: something broke
    resolved: "false"
`
    const result = parseRunState(yaml)
    expect(result.state).toBeNull()
    expect('bestEffortEscalations' in result).toBe(false)
  })

  it('AC1.3: a malformed escalation entry (missing reason) recovers nothing, even though a well-formed sibling entry sits right beside it', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: plan
profile: patch
gates:
  G1: {approved: false}
  G2: {approved: false}
tasks: []
escalations:
  - at: '2026-07-01T00:00:00Z'
    from_role: implementer
    reason: a well-formed sibling entry
    resolved: false
  - resolved: false
`
    const result = parseRunState(yaml)
    expect(result.state).toBeNull()
    expect('bestEffortEscalations' in result).toBe(false)
  })

  it('AC1.4: extra violations in tasks/gates still recover only escalations — state stays null, nothing else reconstructed', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: bogus-phase
profile: patch
gates:
  G1: {approved: "yes"}
  G2: {approved: false}
tasks:
  - status: pending
escalations:
  - from_role: implementer
    reason: something broke
    resolved: false
`
    const result = parseRunState(yaml)
    expect(result.state).toBeNull()
    expect(result.bestEffortEscalations).toEqual([
      { at: null, from_role: 'implementer', reason: 'something broke', resolved: false, resolved_by: null, resolved_at: null, resolution: null },
    ])
  })

  it('absent escalations key recovers nothing', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: bogus-phase
profile: patch
gates:
  G1: {approved: false}
  G2: {approved: false}
tasks: []
`
    const result = parseRunState(yaml)
    expect(result.state).toBeNull()
    expect('bestEffortEscalations' in result).toBe(false)
  })

  it('a valid document never carries the bestEffortEscalations field', () => {
    const yaml = `
run: test-run
branch: run/test-run
phase: plan
profile: patch
gates:
  G1: {approved: false}
  G2: {approved: false}
tasks: []
escalations:
  - reason: something broke
    resolved: false
`
    const result = parseRunState(yaml)
    expect(result.state).not.toBeNull()
    expect(result.error).toBeNull()
    expect('bestEffortEscalations' in result).toBe(false)
  })

  it('AC1.2: the existing YAML-parse-failure fixture recovers nothing — byte-for-byte unchanged', () => {
    // Copied verbatim from the `bad-state` fixture in frontend/fixtures/src/index.ts.
    const badStateYaml = 'run: bad-state\nbranch: run/bad-state\nphase: [this is\n  not: valid yaml for a phase\n'
    const result = parseRunState(badStateYaml)
    expect(result).toEqual({
      state: null,
      error:
        'state.yaml is not valid YAML: Implicit keys of flow sequence pairs need to be on a single line at line 3, column 9:\n\nphase: [this is\n        ^\n',
    })
    expect('bestEffortEscalations' in result).toBe(false)
  })
})

// --- AC2.3 / R3 end to end: a test-local schema-invalid run reached through
// git, buildPortfolio, and deriveReadiness — not the shared fixture generator
// (task 02 owns the shared `esc-recovered` run).
const DAY = 86_400

function addSchemaInvalidRun(dir: string, slug: string, now: number): void {
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  const runDir = join(dir, 'runs', slug)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, 'intent-brief.md'),
    '# Intent Brief: schema-invalid fixture\n\n## Problem\n\n## Motivation\n\n## Constraints\n\n## Out of scope\n',
    'utf8',
  )
  const at = (daysAgo: number) => new Date((now - daysAgo * DAY) * 1000).toISOString()
  writeFileSync(
    join(runDir, 'state.yaml'),
    `run: ${slug}
branch: run/${slug}
phase: verifying
profile: patch

gates:
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}

tasks:
  []

escalations:
  - at: '${at(1)}'
    reason: 'Requirement R2 is ambiguous about rounding'
    resolved: false
  - at: '${at(2)}'
    from_role: verifier
    reason: 'AC3.1 sample data is missing from the repo'
    resolved: false
  - at: '${at(3)}'
    from_role: implementer
    reason: 'Already addressed in a follow-up commit'
    resolved: true
`,
    'utf8',
  )
  git(['add', '-A'])
  git(['commit', '-q', '-m', `state(${slug}): artifacts`])
  git(['checkout', '-q', 'main'])
}

describe('view-model derivations over a recovered escalation list (AC2.3, R3)', () => {
  let ctx: FixtureContext
  let ref: RunRef
  const slug = 'schema-invalid-escalations'

  beforeAll(async () => {
    ctx = await makeFixture()
    addSchemaInvalidRun(ctx.repo.dir, slug, ctx.repo.now)
    ref = (await ctx.source.listRuns()).find((r) => r.slug === slug)!
  })
  afterAll(() => dropFixture(ctx))

  it('buildPortfolio: RunSummary.escalationsOpen counts only the recovered unresolved entries (N=2)', async () => {
    const { runs } = await buildPortfolio([ctx.source])
    const summary = runs.find((r) => r.slug === slug)!
    expect(summary.malformed).not.toBeNull()
    expect(summary.escalationsOpen).toBe(2)
  })

  it('deriveReadiness: the malformed item leads, followed by one non-reviewable escalation item per open recovered entry', async () => {
    const { items } = await deriveReadiness(ctx.source, ref)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ kind: 'malformed', reviewable: false })

    const escalationItems = items.slice(1)
    for (const item of escalationItems) {
      expect(item).toMatchObject({
        kind: 'escalation',
        reviewable: false,
        escalationIndex: null,
        packet: ['state.yaml'],
        problems: [],
      })
    }
    // First entry omits from_role entirely — pins the `?? 'unknown role'` fallback.
    expect(escalationItems[0]!.title).toBe('Escalation from unknown role')
    expect(escalationItems[0]!.detail).toBe('Requirement R2 is ambiguous about rounding')
    expect(escalationItems[0]!.since).toBe(ctx.repo.now - 1 * DAY)
    expect(escalationItems[1]!.title).toBe('Escalation from verifier')
    expect(escalationItems[1]!.detail).toBe('AC3.1 sample data is missing from the repo')
    expect(escalationItems[1]!.since).toBe(ctx.repo.now - 2 * DAY)
  })
})
