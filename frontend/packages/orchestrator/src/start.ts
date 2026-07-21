// Orchestrator assembly as a library (#100): the same engine + scheduler +
// run loop the `agentic-orchestrator` binary drives, callable in-process so
// a frontend can co-locate the engine over its own clone (`agentic up`) —
// one deployment, one clone, one authority (docs/TOPOLOGY.md §3.1).
import { Git, LocalGitSource, type Identity } from '@agentic/core'
import { Engine } from './engine.ts'
import { loadHeadlessManifest } from './manifest.ts'
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
  /** Wall clock per dispatched role before its process group is killed (default 30 min). */
  roleTimeoutSeconds?: number
  heartbeatSeconds?: number
  log?: (line: string) => void
}

export async function assembleOrchestrator(opts: OrchestratorOptions): Promise<{ engine: Engine; scheduler: Scheduler }> {
  const log = opts.log ?? (() => {})
  const git = new Git(opts.repoDir)
  const registry = await loadRegistry(git, await git.defaultBranch(), opts.frameworkPrefix)
  const adapters = await Promise.all(
    (opts.adapters?.length ? opts.adapters : ['claude-code']).map(async (name) => {
      const manifest = await loadHeadlessManifest(opts.repoDir, name, opts.frameworkPrefix)
      return { manifest, dispatcher: new HeadlessDispatcher(manifest) }
    }),
  )
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
  const engine = new Engine({
    ...common,
    spendLimitUsd: opts.spendLimitUsd ?? null,
    requireBudget: opts.requireBudget,
    roleTimeoutMs: opts.roleTimeoutSeconds !== undefined ? opts.roleTimeoutSeconds * 1000 : undefined,
  })
  const scheduler = new Scheduler(common)
  return { engine, scheduler }
}

export interface OrchestratorHandle {
  engine: Engine
  /** Drain in-flight dispatches and stop watching. */
  stop(): Promise<void>
}

/** Resident orchestrator over an existing clone, in-process. */
export async function startOrchestrator(opts: OrchestratorOptions): Promise<OrchestratorHandle> {
  const { engine, scheduler } = await assembleOrchestrator(opts)
  const loop: RunLoop = await runLoop(engine, opts.repoDir, {
    heartbeatMs: (opts.heartbeatSeconds ?? 180) * 1000,
    scheduler,
    log: opts.log,
  })
  return { engine, stop: () => loop.stop() }
}
