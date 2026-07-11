// Triggers (ORCHESTRATOR.md §4.1): all funnel into the same tick and none
// carries information — the state does. Ref watcher (human decisions, agent
// commits, other orchestrators), dispatch completion (Engine.onSettled),
// heartbeat (missed events, stale aging), and manual (the CLI's `tick`).
// The ref-watch mirrors the frontend server's freshness watcher.
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { Git } from '@agentic/core'
import type { Engine } from './engine.ts'

export interface RunLoopConfig {
  heartbeatMs?: number
  debounceMs?: number
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
      do {
        queued = false
        const outcomes = await engine.tick()
        for (const o of outcomes) {
          if (o.action.kind !== 'rest') cfg.log?.(`[${why}] ${o.slug}: ${o.action.kind} (${o.action.rule}) ${o.detail}`)
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
    },
  }
}
