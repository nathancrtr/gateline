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
