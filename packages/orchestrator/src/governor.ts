// The governor (docs/ORCHESTRATOR.md §6, docs/MULTI-REPO.md §8.2, #501): the
// one object in a process that owns the dispatch concurrency cap and the spend
// window. Every engine — and every engine's sweep scheduler — asks it for a
// slot before committing a dispatch intent, and gives the slot back on every
// path, whether the dispatch launched or not.
//
// It is a guard applied after derivation, like the engine's other guards:
// derivation stays a pure function of committed state, and the governor writes
// nothing to any repository. Everything it holds is process memory, rebuilt at
// startup from the ledgers (`seed`), and kept current by what each engine
// reports from its own ledgers when it ticks (`report`).
//
// The interface is deliberately small — register, seed, report, reserve,
// subscribe — because it is the seam a cross-install coordinator would attach
// to (#34). Nothing here knows what an engine, a run or a tick is; a
// reservation is a repository, a key and an estimate.

/** Which limit refused a reservation. */
export type GovernorLimit =
  /** The concurrency cap: every slot is taken (or the governor is still being seeded). */
  | 'concurrency'
  /** A slot is free but held for another repository's turn (round-robin). */
  | 'turn'
  /** The machine's spend window. */
  | 'spend'
  /** The repository's own spend ceiling. */
  | 'repository-spend'

/** The numbers behind a refusal, for the deferral's own words. */
export interface GovernorRefusal {
  limit: GovernorLimit
  repository: string
  /** Slots occupied across the machine when the request was refused. */
  occupied: number
  /** The concurrency cap; `0` means uncapped. */
  cap: number
  /** How many dispatches were asked for, and how many of them were granted. */
  requested: number
  granted: number
  /** The repository holding the slot, for `turn`. */
  heldFor?: string
  /** For `concurrency`: the repositories that have not yet reported their open dispatches since startup. */
  unseeded?: string[]
  /** Spend projection before this request: closed cost in the window plus open and reserved estimates. */
  projectedUsd?: number
  /** The closed share of `projectedUsd`. */
  closedUsd?: number
  /** What this request would add. */
  requestedUsd?: number
  /** The limit that refused: the machine's, or the repository's ceiling. */
  limitUsd?: number
  windowMs?: number
}

/** One dispatch asked for: its key (unique per repository while open) and estimated cost. */
export interface ReservationIntent {
  key: string
  estimateUsd: number
}

export interface ReservationRequest {
  /** A plain string naming the repository — the engine's repository key. */
  repository: string
  /**
   * The dispatches one derived action wants, in order. Partial grants are
   * legal for the cap — the ungranted ones are simply derived again later —
   * but the spend checks judge the granted prefix as a whole, as the engine
   * always has.
   */
  intents: ReservationIntent[]
}

export interface ReserveResult {
  /** A prefix of the request, possibly empty. */
  granted: Reservation[]
  /** Present when anything was refused: why, with the numbers. */
  refusal: GovernorRefusal | null
}

/**
 * A granted slot. It counts against the cap and, at its estimate, against the
 * spend window until it is released. `commit()` records that the intent
 * commit landed and the dispatch is running; `release()` gives the slot back
 * and may be called any number of times — only the first call counts.
 *
 * Releasing a committed reservation records what the dispatch cost, so the
 * spend window keeps counting it until the repository's next report shows
 * it in the ledger: pass the real cost when it is known, and the estimate is
 * used when it is not. Releasing one that was never committed records
 * nothing — no intent landed, so nothing was spent.
 */
export interface Reservation {
  readonly repository: string
  readonly key: string
  readonly estimateUsd: number
  readonly committed: boolean
  readonly released: boolean
  commit(): void
  release(costUsd?: number | null): void
}

/** A repository's own ledgers, as its engine read them on its last tick. */
export interface SpendReport {
  /** Closed ledger entries and closed sweep markers: when they opened and what they cost. */
  closed: { at: string | null; costUsd: number }[]
  /**
   * Entries still open, keyed like a reservation, at their estimate. An open
   * run ledger entry counts whenever it opened (as it always has); an open
   * sweep marker counts only while it opened inside the window, because
   * nothing ever closes the marker of a sweep whose process died.
   */
  open: { key: string; at: string | null; estimateUsd: number; kind: 'dispatch' | 'sweep' }[]
}

/**
 * An open entry found at startup. Roles are launched detached and can outlive
 * the process that launched them, so each counts as an occupied slot until
 * the repository's report shows it closed (`dispatch` entries) or `timeoutMs`
 * has passed since `at`, past which no job can still be behind it.
 */
export interface SeedEntry {
  key: string
  at: string | null
  estimateUsd: number
  timeoutMs: number
  /**
   * `dispatch` holds clear when a report no longer lists the key as open.
   * `sweep` holds clear only by timeout: nothing closes a sweep marker whose
   * process is gone, so a report can never show one closing.
   */
  kind: 'dispatch' | 'sweep'
}

export interface GovernorLimits {
  /** The most dispatches running at once across the process; `0` or negative is uncapped. Default 2. */
  maxConcurrentDispatches?: number
  /** The machine's spend limit per window, across every repository; null or absent is none. */
  spendLimitUsd?: number | null
  /** The rolling window the spend limits measure over. Default 24 hours. */
  spendWindowMs?: number
  /**
   * Budget enforcement (#109). False keeps metering (reports are still
   * accepted) but disables both spend checks, the machine's and every
   * repository's ceiling. The concurrency cap still applies: it is a resource
   * limit, not a budget. Default true.
   */
  budgetEnforcement?: boolean
}

export interface GovernorConfig extends GovernorLimits {
  /** Per-repository spend ceilings, beneath the machine's. `register` can set them too. */
  repositories?: Record<string, { spendLimitUsd?: number | null }>
  /** How long a slot is held for a woken repository whose tick has not finished. Default 2 minutes. */
  offerTtlMs?: number
  /**
   * The least time between two wakes of one repository. A wake that would
   * come sooner is sent when the interval has passed, not dropped. It bounds
   * how fast two repositories that keep releasing unlaunched grants could
   * wake each other. Default 1 second; 0 turns it off.
   */
  minWakeIntervalMs?: number
  now?: () => Date
  log?: (line: string) => void
}

/**
 * The seam (#34): what an engine needs from whatever admits its dispatches.
 * `Governor` is the in-process implementation.
 */
export interface GovernorPort {
  /** The window the spend limits measure over — engines read their ledgers back this far. */
  readonly spendWindowMs: number
  /** Make a repository known: it enters the spend sum and the round-robin, and must `seed` before anything is granted. */
  register(repository: string, opts?: { spendLimitUsd?: number | null }): void
  /** The repository's open entries at startup. Marks it seeded; additive. */
  seed(repository: string, entries: SeedEntry[]): void
  /**
   * The repository's ledgers, read by `gather`. Replaces its previous report.
   * The governor calls `gather` itself so that it knows which settlements the
   * report can have seen: those released before `gather` began. A report
   * that arrives after a newer one has been applied is ignored.
   */
  report(repository: string, gather: () => SpendReport | Promise<SpendReport>): Promise<void>
  /** Check every limit and grant or refuse, in one synchronous step. */
  reserve(request: ReservationRequest): ReserveResult
  /** Be woken when a slot this repository was refused may be free. Returns the unsubscribe. */
  subscribe(repository: string, wake: () => Promise<void>): () => void
}

/**
 * Default resource ceiling (#227). Deliberately low: the blessed topology
 * runs the engine on the operator's own workstation, and a dispatch's real
 * footprint is an agent process plus a full dependency install plus the
 * project's whole test suite. Two keeps a run pipelined without letting a
 * quiet afternoon of ready work take the machine down. Raise it on a
 * dedicated host with `--max-concurrent-dispatches`.
 */
export const DEFAULT_MAX_CONCURRENT_DISPATCHES = 2
/** The spend ceiling's rolling window (#97). */
export const DEFAULT_SPEND_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_OFFER_TTL_MS = 2 * 60 * 1000
const DEFAULT_MIN_WAKE_INTERVAL_MS = 1000

export function describeWindow(ms: number): string {
  const hours = ms / 3_600_000
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} days`
  if (hours >= 1 && Number.isInteger(hours)) return `${hours} hour${hours === 1 ? '' : 's'}`
  return `${Math.round(ms / 60_000)} min`
}

/** The engine rule a refusal defers under: MC for a slot, HB for spend. The rules' meaning is unchanged. */
export function refusalRule(r: GovernorRefusal): 'MC' | 'HB' {
  return r.limit === 'concurrency' || r.limit === 'turn' ? 'MC' : 'HB'
}

/**
 * A refusal in the words the deferral reports on the heartbeat. The MC and
 * machine-window texts are the ones the engine wrote before #501, with the
 * governor's numbers in them.
 */
export function refusalReason(r: GovernorRefusal, what: string, rederives: string): string {
  const money = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`
  const projected = (r.projectedUsd ?? 0) + (r.requestedUsd ?? 0)
  const breakdown = `(ledger ${money(r.closedUsd)} in the window + ${money(projected - (r.closedUsd ?? 0))} in flight and requested)`
  switch (r.limit) {
    case 'concurrency':
      if (r.unseeded?.length)
        return `${what} deferred — the governor grants nothing until ${r.unseeded.join(', ')} has reported its open dispatches since startup; re-derived once it has`
      return `${what} deferred — ${r.occupied} in flight against --max-concurrent-dispatches ${r.cap}; re-derived when a slot frees`
    case 'turn':
      return `${what} deferred — the free slot is held for ${r.heldFor}'s turn (round-robin between repositories under --max-concurrent-dispatches ${r.cap}); re-derived when a slot frees`
    case 'spend':
      return (
        `projected host spend ${money(projected)} over the last ${describeWindow(r.windowMs ?? DEFAULT_SPEND_WINDOW_MS)} ${breakdown} ` +
        `exceeds --spend-limit-usd $${r.limitUsd} — deferred, not paused: the window rolls and ${rederives}`
      )
    case 'repository-spend':
      return (
        `projected spend for ${r.repository} ${money(projected)} over the last ${describeWindow(r.windowMs ?? DEFAULT_SPEND_WINDOW_MS)} ${breakdown} ` +
        `exceeds that repository's own ceiling $${r.limitUsd} — deferred, not paused: the window rolls and ${rederives}`
      )
  }
}

interface RepoState {
  spendLimitUsd: number | null
  seeded: boolean
  report: SpendReport | null
  /** The sequence number taken when the applied report began gathering. */
  reportSeq: number
  /**
   * Dispatches that settled after the applied report began gathering. The
   * report cannot be relied on to show them — it may have been read before
   * the intent commit — so the governor counts them itself until a report
   * that began after their release replaces them.
   */
  settled: { key: string; amountUsd: number; seq: number }[]
}

interface Hold {
  repository: string
  key: string
  estimateUsd: number
  expiresAt: number
  kind: 'dispatch' | 'sweep'
}

interface Offer {
  slots: number
  expiresAt: number
}

class Slot implements Reservation {
  private state: 'granted' | 'committed' | 'released' = 'granted'
  private readonly onRelease: (slot: Slot, wasCommitted: boolean, costUsd: number | null) => void
  readonly repository: string
  readonly key: string
  readonly estimateUsd: number
  // No parameter properties: the packages run from source under Node's
  // type stripping, which does not support them.
  constructor(
    onRelease: (slot: Slot, wasCommitted: boolean, costUsd: number | null) => void,
    repository: string,
    key: string,
    estimateUsd: number,
  ) {
    this.onRelease = onRelease
    this.repository = repository
    this.key = key
    this.estimateUsd = estimateUsd
  }
  get committed(): boolean {
    return this.state === 'committed'
  }
  get released(): boolean {
    return this.state === 'released'
  }
  commit(): void {
    if (this.state === 'granted') this.state = 'committed'
  }
  release(costUsd?: number | null): void {
    if (this.state === 'released') return
    const wasCommitted = this.state === 'committed'
    this.state = 'released'
    this.onRelease(this, wasCommitted, typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : null)
  }
}

export class Governor implements GovernorPort {
  readonly spendWindowMs: number
  private readonly limits: GovernorLimits
  private readonly cfg: GovernorConfig
  /** Insertion order is registration order — the round-robin's ring. */
  private readonly repos = new Map<string, RepoState>()
  private readonly live = new Set<Slot>()
  private readonly holds = new Map<string, Hold>()
  /** Repositories refused since they were last woken, with what they last asked for. */
  private readonly waiters = new Map<string, { limit: GovernorLimit; requestedUsd: number }>()
  private readonly offers = new Map<string, Offer>()
  private readonly subscribers = new Map<string, Set<() => Promise<void>>>()
  /** The repository most recently granted a slot; the next offer goes to the one after it. */
  private lastServed: string | null = null
  /** Wakes sent and not yet finished. */
  private outstanding = 0
  private idleWaiters: (() => void)[] = []
  /** Orders releases against the start of each report's gathering. */
  private seq = 0
  /** When each repository was last woken, and the timer holding back a wake that came too soon. */
  private readonly lastWake = new Map<string, number>()
  private readonly wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(cfg: GovernorConfig = {}) {
    this.cfg = cfg
    this.limits = cfg
    this.spendWindowMs = cfg.spendWindowMs ?? DEFAULT_SPEND_WINDOW_MS
    for (const [repository, opts] of Object.entries(cfg.repositories ?? {})) this.register(repository, opts)
  }

  private now(): number {
    return (this.cfg.now?.() ?? new Date()).getTime()
  }

  private cap(): number {
    return this.limits.maxConcurrentDispatches ?? DEFAULT_MAX_CONCURRENT_DISPATCHES
  }

  private enforcing(): boolean {
    return this.limits.budgetEnforcement !== false
  }

  register(repository: string, opts: { spendLimitUsd?: number | null } = {}): void {
    const known = this.repos.get(repository)
    if (known) {
      if (opts.spendLimitUsd !== undefined) known.spendLimitUsd = opts.spendLimitUsd
      return
    }
    this.repos.set(repository, { spendLimitUsd: opts.spendLimitUsd ?? null, seeded: false, report: null, reportSeq: -1, settled: [] })
  }

  seed(repository: string, entries: SeedEntry[]): void {
    this.register(repository)
    const now = this.now()
    for (const e of entries) {
      const at = e.at ? Date.parse(e.at) : Number.NaN
      // An entry the governor cannot date holds its slot for one full timeout
      // from now: a fact it cannot date is not a reason to over-admit.
      const expiresAt = (Number.isNaN(at) ? now : at) + e.timeoutMs
      if (expiresAt <= now) continue
      this.holds.set(holdKey(repository, e.key), { repository, key: e.key, estimateUsd: e.estimateUsd, expiresAt, kind: e.kind })
    }
    const repo = this.repos.get(repository)!
    const wasSeeded = repo.seeded
    repo.seeded = true
    if (!wasSeeded) this.freed()
  }

  async report(repository: string, gather: () => SpendReport | Promise<SpendReport>): Promise<void> {
    this.register(repository)
    // Every settlement released before this point closed its ledger entry
    // before it was released (the closing commit comes first), so the ledger
    // `gather` reads from here on shows it. Settlements after this point may
    // or may not be in what it reads; they stay counted by the governor.
    const asOf = this.seq++
    const report = await gather()
    const repo = this.repos.get(repository)!
    if (asOf < repo.reportSeq) return // a newer report was applied while this one was gathering
    repo.report = report
    repo.reportSeq = asOf
    repo.settled = repo.settled.filter((s) => s.seq > asOf)
    const open = new Set(report.open.map((e) => e.key))
    let freed = false
    for (const [k, hold] of this.holds) {
      if (hold.repository === repository && hold.kind === 'dispatch' && !open.has(hold.key)) {
        this.holds.delete(k)
        freed = true
      }
    }
    if (this.expire() || freed) this.freed()
  }

  subscribe(repository: string, wake: () => Promise<void>): () => void {
    let set = this.subscribers.get(repository)
    if (!set) {
      set = new Set()
      this.subscribers.set(repository, set)
    }
    set.add(wake)
    return () => {
      this.subscribers.get(repository)?.delete(wake)
    }
  }

  /**
   * Check the cap, the machine's spend window and the repository's ceiling,
   * and grant or refuse. Synchronous on purpose: there is no await between
   * the check and the grant, so two engines asking for the last slot in the
   * same instant cannot both be told yes.
   */
  reserve(request: ReservationRequest): ReserveResult {
    const { repository, intents } = request
    // Two dispatches under one key would be two jobs the governor could only
    // tell apart by object: counted once in the spend sum, and one of them
    // never matched to its ledger entry. The engine keys by run, role, task
    // and round, so this is a caller's bug; say which key.
    const seen = new Set<string>()
    for (const intent of intents) {
      if (seen.has(intent.key)) throw new Error(`governor: one request names the key "${intent.key}" twice for ${repository} — each dispatch needs its own key`)
      seen.add(intent.key)
    }
    if (!this.repos.has(repository)) {
      // A caller that never registered has nothing of its own to seed (a
      // stand-alone scheduler): known from now on, and seeded.
      this.register(repository)
      this.repos.get(repository)!.seeded = true
    }
    if (this.expire()) this.freed()

    const cap = this.cap()
    const occupied = this.occupied()
    const base = { repository, occupied, cap, requested: intents.length, granted: 0 }
    const askedUsd = intents.reduce((sum, i) => sum + i.estimateUsd, 0)
    const unseeded = [...this.repos].filter(([, r]) => !r.seeded).map(([name]) => name)
    if (unseeded.length > 0) return this.refuse({ ...base, limit: 'concurrency', unseeded }, askedUsd)

    let othersOffered = 0
    let heldFor: string | undefined
    for (const [name, offer] of this.offers) {
      if (name === repository) continue
      othersOffered += offer.slots
      heldFor ??= name
    }
    // A dispatch whose key matches a startup hold takes over that hold's slot
    // rather than needing a new one: derivation only asks for a key it reads
    // as not in flight, so the entry the hold stood for has closed in the
    // record even if no report has said so yet. The hold is removed only if
    // the request is granted.
    const takesOver = (key: string) => this.holds.has(holdKey(repository, key))
    let n = 0
    if (cap <= 0) n = intents.length
    else {
      let used = occupied + othersOffered
      for (const intent of intents) {
        const extra = takesOver(intent.key) ? 0 : 1
        if (used + extra > cap) break
        used += extra
        n++
      }
    }
    if (n === 0) {
      const turn = cap > 0 && cap - occupied > 0 && othersOffered > 0
      return this.refuse(turn ? { ...base, limit: 'turn', heldFor } : { ...base, limit: 'concurrency' }, askedUsd)
    }

    const take = intents.slice(0, n)
    const superseded = new Set(take.filter((i) => takesOver(i.key)).map((i) => i.key))
    if (this.enforcing()) {
      const requestedUsd = take.reduce((sum, i) => sum + i.estimateUsd, 0)
      const windowMs = this.spendWindowMs
      if (this.limits.spendLimitUsd != null) {
        const { closed, open } = this.machineSpend(repository, superseded)
        if (closed + open + requestedUsd > this.limits.spendLimitUsd)
          return this.refuse(
            { ...base, limit: 'spend', projectedUsd: closed + open, closedUsd: closed, requestedUsd, limitUsd: this.limits.spendLimitUsd, windowMs },
            requestedUsd,
          )
      }
      const ceiling = this.repos.get(repository)!.spendLimitUsd
      if (ceiling != null) {
        const { closed, open } = this.repoSpend(repository, superseded)
        if (closed + open + requestedUsd > ceiling)
          return this.refuse(
            { ...base, limit: 'repository-spend', projectedUsd: closed + open, closedUsd: closed, requestedUsd, limitUsd: ceiling, windowMs },
            requestedUsd,
          )
      }
    }

    for (const key of superseded) this.holds.delete(holdKey(repository, key))
    const granted = take.map((i) => {
      const slot = new Slot(this.released, repository, i.key, i.estimateUsd)
      this.live.add(slot)
      return slot
    })
    const offer = this.offers.get(repository)
    if (offer) {
      offer.slots -= n
      if (offer.slots <= 0) this.offers.delete(repository)
    }
    this.lastServed = repository
    if (n === intents.length) return { granted, refusal: null }
    // The rest of the request did not fit under the cap: this repository is
    // waiting as surely as one refused outright.
    this.waiters.set(repository, { limit: 'concurrency', requestedUsd: intents.slice(n).reduce((sum, i) => sum + i.estimateUsd, 0) })
    return { granted, refusal: { ...base, granted: n, limit: 'concurrency' } }
  }

  /**
   * Called by a reservation the first time it is released.
   *
   * A committed reservation was a running dispatch: its cost is kept (the
   * real cost when the caller knows it, otherwise the estimate) until a
   * report that began after this release replaces it, so the dispatch never
   * drops out of the spend window between settling and being read back.
   *
   * One that was never committed launched nothing. Waking its own repository
   * would only have it retry the same failed grant at once — a loop the
   * heartbeat used to pace — so it wakes every other waiting repository and
   * leaves its own waiting for the next release.
   */
  private readonly released = (slot: Slot, wasCommitted: boolean, costUsd: number | null): void => {
    if (!this.live.delete(slot)) return
    if (wasCommitted) {
      this.repos.get(slot.repository)?.settled.push({ key: slot.key, amountUsd: costUsd ?? slot.estimateUsd, seq: this.seq++ })
      this.freed()
    } else this.freed(slot.repository)
  }

  /** Slots occupied: live reservations plus startup holds still standing. */
  occupied(): number {
    return this.live.size + this.holds.size
  }

  /**
   * What the governor holds right now, for the heartbeat and for tests. The
   * counts are read from the same maps `reserve` reads, never recomputed.
   */
  snapshot(): {
    occupied: number
    reservations: number
    uncommitted: number
    uncommittedUsd: number
    holds: number
    /** Settled dispatches counted by the governor until a report replaces them. */
    settled: number
    offers: Record<string, number>
    waiters: string[]
  } {
    const uncommitted = [...this.live].filter((s) => !s.committed)
    return {
      occupied: this.occupied(),
      reservations: this.live.size,
      uncommitted: uncommitted.length,
      uncommittedUsd: uncommitted.reduce((sum, s) => sum + s.estimateUsd, 0),
      holds: this.holds.size,
      settled: [...this.repos.values()].reduce((n, r) => n + r.settled.length, 0),
      offers: Object.fromEntries([...this.offers].map(([k, o]) => [k, o.slots])),
      waiters: [...this.waiters.keys()],
    }
  }

  /** Spend in the window across every registered repository: closed cost and open or reserved estimates. */
  machineSpend(requester?: string, superseded?: ReadonlySet<string>): { closed: number; open: number } {
    let closed = 0
    let open = 0
    for (const name of this.repos.keys()) {
      const s = this.repoSpend(name, name === requester ? superseded : undefined)
      closed += s.closed
      open += s.open
    }
    return { closed, open }
  }

  /**
   * One repository's spend in the window. Closed entries opened inside the
   * window at their real cost (an undated one counts — the ceiling bounds
   * unattended spend, and a fact it cannot date is not a reason to spend
   * more), plus dispatches that settled since the report began gathering, at
   * the cost they were released with. Then entries still open at their
   * estimate, and the governor's own reservations and startup holds at
   * theirs. Those are joined by key, so a dispatch whose intent has landed
   * in the ledger is counted once however the report and the reservation
   * overlap, and an entry the report still lists open but that has since
   * settled counts only as settled. `superseded` names holds a request is
   * about to take over, so their estimate is not counted beside the
   * request's own.
   */
  repoSpend(repository: string, superseded?: ReadonlySet<string>): { closed: number; open: number } {
    const since = this.now() - this.spendWindowMs
    const inWindow = (at: string | null) => {
      const t = at ? Date.parse(at) : Number.NaN
      return Number.isNaN(t) || t >= since
    }
    const state = this.repos.get(repository)
    const report = state?.report
    let closed = 0
    for (const e of report?.closed ?? []) if (inWindow(e.at)) closed += e.costUsd
    const settledKeys = new Set<string>()
    for (const s of state?.settled ?? []) {
      closed += s.amountUsd
      settledKeys.add(s.key)
    }
    const byKey = new Map<string, number>()
    for (const e of report?.open ?? []) {
      if (e.kind === 'sweep' && !inWindow(e.at)) continue
      if (settledKeys.has(e.key) || superseded?.has(e.key)) continue
      byKey.set(e.key, e.estimateUsd)
    }
    for (const hold of this.holds.values())
      if (hold.repository === repository && !superseded?.has(hold.key)) byKey.set(hold.key, hold.estimateUsd)
    for (const slot of this.live) if (slot.repository === repository) byKey.set(slot.key, slot.estimateUsd)
    let open = 0
    for (const v of byKey.values()) open += v
    return { closed, open }
  }

  /** Resolves once every wake sent has finished. For tests and orderly shutdown. */
  idle(): Promise<void> {
    if (this.outstanding === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private refuse(refusal: GovernorRefusal, requestedUsd: number): ReserveResult {
    this.waiters.set(refusal.repository, { limit: refusal.limit, requestedUsd })
    return { granted: [], refusal }
  }

  /** Drop startup holds and offers whose time is up. True when a slot came free. */
  private expire(): boolean {
    const now = this.now()
    let freed = false
    for (const [k, hold] of this.holds) {
      if (hold.expiresAt <= now) {
        this.holds.delete(k)
        freed = true
      }
    }
    for (const [name, offer] of this.offers) {
      if (offer.expiresAt <= now) {
        this.offers.delete(name)
        freed = true
      }
    }
    return freed
  }

  /**
   * The waiting repositories in round-robin order: registration order,
   * starting after the repository most recently served.
   */
  private fairOrder(waiting: string[]): string[] {
    const ring = [...this.repos.keys()]
    const start = this.lastServed === null ? 0 : ring.indexOf(this.lastServed) + 1
    const rotated = [...ring.slice(start), ...ring.slice(0, start)]
    const set = new Set(waiting)
    return rotated.filter((name) => set.has(name))
  }

  /** A repository whose own ceiling would refuse, right now, what it last asked for. */
  private atOwnCeiling(repository: string, requestedUsd: number): boolean {
    if (!this.enforcing()) return false
    const ceiling = this.repos.get(repository)?.spendLimitUsd
    if (ceiling == null) return false
    const { closed, open } = this.repoSpend(repository)
    return closed + open + requestedUsd > ceiling
  }

  private offeredSlots(): number {
    let n = 0
    for (const offer of this.offers.values()) n += offer.slots
    return n
  }

  /**
   * A slot may have come free — a release, a startup hold cleared or timed
   * out, an offer given back, the last repository seeded. Wake every
   * repository refused since it was last woken.
   *
   * The free slots are offered, one each, to the waiting repositories that
   * were refused a slot, in round-robin order: registration order, starting
   * after the repository most recently granted one. A repository whose own
   * ceiling would refuse it is skipped, so it does not hold the turn. An
   * offered slot is held for that repository until its woken tick finishes,
   * so a neighbour ticking on its own trigger meanwhile cannot take it — and
   * is refused for `turn`, which makes it a waiter for the next offer.
   *
   * All of that bookkeeping is synchronous, inside the call that freed the
   * slot, so no reservation can slip in between. The wakes run on a later
   * microtask, never re-entrantly. A woken repository that leaves its offer
   * unused gives the slot back, which is itself a slot coming free. That
   * cannot cycle: a repository holding an offer is never refused a slot, so
   * giving one back never makes it a waiter for the next.
   *
   * Two repositories are held back rather than woken, and stay waiting:
   * `exclude` (the repository whose own grant was just released without
   * launching — waking it would have it retry the same failure at once), and
   * one woken less than `minWakeIntervalMs` ago, which is woken by a timer
   * once the interval has passed. The interval bounds a loop the exclusion
   * cannot see: two repositories whose grants keep failing, each release
   * waking the other.
   */
  private freed(exclude?: string): void {
    if (this.waiters.size === 0) return
    // Nothing is granted until every repository has seeded; waking now would
    // only earn the same refusal. The last `seed` calls this again.
    if ([...this.repos.values()].some((r) => !r.seeded)) return
    const waiting = new Map(this.waiters)
    this.waiters.clear()
    const cap = this.cap()
    let free = cap <= 0 ? Number.POSITIVE_INFINITY : cap - this.occupied() - this.offeredSlots()
    const now = this.now()
    const interval = this.cfg.minWakeIntervalMs ?? DEFAULT_MIN_WAKE_INTERVAL_MS
    for (const repository of this.fairOrder([...waiting.keys()])) {
      const wakes = [...(this.subscribers.get(repository) ?? [])]
      // Nobody to wake (a one-shot tick): it asks again on its own next pass.
      if (wakes.length === 0) continue
      const last = waiting.get(repository)!
      if (repository === exclude) {
        this.keepWaiting(repository, last)
        continue
      }
      const woken = this.lastWake.get(repository)
      if (interval > 0 && woken !== undefined && now - woken < interval) {
        this.keepWaiting(repository, last)
        this.wakeLater(repository, interval - (now - woken))
        continue
      }
      this.lastWake.set(repository, now)
      const wantsSlot = last.limit === 'concurrency' || last.limit === 'turn'
      let offer: Offer | null = null
      if (wantsSlot && cap > 0 && free > 0 && !this.offers.has(repository) && !this.atOwnCeiling(repository, last.requestedUsd)) {
        offer = { slots: 1, expiresAt: this.now() + (this.cfg.offerTtlMs ?? DEFAULT_OFFER_TTL_MS) }
        this.offers.set(repository, offer)
        free--
      }
      this.outstanding++
      void Promise.allSettled(wakes.map((wake) => Promise.resolve().then(wake))).then(() => {
        this.outstanding--
        if (offer && this.offers.get(repository) === offer) {
          this.offers.delete(repository)
          this.freed()
        }
        this.settleIdle()
      })
    }
  }

  /** Keep a repository waiting, unless it was refused again meanwhile (that newer refusal wins). */
  private keepWaiting(repository: string, last: { limit: GovernorLimit; requestedUsd: number }): void {
    if (!this.waiters.has(repository)) this.waiters.set(repository, last)
  }

  /** Wake a repository once `delayMs` has passed, however many wakes asked for it meanwhile. */
  private wakeLater(repository: string, delayMs: number): void {
    if (this.wakeTimers.has(repository)) return
    this.outstanding++
    const timer = setTimeout(() => {
      this.wakeTimers.delete(repository)
      this.lastWake.delete(repository) // the interval has passed, whatever the governor's own clock says
      this.outstanding--
      this.freed()
      this.settleIdle()
    }, Math.max(delayMs, 0))
    // A pending wake must not keep the process alive on its own.
    ;(timer as { unref?: () => void }).unref?.()
    this.wakeTimers.set(repository, timer)
  }

  private settleIdle(): void {
    if (this.outstanding === 0) for (const resolve of this.idleWaiters.splice(0)) resolve()
  }
}

function holdKey(repository: string, key: string): string {
  return `${repository}\u0000${key}`
}
