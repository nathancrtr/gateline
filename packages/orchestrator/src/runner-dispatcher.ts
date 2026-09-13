// The runner's relay half (ORCHESTRATOR.md / TOPOLOGY.md §3.3, run "runner-agent"
// ADR-1): `RemoteDispatcher` is a `Dispatcher` peer to `HeadlessDispatcher` that
// never spawns a harness itself. Its `dispatch()` turns the engine's call into a
// long-lived Promise, parked in an in-process map, that resolves only when the
// workstation agent — polling `pendingIntents()` and reporting through
// `resolveOutcome()` — hands back a real `DispatchOutcome`. This keeps the seam
// (seam.ts) the engine's only dispatch call site and its only metering point:
// the relay adds a transport, not a second seam.
import type { Dispatcher, DispatchOutcome, DispatchRequest } from './seam.ts'

/**
 * A projection of the engine's ledger entry (`observe.ts`'s `LedgerEntry`) that
 * `pendingIntents` needs to identify an open dispatch: the run it belongs to
 * (ledger entries are per-run and carry no slug of their own) plus the fields
 * that distinguish one open dispatch from another within that run. The
 * dispatcher never reads the ledger itself — the caller (the server, wiring
 * task 03/05) reads it via `observeRun` and projects it into this shape.
 */
export interface OpenLedgerEntry {
  slug: string
  role: string
  task: string | null
  round: number | null
}

/** One dispatch the workstation agent can claim and execute. */
export interface PendingIntent {
  /** Correlates a future `resolveOutcome(key, ...)` call back to this dispatch's pending promise. */
  key: string
  slug: string
  branch: string
  role: string
  task: string | null
  round: number | null
  body: string
  timeoutMs: number
  /** The commit the engine armed this dispatch at (ADR-2's pin) — what the workstation
   *  checks out and what the harvest fold rebases onto. `RemoteDispatcher` never reads
   *  the repo, so it cannot supply this itself; left undefined here and augmented by
   *  the server (task 03), which does have the repo, before the intent reaches the wire. */
  baseOid?: string
}

/**
 * The server-facing half of the relay: what the runner API (task 03) polls and
 * reports through. `RemoteDispatcher` implements this alongside `Dispatcher` —
 * one object, two interfaces, because the pending-promise map they share has a
 * single home.
 */
export interface RunnerCallback {
  /**
   * Given the engine's currently open ledger entries (across whichever runs
   * this dispatcher serves), returns the subset this dispatcher is actually
   * holding a pending promise for, as intents ready for the workstation to
   * claim. Pure and idempotent: polling again before `resolveOutcome` returns
   * the same intents, keyed the same way.
   */
  pendingIntents(openEntries: OpenLedgerEntry[]): PendingIntent[]
  /**
   * Resolves the pending `dispatch()` promise matching `key` (a key
   * previously handed out in a `PendingIntent`) with the workstation's
   * reported outcome. Returns false when no pending dispatch matches — the
   * key names a dispatch already resolved, timed out, or never issued by
   * this dispatcher — so the caller (the report route) can treat that as a
   * no-op rather than throwing.
   */
  resolveOutcome(key: string, outcome: DispatchOutcome): boolean
}

/** Mirrors engine.ts's private `jobKey` format, so an open ledger entry and a
 *  pending dispatch correlate on sight. */
function fullKey(slug: string, role: string, task: string | null, round: number | null): string {
  return `${slug}|${role}|${task ?? ''}|${round ?? ''}`
}

interface PendingCall {
  req: DispatchRequest
  resolve: (outcome: DispatchOutcome) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Renders a timeout for a human reading the ledger's error field — `Math.round(ms /
 *  60000)` alone reports "0min" for any sub-30s timeout (every unit test's timeoutMs,
 *  and any short role timeout in practice), which reads as "instant" rather than "short". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60_000)}min`
}

/**
 * The relay `Dispatcher`: satisfies the same interface `HeadlessDispatcher`
 * does, but never touches a child process or a filesystem. `dispatch()` parks
 * a promise; the workstation agent (task 04) is the only thing that ever
 * settles it, via `resolveOutcome`.
 *
 * Correlation (ADR-7): `DispatchRequest` (seam.ts) carries `task`/`round` alongside
 * `slug`/`branch` — the engine's `launch()` threads them straight from the dispatch
 * intent, exactly as it threads `slug`/`branch`. So `dispatch()` keys its pending map
 * directly by `slug|role|task|round`, the same key an `OpenLedgerEntry` carries: no
 * FIFO grouping or linking step, and so no dependency on the order dispatch() is
 * called in versus the order the ledger is projected in. (An earlier version of this
 * dispatcher grouped pending calls by `slug|role` and linked them to a full key in
 * dispatch order on the first `pendingIntents` poll; review-02.md F1 found that a
 * reordered dispatch-call sequence — e.g. two parallel implementer checkouts racing —
 * could cross-wire two same-role dispatches. Keying at dispatch time removes the
 * class of bug rather than testing around it.)
 */
export class RemoteDispatcher implements Dispatcher, RunnerCallback {
  readonly adapter: string
  readonly managesOwnWorkspace = true
  /** Pending calls, keyed by the same `slug|role|task|round` key `resolveOutcome` is called with. */
  private readonly calls = new Map<string, PendingCall>()

  constructor(adapter = 'runner') {
    this.adapter = adapter
  }

  dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    if (!req.slug || !req.branch) {
      throw new Error('RemoteDispatcher.dispatch requires req.slug and req.branch (run identity) to route to a workstation')
    }
    const key = fullKey(req.slug, req.role, req.task ?? null, req.round ?? null)
    return new Promise<DispatchOutcome>((resolve, reject) => {
      const call: PendingCall = {
        req,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.calls.delete(key)
          reject(new Error(`runner dispatch timed out after ${formatDuration(req.timeoutMs)} — no workstation report`))
        }, req.timeoutMs),
      }
      this.calls.set(key, call)
    })
  }

  pendingIntents(openEntries: OpenLedgerEntry[]): PendingIntent[] {
    const intents: PendingIntent[] = []
    for (const entry of openEntries) {
      const key = fullKey(entry.slug, entry.role, entry.task, entry.round)
      const call = this.calls.get(key)
      if (!call) continue // no pending call this dispatcher is holding for that entry
      intents.push({
        key,
        slug: entry.slug,
        branch: call.req.branch!,
        role: entry.role,
        task: entry.task,
        round: entry.round,
        body: call.req.body,
        timeoutMs: call.req.timeoutMs,
      })
    }
    return intents
  }

  resolveOutcome(key: string, outcome: DispatchOutcome): boolean {
    const call = this.calls.get(key)
    if (!call) return false
    clearTimeout(call.timer)
    this.calls.delete(key)
    call.resolve(outcome)
    return true
  }
}
