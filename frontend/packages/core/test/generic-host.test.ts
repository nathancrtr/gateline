// The generic read path (R3/R4/R5): a fixture repo whose contracts/ declares
// only the core state contract (no branch/budget/tasks) reads cleanly through
// LocalGitSource and the view-model — no malformed run, no synthesized
// G0–G3, no decision cards — while this repository's own wordfreq run keeps
// its exact SDLC summary (plan "Fixture contract for the AC4.1/AC4.2 test").
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveReadiness, LocalGitSource, summarizeRun, validateArtifact } from '../src/index.ts'

// Isolate from the operator's real ~/.gitconfig, same as code-tree.test.ts.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
}

// The fixture contract from plan.md "Interface contracts" — a core instance
// with no SDLC markers (no branch/budget/tasks), gates {intake, publish}.
const CORE_STATE_TEMPLATE = `run: example
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
`

const DEMO_RUN_STATE = `run: demo
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
`

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A minimal non-SDLC host: contracts/state.yaml is the core instance above,
 * and runs/demo/ carries a run using its two declared gates. No `branch` key
 * anywhere — the fixture repo's default branch is where listRuns discovers
 * it, since a merged/branch-less run is still served from there. */
function makeGenericHostRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-generic-host-'))
  cleanups.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Toy'])
  git(dir, ['config', 'user.email', 'toy@example.com'])
  mkdirSync(join(dir, 'contracts'), { recursive: true })
  writeFileSync(join(dir, 'contracts', 'state.yaml'), CORE_STATE_TEMPLATE)
  mkdirSync(join(dir, 'runs', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'runs', 'demo', 'state.yaml'), DEMO_RUN_STATE)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

describe('generic host (core-only state contract, no SDLC markers)', () => {
  it('readState: parses without error, generic non-null (AC4.1)', async () => {
    const dir = makeGenericHostRepo()
    const source = new LocalGitSource('generic-host', dir)
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'demo')
    expect(ref).toBeDefined()
    const { error, state, generic } = await source.readState(ref!)
    expect(error).toBeNull()
    expect(state).toBeNull()
    expect(generic).not.toBeNull()
    expect(generic!.run).toBe('demo')
  })

  it('summarizeRun: phase intake, malformed null, gate keys exactly [intake, publish] (AC4.2)', async () => {
    const dir = makeGenericHostRepo()
    const source = new LocalGitSource('generic-host', dir)
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'demo')!
    const { summary } = await summarizeRun(source, ref)
    expect(summary.phase).toBe('intake')
    expect(summary.malformed).toBeNull()
    expect(Object.keys(summary.gates)).toEqual(['intake', 'publish'])
  })

  it('deriveReadiness: zero items — a well-formed generic run gets no decision cards', async () => {
    const dir = makeGenericHostRepo()
    const source = new LocalGitSource('generic-host', dir)
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'demo')!
    const readiness = await deriveReadiness(source, ref)
    expect(readiness.items).toEqual([])
  })

  it("validateArtifact('state.yaml', ...) resolves against the fixture source's own templates: ok true (AC4.3)", async () => {
    const dir = makeGenericHostRepo()
    const source = new LocalGitSource('generic-host', dir)
    const v = await validateArtifact('state.yaml', DEMO_RUN_STATE, source.templates)
    expect(v.ok).toBe(true)
    expect(v.missing).toEqual([])
  })
})

// Kill fixture (review-04 F1/F2): the contract declares three gates in
// order intake/review/publish; the run file lists two of them out of that
// order (publish before intake) and omits `review` entirely, has no `phase`
// key, a non-null paused_reason, and one resolved plus one unresolved
// escalation. This discriminates `generic.gateOrder` (contract order) from
// `Object.keys(generic.gates)` (file order, and missing `review` outright),
// the absent-gate undecided-cell fallback from an unguarded `cell()` call,
// the `phase` nullish-coalesce target, `pausedReason` passthrough, and the
// resolved-filter on `escalationsOpen` — all in one case, per review-04's
// suggested fixture.
const KILL_CONTRACT_TEMPLATE = `run: example
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  review: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
`

const KILL_RUN_STATE = `run: demo
paused_reason: "waiting on legal"
gates:
  publish: {approved: true, by: alice, at: "2026-01-01T00:00:00Z", notes: null}
  intake: {approved: false, by: null, at: null, notes: null}
escalations:
  - reason: "blocked on legal"
    resolved: true
    resolved_by: alice
    resolved_at: "2026-01-01T00:00:00Z"
  - reason: "waiting on ops"
    resolved: false
`

function makeKillFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-generic-kill-'))
  cleanups.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Toy'])
  git(dir, ['config', 'user.email', 'toy@example.com'])
  mkdirSync(join(dir, 'contracts'), { recursive: true })
  writeFileSync(join(dir, 'contracts', 'state.yaml'), KILL_CONTRACT_TEMPLATE)
  mkdirSync(join(dir, 'runs', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'runs', 'demo', 'state.yaml'), KILL_RUN_STATE)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'initial'])
  return dir
}

describe('generic host: gate order, absent gate, and derived-field kill fixture (review-04 F1/F2)', () => {
  it('gates keyed in contract order (not file order), absent gate undecided, phase/pausedReason/escalationsOpen all pinned', async () => {
    const dir = makeKillFixtureRepo()
    const source = new LocalGitSource('generic-kill', dir)
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'demo')!
    const { summary } = await summarizeRun(source, ref)

    // Contract declaration order wins over the run file's own key order,
    // and the declared-but-absent `review` gate still gets a cell.
    expect(Object.keys(summary.gates)).toEqual(['intake', 'review', 'publish'])
    expect(summary.gates.review).toEqual({ approved: false, decided: false, by: null, at: null })
    expect(summary.gates.publish).toEqual({ approved: true, decided: true, by: 'alice', at: '2026-01-01T00:00:00Z' })
    expect(summary.gates.intake).toEqual({ approved: false, decided: false, by: null, at: null })

    // No `phase` key in the run file falls back to '—', never 'unknown'.
    expect(summary.phase).toBe('—')
    expect(summary.pausedReason).toBe('waiting on legal')
    // Two escalations, one resolved: exactly one counts as open.
    expect(summary.escalationsOpen).toBe(1)
  })

  it('the absent-gate cell is a fresh object per summary, not one shared mutable instance', async () => {
    const dir = makeKillFixtureRepo()
    const source = new LocalGitSource('generic-kill', dir)
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'demo')!
    const first = (await summarizeRun(source, ref)).summary
    const second = (await summarizeRun(source, ref)).summary
    expect(first.gates.review).not.toBe(second.gates.review)
  })
})

describe('regression guard: this repository (SDLC) is unaffected by the generic path', () => {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../../..')
  const source = new LocalGitSource('sandbox', repoRoot)

  it('summarizeRun(wordfreq) still reports phase done and gate keys exactly G0..G3 (AC5.2)', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'wordfreq')!
    const { summary } = await summarizeRun(source, ref)
    expect(summary.phase).toBe('done')
    expect(Object.keys(summary.gates)).toEqual(['G0', 'G1', 'G2', 'G3'])
  })
})
