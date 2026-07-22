// Engine liveness (#100): a machine-local heartbeat the co-located frontend
// reads, so a landed decision with no engine consuming it renders as an
// outage instead of "waiting on gate" (the 2026-07-15 nobody-is-listening
// incident). Lives under the git common dir — never committed, shared by
// every worktree of the clone. Its *presence* is the expectation signal: a
// viewer-only deployment (no engine ever configured) has no file and gets no
// banner; a deployment whose engine went silent has a stale file and does.
//
// Deliberately machine-local: an engine on another machine (a laptop `up`
// against the same origin) cannot be observed from here — cross-machine
// liveness would need committed state and is the #106 runner agent's
// territory, not this file's.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Git } from './git.ts'

export interface EngineHealth {
  /** ISO timestamp of the last completed reconcile pass. */
  at: string
  pid: number
  /** Configured tick cadence — staleness is measured against it. */
  heartbeatMs: number
  /** Dispatch jobs in flight when the pass completed. */
  inFlight: number
  /** Branch → consecutive rejected pushes (Engine.pushHealth, #103). */
  pushRejections: Record<string, number>
  /**
   * Self-supersede (#141): the code tree's oid at process start, the same
   * tree's on-disk HEAD as of the last boundary check, and the drift state
   * between them. All three are optional so old heartbeat files (written
   * before #141) still parse — a viewer reading a stale file from an
   * unupgraded engine just sees no drift signal, not a parse failure.
   * `codeState` only ever carries these three values: a monitor's internal
   * `supersede-confirmed` maps to `superseded-pending` here, since by the
   * time a confirmed heartbeat is written the process is already draining
   * to exit — there is no steady state to report beyond "pending restart".
   */
  commit?: string
  codeHead?: string
  codeState?: 'fresh' | 'superseded-pending' | 'paused'
}

/** Grace beyond the expected cadence before a heartbeat reads as stale. */
const STALE_GRACE_MS = 60_000

export async function engineHealthPath(repoDir: string): Promise<string> {
  const common = (await new Git(repoDir).run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  return join(common, 'agentic', 'engine-health.json')
}

export async function writeEngineHealth(repoDir: string, health: EngineHealth): Promise<void> {
  const path = await engineHealthPath(repoDir)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(health, null, 2), 'utf8')
}

export async function readEngineHealth(repoDir: string): Promise<EngineHealth | null> {
  try {
    const raw = await readFile(await engineHealthPath(repoDir), 'utf8')
    const parsed = JSON.parse(raw) as EngineHealth
    return typeof parsed.at === 'string' && typeof parsed.heartbeatMs === 'number' ? parsed : null
  } catch {
    return null
  }
}

/** Two missed heartbeats plus grace: the engine is presumed dead or wedged. */
export function engineHealthStale(health: EngineHealth, now: Date = new Date()): boolean {
  const at = Date.parse(health.at)
  if (Number.isNaN(at)) return true
  return now.getTime() - at > 2 * health.heartbeatMs + STALE_GRACE_MS
}
