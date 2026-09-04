// Triggers (ORCHESTRATOR.md §4.1): all funnel into the same tick and none
// carries information — the state does. Ref watcher (human decisions, agent
// commits, other orchestrators), dispatch completion (Engine.onSettled),
// heartbeat (missed events, stale aging), and manual (the CLI's `tick`).
// The ref-watch mirrors the frontend server's freshness watcher.
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { Git, type CodeTreeMonitor, type CodeTreeState, type CodeTreeStatus, writeEngineHealth } from '@gateline/core/sources'
import type { Deferral, TickOutcome } from './engine.ts'
import type { Scheduler } from './schedule.ts'

/**
 * The engine surface `runLoop` actually drives, narrowed from the concrete
 * `Engine` class (which the CLI and `gateline up` pass in) so tests can
 * supply a fake without fighting `Engine`'s private fields — an object
 * literal can't structurally satisfy a class type carrying private state,
 * but a real `Engine` instance satisfies this interface trivially.
 */
export interface EngineLike {
  tick(): Promise<TickOutcome[]>
  syncFromRemote(): Promise<void>
  inFlight(): number
  pushHealth(): ReadonlyMap<string, number>
  /** Runs held back on the last pass and why (#97); optional for older engines and test doubles. */
  deferrals?(): Deferral[]
  drain(): Promise<void>
  onSettled: (() => void) | null
}

export interface RunLoopConfig {
  heartbeatMs?: number
  debounceMs?: number
  /** When present, every tick also reconciles orchestrator.yaml's schedules (§4.6). */
  scheduler?: Scheduler
  /**
   * Self-supersede (#141): watches the *code tree* (the checkout that owns
   * this running module, not any configured run source) for a `git pull`
   * out from under the process. Absent for a viewer-only/npm-installed
   * process with no code repo to watch (`resolveCodeRepo` returns null) —
   * the loop then behaves exactly as it did before #141.
   */
  codeMonitor?: CodeTreeMonitor
  /** Fired exactly once, after the heartbeat write, when the monitor confirms a clean fast-forward past startHead. */
  onSupersede?: (status: CodeTreeStatus) => void
  log?: (line: string) => void
  /** Advisory staleness check run on heartbeat ticks; returned lines are logged (#150). */
  staleProbe?: () => Promise<string[]>
}

/** The same trigger classes ORCHESTRATOR.md §4.1 describes — named so tests can fire one deterministically instead of racing real timers/watchers. */
export type TriggerReason = 'startup' | 'heartbeat' | 'refs' | 'completion'

export interface RunLoop {
  stop(): Promise<void>
  /** Test-only: run the same tick a real trigger of this kind would, awaited to completion. */
  trigger(why: TriggerReason): Promise<void>
}

const DEFAULT_HEARTBEAT_MS = 3 * 60 * 1000

/**
 * A monitor's `supersede-confirmed` reads as `superseded-pending` on the
 * heartbeat (D4, #141): by the time a confirmed check is written the loop
 * is already idling toward a supersede exit — there is no further steady
 * state beyond "pending restart" to report.
 */
function heartbeatCodeState(state: CodeTreeState): 'fresh' | 'superseded-pending' | 'paused' {
  return state === 'supersede-confirmed' ? 'superseded-pending' : state
}

/** Resident mode: keep reconciling until stopped. Ticks never overlap. */
export async function runLoop(engine: EngineLike, repoDir: string, cfg: RunLoopConfig = {}): Promise<RunLoop> {
  let stopped = false
  let ticking = false
  let queued = false

  // Self-supersede (#141): the last boundary check's result governs every
  // tick's body — not just the boundary ticks that produced it — because a
  // completion or refs trigger landing while the tree is paused/pending must
  // not run mixed code either. `wasFresh` and `firedSupersede` are edge
  // detectors: log the first non-fresh observation of a streak once, and
  // fire the callback once for the loop's whole life.
  let lastStatus: CodeTreeStatus | null = null
  let wasFresh = true
  let firedSupersede = false

  const tick = async (why: TriggerReason) => {
    if (stopped) return
    if (ticking) {
      queued = true
      return
    }
    ticking = true
    try {
      // Drift is checked at the same boundaries freshness is (heartbeat and
      // startup only) — never on refs/completion ticks, for the same
      // feedback-loop reason `syncFromRemote` is gated there.
      if (cfg.codeMonitor && (why === 'heartbeat' || why === 'startup')) {
        const status = await cfg.codeMonitor.check()
        if (status.state !== 'fresh' && wasFresh) {
          cfg.log?.(
            `code tree ${status.state === 'paused' ? 'paused' : 'drifted'}: ${status.startHead}..${status.codeHead}` +
              (status.reason ? ` — ${status.reason}` : ''),
          )
        }
        wasFresh = status.state === 'fresh'
        lastStatus = status
      }
      const fresh = !cfg.codeMonitor || (lastStatus?.state ?? 'fresh') === 'fresh'
      if (fresh) {
        // Freshness is the engine's own job in a standalone topology (#104):
        // sync on heartbeat and startup, where the trigger cause is known.
        // Never on refs/completion ticks — our own fetch writes FETCH_HEAD
        // under the watched .git dir, so syncing there would re-trigger the
        // watcher forever; the heartbeat bounds staleness instead.
        if (why === 'heartbeat' || why === 'startup') {
          await engine.syncFromRemote()
          if (cfg.staleProbe) {
            try {
              for (const line of await cfg.staleProbe()) cfg.log?.(line)
            } catch {
              /* advisory only — a probe failure never blocks the tick */
            }
          }
        }
        do {
          queued = false
          const outcomes = await engine.tick()
          for (const o of outcomes) {
            if (o.action.kind !== 'rest') cfg.log?.(`[${why}] ${o.slug}: ${o.action.kind} (${o.action.rule}) ${o.detail}`)
          }
          if (cfg.scheduler) {
            for (const s of await cfg.scheduler.tick()) {
              if (s.kind !== 'rest') cfg.log?.(`[${why}] sweep(${s.slug ?? s.role}): ${s.kind}${s.rule ? ` (${s.rule})` : ''} ${s.detail}`)
            }
          }
        } while (queued && !stopped)
      }
      // else: idle. Not dispatching on mixed code is the whole point of D2 —
      // the loop still counts as having ticked (the heartbeat below fires).
    } catch (e) {
      cfg.log?.(`tick failed: ${(e as Error).message}`)
    } finally {
      ticking = false
    }
    // Liveness heartbeat (#100): written after every pass, read by the
    // co-located frontend. Under the git common dir — machine-local, never
    // committed; its presence marks "an engine runs on this deployment".
    // Kept up while paused/pending too — that's how Gatehouse surfaces drift.
    try {
      const codeFields = cfg.codeMonitor
        ? {
            commit: cfg.codeMonitor.startHead,
            codeHead: lastStatus?.codeHead ?? cfg.codeMonitor.startHead,
            codeState: heartbeatCodeState(lastStatus?.state ?? 'fresh'),
            // No fallback, unlike codeHead: `reason` exists only on `paused`,
            // and JSON.stringify drops undefined keys — which is what makes
            // the field self-clearing once the tree recovers to fresh.
            codeReason: lastStatus?.reason,
            codeCause: lastStatus?.cause,
            codeUpgradeBlocked: lastStatus?.upgradeBlocked,
          }
        : {}
      await writeEngineHealth(repoDir, {
        at: new Date().toISOString(),
        pid: process.pid,
        heartbeatMs: cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
        inFlight: engine.inFlight(),
        pushRejections: Object.fromEntries(engine.pushHealth()),
        deferrals: engine.deferrals?.() ?? [],
        ...codeFields,
      })
    } catch (e) {
      cfg.log?.(`engine-health write failed: ${(e as Error).message}`)
    }
    // Supersede (#141): fire exactly once for the loop's life, after the
    // heartbeat carrying the confirming check has been written. The callback
    // owner (gateline up, gateline-orchestrator watch) decides to drain and
    // exit; the loop itself keeps idling since state stays non-fresh.
    if (!firedSupersede && lastStatus?.state === 'supersede-confirmed') {
      firedSupersede = true
      cfg.log?.(`code tree moved ${lastStatus.startHead}..${lastStatus.codeHead}, superseding`)
      cfg.onSupersede?.(lastStatus)
    }
  }

  // Dispatch completion → tick (the closing commit just landed).
  engine.onSettled = () => void tick('completion')

  // Ref watcher: refs/ + packed-refs, debounced, worktree-correct.
  const git = new Git(repoDir)
  const commonDir = (await git.run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  let timer: NodeJS.Timeout | null = null
  const fire = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void tick('refs')
    }, cfg.debounceMs ?? 300)
  }
  const watchers: FSWatcher[] = []
  const tryWatch = (path: string, recursive: boolean) => {
    try {
      watchers.push(watch(path, { recursive }, fire))
    } catch {
      /* path may not exist (no packed-refs yet) — the heartbeat covers it */
    }
  }
  tryWatch(join(commonDir, 'refs'), true)
  tryWatch(commonDir, false)

  const heartbeat = setInterval(() => void tick('heartbeat'), cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)

  await tick('startup')

  return {
    async stop() {
      stopped = true
      clearInterval(heartbeat)
      if (timer) clearTimeout(timer)
      for (const w of watchers) w.close()
      engine.onSettled = null
      await engine.drain()
      await cfg.scheduler?.drain()
    },
    trigger: tick,
  }
}
