// Triggers (ORCHESTRATOR.md §4.1): all funnel into the same tick and none
// carries information — the state does. Ref watcher (human decisions, agent
// commits, other orchestrators), dispatch completion (Engine.onSettled),
// heartbeat (missed events, stale aging), manual (the CLI's `tick`), and the
// governor's wake (#501): a slot this engine was refused may be free.
// The ref-watch mirrors the frontend server's freshness watcher.
import { type FSWatcher, watch } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type CodeTreeMonitor, type CodeTreeState, type CodeTreeStatus, type EngineHealth, engineHealthPath, Git } from '@gateline/core/sources'
import type { Deferral, EngineFault, TickOutcome } from './engine.ts'
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
  /**
   * Be woken by the governor when a slot this engine was refused may be free
   * (#501). The loop subscribes its own trigger, so a wake is one more tick
   * through the one path — ticks still never overlap. Optional for test doubles.
   */
  subscribeWake?(wake: () => Promise<void>): () => void
  /**
   * The fault boundary (#502): a pass that throws is recorded on the engine,
   * which logs it with its repository and reports it in its health file; a
   * pass that completes clears it. Optional for test doubles, whose failures
   * are logged as `tick failed: …` as before.
   */
  noteFault?(where: 'tick', e: unknown): EngineFault
  clearFault?(): void
  /** Additive health-file fields (#502), merged after the standard ones; empty when there is nothing to say. */
  healthFields?(): object
  /** The loop is stopping (#502): admit nothing from now on. Optional for test doubles. */
  beginStop?(): void
}

/**
 * What the loop needs from a code-tree monitor: the real `CodeTreeMonitor`,
 * or one engine's view of a monitor shared by several (`SharedCodeTree`).
 */
export interface CodeMonitorLike {
  readonly startHead: string
  check(): Promise<CodeTreeStatus>
  /**
   * The newest status anyone observed, when the monitor is shared (#502): a
   * loop idles on another loop's non-fresh observation at once, rather than
   * dispatching on mixed code until its own next boundary check.
   */
  latest?(): CodeTreeStatus | null
}

/**
 * One code-tree monitor for a process running several engines (#502,
 * MULTI-REPO.md §8.3 P5). Each engine's loop checks the tree at its own
 * boundaries, as it always has, but the monitor's debounce counts
 * *consecutive checks*, so several loops calling it independently would
 * confirm a fast-forward sooner the more engines there were.
 *
 * So the checks are shared by generation. A loop that has not yet seen the
 * current generation's result gets it without a new check; a loop that has
 * seen it starts the next generation. With one loop every boundary checks,
 * exactly as with the monitor itself. With several, the tree is checked about
 * once per heartbeat whichever loop's heartbeat comes first, a fast-forward is
 * confirmed after two such checks, and every loop reads the newest status
 * (`latest`) before every pass, so a pause idles all of them at once.
 */
export class SharedCodeTree {
  private readonly monitor: CodeMonitorLike
  private generation = 0
  private current: Promise<CodeTreeStatus> | null = null
  private newest: CodeTreeStatus | null = null
  private readonly seen = new Map<string, number>()

  constructor(monitor: CodeMonitorLike) {
    this.monitor = monitor
  }

  get startHead(): string {
    return this.monitor.startHead
  }

  /** The view one loop is given, under a name unique among the loops. */
  view(loop: string): CodeMonitorLike {
    return {
      startHead: this.monitor.startHead,
      check: () => this.check(loop),
      latest: () => this.newest,
    }
  }

  private check(loop: string): Promise<CodeTreeStatus> {
    if (this.current === null || this.seen.get(loop) === this.generation) {
      this.generation++
      const pass = this.monitor.check()
      this.current = pass
      pass.then(
        (status) => {
          if (this.current === pass) this.newest = status
        },
        () => {
          // A failed check is the loop's to report ("tick failed"); the next check retries.
          if (this.current === pass) this.current = null
        },
      )
    }
    this.seen.set(loop, this.generation)
    return this.current
  }
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
  codeMonitor?: CodeTreeMonitor | CodeMonitorLike
  /** Fired exactly once, after the heartbeat write, when the monitor confirms a clean fast-forward past startHead. */
  onSupersede?: (status: CodeTreeStatus) => void
  log?: (line: string) => void
  /** Advisory staleness check run on heartbeat ticks; returned lines are logged (#150). */
  staleProbe?: () => Promise<string[]>
  /**
   * Whether `runLoop` resolves only after its startup pass has finished
   * (default true, as before #502). `startOrchestrators` passes false, so one
   * repository's slow or hung first pass does not hold up the others, or the
   * handle a caller needs to install its signal handlers.
   */
  awaitStartup?: boolean
  /**
   * How long `stop()` waits for the pass that is running before it drains
   * without it (default `STOP_WAIT_MS`; #502). See `STOP_WAIT_MS`.
   */
  stopWaitMs?: number
}

/** The same trigger classes ORCHESTRATOR.md §4.1 describes — named so tests can fire one deterministically instead of racing real timers/watchers. */
export type TriggerReason = 'startup' | 'heartbeat' | 'refs' | 'completion' | 'wake'

export interface RunLoop {
  stop(): Promise<void>
  /**
   * Run the same tick a real trigger of this kind would. The promise
   * resolves once a pass that began after this call has finished — the
   * running pass, if one is under way, does not count.
   */
  trigger(why: TriggerReason): Promise<void>
  /** Resolves when the startup pass has finished (#502) — already, unless the loop was started with `awaitStartup: false`. */
  readonly started: Promise<void>
}

const isBoundary = (why: TriggerReason) => why === 'heartbeat' || why === 'startup'

/**
 * After this many passes in a row have thrown, the loop runs only boundary
 * passes (heartbeat, startup) until one completes (#502). A transient fault
 * is retried on the next trigger of any kind; a persistent one is retried
 * once per heartbeat, never in a loop of refs and wake triggers.
 */
export const FAULT_BACKOFF_AFTER = 2

/**
 * How long `stop()` waits for the running pass (#502): 30 seconds. The stop
 * flags already keep that pass from reserving or committing anything new, so
 * the wait only protects a dispatch that is already past its intent commit —
 * its push and its launch, so that the drain sees the job. An intent commit is
 * local plumbing, milliseconds; its push is one small ref update, a few
 * seconds even on a slow link and rarely more than twenty. Thirty covers that
 * with room, and holds a supersede — which drains before it exits 75 — for
 * half a minute at most on a pass that never returns (a git call stuck on a
 * lock, a remote that does not answer), not for ever. The drain after it keeps
 * its own bounds: a launched role is still killed at its role timeout, and a
 * second ^C still aborts.
 */
export const STOP_WAIT_MS = 30_000

const DEFAULT_HEARTBEAT_MS = 3 * 60 * 1000

let healthWrites = 0

/**
 * Write the engine's health file whole (#502): to a temporary file beside it,
 * then renamed over it, so a reader never sees it half written. Core's
 * `writeEngineHealth` truncates the file and then writes it, and a reader
 * that lands between the two reads an empty file — core's own reader then
 * reports no engine at all for that moment. The format is the same.
 */
async function writeHealthAtomically(repoDir: string, health: EngineHealth): Promise<void> {
  const path = await engineHealthPath(repoDir)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${healthWrites++}.tmp`
  await writeFile(tmp, JSON.stringify(health, null, 2), 'utf8')
  await rename(tmp, path)
}

/** A duration in the words the log uses: `400 ms`, `1.5 s`, `30 s`. */
export function describeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`
}

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
  // At most one pass runs and at most one waits behind it; every trigger that
  // lands while a pass runs joins the waiting one (#501). The waiting pass
  // takes the strongest reason it was asked for — a heartbeat or startup
  // among them makes it a boundary pass (sync, drift check) — and each
  // trigger's promise resolves when a pass that began after it has finished,
  // which is what lets the governor wait on a wake it sent.
  let running: Promise<void> | null = null
  let queued: { why: TriggerReason; promise: Promise<void>; resolve: () => void } | null = null

  // Self-supersede (#141): the last boundary check's result governs every
  // tick's body — not just the boundary ticks that produced it — because a
  // completion or refs trigger landing while the tree is paused/pending must
  // not run mixed code either. `wasFresh` and `firedSupersede` are edge
  // detectors: log the first non-fresh observation of a streak once, and
  // fire the callback once for the loop's whole life.
  let lastStatus: CodeTreeStatus | null = null
  let wasFresh = true
  let firedSupersede = false
  // A monitor shared by several loops (#502) is read for its newest status,
  // which may be another loop's observation; the real monitor has only ours.
  const codeStatus = (): CodeTreeStatus | null => {
    const monitor = cfg.codeMonitor as CodeMonitorLike | undefined
    return monitor?.latest ? (monitor.latest() ?? lastStatus) : lastStatus
  }
  // Passes that threw, in a row (#502): past FAULT_BACKOFF_AFTER only boundary passes run.
  let failedPasses = 0
  let backoffLogged = false

  const start = (why: TriggerReason): Promise<void> => {
    const pass = runPass(why).finally(() => {
      running = null
      const next = queued
      queued = null
      if (!next) return
      if (stopped) next.resolve()
      else start(next.why).then(next.resolve, next.resolve)
    })
    running = pass
    return pass
  }

  const tick = (why: TriggerReason): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (!running) return start(why)
    if (queued) {
      if (isBoundary(why) && !isBoundary(queued.why)) queued.why = why
      return queued.promise
    }
    let resolve: () => void = () => {}
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    queued = { why, promise, resolve }
    return promise
  }

  const runPass = async (why: TriggerReason) => {
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
      const fresh = !cfg.codeMonitor || (codeStatus()?.state ?? 'fresh') === 'fresh'
      const backingOff = failedPasses >= FAULT_BACKOFF_AFTER && !isBoundary(why)
      if (backingOff && !backoffLogged) {
        backoffLogged = true
        cfg.log?.(`${failedPasses} passes in a row failed — until one completes, this engine retries on the heartbeat only`)
      }
      if (fresh && !backingOff) {
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
        const outcomes = await engine.tick()
        for (const o of outcomes) {
          if (o.action.kind !== 'rest') cfg.log?.(`[${why}] ${o.slug}: ${o.action.kind} (${o.action.rule}) ${o.detail}`)
        }
        if (cfg.scheduler) {
          for (const s of await cfg.scheduler.tick()) {
            if (s.kind !== 'rest') cfg.log?.(`[${why}] sweep(${s.slug ?? s.role}): ${s.kind}${s.rule ? ` (${s.rule})` : ''} ${s.detail}`)
          }
        }
        // The pass completed: a standing fault is behind the engine (#502).
        failedPasses = 0
        backoffLogged = false
        engine.clearFault?.()
      }
      // else: idle. Not dispatching on mixed code is the whole point of D2 —
      // the loop still counts as having ticked (the heartbeat below fires).
    } catch (e) {
      // The tick's fault boundary (#502): the engine records it, logs it with
      // its repository and reports it in its health file. The loop carries on,
      // so the next trigger retries — or the next heartbeat, once the faults
      // repeat — and nothing reaches the process as an unhandled rejection.
      failedPasses++
      if (engine.noteFault) engine.noteFault('tick', e)
      else cfg.log?.(`tick failed: ${(e as Error).message}`)
    }
    // Liveness heartbeat (#100): written after every pass, read by the
    // co-located frontend. Under the git common dir — machine-local, never
    // committed; its presence marks "an engine runs on this deployment".
    // Kept up while paused/pending too — that's how Gatehouse surfaces drift.
    try {
      const status = codeStatus()
      const codeFields = cfg.codeMonitor
        ? {
            commit: cfg.codeMonitor.startHead,
            codeHead: status?.codeHead ?? cfg.codeMonitor.startHead,
            codeState: heartbeatCodeState(status?.state ?? 'fresh'),
            // No fallback, unlike codeHead: `reason` exists only on `paused`,
            // and JSON.stringify drops undefined keys — which is what makes
            // the field self-clearing once the tree recovers to fresh.
            codeReason: status?.reason,
            codeCause: status?.cause,
            codeUpgradeBlocked: status?.upgradeBlocked,
          }
        : {}
      const health: EngineHealth = {
        at: new Date().toISOString(),
        pid: process.pid,
        heartbeatMs: cfg.heartbeatMs ?? DEFAULT_HEARTBEAT_MS,
        inFlight: engine.inFlight(),
        pushRejections: Object.fromEntries(engine.pushHealth()),
        // Sweeps the governor held back sit beside the runs (#501): the chip
        // names what is held and why, whatever it is.
        deferrals: [...(engine.deferrals?.() ?? []), ...(cfg.scheduler?.deferrals() ?? [])],
        ...codeFields,
        // Additive fields the reader in core does not know yet (#502, #499):
        // `failed` and `unseeded`, present only while they say something.
        ...(engine.healthFields?.() ?? {}),
      }
      await writeHealthAtomically(repoDir, health)
    } catch (e) {
      cfg.log?.(`engine-health write failed: ${(e as Error).message}`)
    }
    // Supersede (#141): fire exactly once for the loop's life, after the
    // heartbeat carrying the confirming check has been written. The callback
    // owner (gateline up, gateline-orchestrator watch) decides to drain and
    // exit; the loop itself keeps idling since state stays non-fresh.
    const confirmed = codeStatus()
    if (!firedSupersede && confirmed?.state === 'supersede-confirmed') {
      firedSupersede = true
      cfg.log?.(`code tree moved ${confirmed.startHead}..${confirmed.codeHead}, superseding`)
      cfg.onSupersede?.(confirmed)
    }
  }

  // Dispatch completion → tick (the closing commit just landed).
  engine.onSettled = () => void tick('completion')
  // The governor's wake → tick (#501): another engine, a sweep, or this
  // engine's own settlement freed a slot this engine was refused.
  const unsubscribeWake = engine.subscribeWake?.(() => tick('wake'))

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

  const started = tick('startup')
  if (cfg.awaitStartup !== false) await started

  return {
    started,
    async stop() {
      stopped = true
      // Admit nothing from here (#502): a pass already under way cannot
      // reserve, commit or launch once it resumes.
      engine.beginStop?.()
      cfg.scheduler?.beginStop()
      clearInterval(heartbeat)
      if (timer) clearTimeout(timer)
      for (const w of watchers) w.close()
      engine.onSettled = null
      unsubscribeWake?.()
      // Wait for the pass that is running (#502), up to a bound. The one queued
      // behind it is resolved without running, since `stopped` is set. Before
      // #502 the drain began at once, and a pass still running could launch a
      // role after it returned. Waiting without a bound was the opposite
      // mistake: a pass that never returns kept the drain, the supersede exit
      // and the first ^C from ever finishing.
      if (running) {
        const bound = cfg.stopWaitMs ?? STOP_WAIT_MS
        const passes = (async () => {
          while (running) await running.catch(() => {})
        })()
        let noticed: ReturnType<typeof setTimeout> | undefined
        let expired: ReturnType<typeof setTimeout> | undefined
        const outcome = await Promise.race([
          passes.then(() => 'done' as const),
          new Promise<'late'>((resolve) => {
            noticed = setTimeout(() => cfg.log?.('still waiting for the running pass before draining'), Math.min(1000, bound / 2))
            expired = setTimeout(() => resolve('late'), bound)
          }),
        ])
        clearTimeout(noticed)
        clearTimeout(expired)
        if (outcome === 'late')
          cfg.log?.(
            `the running pass did not finish within ${describeMs(bound)} — stopping without it: it can admit nothing more, ` +
              'and a role it had already committed and not yet launched may start after this drain, close on its own, or be aged out by the stale sweep after a restart',
          )
      }
      await engine.drain()
      await cfg.scheduler?.drain()
    },
    trigger: tick,
  }
}
