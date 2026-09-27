// Orchestrator assembly as a library (#100): the same engine + scheduler +
// run loop the `gateline-orchestrator` binary drives, callable in-process so
// a frontend can co-locate the engine over its own clone (`gateline up`).
//
// Since #502 one process can run one engine per repository, for a list of
// repositories, under one governor, one code-tree monitor and one shutdown
// path (docs/MULTI-REPO.md §8): `startOrchestrators`. `startOrchestrator`
// serves one repository through the same path, as a list of one.
import { realpath } from 'node:fs/promises'
import type { Identity } from '@gateline/core/record'
import {
  CodeTreeMonitor,
  type CodeTreeStatus,
  deriveRepositoryId,
  Git,
  LocalOnlyPushConflictError,
  lastIdSegment,
  repositoryIdKey,
  repoToplevel,
  resolveCodeRepo,
} from '@gateline/core/sources'
import { Engine, type InFlightJob } from './engine.ts'
import { Governor, type GovernorPort } from './governor.ts'
import { type HeadlessManifest, type HostTip, headlessManifestPathAt, loadHeadlessManifestAt, resolveHostTip } from './manifest.ts'
import { loadRegistry } from './registry.ts'
import { RoutingDispatcher } from './router.ts'
import { type PendingIntent, RemoteDispatcher } from './runner-dispatcher.ts'
import { Scheduler } from './schedule.ts'
import { type Dispatcher, type DispatchOutcome, HeadlessDispatcher } from './seam.ts'
import { type RunLoop, runLoop, SharedCodeTree } from './triggers.ts'

/**
 * The zero-argument shape @gateline/server's own `RunnerCallback` expects
 * (runner-api.ts) — mirrored structurally here rather than imported, so this
 * package carries no edge to `@gateline/server` (the same no-edge convention
 * runner-api.ts documents in the other direction, toward this package).
 * Structurally assignable to `@gateline/server`'s `RunnerCallback` — a caller
 * assembling both (main.ts) passes a value of this shape straight into
 * `ServeOptions.runnerCallback`.
 */
export interface RunnerCallback {
  pendingIntents(): PendingIntent[]
  resolveOutcome(key: string, outcome: DispatchOutcome): boolean
}

/**
 * Adapts `RemoteDispatcher`'s ledger-aware `pendingIntents(openEntries)` to
 * the zero-argument shape above. `openEntries` is exactly the engine's own
 * in-flight job list (`inFlightDetail()`): already keyed identically to a
 * ledger entry (`slug|role|task|round`, engine.ts's private `jobKey`) and
 * already synchronous (an in-memory map), so this needs no ledger read of
 * its own — R7's lease semantics fall out of `this.jobs` already gating
 * `sweepStale` (engine.ts), not a mechanism added here.
 */
export function makeRunnerCallback(engine: Engine, remote: RemoteDispatcher): RunnerCallback {
  return {
    pendingIntents: () =>
      remote.pendingIntents(engine.inFlightDetail().map(({ slug, role, task, round }) => ({ slug, role, task, round }))),
    resolveOutcome: (key, outcome) => remote.resolveOutcome(key, outcome),
  }
}

/** One identity per orchestrator install (resolved question 4). */
export const BOT_IDENTITY: Identity = {
  name: 'gateline-orchestrator',
  email: 'orchestrator@gateline.invalid',
}

/**
 * A repository's id when the caller gives none (#494, #502): derived from its
 * origin the way the server names a repository given by `--repo` with no
 * config entry (`github.com/acme/billing`, or `local/<directory name>` with no
 * origin), so the engine's `RunRef.source` matches the server's id for the
 * same repository. A directory whose name cannot make a local id keeps its
 * path as the id: the governor only needs a key that is stable for the life of
 * the process, and the binary must not start refusing a repository it used to
 * serve.
 */
export async function defaultRepositoryId(repoDir: string): Promise<string> {
  try {
    return deriveRepositoryId({ origin: await new Git(repoDir).remoteUrl('origin'), dir: repoDir }).id
  } catch {
    return repoDir
  }
}

export interface OrchestratorOptions {
  repoDir: string
  /** Headless adapter names; the first is the default runner (default: claude-code). */
  adapters?: string[]
  /** Metadata prefix of an gateline init --prefix host, when not `.gateline`. */
  frameworkPrefix?: string
  /** Push every orchestrator commit to origin — origin is the record. */
  push?: boolean
  /**
   * Explicit local-only designator (mirrors `push`'s explicit tier, the
   * core resolution table's rule 2/AC1.1): unset auto-detects off a missing
   * `remote.origin.url`, same trigger as `loadSources`. Conflicts with an
   * explicit `push: true` — rejected before anything starts (AC4.1).
   */
  localOnly?: boolean
  /** Refuse dispatch on any run missing budget.cost_limit_usd. */
  requireBudget?: boolean
  /** Host-wide spend ceiling across active runs. */
  spendLimitUsd?: number | null
  /** The rolling window `spendLimitUsd` measures over, in hours (default 24, #97). */
  spendWindowHours?: number
  /**
   * Budget *enforcement* switch (#109), default on: false disables the
   * DB/RB/HB pauses — for operators billed flat-rate, where dollar caps do
   * not map to marginal cost. Metering stays unconditional.
   */
  budgetEnforcement?: boolean
  /** Most dispatches — runs and sweeps — running at once in this process; 0 disables (#227, #501). */
  maxConcurrentDispatches?: number
  /**
   * The governor that admits this engine's dispatches and its sweeps (#501).
   * Absent, one is built from `maxConcurrentDispatches`, `spendLimitUsd`,
   * `spendWindowHours` and `budgetEnforcement` — so the standalone binary and
   * a one-repository `up` each get a governor of their own. An embedding that
   * runs several engines calls `startOrchestrators`, which builds one governor
   * for all of them; given one here, those four options are the governor's
   * business and are ignored.
   */
  governor?: GovernorPort
  /**
   * This repository's id (#494, #502): the id of the engine's source (so the
   * `RunRef.source` it reads matches the server's) and its key with the
   * governor. Absent, it is derived from the origin (`defaultRepositoryId`).
   */
  repository?: string
  /** How log lines and the governor's refusal words name the repository (#502). Default: the id's last segment. */
  displayName?: string
  /** This repository's own spend ceiling per window, beneath the machine's (MULTI-REPO.md §7.4). */
  repositorySpendLimitUsd?: number | null
  /** Wall clock per dispatched role before its process group is killed (default 30 min). */
  roleTimeoutSeconds?: number
  heartbeatSeconds?: number
  /**
   * Opt into remote dispatch (run "runner-agent", R6/R9): the engine's
   * dispatcher becomes a `RemoteDispatcher` instead of the local
   * `HeadlessDispatcher`(s) — dispatch requests park as promises a
   * workstation agent claims and reports over HTTP (runner-dispatcher.ts,
   * the server's runner-api.ts) rather than spawning a harness in this
   * process. A configuration choice, not a routing decision: unset or
   * false dispatches exactly as before (AC9.1). No entry point enables it
   * today (#507), and `startOrchestrators` refuses it with several
   * repositories: the runner API serves one.
   */
  runner?: { enabled: boolean }
  /**
   * The engine's and the scheduler's local dispatcher, in place of the
   * headless dispatchers built from the host's adapter manifests — which are
   * then not read at all (#502). For tests and for an embedding that brings
   * its own dispatch seam; everything else about the engine is unchanged.
   */
  dispatcher?: Dispatcher
  /**
   * The code checkout to watch for self-supersede (#141). Absent, the
   * checkout this module runs from (`resolveCodeRepo`); null, none. Tests
   * point it at a throwaway repository.
   */
  codeRepo?: string | null
  log?: (line: string) => void
  /**
   * Self-supersede (#141): fired exactly once, after the confirming
   * heartbeat write, when the code tree this process's own module lives in
   * fast-forwards past the commit it started on. Only wired when the
   * running module resolves to a git checkout (`resolveCodeRepo`) — an
   * npm-installed/viewer-only process has nothing to watch and `startOrchestrator`
   * behaves exactly as it did before #141.
   */
  onSupersede?: (status: CodeTreeStatus) => void
}

export async function assembleOrchestrator(
  opts: OrchestratorOptions,
): Promise<{
  engine: Engine
  scheduler: Scheduler
  manifestStaleProbe: () => Promise<string[]>
  /** Present iff `opts.runner?.enabled` — see `RunnerCallback` above. */
  runnerCallback?: RunnerCallback
  /** The commit the host's configuration was read at (#500). */
  hostTip: HostTip
  /** The adapter manifests the engine will execute, in `opts.adapters` order; empty when `opts.dispatcher` replaced them. */
  manifests: HeadlessManifest[]
  /** What admits the engine's dispatches and the scheduler's sweeps (#501). */
  governor: GovernorPort
}> {
  const log = opts.log ?? (() => {})
  const git = new Git(opts.repoDir)
  // Local-only + explicit push is refused before anything else starts (ADR-5,
  // AC4.1): the binary never goes through `loadSources`, so it repeats the
  // same conflict check here.
  if (opts.localOnly && opts.push) throw new LocalOnlyPushConflictError(opts.repoDir)
  // Unset auto-detects off a missing origin — the same trigger `loadSources`
  // uses (AC1.1) — only when neither `localOnly` nor `push` was explicit.
  const localOnly = opts.localOnly ?? (opts.push ? false : (await git.configGet('remote.origin.url')) === null)
  const push = localOnly ? false : opts.push
  // The host's configuration is read at one commit, resolved once here (#500):
  // the registry and the adapter manifests below, role capabilities in the
  // engine (handed the same tip). That commit is the local default-branch ref,
  // with no fetch, so a local-only repository reads exactly what it has.
  // The scheduler reads `orchestrator.yaml` at the same commit (#501).
  const tip = await resolveHostTip(git)
  if (tip.fallback) {
    log(
      `WARNING: no default branch could be determined for ${opts.repoDir} (no origin/HEAD, no main or master) — ` +
        `host configuration (registry, adapter manifests, role capabilities) is being read from the checked-out branch "${tip.name}"`,
    )
  }
  const registry = await loadRegistry(git, tip.commit, opts.frameworkPrefix)
  const watched: { adapter: string; path: string; loadedOid: string | null }[] = []
  const adapters = opts.dispatcher
    ? []
    : await Promise.all(
        (opts.adapters?.length ? opts.adapters : ['claude-code']).map(async (name) => {
          const manifest = await loadHeadlessManifestAt(git, tip.commit, name, opts.frameworkPrefix, tip.name)
          const path = await headlessManifestPathAt(git, tip.commit, name, opts.frameworkPrefix)
          watched.push({ adapter: name, path, loadedOid: await git.objectId(tip.commit, path) })
          return { manifest, dispatcher: new HeadlessDispatcher(manifest) }
        }),
      )
  // Manifests are read once, at process start, as the registry is (the
  // 2026-07-16 trap: a fix that silently never applied). The probe reports a
  // manifest whose blob at the default branch changed after load, once per
  // change — the heartbeat surfaces it. Edits in the working tree or on another
  // branch change nothing the engine runs, so they are not reported.
  // Sweep schedules are read at the same commit now (#501), so an edit to
  // `orchestrator.yaml` merged after startup is the same trap; report it the
  // same way.
  const schedules = { loadedOid: await git.objectId(tip.commit, 'orchestrator.yaml') }
  const manifestStaleProbe = async (): Promise<string[]> => {
    const messages: string[] = []
    const now = await resolveHostTip(git)
    for (const w of watched) {
      const oid = await git.objectId(now.commit, w.path)
      if (oid !== w.loadedOid) {
        w.loadedOid = oid
        messages.push(
          `adapter manifest "${w.adapter}" changed on ${now.name} after load — manifests are read once at startup, from the default branch; restart to apply (${w.path})`,
        )
      }
    }
    const scheduleOid = await git.objectId(now.commit, 'orchestrator.yaml')
    if (scheduleOid !== schedules.loadedOid) {
      schedules.loadedOid = scheduleOid
      messages.push(
        `orchestrator.yaml changed on ${now.name} after load — sweep schedules are read once at startup, from the default branch; restart to apply`,
      )
    }
    return messages
  }
  // The scheduler always dispatches through the local headless/routing seam
  // (F1, review-05.md): its jobs (`schedule.ts:328`) never carry `slug`/
  // `branch`, which `RemoteDispatcher.dispatch()` requires (it throws
  // otherwise) — and even if they did, `makeRunnerCallback` below sources
  // pending intents solely from the *engine's* `inFlightDetail()`, so a
  // scheduler-parked promise would never surface to a workstation and would
  // only ever die at `sweepTimeoutMs`. Only the engine's dispatch route
  // switches to remote when `runner.enabled` (scope point 3); sweep billing
  // stays on the local path regardless — consistent with the brief's
  // "peer, not a replacement". Threading `slug`/`branch` through the
  // scheduler to make scheduled sweeps remote-dispatchable too is outside
  // this task's surface (an escalation, not a quiet widening here).
  const localDispatcher =
    opts.dispatcher ??
    (adapters.length === 1 && !registry
      ? adapters[0]!.dispatcher
      : new RoutingDispatcher(adapters, registry ?? { profiles: {}, bindings: {}, pricing: {}, estimates: {} }, log))
  const remote = opts.runner?.enabled ? new RemoteDispatcher() : undefined
  const common = {
    repoDir: opts.repoDir,
    identity: BOT_IDENTITY,
    dispatcher: localDispatcher,
    registry,
    frameworkPrefix: opts.frameworkPrefix,
    push,
    localOnly,
    log,
  }
  // An uncapped host must be visible, not quiet (#109): say so at every
  // startup, and name any ceiling flags the opt-out overrides.
  if (opts.budgetEnforcement === false) {
    const overridden = [opts.requireBudget ? '--require-budget' : null, opts.spendLimitUsd != null ? '--spend-limit-usd' : null]
      .filter((f) => f !== null)
      .join(', ')
    log(
      `budget enforcement OFF — runs meter (ledger, cost_spent_usd) but caps never pause dispatch` +
        (overridden ? `; ignoring ${overridden}` : ''),
    )
  }
  // One governor owns the cap and the spend window for the process (#501):
  // the engine's run dispatches and the scheduler's sweeps are admitted by it
  // alike. Built here from the flags unless the caller brought its own.
  const governor =
    opts.governor ??
    new Governor({
      maxConcurrentDispatches: opts.maxConcurrentDispatches,
      spendLimitUsd: opts.spendLimitUsd ?? null,
      spendWindowMs: opts.spendWindowHours !== undefined ? opts.spendWindowHours * 3_600_000 : undefined,
      budgetEnforcement: opts.budgetEnforcement,
      log,
    })
  // One id for the repository (#502): the engine's source id, and its key with
  // the governor, the scheduler's included.
  const repository = opts.repository ?? (await defaultRepositoryId(opts.repoDir))
  // One sweep timeout for both: the scheduler kills a sweep at it, and the
  // engine's restart seed holds an open sweep's slot for exactly as long.
  // Nothing sets it yet, so both take the scheduler's default.
  const sweepTimeoutMs: number | undefined = undefined
  const engine = new Engine({
    ...common,
    hostTip: tip,
    dispatcher: remote ?? localDispatcher,
    governor,
    repository,
    displayName: opts.displayName,
    repositorySpendLimitUsd: opts.repositorySpendLimitUsd,
    requireBudget: opts.requireBudget,
    budgetEnforcement: opts.budgetEnforcement,
    roleTimeoutMs: opts.roleTimeoutSeconds !== undefined ? opts.roleTimeoutSeconds * 1000 : undefined,
    sweepTimeoutMs,
  })
  // Scheduler stays on `common` — i.e. always the local dispatcher, never remote.
  // Its markers name the engine's process (#502), and a sweep settlement that
  // throws marks the engine failed, like one of the engine's own.
  const scheduler = new Scheduler({
    ...common,
    governor,
    repository,
    hostTip: tip,
    sweepTimeoutMs,
    engineId: engine.engineId,
    onFault: (e, context) => void engine.noteFault('sweep', e, context),
  })
  const runnerCallback = remote ? makeRunnerCallback(engine, remote) : undefined
  return { engine, scheduler, manifestStaleProbe, runnerCallback, hostTip: tip, manifests: adapters.map((a) => a.manifest), governor }
}

/** One repository's engine, in a process that may run several (#502). */
export interface RepositoryEngineConfig {
  /** The repository's top directory, already resolved by the caller. */
  repoDir: string
  /**
   * The repository's id, as the caller derived it (#494): `github.com/acme/billing`,
   * `local/billing`. The engine's source id and its key with the governor. Two
   * entries may not share one, compared without case.
   */
  repositoryId: string
  /** How log lines and the governor's refusal words name it. Default: the id's last segment. */
  displayName?: string
  /** This repository's own spend ceiling per window, beneath the machine's (MULTI-REPO.md §7.4). */
  spendLimitUsd?: number | null
  /** Per repository, over `engineDefaults`; see `OrchestratorOptions`. */
  push?: boolean
  localOnly?: boolean
  adapters?: string[]
  frameworkPrefix?: string
  requireBudget?: boolean
  roleTimeoutSeconds?: number
  /** The remote runner (#507): refused unless this is the only repository. */
  runner?: { enabled: boolean }
  /** See `OrchestratorOptions.dispatcher`. */
  dispatcher?: Dispatcher
}

/** What every repository's engine takes unless its entry says otherwise. */
export interface EngineDefaults {
  adapters?: string[]
  frameworkPrefix?: string
  push?: boolean
  localOnly?: boolean
  requireBudget?: boolean
  roleTimeoutSeconds?: number
}

/** The machine's limits: one set, held by the one governor. */
export interface MachineLimits {
  /** Most dispatches — runs and sweeps, across every repository — at once; 0 disables. */
  maxConcurrentDispatches?: number
  /** The machine's spend limit per window, across every repository. */
  spendLimitUsd?: number | null
  spendWindowHours?: number
  /** Budget enforcement (#109), for the governor and every engine alike. */
  budgetEnforcement?: boolean
}

export interface OrchestratorsOptions {
  /** One entry per repository, in the order the round-robin serves them. At least one. */
  repositories: RepositoryEngineConfig[]
  limits?: MachineLimits
  engineDefaults?: EngineDefaults
  /** The one governor for the process; absent, built from `limits`. */
  governor?: GovernorPort
  heartbeatSeconds?: number
  /** See `OrchestratorOptions.codeRepo`. */
  codeRepo?: string | null
  log?: (line: string) => void
  /** Fired once for the process, whichever engine's loop confirms the fast-forward first. */
  onSupersede?: (status: CodeTreeStatus) => void
}

/** One repository's engine, assembled and not yet started. */
export interface AssembledEngine {
  repositoryId: string
  displayName: string
  repoDir: string
  engine: Engine
  scheduler: Scheduler
  manifestStaleProbe: () => Promise<string[]>
  runnerCallback?: RunnerCallback
  /** The process log with this repository's `[display name] ` prefix. */
  log: (line: string) => void
}

/** A running engine: its assembly and its loop. */
export interface RunningEngine extends AssembledEngine {
  loop: RunLoop
}

/** An in-flight dispatch, with the display name of the repository it runs in. */
export interface RepositoryInFlightJob extends InFlightJob {
  repository: string
}

export interface OrchestratorsHandle {
  engines: RunningEngine[]
  governor: GovernorPort
  /**
   * Drain every engine: each loop stops watching, each engine's in-flight
   * dispatches and sweeps run to their closing commits, and each engine then
   * leaves the governor. Idempotent — a supersede and a signal share one drain.
   */
  stop(): Promise<void>
  /** Every engine's in-flight dispatches, for drain reporting (#150). */
  inFlightDetail(): RepositoryInFlightJob[]
  /** SIGKILL every engine's live harness groups; closing commits still land (#150). Returns how many. */
  abortInFlight(): number
  /** Present only for a list of one with the runner enabled. */
  runnerCallback?: RunnerCallback
}

/** A list that names one repository twice (#502): one engine per repository. */
export class DuplicateRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateRepositoryError'
  }
}

async function gitCommonDir(dir: string): Promise<string | null> {
  try {
    return await realpath((await new Git(dir).run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim())
  } catch {
    return null
  }
}

/**
 * One engine per repository (#502, TOPOLOGY.md §3.1): refuse a list that names
 * one repository twice — the same directory once resolved, the same id without
 * regard to case, or two worktrees of one clone, whose runs are one set of
 * branches. Two engines over one set of runs is the forbidden topology.
 */
async function refuseDuplicates(repositories: RepositoryEngineConfig[]): Promise<void> {
  const seen: { entry: RepositoryEngineConfig; top: string; common: string | null }[] = []
  const label = (e: RepositoryEngineConfig) => `${e.displayName ?? e.repositoryId} (${e.repositoryId} at ${e.repoDir})`
  for (const entry of repositories) {
    if (!entry.repositoryId) throw new Error(`repository at ${entry.repoDir} has no id — the caller must supply one`)
    const top = await realpath((await repoToplevel(entry.repoDir)) ?? entry.repoDir).catch(() => entry.repoDir)
    const common = await gitCommonDir(entry.repoDir)
    for (const prior of seen) {
      const both = `${label(prior.entry)} and ${label(entry)}`
      if (prior.top === top) throw new DuplicateRepositoryError(`${both} are the same repository: both resolve to ${top} — one engine per repository`)
      if (repositoryIdKey(prior.entry.repositoryId) === repositoryIdKey(entry.repositoryId))
        throw new DuplicateRepositoryError(`${both} have the same id, compared without case — one engine per repository`)
      if (common !== null && prior.common === common)
        throw new DuplicateRepositoryError(`${both} share one git directory (${common}): they are checkouts of one clone, whose runs are one set of branches — one engine per repository`)
    }
    seen.push({ entry, top, common })
  }
}

/**
 * Assemble one engine per repository under one governor, without starting
 * any (#502). `startOrchestrators` is this followed by `start()`; the split
 * lets a caller (a test) reach an engine before its loop runs.
 */
export async function assembleOrchestrators(
  opts: OrchestratorsOptions,
): Promise<{ engines: AssembledEngine[]; governor: GovernorPort; start(): Promise<OrchestratorsHandle> }> {
  const { repositories } = opts
  if (repositories.length === 0) throw new Error('startOrchestrators needs at least one repository')
  if (repositories.length > 1 && repositories.some((r) => r.runner?.enabled))
    throw new Error('the remote runner serves one repository (#507, MULTI-REPO.md §8.5) — it cannot be enabled with several')
  await refuseDuplicates(repositories)
  const limits = opts.limits ?? {}
  const defaults = opts.engineDefaults ?? {}
  // One governor for the process (#501, #502): every engine and every
  // scheduler is admitted by it, so no engine ever takes the fallback that
  // builds one of its own.
  const governor =
    opts.governor ??
    new Governor({
      maxConcurrentDispatches: limits.maxConcurrentDispatches,
      spendLimitUsd: limits.spendLimitUsd ?? null,
      spendWindowMs: limits.spendWindowHours !== undefined ? limits.spendWindowHours * 3_600_000 : undefined,
      budgetEnforcement: limits.budgetEnforcement,
      log: opts.log,
    })
  const engines: AssembledEngine[] = []
  // In list order, one after another: registration order is the round-robin's.
  for (const entry of repositories) {
    const displayName = entry.displayName ?? lastIdSegment(entry.repositoryId)
    // Every line an engine, its scheduler and its loop write names the
    // repository by display name (#502).
    const log = (line: string) => opts.log?.(`[${displayName}] ${line}`)
    const assembled = await assembleOrchestrator({
      repoDir: entry.repoDir,
      adapters: entry.adapters ?? defaults.adapters,
      frameworkPrefix: entry.frameworkPrefix ?? defaults.frameworkPrefix,
      push: entry.push ?? defaults.push,
      localOnly: entry.localOnly ?? defaults.localOnly,
      requireBudget: entry.requireBudget ?? defaults.requireBudget,
      roleTimeoutSeconds: entry.roleTimeoutSeconds ?? defaults.roleTimeoutSeconds,
      spendLimitUsd: limits.spendLimitUsd ?? null,
      budgetEnforcement: limits.budgetEnforcement,
      governor,
      repository: entry.repositoryId,
      displayName,
      repositorySpendLimitUsd: entry.spendLimitUsd,
      runner: entry.runner,
      dispatcher: entry.dispatcher,
      log,
    })
    engines.push({
      repositoryId: entry.repositoryId,
      displayName,
      repoDir: entry.repoDir,
      engine: assembled.engine,
      scheduler: assembled.scheduler,
      manifestStaleProbe: assembled.manifestStaleProbe,
      runnerCallback: assembled.runnerCallback,
      log,
    })
  }
  let started = false
  return {
    engines,
    governor,
    async start() {
      if (started) throw new Error('these engines were already started')
      started = true
      return startAssembled(engines, governor, opts)
    },
  }
}

async function startAssembled(engines: AssembledEngine[], governor: GovernorPort, opts: OrchestratorsOptions): Promise<OrchestratorsHandle> {
  // Every engine seeds before any loop starts (#501, #502): the governor
  // grants nothing until every registered repository has counted its open
  // dispatches, and a loop's first tick is what would ask. A seed that fails
  // is not fatal: the engine is marked failed, and it leaves the governor so
  // that it holds no other repository back. Its first tick seeds it again,
  // re-registering it in the same step, so it never rejoins unseeded.
  const seeds = await Promise.allSettled(engines.map((e) => e.engine.seedGovernor()))
  seeds.forEach((result, i) => {
    if (result.status === 'fulfilled') return
    const e = engines[i]!
    e.engine.noteFault('seed', result.reason)
    if (engines.length > 1) e.log('it leaves the governor until it seeds, so no other repository waits for it')
    governor.unregister(e.repositoryId)
  })
  // One code-tree monitor for the process (MULTI-REPO.md §8.3 P5): the code
  // tree is *this module's own* checkout — resolved from our own
  // import.meta.url, not from any repository (a run source may live in a
  // different checkout under a host-repo setup). With several engines their
  // loops share its checks, so one pause idles all of them and one fast-
  // forward supersedes all of them, once.
  const codeRepo = opts.codeRepo !== undefined ? opts.codeRepo : resolveCodeRepo(import.meta.url)
  const codeMonitor = codeRepo ? await CodeTreeMonitor.create(codeRepo) : undefined
  const shared = codeMonitor && engines.length > 1 ? new SharedCodeTree(codeMonitor) : undefined
  let superseded = false
  const onSupersede = (status: CodeTreeStatus) => {
    if (superseded) return
    superseded = true
    opts.onSupersede?.(status)
  }
  const loops: RunLoop[] = []
  try {
    for (const e of engines) {
      loops.push(
        await runLoop(e.engine, e.repoDir, {
          heartbeatMs: (opts.heartbeatSeconds ?? 180) * 1000,
          scheduler: e.scheduler,
          log: e.log,
          staleProbe: e.manifestStaleProbe,
          codeMonitor: shared ? shared.view(e.repositoryId) : codeMonitor,
          onSupersede,
        }),
      )
    }
  } catch (err) {
    // A loop that cannot start is a startup failure: stop what started, and
    // leave nothing registered behind.
    await Promise.allSettled(loops.map((l) => l.stop()))
    for (const e of engines) governor.unregister(e.repositoryId)
    throw err
  }
  const running: RunningEngine[] = engines.map((e, i) => ({ ...e, loop: loops[i]! }))
  let stopping: Promise<void> | null = null
  return {
    engines: running,
    governor,
    stop: () =>
      (stopping ??= Promise.allSettled(
        running.map(async (e) => {
          await e.loop.stop()
          // Drained: leave the governor. Its spend in the window keeps counting.
          e.engine.unregister()
        }),
      ).then(() => undefined)),
    inFlightDetail: () => running.flatMap((e) => e.engine.inFlightDetail().map((job) => ({ ...job, repository: e.displayName }))),
    abortInFlight: () => running.reduce((n, e) => n + e.engine.abortInFlight(), 0),
    runnerCallback: running.length === 1 ? running[0]!.runnerCallback : undefined,
  }
}

/**
 * Run one engine per repository in this process, under one governor, one
 * code-tree monitor and one shutdown path (#502, MULTI-REPO.md §8). The caller
 * hands over the list — this package reads no config file — with each entry's
 * id already derived. Refuses a list that names one repository twice.
 *
 * Order of startup: every engine is assembled and registered with the
 * governor, then every engine seeds, then the loops start. A failure in one
 * engine at run time — a tick that throws, a closing commit that throws —
 * marks that engine failed in its own health file and leaves the others
 * running (triggers.ts, engine.ts).
 */
export async function startOrchestrators(opts: OrchestratorsOptions): Promise<OrchestratorsHandle> {
  return (await assembleOrchestrators(opts)).start()
}

export interface OrchestratorHandle {
  engine: Engine
  /** Drain in-flight dispatches and stop watching. */
  stop(): Promise<void>
  /** What is currently dispatched, for drain reporting (#150). */
  inFlightDetail(): InFlightJob[]
  /** SIGKILL live harness groups; closing commits still land (#150). */
  abortInFlight(): number
  /**
   * Present iff `opts.runner?.enabled` — pass straight through to the
   * server's `ServeOptions.runnerCallback` (main.ts) to arm the runner
   * agent's poll/claim/report routes over this same engine.
   */
  runnerCallback?: RunnerCallback
}

/**
 * Resident orchestrator over an existing clone, in-process: a list of one
 * through `startOrchestrators` (#502), with the repository's id derived from
 * its origin when the caller gives none.
 */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const repositoryId = opts.repository ?? (await defaultRepositoryId(opts.repoDir))
  const handle = await startOrchestrators({
    repositories: [
      {
        repoDir: opts.repoDir,
        repositoryId,
        displayName: opts.displayName,
        spendLimitUsd: opts.repositorySpendLimitUsd,
        push: opts.push,
        localOnly: opts.localOnly,
        adapters: opts.adapters,
        frameworkPrefix: opts.frameworkPrefix,
        requireBudget: opts.requireBudget,
        roleTimeoutSeconds: opts.roleTimeoutSeconds,
        runner: opts.runner,
        dispatcher: opts.dispatcher,
      },
    ],
    limits: {
      maxConcurrentDispatches: opts.maxConcurrentDispatches,
      spendLimitUsd: opts.spendLimitUsd,
      spendWindowHours: opts.spendWindowHours,
      budgetEnforcement: opts.budgetEnforcement,
    },
    governor: opts.governor,
    heartbeatSeconds: opts.heartbeatSeconds,
    codeRepo: opts.codeRepo,
    log: opts.log,
    onSupersede: opts.onSupersede,
  })
  return {
    engine: handle.engines[0]!.engine,
    stop: () => handle.stop(),
    inFlightDetail: () => handle.inFlightDetail(),
    abortInFlight: () => handle.abortInFlight(),
    runnerCallback: handle.runnerCallback,
  }
}
