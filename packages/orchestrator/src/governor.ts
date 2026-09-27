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
// The interface is deliberately small — register, unregister, seed, report,
// reserve, subscribe — because it is the seam a cross-install coordinator would attach
// to (#34). Nothing here knows what an engine, a run or a tick is; a
// reservation is a repository, a key and an estimate.

import { repositoryIdKey } from '@gateline/core/sources'

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
  /**
   * The repository was unregistered — its engine stopped — and has not been
   * registered again (#502). Nothing is granted to it: a stopped engine's
   * straggling pass must not dispatch, least of all past the ceiling that
   * left with its registration.
   */
  | 'unregistered'

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
  /**
   * Display names for the repositories this refusal names (`repository`,
   * `heldFor`, `unseeded`), keyed by repository key (#502). The refusal's
   * words use them; a key with no display name is written as itself.
   */
  names?: Record<string, string>
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
  /** A run dispatch (the default) or a sweep — which report entries the governor matches it against. */
  kind?: 'dispatch' | 'sweep'
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
  /** The `at` of the ledger entry (or sweep marker) the intent commit wrote, once committed. */
  readonly ledgerAt: string | null
  /**
   * The intent commit landed. `ledgerAt` is the `at` it wrote on the ledger
   * entry or sweep marker: with the key, it is how the governor recognises
   * this dispatch among a report's closed entries, and so never counts it
   * twice. A retry reuses its key, so the key alone would not do.
   */
  commit(ledgerAt?: string | null): void
  release(costUsd?: number | null): void
}

/** A repository's own ledgers, as its engine read them on its last tick. */
export interface SpendReport {
  /**
   * Closed ledger entries and closed sweep markers: when they opened and what
   * they cost. `key` and `at` together name the dispatch, so the governor can
   * see that a settlement it still holds, or a live reservation whose close
   * has landed but not yet been released, is already in this list.
   */
  closed: { key?: string; at: string | null; costUsd: number; kind?: 'dispatch' | 'sweep' }[]
  /**
   * Entries still open, keyed like a reservation, at their estimate. An open
   * run ledger entry counts whenever it opened (as it always has); an open
   * sweep marker counts only while it opened inside the window, because
   * nothing ever closes the marker of a sweep whose process died.
   */
  open: {
    key: string
    at: string | null
    estimateUsd: number
    kind: 'dispatch' | 'sweep'
    /**
     * The process that opened it is gone from this machine (#502): the entry
     * still counts toward spend at its estimate, but it holds no slot, so a
     * startup hold under this key is cleared. Used for sweep markers, which
     * nothing closes when their process dies. Default false.
     */
    lost?: boolean
  }[]
  /**
   * False when the sweep markers could not be read this time. The governor
   * then keeps the sweep entries of the previous report and the sweep
   * settlements it holds, rather than dropping them for a tick. Default true.
   */
  sweepsRead?: boolean
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
  /**
   * Make a repository known: it enters the spend sum and the round-robin, and
   * must `seed` before anything is granted. `displayName` is how the refusal
   * words name it (#502); the key is used when there is none.
   */
  register(repository: string, opts?: { spendLimitUsd?: number | null; displayName?: string }): void
  /**
   * Forget a repository (#502), for an engine that has stopped. Its live
   * reservations and startup holds are released, and it leaves the
   * round-robin and the seed gate. What it spent inside the window keeps
   * counting against the machine's window until the window rolls past it:
   * the money was spent whether or not its engine still runs.
   */
  unregister(repository: string, opts?: { uncounted?: boolean }): void
  /** The registered repositories that have not yet seeded — the ones the seed gate is waiting on. */
  unseeded(): string[]
  /** Whether the repository is registered now (not unregistered, not unknown). */
  registered(repository: string): boolean
  /**
   * The repositories the machine's spend window is not counting (#502): each
   * was unregistered after its startup seed failed or timed out, before it
   * ever reported, so what it spent in the window is unknown to the governor
   * until it seeds. Empty unless a machine spend limit is enforced, since only
   * then is anything decided on that sum.
   */
  uncounted(): string[]
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
  return r.limit === 'concurrency' || r.limit === 'turn' || r.limit === 'unregistered' ? 'MC' : 'HB'
}

/**
 * A refusal in the words the deferral reports on the heartbeat. The MC and
 * machine-window texts are the ones the engine wrote before #501, with the
 * governor's numbers in them.
 */
export function refusalReason(r: GovernorRefusal, what: string, rederives: string): string {
  const money = (n: number | undefined) => `$${(n ?? 0).toFixed(2)}`
  const name = (key: string | undefined) => (key === undefined ? '' : (r.names?.[key] ?? key))
  const projected = (r.projectedUsd ?? 0) + (r.requestedUsd ?? 0)
  const breakdown = `(ledger ${money(r.closedUsd)} in the window + ${money(projected - (r.closedUsd ?? 0))} in flight and requested)`
  switch (r.limit) {
    case 'concurrency':
      if (r.unseeded?.length)
        return `${what} deferred — the governor grants nothing until ${r.unseeded.map(name).join(', ')} has counted its open dispatches and reported its spend since startup; re-derived once it has`
      return `${what} deferred — ${r.occupied} in flight against --max-concurrent-dispatches ${r.cap}; re-derived when a slot frees`
    case 'turn':
      return `${what} deferred — the free slot is held for ${name(r.heldFor)}'s turn (round-robin between repositories under --max-concurrent-dispatches ${r.cap}); re-derived when a slot frees`
    case 'spend':
      return (
        `projected host spend ${money(projected)} over the last ${describeWindow(r.windowMs ?? DEFAULT_SPEND_WINDOW_MS)} ${breakdown} ` +
        `exceeds --spend-limit-usd $${r.limitUsd} — deferred, not paused: the window rolls and ${rederives}`
      )
    case 'repository-spend':
      return (
        `projected spend for ${name(r.repository)} ${money(projected)} over the last ${describeWindow(r.windowMs ?? DEFAULT_SPEND_WINDOW_MS)} ${breakdown} ` +
        `exceeds that repository's own ceiling $${r.limitUsd} — deferred, not paused: the window rolls and ${rederives}`
      )
    case 'unregistered':
      return `${what} not admitted — ${name(r.repository)} has left the governor (its engine stopped); nothing is granted to it until it registers again`
  }
}

interface RepoState {
  /** The repository as it was first registered, for what the governor says; its key is lowercased (#502). */
  label: string
  spendLimitUsd: number | null
  /** How refusal words name this repository (#502); absent, its key. */
  displayName: string | null
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
  settled: Settled[]
}

interface Settled {
  key: string
  amountUsd: number
  seq: number
  /** When it settled, by the governor's clock: it leaves the window like any closed entry. */
  settledAt: number
  /** The `at` its intent commit wrote, for recognising it among a report's closed entries. */
  ledgerAt: string | null
  kind: 'dispatch' | 'sweep'
}

/** A dispatch's identity in the ledger: its key and the `at` of the entry its intent commit opened. */
const ledgerId = (key: string, at: string | null) => `${key}\u0000${at ?? ''}`

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

/**
 * Spend an unregistered repository left behind (#502): a closed amount, and
 * when it counts from. It stays in the machine's window until the window
 * rolls past it, because the money was spent whether or not the engine that
 * spent it still runs.
 */
interface Retired {
  repository: string
  amountUsd: number
  atMs: number
}

class Slot implements Reservation {
  private state: 'granted' | 'committed' | 'released' = 'granted'
  private readonly onRelease: (slot: Slot, wasCommitted: boolean, costUsd: number | null) => void
  readonly repository: string
  /** The governor's key for the repository: `repositoryIdKey` of it (#502). */
  readonly repoKey: string
  readonly key: string
  readonly estimateUsd: number
  readonly kind: 'dispatch' | 'sweep'
  ledgerAt: string | null = null
  // No parameter properties: the packages run from source under Node's
  // type stripping, which does not support them.
  constructor(
    onRelease: (slot: Slot, wasCommitted: boolean, costUsd: number | null) => void,
    repository: string,
    repoKey: string,
    key: string,
    estimateUsd: number,
    kind: 'dispatch' | 'sweep',
  ) {
    this.onRelease = onRelease
    this.repository = repository
    this.repoKey = repoKey
    this.key = key
    this.estimateUsd = estimateUsd
    this.kind = kind
  }
  get committed(): boolean {
    return this.state === 'committed'
  }
  get released(): boolean {
    return this.state === 'released'
  }
  commit(ledgerAt?: string | null): void {
    if (this.state !== 'granted') return
    this.state = 'committed'
    this.ledgerAt = ledgerAt ?? null
  }
  release(costUsd?: number | null): void {
    if (this.state === 'released') return
    const wasCommitted = this.state === 'committed'
    this.state = 'released'
    // A cost that is not a finite, non-negative number is no cost at all:
    // the estimate stands in, as for a close that could not meter.
    const known = typeof costUsd === 'number' && Number.isFinite(costUsd) && costUsd >= 0 ? costUsd : null
    this.onRelease(this, wasCommitted, known)
  }
  /** Released by `unregister`, which has already accounted for it: a later `release()` does nothing. */
  revoke(): void {
    this.state = 'released'
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
  /** What unregistered repositories spent inside the window (#502). */
  private retired: Retired[] = []
  /**
   * Repositories unregistered and not registered again (#502). `reserve` refuses
   * them and `report` and `seed` ignore them, so nothing a stopped engine does
   * late can bring its repository back — without its ceiling — by the side door
   * that makes an unknown repository known.
   */
  private readonly tombstones = new Map<string, { label: string; displayName: string | null }>()
  /** Tombstoned repositories whose spend the window does not count — see `uncounted` (#502). */
  private readonly uncountedKeys = new Set<string>()

  constructor(cfg: GovernorConfig = {}) {
    this.cfg = cfg
    this.limits = cfg
    this.spendWindowMs = cfg.spendWindowMs ?? DEFAULT_SPEND_WINDOW_MS
    for (const [repository, opts] of Object.entries(cfg.repositories ?? {})) this.register(repository, opts)
  }

  private now(): number {
    return (this.cfg.now?.() ?? new Date()).getTime()
  }

  /**
   * The governor's key for a repository (#502): lowercased, as core's
   * `repositoryIdKey` compares ids, so two spellings of one id are one
   * repository here as they are to the duplicate check. The first spelling
   * registered is kept for what the governor says.
   */
  private key(repository: string): string {
    return repositoryIdKey(repository)
  }

  /** The label a refusal carries for a key: the spelling it was registered under. */
  private labelOf(key: string): string {
    return this.repos.get(key)?.label ?? this.tombstones.get(key)?.label ?? key
  }

  private cap(): number {
    return this.limits.maxConcurrentDispatches ?? DEFAULT_MAX_CONCURRENT_DISPATCHES
  }

  private enforcing(): boolean {
    return this.limits.budgetEnforcement !== false
  }

  register(label: string, opts: { spendLimitUsd?: number | null; displayName?: string } = {}): void {
    const repository = this.key(label)
    this.tombstones.delete(repository)
    this.uncountedKeys.delete(repository)
    const known = this.repos.get(repository)
    if (known) {
      if (opts.spendLimitUsd !== undefined) known.spendLimitUsd = opts.spendLimitUsd
      if (opts.displayName !== undefined) known.displayName = opts.displayName
      return
    }
    this.repos.set(repository, {
      label,
      spendLimitUsd: opts.spendLimitUsd ?? null,
      displayName: opts.displayName ?? null,
      seeded: false,
      report: null,
      reportSeq: -1,
      settled: [],
    })
  }

  /**
   * Forget a repository whose engine has stopped (#502).
   *
   * Slots and the seed gate are freed. Its live reservations are released
   * (a later `release()` of one does nothing), its startup holds and any slot
   * offered to it are dropped, it leaves the round-robin — the turn passes to
   * the repository after it — and the governor no longer waits for it to
   * seed. Every repository refused meanwhile is woken.
   *
   * Money is not. What it spent inside the window was real, and dropping it
   * would let the others spend the machine's window twice over. So its
   * closed entries and settlements in the window stay in the machine's sum at
   * what they cost, and leave it as the window rolls past them, exactly as
   * they would have. Entries still open, holds and live reservations stay in
   * the sum at their estimate, dated now: a detached role may still be
   * running, and its cost is not known. An undated closed entry is dated now
   * too, so it leaves the window one window from now rather than never.
   *
   * None of it counts toward the repository's own ceiling, which is gone
   * with it. If the repository registers again, its first report replaces
   * what it left behind, since that report reads the same ledgers.
   */
  unregister(label: string, opts: { uncounted?: boolean } = {}): void {
    const repository = this.key(label)
    this.tombstones.set(repository, {
      label: this.repos.get(repository)?.label ?? this.tombstones.get(repository)?.label ?? label,
      displayName: this.repos.get(repository)?.displayName ?? this.tombstones.get(repository)?.displayName ?? null,
    })
    if (opts.uncounted) this.uncountedKeys.add(repository)
    const repo = this.repos.get(repository)
    if (!repo) return
    const now = this.now()
    const since = now - this.spendWindowMs
    const { closed, open } = this.spendItems(repository)
    for (const c of closed) {
      const atMs = c.atMs ?? now
      if (atMs >= since) this.retired.push({ repository, amountUsd: c.amountUsd, atMs })
    }
    for (const amountUsd of open.values()) this.retired.push({ repository, amountUsd, atMs: now })

    for (const slot of [...this.live]) {
      if (slot.repoKey !== repository) continue
      this.live.delete(slot)
      slot.revoke()
    }
    for (const [k, hold] of this.holds) if (hold.repository === repository) this.holds.delete(k)
    this.offers.delete(repository)
    this.waiters.delete(repository)
    this.subscribers.delete(repository)
    this.lastWake.delete(repository)
    const timer = this.wakeTimers.get(repository)
    if (timer) {
      clearTimeout(timer)
      this.wakeTimers.delete(repository)
      this.outstanding--
    }
    if (this.lastServed === repository) {
      // The turn passes to the repository after it, as if it had just been served.
      const ring = [...this.repos.keys()]
      const i = ring.indexOf(repository)
      this.lastServed = ring.length <= 1 ? null : ring[(i - 1 + ring.length) % ring.length]!
    }
    this.repos.delete(repository)
    this.settleIdle()
    this.freed()
  }

  /** How messages name a repository: its display name, or its key. */
  private displayOf(label: string): string {
    const repository = this.key(label)
    return this.repos.get(repository)?.displayName ?? this.tombstones.get(repository)?.displayName ?? this.labelOf(repository)
  }

  unseeded(): string[] {
    return [...this.repos.values()].filter((r) => !r.seeded).map((r) => r.label)
  }

  registered(repository: string): boolean {
    return this.repos.has(this.key(repository))
  }

  uncounted(): string[] {
    if (!this.enforcing() || this.limits.spendLimitUsd == null) return []
    return [...this.uncountedKeys].map((k) => this.labelOf(k))
  }

  /** Display names for the given repository keys, for a refusal's words; undefined when none has one. */
  private namesFor(keys: (string | undefined)[]): Record<string, string> | undefined {
    const names: Record<string, string> = {}
    for (const key of keys) {
      const k = key === undefined ? undefined : this.key(key)
      const displayName = k === undefined ? null : (this.repos.get(k)?.displayName ?? this.tombstones.get(k)?.displayName ?? null)
      if (key !== undefined && displayName !== null) names[key] = displayName
    }
    return Object.keys(names).length > 0 ? names : undefined
  }

  seed(label: string, entries: SeedEntry[]): void {
    const repository = this.key(label)
    // An unregistered repository comes back only by an explicit `register` (#502).
    if (this.tombstones.has(repository)) return
    this.register(label)
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

  async report(label: string, gather: () => SpendReport | Promise<SpendReport>): Promise<void> {
    const repository = this.key(label)
    // A stopped engine's late pass reports nothing (#502): the repository was
    // unregistered and comes back only by an explicit `register`. Its gather is
    // not run either.
    if (this.tombstones.has(repository)) {
      this.cfg.log?.(`governor: ignoring a report for ${this.displayOf(repository)}, which has left the governor (its engine stopped)`)
      return
    }
    this.register(label)
    // A settlement released before this point had its closing commit written
    // first, or its close gave up without writing. Either way the ledger
    // `gather` reads from here on accounts for it: as closed, or as still
    // open at its estimate. Settlements after this point may or may not be in
    // what it reads; they stay counted by the governor, and the ones this
    // report shows closed are recognised by key and `at` and counted once.
    const asOf = this.seq++
    const gathered = await gather()
    // Unregistered while it gathered (#502): the report belongs to nobody now.
    const repo = this.repos.get(repository)
    if (!repo || this.tombstones.has(repository)) return
    if (asOf < repo.reportSeq) return // a newer report was applied while this one was gathering
    // Sweep markers that could not be read this time are not evidence that
    // there are none: keep the last report's sweep entries and the sweep
    // settlements the governor holds, rather than undercount for a tick.
    const sweepsRead = gathered.sweepsRead !== false
    const report: SpendReport =
      sweepsRead || !repo.report
        ? gathered
        : {
            closed: [...gathered.closed.filter((e) => e.kind !== 'sweep'), ...repo.report.closed.filter((e) => e.kind === 'sweep')],
            open: [...gathered.open.filter((e) => e.kind !== 'sweep'), ...repo.report.open.filter((e) => e.kind === 'sweep')],
            sweepsRead: false,
          }
    repo.report = report
    repo.reportSeq = asOf
    repo.settled = repo.settled.filter((s) => s.seq > asOf || (!sweepsRead && s.kind === 'sweep'))
    // A report reads the same ledgers an earlier unregister froze (#502).
    if (this.retired.some((r) => r.repository === repository)) this.retired = this.retired.filter((r) => r.repository !== repository)
    const open = new Set(report.open.map((e) => e.key))
    // An entry whose process is gone holds no slot, whatever its kind (#502):
    // a dead sweep's hold clears here rather than at the sweep timeout.
    const lost = new Set(report.open.filter((e) => e.lost === true).map((e) => e.key))
    let freed = false
    for (const [k, hold] of this.holds) {
      if (hold.repository !== repository) continue
      if ((hold.kind === 'dispatch' && !open.has(hold.key)) || lost.has(hold.key)) {
        this.holds.delete(k)
        freed = true
      }
    }
    if (this.expire() || freed) this.freed()
  }

  subscribe(label: string, wake: () => Promise<void>): () => void {
    const repository = this.key(label)
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
    const { intents } = request
    const label = request.repository
    const repository = this.key(label)
    // Two dispatches under one key would be two jobs the governor could only
    // tell apart by object: counted once in the spend sum, and one of them
    // never matched to its ledger entry. The engine keys by run, role, task
    // and round, so this is a caller's bug; say which key.
    const seen = new Set<string>()
    for (const intent of intents) {
      if (seen.has(intent.key)) throw new Error(`governor: one request names the key "${intent.key}" twice for ${label} — each dispatch needs its own key`)
      seen.add(intent.key)
    }
    // Unregistered and not registered again (#502): refused, whatever it asks.
    // Before this, an unknown repository was made known and seeded here, so a
    // stopped engine's straggling pass came back with no ceiling at all.
    if (this.tombstones.has(repository)) {
      const base = { repository: label, occupied: this.occupied(), cap: this.cap(), requested: intents.length, granted: 0 }
      const names = this.namesFor([label])
      return { granted: [], refusal: { ...base, limit: 'unregistered', ...(names ? { names } : {}) } }
    }
    if (!this.repos.has(repository)) {
      // A caller that has NEVER registered has nothing of its own to seed: a
      // scheduler built on its own with a governor and no engine (tests, and
      // an embedding that sweeps without an engine). Known from now on, and
      // seeded. Every engine registers at construction, so no engine's
      // repository arrives here.
      this.register(label)
      this.repos.get(repository)!.seeded = true
    }
    if (this.expire()) this.freed()

    const cap = this.cap()
    const occupied = this.occupied()
    const base = { repository: label, occupied, cap, requested: intents.length, granted: 0 }
    const askedUsd = intents.reduce((sum, i) => sum + i.estimateUsd, 0)
    const unseeded = this.unseeded()
    if (unseeded.length > 0) return this.refuse({ ...base, limit: 'concurrency', unseeded }, askedUsd, repository)

    let othersOffered = 0
    let heldFor: string | undefined
    for (const [name, offer] of this.offers) {
      if (name === repository) continue
      othersOffered += offer.slots
      heldFor ??= this.labelOf(name)
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
      return this.refuse(turn ? { ...base, limit: 'turn', heldFor } : { ...base, limit: 'concurrency' }, askedUsd, repository)
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
            repository,
          )
      }
      const ceiling = this.repos.get(repository)!.spendLimitUsd
      if (ceiling != null) {
        const { closed, open } = this.repoSpend(repository, superseded)
        if (closed + open + requestedUsd > ceiling)
          return this.refuse(
            { ...base, limit: 'repository-spend', projectedUsd: closed + open, closedUsd: closed, requestedUsd, limitUsd: ceiling, windowMs },
            requestedUsd,
            repository,
          )
      }
    }

    for (const key of superseded) this.holds.delete(holdKey(repository, key))
    const granted = take.map((i) => {
      const slot = new Slot(this.released, label, repository, i.key, i.estimateUsd, i.kind ?? 'dispatch')
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
    const names = this.namesFor([label])
    return { granted, refusal: { ...base, granted: n, limit: 'concurrency', ...(names ? { names } : {}) } }
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
      const repo = this.repos.get(slot.repoKey)
      if (repo) {
        this.pruneSettled(repo)
        repo.settled.push({
          key: slot.key,
          amountUsd: costUsd ?? slot.estimateUsd,
          seq: this.seq++,
          settledAt: this.now(),
          ledgerAt: slot.ledgerAt,
          kind: slot.kind,
        })
      }
      this.freed()
    } else this.freed(slot.repoKey)
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
      offers: Object.fromEntries([...this.offers].map(([k, o]) => [this.labelOf(k), o.slots])),
      waiters: [...this.waiters.keys()].map((k) => this.labelOf(k)),
    }
  }

  /** Spend in the window across every registered repository: closed cost and open or reserved estimates. */
  machineSpend(requesterLabel?: string, superseded?: ReadonlySet<string>): { closed: number; open: number } {
    const requester = requesterLabel === undefined ? undefined : this.key(requesterLabel)
    let closed = 0
    let open = 0
    for (const name of this.repos.keys()) {
      const s = this.repoSpend(name, name === requester ? superseded : undefined)
      closed += s.closed
      open += s.open
    }
    // What unregistered repositories spent inside the window (#502).
    const since = this.now() - this.spendWindowMs
    for (const r of this.retired) if (r.atMs >= since) closed += r.amountUsd
    return { closed, open }
  }

  /**
   * One repository's spend in the window. Closed entries opened inside the
   * window at their real cost (an undated one counts — the ceiling bounds
   * unattended spend, and a fact it cannot date is not a reason to spend
   * more), plus dispatches that settled since the report began gathering, at
   * the cost they were released with. Then entries still open at their
   * estimate, and the governor's own reservations and startup holds at
   * theirs. Every dispatch is counted once, however the report, the
   * reservation and the settlement overlap:
   *
   * - a settlement or a committed reservation that the report shows closed
   *   (same key, same `at`) counts only as that closed entry;
   * - an open entry the report still lists but that has since settled counts
   *   only as settled;
   * - an open entry and a reservation or hold with the same key count once.
   *
   * A settlement leaves the window like a closed entry, by when it settled,
   * whether or not its repository reports again. `superseded` names holds a
   * request is about to take over, so their estimate is not counted beside
   * the request's own.
   */
  repoSpend(label: string, superseded?: ReadonlySet<string>): { closed: number; open: number } {
    const items = this.spendItems(this.key(label), superseded)
    let closed = 0
    for (const c of items.closed) closed += c.amountUsd
    let open = 0
    for (const v of items.open.values()) open += v
    return { closed, open }
  }

  /**
   * `repoSpend`'s terms, one by one: each closed amount in the window with
   * when it counts from (null for a closed entry with no date), and each open
   * estimate by key. `unregister` keeps the list; `repoSpend` sums it.
   */
  private spendItems(repository: string, superseded?: ReadonlySet<string>): { closed: { amountUsd: number; atMs: number | null }[]; open: Map<string, number> } {
    const since = this.now() - this.spendWindowMs
    const parse = (at: string | null) => {
      const t = at ? Date.parse(at) : Number.NaN
      return Number.isNaN(t) ? null : t
    }
    const inWindow = (at: string | null) => {
      const t = parse(at)
      return t === null || t >= since
    }
    const state = this.repos.get(repository)
    const report = state?.report
    const closed: { amountUsd: number; atMs: number | null }[] = []
    const reportedClosed = new Set<string>()
    for (const e of report?.closed ?? []) {
      if (e.key !== undefined) reportedClosed.add(ledgerId(e.key, e.at))
      if (inWindow(e.at)) closed.push({ amountUsd: e.costUsd, atMs: parse(e.at) })
    }
    const inReport = (key: string, at: string | null) => at !== null && reportedClosed.has(ledgerId(key, at))
    const settledIds = new Set<string>()
    const settledUndated = new Set<string>()
    for (const s of state?.settled ?? []) {
      if (s.ledgerAt === null) settledUndated.add(s.key)
      else settledIds.add(ledgerId(s.key, s.ledgerAt))
      if (inReport(s.key, s.ledgerAt) || s.settledAt < since) continue
      closed.push({ amountUsd: s.amountUsd, atMs: s.settledAt })
    }
    const byKey = new Map<string, number>()
    for (const e of report?.open ?? []) {
      if (e.kind === 'sweep' && !inWindow(e.at)) continue
      if (settledIds.has(ledgerId(e.key, e.at)) || settledUndated.has(e.key) || superseded?.has(e.key)) continue
      byKey.set(e.key, e.estimateUsd)
    }
    for (const hold of this.holds.values())
      if (hold.repository === repository && !superseded?.has(hold.key)) byKey.set(hold.key, hold.estimateUsd)
    for (const slot of this.live) {
      if (slot.repoKey !== repository) continue
      // Its close has landed and the report read it, but the job has not
      // released yet: the closed entry already carries it.
      if (slot.committed && inReport(slot.key, slot.ledgerAt)) {
        byKey.delete(slot.key)
        continue
      }
      byKey.set(slot.key, slot.estimateUsd)
    }
    return { closed, open: byKey }
  }

  /**
   * Drop settlements that have left the window: they count for nothing, and
   * a repository that never reports again (a stopped engine, a report that
   * fails every time) would otherwise keep them forever.
   */
  private pruneSettled(repo: RepoState): void {
    const since = this.now() - this.spendWindowMs
    if (repo.settled.some((s) => s.settledAt < since)) repo.settled = repo.settled.filter((s) => s.settledAt >= since)
  }

  /** Resolves once every wake sent has finished. For tests and orderly shutdown. */
  idle(): Promise<void> {
    if (this.outstanding === 0) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private refuse(refusal: GovernorRefusal, requestedUsd: number, repository: string): ReserveResult {
    this.waiters.set(repository, { limit: refusal.limit, requestedUsd })
    const names = this.namesFor([refusal.repository, refusal.heldFor, ...(refusal.unseeded ?? [])])
    return { granted: [], refusal: names ? { ...refusal, names } : refusal }
  }

  /** Drop startup holds and offers whose time is up, and settlements out of the window. True when a slot came free. */
  private expire(): boolean {
    const now = this.now()
    for (const repo of this.repos.values()) this.pruneSettled(repo)
    const since = now - this.spendWindowMs
    if (this.retired.some((r) => r.atMs < since)) this.retired = this.retired.filter((r) => r.atMs >= since)
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
