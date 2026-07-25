// Orchestrator assembly as a library (#100): the same engine + scheduler +
// run loop the `agentic-orchestrator` binary drives, callable in-process so
// a frontend can co-locate the engine over its own clone (`agentic up`) —
// one deployment, one clone, one authority (docs/TOPOLOGY.md §3.1).
import { stat } from 'node:fs/promises'
import { CodeTreeMonitor, Git, LocalGitSource, LocalOnlyPushConflictError, resolveCodeRepo, type CodeTreeStatus, type Identity } from '@agentic/core'
import { Engine, type InFlightJob } from './engine.ts'
import { headlessManifestPath, loadHeadlessManifest } from './manifest.ts'
import { loadRegistry } from './registry.ts'
import { RemoteDispatcher, type PendingIntent } from './runner-dispatcher.ts'
import { RoutingDispatcher } from './router.ts'
import { Scheduler } from './schedule.ts'
import { HeadlessDispatcher, type DispatchOutcome } from './seam.ts'
import { runLoop, type RunLoop } from './triggers.ts'

/**
 * The zero-argument shape @agentic/server's own `RunnerCallback` expects
 * (runner-api.ts) — mirrored structurally here rather than imported, so this
 * package carries no edge to `@agentic/server` (the same no-edge convention
 * runner-api.ts documents in the other direction, toward this package).
 * Structurally assignable to `@agentic/server`'s `RunnerCallback` — a caller
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
  name: 'agentic-orchestrator',
  email: 'orchestrator@agentic.invalid',
}

export interface OrchestratorOptions {
  repoDir: string
  /** Headless adapter names; the first is the default runner (default: claude-code). */
  adapters?: string[]
  /** Metadata prefix of an integrate.py --prefix host, when not `.agentic`. */
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
  /**
   * Budget *enforcement* switch (#109), default on: false disables the
   * DB/RB/HB pauses — for operators billed flat-rate, where dollar caps do
   * not map to marginal cost. Metering stays unconditional.
   */
  budgetEnforcement?: boolean
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
   * false dispatches exactly as before (AC9.1).
   */
  runner?: { enabled: boolean }
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
  const registry = await loadRegistry(git, await git.defaultBranch(), opts.frameworkPrefix)
  const watched: { adapter: string; path: string; loadedMtimeMs: number }[] = []
  const adapters = await Promise.all(
    (opts.adapters?.length ? opts.adapters : ['claude-code']).map(async (name) => {
      const manifest = await loadHeadlessManifest(opts.repoDir, name, opts.frameworkPrefix)
      const path = await headlessManifestPath(opts.repoDir, name, opts.frameworkPrefix)
      watched.push({ adapter: name, path, loadedMtimeMs: (await stat(path).catch(() => null))?.mtimeMs ?? 0 })
      return { manifest, dispatcher: new HeadlessDispatcher(manifest) }
    }),
  )
  // Manifests are read once, at process start (the 2026-07-16 trap: an
  // on-disk fix silently never applied). The probe reports a manifest whose
  // file changed after load, once per change — the heartbeat surfaces it.
  const manifestStaleProbe = async (): Promise<string[]> => {
    const messages: string[] = []
    for (const w of watched) {
      const mtimeMs = (await stat(w.path).catch(() => null))?.mtimeMs ?? 0
      if (mtimeMs > w.loadedMtimeMs) {
        w.loadedMtimeMs = mtimeMs
        messages.push(`adapter manifest "${w.adapter}" changed on disk after load — manifests are read once at startup; restart to apply (${w.path})`)
      }
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
    adapters.length === 1 && !registry
      ? adapters[0]!.dispatcher
      : new RoutingDispatcher(adapters, registry ?? { profiles: {}, bindings: {}, pricing: {}, estimates: {} }, log)
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
  const engine = new Engine({
    ...common,
    dispatcher: remote ?? localDispatcher,
    spendLimitUsd: opts.spendLimitUsd ?? null,
    requireBudget: opts.requireBudget,
    budgetEnforcement: opts.budgetEnforcement,
    roleTimeoutMs: opts.roleTimeoutSeconds !== undefined ? opts.roleTimeoutSeconds * 1000 : undefined,
  })
  // Scheduler stays on `common` — i.e. always the local dispatcher, never remote.
  const scheduler = new Scheduler(common)
  const runnerCallback = remote ? makeRunnerCallback(engine, remote) : undefined
  return { engine, scheduler, manifestStaleProbe, runnerCallback }
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

/** Resident orchestrator over an existing clone, in-process. */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const { engine, scheduler, manifestStaleProbe, runnerCallback } = await assembleOrchestrator(opts)
  // Self-supersede (#141): the code tree is *this module's own* checkout —
  // resolved from our own import.meta.url, not from opts.repoDir (the run
  // source, which may live in a different checkout under a host-repo setup).
  const codeRepo = resolveCodeRepo(import.meta.url)
  const codeMonitor = codeRepo ? await CodeTreeMonitor.create(codeRepo) : undefined
  const loop: RunLoop = await runLoop(engine, opts.repoDir, {
    heartbeatMs: (opts.heartbeatSeconds ?? 180) * 1000,
    scheduler,
    log: opts.log,
    staleProbe: manifestStaleProbe,
    codeMonitor,
    onSupersede: opts.onSupersede,
  })
  return {
    engine,
    stop: () => loop.stop(),
    inFlightDetail: () => engine.inFlightDetail(),
    abortInFlight: () => engine.abortInFlight(),
    runnerCallback,
  }
}
