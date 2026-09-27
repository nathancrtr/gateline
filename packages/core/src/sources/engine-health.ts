// Engine liveness (#100): a machine-local heartbeat the co-located frontend
// reads, so a landed decision with no engine consuming it renders as an
// outage instead of "waiting on gate" (the 2026-07-15 nobody-is-listening
// incident). Lives under the git common dir — never committed, shared by
// every worktree of the clone.
//
// This file says whether a heartbeat is there and how old it is. Whether an
// engine is *expected* is not the file's to say: it comes from the
// repository's mode (docs/MULTI-REPO.md §9.5, #499). A `dispatch` repository
// expects one, so a stale or absent heartbeat there is an outage; a `view` or
// `decide` repository expects none, so the same file is a plain fact about an
// engine outside this deployment, or about none. The table is applied where
// it is shown (`packages/web/src/liveness.ts`), from the mode on
// `/api/health` and the heartbeat on `/api/engine-health`. Before modes the
// file's presence was the expectation, and a source that states no mode is
// still read that way there.
//
// The file is written by an engine that may be newer than this reader, and
// later engines add fields (#502 is adding some). A field this reader does
// not know is ignored, never an error; `readEngineHealth` checks only the two
// it cannot do without.
//
// Deliberately machine-local: an engine on another machine (a laptop `up`
// against the same origin) cannot be observed from here — cross-machine
// liveness would need committed state and is the #106 runner agent's
// territory, not this file's.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CodeTreeCause } from './code-tree.ts'
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
   * `codeReason` is set only when `codeState === 'paused'` and carries the
   * monitor's `CodeTreeStatus.reason` verbatim, so a viewer can show *why*
   * the engine paused rather than a generic message.
   */
  commit?: string
  codeHead?: string
  codeState?: 'fresh' | 'superseded-pending' | 'paused'
  codeReason?: string
  /** The monitor's `CodeTreeStatus.cause`, present only while paused (#222) — what a viewer keys tone on. */
  codeCause?: CodeTreeCause
  /** True while a dirty tree is also holding back a clean fast-forward the engine would otherwise restart onto (#222). */
  codeUpgradeBlocked?: boolean
  /**
   * What the engine held back on its last pass without writing anything
   * (#97): a self-clearing ceiling — the resource cap, the host spend
   * window — defers a run rather than pausing it, so the run's own record
   * says nothing about why it is not moving. Reported here, at the level
   * the condition lives, so Gatehouse can show a host-level cause as a
   * host-level chip instead of a per-run escalation pointing at a file
   * that contains no such number. Optional so pre-#97 heartbeats parse.
   */
  deferrals?: EngineDeferral[]
}

/**
 * Which of the governor's limits held a dispatch back (#501, written since
 * #513). The engine's `GovernorLimit` is the writer; this is the reader's
 * copy of its four values, since core does not import the orchestrator.
 * A later engine may write one this list does not know, so a reader keeps
 * the value it finds and names it as written.
 */
export const DEFERRAL_LIMITS = ['concurrency', 'turn', 'spend', 'repository-spend'] as const
export type DeferralLimit = (typeof DEFERRAL_LIMITS)[number]

export interface EngineDeferral {
  slug: string
  /** The engine rule that deferred it (MC, HB, …). */
  rule: string
  /** The rule's own words — the arithmetic and the flag, verbatim. */
  reason: string
  /** ISO timestamp of the first pass that deferred this run for this rule. */
  since: string
  /**
   * The governor limit that refused it, when the governor did (#513): MC and
   * HB each cover more than one limit now. Absent from engines before #513,
   * and on a deferral the governor did not make. A string outside
   * `DEFERRAL_LIMITS` is kept as written.
   */
  limit?: DeferralLimit | (string & {})
  /** The repository the deferral belongs to, as the governor keys it (#513). */
  repository?: string
}

/**
 * A heartbeat's deferrals, each reduced to the fields above. The file is
 * written by an engine that may be newer than this reader, so a field this
 * reader does not know is left out rather than passed on, and an entry
 * missing a field every deferral has is dropped rather than shown in part.
 */
export function readDeferrals(raw: unknown): EngineDeferral[] {
  if (!Array.isArray(raw)) return []
  const out: EngineDeferral[] = []
  for (const d of raw as Record<string, unknown>[]) {
    if (!d || typeof d !== 'object') continue
    const { slug, rule, reason, since, limit, repository } = d
    if (typeof slug !== 'string' || typeof rule !== 'string' || typeof reason !== 'string' || typeof since !== 'string') continue
    out.push({
      slug,
      rule,
      reason,
      since,
      ...(typeof limit === 'string' ? { limit } : {}),
      ...(typeof repository === 'string' ? { repository } : {}),
    })
  }
  return out
}

/** Whether a heartbeat is there, and if so whether it is recent (§9.5). */
export type Heartbeat = 'fresh' | 'stale' | 'absent'

/** The heartbeat's state: absent when no file has been written, else fresh or stale by `engineHealthStale`. */
export function heartbeatOf(health: EngineHealth | null, now: Date = new Date()): Heartbeat {
  if (health === null) return 'absent'
  return engineHealthStale(health, now) ? 'stale' : 'fresh'
}

/** Grace beyond the expected cadence before a heartbeat reads as stale. */
const STALE_GRACE_MS = 60_000

export async function engineHealthPath(repoDir: string): Promise<string> {
  const common = (await new Git(repoDir).run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  return join(common, 'gateline', 'engine-health.json')
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
    if (typeof parsed?.at !== 'string' || typeof parsed.heartbeatMs !== 'number') return null
    return parsed.deferrals === undefined ? parsed : { ...parsed, deferrals: readDeferrals(parsed.deferrals) }
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
