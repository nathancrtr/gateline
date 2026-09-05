// The budget ledger: the append-only list of dispatches the engine keeps under
// `budget.ledger` in a run's `state.yaml`. One entry per agent launch — opened
// when the dispatch is committed, closed when the job reports a cost (or is
// marked `failed`). An entry with `cost_usd: null` and `failed: false` is
// therefore an agent believed to be *in flight*, which is the only durable
// record of that fact: the engine holds no session state (ORCHESTRATOR.md §4.2).
//
// This lives in `record/` rather than in the orchestrator because two readings
// need it and they must not drift. The engine reads it to meter spend, to close
// its own dispatches, and to rest while a producer is out (rule D12); the
// frontend reads it to know that the artifact on a gate card is being replaced
// (readiness's in-flight row, #159). The parse is deliberately defensive — the
// ledger rides in `budget`'s passthrough fields, so a hand-edited or
// older-schema entry must degrade to a null field rather than throw.
import type { RunState } from './schema.ts'

/**
 * One dispatch, as the ledger spells it. Named for the budget ledger to keep it
 * distinct from `view-model/ledger.ts`'s `LedgerEntry`, which is a parsed commit
 * subject — a different ledger entirely, and both reach the package root.
 */
export interface BudgetLedgerEntry {
  at: string | null
  role: string
  task: string | null
  round: number | null
  adapter: string | null
  model: string | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  failed: boolean
  /** Closed without a process ever spawning (#155): $0, not a failure, not a retry spent. */
  refused: boolean
  /**
   * Which engine process opened this entry (#349), as `<hostname>:<pid>`.
   * Null on entries written before the key existed, and on hand-written ones.
   *
   * The stale sweep is the only reader: an open entry says "an agent is
   * running", and without a name on it a second engine cannot tell a crashed
   * process's orphan from another process's live job — it aged both after
   * `staleMs` and re-dispatched, putting two agents on one task. With the
   * name, a sweep ages its own entries (and unnamed ones) on the short
   * window and another engine's only once no live job could still hold it.
   */
  engine: string | null
}

/**
 * How long an open ledger entry may stand before a reader stops believing it.
 *
 * The engine's own `DEFAULT_ROLE_TIMEOUT_MS` (orchestrator/src/engine.ts) is
 * this constant: a dispatch that has not finished by then is one the engine
 * kills, and its heartbeat ages the entry out shortly after. A reader using a
 * different number would either suppress a gate the engine had already given up
 * on, or surface one the engine still has a live job for — so the two are one
 * constant, imported, rather than two literals that agree today.
 */
export const ROLE_TIMEOUT_MS = 30 * 60 * 1000

/** The ledger rides in budget's passthrough fields; parse it defensively. */
export function parseLedger(state: RunState | null): BudgetLedgerEntry[] {
  const raw = (state?.budget as Record<string, unknown> | null)?.ledger
  if (!Array.isArray(raw)) return []
  const entries: BudgetLedgerEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.role !== 'string') continue
    entries.push({
      at: typeof e.at === 'string' ? e.at : e.at instanceof Date ? e.at.toISOString() : null,
      role: e.role,
      task: typeof e.task === 'string' ? e.task : null,
      round: typeof e.round === 'number' ? e.round : null,
      adapter: typeof e.adapter === 'string' ? e.adapter : null,
      model: typeof e.model === 'string' ? e.model : null,
      tokens_in: typeof e.tokens_in === 'number' ? e.tokens_in : null,
      tokens_out: typeof e.tokens_out === 'number' ? e.tokens_out : null,
      cost_usd: typeof e.cost_usd === 'number' ? e.cost_usd : null,
      failed: e.failed === true,
      refused: e.refused === true,
      engine: typeof e.engine === 'string' && e.engine !== '' ? e.engine : null,
    })
  }
  return entries
}

/** An entry opened by a dispatch and not yet closed: work believed to be in flight. */
export function isOpenDispatch(entry: BudgetLedgerEntry): boolean {
  return entry.cost_usd === null && !entry.failed
}
