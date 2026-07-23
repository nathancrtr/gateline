// The runner's relay half (ORCHESTRATOR.md / TOPOLOGY.md §3.3, run "runner-agent"
// ADR-1): `RemoteDispatcher` is a `Dispatcher` peer to `HeadlessDispatcher` that
// never spawns a harness itself. Its `dispatch()` turns the engine's call into a
// long-lived Promise, parked in an in-process queue, that resolves only when the
// workstation agent — polling `pendingIntents()` and reporting through
// `resolveOutcome()` — hands back a real `DispatchOutcome`. This keeps the seam
// (seam.ts) the engine's only dispatch call site and its only metering point:
// the relay adds a transport, not a second seam.
import type { DispatchOutcome, DispatchRequest, Dispatcher } from './seam.ts'

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
 *  pending dispatch correlate on sight once linked. */
function fullKey(slug: string, role: string, task: string | null, round: number | null): string {
  return `${slug}|${role}|${task ?? ''}|${round ?? ''}`
}

/** Ledger entries carry no branch (branch is a run-level fact, not per-dispatch); group pending calls by the pair that *is* on both sides. */
function groupKey(slug: string, role: string): string {
  return `${slug}|${role}`
}

interface PendingCall {
  req: DispatchRequest
  resolve: (outcome: DispatchOutcome) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  /** Set once `pendingIntents` has surfaced this call under a full ledger key; null until then. */
  linkedKey: string | null
}

/**
 * The relay `Dispatcher`: satisfies the same interface `HeadlessDispatcher`
 * does, but never touches a child process or a filesystem. `dispatch()` parks
 * a promise; the workstation agent (task 04) is the only thing that ever
 * settles it, via `resolveOutcome`.
 *
 * Correlation note: `DispatchRequest` (seam.ts) carries `slug` and `branch`
 * but not `task`/`round` — task 01 threaded only the fields R2 named, and
 * extending `DispatchRequest` further is outside this task's file-contact
 * surface. A ledger entry (`OpenLedgerEntry`), by contrast, always carries
 * `task`/`round`. So a pending call is provisionally grouped by `slug|role`
 * (branch is constant per run, so it adds no discriminating power) and only
 * gets its full `slug|role|task|round` key — the one `resolveOutcome` is
 * called with — once `pendingIntents` links it to a specific open ledger
 * entry, in FIFO order within that group. For the common case (at most one
 * open dispatch per role per run) this is exact; for parallel same-role
 * dispatches (parallel implementers on distinct tasks) it assumes intents are
 * drained in dispatch order, which holds as long as the workstation reports
 * outcomes for intents it was actually handed. A future task extending
 * `DispatchRequest` with `task`/`round` (mirroring task 01's `slug`/`branch`
 * addition) would let dispatch() key directly and retire this layer.
 */
export class RemoteDispatcher implements Dispatcher, RunnerCallback {
  readonly adapter: string
  /** Pending calls not yet linked to a full ledger key, FIFO per `slug|role`. */
  private readonly queues = new Map<string, PendingCall[]>()
  /** Pending calls once linked to the full `slug|role|task|round` key `resolveOutcome` is called with. */
  private readonly linked = new Map<string, PendingCall>()

  constructor(adapter = 'runner') {
    this.adapter = adapter
  }

  dispatch(req: DispatchRequest): Promise<DispatchOutcome> {
    if (!req.slug || !req.branch) {
      throw new Error('RemoteDispatcher.dispatch requires req.slug and req.branch (run identity) to route to a workstation')
    }
    const slug = req.slug
    const role = req.role
    return new Promise<DispatchOutcome>((resolve, reject) => {
      const call: PendingCall = {
        req,
        resolve,
        reject,
        linkedKey: null,
        timer: setTimeout(() => {
          this.retire(call)
          reject(new Error(`runner dispatch timed out after ${Math.round(req.timeoutMs / 60000)}min — no workstation report`))
        }, req.timeoutMs),
      }
      const key = groupKey(slug, role)
      const queue = this.queues.get(key)
      if (queue) queue.push(call)
      else this.queues.set(key, [call])
    })
  }

  pendingIntents(openEntries: OpenLedgerEntry[]): PendingIntent[] {
    const intents: PendingIntent[] = []
    for (const entry of openEntries) {
      const key = fullKey(entry.slug, entry.role, entry.task, entry.round)
      let call = this.linked.get(key)
      if (!call) {
        const queue = this.queues.get(groupKey(entry.slug, entry.role))
        const candidate = queue?.find((c) => c.linkedKey === null)
        if (!candidate) continue // no pending call this dispatcher is holding for that entry
        candidate.linkedKey = key
        this.linked.set(key, candidate)
        call = candidate
      }
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
    const call = this.linked.get(key)
    if (!call) return false
    this.retire(call)
    call.resolve(outcome)
    return true
  }

  /** Removes a call from every internal index and cancels its timeout, regardless of whether it was ever linked. */
  private retire(call: PendingCall): void {
    clearTimeout(call.timer)
    if (call.linkedKey) this.linked.delete(call.linkedKey)
    for (const [key, queue] of this.queues) {
      const index = queue.indexOf(call)
      if (index >= 0) {
        queue.splice(index, 1)
        if (queue.length === 0) this.queues.delete(key)
        break
      }
    }
  }
}
