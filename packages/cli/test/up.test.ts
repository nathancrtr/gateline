// `gateline up` serving a set of repositories (#502, docs/MULTI-REPO.md §8):
// one engine per `dispatch` repository, in one process, under one governor,
// with the server over the same set. Every run here uses generated toy
// repositories, fake analysts, no code-tree monitor unless a test gives it a
// throwaway one, and a fake `gh`: nothing is dispatched for real and nothing
// reaches a network. Expected values are written out, never computed by the
// code under test.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineHealthPath } from '@gateline/core'
import type { Governor, GovernorPort, OrchestratorsHandle } from '@gateline/orchestrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpRunning } from '../src/up.ts'
import { fakeGhOnPath, git, heldSpec, nothingListening, promptSpec, REFUSAL_PORT, stopAll, type Toy, toyRepo, up, withBareOrigin } from './up.helper.ts'

let xdg: string
let fakeBin: string
let parent: string
let configPath: string
const originalXdg = process.env.XDG_CONFIG_HOME
const originalPath = process.env.PATH

beforeAll(() => {
  // Never the operator's ~/.config/gateline: every config read here is this directory's.
  xdg = mkdtempSync(join(tmpdir(), 'gateline-up-xdg-'))
  process.env.XDG_CONFIG_HOME = xdg
  fakeBin = fakeGhOnPath()
})
afterAll(() => {
  process.env.XDG_CONFIG_HOME = originalXdg
  process.env.PATH = originalPath
  rmSync(xdg, { recursive: true, force: true })
  rmSync(fakeBin, { recursive: true, force: true })
})
beforeEach(() => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), 'gateline-up-')))
  configPath = join(xdg, 'gateline', 'config.yaml')
  rmSync(configPath, { force: true })
})
afterEach(async () => {
  await stopAll()
  rmSync(configPath, { force: true })
  rmSync(parent, { recursive: true, force: true })
})

function writeConfig(body: string): void {
  mkdirSync(join(xdg, 'gateline'), { recursive: true })
  writeFileSync(configPath, body)
}

const running = (outcome: Awaited<ReturnType<typeof up>>['outcome']): UpRunning => {
  if (!outcome.ok) throw new Error('expected up to be running')
  return outcome
}

/** Wait until a run's branch shows the analyst's closing commit. */
async function settled(dir: string): Promise<void> {
  await vi.waitFor(() => expect(git(dir, ['log', '--format=%s', '-1', 'run/toy'])).toBe('state(toy): metered analyst $1.25'), {
    timeout: 20_000,
    interval: 50,
  })
}

const subjects = (dir: string) => git(dir, ['log', '--format=%an|%s', 'run/toy']).split('\n')
const FIXTURE_SUBJECTS = ['Toy Operator|toy: intent brief', 'Toy Operator|Seed contracts']
const DISPATCHED_SUBJECTS = [
  'gateline-orchestrator|state(toy): metered analyst $1.25',
  'toy-agent|toy: spec',
  'gateline-orchestrator|state(toy): dispatched analyst',
  ...FIXTURE_SUBJECTS,
]
const healthExists = async (dir: string) => existsSync(await engineHealthPath(dir))

async function served(outcome: UpRunning): Promise<{ id: string; name: string; mode: string | null }[]> {
  const res = await fetch(`${outcome.server.url}/api/health`)
  return ((await res.json()) as { repositories: { id: string; name: string; mode: string | null }[] }).repositories
}

/**
 * Wait until nothing holds a slot: the closing commit lands before the job
 * leaves its engine and gives its slot back, so a probe right after `settled`
 * could find the slot still taken.
 */
async function quiet(outcome: UpRunning): Promise<void> {
  await vi.waitFor(
    () => {
      expect(outcome.orchestrators.inFlightDetail()).toEqual([])
      const snapshot = (outcome.orchestrators.governor as Governor).snapshot()
      expect([snapshot.occupied, snapshot.offers]).toEqual([0, {}])
    },
    { timeout: 20_000, interval: 20 },
  )
}

/** Ask the governor for what it would grant, and give back whatever it granted. */
function probe(governor: GovernorPort, repository: string, estimates: number[]) {
  const result = governor.reserve({ repository, intents: estimates.map((estimateUsd, i) => ({ key: `probe-${i}`, estimateUsd })) })
  for (const granted of result.granted) granted.release()
  return result
}

const engineIds = (handle: OrchestratorsHandle) => handle.engines.map((e) => e.repositoryId)

/** The startup log with its run-to-run noise replaced: the directory, the port, durations, the worktree cache path. */
function normalise(lines: string[], dirs: Record<string, string>): string[] {
  return lines.map((line) => {
    let l = line
    for (const [name, dir] of Object.entries(dirs)) l = l.replaceAll(dir, `<${name}>`)
    return l
      .replace(/127\.0\.0\.1:\d+/, '127.0.0.1:<port>')
      .replace(/done in \d+ ms/, 'done in <t>')
      .replace(/ {2}\(API only.*$/, '')
      .replace(/\(looked in [^)]*\)/, '(looked in <paths>)')
  })
}

// ---------------------------------------------------------------------------

describe('one repository, as on main', () => {
  // Captured by running main's own `up` action body (f0b5534), step for step,
  // over the same toy repository in a directory named `toy`, with the same
  // fake analyst injected and no code-tree monitor, then one signal. Paths,
  // the port and durations are normalised as `normalise` does.
  const MAIN_FIRST = [
    'out: sources: local/toy (dispatch)',
    'out: gateline ui listening on http://127.0.0.1:<port>',
    'out: [toy] startup seed: counting open dispatches and spend in the window',
    'out: [toy] startup seed: done in <t>',
  ]
  // The startup pass runs beside `engine watching`, so these come in either order.
  const MAIN_THEN = [
    'out: engine watching <toy> (heartbeat 180s, local-only (no origin remote)) — ^C to stop',
    'out: [toy] toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
    'out: [toy] [startup] toy: dispatch (D6) spec.md absent — dispatch analyst',
    'out: [toy] toy: no warm node_modules to seed from (looked in <paths>) — the implementer installs',
    'out: [toy] toy: metered analyst $1.25 ok',
  ]
  const MAIN_STOP = ['out: no dispatches in flight — stopping', 'out: drained — all ledger entries closed']
  const MAIN_HEALTH_KEYS = ['at', 'deferrals', 'heartbeatMs', 'inFlight', 'pid', 'pushRejections']
  const MAIN_STATE = [
    '# toy run state — comments must survive machine edits',
    'run: toy',
    'branch: run/toy',
    'phase: spec # spec | plan | implement | integrate | release | done | paused',
    'paused_reason: null',
    '',
    'budget:',
    '  cost_limit_usd: 50 # exhaustion pauses the run',
    '  cost_spent_usd: 1.25',
    '  ledger:',
    '    - at: <at>',
    '      role: analyst',
    '      task: null',
    '      round: null',
    '      adapter: fake',
    '      model: null',
    '      engine: <engine>',
    '      tokens_in: 100000',
    '      tokens_out: 10000',
    '      cost_usd: 1.25',
    '',
    'gates:',
    '  # a gate entry is written ONLY by the named human',
    '  G0: { approved: false, by: null, at: null, notes: null }',
    '  G1: { approved: false, by: null, at: null, notes: null }',
    '  G2: { approved: false, by: null, at: null, notes: null }',
    '  G3: { approved: false, by: null, at: null, notes: null }',
    '',
    'tasks: []',
    '',
    'escalations: []',
  ].join('\n')

  async function runOne(how: 'cwd' | 'repo') {
    const toy = toyRepo(parent, 'toy')
    const elsewhere = mkdtempSync(join(tmpdir(), 'gateline-up-cwd-'))
    const run = await up(how === 'repo' ? { repo: [toy.dir], engineName: 'test-engine' } : { engineName: 'test-engine' }, {
      cwd: how === 'cwd' ? toy.dir : elsewhere,
      configPath,
      dispatchers: { 'local/toy': promptSpec(toy.clock) },
    })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(toy.dir)
    // The closing commit lands before the job leaves the engine: signal once it has.
    await vi.waitFor(() => expect(outcome.orchestrators.inFlightDetail()).toEqual([]), { timeout: 20_000, interval: 20 })
    await vi.waitFor(() => expect(run.lines).toContain('out: [toy] toy: metered analyst $1.25 ok'), { timeout: 20_000, interval: 20 })
    run.signals[0]!()
    await vi.waitFor(() => expect(run.exits).toEqual([0]), { timeout: 20_000, interval: 50 })
    rmSync(elsewhere, { recursive: true, force: true })
    return { toy, run }
  }

  it.each([
    ['no config and no --repo: the working directory', 'cwd' as const, 'from the working directory'],
    ['one --repo', 'repo' as const, 'from --repo'],
  ])('%s — one engine; the log, commits, state and health file are main’s, after the startup summary', { timeout: 60_000 }, async (_name, how, from) => {
    const { toy, run } = await runOne(how)
    const lines = normalise(run.lines, { toy: toy.dir })
    // New in #502: what will be allowed to spend money, before anything starts.
    expect(lines.slice(0, 7)).toEqual([
      `out: up: 1 repository ${from}; an engine in it`,
      'out: limits: at most 2 dispatches at once across every repository (default)',
      'out: limits: no machine spend limit (default)',
      'out: limits: budget enforcement on (default)',
      'out: engine name: test-engine (--engine-name)',
      'out: engine: adapters claude-code (default); role timeout 1800 s (default); heartbeat 180 s (default)',
      'out: repository local/toy (toy): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
    ])
    const rest = lines.slice(7)
    expect(rest.slice(0, 4)).toEqual(MAIN_FIRST)
    expect(rest.slice(4, 4 + MAIN_THEN.length).sort()).toEqual([...MAIN_THEN].sort())
    expect(rest.slice(4 + MAIN_THEN.length)).toEqual(MAIN_STOP)
    expect(subjects(toy.dir)).toEqual(DISPATCHED_SUBJECTS)
    const state = git(toy.dir, ['show', 'run/toy:runs/toy/state.yaml'])
      .replace(/- at: \S+/, '- at: <at>')
      .replace(/engine: \S+/, 'engine: <engine>')
    expect(state).toBe(MAIN_STATE)
    // The engine name reached the ledger in place of the hostname.
    expect(git(toy.dir, ['show', 'run/toy:runs/toy/state.yaml'])).toMatch(/engine: test-engine:\d+(#\d+)?\n/)
    const health = JSON.parse(readFileSync(await engineHealthPath(toy.dir), 'utf8')) as Record<string, unknown>
    expect(Object.keys(health).sort()).toEqual(MAIN_HEALTH_KEYS)
  })
})

describe('several repositories', () => {
  it('--repo a --repo b: two engines, one governor, the server over both', { timeout: 60_000 }, async () => {
    const a = toyRepo(parent, 'alpha')
    const b = toyRepo(parent, 'beta')
    const run = await up({ repo: [a.dir, b.dir] }, { configPath, dispatchers: { 'local/alpha': promptSpec(a.clock), 'local/beta': promptSpec(b.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(a.dir)
    await settled(b.dir)
    expect(engineIds(outcome.orchestrators)).toEqual(['local/alpha', 'local/beta'])
    for (const e of outcome.orchestrators.engines) expect(e.engine.governor).toBe(outcome.orchestrators.governor)
    expect(run.lines.filter((l) => l.includes('built its own governor'))).toEqual([])
    expect(await served(outcome)).toEqual([
      { id: 'local/alpha', name: 'alpha', mode: 'dispatch' },
      { id: 'local/beta', name: 'beta', mode: 'dispatch' },
    ])
    expect(subjects(a.dir)).toEqual(DISPATCHED_SUBJECTS)
    expect(subjects(b.dir)).toEqual(DISPATCHED_SUBJECTS)
    const lines = normalise(run.lines, { alpha: a.dir, beta: b.dir })
    expect(lines.filter((l) => l.startsWith('out: up:') || l.startsWith('out: repository ') || l.startsWith('out: engine watching'))).toEqual([
      'out: up: 2 repositories from --repo; an engine in each',
      'out: repository local/alpha (alpha): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
      'out: repository local/beta (beta): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
      'out: engine watching <alpha> (heartbeat 180s, local-only (no origin remote)) — ^C to stop',
      'out: engine watching <beta> (heartbeat 180s, local-only (no origin remote)) — ^C to stop',
    ])
  })

  it('--repo with a config file present says the file, and its limits, are not read', { timeout: 60_000 }, async () => {
    const toy = toyRepo(parent, 'toy')
    writeConfig('limits:\n  spend_limit_usd: 5\n')
    const run = await up({ repo: [toy.dir], heartbeat: 600 }, { configPath, dispatchers: { 'local/toy': promptSpec(toy.clock) } })
    running(run.outcome)
    expect(run.lines.slice(0, 4)).toEqual([
      `err: warning: --repo given, so ${configPath} is not read: its repositories, limits: and engine: do not apply to this run`,
      'out: up: 1 repository from --repo; an engine in it',
      'out: limits: at most 2 dispatches at once across every repository (default)',
      'out: limits: no machine spend limit (default)',
    ])
  })

  it('the two engines share one limit: with one slot, one analyst runs and the other waits', { timeout: 60_000 }, async () => {
    const a = toyRepo(parent, 'alpha')
    const b = toyRepo(parent, 'beta')
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const run = await up(
      { repo: [a.dir, b.dir], maxConcurrentDispatches: 1, heartbeat: 600 },
      { configPath, dispatchers: { 'local/alpha': alpha.dispatcher, 'local/beta': beta.dispatcher } },
    )
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    expect(outcome.orchestrators.inFlightDetail()).toHaveLength(1)
    alpha.open()
    beta.open()
    // The freed slot wakes the other repository, which then dispatches its own.
    await settled(a.dir)
    await settled(b.dir)
  })

  it('a config with a dispatch, a decide and a view repository: one engine, three served', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    const website = toyRepo(parent, 'website')
    const notes = toyRepo(parent, 'notes')
    writeConfig(
      [
        'repositories:',
        `  - path: ${billing.dir}`,
        '    mode: dispatch',
        `  - path: ${website.dir}`,
        '    mode: decide',
        `  - path: ${notes.dir}`,
        '    mode: view',
        '',
      ].join('\n'),
    )
    const run = await up({ engineName: 'test-engine' }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    expect(engineIds(outcome.orchestrators)).toEqual(['local/billing'])
    expect(await served(outcome)).toEqual([
      { id: 'local/billing', name: 'billing', mode: 'dispatch' },
      { id: 'local/website', name: 'website', mode: 'decide' },
      { id: 'local/notes', name: 'notes', mode: 'view' },
    ])
    expect(await healthExists(billing.dir)).toBe(true)
    expect(await healthExists(website.dir)).toBe(false)
    expect(await healthExists(notes.dir)).toBe(false)
    expect(subjects(website.dir)).toEqual(FIXTURE_SUBJECTS)
    expect(subjects(notes.dir)).toEqual(FIXTURE_SUBJECTS)
    const lines = normalise(run.lines, {})
    expect(lines.slice(0, 9)).toEqual([
      `out: up: 3 repositories from ${configPath}; an engine in 1 of them`,
      'out: limits: at most 2 dispatches at once across every repository (default)',
      'out: limits: no machine spend limit (default)',
      'out: limits: budget enforcement on (default)',
      'out: engine name: test-engine (--engine-name)',
      'out: engine: adapters claude-code (default); role timeout 1800 s (default); heartbeat 180 s (default)',
      'out: repository local/billing (billing): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
      'out: repository local/website (website): decide, no engine',
      'out: repository local/notes (notes): view, no engine',
    ])
    expect(lines).toContain(`out: sources: local/billing (dispatch), local/website (decide), local/notes (view) (from ${configPath})`)
  })

  it('a repository left out by the framework check gets no engine, and the others start', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    const bare = toyRepo(parent, 'bare', { framework: false })
    writeConfig(['repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', `  - path: ${bare.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({}, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    expect(engineIds(outcome.orchestrators)).toEqual(['local/billing'])
    expect(await served(outcome)).toEqual([{ id: 'local/billing', name: 'billing', mode: 'dispatch' }])
    expect(run.lines.filter((l) => l.startsWith('err: warning:'))).toEqual([
      `err: warning: left out of the set: ${bare.dir} does not carry the framework: its default branch (main) has no .gateline/framework-lock.json, and no roles/, contracts/ and registry/ at its root. ` +
        'Integrate it with `gateline init <path> --provenance <redistribute|private>` and merge that change to main; the check reads main as committed, so an unmerged integration does not count yet',
    ])
    expect(await healthExists(bare.dir)).toBe(false)
    expect(subjects(bare.dir)).toEqual(FIXTURE_SUBJECTS)
  })
})

describe('push and local-only, per repository (R2)', () => {
  it('a mixed set: the one with an origin pushes, the one without is local-only, each said at startup', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    const bare = withBareOrigin(billing)
    const notes = toyRepo(parent, 'notes')
    writeConfig(
      [
        'repositories:',
        `  - path: ${billing.dir}`,
        '    id: github.com/acme/billing',
        '    mode: dispatch',
        `  - path: ${notes.dir}`,
        '    mode: dispatch',
        '',
      ].join('\n'),
    )
    const run = await up(
      { engineName: 'test-engine' },
      { configPath, dispatchers: { 'github.com/acme/billing': promptSpec(billing.clock), 'local/notes': promptSpec(notes.clock) } },
    )
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await settled(notes.dir)
    const lines = normalise(run.lines, { billing: billing.dir, notes: notes.dir })
    expect(lines.filter((l) => l.startsWith('out: repository ') || l.startsWith('out: engine watching'))).toEqual([
      'out: repository github.com/acme/billing (billing): dispatch, engine; pushing to origin (origin auto-detected); no spend ceiling of its own',
      'out: repository local/notes (notes): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
      'out: engine watching <billing> (heartbeat 180s, pushing to origin (origin auto-detected)) — ^C to stop',
      'out: engine watching <notes> (heartbeat 180s, local-only (no origin remote)) — ^C to stop',
    ])
    // The engine pushed its commits to billing's origin, and the draft-PR
    // ensure asked (the fake) gh, since billing is not local-only.
    await vi.waitFor(() => expect(git(bare, ['log', '--format=%s', '-1', 'run/toy'])).toBe('state(toy): metered analyst $1.25'), { timeout: 20_000, interval: 50 })
    expect(lines.some((l) => l.startsWith('out: [notes] toy: draft PR ensure — skipped: local-only mode'))).toBe(true)
  })

  it('an explicit push: false and local_only: true in the config are each named', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    withBareOrigin(billing)
    const website = toyRepo(parent, 'website')
    withBareOrigin(website)
    writeConfig(
      [
        'repositories:',
        `  - path: ${billing.dir}`,
        '    mode: dispatch',
        '    push: false',
        `  - path: ${website.dir}`,
        '    mode: dispatch',
        '    local_only: true',
        '',
      ].join('\n'),
    )
    const run = await up({ heartbeat: 600 }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock), 'local/website': promptSpec(website.clock) } })
    running(run.outcome)
    expect(run.lines.filter((l) => l.startsWith('out: repository '))).toEqual([
      'out: repository local/billing (billing): dispatch, engine; not pushing to origin (push: false); no spend ceiling of its own',
      'out: repository local/website (website): dispatch, engine; local-only (local_only: true); no spend ceiling of its own',
    ])
  })

  it('--local-only with a config file is said to reach no listed repository', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({ localOnly: true, heartbeat: 600 }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    running(run.outcome)
    expect(run.lines.filter((l) => l.startsWith('err: warning:'))).toEqual([
      `err: warning: --local-only applies only to a repository given by --repo or the working directory; every repository here is listed in ${configPath} and keeps its own push and local_only settings (docs/TOPOLOGY.md §3.6)`,
    ])
  })
})

describe('limits: the config, flags over it, and each repository’s ceiling (P3)', () => {
  const machine = (spend = 40) => ['limits:', '  max_concurrent_dispatches: 3', `  spend_limit_usd: ${spend}`, '  spend_window_hours: 12']

  it('from the config alone', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig([...machine(), 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({}, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await quiet(outcome)
    expect(run.lines.slice(1, 4)).toEqual([
      'out: limits: at most 3 dispatches at once across every repository (config limits.max_concurrent_dispatches)',
      'out: limits: machine spend limit $40 per 12 h across every dispatch repository (config limits.spend_limit_usd; window: config limits.spend_window_hours)',
      'out: limits: budget enforcement on (default)',
    ])
    const governor = outcome.orchestrators.governor
    const spend = probe(governor, 'local/billing', [1000]).refusal!
    expect([spend.limit, spend.limitUsd, spend.windowMs]).toEqual(['spend', 40, 12 * 3_600_000])
    const slots = probe(governor, 'local/billing', [0, 0, 0, 0, 0])
    expect([slots.granted.length, slots.refusal!.limit, slots.refusal!.cap]).toEqual([3, 'concurrency', 3])
  })

  it('a flag overrides the config, and says what it overrode', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig([...machine(), 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up(
      { spendLimitUsd: 10, maxConcurrentDispatches: 1, spendWindow: 6 },
      { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } },
    )
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await quiet(outcome)
    expect(run.lines.slice(1, 3)).toEqual([
      "out: limits: at most 1 dispatch at once across every repository (--max-concurrent-dispatches, over the config's limits.max_concurrent_dispatches: 3)",
      "out: limits: machine spend limit $10 per 6 h across every dispatch repository (--spend-limit-usd, over the config's limits.spend_limit_usd: 40; window: --spend-window, over the config's limits.spend_window_hours: 12)",
    ])
    const governor = outcome.orchestrators.governor
    const spend = probe(governor, 'local/billing', [1000]).refusal!
    expect([spend.limit, spend.limitUsd, spend.windowMs]).toEqual(['spend', 10, 6 * 3_600_000])
    expect(probe(governor, 'local/billing', [0, 0]).refusal!.cap).toBe(1)
  })

  it('a repository’s own ceiling reaches the governor as that repository’s', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    const website = toyRepo(parent, 'website')
    writeConfig(
      [
        ...machine(),
        'repositories:',
        `  - path: ${billing.dir}`,
        '    mode: dispatch',
        '    limits:',
        '      spend_limit_usd: 25',
        `  - path: ${website.dir}`,
        '    mode: dispatch',
        '',
      ].join('\n'),
    )
    const run = await up({}, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock), 'local/website': promptSpec(website.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await settled(website.dir)
    await quiet(outcome)
    expect(run.lines.filter((l) => l.startsWith('out: repository '))).toEqual([
      'out: repository local/billing (billing): dispatch, engine; local-only (no origin remote); spend ceiling $25 per 12 h (config limits.spend_limit_usd)',
      'out: repository local/website (website): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
    ])
    const governor = outcome.orchestrators.governor
    // $30 fits the machine's $40 (with $2.50 spent) and not billing's own $25.
    const own = probe(governor, 'local/billing', [30]).refusal!
    expect([own.limit, own.limitUsd]).toEqual(['repository-spend', 25])
    expect(probe(governor, 'local/website', [30]).refusal).toBeNull()
  })

  it('a ceiling above a lower flag is said to be bound by the machine’s', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig([...machine(), 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', '    limits:', '      spend_limit_usd: 25', ''].join('\n'))
    const run = await up({ spendLimitUsd: 20, heartbeat: 600 }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    running(run.outcome)
    expect(run.lines.filter((l) => l.startsWith('out: repository '))).toEqual([
      "out: repository local/billing (billing): dispatch, engine; local-only (no origin remote); spend ceiling $25 per 12 h (config limits.spend_limit_usd), above the machine's $20, which binds first",
    ])
  })

  it('budget_enforcement: false in the config turns the spend checks off and says so', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig([...machine(10), 'engine:', '  budget_enforcement: false', 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({}, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await quiet(outcome)
    expect(run.lines.slice(2, 4)).toEqual([
      'out: limits: machine spend limit $10 per 12 h across every dispatch repository (config limits.spend_limit_usd; window: config limits.spend_window_hours) — not enforced',
      'out: limits: budget enforcement OFF (config engine.budget_enforcement) — spend is metered, and no spend limit, ceiling or per-run cap holds a dispatch back; the concurrency limit still does',
    ])
    expect(run.lines).toContain(
      'out: [billing] budget enforcement OFF — runs meter (ledger, cost_spent_usd) but caps never pause dispatch; ignoring --spend-limit-usd',
    )
    expect(probe(outcome.orchestrators.governor, 'local/billing', [1000]).refusal).toBeNull()
  })

  it('--no-budget-enforcement overrides budget_enforcement: true', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig([...machine(10), 'engine:', '  budget_enforcement: true', 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({ noBudgetEnforcement: true }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    await settled(billing.dir)
    await quiet(outcome)
    expect(run.lines[3]).toBe(
      "out: limits: budget enforcement OFF (--no-budget-enforcement, over the config's engine.budget_enforcement: true) — spend is metered, and no spend limit, ceiling or per-run cap holds a dispatch back; the concurrency limit still does",
    )
    expect(probe(outcome.orchestrators.governor, 'local/billing', [1000]).refusal).toBeNull()
  })
})

describe('engine defaults and the engine name', () => {
  it('takes adapters, role timeout, heartbeat and the name from the config', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(
      [
        'engine:',
        '  adapters: [opencode, claude-code]',
        '  role_timeout_seconds: 900',
        '  heartbeat_seconds: 600',
        '  name: config-engine',
        'repositories:',
        `  - path: ${billing.dir}`,
        '    mode: dispatch',
        '',
      ].join('\n'),
    )
    const run = await up({}, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    expect(run.lines.slice(4, 6)).toEqual([
      'out: engine name: config-engine (config engine.name)',
      'out: engine: adapters opencode, claude-code (config engine.adapters); role timeout 900 s (config engine.role_timeout_seconds); heartbeat 600 s (config engine.heartbeat_seconds)',
    ])
    expect(outcome.orchestrators.engines[0]!.engine.hostName).toBe('config-engine')
    expect(outcome.orchestrators.engines[0]!.engine.engineId).toMatch(/^config-engine:\d+(#\d+)?$/)
  })

  it('--engine-name wins over the config’s', { timeout: 60_000 }, async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['engine:', '  name: config-engine', 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    const run = await up({ engineName: 'test-engine', heartbeat: 600 }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    const outcome = running(run.outcome)
    expect(run.lines[4]).toBe('out: engine name: test-engine (--engine-name)')
    expect(outcome.orchestrators.engines[0]!.engine.hostName).toBe('test-engine')
  })
})

describe('shutdown and supersede', () => {
  async function twoHeld(extra: { codeRepo?: string | null } = {}) {
    const a = toyRepo(parent, 'alpha')
    const b = toyRepo(parent, 'beta')
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const run = await up(
      { repo: [a.dir, b.dir], heartbeat: 600 },
      { configPath, dispatchers: { 'local/alpha': alpha.dispatcher, 'local/beta': beta.dispatcher }, ...extra },
    )
    const outcome = running(run.outcome)
    await outcome.orchestrators.started
    return { a, b, alpha, beta, run, outcome }
  }

  it('one signal drains both engines, and the process exits once', { timeout: 60_000 }, async () => {
    const { a, b, alpha, beta, run, outcome } = await twoHeld()
    expect(run.signals).toHaveLength(1)
    expect(outcome.orchestrators.inFlightDetail()).toHaveLength(2)
    const before = run.lines.length
    run.signals[0]!()
    expect(run.lines.slice(before).map((l) => l.replace(/running \d+min$/, 'running Nmin'))).toEqual([
      'out: draining 2 in-flight dispatch(es) — they run to completion and close their ledger entries; ^C again to abort them (SIGKILL; closing commits still land)',
      expect.stringMatching(/^out: {3}analyst on toy in (alpha|beta) — running Nmin$/),
      expect.stringMatching(/^out: {3}analyst on toy in (alpha|beta) — running Nmin$/),
    ])
    alpha.open()
    await settled(a.dir)
    await new Promise((r) => setTimeout(r, 300))
    expect(run.exits).toEqual([]) // beta's analyst still runs: the drain waits for it
    beta.open()
    await vi.waitFor(() => expect(run.exits).toEqual([0]), { timeout: 20_000, interval: 50 })
    await settled(b.dir)
    await new Promise((r) => setTimeout(r, 200))
    expect(run.exits).toEqual([0])
  })

  it('a code-tree fast-forward supersedes once: every engine drains, then exit 75, once', { timeout: 90_000 }, async () => {
    const code = realpathSync(mkdtempSync(join(tmpdir(), 'gateline-up-code-')))
    git(code, ['init', '-q', '-b', 'main'])
    const commit = (msg: string) => {
      writeFileSync(join(code, 'file.txt'), `${msg}\n`)
      git(code, ['add', '.'])
      git(code, ['-c', 'user.name=Toy', '-c', 'user.email=toy@example.test', 'commit', '-q', '-m', msg])
    }
    commit('initial')
    const { a, b, alpha, beta, run, outcome } = await twoHeld({ codeRepo: code })
    const [ea, eb] = outcome.orchestrators.engines
    commit('a framework fix lands')
    // The monitor confirms a fast-forward on its second consecutive check.
    await ea!.loop.trigger('heartbeat')
    await eb!.loop.trigger('heartbeat')
    await ea!.loop.trigger('heartbeat')
    await eb!.loop.trigger('heartbeat')
    await vi.waitFor(() => expect(run.lines.filter((l) => l.startsWith('out: code tree moved '))).toHaveLength(1), { timeout: 20_000, interval: 50 })
    expect(run.lines).toContain('out: draining in-flight dispatches…')
    alpha.open()
    await settled(a.dir)
    await new Promise((r) => setTimeout(r, 300))
    expect(run.exits).toEqual([]) // beta still drains
    beta.open()
    await vi.waitFor(() => expect(run.exits).toEqual([75]), { timeout: 20_000, interval: 50 })
    await settled(b.dir)
    // A signal after the supersede, and more heartbeats: still one exit.
    run.signals[0]!()
    await ea!.loop.trigger('heartbeat')
    await new Promise((r) => setTimeout(r, 300))
    expect(run.exits).toEqual([75])
    expect(run.lines.filter((l) => l.startsWith('out: code tree moved '))).toHaveLength(1)
    rmSync(code, { recursive: true, force: true })
  })
})

describe('refusals: exit 1, the message, nothing started', () => {
  /** A refusal: `up` says why, returns exit 1, listens on nothing, and no engine ran in any repository. */
  async function refused(flags: Parameters<typeof up>[0], deps: Parameters<typeof up>[1], repos: Toy[]): Promise<string[]> {
    const run = await up({ port: REFUSAL_PORT, ...flags }, { configPath, ...deps })
    expect(run.outcome).toEqual({ ok: false, code: 1 })
    expect(await nothingListening(REFUSAL_PORT)).toBe(true)
    expect(run.lines.filter((l) => l.includes('listening on'))).toEqual([])
    expect(run.signals).toEqual([])
    for (const repo of repos) {
      expect(await healthExists(repo.dir)).toBe(false)
      expect(subjects(repo.dir)).toEqual(FIXTURE_SUBJECTS)
    }
    return run.lines.filter((l) => l.startsWith('err: ') && !l.startsWith('err: warning:'))
  }

  it('zero dispatch repositories: refused, pointing at `gateline ui`', async () => {
    const website = toyRepo(parent, 'website')
    const notes = toyRepo(parent, 'notes')
    writeConfig(['repositories:', `  - path: ${website.dir}`, '    mode: decide', `  - path: ${notes.dir}`, '    mode: view', ''].join('\n'))
    expect(await refused({}, {}, [website, notes])).toEqual([
      'err: no repository in the set is in dispatch mode, so `up` has no engine to run: local/website (decide), local/notes (view). ' +
        `\`gateline ui\` serves a set with no engine. To run an engine in a repository, set \`mode: dispatch\` on its entry in ${configPath}`,
    ])
  })

  it('a config error (an entry with no mode)', async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['repositories:', `  - path: ${billing.dir}`, ''].join('\n'))
    expect(await refused({}, {}, [billing])).toEqual([
      `err: config at ${configPath}: repositories[0] (${billing.dir}) states no mode. Every entry needs one: add ` +
        '`mode: view` (read only), `mode: decide` (also record decisions) or `mode: dispatch` (also run an engine under `up`)',
    ])
  })

  it('a ceiling above the machine’s, refused by the config loader', async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['limits:', '  spend_limit_usd: 40', 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', '    limits:', '      spend_limit_usd: 41', ''].join('\n'))
    expect(await refused({}, {}, [billing])).toEqual([
      `err: config at ${configPath}: repositories[0] (${billing.dir}): limits.spend_limit_usd 41 is above the machine's limits.spend_limit_usd 40. ` +
        "The machine's limit is the ceiling; a repository may only set a lower one",
    ])
  })

  it('two repositories with one id (RepositoryIdError)', async () => {
    const one = toyRepo(mkdtempSync(join(parent, 'one-')), 'toy')
    const two = toyRepo(mkdtempSync(join(parent, 'two-')), 'toy')
    expect(await refused({ repo: [one.dir, two.dir] }, {}, [one, two])).toEqual([
      `err: two repositories resolve to the id local/toy: ${one.dir} and ${two.dir} (neither has an origin, and their names match). ` +
        'List each repository once; if these are different repositories, list them in the config file, giving one an `id:` or a `name`',
    ])
  })

  it('two checkouts of one clone (DuplicateRepositoryError, from the orchestrator)', async () => {
    const toy = toyRepo(parent, 'toy')
    const worktree = join(parent, 'toy-wt')
    git(toy.dir, ['worktree', 'add', '-q', '-b', 'wt', worktree, 'main'])
    const common = realpathSync(join(toy.dir, '.git'))
    expect(await refused({ repo: [toy.dir, worktree] }, { dispatchers: {} }, [toy])).toEqual([
      `err: toy (local/toy at ${toy.dir}) and toy-wt (local/toy-wt at ${worktree}) share one git directory (${common}): ` +
        'they are checkouts of one clone, whose runs are one set of branches — one engine per repository',
    ])
  })

  it('--local-only and --push for a repository with no config entry', async () => {
    const toy = toyRepo(parent, 'toy')
    expect(await refused({ repo: [toy.dir], localOnly: true, push: true }, {}, [toy])).toEqual([
      'err: source local/toy: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one',
    ])
  })

  it('local_only: true and push: true on a config entry', async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', '    local_only: true', '    push: true', ''].join('\n'))
    expect(await refused({}, {}, [billing])).toEqual([
      'err: source local/billing: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one',
    ])
  })

  it('--local-only and --push on the command line, with a config file', async () => {
    const billing = toyRepo(parent, 'billing')
    writeConfig(['repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    expect(await refused({ localOnly: true, push: true }, {}, [billing])).toEqual([
      'err: --local-only and --push: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one',
    ])
  })

  it('a repository whose adapter manifest is missing at its default-branch tip', async () => {
    const billing = toyRepo(parent, 'billing')
    const website = toyRepo(parent, 'website')
    // No fake dispatcher for website: its engine reads its manifests, and it has none.
    const run = await up({ repo: [billing.dir, website.dir], port: REFUSAL_PORT }, { configPath, dispatchers: { 'local/billing': promptSpec(billing.clock) } })
    expect(run.outcome).toEqual({ ok: false, code: 1 })
    expect(run.lines.filter((l) => l.startsWith('err: '))).toEqual([
      'err: adapter "claude-code": no adapters/claude-code/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there',
    ])
    // The summary is printed before assembly; with no name given, the hostname stands.
    expect(run.lines[4]).toMatch(/^out: engine name: .+ \(this machine's hostname; set engine\.name in the config or --engine-name to choose another\)$/)
    expect(await nothingListening(REFUSAL_PORT)).toBe(true)
    for (const repo of [billing, website]) {
      expect(await healthExists(repo.dir)).toBe(false)
      expect(subjects(repo.dir)).toEqual(FIXTURE_SUBJECTS)
    }
  })

  it('an engine name the orchestrator refuses, from the flag or from the config', async () => {
    const billing = toyRepo(parent, 'billing')
    expect(await refused({ repo: [billing.dir], engineName: 'my laptop' }, {}, [billing])).toEqual([
      'err: --engine-name: engine name "my laptop" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)',
    ])
    writeConfig(['engine:', '  name: "host:1"', 'repositories:', `  - path: ${billing.dir}`, '    mode: dispatch', ''].join('\n'))
    expect(await refused({}, {}, [billing])).toEqual([
      `err: config at ${configPath}: engine.name: engine name "host:1" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)`,
    ])
  })

  it('a flag that is not a usable number', async () => {
    const billing = toyRepo(parent, 'billing')
    expect(await refused({ repo: [billing.dir], spendLimitUsd: Number.NaN }, {}, [billing])).toEqual(['err: --spend-limit-usd must be a number'])
    expect(await refused({ repo: [billing.dir], maxConcurrentDispatches: 1.5 }, {}, [billing])).toEqual([
      'err: --max-concurrent-dispatches must be a whole number (got 1.5)',
    ])
    expect(await refused({ repo: [billing.dir], heartbeat: 0 }, {}, [billing])).toEqual(['err: --heartbeat must be greater than 0 (got 0)'])
  })

  it('a --repo that is not a git repository', async () => {
    const billing = toyRepo(parent, 'billing')
    const plain = mkdtempSync(join(parent, 'plain-'))
    expect(await refused({ repo: [billing.dir, plain] }, {}, [billing])).toEqual([
      `err: ${plain} is not a git repository — \`up\` needs one writable clone (pass --repo)`,
    ])
  })
})
