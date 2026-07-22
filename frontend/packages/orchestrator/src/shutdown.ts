// Staged operator shutdown (#150). A resident orchestrator's Ctrl-C already
// drained — children run detached, so the terminal's SIGINT never reaches
// them — but it drained blind: no word on what is in flight or how long it
// has run, and no escalation short of kill -9 (which orphans the closing
// bookkeeping). The ladder makes each stage explicit and honest:
//
//   1st signal — drain: no new dispatches; in-flight work runs to its normal
//                close (ledger entries land). Progress lines while waiting.
//   2nd signal — abort: SIGKILL the harness process groups. The dispatches
//                resolve through the ordinary failure path, so closing
//                commits still land and the tasks are freed for retry
//                (killed work, closed books — the #144/#148 semantics).
//   3rd signal — exit now: open entries are left for the next orchestrator
//                heartbeat to age out (§4.4 crash recovery) — stated, not
//                silent.
import type { InFlightJob } from './engine.ts'

export interface ShutdownTarget {
  inFlight(): InFlightJob[]
  /** Stop watching and wait for in-flight dispatches to close. */
  drain(): Promise<void>
  /** SIGKILL live harness groups; closing commits still land. */
  abort(): number
  log(line: string): void
  /** Injectable for tests; process.exit in production. */
  exit(code: number): void
  /** Interval between "still draining" reports (default 60s). */
  progressMs?: number
}

function describeJob(j: InFlightJob, now: number): string {
  const mins = Math.max(0, Math.round((now - j.startedAt) / 60000))
  return `  ${j.role}${j.task ? `(${j.task}${j.round ? ` r${j.round}` : ''})` : ''} on ${j.slug} — running ${mins}min`
}

/** Build the signal handler; install it for both SIGINT and SIGTERM. */
export function stagedShutdown(t: ShutdownTarget): () => void {
  let stage = 0
  let progress: NodeJS.Timeout | null = null
  const stopProgress = () => {
    if (progress) clearInterval(progress)
    progress = null
  }
  return () => {
    stage++
    if (stage === 1) {
      const jobs = t.inFlight()
      if (jobs.length === 0) {
        t.log('no dispatches in flight — stopping')
      } else {
        t.log(
          `draining ${jobs.length} in-flight dispatch(es) — they run to completion and close their ledger entries; ^C again to abort them (SIGKILL; closing commits still land)`,
        )
        for (const j of jobs) t.log(describeJob(j, Date.now()))
        progress = setInterval(() => {
          const live = t.inFlight()
          if (live.length === 0) return
          t.log(`still draining ${live.length} dispatch(es):`)
          for (const j of live) t.log(describeJob(j, Date.now()))
        }, t.progressMs ?? 60_000)
      }
      void t.drain().then(() => {
        stopProgress()
        t.log('drained — all ledger entries closed')
        t.exit(0)
      })
      return
    }
    if (stage === 2) {
      const n = t.abort()
      t.log(
        `aborting: SIGKILLed ${n} harness process group(s) — closing commits will land and free the tasks for retry; ^C once more to exit without waiting`,
      )
      return
    }
    stopProgress()
    t.log('exiting now — open ledger entries will be aged out by the next orchestrator heartbeat')
    t.exit(130)
  }
}
