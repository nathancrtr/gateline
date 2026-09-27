// Scheduled roles (docs/ORCHESTRATOR.md §4.6): periodic dispatches that are
// not tied to a pipeline run — the Historian's documentation sweep is the
// first. Schedules live in orchestrator.yaml at the default-branch tip (read
// like the registry, never from a checkout), and every fact the scheduler
// needs is derivable from committed files, so a sweep survives restarts the
// same way a run does.
//
// One rule per row; each row has a test in test/schedule.test.ts:
//
//   S0  schedule disabled                              → rest
//   S1  a sweep branch for this role is open (unmerged) → rest (one in flight / awaiting review per role)
//   S2  interval since the last merged sweep not elapsed → rest
//   S3  today's sweep branch already exists             → rest (duplicate guard; sub-daily intervals clamp to daily)
//
// S1 and S3 read local *and* remote-tracking refs. Origin is the
// linearization point (TOPOLOGY.md §3), so an unmerged sweep that exists only
// under refs/remotes/ is still open — pruning the operator's local branch
// must not let a second sweep pile onto the first (#273). The caller syncs
// from origin (fetch --prune) before ticking, so those refs are fresh and a
// branch deleted on origin does not rest the schedule forever.
//   SB  role estimate exceeds the schedule's cost cap   → skip + warn (a config defect, not a dispatch)
//   S4  otherwise                                       → dispatch the sweep
//
// A due sweep is then admitted by the governor like any run dispatch (#501):
// it takes a concurrency slot, its estimate counts against the spend window
// until its marker is closed, and a refusal defers it (MC or HB) — nothing is
// written, and the schedule derives the same sweep again on a later tick.
//
// A sweep is a mini-run: runs/<role>-<date>/ on branch run/<role>-<date>,
// seeded with a sweep.yaml marker by commit-then-launch (branch creation from
// ZERO_OID is the CAS duplicate-dispatch guard). It carries no state.yaml on
// purpose — the gate engine and frontend recognize runs by state.yaml, so
// sweeps stay out of the derivation table entirely. The human surface is the
// branch itself: review the docs-delta and doc edits, merge to approve (P4).
import type { Identity } from '@gateline/core/record'
import { type FrameworkRoots, Git, memoizedFrameworkRoots } from '@gateline/core/sources'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_ESTIMATE_USD } from './derive.ts'
import type { Deferral } from './engine.ts'
import type { GovernorPort, Reservation } from './governor.ts'
import { refusalReason, refusalRule } from './governor.ts'
import { type HostTip, resolveHostTip } from './manifest.ts'
import { type Registry, resolveModel } from './registry.ts'
import type { Dispatcher } from './seam.ts'
import { ensureRunCheckout, removeRunCheckout } from './workspace.ts'

const ZERO_OID = '0'.repeat(40)

/** The local branch and every remote-tracking copy of `run/<name>` (#273). */
const sweepRefPatterns = (name: string) => [`refs/heads/run/${name}`, `refs/remotes/*/run/${name}`]
/** How long a sweep may run before it is killed — also how long a sweep found open after a restart holds its slot (#501). */
export const DEFAULT_SWEEP_TIMEOUT_MS = 30 * 60 * 1000

/** A sweep's key with the governor: distinct from every run dispatch's `slug|role|task|round`. */
export const sweepKey = (slug: string): string => `sweep:${slug}`

/** One sweep marker (`sweep.yaml`), the sweep's one-entry ledger. */
export interface SweepMarker {
  slug: string
  role: string
  at: string | null
  /** Null while the sweep is open: dispatched and not yet metered. */
  costUsd: number | null
  /**
   * The engine process that opened the sweep (`<hostname>:<pid>#n`, as ledger
   * entries name theirs), or null for a marker written before #502. The seed
   * and the spend report read it to tell a dead sweep from a running one.
   */
  engine: string | null
}

const SWEEP_SLUG = /^(.+)-(\d{4}-\d{2}-\d{2})$/

/**
 * Every sweep marker that could fall inside a window starting at `sinceMs`
 * (#501): on sweep branches (local and remote-tracking) and merged to the
 * default branch, one per slug. A slug carries the UTC date its sweep was
 * dispatched on, so a marker from a day wholly before the window is not
 * read at all. Where a slug has several copies, a metered one wins over an
 * open one — the closing commit is the later fact — and otherwise the
 * branch's copy, which is where the closing commit lands.
 *
 * `defaultRef` is read live, by name: a sweep merged after startup must count
 * as merged. Only `orchestrator.yaml` is pinned to the startup commit.
 */
export async function readSweepMarkers(git: Git, runsRoot: string, defaultRef: string, sinceMs: number): Promise<SweepMarker[]> {
  const floor = sinceMs - 24 * 60 * 60 * 1000
  const recent = (slug: string) => {
    const m = SWEEP_SLUG.exec(slug)
    if (!m) return false
    const day = Date.parse(`${m[2]}T00:00:00.000Z`)
    return !Number.isNaN(day) && day >= floor
  }
  const bySlug = new Map<string, SweepMarker>()
  const consider = (marker: SweepMarker) => {
    const prior = bySlug.get(marker.slug)
    if (!prior || (prior.costUsd === null && marker.costUsd !== null)) bySlug.set(marker.slug, marker)
  }
  const read = async (rev: string, slug: string) => {
    const text = await git.show(rev, `${runsRoot}/${slug}/sweep.yaml`)
    const marker = text === null ? null : parseMarker(slug, text)
    if (marker) consider(marker)
  }
  for (const { ref } of await git.forEachRef(['refs/heads/run/*', 'refs/remotes/*/run/*'])) {
    const slug = ref.slice(ref.indexOf('/run/') + '/run/'.length)
    if (recent(slug)) await read(ref, slug)
  }
  if (await git.revParse(defaultRef)) {
    for (const dir of await git.lsTreeDirs(defaultRef, runsRoot)) if (recent(dir)) await read(defaultRef, dir)
  }
  return [...bySlug.values()]
}

function parseMarker(slug: string, text: string): SweepMarker | null {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.role !== 'string') return null
  return {
    slug,
    role: r.role,
    at: markerAt(text),
    costUsd: typeof r.cost_usd === 'number' ? r.cost_usd : null,
    engine: typeof r.engine === 'string' && r.engine !== '' ? r.engine : null,
  }
}

export interface ScheduleEntry {
  role: string
  everyMs: number
  costLimitUsd: number | null
  enabled: boolean
  /** The `every:` spelling as written, for markers and messages. */
  every: string
}

export interface ScheduleConfig {
  schedules: ScheduleEntry[]
  /** Entries that failed to parse — logged, never guessed at (the bounce rule applied to config). */
  errors: string[]
}

/** `7d` | `12h` | `30m` → milliseconds; null when unparseable. */
export function parseEvery(value: string): number | null {
  const m = /^(\d+)([dhm])$/.exec(value.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n <= 0) return null
  const unit = { d: 24 * 60 * 60 * 1000, h: 60 * 60 * 1000, m: 60 * 1000 }[m[2] as 'd' | 'h' | 'm']
  return n * unit
}

export function parseScheduleConfig(text: string): ScheduleConfig {
  const errors: string[] = []
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    return { schedules: [], errors: [`orchestrator.yaml is not valid YAML: ${(e as Error).message}`] }
  }
  const schedulesRaw = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).schedules : undefined
  if (schedulesRaw === undefined || schedulesRaw === null) return { schedules: [], errors }
  if (typeof schedulesRaw !== 'object' || Array.isArray(schedulesRaw))
    return { schedules: [], errors: ['orchestrator.yaml: `schedules` must be a map of role → entry'] }

  const schedules: ScheduleEntry[] = []
  for (const [role, entryRaw] of Object.entries(schedulesRaw as Record<string, unknown>)) {
    const entry = entryRaw && typeof entryRaw === 'object' ? (entryRaw as Record<string, unknown>) : {}
    const every = typeof entry.every === 'string' ? entry.every : null
    const everyMs = every ? parseEvery(every) : null
    if (!every || everyMs === null) {
      errors.push(`schedules.${role}: \`every\` must be <n>d | <n>h | <n>m (got ${JSON.stringify(entry.every ?? null)})`)
      continue
    }
    schedules.push({
      role,
      everyMs,
      every,
      costLimitUsd: typeof entry.cost_limit_usd === 'number' ? entry.cost_limit_usd : null,
      enabled: entry.enabled !== false,
    })
  }
  return { schedules, errors }
}

/** Everything the sweep decision needs, gathered from committed files. */
export interface SweepFacts {
  now: Date
  entry: ScheduleEntry
  /** `at` of the newest merged sweep marker for this role, ISO; null when none. */
  lastSweptAt: string | null
  /** Branch name of an unmerged sweep for this role, when one exists. */
  openSweep: string | null
  /** run/<role>-<today> already exists (merged same day, or another instance won). */
  slugTaken: boolean
  /** Registry pre-flight estimate for the role. */
  estimateUsd: number
}

export type SweepDecision =
  | { kind: 'rest'; rule: string; why: string }
  | { kind: 'skip'; rule: string; why: string }
  | { kind: 'dispatch'; rule: string; why: string }

export function deriveSweep(f: SweepFacts): SweepDecision {
  const { entry } = f
  if (!entry.enabled) return { kind: 'rest', rule: 'S0', why: `${entry.role} schedule disabled` }
  if (f.openSweep)
    return {
      kind: 'rest',
      rule: 'S1',
      why: `sweep ${f.openSweep} is open — in flight or awaiting human review; one sweep per role at a time`,
    }
  if (f.lastSweptAt !== null) {
    const last = Date.parse(f.lastSweptAt)
    if (!Number.isNaN(last) && f.now.getTime() - last < entry.everyMs)
      return { kind: 'rest', rule: 'S2', why: `last ${entry.role} sweep ${f.lastSweptAt} is within \`every: ${entry.every}\`` }
  }
  if (f.slugTaken)
    return { kind: 'rest', rule: 'S3', why: `run/${sweepSlug(entry.role, f.now)} already exists — one sweep per day` }
  if (entry.costLimitUsd !== null && f.estimateUsd > entry.costLimitUsd)
    return {
      kind: 'skip',
      rule: 'SB',
      why: `${entry.role} estimate $${f.estimateUsd} exceeds the schedule's cost_limit_usd $${entry.costLimitUsd} — fix orchestrator.yaml or the registry estimate`,
    }
  return { kind: 'dispatch', rule: 'S4', why: `${entry.role} sweep due (last: ${f.lastSweptAt ?? 'never'})` }
}

/** UTC date-grained slug: historian-2026-07-11. */
export function sweepSlug(role: string, now: Date): string {
  return `${role}-${now.toISOString().slice(0, 10)}`
}

/** The run-specific dispatch prompt (§5.4: a template, not a composition). */
export function sweepPromptBody(slug: string, coveringSince: string | null, runsRoot = 'runs', contractsRoot = 'contracts'): string {
  const interval = coveringSince
    ? `the interval since ${coveringSince} (the previous sweep's cutoff)`
    : 'the full history of the repository (this is the first sweep)'
  return [
    `for sweep \`${runsRoot}/${slug}\`, covering ${interval}.`,
    `Reconcile documentation and tracker surfaces with the run artifacts and merges landed on the default branch in that interval.`,
    `Produce \`${runsRoot}/${slug}/docs-delta.md\` per \`${contractsRoot}/docs-delta.md\` and apply the documentation fixes it records on the current branch.`,
    `No authenticated tracker CLI is assumed: leave tracker mutations as proposed actions in the delta unless one is available in your tools.`,
    `When your work is complete, commit it on the current branch (git add the files you produced or changed) with a message starting "${slug}: docs delta".`,
  ].join(' ')
}

export interface SweepOutcome {
  role: string
  slug: string | null
  /** `deferred`: due, and refused by the governor (#501) — nothing written, derived again later. */
  kind: 'rest' | 'skip' | 'deferred' | 'dispatched' | 'lost-cas' | 'error'
  rule: string | null
  detail: string
}

export interface SchedulerConfig {
  repoDir: string
  identity: Identity
  dispatcher: Dispatcher
  registry: Registry | null
  /**
   * Override the `.gateline` default when this repo was integrated with a
   * custom `gateline init --prefix` (#95) — otherwise auto-detected.
   */
  frameworkPrefix?: string
  /** Dispatch wall clock before the sweep job is killed (default 30 min). */
  sweepTimeoutMs?: number
  /** Push every sweep commit to origin (hosted mode). */
  push?: boolean
  /**
   * What admits a due sweep (#501): the governor its engine uses, so a sweep
   * and a run dispatch compete for the same slots and the same window.
   * Required: a scheduler with a governor of its own would ignore every
   * limit the operator set.
   */
  governor: GovernorPort
  /** The repository's key with the governor — the same one its engine uses. Defaults to `repoDir`. */
  repository?: string
  /**
   * The engine process this scheduler belongs to (#502): its engine's
   * `engineId`, written into each sweep marker it opens as `engine:` so that a
   * later seed can tell a sweep whose process died from one still running.
   * Absent, markers carry no `engine:` line, as before #502.
   */
  engineId?: string
  /**
   * Told when a sweep job's settlement throws (#502), after it is caught and
   * logged: `assembleOrchestrator` marks the repository's engine failed.
   */
  onFault?: (e: unknown, context: string) => void
  /**
   * The commit `orchestrator.yaml` is read at (#500, #501): the one
   * `assembleOrchestrator` resolved, so sweep schedules come from the same
   * snapshot as the registry and adapter manifests. Absent, the scheduler
   * resolves its own on first use. Facts about sweeps themselves — which are
   * open, when the last merged one ran — are read live at that tip's ref.
   */
  hostTip?: HostTip
  now?: () => Date
  log?: (line: string) => void
}

/**
 * The scheduler mirrors the engine's shape at sweep scale: observe committed
 * files → derive (deriveSweep) → execute with commit-then-launch → close the
 * marker with real usage. It shares the engine's dispatcher, so sweeps flow
 * through the same metered seam as every other model invocation (§6) — the
 * marker file (sweep.yaml) is the sweep's one-entry ledger.
 */
export class Scheduler {
  private readonly cfg: SchedulerConfig
  private readonly git: Git
  private readonly frameworkRoots: () => Promise<FrameworkRoots>
  /** In-flight sweep jobs by slug — host ephemera; a crash costs a stale open branch a human prunes. */
  private readonly jobs = new Map<string, Promise<void>>()
  /** Fired each time a sweep job settles. */
  onSettled: (() => void) | null = null
  readonly governor: GovernorPort
  readonly repository: string
  /** Sweeps the governor held back on the last pass, by role — carried on the heartbeat beside the engine's. */
  private deferred = new Map<string, Deferral>()

  constructor(cfg: SchedulerConfig) {
    this.cfg = cfg
    this.git = new Git(cfg.repoDir)
    this.frameworkRoots = memoizedFrameworkRoots(this.git, cfg.frameworkPrefix)
    this.governor = cfg.governor
    this.repository = cfg.repository ?? cfg.repoDir
  }

  private hostTipPromise: Promise<HostTip> | null = null
  private hostTip(): Promise<HostTip> {
    if (!this.hostTipPromise) {
      this.hostTipPromise = this.cfg.hostTip ? Promise.resolve(this.cfg.hostTip) : resolveHostTip(this.git)
      this.hostTipPromise.catch(() => {
        this.hostTipPromise = null
      })
    }
    return this.hostTipPromise
  }

  /** What the last pass held back and why (#501). */
  deferrals(): Deferral[] {
    return [...this.deferred.values()]
  }

  private now(): Date {
    return this.cfg.now?.() ?? new Date()
  }

  private log(line: string): void {
    this.cfg.log?.(line)
  }

  inFlight(): number {
    return this.jobs.size
  }

  async drain(): Promise<void> {
    while (this.jobs.size > 0) await Promise.allSettled([...this.jobs.values()])
  }

  /** One pass over every schedule. `force` bypasses S2 dueness for one role (the CLI's `sweep`). */
  async tick(opts: { force?: string } = {}): Promise<SweepOutcome[]> {
    // The schedules are read at the host tip commit, once resolved (#500):
    // the same snapshot as the registry and the adapter manifests. The
    // default branch itself is named by its full ref, so a tag that shares
    // its short name cannot stand in for it.
    const tip = await this.hostTip()
    const text = await this.git.show(tip.commit, 'orchestrator.yaml')
    const deferred = new Map<string, Deferral>()
    if (text === null) {
      this.deferred = deferred
      return []
    }
    const { schedules, errors } = parseScheduleConfig(text)
    for (const e of errors) this.log(`orchestrator.yaml: ${e}`)

    const outcomes: SweepOutcome[] = []
    for (const entry of schedules) {
      try {
        const outcome = await this.tickOne(entry, tip.ref, opts.force === entry.role)
        if (outcome.kind === 'deferred' && outcome.slug) {
          const prior = this.deferred.get(entry.role)
          deferred.set(entry.role, {
            slug: outcome.slug,
            rule: outcome.rule ?? 'MC',
            reason: outcome.detail,
            since: prior?.rule === outcome.rule ? prior.since : this.now().toISOString(),
            repository: this.repository,
          })
        }
        outcomes.push(outcome)
      } catch (e) {
        outcomes.push({ role: entry.role, slug: null, kind: 'error', rule: null, detail: (e as Error).message })
      }
    }
    this.deferred = deferred
    return outcomes
  }

  private async tickOne(entry: ScheduleEntry, defaultBranch: string, force: boolean): Promise<SweepOutcome> {
    const now = this.now()
    const slug = sweepSlug(entry.role, now)

    // Open sweeps: run/<role>-* branches not yet merged into the default
    // branch, wherever the ref lives (#273).
    let openSweep: string | null = null
    for (const { ref } of await this.git.forEachRef(sweepRefPatterns(`${entry.role}-*`))) {
      if (!(await this.git.isAncestor(ref, defaultBranch))) {
        openSweep = ref.replace(/^refs\/(heads|remotes\/[^/]+)\//, '')
        break
      }
    }

    // Last merged sweep: the newest marker under runs/<role>-*/ at the default tip.
    const { runs: runsRoot } = await this.frameworkRoots()
    let lastSweptAt: string | null = null
    for (const dir of await this.git.lsTreeDirs(defaultBranch, runsRoot)) {
      if (!dir.startsWith(`${entry.role}-`)) continue
      const marker = await this.git.show(defaultBranch, `${runsRoot}/${dir}/sweep.yaml`)
      const at = marker ? markerAt(marker) : null
      const candidate = at ?? isoFromSlugDate(dir.slice(entry.role.length + 1))
      if (candidate && (!lastSweptAt || candidate > lastSweptAt)) lastSweptAt = candidate
    }

    const estimateUsd = this.cfg.registry?.estimates[entry.role] ?? DEFAULT_ESTIMATE_USD
    const decision = deriveSweep({
      now,
      entry,
      lastSweptAt: force ? null : lastSweptAt,
      openSweep,
      slugTaken: (await this.git.forEachRef(sweepRefPatterns(slug))).length > 0,
      estimateUsd,
    })
    if (decision.kind !== 'dispatch')
      return { role: entry.role, slug: null, kind: decision.kind, rule: decision.rule, detail: decision.why }

    // Admission (#501): a due sweep takes a slot like any dispatch. Until
    // `launch` hands the reservation to the sweep's job, this frame owns it,
    // and releases it on every other way out — a lost CAS, a missing default
    // tip, an exception.
    const { granted, refusal } = this.governor.reserve({ repository: this.repository, intents: [{ key: sweepKey(slug), estimateUsd, kind: 'sweep' }] })
    const reservation = granted[0]
    if (!reservation) {
      const detail = refusalReason(refusal!, `${entry.role} sweep`, 'the sweep re-derives')
      this.log(`sweep(${slug}): ${detail}`)
      return { role: entry.role, slug, kind: 'deferred', rule: refusalRule(refusal!), detail }
    }
    try {
      return await this.launch(entry, defaultBranch, slug, lastSweptAt, now, reservation)
    } finally {
      if (!reservation.committed) reservation.release()
    }
  }

  /**
   * Commit-then-launch at sweep scale (§4.4): the intent commit seeds the
   * sweep branch with its marker, created from ZERO_OID so two instances
   * racing the same schedule resolve at the ref — the loser rests.
   */
  private async launch(
    entry: ScheduleEntry,
    defaultBranch: string,
    slug: string,
    coveringSince: string | null,
    now: Date,
    reservation: Reservation,
  ): Promise<SweepOutcome> {
    const tip = await this.git.revParse(defaultBranch)
    if (!tip) return { role: entry.role, slug, kind: 'error', rule: 'S4', detail: `${defaultBranch} has no tip` }
    const { runs: runsRoot, contracts: contractsRoot } = await this.frameworkRoots()

    const branch = `run/${slug}`
    const model = this.cfg.registry
      ? resolveModel(this.cfg.registry, entry.role, this.cfg.dispatcher.manifestFor?.(entry.role))
      : null
    const marker = [
      `# Sweep dispatch marker — written by the orchestrator (schedule.ts); the`,
      `# sweep's one-entry ledger. Merging this branch is the human approval and`,
      `# makes this marker the next sweep's interval cutoff.`,
      `sweep: ${slug}`,
      `role: ${entry.role}`,
      `every: ${entry.every}`,
      `at: ${now.toISOString()}`,
      `covering_since: ${coveringSince ?? 'null'}`,
      `adapter: ${this.cfg.dispatcher.adapterFor?.(entry.role) ?? this.cfg.dispatcher.adapter}`,
      `model: ${model ?? 'null'}`,
      // Additive (#502): which engine process opened the sweep. No existing
      // field changes, and a marker without this line reads as before.
      ...(this.cfg.engineId ? [`engine: ${JSON.stringify(this.cfg.engineId)}`] : []),
      `cost_limit_usd: ${entry.costLimitUsd ?? 'null'}`,
      `tokens_in: null`,
      `tokens_out: null`,
      `cost_usd: null`,
      ``,
    ].join('\n')

    const blob = await this.git.hashObject(marker)
    const tree = await this.git.writeTreeWithBlob(tip, `${runsRoot}/${slug}/sweep.yaml`, blob)
    const commit = await this.git.commitTree(
      tree,
      tip,
      `sweep(${slug}): dispatched ${entry.role} — covering since ${coveringSince ?? 'repo start'}`,
      this.cfg.identity,
    )
    if (!(await this.git.updateRefCAS(`refs/heads/${branch}`, commit, ZERO_OID)))
      return { role: entry.role, slug, kind: 'lost-cas', rule: 'S4', detail: 'sweep branch appeared mid-tick — another instance won; rest' }
    await this.pushBranch(branch)

    // What the closing commit metered, handed to the governor on release (#501).
    let metered: number | null = null
    const job = (async () => {
      let outcome: { ok: boolean; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; error: string | null }
      try {
        const cwd = await ensureRunCheckout(this.cfg.repoDir, branch)
        outcome = await this.cfg.dispatcher.dispatch({
          cwd,
          role: entry.role,
          body: sweepPromptBody(slug, coveringSince, runsRoot, contractsRoot),
          timeoutMs: this.cfg.sweepTimeoutMs ?? DEFAULT_SWEEP_TIMEOUT_MS,
        })
      } catch (e) {
        outcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: (e as Error).message }
      }
      metered = await this.closeSweep(entry, branch, slug, outcome)
    })()
    // The settlement's fault boundary (#502), as the engine's: a closing
    // commit that throws is caught and logged here rather than left as a
    // rejection nothing handles, which would end the process and every other
    // repository's engine with it. The stored promise never rejects.
    // Told to the engine when there is one, which logs it with the repository
    // and marks itself failed; logged here otherwise.
    const fault = (e: unknown) => {
      if (this.cfg.onFault) this.cfg.onFault(e, `sweep ${slug}`)
      else this.log(`sweep(${slug}): settlement failed: ${(e as Error)?.message ?? String(e)}`)
    }
    const settled = job
      .then(() => undefined, fault)
      .then(async () => {
        try {
          // Settlement gives the slot back first (#501), after the closing
          // commit has metered the marker, with what it metered.
          reservation.release(metered)
          this.jobs.delete(slug)
          await removeRunCheckout(this.cfg.repoDir, branch)
        } catch (e) {
          this.jobs.delete(slug)
          fault(e)
        }
        this.onSettled?.()
      })
    this.jobs.set(slug, settled)
    // The hand-over: from here the job's settlement owns the slot. The
    // marker's `at` is what the governor recognises it by once it is metered.
    reservation.commit(now.toISOString())
    this.log(`sweep(${slug}): dispatched ${entry.role} on ${branch}`)
    return { role: entry.role, slug, kind: 'dispatched', rule: 'S4', detail: `covering since ${coveringSince ?? 'repo start'}` }
  }

  /** The closing commit: real usage into the marker, on top of whatever the agent committed. */
  /** Best-effort push (hosted mode): a failed push is a warning; the closing commit's push retries. */
  private async pushBranch(branch: string): Promise<void> {
    if (!this.cfg.push) return
    try {
      await this.git.run(['push', 'origin', `${branch}:${branch}`])
    } catch (e) {
      this.log(`sweep push of ${branch} failed: ${(e as Error).message} — commits stay local until the next push`)
    }
  }

  private async closeSweep(
    entry: ScheduleEntry,
    branch: string,
    slug: string,
    outcome: { ok: boolean; costUsd: number | null; tokensIn: number | null; tokensOut: number | null; error: string | null },
  ): Promise<number> {
    const estimate = this.cfg.registry?.estimates[entry.role] ?? DEFAULT_ESTIMATE_USD
    const cost = outcome.costUsd ?? estimate
    const { runs: runsRoot } = await this.frameworkRoots()
    for (let attempt = 0; attempt < 5; attempt++) {
      const tip = await this.git.revParse(`refs/heads/${branch}`)
      if (!tip) return cost // branch deleted under us — a human pruned it; nothing to record
      const current = await this.git.show(tip, `${runsRoot}/${slug}/sweep.yaml`)
      if (current === null) return cost
      const closed = current
        .replace(/^tokens_in: .*$/m, `tokens_in: ${outcome.tokensIn ?? 'null'}`)
        .replace(/^tokens_out: .*$/m, `tokens_out: ${outcome.tokensOut ?? 'null'}`)
        .replace(/^cost_usd: .*$/m, `cost_usd: ${cost}`)
        .concat(outcome.ok ? '' : `failed: ${JSON.stringify(truncate(outcome.error ?? 'unknown error', 200))}\n`)
      const blob = await this.git.hashObject(closed)
      const tree = await this.git.writeTreeWithBlob(tip, `${runsRoot}/${slug}/sweep.yaml`, blob)
      const commit = await this.git.commitTree(
        tree,
        tip,
        `sweep(${slug}): metered ${entry.role} $${cost.toFixed(2)}${outcome.ok ? '' : ` — failed: ${truncate(outcome.error ?? 'unknown', 60)}`}`,
        this.cfg.identity,
      )
      if (await this.git.updateRefCAS(`refs/heads/${branch}`, commit, tip)) {
        this.log(`sweep(${slug}): metered ${entry.role} $${cost.toFixed(2)} ${outcome.ok ? 'ok' : `FAILED (${outcome.error})`}`)
        await this.pushBranch(branch)
        return cost
      }
      // The agent (or a human) committed mid-close: re-read the tip and retry.
    }
    this.log(`sweep(${slug}): closing commit lost CAS 5× — usage unrecorded; the marker stays open on the branch`)
    return cost
  }
}

/** `at:` from a sweep marker without a YAML parse dependency on its shape. */
function markerAt(marker: string): string | null {
  const raw = parseYaml(marker) as Record<string, unknown> | null
  const at = raw && typeof raw === 'object' ? raw.at : null
  if (typeof at === 'string') return at
  if (at instanceof Date) return at.toISOString()
  return null
}

/** `2026-07-11` → ISO midnight UTC; null when the slug tail is not a date. */
function isoFromSlugDate(tail: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(tail) ? `${tail}T00:00:00.000Z` : null
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
