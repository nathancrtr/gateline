// Several engines in one process, under one governor (#502): toy
// repositories, fake dispatchers, and `startOrchestrators` itself. No live
// dispatch anywhere, and every expected value is written out here, never
// computed by the code under test.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineHealthPath, LocalGitSource } from '@gateline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine, type EngineConfig } from '../src/engine.ts'
import { Governor, refusalReason, refusalRule, type SpendReport } from '../src/governor.ts'
import { parseLedger } from '../src/observe.ts'
import { Scheduler, sweepSlug } from '../src/schedule.ts'
import { stagedShutdown } from '../src/shutdown.ts'
import {
  assembleOrchestrator,
  assembleOrchestrators,
  DuplicateRepositoryError,
  defaultRepositoryId,
  type OrchestratorsHandle,
  type OrchestratorsOptions,
  type RepositoryEngineConfig,
  startOrchestrator,
  startOrchestrators,
} from '../src/start.ts'
import { runLoop } from '../src/triggers.ts'
import { agentCommit, type Clock, deadEngineId, deferred, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'
import { manifestJson } from './host-repo.helper.ts'

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

/**
 * Start the engines and wait for every startup pass (#502): `startOrchestrators`
 * returns its handle before the passes finish, so a test that inspects what
 * the startup passes did waits for them first.
 */
async function startAll(opts: OrchestratorsOptions): Promise<OrchestratorsHandle> {
  const handle = await startOrchestrators(opts)
  await handle.started
  return handle
}

async function startSet(set: { start(): Promise<OrchestratorsHandle> }): Promise<OrchestratorsHandle> {
  const handle = await set.start()
  await handle.started
  return handle
}

describe('startOrchestrators: several engines, one governor', () => {
  it('runs one engine per repository under one governor; each source carries its repository id; log lines name the repository', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const handle = await startAll({
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
    expect(lines.filter((l) => l.includes('[startup] toy: dispatch')).map((l) => l.split(' ')[0]).sort()).toEqual(['[alpha]', '[beta]']) // the passes run together, in either order

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
    const handle = await startAll({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alpha.dispatcher }), entry(copy, 'beta', { dispatcher: beta.dispatcher })],
      limits: { maxConcurrentDispatches: 1 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const [ea, eb] = handle.engines
    // Each engine ensured its own run's draft PR, although the slug and the tip
    // are the same. The startup passes run together, so in either order.
    expect(lines.filter((l) => l.endsWith('toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed')).sort()).toEqual([
      '[alpha] toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
      '[beta] toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
    ])
    // One holds the one slot — the startup passes run together, so either may
    // win it — and the other's `toy` is deferred, and only that one says so.
    const [winner, loser, openWinner, openLoser] = ea!.engine.inFlight() === 1 ? [ea!, eb!, alpha.open, beta.open] : [eb!, ea!, beta.open, alpha.open]
    expect([winner.engine.inFlight(), loser.engine.inFlight()]).toEqual([1, 0])
    expect(winner.engine.deferrals()).toEqual([])
    expect(loser.engine.deferrals().map((d) => ({ slug: d.slug, rule: d.rule, repository: d.repository }))).toEqual([{ slug: 'toy', rule: 'MC', repository: loser.repositoryId }])

    // The winner's job settling frees the slot; the other's own `toy` goes next, on its own job.
    openWinner()
    await vi.waitFor(() => expect(loser.engine.inFlight()).toBe(1), { timeout: 20_000, interval: 50 })
    expect(winner.engine.inFlight()).toBe(0)
    openLoser()
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
    const handle = await startAll({
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
    expect(lines.filter((l) => l.includes('reported its spend since startup'))).toEqual([])
  })

  it("a repository's own ceiling reaches the governor: alpha is held by it and beta is not", { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    // No registry in the toy host: every role is estimated at $5.
    const handle = await startAll({
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
    const handle = await startSet(set)
    expect(lines).toContain('[alpha] governor seed failed: index.lock held — engine marked failed; its health file says so from its next write (1 in a row); retried on the first tick')
    expect(lines).toContain('[alpha] it leaves the governor until it seeds, so no other repository waits for it')
    await handle.stop()
    // Both dispatched: beta was never held by alpha, and alpha seeded on its startup tick.
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(lines.filter((l) => l.includes('reported its spend since startup'))).toEqual([])
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
    const handle = await startSet(set)
    const [ea, eb] = handle.engines

    // beta dispatched and settled on its own.
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    // alpha: failed, in its own health file, with the governor's slot given back.
    expect(lines).toContain('[alpha] tick failed: disk on fire — engine marked failed; its health file says so from its next write (1 in a row)')
    // The stack is logged once, on the first fault of the streak (#502 review).
    expect(lines.filter((l) => l.startsWith('[alpha] stack: Error: disk on fire\n    at '))).toHaveLength(1)
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
    // Later faults of the same streak log their message and no stack.
    expect(lines.filter((l) => l.startsWith('[alpha] stack: '))).toHaveLength(1)
    // The heartbeat still retries: after the fault clears, alpha recovers and dispatches.
    broken = false
    await ea!.loop.trigger('heartbeat')
    expect(ticks).toBe(1)
    expect((await health(a.dir)).failed).toBeUndefined()
    expect(lines.some((l) => /^\[alpha\] recovered after \d fault\(s\) — engine no longer marked failed for its passes$/.test(l))).toBe(true)

    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(eb!.engine.faultState()).toBeNull()
    expect(unhandled).toEqual([])
  })

  it('a closing commit that throws is caught at the settlement: alpha is failed in its health FILE until the entry it left open is closed, its slot is released, beta is untouched', { timeout: 90_000 }, async () => {
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
    const handle = await startSet(set)
    expect(alpha.inFlight()).toBe(1)
    // From here every state write in alpha fails: the job's closing commit throws.
    alpha.source.writeState = (async () => {
      throw new Error('object store corrupt')
    }) as typeof alpha.source.writeState
    alphaHeld.open()
    await vi.waitFor(() => expect(alpha.inFlight()).toBe(0), { timeout: 20_000, interval: 50 })
    // Before #502 this rejection reached the process: Node ends it for one, and every engine with it.
    await new Promise((r) => setTimeout(r, 100))
    expect(unhandled.map((e) => (e as Error).message)).toEqual([])
    await vi.waitFor(
      () =>
        expect(lines).toContain(
          '[alpha] a dispatch settlement failed (toy: analyst): object store corrupt — engine marked failed; its health file says so from its next write until the ledger entry it left open is closed or aged out by the stale sweep',
        ),
      { timeout: 10_000, interval: 50 },
    )
    // The health FILE says so, and keeps saying so after passes that complete:
    // the entry is still open. (Before the review fix the completion pass
    // cleared it before the file was written, so the file never showed it.)
    await vi.waitFor(async () => expect((await health(a.dir)).failed).toMatchObject({ where: 'settlement', reason: 'object store corrupt', failures: 1 }), {
      timeout: 10_000,
      interval: 50,
    })
    await handle.engines[0]!.loop.trigger('refs')
    await handle.engines[0]!.loop.trigger('heartbeat')
    expect((await health(a.dir)).failed).toMatchObject({ where: 'settlement', reason: 'object store corrupt', failures: 1 })
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([null])
    // beta is untouched; once its own dispatch settles, nothing is reserved:
    // alpha's slot came back although its close threw.
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    await vi.waitFor(() => expect(handle.engines[1]!.engine.inFlight()).toBe(0), { timeout: 20_000, interval: 50 })
    expect((handle.governor as Governor).snapshot()).toMatchObject({ reservations: 0 })
    expect((await health(b.dir)).failed).toBeUndefined()
    await handle.stop()
    expect(unhandled).toEqual([])
  })

  it('a settlement fault stands until the stale sweep ages its entry out, then clears', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    const lines: string[] = []
    const engine = new Engine({
      repoDir: dir,
      identity: BOT,
      dispatcher: promptSpec(clock),
      registry: TEST_REGISTRY,
      governor: new Governor(),
      repository: 'local/toy',
      staleMs: 1500,
      log: (l) => lines.push(l),
    })
    // The first closing commit throws; everything else writes.
    const writeState = engine.source.writeState.bind(engine.source)
    let thrown = false
    engine.source.writeState = (async (...args: Parameters<typeof writeState>) => {
      if (!thrown && args[2].startsWith('state(toy): metered')) {
        thrown = true
        throw new Error('object store corrupt')
      }
      return writeState(...args)
    }) as typeof writeState
    expect((await engine.tick()).map((o) => o.launched)).toEqual([1])
    await engine.drain()
    expect(engine.faultState()).toMatchObject({ where: 'settlement', reason: 'object store corrupt', failures: 1 })
    // A pass that completes while the entry is open leaves the fault standing.
    await engine.tick()
    engine.clearFault()
    expect(engine.faultState()).toMatchObject({ where: 'settlement' })
    // Past staleMs the stale sweep ages the entry out; the report shows it closed.
    await new Promise((r) => setTimeout(r, 1600))
    await engine.tick()
    await engine.drain()
    expect(engine.faultState()).toBeNull()
    expect(lines).toContain('the entry a settlement fault left open (toy|analyst||) is closed or aged out — that fault no longer stands')
    expect((await ledgerOf(dir)).map((e) => [e.cost_usd, e.failed])).toEqual([[2, true]])
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
      onFault: (e, context, faultEntry) => faults.push(`${context}: ${(e as Error).message} [${faultEntry.key}]`),
    })
    const outcomes = await scheduler.tick()
    expect(outcomes.map((o) => o.kind)).toEqual(['dispatched'])
    await scheduler.drain()
    await new Promise((r) => setTimeout(r, 100))
    expect(unhandled.map((e) => (e as Error).message)).toEqual([])
    expect(faults).toEqual([`sweep ${sweepSlug('historian', new Date())}: fatal: bad object HEAD [sweep:${sweepSlug('historian', new Date())}]`])
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0 })
  })
})

describe('one code tree, one supersede, one shutdown', () => {
  async function twoHeld(code: string | null, onSupersede?: () => void) {
    const a = toyRepo()
    const b = toyRepo()
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const handle = await startAll({
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
  // Captured from main's own code at 84eccf0..da3a525 (the governor, before
  // #502): assembleOrchestrator, seedGovernor and runLoop run step for step on
  // this repository, with the same fake analyst. Timestamps and the engine id
  // are the only things normalised.
  const MAIN_RUN_SUBJECTS = [
    'gateline-orchestrator|state(toy): metered analyst $1.25',
    'toy-agent|toy: spec',
    'gateline-orchestrator|state(toy): dispatched analyst',
    'Toy Operator|toy: intent brief',
    'Toy Operator|Seed contracts',
  ]
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
  const MAIN_LINES = [
    'toy: draft PR ensure — skipped: local-only mode — draft-PR ensure suppressed',
    '[startup] toy: dispatch (D6) spec.md absent — dispatch analyst',
    'toy: no warm node_modules to seed from (looked in <tmp>/gateline-orchestrator/<hash>/run-toy, <repo>) — the implementer installs',
    'toy: metered analyst $1.25 ok',
  ]

  it("startOrchestrator's commits, state.yaml, health file and log lines are main's, but for the repository prefix", { timeout: 90_000 }, async () => {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'adapters/claude-code/manifest.json': manifestJson('true') }, 'adapter')
    const lines: string[] = []
    const handle = await startOrchestrator({ repoDir: dir, dispatcher: promptSpec(clock), heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null, log: (l) => lines.push(l) })
    await handle.started
    await handle.stop()

    expect(git(dir, ['log', '--format=%an|%s', 'run/toy']).split('\n')).toEqual(MAIN_RUN_SUBJECTS)
    expect(git(dir, ['log', '--format=%an|%s', 'main']).split('\n')).toEqual(['toy-agent|adapter', 'Toy Operator|Seed contracts'])
    const state = git(dir, ['show', 'run/toy:runs/toy/state.yaml'])
    expect(state.replace(/^(\s*- at: ).*$/m, '$1<at>').replace(/^(\s*engine: ).*$/m, '$1<engine>')).toEqual(MAIN_STATE)
    const written = await health(dir)
    expect(typeof written.at).toBe('string')
    expect({ ...written, at: '<at>' }).toEqual({ at: '<at>', pid: process.pid, heartbeatMs: 600000, inFlight: 1, pushRejections: {}, deferrals: [] })
    expect(Object.keys(written)).toEqual(['at', 'pid', 'heartbeatMs', 'inFlight', 'pushRejections', 'deferrals'])
    // The visible changes: every line names the repository, here by its
    // directory's name, and the startup seed says when it begins and ends.
    const name = dir.split('/').at(-1)!
    expect(lines.every((l) => l.startsWith(`[${name}] `))).toBe(true)
    const own = lines.map((l) => l.slice(name.length + 3))
    expect(own.slice(0, 2).map((l) => l.replace(/done in \d+ ms$|done in [\d.]+ s$/, 'done in <t>'))).toEqual([
      'startup seed: counting open dispatches and spend in the window',
      'startup seed: done in <t>',
    ])
    expect(
      own.slice(2).map((l) => l.replaceAll(dir, '<repo>').replace(/looked in \S*\/gateline-orchestrator\/[0-9a-f]{12}\//, 'looked in <tmp>/gateline-orchestrator/<hash>/')),
    ).toEqual(MAIN_LINES)
    expect(handle.engine.source.id).toBe(`local/${name}`)
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
      '1 dispatch(es) deferred — the governor grants nothing until ghost has counted its open dispatches and reported its spend since startup; re-derived once it has',
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
    expect(failing.reports.map((r) => r.sweepsRead)).toEqual([false, false]) // the seed reports too (#502), then the refresh

    const working = new ReportSpy()
    await make(dir, clock, working, {}).refreshGovernor()
    expect(working.reports.map((r) => r.sweepsRead)).toEqual([undefined, undefined])
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

describe('stop(): a pass in flight when it is called (review of #538, E8)', () => {
  it("launches nothing after the drain has returned, and never past the repository's own ceiling", { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const da = promptSpec(a.clock)
    const set = await assembleOrchestrators({
      // alpha's own ceiling is $4 and every role is estimated at $5: alpha may never dispatch.
      repositories: [entry(a.dir, 'alpha', { dispatcher: da, spendLimitUsd: 4 }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2, spendLimitUsd: 100 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: () => {},
    })
    const handle = await startSet(set)
    const alpha = handle.engines[0]!.engine
    expect(alpha.deferrals().map((d) => d.limit)).toEqual(['repository-spend'])
    // Hold alpha's next pass between its report and its reservation.
    const reached = deferred<void>()
    const gate = deferred<void>()
    const inner = alpha as unknown as { byWaitingSince: (refs: unknown[]) => Promise<unknown[]> }
    const original = inner.byWaitingSince.bind(alpha)
    let first = true
    inner.byWaitingSince = async (refs) => {
      if (first) {
        first = false
        reached.resolve()
        await gate.promise
      }
      return original(refs)
    }
    const pass = handle.engines[0]!.loop.trigger('refs')
    await reached.promise
    let stopped = false
    const stopping = handle.stop().then(() => {
      stopped = true
    })
    await new Promise((r) => setTimeout(r, 300))
    expect(stopped).toBe(false) // stop() waits for the pass that is running
    gate.resolve()
    await pass
    await stopping
    await new Promise((r) => setTimeout(r, 500))
    await alpha.drain()
    expect(da.calls).toHaveLength(0)
    expect(await ledgerOf(a.dir)).toEqual([])
    expect(handle.governor.registered('local/alpha')).toBe(false)
    expect(unhandled).toEqual([])
  })

  it('a pass that is gathering its report when its repository is unregistered ends quietly', { timeout: 60_000 }, async () => {
    const gov = new Governor({ maxConcurrentDispatches: 2 })
    gov.register('local/alpha', { displayName: 'alpha' })
    gov.seed('local/alpha', [])
    const gathering = deferred<void>()
    const released = deferred<SpendReport>()
    const report = gov.report('local/alpha', async () => {
      gathering.resolve()
      return released.promise
    })
    await gathering.promise
    gov.unregister('local/alpha')
    released.resolve({ closed: [{ key: 'toy|analyst||', at: new Date().toISOString(), costUsd: 3, kind: 'dispatch' }], open: [] })
    await expect(report).resolves.toBeUndefined()
    // The report belonged to nobody by the time it arrived: not counted, and the repository stays out.
    expect(gov.machineSpend()).toEqual({ closed: 0, open: 0 })
    expect(gov.registered('local/alpha')).toBe(false)
  })
})

describe('Governor: an unregistered repository is not resurrected (review of #538)', () => {
  it('reserve refuses it, naming the reason; report and seed are ignored; registering again brings it back', async () => {
    const lines: string[] = []
    const gov = new Governor({ maxConcurrentDispatches: 2, log: (l) => lines.push(l) })
    gov.register('local/alpha', { displayName: 'alpha', spendLimitUsd: 4 })
    gov.seed('local/alpha', [])
    gov.unregister('local/alpha')
    const refused = gov.reserve({ repository: 'local/alpha', intents: [{ key: 'toy|analyst||', estimateUsd: 5 }] })
    expect(refused.granted).toEqual([])
    expect(refused.refusal).toMatchObject({ limit: 'unregistered', repository: 'local/alpha', names: { 'local/alpha': 'alpha' } })
    expect(refusalReason(refused.refusal!, '1 dispatch(es)', 'the run re-derives')).toBe(
      '1 dispatch(es) not admitted — alpha has left the governor (its engine stopped); nothing is granted to it until it registers again',
    )
    expect(refusalRule(refused.refusal!)).toBe('MC')
    let gathered = false
    await gov.report('local/alpha', () => {
      gathered = true
      return { closed: [], open: [] }
    })
    expect(gathered).toBe(false)
    expect(lines).toEqual(['governor: ignoring a report for alpha, which has left the governor (its engine stopped)'])
    gov.seed('local/alpha', [])
    expect(gov.registered('local/alpha')).toBe(false)
    // Registered again explicitly, with its ceiling, it is an ordinary repository: seeded, then admitted within the ceiling.
    gov.register('local/alpha', { displayName: 'alpha', spendLimitUsd: 4 })
    gov.seed('local/alpha', [])
    expect(gov.reserve({ repository: 'local/alpha', intents: [{ key: 'toy|analyst||', estimateUsd: 5 }] }).refusal).toMatchObject({ limit: 'repository-spend' })
    expect(gov.reserve({ repository: 'local/alpha', intents: [{ key: 'toy|analyst||', estimateUsd: 3 }] }).granted).toHaveLength(1)
  })

  it('a repository that never registered is still made known and seeded by its first reservation (a scheduler with no engine)', () => {
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    expect(gov.reserve({ repository: 'local/lone', intents: [{ key: 'sweep:historian-2026-09-27', estimateUsd: 1, kind: 'sweep' }] }).granted).toHaveLength(1)
    expect(gov.registered('local/lone')).toBe(true)
  })
})

describe('the machine window at startup counts every repository (review of #538, E1)', () => {
  for (const order of ['alpha first', 'beta first'] as const) {
    it(`machine limit $6, beta spent $1.25 in the window, alpha asks $5: alpha waits (${order})`, { timeout: 90_000 }, async () => {
      const a = toyRepo()
      const b = toyRepo()
      // beta spends $1.25 in an earlier life of the process.
      const earlier = await startOrchestrator({ repoDir: b.dir, dispatcher: promptSpec(b.clock), heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null })
      await earlier.started
      await earlier.stop()
      expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
      const ea = entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) })
      const eb = entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })
      const set = await assembleOrchestrators({
        repositories: order === 'alpha first' ? [ea, eb] : [eb, ea],
        limits: { maxConcurrentDispatches: 2, spendLimitUsd: 6 },
        heartbeatSeconds: HEARTBEAT_SECONDS,
        codeRepo: null,
        log: () => {},
      })
      // beta's startup pass is held before its tick, so its tick's report cannot
      // tell the governor about the $1.25 in time: only the startup report can.
      const beta = set.engines.find((e) => e.repositoryId === 'local/beta')!
      const betaHeld = deferred<void>()
      beta.engine.syncFromRemote = async () => {
        await betaHeld.promise
      }
      const handle = await set.start()
      const alpha = handle.engines.find((e) => e.repositoryId === 'local/alpha')!
      await alpha.loop.started
      expect(alpha.engine.deferrals().map((d) => d.reason)).toEqual([
        'projected host spend $6.25 over the last 24 hours (ledger $1.25 in the window + $5.00 in flight and requested) exceeds --spend-limit-usd $6 — deferred, not paused: the window rolls and the run re-derives',
      ])
      betaHeld.resolve()
      await handle.started
      await handle.stop()
      expect(await ledgerOf(a.dir)).toEqual([])
    })
  }
})

describe("one repository's slow startup holds up no other (review of #538, E2)", () => {
  it("beta dispatches and the handle is returned although alpha's first pass never finishes", { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
    })
    const alpha = set.engines[0]!.engine
    const hang = deferred<void>()
    // A fetch against a remote that never answers: alpha's startup pass does not return.
    alpha.syncFromRemote = async () => {
      await hang.promise
    }
    const handle = await set.start()
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    expect(await ledgerOf(a.dir)).toEqual([])
    hang.resolve()
    await handle.started
    await handle.stop()
  })

  it("a startup seed that hangs is given up on after the timeout; the others start, and it seeds on a later pass", { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      startupTimeoutMs: 400,
      log: (l) => lines.push(l),
    })
    const alpha = set.engines[0]!.engine
    const listRuns = alpha.source.listRuns.bind(alpha.source)
    const hang = deferred<void>()
    let first = true
    alpha.source.listRuns = (async () => {
      if (first) {
        first = false
        await hang.promise
      }
      return listRuns()
    }) as typeof listRuns
    const handle = await set.start()
    expect(lines).toContain('[alpha] governor seed failed: the startup seed and report did not finish within 400 ms — engine marked failed; its health file says so from its next write (1 in a row); retried on the first tick')
    expect(lines).toContain('[alpha] it leaves the governor until it seeds, so no other repository waits for it')
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    // The hung read ends; alpha's seed completes, it rejoins the governor, and its startup pass dispatches.
    hang.resolve()
    await handle.started
    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
  })
})

describe('seed failures and re-registration (review of #538, mutations the suite missed)', () => {
  it('a failed-seed engine LAST in the list is unregistered, so the engine before it is not held back', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) }), entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    const alpha = set.engines[1]!.engine
    const listRuns = alpha.source.listRuns.bind(alpha.source)
    // Fails at startup and again on its own startup pass: it stays unseeded while beta's pass runs.
    let failures = 2
    alpha.source.listRuns = (async () => {
      if (failures-- > 0) throw new Error('index.lock held')
      return listRuns()
    }) as typeof listRuns
    const handle = await startSet(set)
    expect(handle.engines[0]!.engine.deferrals()).toEqual([])
    // beta dispatched on its startup pass; its job may still be closing.
    expect((await ledgerOf(b.dir)).length).toBe(1)
    await vi.waitFor(async () => expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    expect(lines.filter((l) => l.includes('reported its spend since startup'))).toEqual([])
    // alpha seeds on its next pass.
    await handle.engines[1]!.loop.trigger('heartbeat')
    await handle.stop()
    expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25])
  })

  it('an engine that re-registers after a failed seed keeps its own ceiling', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const set = await assembleOrchestrators({
      // No registry in the toy host: every role is estimated at $5, over alpha's $4 ceiling.
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock), spendLimitUsd: 4 }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2, spendLimitUsd: 100 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: () => {},
    })
    const alpha = set.engines[0]!.engine
    const listRuns = alpha.source.listRuns.bind(alpha.source)
    let failures = 1
    alpha.source.listRuns = (async () => {
      if (failures-- > 0) throw new Error('index.lock held')
      return listRuns()
    }) as typeof listRuns
    const handle = await startSet(set)
    expect(handle.governor.registered('local/alpha')).toBe(true) // re-registered by its startup pass
    expect(alpha.deferrals().map((d) => d.limit)).toEqual(['repository-spend'])
    await handle.stop()
    expect(await ledgerOf(a.dir)).toEqual([])
  })

  it('two loops that both see the fast-forward confirmed fire the supersede callback once', { timeout: 90_000 }, async () => {
    const code = codeRepo()
    const a = toyRepo()
    const b = toyRepo()
    let supersedes = 0
    const handle = await startAll({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: code.dir,
      log: () => {},
      // Counts, and does not stop: both loops keep running and keep seeing the confirmed state.
      onSupersede: () => {
        supersedes++
      },
    })
    const [ea, eb] = handle.engines
    code.commit('a framework fix lands')
    for (let round = 0; round < 3; round++) {
      await ea!.loop.trigger('heartbeat')
      await eb!.loop.trigger('heartbeat')
    }
    expect(supersedes).toBe(1)
    await handle.stop()
  })
})

describe('stop() says when an engine fails to drain (review of #538)', () => {
  it('logs the failure with the repository and still drains and unregisters the others', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const handle = await startAll({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: (l) => lines.push(l),
    })
    handle.engines[0]!.engine.drain = async () => {
      throw new Error('drain broke')
    }
    await handle.stop()
    expect(lines.filter((l) => l.startsWith('[alpha] stopping failed: Error: drain broke\n    at '))).toHaveLength(1)
    expect(handle.governor.registered('local/beta')).toBe(false)
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
  })
})

describe('repository ids the server would refuse are refused here too (review of #538)', () => {
  it('startOrchestrator falls back to local/<directory> when the origin gives no usable id', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    git(a.dir, ['remote', 'add', 'origin', 'https://example.test/acme/-/x.git'])
    expect(await defaultRepositoryId(a.dir)).toBe(`local/${a.dir.split('/').at(-1)}`)
  })

  it('startOrchestrator refuses a directory whose name cannot make a local id, with core\'s words', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const spaced = join(mkdtempSync(join(tmpdir(), 'gateline-sp-')), 'my repo')
    cleanups.push(spaced)
    cpSync(a.dir, spaced, { recursive: true })
    await expect(startOrchestrator({ repoDir: spaced, dispatcher: promptSpec(a.clock), codeRepo: null })).rejects.toThrow(
      `repository at ${spaced} has no origin, so it is named local/<name> from its directory name, and "my repo" may contain only letters, digits, ".", "_" and "-"; give it a \`name\` (or an \`id:\`) in the config`,
    )
  })

  it('startOrchestrators refuses an id core would refuse', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    await expect(startOrchestrators({ repositories: [{ repoDir: a.dir, repositoryId: 'my repo' }], codeRepo: null })).rejects.toThrow(
      `repository at ${a.dir}: its id "my repo" contains whitespace`,
    )
    await expect(startOrchestrators({ repositories: [{ repoDir: a.dir, repositoryId: 'github.com/acme/-/x' }], codeRepo: null })).rejects.toThrow(
      `repository at ${a.dir}: its id "github.com/acme/-/x" has a segment that is "-", which the URL shape reserves`,
    )
  })

  it('refuses two clones of one origin given different ids, naming both', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    git(a.dir, ['remote', 'add', 'origin', 'https://example.test/acme/billing.git'])
    git(b.dir, ['remote', 'add', 'origin', 'git@example.test:Acme/Billing.git'])
    await expect(startOrchestrators({ repositories: [entry(a.dir, 'alpha'), entry(b.dir, 'beta')], codeRepo: null })).rejects.toThrow(
      new DuplicateRepositoryError(
        `alpha (local/alpha at ${a.dir}) and beta (local/beta at ${b.dir}) are clones of one origin (example.test/Acme/Billing), whose runs are one set of branches there — one engine per repository`,
      ),
    )
  })
})

describe('the engine name stands in for the hostname (review of #538)', () => {
  /** Give the toy run an open analyst entry opened `minutesAgo`, naming `engine`. */
  async function openEntry(dir: string, minutesAgo: number, engine: string): Promise<void> {
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString()
    const entryDoc = { at, role: 'analyst', task: null, round: null, adapter: 'fake', model: null, engine, tokens_in: null, tokens_out: null, cost_usd: null }
    expect((await human.writeState(ref, (doc) => doc.setIn(['budget', 'ledger', 0], entryDoc), 'state(toy): dispatched analyst')).ok).toBe(true)
  }
  const deadPid = () => Number(deadEngineId().split(':').at(-1))

  it('writes the name, not the hostname, on ledger entries and sweep markers', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'orchestrator.yaml': 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 50\n' }, 'schedules')
    const { engine, scheduler } = await assembleOrchestrator({ repoDir: dir, dispatcher: promptSpec(clock), engineName: 'build-01', repository: 'local/toy' })
    expect(engine.engineId).toMatch(new RegExp(`^build-01:${process.pid}(#\\d+)?$`))
    await engine.seedGovernor()
    await engine.tick()
    await scheduler.tick()
    await engine.drain()
    await scheduler.drain()
    expect((await ledgerOf(dir)).map((e) => e.engine)).toEqual([engine.engineId])
    const slug = sweepSlug('historian', new Date())
    expect(git(dir, ['show', `run/${slug}:runs/${slug}/sweep.yaml`]).split('\n')).toContain(`engine: "${engine.engineId}"`)
    expect(git(dir, ['log', '-p', '--all']).includes(hostname())).toBe(false)
  })

  it.each([
    ['my host', 'engine name "my host" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)'],
    ['a:b', 'engine name "a:b" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)'],
    ['a#1', 'engine name "a#1" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)'],
    ['', 'an engine name cannot be empty'],
  ])('refuses the name %j', (name, message) => {
    expect(() => new Engine({ repoDir: tmpdir(), identity: BOT, dispatcher: new FakeDispatcher(() => ({})), registry: null, governor: new Governor(), engineName: name })).toThrow(message)
  })

  it('a restart under the same name recognises its own dead entries; an entry under the OS hostname is treated as another host', { timeout: 60_000 }, async () => {
    const own = toyRepo()
    await openEntry(own.dir, 10, `build-01:${deadPid()}`)
    const lines: string[] = []
    const mine = new Engine({ repoDir: own.dir, identity: BOT, dispatcher: promptSpec(own.clock), registry: TEST_REGISTRY, governor: new Governor(), engineName: 'build-01', log: (l) => lines.push(l) })
    await mine.tick()
    await mine.drain()
    expect(lines.some((l) => l.includes(`aging stale dispatch analyst — opened by build-01:`) && l.endsWith('whose process is gone from this machine'))).toBe(true)

    const legacy = toyRepo()
    const osHostEntry = `${hostname()}:${deadPid()}`
    await openEntry(legacy.dir, 10, osHostEntry)
    const legacyLines: string[] = []
    const named = new Engine({ repoDir: legacy.dir, identity: BOT, dispatcher: promptSpec(legacy.clock), registry: TEST_REGISTRY, governor: new Governor(), engineName: 'build-01', log: (l) => legacyLines.push(l) })
    await named.tick()
    expect(legacyLines).toContain(`toy: leaving analyst open — opened by ${osHostEntry}, which may still be running it; it ages only after the role timeout (35 min)`)
    expect((await ledgerOf(legacy.dir)).map((e) => e.cost_usd)).toEqual([null])
  })

  it('the standalone binary takes --engine-name', { timeout: 60_000 }, () => {
    const main = join(import.meta.dirname, '..', 'src', 'main.ts')
    const help = execFileSync(process.execPath, [main, '--help'], { encoding: 'utf8' })
    expect(help).toContain('--engine-name <name>')
  })
})

describe('shutdown and per-repository configuration (review of #538, E4 and E5)', () => {
  it('a slot freed during the drain launches nothing in the repository that was waiting for it', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const alpha = heldSpec(a.clock)
    const beta = heldSpec(b.clock)
    const handle = await startAll({
      repositories: [entry(a.dir, 'alpha', { dispatcher: alpha.dispatcher }), entry(b.dir, 'beta', { dispatcher: beta.dispatcher })],
      limits: { maxConcurrentDispatches: 1 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: () => {},
    })
    // One of them holds the one slot; the other waits for it.
    const alphaHolds = handle.engines[0]!.engine.inFlight() === 1
    const holder = alphaHolds ? alpha : beta
    const waiting = alphaHolds ? { dir: b.dir, d: beta } : { dir: a.dir, d: alpha }
    expect(waiting.d.dispatcher.calls).toHaveLength(0)
    const stopping = handle.stop()
    holder.open()
    await stopping
    await new Promise((r) => setTimeout(r, 1000))
    expect(waiting.d.dispatcher.calls).toHaveLength(0)
    expect(await ledgerOf(waiting.dir)).toEqual([])
    expect(unhandled).toEqual([])
  })

  it("each engine reads its own repository's registry and adapter manifest", { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const manifest = (bin: string) =>
      JSON.stringify({
        adapter: 'claude-code',
        headless: { command: [bin, '{prompt}'], dispatch_prompt: '{body}', usage_report: { format: 'static-estimate' } },
        model_map: {},
        model_overrides: {},
        model_vendors: {},
      })
    agentCommit(a.dir, a.clock, { 'adapters/claude-code/manifest.json': manifest('alpha-harness'), 'registry/models.yaml': 'dispatch_estimates_usd:\n  analyst: 2\n' }, 'alpha config')
    agentCommit(b.dir, b.clock, { 'adapters/claude-code/manifest.json': manifest('beta-harness'), 'registry/models.yaml': 'dispatch_estimates_usd:\n  analyst: 7\n' }, 'beta config')
    // A $1 machine limit: both defer, each naming its own estimate, and nothing is launched.
    const handle = await startAll({
      repositories: [entry(a.dir, 'alpha'), entry(b.dir, 'beta')],
      limits: { maxConcurrentDispatches: 2, spendLimitUsd: 1 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: () => {},
    })
    expect(handle.engines.map((e) => e.engine.deferrals().map((d) => d.reason))).toEqual([
      [
        'projected host spend $2.00 over the last 24 hours (ledger $0.00 in the window + $2.00 in flight and requested) exceeds --spend-limit-usd $1 — deferred, not paused: the window rolls and the run re-derives',
      ],
      [
        'projected host spend $7.00 over the last 24 hours (ledger $0.00 in the window + $7.00 in flight and requested) exceeds --spend-limit-usd $1 — deferred, not paused: the window rolls and the run re-derives',
      ],
    ])
    await handle.stop()
    expect((await ledgerOf(a.dir)).length + (await ledgerOf(b.dir)).length).toBe(0)
  })
})

describe('stop() waits for the running pass only up to a bound (second review of #538, X1)', () => {
  it('two engines: alpha’s pass never returns; stop() resolves within the bound, says so, and beta still drains', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      stopWaitMs: 1500,
      log: (l) => lines.push(l),
    })
    const hang = deferred<void>()
    set.engines[0]!.engine.syncFromRemote = async () => {
      await hang.promise
    }
    const handle = await set.start()
    await handle.engines[1]!.loop.started
    const began = Date.now()
    await handle.stop()
    const took = Date.now() - began
    expect(took).toBeGreaterThanOrEqual(1400)
    expect(took).toBeLessThan(10_000)
    expect(lines).toContain('[alpha] still waiting for the running pass before draining')
    expect(lines).toContain(
      '[alpha] the running pass did not finish within 1.5 s — stopping without it: it can admit nothing more, and a role it had already committed and not yet launched may start after this drain, close on its own, or be aged out by the stale sweep after a restart',
    )
    expect(lines.filter((l) => l.startsWith('[beta] ') && l.includes('running pass'))).toEqual([])
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    expect(handle.governor.registered('local/beta')).toBe(false)
    hang.resolve()
  })

  it('a list of one: stop() resolves within the bound although the pass never returns', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) })],
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      stopWaitMs: 800,
      log: (l) => lines.push(l),
    })
    const hang = deferred<void>()
    set.engines[0]!.engine.syncFromRemote = async () => {
      await hang.promise
    }
    const handle = await set.start()
    const began = Date.now()
    await handle.stop()
    expect(Date.now() - began).toBeLessThan(10_000)
    expect(lines.filter((l) => l.startsWith('[alpha] the running pass did not finish within 800 ms'))).toHaveLength(1)
    hang.resolve()
  })

  it('a supersede with one engine’s pass hung fires once, and the drain it starts ends within the bound', { timeout: 90_000 }, async () => {
    const code = codeRepo()
    const a = toyRepo()
    const b = toyRepo()
    let supersedes = 0
    let stopped: Promise<void> | null = null
    let handle: OrchestratorsHandle | null = null
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: code.dir,
      stopWaitMs: 1000,
      log: () => {},
      onSupersede: () => {
        supersedes++
        stopped = handle!.stop()
      },
    })
    const hang = deferred<void>()
    set.engines[0]!.engine.syncFromRemote = async () => {
      await hang.promise
    }
    handle = await set.start()
    await handle.engines[1]!.loop.started
    code.commit('a framework fix lands')
    await handle.engines[1]!.loop.trigger('heartbeat')
    await handle.engines[1]!.loop.trigger('heartbeat')
    expect(supersedes).toBe(1)
    const began = Date.now()
    await stopped!
    expect(Date.now() - began).toBeLessThan(10_000)
    expect(supersedes).toBe(1)
    hang.resolve()
  })

  it('a tick awaiting a startup seed that hangs past the bound admits nothing when it finally resumes', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const da = promptSpec(a.clock)
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: da })],
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      startupTimeoutMs: 300,
      stopWaitMs: 300,
      log: () => {},
    })
    const alpha = set.engines[0]!.engine
    const listRuns = alpha.source.listRuns.bind(alpha.source)
    const hang = deferred<void>()
    let first = true
    alpha.source.listRuns = (async () => {
      if (first) {
        first = false
        await hang.promise
      }
      return listRuns()
    }) as typeof listRuns
    const handle = await set.start() // the seed timed out; the startup pass now awaits the same seed
    await handle.stop() // resolves at the bound, with that pass still waiting
    expect(alpha.isStopping()).toBe(true)
    hang.resolve() // the seed finishes, and the pass resumes after the drain
    await new Promise((r) => setTimeout(r, 1500))
    expect(da.calls).toHaveLength(0)
    expect(await ledgerOf(a.dir)).toEqual([])
    expect(handle.governor.registered('local/alpha')).toBe(false)
  })
})

describe('the stop flags, pinned (second review of #538, m6 m7 m8)', () => {
  it('an engine stopped between its reservation and its intent commit commits and launches nothing', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const da = promptSpec(a.clock)
    const set = await assembleOrchestrators({ repositories: [entry(a.dir, 'alpha', { dispatcher: da })], heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null, log: () => {} })
    const alpha = set.engines[0]!.engine
    // `ensurePr` runs after the reservation and before the intent commit.
    const reached = deferred<void>()
    const gate = deferred<void>()
    const inner = alpha as unknown as { ensurePr: (...args: unknown[]) => Promise<void> }
    const ensurePr = inner.ensurePr.bind(alpha)
    inner.ensurePr = async (...args) => {
      reached.resolve()
      await gate.promise
      return ensurePr(...args)
    }
    const handle = await set.start()
    await reached.promise
    expect((handle.governor as Governor).snapshot().reservations).toBe(1) // reserved, not yet committed
    const stopping = handle.stop()
    gate.resolve()
    await stopping
    await new Promise((r) => setTimeout(r, 500))
    expect(da.calls).toHaveLength(0)
    expect(await ledgerOf(a.dir)).toEqual([])
  })

  it('an engine stopped before its reservation reserves nothing', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const da = promptSpec(a.clock)
    const reserves: string[] = []
    class SpyGovernor extends Governor {
      override reserve(req: Parameters<Governor['reserve']>[0]) {
        reserves.push(req.repository)
        return super.reserve(req)
      }
    }
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: da })],
      governor: new SpyGovernor({ maxConcurrentDispatches: 2 }),
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      log: () => {},
    })
    const alpha = set.engines[0]!.engine
    const reached = deferred<void>()
    const gate = deferred<void>()
    const inner = alpha as unknown as { byWaitingSince: (refs: unknown[]) => Promise<unknown[]> }
    const byWaitingSince = inner.byWaitingSince.bind(alpha)
    inner.byWaitingSince = async (refs) => {
      reached.resolve()
      await gate.promise
      return byWaitingSince(refs)
    }
    const handle = await set.start()
    await reached.promise
    const stopping = handle.stop()
    gate.resolve()
    await stopping
    expect(reserves).toEqual([])
    expect(da.calls).toHaveLength(0)
  })

  const SCHEDULE = 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 50\n'
  function sweepSetup() {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'orchestrator.yaml': SCHEDULE }, 'schedules')
    const reserves: string[] = []
    class SpyGovernor extends Governor {
      override reserve(req: Parameters<Governor['reserve']>[0]) {
        reserves.push(req.repository)
        return super.reserve(req)
      }
    }
    const sweeper = new FakeDispatcher(() => ({}))
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher: sweeper, registry: TEST_REGISTRY, governor: new SpyGovernor(), repository: 'local/toy' })
    return { dir, reserves, sweeper, scheduler, git: (scheduler as unknown as { git: Record<string, (...a: unknown[]) => Promise<unknown>> }).git }
  }

  it('a scheduler stopped before a sweep’s reservation reserves nothing', { timeout: 60_000 }, async () => {
    const { dir, reserves, sweeper, scheduler, git: sg } = sweepSetup()
    const reached = deferred<void>()
    const gate = deferred<void>()
    const lsTreeDirs = sg.lsTreeDirs!.bind(sg)
    sg.lsTreeDirs = async (...args) => {
      reached.resolve()
      await gate.promise
      return lsTreeDirs(...args)
    }
    const ticking = scheduler.tick()
    await reached.promise
    scheduler.beginStop()
    gate.resolve()
    expect((await ticking).map((o) => [o.kind, o.detail])).toEqual([['rest', 'scheduler stopping — nothing reserved']])
    expect(reserves).toEqual([])
    expect(sweeper.calls).toHaveLength(0)
    expect(git(dir, ['branch', '--list', 'run/historian-*'])).toBe('')
  })

  it('a scheduler stopped between a sweep’s reservation and its ref update commits and launches nothing', { timeout: 60_000 }, async () => {
    const { dir, reserves, sweeper, scheduler, git: sg } = sweepSetup()
    const reached = deferred<void>()
    const gate = deferred<void>()
    const hashObject = sg.hashObject!.bind(sg)
    sg.hashObject = async (...args) => {
      reached.resolve()
      await gate.promise
      return hashObject(...args)
    }
    const ticking = scheduler.tick()
    await reached.promise
    scheduler.beginStop()
    gate.resolve()
    expect((await ticking).map((o) => [o.kind, o.detail])).toEqual([['rest', 'scheduler stopping — no sweep committed, nothing launched']])
    expect(reserves).toEqual(['local/toy'])
    expect((scheduler.governor as Governor).snapshot().occupied).toBe(0) // the reservation was released
    expect(sweeper.calls).toHaveLength(0)
    expect(git(dir, ['branch', '--list', 'run/historian-*'])).toBe('')
  })
})

describe('the one known under-count of the machine window, said out loud (second review of #538, X2)', () => {
  it('beta’s startup seed times out: alpha is granted without beta’s $1.25, and the log and every health file say so', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const earlier = await startOrchestrator({ repoDir: b.dir, dispatcher: promptSpec(b.clock), heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null })
    await earlier.started
    await earlier.stop()
    expect((await ledgerOf(b.dir)).map((e) => e.cost_usd)).toEqual([1.25])
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      limits: { maxConcurrentDispatches: 2, spendLimitUsd: 6 },
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      startupTimeoutMs: 400,
      log: (l) => lines.push(l),
    })
    const beta = set.engines[1]!.engine
    const listRuns = beta.source.listRuns.bind(beta.source)
    const hang = deferred<void>()
    let first = true
    beta.source.listRuns = (async () => {
      if (first) {
        first = false
        await hang.promise
      }
      return listRuns()
    }) as typeof listRuns
    const handle = await set.start()
    expect(lines).toContain(
      '[beta] WARNING: its spend in the last 24 hours is NOT counted against the machine\'s spend limit until it seeds — the other repositories may overspend the window by up to what it spent in it',
    )
    await handle.engines[0]!.loop.started
    // Deliberate: $5 asked against $6 with beta's $1.25 unknown — granted (with it, $6.25, deferred).
    expect(handle.engines[0]!.engine.deferrals()).toEqual([])
    expect((await health(a.dir)).uncounted).toEqual(['local/beta'])
    expect(handle.governor.uncounted()).toEqual(['local/beta'])
    await vi.waitFor(async () => expect((await ledgerOf(a.dir)).map((e) => e.cost_usd)).toEqual([1.25]), { timeout: 20_000, interval: 50 })
    // beta seeds once its read ends, and is counted again.
    hang.resolve()
    await handle.started
    expect(handle.governor.uncounted()).toEqual([])
    await handle.stop()
  })
})

describe('duplicate origins on the filesystem, and governor keys without case (second review of #538)', () => {
  it('refuses two clones of one origin that is a directory, however each names it', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const bare = join(mkdtempSync(join(tmpdir(), 'gateline-origin-')), 'origin.git')
    cleanups.push(bare)
    git(a.dir, ['clone', '-q', '--bare', a.dir, bare])
    git(a.dir, ['remote', 'add', 'origin', bare])
    git(b.dir, ['remote', 'add', 'origin', `file://${bare}`])
    await expect(startOrchestrators({ repositories: [entry(a.dir, 'alpha'), entry(b.dir, 'beta')], codeRepo: null })).rejects.toThrow(
      new DuplicateRepositoryError(
        `alpha (local/alpha at ${a.dir}) and beta (local/beta at ${b.dir}) are clones of one origin (${readRealpath(bare)}), whose runs are one set of branches there — one engine per repository`,
      ),
    )
  })

  it('treats two spellings of one id as one repository, keeping the first spelling for what it says', () => {
    const gov = new Governor({ maxConcurrentDispatches: 2 })
    gov.register('github.com/Acme/Billing', { spendLimitUsd: 4 })
    gov.seed('github.com/acme/billing', [])
    expect(gov.unseeded()).toEqual([])
    expect(gov.reserve({ repository: 'GITHUB.COM/acme/billing', intents: [{ key: 'toy|analyst||', estimateUsd: 5 }] }).refusal).toMatchObject({
      limit: 'repository-spend',
      repository: 'GITHUB.COM/acme/billing',
    })
    gov.unregister('github.com/Acme/Billing')
    const refused = gov.reserve({ repository: 'github.com/acme/billing', intents: [{ key: 'toy|analyst||', estimateUsd: 1 }] })
    expect(refused.granted).toEqual([])
    expect(refused.refusal).toMatchObject({ limit: 'unregistered' })
    expect(refusalReason(refused.refusal!, '1 dispatch(es)', 'the run re-derives')).toBe(
      '1 dispatch(es) not admitted — github.com/acme/billing has left the governor (its engine stopped); nothing is granted to it until it registers again',
    )
    expect(gov.registered('GitHub.com/ACME/billing')).toBe(false)
  })
})

describe('the startup wait is said out loud (second review of #538)', () => {
  it('logs each seed beginning and ending, and once which repositories the start is still waiting for', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) }), entry(b.dir, 'beta', { dispatcher: promptSpec(b.clock) })],
      heartbeatSeconds: HEARTBEAT_SECONDS,
      codeRepo: null,
      startupNoticeMs: 300,
      startupTimeoutMs: 1500,
      log: (l) => lines.push(l),
    })
    const beta = set.engines[1]!.engine
    const listRuns = beta.source.listRuns.bind(beta.source)
    const hang = deferred<void>()
    let first = true
    beta.source.listRuns = (async () => {
      if (first) {
        first = false
        await hang.promise
      }
      return listRuns()
    }) as typeof listRuns
    const handle = await set.start()
    expect(lines).toContain('[alpha] startup seed: counting open dispatches and spend in the window')
    expect(lines).toContain('[beta] startup seed: counting open dispatches and spend in the window')
    expect(lines.filter((l) => /^\[alpha\] startup seed: done in (\d+ ms|[\d.]+ s)$/.test(l))).toHaveLength(1)
    // Exactly one notice, and it names beta, whose seed is held. alpha's seed is
    // not held, but whether it finishes inside the 300 ms before the notice is
    // up to the machine's load, so the notice may name it too (review of #550).
    const notices = lines.filter((l) => l.startsWith('startup is waiting for the seed of: '))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatch(/^startup is waiting for the seed of: (alpha, )?beta \(each is given up on after 1\.5 s\)$/)
    expect(lines).toContain('[beta] governor seed failed: the startup seed and report did not finish within 1.5 s — engine marked failed; its health file says so from its next write (1 in a row); retried on the first tick')
    hang.resolve()
    await handle.started
    await handle.stop()
  })

  it('--engine-name’s help says the name must be unique', { timeout: 60_000 }, () => {
    const main = join(import.meta.dirname, '..', 'src', 'main.ts')
    const help = execFileSync(process.execPath, [main, '--help'], { encoding: 'utf8' }).replace(/\s+/g, ' ')
    expect(help).toContain('It must be unique among the machines that run an engine against the same repository')
  })
})

describe('the health file is never read half written (found by the 50-run loop)', () => {
  it('a reader polling while passes rewrite it always reads whole JSON, and no temporary file is left behind', { timeout: 90_000 }, async () => {
    const a = toyRepo()
    const handle = await startAll({ repositories: [entry(a.dir, 'alpha', { dispatcher: promptSpec(a.clock) })], heartbeatSeconds: HEARTBEAT_SECONDS, codeRepo: null, log: () => {} })
    const path = await engineHealthPath(a.dir)
    const torn: string[] = []
    let reads = 0
    let polling = true
    const poll = (async () => {
      while (polling) {
        const text = await readFile(path, 'utf8').catch(() => null)
        if (text !== null) {
          reads++
          try {
            JSON.parse(text)
          } catch {
            torn.push(text)
          }
        }
        await new Promise((r) => setImmediate(r))
      }
    })()
    for (let i = 0; i < 60; i++) await handle.engines[0]!.loop.trigger('refs')
    polling = false
    await poll
    await handle.stop()
    expect(reads).toBeGreaterThan(60)
    expect(torn).toEqual([])
    expect(readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})
