// Branch order: what "after" means when the clocks disagree (#346).
//
// Half the reconcile loop asks recency questions — did the human resolve this
// escalation after the reviewer's verdict landed, did the amendment land after
// the resolution, has anything landed since this dispatch opened. Every one of
// them used to be answered by subtracting two timestamps, and those timestamps
// come from three different machines: the one that served the human's decision
// (`resolved_at`, milliseconds), the committer that landed the artifact
// (seconds), and the engine host that wrote the ledger entry. A hosted engine
// with a laptop CLI is the documented topology (DEPLOY.md §2), and seconds of
// skew flip the comparison in either direction — a genuine resolution reading
// older than the verdict re-escalates forever, one reading newer than a commit
// it preceded routes a round that should not run.
//
// The record already carries an order that no clock can contradict: the run
// branch. `state.yaml` commits and artifact landings are linear on it, and
// git's log never shows a parent before its child, so a commit's position in
// one log of the run directory is a total order consistent with ancestry —
// lower position, later commit. Every fact these rules compare is committed
// under that directory, so one log places all of them.
//
// Timestamps keep their honest jobs: they are what a card shows a human, and
// they are the fallback when a commit cannot be placed (a source with no
// history to offer, an observation built by hand in a test). A fallback is not
// a guess about ordering — it is the previous answer, which is still better
// than deciding on nothing.
import type { CommitInfo } from './git.ts'
import type { RunRef, RunSource, StateCommit } from './source.ts'

/**
 * Positions of a run's commits on its branch, newest first. Built once per
 * observation; every comparison after that is a map lookup.
 */
export class BranchOrder {
  private readonly positions: Map<string, number>

  constructor(commits: readonly CommitInfo[] = []) {
    this.positions = new Map()
    commits.forEach((c, i) => {
      if (!this.positions.has(c.oid)) this.positions.set(c.oid, i)
    })
  }

  /** Whether this index placed any commit at all — false for the empty fallback. */
  get known(): boolean {
    return this.positions.size > 0
  }

  /** Position of `oid` (0 at the branch tip), or null when the index never saw it. */
  position(oid: string | null | undefined): number | null {
    if (!oid) return null
    return this.positions.get(oid) ?? null
  }

  /**
   * True when `oid` is strictly later on the branch than `than`, false when it
   * is the same commit or earlier, and **null** when either commit is
   * unplaceable — the caller's cue to fall back to timestamps rather than to
   * treat "unknown" as "no".
   */
  after(oid: string | null | undefined, than: string | null | undefined): boolean | null {
    const a = this.position(oid)
    const b = this.position(than)
    if (a === null || b === null) return null
    return a < b
  }
}

/**
 * Read a run's branch order, or an empty index when the source cannot offer
 * one (`runHistory` is optional — a driver that has no history to walk says so
 * by omitting it, and every comparison then falls back to clocks).
 */
export async function readBranchOrder(source: RunSource, ref: RunRef): Promise<BranchOrder> {
  if (!source.runHistory) return new BranchOrder()
  try {
    return new BranchOrder(await source.runHistory(ref))
  } catch {
    return new BranchOrder()
  }
}

/**
 * Per escalation index, the state commit in which `resolved` became true — the
 * record's own answer to "when did the human resolve this", which `resolved_at`
 * only claims (#346).
 *
 * `history` is newest first, as `stateHistory` returns it. Escalations are
 * append-only and their indices are stable, so index `i` here is index `i` at
 * the tip. The commit wanted is the *oldest* one in the trailing run of being
 * resolved: keep overwriting while `resolved` holds, and settle the moment an
 * older commit shows it false, so a hand un-resolve-and-resolve-again reports
 * the second resolution rather than the first.
 *
 * The engine and Gatehouse both read this, from one definition, because the
 * round-cap card must vanish exactly when rule D4 stands down.
 */
export function resolutionCommitsOf(history: readonly StateCommit[], count: number): (CommitInfo | null)[] {
  const commits: (CommitInfo | null)[] = Array.from({ length: count }, () => null)
  const settled = new Set<number>()
  for (const commit of history) {
    if (!commit.state) continue
    commit.state.escalations.forEach((e, i) => {
      if (i >= count || settled.has(i)) return
      if (e.resolved) commits[i] = commit
      else if (commits[i] !== null) settled.add(i)
    })
  }
  return commits
}
