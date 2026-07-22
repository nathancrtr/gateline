// Orchestrator assembly as a library (#100): the same engine + scheduler +
// run loop the `agentic-orchestrator` binary drives, callable in-process so
// a frontend can co-locate the engine over its own clone (`agentic up`) —
// one deployment, one clone, one authority (docs/TOPOLOGY.md §3.1).
import { stat } from 'node:fs/promises'
import { CodeTreeMonitor, Git, LocalGitSource, resolveCodeRepo, type CodeTreeStatus, type Identity } from '@agentic/core'
import { Engine, type InFlightJob } from './engine.ts'
import { headlessManifestPath, loadHeadlessManifest } from './manifest.ts'
import { loadRegistry } from './registry.ts'
import { RoutingDispatcher } from './router.ts'
import { Scheduler } from './schedule.ts'
import { HeadlessDispatcher } from './seam.ts'
import { runLoop, type RunLoop } from './triggers.ts'

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
): Promise<{ engine: Engine; scheduler: Scheduler; manifestStaleProbe: () => Promise<string[]> }> {
  const log = opts.log ?? (() => {})
  const git = new Git(opts.repoDir)
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
  // Engine and scheduler share one dispatcher, so sweeps meter through the same seam (§6).
  const dispatcher =
    adapters.length === 1 && !registry
      ? adapters[0]!.dispatcher
      : new RoutingDispatcher(adapters, registry ?? { profiles: {}, bindings: {}, pricing: {}, estimates: {} }, log)
  const common = {
    repoDir: opts.repoDir,
    identity: BOT_IDENTITY,
    dispatcher,
    registry,
    frameworkPrefix: opts.frameworkPrefix,
    push: opts.push,
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
    spendLimitUsd: opts.spendLimitUsd ?? null,
    requireBudget: opts.requireBudget,
    budgetEnforcement: opts.budgetEnforcement,
    roleTimeoutMs: opts.roleTimeoutSeconds !== undefined ? opts.roleTimeoutSeconds * 1000 : undefined,
  })
  const scheduler = new Scheduler(common)
  return { engine, scheduler, manifestStaleProbe }
}

export interface OrchestratorHandle {
  engine: Engine
  /** Drain in-flight dispatches and stop watching. */
  stop(): Promise<void>
  /** What is currently dispatched, for drain reporting (#150). */
  inFlightDetail(): InFlightJob[]
  /** SIGKILL live harness groups; closing commits still land (#150). */
  abortInFlight(): number
}

/** Resident orchestrator over an existing clone, in-process. */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const { engine, scheduler, manifestStaleProbe } = await assembleOrchestrator(opts)
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
  }
}
