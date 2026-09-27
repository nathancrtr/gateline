// Several engines in one process, under one governor (#502): toy
// repositories, fake dispatchers, and `startOrchestrators` itself. No live
// dispatch anywhere, and every expected value is written out here, never
// computed by the code under test.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineHealthPath, LocalGitSource } from '@gateline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine, type EngineConfig } from '../src/engine.ts'
import { Governor, type SpendReport } from '../src/governor.ts'
import { parseLedger } from '../src/observe.ts'
import { Scheduler, sweepSlug } from '../src/schedule.ts'
import { stagedShutdown } from '../src/shutdown.ts'
import { assembleOrchestrator, assembleOrchestrators, DuplicateRepositoryError, type RepositoryEngineConfig, startOrchestrator, startOrchestrators } from '../src/start.ts'
import { runLoop } from '../src/triggers.ts'
import { agentCommit, type Clock, deadEngineId, deferred, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }
const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
/** Long enough that no real heartbeat fires inside a test: every boundary is triggered by hand. */
const HEARTBEAT_SECONDS = 600

const cleanups: string[] = []
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)
beforeEach(() => {
  unhandled.length = 0
  process.on('unhandledRejection', onUnhandled)
})
afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (dir: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG, ...env } }).trim()

function toyRepo() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

/**
 * A byte-for-byte copy of a repository in a directory of its own: the same
 * commits, so the same tips — two repositories with a run of the same name
 * whose branches are even the same commit, the case a slug-keyed memo gets
 * most wrong.
 */
function copyRepo(dir: string): string {
  const parent = mkdtempSync(join(tmpdir(), 'gateline-copy-'))
  cleanups.push(parent)
  const copy = join(parent, 'copy')
  cpSync(dir, copy, { recursive: true })
  return copy
}

/** An analyst that writes its spec at once. */
const promptSpec = (clock: Clock) =>
  new FakeDispatcher((req) => {
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })

/** An analyst held until `open()`, so its job stays in flight. */
function heldSpec(clock: Clock) {
  const gate = deferred<void>()
  const dispatcher = new FakeDispatcher(async (req) => {
    await gate.promise
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })
  return { dispatcher, open: () => gate.resolve() }
}

async function health(dir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(await engineHealthPath(dir), 'utf8')) as Record<string, unknown>
}

async function ledgerOf(dir: string, slug = 'toy') {
  const source = new LocalGitSource('t', dir)
  const ref = (await source.listRuns()).find((r) => r.slug === slug)!
  return parseLedger((await source.readState(ref)).state!)
}

/** A throwaway code checkout for the code-tree monitor, on main with one commit. */
function codeRepo(): { dir: string; commit: (msg: string) => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-code-'))
  cleanups.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Toy'])
  git(dir, ['config', 'user.email', 'toy@example.test'])
  const commit = (msg: string) => {
    writeFileSync(join(dir, 'file.txt'), `${msg}\n`)
    git(dir, ['add', '.'])
    git(dir, ['commit', '-q', '-m', msg])
  }
  commit('initial')
  return { dir, commit }
}

function entry(dir: string, name: string, over: Partial<RepositoryEngineConfig> = {}): RepositoryEngineConfig {
  return { repoDir: dir, repositoryId: `local/${name}`, displayName: name, ...over }
}

describe('startOrchestrators: several engines, one governor', () => {
  it('runs one engine per repository under one governor; each source carries its repository id; log lines name the repository', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const handle = await startOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alpha.dispatcher }), entry(b.dir, 'beta', { dispatcher: beta.dispatcher })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const [ea, eb] = handle.engines
    // Both startup ticks dispatched the analyst for their own `toy`.
    expect(ea!.engine.inFlightDetail().map((j) => j.slug)).toEqual(['toy'])
    expect(eb!.engine.inFlightDetail().map((j) => j.slug)).toEqual(['toy'])
    expect(handle.inFlightDetail().map((j) => `${j.repository}:${j.slug}:${j.role}`).sort()).toEqual(['alpha:toy:analyst', 'beta:toy:analyst'])
    // One governor for both, holding both slots.
    expect(ea!.engine.governor).toBe(handle.governor)
    expect(eb!.engine.governor).toBe(handle.governor)
    expect((handle.governor as Governor).snapshot().occupied).toBe(2)
    expect(lines.filter((l) => l.includes('built its own governor'))).toEqual([])
    // The source takes the id; so does every RunRef it reads.
    expect(ea!.engine.source.id).toBe('local/alpha')
    expect(eb!.engine.source.id).toBe('local/beta')
    expect((await ea!.engine.source.listRuns()).map((r) => r.source)).toEqual(['local/alpha'])
    expect(ea!.engine.repository).toBe('local/alpha')
    // Every engine line carries its repository, the startup dispatch lines among them.
    expect(lines.filter((l) => !l.startsWith('[alpha] ') && !l.startsWith('[beta] '))).toEqual([])
    expect(lines.filter((l) => l.includes('[startup] toy: dispatch')).map((l) => l.split(' ')[0])).toEqual(['[alpha]', '[beta]'])

    alpha.open()
    beta.open()
    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    // Stopped cleanly: both have left the governor.
    expect((handle.governor as Governor).snapshot().occupied).toBe(0)
    expect(handle.governor.unseeded()).toEqual([])
    expect(unhandled).toEqual([])
  })

  it('two repositories with a run of the same slug share no draft-PR memo, no jobs and no deferrals', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const copy = copyRepo(a.dir)
    // The same commit at the tip of both run branches.
    expect(git(copy, ['rev-parse', 'run/toy'])).toBe(git(a.dir, ['rev-parse', 'run/toy']))
    const lines: string[] = []
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(a.clock)
    const handle = await startOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alpha.dispatcher }), entry(copy, 'beta', { dispatcher: beta.dispatcher })],
      limits: { maxConcurrentDispatches: 1 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const [ea, eb] = handle.engines
    // Each engine ensured its own run's draft PR, although the slug and the tip are the same.
    expect(lines.filter((l) => l.endsWith('toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed'))).toEqual([
      '[alpha] toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
      '[beta] toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
    ])
    // alpha holds the one slot; beta's `toy` is deferred, and only beta says so.
    expect(ea!.engine.inFlight()).toBe(1)
    expect(eb!.engine.inFlight()).toBe(0)
    expect(ea!.engine.deferrals()).toEqual([])
    expect(eb!.engine.deferrals().map((d) => ({ slug: d.slug, rule: d.rule, repository: d.repository }))).toEqual([{ slug: 'toy', rule: 'MC', repository: 'local/beta' }])

    // alpha's job settling frees the slot; beta's own `toy` goes next, on its own job.
    alpha.open()
    await vi.waitFor(() => expect(eb!.engine.inFlight()).toBe(1), { timeout: 20_000, interval: 50 })
    expect(ea!.engine.inFlight()).toBe(0)
    beta.open()
    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(copy)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(unhandled).toEqual([])
  })

  it('two repositories with a finished run of the same slug each reap their own leftover task branches', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const human = new LocalGitSource('h', a.dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    expect((await human.writeState(ref, (doc) => doc.setIn(['phase'], 'done'), 'state(toy): done by Human')).ok).toBe(true)
    git(a.dir, ['branch', 'run/toy--job/analyst', 'run/toy'])
    const copy = copyRepo(a.dir)
    const gov = new Governor()
    const one = new Engine({ repoDir: a.dir, identity: BOT, dispatcher: promptSpec(a.clock), registry: TEST_REGISTRY, governor: gov, repository: 'local/alpha' })
    const two = new Engine({ repoDir: copy, identity: BOT, dispatcher: promptSpec(a.clock), registry: TEST_REGISTRY, governor: gov, repository: 'local/beta' })
    await one.tick()
    await two.tick()
    expect(git(a.dir, ['branch', '--list', 'run/toy--job/*'])).toBe('')
    expect(git(copy, ['branch', '--list', 'run/toy--job/*'])).toBe('')
  })

  it('refuses a list that names one repository twice, naming both entries', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    // The same directory, once through a subdirectory.
    await expect(startOrchestrators({ repositories: [entry(a.dir, 'alpha'), entry(join(a.dir, 'contracts'), 'again')], codeRepo: null })).rejects.toThrow(
      new DuplicateRepositoryError(
        `alpha (local/alpha at ${a.dir}) and again (local/again at ${join(a.dir, 'contracts')}) are the same repository: both resolve to ${readRealpath(a.dir)} — one engine per repository`,
      ),
    )
    // The same id, differing only in case.
    await expect(
      startOrchestrators({ repositories: [entry(a.dir, 'alpha'), { repoDir: b.dir, repositoryId: 'LOCAL/Alpha', displayName: 'beta' }], codeRepo: null }),
    ).rejects.toThrow(`alpha (local/alpha at ${a.dir}) and beta (LOCAL/Alpha at ${b.dir}) have the same id, compared without case — one engine per repository`)
    // Two checkouts of one clone.
    const worktree = join(mkdtempSync(join(tmpdir(), 'gateline-wt-')), 'wt')
    cleanups.push(worktree)
    git(a.dir, ['worktree', 'add', '-q', worktree, 'run/toy'])
    await expect(startOrchestrators({ repositories: [entry(a.dir, 'alpha'), entry(worktree, 'beta')], codeRepo: null })).rejects.toThrow(
      `alpha (local/alpha at ${a.dir}) and beta (local/beta at ${worktree}) share one git directory (${readRealpath(join(a.dir, '.git'))}): they are checkouts of one clone, whose runs are one set of branches — one engine per repository`,
    )
    git(a.dir, ['worktree', 'remove', '--force', worktree])
  })

  it('refuses the remote runner with several repositories (#507)', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    await expect(
      startOrchestrators({ repositories: [entry(a.dir, 'alpha', { runner: { enabled: true } }), entry(b.dir, 'beta')], codeRepo: null }),
    ).rejects.toThrow('the remote runner serves one repository (#507, MULTI-REPO.md §8.5) — it cannot be enabled with several')
  })
})

function readRealpath(p: string): string {
  return execFileSync('realpath', [p], { encoding: 'utf8' }).trim()
}

describe('one governor, seeded before any loop starts', () => {
  it('every engine registers and seeds before the first reservation, and no engine builds its own governor', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const events: string[] = []
    class SpyGovernor extends Governor {
      override register(repository: string, opts?: { spendLimitUsd?: number | null; displayName?: string }): void {
        events.push(`register ${repository}`)
        super.register(repository, opts)
      }
      override seed(repository: string, entries: Parameters<Governor['seed']>[1]): void {
        events.push(`seed ${repository}`)
        super.seed(repository, entries)
      }
      override reserve(req: Parameters<Governor['reserve']>[0]) {
        events.push(`reserve ${req.repository}`)
        return super.reserve(req)
      }
    }
    const lines: string[] = []
    const handle = await startOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      governor: new SpyGovernor({ maxConcurrentDispatches: 2 }),
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    await handle.stop()
    const firstReserve = events.findIndex((e) => e.startsWith('reserve'))
    expect(firstReserve).toBeGreaterThan(0)
    // Both registered first, in list order; both seeded before anything was asked of the governor.
    expect(events.slice(0, 2)).toEqual(['register local/alpha', 'register local/beta'])
    // The seeds run concurrently, so their order between themselves is not fixed.
    expect(events.slice(0, firstReserve).filter((e) => e.startsWith('seed')).sort()).toEqual(['seed local/alpha', 'seed local/beta'])
    expect(lines.filter((l) => l.includes('built its own governor'))).toEqual([])
    expect(lines.filter((l) => l.includes('has reported its open dispatches since startup'))).toEqual([])
  })

  it("a repository's own ceiling reaches the governor: alpha is held by it and beta is not", { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    // No registry in the toy host: every role is estimated at $5.
    const handle = await startOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock), spendLimitUsd: 4 }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2, spendLimitUsd: 100 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const [ea, eb] = handle.engines
    expect(ea!.engine.deferrals().map((d) => [d.rule, d.limit, d.reason])).toEqual([
      [
        'HB',
        'repository-spend',
        "projected spend for alpha $5.00 over the last 24 hours (ledger $0.00 in the window + $5.00 in flight and requested) exceeds that repository's own ceiling $4 — deferred, not paused: the window rolls and the run re-derives",
      ],
    ])
    expect(eb!.engine.deferrals()).toEqual([])
    await handle.stop()
    expect((await ledgerOf(b.dir)).length).toBe(1)
    expect((await ledgerOf(a.dir)).length).toBe(0)
  })

  it('a repository whose startup seed fails holds no other back, and seeds on its own first tick', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const alpha = set.engines[0]!.engine
    const listRuns = alpha.source.listRuns.bind(alpha.source)
    let failures = 1
    alpha.source.listRuns = (async () => {
      if (failures-- > 0) throw new Error('index.lock held')
      return listRuns()
    }) as typeof listRuns
    const handle = await set.start()
    expect(lines).toContain('[alpha] governor seed failed: index.lock held — engine marked failed in its health file (1 in a row); retried on the first tick')
    expect(lines).toContain('[alpha] it leaves the governor until it seeds, so no other repository waits for it')
    await handle.stop()
    // Both dispatched: beta was never held by alpha, and alpha seeded on its startup tick.
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(lines.filter((l) => l.includes('has reported its open dispatches since startup'))).toEqual([])
  })
})

describe('fault isolation: one engine failing leaves the others running', () => {
  it('a git write that fails persistently marks alpha failed; beta keeps dispatching; nothing reaches the process', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const alpha = set.engines[0]!.engine
    const writeState = alpha.source.writeState.bind(alpha.source)
    let broken = true
    alpha.source.writeState = (async (...args: Parameters<typeof writeState>) => {
      if (broken) throw new Error('disk on fire')
      return writeState(...args)
    }) as typeof writeState
    const handle = await set.start()
    const [ea, eb] = handle.engines

    // beta dispatched and settled on its own.
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    // alpha: failed, in its own health file, with the governor's slot given back.
    expect(lines).toContain('[alpha] tick failed: disk on fire — engine marked failed in its health file (1 in a row)')
    expect((await health(a.dir)).failed).toMatchObject({ where: 'tick', reason: 'disk on fire' })
    expect((await health(b.dir)).failed).toBeUndefined()
    expect(alpha.inFlight()).toBe(0)

    // A second fault (the ref watcher may already have brought one), then the
    // loop stops chasing non-boundary triggers.
    if (alpha.faultState()!.failures < 2) await ea!.loop.trigger('refs')
    expect(alpha.faultState()!.failures).toBeGreaterThanOrEqual(2)
    let ticks = 0
    const tick = alpha.tick.bind(alpha)
    alpha.tick = () => {
      ticks++
      return tick()
    }
    await ea!.loop.trigger('refs')
    await ea!.loop.trigger('wake')
    await ea!.loop.trigger('completion')
    expect(ticks).toBe(0)
    expect(lines.some((l) => /^\[alpha\] \d passes in a row failed — until one completes, this engine retries on the heartbeat only$/.test(l))).toBe(true)
    // The heartbeat still retries: after the fault clears, alpha recovers and dispatches.
    broken = false
    await ea!.loop.trigger('heartbeat')
    expect(ticks).toBe(1)
    expect((await health(a.dir)).failed).toBeUndefined()
    expect(lines.some((l) => /^\[alpha\] recovered after \d fault\(s\) — engine no longer marked failed$/.test(l))).toBe(true)

    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(eb!.engine.faultState()).toBeNull()
    expect(unhandled).toEqual([])
  })

  it('a closing commit that throws is caught at the settlement: alpha is marked failed, its slot is released, beta is untouched', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const alphaHeld = heldSpec(a.clock)
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alphaHeld.dispatcher }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const alpha = set.engines[0]!.engine
    const handle = await set.start()
    expect(alpha.inFlight()).toBe(1)
    // The fault as it is recorded. The completion pass that follows writes
    // nothing, completes, and clears it by design, so a look afterwards races.
    const recorded: { where: string; reason: string }[] = []
    const noteFault = alpha.noteFault.bind(alpha)
    alpha.noteFault = (where, e, context) => {
      const fault = noteFault(where, e, context)
      recorded.push({ where: fault.where, reason: fault.reason })
      return fault
    }
    // From here every state write in alpha fails: the job's closing commit throws.
    alpha.source.writeState = (async () => {
      throw new Error('object store corrupt')
    }) as typeof alpha.source.writeState
    alphaHeld.open()
    await vi.waitFor(() => expect(alpha.inFlight()).toBe(0), { timeout: 20_000, interval: 50 })
    // Before #502 this rejection reached the process: Node ends it for one, and every engine with it.
    await new Promise((r) => setTimeout(r, 100))
    expect(unhandled.map((e) => (e as Error).message)).toEqual([])
    await vi.waitFor(() => expect(lines).toContain(
      '[alpha] a dispatch settlement failed (toy: analyst): object store corrupt — engine marked failed in its health file (1 in a row); a ledger entry it could not close is aged by the stale sweep',
    ), { timeout: 10_000, interval: 50 })
    expect(recorded).toEqual([{ where: 'settlement', reason: 'object store corrupt' }])
    // beta is untouched; once its own dispatch settles, nothing is reserved:
    // alpha's slot came back although its close threw.
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    await vi.waitFor(() => expect(handle.engines[1]!.engine.inFlight()).toBe(0), { timeout: 20_000, interval: 50 })
    expect((handle.governor as Governor).snapshot()).toMatchObject({ reservations: 0 })
    await handle.stop()
    expect(unhandled).toEqual([])
  })
})

describe('fault isolation: a sweep settlement that throws', () => {
  it('is caught, told to the engine, and gives its slot back', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'orchestrator.yaml': 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 50\n' }, 'schedules')
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    const faults: string[] = []
    let scheduler: Scheduler | null = null
    const sweeper = new FakeDispatcher(() => {
      // The closing commit's first git read fails, after the sweep has run.
      const git = (scheduler as unknown as { git: { revParse: () => Promise<string | null> } }).git
      git.revParse = async () => {
        throw new Error('fatal: bad object HEAD')
      }
      return {}
    })
    scheduler = new Scheduler({
      repoDir: dir,
      identity: BOT,
      dispatcher: sweeper,
      registry: TEST_REGISTRY,
      governor: gov,
      repository: 'local/toy',
      onFault: (e, context) => faults.push(`${context}: ${(e as Error).message}`),
    })
    const outcomes = await scheduler.tick()
    expect(outcomes.map((o) => o.kind)).toEqual(['dispatched'])
    await scheduler.drain()
    await new Promise((r) => setTimeout(r, 100))
    expect(unhandled.map((e) => (e as Error).message)).toEqual([])
    expect(faults).toEqual([`sweep ${sweepSlug('historian', new Date())}: fatal: bad object HEAD`])
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0 })
  })
})

describe('one code tree, one supersede, one shutdown', () => {
  async function twoHeld(code: string | null, onSupersede?: () => void) {
    const a = toyRepo()
    const b = toyRepo()
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const handle = await startOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alpha.dispatcher }), entry(b.dir, 'beta', { dispatcher: beta.dispatcher })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: code,
      log: () => {},
      onSupersede,
    })
    return { a, b, alpha, beta, handle }
  }

  it('a clean fast-forward supersedes once, and the drain waits for both engines', { timeout: 90_000 }, async () => {
    const code = codeRepo()
    let supersedes = 0
    let stopped: Promise<void> | null = null
    const { a, b, alpha, beta, handle } = await twoHeld(code.dir, () => {
      supersedes++
      stopped = handle.stop()
    })
    const [ea, eb] = handle.engines
    expect(ea!.engine.inFlight() + eb!.engine.inFlight()).toBe(2)
    code.commit('a framework fix lands')
    // Two rounds of heartbeats: the monitor confirms a fast-forward on its second consecutive check.
    await ea!.loop.trigger('heartbeat')
    await eb!.loop.trigger('heartbeat')
    expect(supersedes).toBe(0)
    expect((await health(a.dir)).codeState).toBe('superseded-pending')
    expect((await health(b.dir)).codeState).toBe('superseded-pending')
    await ea!.loop.trigger('heartbeat')
    await eb!.loop.trigger('heartbeat')
    expect(supersedes).toBe(1)
    expect(stopped).not.toBeNull()
    let done = false
    void stopped!.then(() => {
      done = true
    })
    alpha.open()
    await vi.waitFor(() => expect(ea!.engine.inFlight()).toBe(0), { timeout: 20_000, interval: 50 })
    await new Promise((r) => setTimeout(r, 200))
    expect(done).toBe(false) // beta's dispatch is still running: the drain waits for it
    beta.open()
    await stopped!
    expect(done).toBe(true)
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    await ea!.loop.trigger('heartbeat')
    expect(supersedes).toBe(1)
  })

  it("a paused code tree idles every engine at once, on another loop's check", { timeout: 90_000 }, async () => {
    const code = codeRepo()
    const { a, b, alpha, beta, handle } = await twoHeld(code.dir)
    const [ea, eb] = handle.engines
    let betaTicks = 0
    const tick = eb!.engine.tick.bind(eb!.engine)
    eb!.engine.tick = () => {
      betaTicks++
      return tick()
    }
    writeFileSync(join(code.dir, 'scratch.txt'), 'wip')
    await ea!.loop.trigger('heartbeat') // alpha's check sees the dirty tree
    await eb!.loop.trigger('refs') // beta has not checked since; it idles on alpha's observation
    expect(betaTicks).toBe(0)
    expect((await health(b.dir)).codeState).toBe('paused')
    expect((await health(a.dir)).codeState).toBe('paused')
    rmSync(join(code.dir, 'scratch.txt'))
    await ea!.loop.trigger('heartbeat')
    await eb!.loop.trigger('refs')
    expect(betaTicks).toBeGreaterThanOrEqual(1) // fresh again: beta ticks (its ref watcher may add one)
    alpha.open()
    beta.open()
    await handle.stop()
  })

  it('one signal drains every engine, naming each dispatch with its repository, and exits once', { timeout: 90_000 }, async () => {
    const { a, b, alpha, beta, handle } = await twoHeld(null)
    const said: string[] = []
    const exits: number[] = []
    const onSignal = stagedShutdown({
      inFlight: () => handle.inFlightDetail(),
      drain: () => handle.stop(),
      abort: () => handle.abortInFlight(),
      log: (l) => said.push(l),
      exit: (code) => exits.push(code),
    })
    onSignal()
    expect(said.slice(1).map((l) => l.replace(/running \d+min$/, 'running Nmin')).sort()).toEqual([
      '  analyst on toy in alpha — running Nmin',
      '  analyst on toy in beta — running Nmin',
    ])
    alpha.open()
    await new Promise((r) => setTimeout(r, 300))
    expect(exits).toEqual([])
    beta.open()
    await vi.waitFor(() => expect(exits).toEqual([0]), { timeout: 20_000, interval: 50 })
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
  })
})

describe('the list of one is the old behaviour', () => {
  it('startOrchestrator writes the same commits, ledger and health keys as the pre-#502 assembly, and the same log lines once the prefix is removed', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const copy = copyRepo(a.dir)
    const normalize = (text: string) => text.replace(/^(\s*(?:- )?at: ).*$/gm, '$1<at>').replace(/^(\s*engine: ).*$/gm, '$1<engine>')

    // The pre-#502 startOrchestrator, written out: assemble, seed, loop.
    const oldLines: string[] = []
    const old = await assembleOrchestrator({ repoDir: a.dir, dispatcher: promptSpec(a.clock), log: (l) => oldLines.push(l) })
    await old.engine.seedGovernor()
    const oldLoop = await runLoop(old.engine, a.dir, { heartbeatMs: HEARTBEAT_SECONDS * 1000, scheduler: old.scheduler, log: (l) => oldLines.push(l), staleProbe: old.manifestStaleProbe })
    await oldLoop.stop()

    const newLines: string[] = []
    const handle = await startOrchestrator({ repoDir: copy, dispatcher: promptSpec(a.clock), heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null, log: (l) => newLines.push(l) })
    await handle.stop()

    const subjects = (dir: string) => git(dir, ['log', '--format=%an|%s', 'run/toy']).split('\n')
    expect(subjects(copy)).toEqual(subjects(a.dir))
    expect(normalize(git(copy, ['show', 'run/toy:runs/toy/state.yaml']))).toEqual(normalize(git(a.dir, ['show', 'run/toy:runs/toy/state.yaml'])))
    expect(Object.keys(await health(copy))).toEqual(Object.keys(await health(a.dir)))
    // The one visible change: every line names the repository, here by its
    // directory's name. Paths differ only because the directories do.
    const paths = (lines: string[], dir: string) => lines.map((l) => l.replaceAll(dir, '<repo>').replace(/gateline-orchestrator\/[0-9a-f]{12}\//g, 'gateline-orchestrator/<hash>/'))
    expect(newLines.every((l) => l.startsWith('[copy] '))).toBe(true)
    expect(paths(newLines.map((l) => l.slice('[copy] '.length)), copy)).toEqual(paths(oldLines, a.dir))
    expect(oldLines.length).toBeGreaterThan(2)
    expect(handle.engine.source.id).toBe('local/copy')
  })
})

describe('Governor.unregister (#502)', () => {
  const clockAt = (start: number) => {
    let t = start
    return { now: () => new Date(t), advance: (ms: number) => (t += ms) }
  }

  it('frees the seed gate: a registered repository that never seeds stops blocking the others', () => {
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    gov.register('local/alpha', { displayName: 'alpha' })
    gov.register('local/beta')
    gov.seed('local/beta', [])
    const refused = gov.reserve({ repository: 'local/beta', intents: [{ key: 'toy|analyst||', estimateUsd: 2 }] })
    expect(refused.granted).toEqual([])
    expect(refused.refusal).toMatchObject({ limit: 'concurrency', unseeded: ['local/alpha'], names: { 'local/alpha': 'alpha' } })
    expect(gov.unseeded()).toEqual(['local/alpha'])
    gov.unregister('local/alpha')
    expect(gov.unseeded()).toEqual([])
    expect(gov.reserve({ repository: 'local/beta', intents: [{ key: 'toy|analyst||', estimateUsd: 2 }] }).granted).toHaveLength(1)
  })

  it('releases its live reservations and startup holds, and leaves the round-robin', async () => {
    const gov = new Governor({ maxConcurrentDispatches: 3, minWakeIntervalMs: 0 })
    gov.register('local/alpha')
    gov.register('local/beta')
    gov.seed('local/alpha', [{ key: 'old|analyst||', at: new Date().toISOString(), estimateUsd: 2, timeoutMs: 60_000, kind: 'dispatch' }])
    gov.seed('local/beta', [])
    const held = gov.reserve({ repository: 'local/alpha', intents: [{ key: 'toy|analyst||', estimateUsd: 2 }, { key: 'toy2|analyst||', estimateUsd: 2 }] })
    expect(held.granted).toHaveLength(2)
    expect(gov.snapshot().occupied).toBe(3)
    let woken = 0
    gov.subscribe('local/alpha', async () => {
      throw new Error('a stopped engine is never woken')
    })
    gov.subscribe('local/beta', async () => {
      woken++
    })
    expect(gov.reserve({ repository: 'local/beta', intents: [{ key: 'b|analyst||', estimateUsd: 2 }] }).granted).toEqual([])
    gov.unregister('local/alpha')
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0, holds: 0 })
    await gov.idle()
    expect(woken).toBe(1)
    // A later release of a revoked reservation does nothing.
    held.granted[0]!.release(9)
    expect(gov.snapshot().settled).toBe(0)
    expect(gov.reserve({ repository: 'local/beta', intents: [{ key: 'b|analyst||', estimateUsd: 2 }] }).granted).toHaveLength(1)
  })

  it('keeps what the repository spent inside the window in the machine sum until the window rolls past it', async () => {
    const clock = clockAt(Date.parse('2026-09-27T12:00:00.000Z'))
    const gov = new Governor({ maxConcurrentDispatches: 0, spendLimitUsd: 10, now: clock.now })
    gov.register('local/alpha')
    gov.register('local/beta')
    gov.seed('local/alpha', [])
    gov.seed('local/beta', [])
    // alpha: $4 closed an hour ago, and a $3 dispatch that settled after its report.
    await gov.report('local/alpha', () => ({ closed: [{ key: 'old|analyst||', at: '2026-09-27T11:00:00.000Z', costUsd: 4, kind: 'dispatch' }], open: [] }))
    const [r] = gov.reserve({ repository: 'local/alpha', intents: [{ key: 'toy|analyst||', estimateUsd: 2 }] }).granted
    r!.commit('2026-09-27T12:00:00.000Z')
    r!.release(3)
    expect(gov.machineSpend()).toEqual({ closed: 7, open: 0 })

    gov.unregister('local/alpha')
    // The money stays: $7 of the $10 is spent.
    expect(gov.machineSpend()).toEqual({ closed: 7, open: 0 })
    const refused = gov.reserve({ repository: 'local/beta', intents: [{ key: 'b|analyst||', estimateUsd: 4 }] })
    expect(refused.refusal).toMatchObject({ limit: 'spend', closedUsd: 7, requestedUsd: 4 })
    expect(gov.reserve({ repository: 'local/beta', intents: [{ key: 'b|analyst||', estimateUsd: 3 }] }).granted).toHaveLength(1)

    // Twenty-four hours after the $4 opened it has left the window; the $3 leaves an hour later.
    clock.advance(23 * 3_600_000 + 1)
    expect(gov.machineSpend()).toEqual({ closed: 3, open: 3 })
    clock.advance(3_600_000)
    expect(gov.machineSpend()).toEqual({ closed: 0, open: 3 })
  })

  it("counts a stopped repository's open entries at their estimate, and a later report of it replaces what it left", async () => {
    const clock = clockAt(Date.parse('2026-09-27T12:00:00.000Z'))
    const gov = new Governor({ maxConcurrentDispatches: 0, spendLimitUsd: 10, now: clock.now })
    gov.register('local/alpha')
    gov.seed('local/alpha', [])
    const report: SpendReport = {
      closed: [{ key: 'a|analyst||', at: '2026-09-27T11:00:00.000Z', costUsd: 1, kind: 'dispatch' }],
      open: [{ key: 'b|architect||', at: '2026-09-27T11:30:00.000Z', estimateUsd: 2, kind: 'dispatch' }],
    }
    await gov.report('local/alpha', () => report)
    gov.unregister('local/alpha')
    expect(gov.machineSpend()).toEqual({ closed: 3, open: 0 })
    // Registered again, its first report reads the same ledgers: counted once, not twice.
    gov.register('local/alpha')
    gov.seed('local/alpha', [])
    await gov.report('local/alpha', () => report)
    expect(gov.machineSpend()).toEqual({ closed: 1, open: 2 })
  })
})

describe('the seed gate and a failed engine in the health file (#502)', () => {
  it('writes `unseeded` while the governor waits on a repository, and nothing extra once it does not', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const gov = new Governor({ maxConcurrentDispatches: 2 })
    const engine = new Engine({ repoDir: a.dir, identity: BOT, dispatcher: promptSpec(a.clock), registry: TEST_REGISTRY, governor: gov, repository: 'local/alpha', displayName: 'alpha' })
    gov.register('local/ghost', { displayName: 'ghost' })
    const lines: string[] = []
    const loop = await runLoop(engine, a.dir, { heartbeatMs: HEARTBEAT_SECONDS * 1000, log: (l) => lines.push(l) })
    expect((await health(a.dir)).unseeded).toEqual(['local/ghost'])
    expect(engine.deferrals().map((d) => d.reason)).toEqual([
      '1 dispatch(es) deferred — the governor grants nothing until ghost has reported its open dispatches since startup; re-derived once it has',
    ])
    gov.unregister('local/ghost')
    await loop.trigger('heartbeat')
    const after = await health(a.dir)
    expect(after.unseeded).toBeUndefined()
    expect(after.failed).toBeUndefined()
    await loop.stop()
  })
})

describe('sweep markers name their engine, and a dead sweep holds no slot (#502)', () => {
  const REGISTRY = { ...TEST_REGISTRY, estimates: { ...TEST_REGISTRY.estimates, historian: 3 } }
  const DELTA = '# Docs Delta: sweep\n\n## Drift found\n\n## Applied changes\n\n## Proposed actions\n\n## Escalations\n\n## Surfaces checked, no drift\n'

  it('a sweep marker records the engine id as an added line; every existing field is unchanged and in order', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'orchestrator.yaml': 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 5\n' }, 'schedules')
    const sweeper = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { [`runs/${sweepSlug('historian', new Date())}/docs-delta.md`]: DELTA }, 'docs delta')
      return {}
    })
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher: sweeper, registry: REGISTRY, governor: new Governor(), repository: 'local/toy', engineId: 'host.example:4242#1' })
    await scheduler.tick()
    await scheduler.drain()
    const slug = sweepSlug('historian', new Date())
    // The seed commit, the one that opened the sweep.
    const seed = git(dir, ['log', '--format=%H', '--grep', `sweep(${slug}): dispatched`, '--fixed-strings', `run/${slug}`])
    const opened = git(dir, ['show', `${seed}:runs/${slug}/sweep.yaml`]).split('\n')
    expect(opened.filter((l) => !l.startsWith('#')).map((l) => l.split(':')[0])).toEqual([
      'sweep',
      'role',
      'every',
      'at',
      'covering_since',
      'adapter',
      'model',
      'engine',
      'cost_limit_usd',
      'tokens_in',
      'tokens_out',
      'cost_usd',
    ])
    expect(opened).toContain('engine: "host.example:4242#1"')
    // The closing commit metered it as before, keeping the line.
    const closed = git(dir, ['show', `run/${slug}:runs/${slug}/sweep.yaml`]).split('\n')
    expect(closed).toContain('engine: "host.example:4242#1"')
    expect(closed).toContain('cost_usd: 1.25')
  })

  /** An open (never metered) sweep marker on its branch, naming `engine`. */
  function openSweep(dir: string, clock: Clock, engine: string | null, minutesAgo = 5): string {
    const at = new Date(Date.now() - minutesAgo * 60_000)
    const slug = `historian-${at.toISOString().slice(0, 10)}`
    git(dir, ['checkout', '-q', '-b', `run/${slug}`, 'main'])
    const marker =
      `sweep: ${slug}\nrole: historian\nevery: 7d\nat: ${at.toISOString()}\ncovering_since: null\nadapter: fake\nmodel: null\n` +
      `${engine ? `engine: ${JSON.stringify(engine)}\n` : ''}cost_limit_usd: 5\ntokens_in: null\ntokens_out: null\ncost_usd: null\n`
    agentCommit(dir, clock, { [`runs/${slug}/sweep.yaml`]: marker }, `sweep(${slug}): dispatched historian`)
    git(dir, ['checkout', '-q', 'main'])
    return slug
  }

  it.each([
    ['whose engine process is gone', () => deadEngineId(), 0],
    ['whose engine is another live process here', () => `${hostname()}:${process.pid}#999`, 1],
    ['that names no engine (written before #502)', () => null, 1],
    ['whose engine is on another host', () => 'elsewhere.example:1', 1],
  ])('the seed holds a slot for an open sweep %s: %s hold(s)', async (_name, engine, holds) => {
    const { dir, clock } = toyRepo()
    openSweep(dir, clock, engine())
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    await new Engine({ repoDir: dir, identity: BOT, dispatcher: promptSpec(clock), registry: REGISTRY, governor: gov }).seedGovernor()
    expect(gov.snapshot().holds).toBe(holds)
  }, 60_000)

  it('a hold clears on the next report once its engine process dies, and the sweep still counts toward spend', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    try {
      openSweep(dir, clock, `${hostname()}:${child.pid}`)
      const gov = new Governor({ maxConcurrentDispatches: 1, spendLimitUsd: 100 })
      const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: heldSpec(clock).dispatcher, registry: REGISTRY, governor: gov })
      await engine.seedGovernor()
      expect(gov.snapshot().holds).toBe(1)
      const first = await engine.tick()
      expect(first.find((o) => o.slug === 'toy')!.action.rule).toBe('MC') // the sweep's slot is taken
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      await engine.refreshGovernor()
      expect(gov.snapshot().holds).toBe(0)
      expect(gov.machineSpend()).toEqual({ closed: 0, open: 3 }) // the historian estimate, still counted
    } finally {
      child.kill('SIGKILL')
    }
  })
})

describe('the spend report when sweep markers cannot be read (#501 review)', () => {
  class ReportSpy extends Governor {
    reports: SpendReport[] = []
    override async report(repository: string, gather: () => SpendReport | Promise<SpendReport>): Promise<void> {
      return super.report(repository, async () => {
        const report = await gather()
        this.reports.push(report)
        return report
      })
    }
  }
  const make = (dir: string, clock: Clock, gov: Governor, over: Partial<EngineConfig>) =>
    new Engine({ repoDir: dir, identity: BOT, dispatcher: promptSpec(clock), registry: TEST_REGISTRY, governor: gov, ...over })

  it('says sweepsRead: false when the marker reader fails, and leaves it unsaid when it works', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    const failing = new ReportSpy()
    await make(dir, clock, failing, {
      sweepMarkerReader: async () => {
        throw new Error('bad object refs/heads/run/historian-2026-09-27')
      },
    }).refreshGovernor()
    expect(failing.reports.map((r) => r.sweepsRead)).toEqual([false])

    const working = new ReportSpy()
    await make(dir, clock, working, {}).refreshGovernor()
    expect(working.reports.map((r) => r.sweepsRead)).toEqual([undefined])
  })
})

describe('the standalone binary stays single-repository (#502)', () => {
  it('its --help says it has a governor of its own and must not run beside `gateline up`', { timeout: 60_000 }, () => {
    const main = join(import.meta.dirname, '..', 'src', 'main.ts')
    const help = execFileSync(process.execPath, [main, '--help'], { encoding: 'utf8' })
    expect(help).toContain(
      'This binary serves one repository, and its limits are held by a governor of its own that is not\n' +
        'shared with `gateline up`. Do not run it beside `gateline up` on one machine: each process enforces\n' +
        '--max-concurrent-dispatches and --spend-limit-usd separately, so together they can run twice the\n' +
        'dispatches and spend twice the limit per window.',
    )
  })
})
