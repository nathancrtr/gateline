// Triggers (ORCHESTRATOR.md §4.1): all funnel into the same tick and none
// carries information — the state does. Ref watcher (human decisions, agent
// commits, other orchestrators), dispatch completion (Engine.onSettled),
// heartbeat (missed events, stale aging), and manual (the CLI's `tick`).
// The ref-watch mirrors the frontend server's freshness watcher.
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { Git } from '@agentic/core'
import type { Engine } from './engine.ts'
import type { Scheduler } from './schedule.ts'

export interface RunLoopConfig {
  heartbeatMs?: number
  debounceMs?: number
  /** When present, every tick also reconciles orchestrator.yaml's schedules (§4.6). */
  scheduler?: Scheduler
  log?: (line: string) => void
}

export interface RunLoop {
  stop(): Promise<void>
}

const DEFAULT_HEARTBEAT_MS = 3 * 60 * 1000

/** Resident mode: keep reconciling until stopped. Ticks never overlap. */
export async function runLoop(engine: Engine, repoDir: string, cfg: RunLoopConfig = {}): Promise<RunLoop> {
  let stopped = false
  let ticking = false
  let queued = false

  const tick = async (why: string) => {
    if (stopped) return
    if (ticking) {
      queued = true
      return
    }
    ticking = true
    try {
      // Freshness is the engine's own job in a standalone topology (#104):
      // sync on heartbeat and startup, where the trigger cause is known.
      // Never on refs/completion ticks — our own fetch writes FETCH_HEAD
      // under the watched .git dir, so syncing there would re-trigger the
      // watcher forever; the heartbeat bounds staleness instead.
      if (why === 'heartbeat' || why === 'startup') await engine.syncFromRemote()
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
    } catch (e) {
      cfg.log?.(`tick failed: ${(e as Error).message}`)
    } finally {
      ticking = false
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
  }
}
