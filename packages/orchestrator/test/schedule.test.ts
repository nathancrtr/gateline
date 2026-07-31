// One test per schedule-table row (S0–S4, SB — schedule.ts header), plus an
// end-to-end sweep against a real repo: dispatch seeds the branch and marker,
// the fake agent lands its delta, the closing commit meters, and the next
// tick rests until a human merges.
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  deriveSweep,
  parseEvery,
  parseScheduleConfig,
  Scheduler,
  sweepSlug,
  type ScheduleEntry,
  type SweepFacts,
} from '../src/schedule.ts'
import { agentCommit, Clock, FakeDispatcher, makeToyRepo, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

describe('parseEvery', () => {
  it('parses d/h/m spellings', () => {
    expect(parseEvery('7d')).toBe(7 * 24 * 60 * 60 * 1000)
    expect(parseEvery('12h')).toBe(12 * 60 * 60 * 1000)
    expect(parseEvery('30m')).toBe(30 * 60 * 1000)
  })
  it('rejects everything else', () => {
    for (const bad of ['1w', '0d', '-1h', 'daily', '', '7']) expect(parseEvery(bad)).toBeNull()
  })
})

describe('parseScheduleConfig', () => {
  it('parses a schedules map with defaults', () => {
    const { schedules, errors } = parseScheduleConfig('schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 5\n')
    expect(errors).toEqual([])
    expect(schedules).toEqual([{ role: 'historian', everyMs: 7 * 24 * 3600 * 1000, every: '7d', costLimitUsd: 5, enabled: true }])
  })
  it('reports a bad `every` instead of guessing', () => {
    const { schedules, errors } = parseScheduleConfig('schedules:\n  historian:\n    every: weekly\n')
    expect(schedules).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('schedules.historian')
  })
  it('tolerates a config with no schedules section', () => {
    expect(parseScheduleConfig('other: 1\n')).toEqual({ schedules: [], errors: [] })
  })
  it('rejects a non-map schedules section', () => {
    const { schedules, errors } = parseScheduleConfig('schedules:\n  - role: historian\n')
    expect(schedules).toEqual([])
    expect(errors).toHaveLength(1)
  })
  it('surfaces invalid YAML as an error', () => {
    expect(parseScheduleConfig('schedules: [').errors).toHaveLength(1)
  })
})

describe('deriveSweep — one test per rule', () => {
  const entry = (over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
    role: 'historian',
    everyMs: 7 * 24 * 3600 * 1000,
    every: '7d',
    costLimitUsd: 5,
    enabled: true,
    ...over,
  })
  const facts = (over: Partial<SweepFacts> = {}): SweepFacts => ({
    now: new Date('2026-07-11T12:00:00Z'),
    entry: entry(),
    lastSweptAt: null,
    openSweep: null,
    slugTaken: false,
    estimateUsd: 1,
    ...over,
  })

  it('S0 — disabled schedule rests', () => {
    expect(deriveSweep(facts({ entry: entry({ enabled: false }) }))).toMatchObject({ kind: 'rest', rule: 'S0' })
  })
  it('S1 — an open sweep branch rests (one per role at a time)', () => {
    expect(deriveSweep(facts({ openSweep: 'run/historian-2026-07-04' }))).toMatchObject({ kind: 'rest', rule: 'S1' })
  })
  it('S2 — within the interval rests', () => {
    expect(deriveSweep(facts({ lastSweptAt: '2026-07-08T00:00:00Z' }))).toMatchObject({ kind: 'rest', rule: 'S2' })
  })
  it('S2 — interval elapsed dispatches', () => {
    expect(deriveSweep(facts({ lastSweptAt: '2026-07-01T00:00:00Z' }))).toMatchObject({ kind: 'dispatch', rule: 'S4' })
  })
  it('S3 — same-day slug already taken rests', () => {
    expect(deriveSweep(facts({ slugTaken: true }))).toMatchObject({ kind: 'rest', rule: 'S3' })
  })
  it('SB — estimate over the cap skips with a config warning, never dispatches', () => {
    expect(deriveSweep(facts({ estimateUsd: 9 }))).toMatchObject({ kind: 'skip', rule: 'SB' })
  })
  it('S4 — never swept and nothing blocking dispatches', () => {
    expect(deriveSweep(facts())).toMatchObject({ kind: 'dispatch', rule: 'S4' })
  })
})

const REGISTRY = { ...TEST_REGISTRY, estimates: { ...TEST_REGISTRY.estimates, historian: 1 } }
const CONFIG = 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 5\n    enabled: true\n'
const DELTA =
  '# Docs Delta: sweep\n\n**Interval covered:** start → now\n\n## Drift found\n\n## Applied changes\n\n## Proposed actions\n\n## Escalations\n\n## Surfaces checked, no drift\nREADME.md\n'

function seedConfig(dir: string, clock: Clock, content = CONFIG): void {
  execFileSync('git', ['-C', dir, 'checkout', '-q', 'main'])
  agentCommit(dir, clock, { 'orchestrator.yaml': content }, 'seed orchestrator.yaml')
}

const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })

describe('Scheduler end-to-end', () => {
  it('sweeps: seed branch + marker, agent lands the delta, closing commit meters, then rests until merged', async () => {
    const { dir, clock } = makeToyRepo()
    seedConfig(dir, clock)
    const dispatcher = new FakeDispatcher((req) => {
      expect(req.role).toBe('historian')
      expect(req.body).toContain('contracts/docs-delta.md')
      agentCommit(req.cwd, clock, { [`runs/${sweepSlug('historian', new Date())}/docs-delta.md`]: DELTA }, 'docs delta')
      return { costUsd: 0.42 }
    })
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher, registry: REGISTRY })

    const first = await scheduler.tick()
    expect(first).toMatchObject([{ role: 'historian', kind: 'dispatched', rule: 'S4' }])
    await scheduler.drain()

    const slug = first[0]!.slug!
    const branch = `run/${slug}`
    // The sweep branch exists, carries the marker (metered) and the agent's delta.
    const marker = git(dir, ['show', `${branch}:runs/${slug}/sweep.yaml`])
    expect(marker).toContain('role: historian')
    expect(marker).toContain('cost_usd: 0.42')
    expect(git(dir, ['show', `${branch}:runs/${slug}/docs-delta.md`])).toContain('Docs Delta')
    // No state.yaml: sweeps stay out of the gate engine's derivation entirely.
    expect(() => git(dir, ['show', `${branch}:runs/${slug}/state.yaml`])).toThrow()
    // The intent commit is the bot's; the human decision grammar is untouched.
    expect(git(dir, ['log', '--format=%an', branch, '--', `runs/${slug}/sweep.yaml`])).toContain('gateline-orchestrator')

    // Open sweep → rest (S1), even though dueness would still say dispatch.
    expect(await scheduler.tick()).toMatchObject([{ kind: 'rest', rule: 'S1' }])
    expect(dispatcher.calls).toHaveLength(1)

    // A human merges the sweep — the approval. Same day: the slug guard rests (S3).
    git(dir, ['checkout', '-q', 'main'])
    git(dir, ['merge', '-q', '--no-ff', '-m', `merge ${branch}`, branch])
    expect(await scheduler.tick()).toMatchObject([{ kind: 'rest', rule: expect.stringMatching(/S2|S3/) }])

    // Branch pruned, still within the interval → S2 via the merged marker's `at`.
    git(dir, ['branch', '-D', branch])
    expect(await scheduler.tick()).toMatchObject([{ kind: 'rest', rule: 'S2' }])

    // `sweep <role>` force: dueness bypassed, the day's slug is free again → re-dispatch.
    const forced = await scheduler.tick({ force: 'historian' })
    expect(forced).toMatchObject([{ kind: 'dispatched' }])
    await scheduler.drain()
  })

  it('a failed dispatch is metered at the estimate, marked failed, and holds the branch open for a human', async () => {
    const { dir, clock } = makeToyRepo()
    seedConfig(dir, clock)
    const dispatcher = new FakeDispatcher(() => ({ ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'harness exploded' }))
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher, registry: REGISTRY })

    const [outcome] = await scheduler.tick()
    expect(outcome).toMatchObject({ kind: 'dispatched' })
    await scheduler.drain()

    const marker = git(dir, ['show', `run/${outcome!.slug}:runs/${outcome!.slug}/sweep.yaml`])
    expect(marker).toContain('cost_usd: 1') // the registry estimate, not a guess
    expect(marker).toContain('failed: "harness exploded"')
    // The open failed sweep rests until a human prunes or fixes it.
    expect(await scheduler.tick()).toMatchObject([{ kind: 'rest', rule: 'S1' }])
  })

  it('no orchestrator.yaml → no schedules, no dispatches', async () => {
    const { dir } = makeToyRepo()
    const dispatcher = new FakeDispatcher(() => ({}))
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher, registry: REGISTRY })
    expect(await scheduler.tick()).toEqual([])
    expect(dispatcher.calls).toHaveLength(0)
  })
})
