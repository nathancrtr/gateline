// The governor on its own (#501): reserve, release, report, seed, wake. The
// engine-level half — real engines, real repositories, a fake dispatcher —
// is governor-engines.test.ts.
import { describe, expect, it } from 'vitest'
import { Governor, type GovernorConfig, type Reservation, type ReserveResult, type SpendReport } from '../src/governor.ts'

const T0 = new Date('2026-09-04T12:00:00Z')
const HOUR = 3_600_000

/**
 * A governor on a clock the test moves, with every named repository
 * registered and seeded. The clock stands still unless moved, so the minimum
 * wake interval is off by default here; its own test turns it on.
 */
function governor(cfg: GovernorConfig = {}, repos: string[] = ['A', 'B']) {
  let now = T0.getTime()
  const gov = new Governor({ now: () => new Date(now), minWakeIntervalMs: 0, ...cfg })
  for (const r of repos) {
    gov.register(r)
    gov.seed(r, [])
  }
  return { gov, advance: (ms: number) => (now += ms), at: (ms: number) => new Date(now + ms).toISOString() }
}

const one = (key: string, estimateUsd = 1) => [{ key, estimateUsd }]

/** A report whose ledgers are already in hand: gathered the moment the governor asks. */
const report = (gov: Governor, repository: string, r: SpendReport) => gov.report(repository, () => r)

describe('reserve — the cap', () => {
  it('grants up to the cap and refuses the rest, naming the limit and the numbers', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 2 })
    const res = gov.reserve({ repository: 'A', intents: [...one('a1'), ...one('a2'), ...one('a3')] })
    expect(res.granted.map((r) => r.key)).toEqual(['a1', 'a2'])
    expect(res.refusal).toMatchObject({ limit: 'concurrency', repository: 'A', occupied: 0, cap: 2, requested: 3, granted: 2 })
    const refused = gov.reserve({ repository: 'B', intents: one('b1') })
    expect(refused.granted).toEqual([])
    expect(refused.refusal).toMatchObject({ limit: 'concurrency', occupied: 2, cap: 2 })
  })

  it('an unset cap is 2; 0 is uncapped', async () => {
    expect(governor().gov.reserve({ repository: 'A', intents: [...one('1'), ...one('2'), ...one('3')] }).granted).toHaveLength(2)
    const many = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, estimateUsd: 1 }))
    expect(governor({ maxConcurrentDispatches: 0 }).gov.reserve({ repository: 'A', intents: many }).granted).toHaveLength(25)
  })

  it('release frees the slot, and releasing twice frees it once', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 2, spendLimitUsd: 100 })
    const [a] = gov.reserve({ repository: 'A', intents: one('a', 5) }).granted
    a!.commit()
    const [b] = gov.reserve({ repository: 'B', intents: one('b', 1) }).granted
    expect(b).toBeDefined()
    a!.release(5)
    // The second release comes while another reservation is live, so a
    // double free would show: in the count, and in the settled spend.
    a!.release(5)
    expect(gov.snapshot()).toMatchObject({ occupied: 1, reservations: 1, settled: 1 })
    expect(gov.machineSpend()).toEqual({ closed: 5, open: 1 })
    const [c] = gov.reserve({ repository: 'B', intents: one('c', 1) }).granted
    expect(c).toBeDefined()
    expect(gov.reserve({ repository: 'B', intents: one('d', 1) }).refusal!.limit).toBe('concurrency')
  })

  it('refuses a request that names one key twice, naming the key', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 0 })
    expect(() => gov.reserve({ repository: 'A', intents: [...one('k', 5), ...one('k', 5)] })).toThrow('names the key "k" twice')
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0 })
  })

  it('atomic grant: two callers asking for the last slot in the same tick window — exactly one is granted', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1 })
    // Both requests are queued before either runs; were there an await
    // between the check and the grant, both would pass the check.
    const results: ReserveResult[] = await Promise.all([
      Promise.resolve().then(() => gov.reserve({ repository: 'A', intents: one('a') })),
      Promise.resolve().then(() => gov.reserve({ repository: 'B', intents: one('b') })),
    ])
    expect(results.map((r) => r.granted.length).sort()).toEqual([0, 1])
    expect(results.find((r) => r.granted.length === 0)!.refusal!.limit).toBe('concurrency')
  })
})

describe('reserve — the spend window', () => {
  it('a reservation granted and not yet committed counts against the next request', async () => {
    const { gov } = governor({ spendLimitUsd: 8 })
    const [a] = gov.reserve({ repository: 'A', intents: one('a', 5) }).granted
    expect(a!.committed).toBe(false)
    const refused = gov.reserve({ repository: 'B', intents: one('b', 5) })
    expect(refused.granted).toEqual([])
    expect(refused.refusal).toMatchObject({ limit: 'spend', projectedUsd: 5, closedUsd: 0, requestedUsd: 5, limitUsd: 8 })
    a!.release()
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).granted).toHaveLength(1)
  })

  it('a committed reservation and the open ledger entry it wrote count once', async () => {
    const { gov, at } = governor({ spendLimitUsd: 8 })
    const [a] = gov.reserve({ repository: 'A', intents: one('A|analyst||', 5) }).granted
    a!.commit()
    await report(gov, 'A', { closed: [], open: [{ key: 'A|analyst||', at: at(0), estimateUsd: 5, kind: 'dispatch' }] })
    // 5 + 3 fits under 8; double-counting the dispatch would make it 13.
    expect(gov.reserve({ repository: 'B', intents: one('b', 3) }).granted).toHaveLength(1)
    expect(gov.machineSpend()).toEqual({ closed: 0, open: 8 })
  })

  it('closed entries count inside the window (and undated ones always); open run entries count whenever they opened', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100 })
    await report(gov, 'A', {
      closed: [
        { at: at(-HOUR), costUsd: 10 },
        { at: at(-48 * HOUR), costUsd: 1000 },
        { at: null, costUsd: 3 },
      ],
      open: [{ key: 'old-open', at: at(-72 * HOUR), estimateUsd: 4, kind: 'dispatch' }],
    })
    expect(gov.machineSpend()).toEqual({ closed: 13, open: 4 })
  })

  it('an open sweep marker counts only while it opened inside the window', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100 })
    await report(gov, 'A', {
      closed: [],
      open: [
        { key: 'sweep:historian-2026-09-04', at: at(-HOUR), estimateUsd: 2, kind: 'sweep' },
        { key: 'sweep:historian-2026-08-01', at: at(-30 * 24 * HOUR), estimateUsd: 7, kind: 'sweep' },
      ],
    })
    expect(gov.machineSpend().open).toBe(2)
  })

  it('the machine window sums every registered repository', async () => {
    const { gov, at } = governor({ spendLimitUsd: 10 })
    await report(gov, 'A', { closed: [{ at: at(-HOUR), costUsd: 4 }], open: [] })
    await report(gov, 'B', { closed: [{ at: at(-HOUR), costUsd: 4 }], open: [] })
    const refused = gov.reserve({ repository: 'A', intents: one('a', 3) })
    expect(refused.refusal).toMatchObject({ limit: 'spend', closedUsd: 8, projectedUsd: 8 })
  })

  it('a repository ceiling refuses that repository only', async () => {
    const { gov } = governor({ spendLimitUsd: 100, repositories: { A: { spendLimitUsd: 4 } } })
    expect(gov.reserve({ repository: 'A', intents: one('a', 5) }).refusal).toMatchObject({ limit: 'repository-spend', limitUsd: 4 })
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).granted).toHaveLength(1)
  })

  it('spend is judged on the prefix the cap grants, all or nothing', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1, spendLimitUsd: 6 })
    expect(gov.reserve({ repository: 'A', intents: [...one('a', 7), ...one('b', 1)] }).refusal!.limit).toBe('spend')
    expect(gov.reserve({ repository: 'A', intents: [...one('a', 5), ...one('b', 5)] }).granted).toHaveLength(1)
  })

  it('a dispatch that settles before its repository reports again still counts', async () => {
    // The report comes at the start of a tick, before the intent commit, so
    // it lists the dispatch neither open nor closed. Before the fix, releasing
    // the reservation dropped the dispatch from the sum until the next report.
    const { gov } = governor({ spendLimitUsd: 8, maxConcurrentDispatches: 0 })
    await report(gov, 'A', { closed: [], open: [] })
    const [a] = gov.reserve({ repository: 'A', intents: one('a', 5) }).granted
    a!.commit()
    a!.release() // settled; the engine did not know the cost, so the estimate counts
    expect(gov.machineSpend()).toEqual({ closed: 5, open: 0 })
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).refusal).toMatchObject({ limit: 'spend', closedUsd: 5 })
    // The next report reads the closed entry back, and replaces the record.
    await report(gov, 'A', { closed: [{ at: null, costUsd: 5 }], open: [] })
    expect(gov.snapshot().settled).toBe(0)
    expect(gov.machineSpend()).toEqual({ closed: 5, open: 0 })
  })

  it('a settled dispatch counts at the real cost it was released with', async () => {
    const { gov } = governor({ spendLimitUsd: 8, maxConcurrentDispatches: 0 })
    const [a] = gov.reserve({ repository: 'A', intents: one('a', 5) }).granted
    a!.commit()
    a!.release(1.25)
    expect(gov.machineSpend()).toEqual({ closed: 1.25, open: 0 })
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).granted).toHaveLength(1)
  })

  it('a reservation released without being committed spent nothing and leaves nothing behind', async () => {
    const { gov } = governor({ spendLimitUsd: 8 })
    const [a] = gov.reserve({ repository: 'A', intents: one('a', 5) }).granted
    a!.release()
    expect(gov.machineSpend()).toEqual({ closed: 0, open: 0 })
    expect(gov.snapshot().settled).toBe(0)
  })

  it('a settlement during a report’s gathering survives that report; the next report replaces it', async () => {
    const { gov } = governor({ spendLimitUsd: 100, maxConcurrentDispatches: 0 })
    const [a] = gov.reserve({ repository: 'A', intents: one('A|analyst||', 5) }).granted
    a!.commit()
    // The engine starts reading its ledgers; the dispatch settles while it
    // reads; what it read still shows the entry open.
    let finish: () => void = () => {}
    const gathered = new Promise<void>((resolve) => {
      finish = resolve
    })
    const inFlight = gov.report('A', async () => {
      await gathered
      return { closed: [], open: [{ key: 'A|analyst||', at: null, estimateUsd: 5, kind: 'dispatch' }] }
    })
    a!.release(2)
    finish()
    await inFlight
    // Counted once, at what it cost — not dropped, and not beside its stale open entry.
    expect(gov.machineSpend()).toEqual({ closed: 2, open: 0 })
    await report(gov, 'A', { closed: [{ at: null, costUsd: 2 }], open: [] })
    expect(gov.machineSpend()).toEqual({ closed: 2, open: 0 })
    expect(gov.snapshot().settled).toBe(0)
  })

  it('a dispatch the report reads closed after it settled is counted once (key and at join them)', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100, maxConcurrentDispatches: 0 })
    const [a] = gov.reserve({ repository: 'A', intents: one('k', 5) }).granted
    a!.commit(at(0))
    let finish: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    // The report starts; the closing commit lands and the job releases; then
    // the gathering reads that ledger and finds the entry closed.
    const inFlight = gov.report('A', async () => {
      await gate
      return { closed: [{ key: 'k', at: at(0), costUsd: 2 }], open: [] }
    })
    a!.release(2)
    finish()
    await inFlight
    expect(gov.machineSpend()).toEqual({ closed: 2, open: 0 })
  })

  it('a report gathered between the closing commit and the release counts the dispatch once, before the release and after', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100, maxConcurrentDispatches: 0 })
    const [a] = gov.reserve({ repository: 'A', intents: one('k', 5) }).granted
    a!.commit(at(0))
    await report(gov, 'A', { closed: [{ key: 'k', at: at(0), costUsd: 2 }], open: [] })
    expect(gov.machineSpend()).toEqual({ closed: 2, open: 0 }) // not $2 closed + $5 for the still-live slot
    a!.release(2)
    expect(gov.machineSpend()).toEqual({ closed: 2, open: 0 }) // not $2 closed + $2 settled
  })

  it('a retry under the same key is not mistaken for the earlier attempt the report shows closed', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100, maxConcurrentDispatches: 0 })
    // The first attempt closed (failed) at $3; the retry reuses the key.
    await report(gov, 'A', { closed: [{ key: 'k', at: at(-60_000), costUsd: 3 }], open: [] })
    const [retry] = gov.reserve({ repository: 'A', intents: one('k', 5) }).granted
    retry!.commit(at(0))
    expect(gov.machineSpend()).toEqual({ closed: 3, open: 5 })
    retry!.release(4)
    expect(gov.machineSpend()).toEqual({ closed: 7, open: 0 })
  })

  it('a settled dispatch leaves the window when the window rolls, whether or not its repository reports again', async () => {
    const { gov, advance } = governor({ spendLimitUsd: 8, maxConcurrentDispatches: 0 })
    const [a] = gov.reserve({ repository: 'A', intents: one('k', 5) }).granted
    a!.commit()
    a!.release(5)
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).refusal!.limit).toBe('spend')
    advance(48 * HOUR) // A's engine has stopped, or its report fails every time
    expect(gov.machineSpend()).toEqual({ closed: 0, open: 0 })
    expect(gov.reserve({ repository: 'B', intents: one('b', 5) }).granted).toHaveLength(1)
  })

  it('settlements that have left the window are dropped, even when every report fails', async () => {
    const { gov, advance } = governor({ spendLimitUsd: 1000, maxConcurrentDispatches: 0 })
    for (let i = 0; i < 50; i++) {
      const [r] = gov.reserve({ repository: 'A', intents: one(`k${i}`, 1) }).granted
      r!.commit()
      r!.release(1)
      await gov
        .report('A', () => {
          throw new Error('git broke')
        })
        .catch(() => {})
      advance(HOUR) // fifty hours in all: the first twenty-six are out of the window by the end
    }
    // Pruned as each new settlement arrives, so at most the last window's
    // worth is kept; of those, the ones still inside the window count.
    expect(gov.snapshot().settled).toBeLessThanOrEqual(25)
    expect(gov.machineSpend().closed).toBe(24)
  })

  it('a cost below zero, or one that is not a finite number, counts as unknown: the estimate stands in', async () => {
    for (const bad of [-100, Number.NaN, Number.POSITIVE_INFINITY, '3.5' as unknown as number]) {
      const { gov } = governor({ spendLimitUsd: 8, maxConcurrentDispatches: 0 })
      const [a] = gov.reserve({ repository: 'A', intents: one('k', 5) }).granted
      a!.commit()
      a!.release(bad)
      expect(gov.machineSpend()).toEqual({ closed: 5, open: 0 })
    }
  })

  it('a report that could not read the sweep markers keeps the sweep figures the governor had', async () => {
    const { gov, at } = governor({ spendLimitUsd: 100, maxConcurrentDispatches: 0 })
    await report(gov, 'A', { closed: [{ key: 'sweep:historian-old', at: at(-HOUR), costUsd: 3, kind: 'sweep' }], open: [] })
    const [s] = gov.reserve({ repository: 'A', intents: [{ key: 'sweep:historian-new', estimateUsd: 2, kind: 'sweep' }] }).granted
    s!.commit(at(0))
    s!.release(1)
    expect(gov.machineSpend()).toEqual({ closed: 4, open: 0 })
    // The next report read the ledgers but not the markers.
    await report(gov, 'A', { closed: [{ key: 'A|analyst||', at: at(0), costUsd: 2, kind: 'dispatch' }], open: [], sweepsRead: false })
    expect(gov.machineSpend()).toEqual({ closed: 6, open: 0 }) // $2 run + $3 old sweep + $1 new sweep, nothing dropped
    // A report that did read them replaces both, and still counts each once.
    await report(gov, 'A', {
      closed: [
        { key: 'A|analyst||', at: at(0), costUsd: 2, kind: 'dispatch' },
        { key: 'sweep:historian-old', at: at(-HOUR), costUsd: 3, kind: 'sweep' },
        { key: 'sweep:historian-new', at: at(0), costUsd: 1, kind: 'sweep' },
      ],
      open: [],
    })
    expect(gov.machineSpend()).toEqual({ closed: 6, open: 0 })
    expect(gov.snapshot().settled).toBe(0)
  })

  it('a report that finishes gathering after a newer one was applied is ignored', async () => {
    const { gov } = governor({ spendLimitUsd: 100 })
    let finish: () => void = () => {}
    const slow = gov.report('A', async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { closed: [{ at: null, costUsd: 1 }], open: [] }
    })
    await report(gov, 'A', { closed: [{ at: null, costUsd: 7 }], open: [] })
    finish()
    await slow
    expect(gov.machineSpend().closed).toBe(7)
  })

  it('--no-budget-enforcement: both spend checks off, the cap still on', async () => {
    const { gov } = governor({ budgetEnforcement: false, spendLimitUsd: 1, maxConcurrentDispatches: 1, repositories: { A: { spendLimitUsd: 1 } } })
    expect(gov.reserve({ repository: 'A', intents: one('a', 50) }).granted).toHaveLength(1)
    expect(gov.reserve({ repository: 'A', intents: one('b', 1) }).refusal!.limit).toBe('concurrency')
  })
})

describe('restart — seeding from open entries', () => {
  it('grants nothing until every registered repository has seeded', async () => {
    const gov = new Governor({ now: () => T0 })
    gov.register('A')
    gov.register('B')
    gov.seed('A', [])
    const refused = gov.reserve({ repository: 'A', intents: one('a') })
    expect(refused.refusal).toMatchObject({ limit: 'concurrency', unseeded: ['B'] })
    gov.seed('B', [])
    expect(gov.reserve({ repository: 'A', intents: one('a') }).granted).toHaveLength(1)
  })

  it('an open entry holds a slot until a report shows it closed', async () => {
    const gov = new Governor({ maxConcurrentDispatches: 1, now: () => T0 })
    gov.seed('A', [{ key: 'A|analyst||', at: T0.toISOString(), estimateUsd: 2, timeoutMs: 30 * 60_000, kind: 'dispatch' }])
    expect(gov.reserve({ repository: 'A', intents: one('other') }).refusal).toMatchObject({ limit: 'concurrency', occupied: 1 })
    // Still open in the ledger: still held.
    await report(gov, 'A', { closed: [], open: [{ key: 'A|analyst||', at: T0.toISOString(), estimateUsd: 2, kind: 'dispatch' }] })
    expect(gov.reserve({ repository: 'A', intents: one('other') }).granted).toEqual([])
    // Closed in the ledger: released.
    await report(gov, 'A', { closed: [{ at: T0.toISOString(), costUsd: 2 }], open: [] })
    expect(gov.reserve({ repository: 'A', intents: one('other') }).granted).toHaveLength(1)
  })

  it('an open entry older than the role timeout holds nothing; a younger one holds until the timeout passes', async () => {
    let now = T0.getTime()
    const gov = new Governor({ maxConcurrentDispatches: 1, now: () => new Date(now) })
    const timeoutMs = 30 * 60_000
    gov.seed('A', [
      { key: 'stale', at: new Date(now - timeoutMs - 1).toISOString(), estimateUsd: 2, timeoutMs, kind: 'dispatch' },
      { key: 'young', at: new Date(now - 5 * 60_000).toISOString(), estimateUsd: 2, timeoutMs, kind: 'dispatch' },
    ])
    expect(gov.snapshot().holds).toBe(1)
    expect(gov.reserve({ repository: 'A', intents: one('x') }).granted).toEqual([])
    now += 25 * 60_000 // the young entry reaches its timeout, and nothing ever reported it closed
    expect(gov.reserve({ repository: 'A', intents: one('x') }).granted).toHaveLength(1)
  })

  it('a sweep hold is cleared only by its timeout: nothing closes the marker of a sweep whose process died', async () => {
    let now = T0.getTime()
    const gov = new Governor({ maxConcurrentDispatches: 1, now: () => new Date(now) })
    gov.seed('A', [{ key: 'sweep:historian-2026-09-04', at: T0.toISOString(), estimateUsd: 1, timeoutMs: 30 * 60_000, kind: 'sweep' }])
    await report(gov, 'A', { closed: [], open: [] })
    expect(gov.reserve({ repository: 'A', intents: one('x') }).granted).toEqual([])
    now += 30 * 60_000
    expect(gov.reserve({ repository: 'A', intents: one('x') }).granted).toHaveLength(1)
  })

  it('a dispatch for the same key supersedes its hold: derivation only asks for a key it reads as closed', async () => {
    const gov = new Governor({ maxConcurrentDispatches: 1, spendLimitUsd: 3, now: () => T0 })
    gov.seed('A', [{ key: 'A|analyst||', at: T0.toISOString(), estimateUsd: 2, timeoutMs: 30 * 60_000, kind: 'dispatch' }])
    // Takes over the hold's slot and its estimate: $2, not $2 + $2, against $3.
    expect(gov.reserve({ repository: 'A', intents: one('A|analyst||', 2) }).granted).toHaveLength(1)
    expect(gov.snapshot()).toMatchObject({ holds: 0, reservations: 1 })
  })

  it('a refused request leaves the hold for its key standing', async () => {
    const gov = new Governor({ maxConcurrentDispatches: 1, spendLimitUsd: 1, now: () => T0 })
    gov.seed('A', [{ key: 'k', at: T0.toISOString(), estimateUsd: 2, timeoutMs: 30 * 60_000, kind: 'sweep' }])
    expect(gov.reserve({ repository: 'A', intents: one('k', 2) }).refusal!.limit).toBe('spend')
    expect(gov.snapshot()).toMatchObject({ holds: 1, occupied: 1 })
    expect(gov.reserve({ repository: 'A', intents: one('other', 0) }).refusal!.limit).toBe('concurrency')
  })
})

describe('no leak across many interleaved reserves and releases', () => {
  it('a seeded random walk of reserve, commit, release (sometimes twice) and report never exceeds the cap and ends empty', async () => {
    // Park–Miller: deterministic, so a failure reproduces.
    let seed = 501
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const cap = 3
    const { gov, at } = governor({ maxConcurrentDispatches: cap, spendLimitUsd: 40 }, ['A', 'B', 'C'])
    const repos = ['A', 'B', 'C']
    const live: Reservation[] = []
    let granted = 0
    for (let step = 0; step < 5000; step++) {
      const op = rand()
      if (op < 0.45) {
        const repository = repos[Math.floor(rand() * 3)]!
        const n = 1 + Math.floor(rand() * 3)
        const intents = Array.from({ length: n }, (_, i) => ({ key: `${repository}-${step}-${i}`, estimateUsd: 1 + Math.floor(rand() * 5) }))
        const res = gov.reserve({ repository, intents })
        granted += res.granted.length
        live.push(...res.granted)
      } else if (op < 0.6 && live.length > 0) {
        live[Math.floor(rand() * live.length)]!.commit()
      } else if (op < 0.95 && live.length > 0) {
        const i = Math.floor(rand() * live.length)
        const r = live[i]!
        r.release()
        if (rand() < 0.3) r.release() // the idempotence the engine's finally relies on
        live.splice(i, 1)
      } else {
        const repository = repos[Math.floor(rand() * 3)]!
        await report(gov, repository, { closed: [{ at: at(-HOUR), costUsd: rand() * 5 }], open: [] })
      }
      const snap = gov.snapshot()
      expect(snap.reservations).toBe(live.length)
      expect(snap.occupied).toBeLessThanOrEqual(cap)
    }
    expect(granted).toBeGreaterThan(500) // the walk exercised the grant path, not only refusals
    for (const r of live.splice(0)) r.release()
    expect(gov.snapshot()).toMatchObject({ occupied: 0, reservations: 0, uncommitted: 0, uncommittedUsd: 0 })
    // And the slots really are free: a fresh request for the whole cap is granted.
    for (const r of repos) await report(gov, r, { closed: [], open: [] })
    expect(gov.reserve({ repository: 'A', intents: [...one('z1'), ...one('z2'), ...one('z3')] }).granted).toHaveLength(cap)
  })
})

describe('wake and fairness', () => {
  /**
   * A stand-in for an engine with a queue of runs: its "tick" asks for each
   * queued item in order until one is refused, as the engine's pass does.
   * Grants are recorded in the order the governor made them.
   */
  function queueing(gov: Governor, repository: string, items: string[], grants: { repo: string; key: string; r: Reservation }[]) {
    const queue = [...items]
    const tick = async () => {
      while (queue.length > 0) {
        const [r] = gov.reserve({ repository, intents: one(queue[0]!) }).granted
        if (!r) return
        // Committed, as a launched dispatch is: a release that launched
        // nothing wakes only the other repositories, which would force the
        // alternation this test exists to check the round-robin for.
        r.commit()
        grants.push({ repo: repository, key: queue.shift()!, r })
      }
    }
    gov.subscribe(repository, tick)
    return tick
  }

  it('a release wakes every repository refused since the last release', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1 }, ['X', 'A', 'B'])
    const woken: string[] = []
    gov.subscribe('A', async () => void woken.push('A'))
    gov.subscribe('B', async () => void woken.push('B'))
    const [x] = gov.reserve({ repository: 'X', intents: one('x') }).granted
    gov.reserve({ repository: 'A', intents: one('a') })
    gov.reserve({ repository: 'B', intents: one('b') })
    expect(woken).toEqual([])
    x!.release()
    await gov.idle()
    expect(woken.sort()).toEqual(['A', 'B'])
  })

  it('slots alternate between two repositories with queues', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1 }, ['A', 'B'])
    const grants: { repo: string; key: string; r: Reservation }[] = []
    const tickA = queueing(gov, 'A', ['a1', 'a2', 'a3'], grants)
    const tickB = queueing(gov, 'B', ['b1', 'b2', 'b3'], grants)
    await tickA() // a1 granted, a2 refused
    await tickB() // b1 refused
    for (let i = 0; i < 5; i++) {
      const holder = grants[grants.length - 1]!
      holder.r.release()
      // The holder's own completion tick races the wake, as the engine's does.
      await (holder.repo === 'A' ? tickA() : tickB())
      await gov.idle()
    }
    expect(grants.map((g) => g.key)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3'])
  })

  it('a repository at its own ceiling is skipped and does not hold the turn', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1, spendLimitUsd: 100 }, ['A', 'B', 'X'])
    gov.register('A', { spendLimitUsd: 2 })
    let releaseA: () => void = () => {}
    const aWoken = new Promise<void>((resolve) => {
      gov.subscribe('A', () => {
        resolve()
        gov.reserve({ repository: 'A', intents: one('a', 5) })
        // A's tick is slow. Had A been offered the slot, B could not have it until this ended.
        return new Promise<void>((r) => {
          releaseA = r
        })
      })
    })
    const bGranted: Reservation[] = []
    gov.subscribe('B', async () => {
      bGranted.push(...gov.reserve({ repository: 'B', intents: one('b') }).granted)
    })
    const [x] = gov.reserve({ repository: 'X', intents: one('x') }).granted
    // Both are refused by the cap, which is checked first; A's $5 request is
    // also over its own $2 ceiling, so the slot would do it no good.
    expect(gov.reserve({ repository: 'A', intents: one('a', 5) }).refusal!.limit).toBe('concurrency')
    expect(gov.reserve({ repository: 'B', intents: one('b') }).refusal!.limit).toBe('concurrency')
    x!.release() // turn order after X is A, then B
    await aWoken // A is still woken — every refused repository is — but holds nothing
    await Promise.resolve()
    await Promise.resolve()
    expect(bGranted).toHaveLength(1)
    expect(gov.snapshot().offers).toEqual({})
    releaseA()
    await gov.idle()
  })

  it('a woken repository that asks for nothing gives its offered slot back when its tick ends', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 1 }, ['X', 'A', 'B'])
    gov.subscribe('A', async () => {}) // woken, wants nothing now
    const bGrants: Reservation[] = []
    gov.subscribe('B', async () => {
      bGrants.push(...gov.reserve({ repository: 'B', intents: one('b') }).granted)
    })
    const [x] = gov.reserve({ repository: 'X', intents: one('x') }).granted
    gov.reserve({ repository: 'A', intents: one('a') })
    x!.release() // A is first in turn and is offered the slot…
    // …so B, ticking on its own trigger meanwhile, is refused for A's turn.
    expect(gov.reserve({ repository: 'B', intents: one('b') }).refusal).toMatchObject({ limit: 'turn', heldFor: 'A' })
    await gov.idle()
    // A's tick ended without taking it; B, refused for turn, got the next round.
    expect(bGrants).toHaveLength(1)
    expect(gov.snapshot().offers).toEqual({})
  })

  it('an offered slot is not held past its time-to-live, whatever the woken tick does', async () => {
    let now = T0.getTime()
    const gov = new Governor({ maxConcurrentDispatches: 1, offerTtlMs: 60_000, now: () => new Date(now) })
    for (const r of ['X', 'A', 'B']) gov.seed(r, [])
    gov.subscribe('A', () => new Promise<void>(() => {})) // a tick that never ends
    const [x] = gov.reserve({ repository: 'X', intents: one('x') }).granted
    gov.reserve({ repository: 'A', intents: one('a') })
    x!.release()
    expect(gov.reserve({ repository: 'B', intents: one('b') }).refusal!.limit).toBe('turn')
    now += 60_000
    expect(gov.reserve({ repository: 'B', intents: one('b') }).granted).toHaveLength(1)
  })

  it('a grant released without launching wakes the other waiting repositories, not its own', async () => {
    const { gov } = governor({ maxConcurrentDispatches: 0, spendLimitUsd: 4 }, ['A', 'B'])
    const woken: string[] = []
    gov.subscribe('A', async () => void woken.push('A'))
    gov.subscribe('B', async () => void woken.push('B'))
    // A has one run refused and one granted, and B one refused.
    expect(gov.reserve({ repository: 'A', intents: one('a-big', 5) }).refusal!.limit).toBe('spend')
    expect(gov.reserve({ repository: 'B', intents: one('b-big', 5) }).refusal!.limit).toBe('spend')
    const [a] = gov.reserve({ repository: 'A', intents: one('a-small', 1) }).granted
    // A's intent commit fails: nothing launched, the grant is given back.
    a!.release()
    await gov.idle()
    expect(woken).toEqual(['B']) // waking A would only have it retry the same failure at once
    expect(gov.snapshot().waiters).toContain('A') // still waiting, for the next release
    // The next release that did launch something wakes A as usual.
    const [c] = gov.reserve({ repository: 'B', intents: one('b-small', 1) }).granted
    c!.commit()
    c!.release(1)
    await gov.idle()
    expect(woken).toEqual(['B', 'A'])
  })

  it('a repository is woken at most once per interval; a wake that comes too soon is sent late, not dropped', async () => {
    // A real clock here: the interval's timer runs in real time.
    // Uncapped, with a $1 window: X holding $1 refuses A for spend.
    const gov = new Governor({ maxConcurrentDispatches: 0, spendLimitUsd: 1, minWakeIntervalMs: 150 })
    for (const r of ['X', 'A']) gov.seed(r, [])
    const wakes: number[] = []
    gov.subscribe('A', async () => {
      wakes.push(Date.now())
      gov.reserve({ repository: 'A', intents: one('a') }) // refused again: still waiting
    })
    const [x1] = gov.reserve({ repository: 'X', intents: one('x1') }).granted
    expect(gov.reserve({ repository: 'A', intents: one('a') }).refusal!.limit).toBe('spend')
    const start = Date.now()
    // X gives its grant back and takes another before A's wake runs, so A stays refused.
    x1!.release()
    const [x2] = gov.reserve({ repository: 'X', intents: one('x2') }).granted
    await Promise.resolve()
    await Promise.resolve()
    expect(wakes).toHaveLength(1)
    x2!.release() // a second release at once: A was woken moments ago
    const [x3] = gov.reserve({ repository: 'X', intents: one('x3') }).granted
    await Promise.resolve()
    await Promise.resolve()
    expect(wakes).toHaveLength(1) // held back…
    await gov.idle()
    expect(wakes).toHaveLength(2) // …and sent once the interval passed
    expect(wakes[1]! - start).toBeGreaterThanOrEqual(140)
    x3!.release()
    await gov.idle()
  })
})
