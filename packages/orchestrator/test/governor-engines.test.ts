// The governor under real engines (#501): toy repositories, a fake
// dispatcher, and — where the design is about several engines — two engines
// sharing one governor. No live dispatch anywhere.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Engine, type EngineConfig } from '../src/engine.ts'
import { Governor, type ReservationRequest, type ReserveResult } from '../src/governor.ts'
import { parseLedger } from '../src/observe.ts'
import { Scheduler, sweepSlug } from '../src/schedule.ts'
import { runLoop } from '../src/triggers.ts'
import { agentCommit, type Clock, deadEngineId, deferred, FakeDispatcher, humanDecide, makeToyRepo, reconcile, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }
const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (dir: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG, ...env } }).trim()

function toyRepo(opts: { budget?: number } = {}) {
  const made = makeToyRepo(opts)
  cleanups.push(made.dir)
  return made
}

/** A second run cloned from the toy run's record, its intent brief committed at `date` when given. */
function addRun(dir: string, slug: string, date?: string): void {
  const state = git(dir, ['show', 'run/toy:runs/toy/state.yaml'])
  const brief = git(dir, ['show', 'run/toy:runs/toy/intent-brief.md'])
  git(dir, ['checkout', '-q', '-b', `run/${slug}`, 'main'])
  mkdirSync(join(dir, 'runs', slug), { recursive: true })
  writeFileSync(join(dir, 'runs', slug, 'state.yaml'), `${state.replace(/\btoy\b/g, slug)}\n`)
  writeFileSync(join(dir, 'runs', slug, 'intent-brief.md'), `${brief}\n`)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', `${slug}: intent brief`], date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {})
  git(dir, ['checkout', '-q', 'main'])
}

/** Move a branch by one empty commit, without a checkout — a human writing while the engine decides. */
function bump(dir: string, branch: string): void {
  const tree = git(dir, ['rev-parse', `${branch}^{tree}`])
  const commit = git(dir, ['commit-tree', tree, '-p', branch, '-m', 'human: edit while the engine decides'], {
    GIT_AUTHOR_NAME: 'Human',
    GIT_AUTHOR_EMAIL: 'h@example.test',
    GIT_COMMITTER_NAME: 'Human',
    GIT_COMMITTER_EMAIL: 'h@example.test',
  })
  git(dir, ['update-ref', `refs/heads/${branch}`, commit])
}

/** An analyst that writes its spec once `open` is called — so its job stays in flight until then. */
function heldSpec(clock: Clock) {
  const gate = deferred<void>()
  const dispatcher = new FakeDispatcher(async (req) => {
    await gate.promise
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })
  return { dispatcher, open: () => gate.resolve() }
}

/** An analyst that writes its spec at once. */
const promptSpec = (clock: Clock) =>
  new FakeDispatcher((req) => {
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })

function makeEngine(dir: string, dispatcher: FakeDispatcher, over: Partial<EngineConfig> = {}): Engine {
  return new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, ...over })
}

const launched = (outcomes: { launched: number }[]) => outcomes.reduce((n, o) => n + o.launched, 0)

/** A governor that records every grant it makes, so a test can see that a release path had something to release. */
class CountingGovernor extends Governor {
  grants = 0
  onReserve: ((req: ReservationRequest) => void) | null = null
  override reserve(req: ReservationRequest): ReserveResult {
    this.onReserve?.(req)
    const res = super.reserve(req)
    this.grants += res.granted.length
    return res
  }
}

describe('one engine: every release path returns the governor to where it was', () => {
  it('a lost compare-and-swap on the intent commit releases the slot', async () => {
    const { dir, clock } = toyRepo()
    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    let once = true
    // Between the grant and the intent commit, a human moves the branch.
    gov.onReserve = () => {
      if (once) bump(dir, 'run/toy')
      once = false
    }
    const dispatcher = promptSpec(clock)
    const engine = makeEngine(dir, dispatcher, { governor: gov })

    const first = await engine.tick()
    expect(gov.grants).toBe(1)
    expect(first.find((o) => o.slug === 'toy')!.detail).toContain('write refused (ref-moved)')
    expect(launched(first)).toBe(0)
    expect(gov.snapshot().occupied).toBe(0)

    // The slot really is free: the re-derived dispatch goes out under a cap of 1.
    const second = await engine.tick()
    expect(launched(second)).toBe(1)
    await engine.drain()
    expect(gov.snapshot().occupied).toBe(0)
  })

  it('a rejected intent push releases the slot', async () => {
    const { dir, clock } = toyRepo()
    const bare = `${dir}-origin.git`
    cleanups.push(bare)
    execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
    git(dir, ['remote', 'add', 'origin', bare])
    // Another writer moves origin's run branch past the engine's local tip.
    const writer = `${bare}-writer`
    cleanups.push(writer)
    execFileSync('git', ['clone', '--quiet', bare, writer])
    git(writer, ['checkout', '-q', 'run/toy'])
    const path = join(writer, 'runs', 'toy', 'state.yaml')
    writeFileSync(path, readFileSync(path, 'utf8').replace(/cost_limit_usd: \d+/, 'cost_limit_usd: 60'))
    git(writer, ['-c', 'user.name=Human', '-c', 'user.email=h@example.test', 'commit', '-aqm', 'state(toy): edited by Human'])
    git(writer, ['push', '-q', 'origin', 'run/toy'])

    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    const dispatcher = promptSpec(clock)
    const engine = makeEngine(dir, dispatcher, { governor: gov, push: true })
    const first = await engine.tick()
    expect(gov.grants).toBe(1)
    expect(first.find((o) => o.slug === 'toy')!.detail).toContain('nothing launched')
    expect(dispatcher.calls).toHaveLength(0)
    expect(gov.snapshot().occupied).toBe(0)

    const second = await engine.tick()
    expect(launched(second)).toBe(1)
    await engine.drain()
    expect(gov.snapshot().occupied).toBe(0)
  })

  it('a later guard (RB, the missing per-run cap) releases the slot the governor granted', async () => {
    const { dir, clock } = toyRepo()
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    expect((await human.writeState(ref, (doc) => doc.setIn(['budget', 'cost_limit_usd'], null), 'state(toy): drop cap')).ok).toBe(true)
    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    const engine = makeEngine(dir, promptSpec(clock), { governor: gov, requireBudget: true })

    const outcomes = await engine.tick()
    expect(outcomes.find((o) => o.slug === 'toy')!.action).toMatchObject({ kind: 'escalate', rule: 'RB' })
    expect(gov.grants).toBe(1)
    expect(gov.snapshot().occupied).toBe(0)
  })

  it('an exception between the grant and the launch releases the slot, and the error still surfaces', async () => {
    const { dir, clock } = toyRepo()
    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    const engine = makeEngine(dir, promptSpec(clock), { governor: gov })
    const writeState = engine.source.writeState.bind(engine.source)
    let thrown = false
    engine.source.writeState = (async (...args: Parameters<typeof writeState>) => {
      if (!thrown) {
        thrown = true
        throw new Error('disk on fire')
      }
      return writeState(...args)
    }) as typeof writeState

    await expect(engine.tick()).rejects.toThrow('disk on fire')
    expect(gov.grants).toBe(1)
    expect(gov.snapshot().occupied).toBe(0)
    expect(launched(await engine.tick())).toBe(1)
    await engine.drain()
  })

  it.each([
    ['a settled dispatch', () => ({})],
    ['a failed dispatch', () => ({ ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'harness exploded' })],
    ['a dispatcher that throws', () => Promise.reject(new Error('spawn failed'))],
  ])('%s releases its slot on settlement', async (_name, outcome) => {
    const { dir } = toyRepo()
    const gov = new CountingGovernor({ maxConcurrentDispatches: 1 })
    const engine = makeEngine(dir, new FakeDispatcher(outcome as () => object), { governor: gov })
    const outcomes = await engine.tick()
    expect(launched(outcomes)).toBe(1)
    expect(gov.snapshot()).toMatchObject({ occupied: 1, uncommitted: 0 }) // committed, running
    await engine.drain()
    expect(gov.snapshot().occupied).toBe(0)
  })

  it('many interleaved ticks, lost races and outcomes leave nothing reserved', { timeout: 120_000 }, async () => {
    const { dir, clock } = toyRepo()
    addRun(dir, 'toy2')
    addRun(dir, 'toy3')
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const gov = new CountingGovernor({ maxConcurrentDispatches: 2 })
    gov.onReserve = (req) => {
      // One grant in five loses its compare-and-swap to a human edit.
      if (rand() < 0.2) bump(dir, `run/${req.intents[0]!.key.split('|')[0]}`)
    }
    const dispatcher = new FakeDispatcher((req) => {
      const roll = rand()
      if (roll < 0.3) return { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'flaky' }
      if (roll < 0.4) throw new Error('spawn failed')
      agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
      return {}
    })
    const engine = makeEngine(dir, dispatcher, { governor: gov })
    for (let i = 0; i < 12; i++) {
      await engine.tick()
      expect(gov.snapshot().occupied).toBeLessThanOrEqual(2)
      if (rand() < 0.5) await engine.drain()
    }
    await engine.drain()
    expect(gov.grants).toBeGreaterThan(3)
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0 })
  })
})

describe('one engine: the same dispatches are admitted as before #501', () => {
  it('a dispatch that launches and settles inside one tick still counts against the window for the rest of it', async () => {
    // $3 window, analyst estimate $2, real cost $1.25. The first run's job
    // settles before the second run is considered. Before #501 the tick's
    // own running total kept the $2 and the second run rested on HB; the
    // first cut of the governor lost the dispatch between its release and
    // the next report and launched both.
    const { dir, clock } = toyRepo()
    addRun(dir, 'zzz', new Date(Date.now() + 60_000).toISOString()) // newest tip: considered second
    const engine = makeEngine(dir, promptSpec(clock), { spendLimitUsd: 3, maxConcurrentDispatches: 0 })
    const readState = engine.source.readState.bind(engine.source)
    let waited = false
    engine.source.readState = (async (ref: Parameters<typeof readState>[0]) => {
      if (ref.slug === 'zzz' && engine.inFlight() > 0 && !waited) {
        waited = true
        await vi.waitFor(() => expect(engine.inFlight()).toBe(0), { timeout: 10_000, interval: 20 })
      }
      return readState(ref)
    }) as typeof readState
    const outcomes = await engine.tick()
    await engine.drain()
    expect(waited).toBe(true) // the first job really had settled when the second run was weighed
    expect(outcomes.find((o) => o.slug === 'toy')!.launched).toBe(1)
    expect(outcomes.find((o) => o.slug === 'zzz')!.action.rule).toBe('HB')
    expect(launched(outcomes)).toBe(1)
  })

  it('three runs under a cap of 2: two go in one tick', async () => {
    const { dir, clock } = toyRepo()
    addRun(dir, 'aaa', new Date(Date.now() + 60_000).toISOString())
    addRun(dir, 'mmm', new Date(Date.now() + 120_000).toISOString())
    const { dispatcher, open } = heldSpec(clock)
    const engine = makeEngine(dir, dispatcher, { maxConcurrentDispatches: 2 })
    const outcomes = await engine.tick()
    expect(launched(outcomes)).toBe(2)
    expect(outcomes.find((o) => o.slug === 'mmm')!.action.rule).toBe('MC') // newest tip waits
    open()
    await engine.drain()
  })

  it('an engine built without a governor says so, naming the limits it took', async () => {
    const { dir, clock } = toyRepo()
    const lines: string[] = []
    makeEngine(dir, promptSpec(clock), { maxConcurrentDispatches: 1, spendLimitUsd: 7, log: (l) => lines.push(l) })
    const said = lines.filter((l) => l.includes('built its own governor'))
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('cap 1, spend limit $7 per 24 hours, budget enforcement on')
    lines.length = 0
    makeEngine(dir, promptSpec(clock), { governor: new Governor(), log: (l) => lines.push(l) })
    expect(lines.filter((l) => l.includes('built its own governor'))).toEqual([])
  })
})

describe('one engine: a grant that never launches does not spin the loop', () => {
  it('a persistent fault on the granted run’s intent commit, beside a refused run, waits for the heartbeat', { timeout: 60_000 }, async () => {
    const { dir, clock } = toyRepo()
    addRun(dir, 'zzz', new Date(Date.now() + 3_600_000).toISOString()) // newest tip: considered second
    // Bring toy to "architect wanted"; leave zzz untouched.
    const prep = makeEngine(dir, promptSpec(clock))
    const list = prep.source.listRuns.bind(prep.source)
    prep.source.listRuns = (async () => (await list()).filter((r) => r.slug !== 'zzz')) as typeof list
    await reconcile(prep)
    await humanDecide(dir, { action: 'approve', gate: 'G0', burden: 'confirmation' })
    // toy's analyst closed at $1.25. toy now wants the architect ($5): $6.25
    // over $4, refused on spend. zzz wants the analyst ($2): granted.
    const gov = new Governor({ maxConcurrentDispatches: 0, spendLimitUsd: 4 })
    const dispatcher = new FakeDispatcher(() => ({}))
    const engine = makeEngine(dir, dispatcher, { governor: gov })
    // zzz's intent commit fails every time: a full disk, a broken hook.
    const writeState = engine.source.writeState.bind(engine.source)
    engine.source.writeState = (async (...args: Parameters<typeof writeState>) => {
      if (args[0].slug === 'zzz') throw new Error('disk on fire')
      return writeState(...args)
    }) as typeof writeState
    let ticks = 0
    const tick = engine.tick.bind(engine)
    engine.tick = async () => {
      ticks++
      return tick()
    }
    const loop = await runLoop(engine, dir, { heartbeatMs: 10 * 60_000, debounceMs: 10 * 60_000, log: () => {} })
    const afterStartup = ticks
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const later = ticks
    await loop.stop()
    await gov.idle()
    expect(afterStartup).toBe(1)
    // Before the fix the release woke its own engine, which retried at once:
    // 26 ticks in five seconds. Now the retry waits for the next heartbeat.
    expect(later).toBe(1)
    expect(dispatcher.calls).toHaveLength(0)
    expect(gov.snapshot().occupied).toBe(0)
  })
})

describe('one engine: the order runs are taken in (fairness within a repository)', () => {
  it('the run that has waited longest goes first — a change from alphabetical order', async () => {
    const { dir, clock } = toyRepo()
    // "aardvark" sorts first, but its tip is newer than toy's: before #501 it
    // would have taken the one slot; now the older toy does.
    addRun(dir, 'aardvark', new Date(Date.now() + 5_000).toISOString())
    const { dispatcher, open } = heldSpec(clock)
    const engine = makeEngine(dir, dispatcher, { maxConcurrentDispatches: 1 })
    const outcomes = await engine.tick()
    expect(outcomes.map((o) => o.slug)).toEqual(['toy', 'aardvark'])
    expect(outcomes.find((o) => o.slug === 'toy')!.launched).toBe(1)
    expect(outcomes.find((o) => o.slug === 'aardvark')!.action.rule).toBe('MC')
    open()
    await engine.drain()
  })
})

describe('two engines sharing one governor', () => {
  it('atomic grant: one free slot, both engines ticking at once — exactly one dispatch', async () => {
    const a = toyRepo()
    const b = toyRepo()
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    const ha = heldSpec(a.clock)
    const hb = heldSpec(b.clock)
    const ea = makeEngine(a.dir, ha.dispatcher, { governor: gov, repository: 'a' })
    const eb = makeEngine(b.dir, hb.dispatcher, { governor: gov, repository: 'b' })
    await Promise.all([ea.seedGovernor(), eb.seedGovernor()])
    const [oa, ob] = await Promise.all([ea.tick(), eb.tick()])
    expect(launched(oa) + launched(ob)).toBe(1)
    const deferredOne = [...oa, ...ob].find((o) => o.launched === 0)!
    expect(deferredOne.action.rule).toBe('MC')
    ha.open()
    hb.open()
    await Promise.all([ea.drain(), eb.drain()])
  })

  it('grants nothing until both have seeded', async () => {
    const a = toyRepo()
    const b = toyRepo()
    const gov = new Governor({ maxConcurrentDispatches: 2 })
    const ea = makeEngine(a.dir, promptSpec(a.clock), { governor: gov, repository: 'a' })
    makeEngine(b.dir, promptSpec(b.clock), { governor: gov, repository: 'b' })
    const outcomes = await ea.tick()
    expect(launched(outcomes)).toBe(0)
    expect(ea.deferrals()[0]).toMatchObject({ rule: 'MC', limit: 'concurrency' })
    expect(ea.deferrals()[0]!.reason).toContain('until b has reported its open dispatches')
  })

  it("a reservation granted and not yet committed is visible to the other engine's spend check", async () => {
    const a = toyRepo()
    const b = toyRepo()
    // analyst estimate is $2: one fits under $3, two do not.
    const gov = new Governor({ maxConcurrentDispatches: 0, spendLimitUsd: 3 })
    const ea = makeEngine(a.dir, promptSpec(a.clock), { governor: gov, repository: 'a' })
    const eb = makeEngine(b.dir, promptSpec(b.clock), { governor: gov, repository: 'b' })
    await Promise.all([ea.seedGovernor(), eb.seedGovernor()])
    // Hold engine A between its grant and its intent commit.
    const gate = deferred<void>()
    const reached = deferred<void>()
    const writeState = ea.source.writeState.bind(ea.source)
    ea.source.writeState = (async (...args: Parameters<typeof writeState>) => {
      reached.resolve()
      await gate.promise
      return writeState(...args)
    }) as typeof writeState
    const aTick = ea.tick()
    await reached.promise
    expect(gov.snapshot()).toMatchObject({ uncommitted: 1, uncommittedUsd: 2 })

    const ob = await eb.tick()
    expect(launched(ob)).toBe(0)
    expect(eb.deferrals()[0]).toMatchObject({ rule: 'HB', limit: 'spend' })
    expect(eb.deferrals()[0]!.reason).toContain('projected host spend $4.00')

    gate.resolve()
    expect(launched(await aTick)).toBe(1)
    await ea.drain()
  })

  it('wake: A is refused, B settles, A dispatches without waiting for its heartbeat — and no engine ticks twice at once', { timeout: 60_000 }, async () => {
    const a = toyRepo()
    const b = toyRepo()
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    const ha = heldSpec(a.clock)
    const hb = heldSpec(b.clock)
    const ea = makeEngine(a.dir, ha.dispatcher, { governor: gov, repository: 'a' })
    const eb = makeEngine(b.dir, hb.dispatcher, { governor: gov, repository: 'b' })
    await Promise.all([ea.seedGovernor(), eb.seedGovernor()])
    // Count overlapping ticks per engine.
    const overlap = { a: 0, b: 0 }
    for (const [name, engine] of [
      ['a', ea],
      ['b', eb],
    ] as const) {
      const tick = engine.tick.bind(engine)
      let inside = 0
      engine.tick = async () => {
        inside++
        overlap[name] = Math.max(overlap[name], inside)
        try {
          return await tick()
        } finally {
          inside--
        }
      }
    }
    // Heartbeats and the ref watcher pushed far past the test: only a wake can move A.
    const quiet = { heartbeatMs: 10 * 60_000, debounceMs: 10 * 60_000, log: () => {} }
    const lb = await runLoop(eb, b.dir, quiet)
    await vi.waitFor(() => expect(hb.dispatcher.calls).toHaveLength(1), { timeout: 10_000, interval: 20 })
    const la = await runLoop(ea, a.dir, quiet)
    expect(ha.dispatcher.calls).toHaveLength(0)
    expect(ea.deferrals()[0]).toMatchObject({ rule: 'MC' })

    hb.open() // B's job settles and releases its slot
    await vi.waitFor(() => expect(ha.dispatcher.calls).toHaveLength(1), { timeout: 30_000, interval: 50 })

    ha.open()
    await la.stop()
    await lb.stop()
    await gov.idle()
    expect(overlap).toEqual({ a: 1, b: 1 })
    expect(gov.snapshot().occupied).toBe(0)
  })
})

describe('restart: open ledger entries occupy slots', () => {
  /** Give the toy run an open analyst entry, as a process that has since gone would have left it. */
  async function openEntry(dir: string, at: Date, engine: string): Promise<void> {
    const human = new LocalGitSource('t', dir)
    const ref = (await human.listRuns()).find((r) => r.slug === 'toy')!
    const wrote = await human.writeState(
      ref,
      (doc) =>
        doc.setIn(['budget', 'ledger', 0], {
          at: at.toISOString(),
          role: 'analyst',
          task: null,
          round: null,
          adapter: 'fake',
          model: null,
          engine,
          tokens_in: null,
          tokens_out: null,
          cost_usd: null,
        }),
      'state(toy): dispatched analyst',
    )
    expect(wrote.ok).toBe(true)
  }

  const liveElsewhere = () => `${hostname()}:${process.pid}#999` // this very process: alive, and not the engine under test

  it('an open sweep holds its slot for the configured sweep timeout, not a fixed one', async () => {
    const at = new Date(Date.now() - 10 * 60_000) // opened ten minutes ago, never metered
    const slug = `historian-${at.toISOString().slice(0, 10)}`
    const marker = `sweep: ${slug}\nrole: historian\nevery: 7d\nat: ${at.toISOString()}\ncovering_since: null\nadapter: fake\nmodel: null\ncost_limit_usd: 5\ntokens_in: null\ntokens_out: null\ncost_usd: null\n`
    const holdsWith = async (sweepTimeoutMs: number | undefined) => {
      const { dir, clock } = toyRepo()
      agentCommit(dir, clock, { [`runs/${slug}/sweep.yaml`]: marker }, `${slug}: open sweep`)
      const gov = new Governor({ maxConcurrentDispatches: 1 })
      await makeEngine(dir, promptSpec(clock), { governor: gov, sweepTimeoutMs }).seedGovernor()
      return gov.snapshot().holds
    }
    expect(await holdsWith(undefined)).toBe(1) // the default 30 minutes: still held
    expect(await holdsWith(5 * 60_000)).toBe(0) // a 5-minute timeout: long past it
  })

  it('an entry still inside the role timeout holds its slot: the other run waits', async () => {
    const { dir, clock } = toyRepo()
    addRun(dir, 'toy2')
    await openEntry(dir, new Date(Date.now() - 60_000), liveElsewhere())
    const engine = makeEngine(dir, promptSpec(clock), { maxConcurrentDispatches: 1 })
    const outcomes = await engine.tick()
    expect(launched(outcomes)).toBe(0)
    expect(outcomes.find((o) => o.slug === 'toy2')!.action.rule).toBe('MC')
    expect(engine.governor instanceof Governor && engine.governor.snapshot().holds).toBe(1)
  })

  it('an entry older than the role timeout holds nothing', async () => {
    const { dir, clock } = toyRepo()
    addRun(dir, 'toy2')
    // 31 minutes: past the 30-minute role timeout, short of the stale sweep's
    // 40 (role timeout + staleMs), so the entry is still open in the ledger.
    await openEntry(dir, new Date(Date.now() - 31 * 60_000), liveElsewhere())
    const engine = makeEngine(dir, promptSpec(clock), { maxConcurrentDispatches: 1 })
    const outcomes = await engine.tick()
    expect(outcomes.find((o) => o.slug === 'toy2')!.launched).toBe(1)
    await engine.drain()
  })

  it('consistent with lost-dispatch aging: a dead engine’s entry holds its slot until the stale sweep closes it, and not after', async () => {
    // Younger than staleMs: the sweep leaves it, so the hold stands.
    {
      const { dir, clock } = toyRepo()
      addRun(dir, 'toy2')
      await openEntry(dir, new Date(Date.now() - 60_000), deadEngineId())
      const engine = makeEngine(dir, promptSpec(clock), { maxConcurrentDispatches: 1 })
      const outcomes = await engine.tick()
      expect(launched(outcomes)).toBe(0)
    }
    // Older than staleMs: the sweep ages it out in this very tick, the report
    // shows it closed, and the slot is free again the same pass.
    {
      const { dir, clock } = toyRepo()
      addRun(dir, 'toy2')
      await openEntry(dir, new Date(Date.now() - 11 * 60_000), deadEngineId())
      const engine = makeEngine(dir, promptSpec(clock), { maxConcurrentDispatches: 1 })
      const outcomes = await engine.tick()
      expect(launched(outcomes)).toBe(1)
      const source = new LocalGitSource('t', dir)
      const toy = (await source.listRuns()).find((r) => r.slug === 'toy')!
      expect(parseLedger((await source.readState(toy)).state!)[0]).toMatchObject({ failed: true })
      await engine.drain()
    }
  })
})

describe('sweeps pass through the governor', () => {
  const REGISTRY = { ...TEST_REGISTRY, estimates: { ...TEST_REGISTRY.estimates, historian: 1 } }
  const CONFIG = 'schedules:\n  historian:\n    every: 7d\n    cost_limit_usd: 5\n'
  const DELTA = '# Docs Delta: sweep\n\n## Drift found\n\n## Applied changes\n\n## Proposed actions\n\n## Escalations\n\n## Surfaces checked, no drift\n'

  it('a sweep is deferred while the cap is taken, writes nothing, and goes once a slot frees', async () => {
    const { dir, clock } = toyRepo()
    agentCommit(dir, clock, { 'orchestrator.yaml': CONFIG }, 'seed orchestrator.yaml')
    const gov = new Governor({ maxConcurrentDispatches: 1 })
    const { dispatcher, open } = heldSpec(clock)
    const engine = makeEngine(dir, dispatcher, { governor: gov, registry: REGISTRY })
    const sweeper = new FakeDispatcher((req) => {
      agentCommit(req.cwd, clock, { [`runs/${sweepSlug('historian', new Date())}/docs-delta.md`]: DELTA }, 'docs delta')
      return { costUsd: 0.5 }
    })
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher: sweeper, registry: REGISTRY, governor: gov, repository: dir })

    expect(launched(await engine.tick())).toBe(1)
    const [held] = await scheduler.tick()
    expect(held).toMatchObject({ kind: 'deferred', rule: 'MC' })
    expect(held!.detail).toContain('historian sweep deferred — 1 in flight against --max-concurrent-dispatches 1')
    expect(scheduler.deferrals()).toMatchObject([{ slug: held!.slug, rule: 'MC' }])
    expect(git(dir, ['for-each-ref', 'refs/heads/run/historian-*'])).toBe('')
    expect(sweeper.calls).toHaveLength(0)

    open()
    await engine.drain()
    const [went] = await scheduler.tick()
    expect(went).toMatchObject({ kind: 'dispatched' })
    expect(scheduler.deferrals()).toEqual([])
    expect(gov.snapshot().occupied).toBe(1) // the sweep's own slot, until it settles
    await scheduler.drain()
    expect(gov.snapshot().occupied).toBe(0)
  })

  it("a sweep's recorded cost counts inside the window, and not outside it", async () => {
    const now = new Date('2026-09-04T12:00:00Z')
    /** A merged historian sweep whose marker says it cost $10, dispatched at `at`. */
    const withSweep = (at: Date) => {
      const made = toyRepo()
      const slug = `historian-${at.toISOString().slice(0, 10)}`
      const marker = `sweep: ${slug}\nrole: historian\nevery: 7d\nat: ${at.toISOString()}\ncovering_since: null\nadapter: fake\nmodel: null\ncost_limit_usd: 5\ntokens_in: 1\ntokens_out: 1\ncost_usd: 10\n`
      agentCommit(made.dir, made.clock, { [`runs/${slug}/sweep.yaml`]: marker }, `merge ${slug}`)
      return made
    }
    // analyst estimate $2 against a $5 limit: the $10 sweep decides it.
    {
      const { dir, clock } = withSweep(new Date(now.getTime() - 3_600_000))
      const engine = makeEngine(dir, promptSpec(clock), { spendLimitUsd: 5, now: () => now, registry: REGISTRY })
      const outcomes = await engine.tick()
      expect(outcomes.find((o) => o.slug === 'toy')!.action.rule).toBe('HB')
      expect(engine.deferrals()[0]!.reason).toContain('ledger $10.00 in the window')
    }
    {
      const { dir, clock } = withSweep(new Date(now.getTime() - 48 * 3_600_000))
      const engine = makeEngine(dir, promptSpec(clock), { spendLimitUsd: 5, now: () => now, registry: REGISTRY })
      const outcomes = await engine.tick()
      expect(outcomes.find((o) => o.slug === 'toy')!.launched).toBe(1)
      await engine.drain()
    }
  })

  it('reads orchestrator.yaml at the host tip it was given, not at whatever the default branch says now', async () => {
    const { dir, clock } = toyRepo()
    const before = git(dir, ['rev-parse', 'refs/heads/main'])
    agentCommit(dir, clock, { 'orchestrator.yaml': CONFIG }, 'seed orchestrator.yaml')
    const sweeper = new FakeDispatcher(() => ({}))
    const pinned = { name: 'main', ref: 'refs/heads/main', commit: before, fallback: false }
    const scheduler = new Scheduler({ repoDir: dir, identity: BOT, dispatcher: sweeper, registry: REGISTRY, hostTip: pinned, governor: new Governor() })
    expect(await scheduler.tick()).toEqual([])
    const unpinned = new Scheduler({ repoDir: dir, identity: BOT, dispatcher: sweeper, registry: REGISTRY, governor: new Governor() })
    expect(await unpinned.tick()).toMatchObject([{ kind: 'dispatched' }])
    await unpinned.drain()
  })
})
