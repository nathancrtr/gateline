// A reference to an artifact, as the view-model hands one to a view
// (docs/SEAM.md §7, #415).
//
// The view-model carries references, never bare paths: a component that wants
// to print a label has the kind and the id in hand, and must *choose* to print
// the path. The kind comes from `describeArtifact` in the record layer, the one
// place a path's kind is derived; nothing downstream re-derives it.
import { type ArtifactFamily, type ArtifactKind, describeArtifact } from '../record/artifact.ts'
import type { ReviewReport } from './review.ts'

/** What a review report says it reviews, read from the report itself. */
export interface ReviewOf {
  /** The task id its `# Review Report: <id>` header names, or null when the header is unreadable. */
  task: string | null
  /**
   * The round the report is at: the latest `**Round:**` number it carries.
   * Rounds append to one report (`roles/reviewer.md`), so a report on its
   * third round holds rounds 1, 2 and 3 and is at round 3. Null when no round
   * states a number.
   */
  round: number | null
}

export interface ArtifactRef {
  kind: ArtifactKind
  /** See `ArtifactDescription.id`: a work item's id, a review report's number, else null. */
  id: string | null
  /** Run-relative, as `listArtifacts` returns it. The address: provenance, never the label. */
  path: string
  /** The contract filename this artifact is checked against, or null (presence only). */
  contract: string | null
  /** The contract's own name for the kind (`work item`, `review report`), or null for `other`. */
  contractName: string | null
  family: ArtifactFamily
  /**
   * A review report's subject, read from its header — the one fact about a
   * review its path cannot supply. Null on every other kind, and on a review
   * whose report was not read to build this ref (an inbox item's packet: see
   * `InboxItem.packetRefs`).
   */
  reviewOf: ReviewOf | null
}

/** The highest round number a report states, or null when none states one. */
function latestRound(rounds: readonly { round: number | null }[]): number | null {
  let latest: number | null = null
  for (const { round } of rounds) if (round !== null && (latest === null || round > latest)) latest = round
  return latest
}

/**
 * The reference for one run-relative path. `report` is the parsed review
 * report at that path, when the caller has it; without one a review's
 * `reviewOf` is null.
 */
export function artifactRef(path: string, report?: Pick<ReviewReport, 'task' | 'rounds'>): ArtifactRef {
  const { kind, id, contract, contractName, family } = describeArtifact(path)
  const reviewOf = kind === 'review-report' && report ? { task: report.task, round: latestRound(report.rounds) } : null
  return { kind, id, path, contract, contractName, family, reviewOf }
}

/**
 * References for a run's artifacts, in the order given. `reports` are the
 * run's parsed review reports (`parseReview`), matched by path; pass them and
 * every review's `reviewOf` is resolved, so a view names a review by the task
 * it reviews from its first render rather than after a second fetch.
 */
export function artifactRefs(paths: readonly string[], reports: readonly ReviewReport[] = []): ArtifactRef[] {
  const byPath = new Map(reports.map((r) => [r.path, r]))
  return paths.map((path) => artifactRef(path, byPath.get(path)))
}
