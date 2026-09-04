import type { HistoryEntry } from './api.ts'

/**
 * The decision ledger at real scale (#283): on `web-staging`, 8 human
 * decisions sit among 63 engine rows, and the eye has to scan past dozens of
 * dispatches and meterings to find the next decision. The typographic split
 * from #268 tells the two registers apart; it does not shorten the walk.
 *
 * So each run of consecutive engine rows between two human decisions folds
 * into one summary row that expands in place. Presence, not verdicts: the
 * summary states counts and metered totals already present in the rows —
 * arithmetic over the record's own numbers, nothing derived beyond that — and
 * every row stays reachable, byte-identical, one click away.
 *
 * Short spans are left alone. A span of two engine rows is not noise, and the
 * fixture runs (nine rows at most) should look exactly as they did.
 */

/**
 * A span of engine rows shorter than this renders as its rows. Six is one
 * review round — implementer and reviewer each dispatched and metered, then
 * the two `advanced` bookkeeping rows — and a single round still reads at a
 * glance. The fixture runs' longest span is five, so they are untouched.
 */
export const SPAN_MIN_ROWS = 6

export interface EngineSpan {
  kind: 'span'
  /** Inclusive index range into the history (newest first, as served). */
  from: number
  to: number
  count: number
  /** Verb → how many rows carry it, in first-seen order. */
  verbs: [string, number][]
  /** Sum of the `$n.nn` figures on the span's `metered` rows; null when none carry one. */
  meteredUsd: number | null
  /** Phases the run entered inside the span, newest first. */
  entered: string[]
}

export type LedgerRow = { kind: 'row'; index: number } | EngineSpan

const USD = /\$(\d+(?:\.\d+)?)/

/** Fold long engine spans; leave every human row and every short span as rows. */
export function collapseEngineSpans(history: readonly HistoryEntry[], minRows = SPAN_MIN_ROWS): LedgerRow[] {
  const out: LedgerRow[] = []
  let i = 0
  while (i < history.length) {
    if (history[i]!.ledger.actor !== 'orchestrator') {
      out.push({ kind: 'row', index: i })
      i++
      continue
    }
    let j = i
    while (j + 1 < history.length && history[j + 1]!.ledger.actor === 'orchestrator') j++
    const count = j - i + 1
    if (count < minRows) {
      for (let k = i; k <= j; k++) out.push({ kind: 'row', index: k })
    } else {
      out.push(summarize(history, i, j))
    }
    i = j + 1
  }
  return out
}

function summarize(history: readonly HistoryEntry[], from: number, to: number): EngineSpan {
  const verbs = new Map<string, number>()
  let meteredUsd: number | null = null
  const entered: string[] = []
  for (let k = from; k <= to; k++) {
    const h = history[k]!
    const verb = h.ledger.verb || h.ledger.kind
    verbs.set(verb, (verbs.get(verb) ?? 0) + 1)
    if (h.ledger.kind === 'metered') {
      const m = USD.exec(h.ledger.detail)
      if (m) meteredUsd = (meteredUsd ?? 0) + Number(m[1])
    }
    // The same rule the row renderer uses: a row is a transition when the
    // row after it (older) sits in a different phase.
    if (h.phase && k + 1 < history.length && history[k + 1]!.phase !== h.phase) entered.push(h.phase)
  }
  return {
    kind: 'span',
    from,
    to,
    count: to - from + 1,
    verbs: [...verbs.entries()],
    meteredUsd: meteredUsd === null ? null : Math.round(meteredUsd * 100) / 100,
    entered,
  }
}
