// The contact-surface-scoped diff (#270): the run's changed files joined
// against the `file_contact_surface` each work item declared it would touch.
//
// This is the view #259 chose to replace the generic unified-diff renderer,
// under FRONTEND.md principle 7. A unified diff is a commodity — the host's is
// better and always will be. This one depends on knowledge no host has: which
// work item claimed which files, before the work began. It makes the Reviewer's
// `Boundary check` section checkable rather than assertable.
//
// Presence, not verdicts. This module says a changed file falls under no
// declared surface. It does not say that is wrong — surfaces widen legitimately
// through an architect amendment or a gate human's decision (roles/architect.md
// "Amendment mode", WALKTHROUGH.md), and judging the change is the approver's
// job and the Reviewer's section. Nothing here scores, ranks, or flags.
//
// Scoping is never truncation. The derivation labels the diff; it never filters
// it. `declaredBy` is positional against the file list it was given, so every
// changed file remains present whether or not any item claimed it.
//
// Where the work splits: this module derives the labelling from committed state
// and the server ships it. Arranging the labelled diff for reading — which
// group leads, what collapses — is view work and lives in web/src/surface.ts,
// the way web/src/landing.ts already holds "which artifact opens".
import { inSurface, type TaskSet, type WorkItem } from './tasks.ts'
import type { DiffFile } from './unidiff.ts'

/**
 * A work item as the diff view needs it: enough to name the item and show the
 * approver what its membership was judged against, without shipping the scope
 * and notes prose that belong on the artifact page.
 */
export interface SurfaceItemRef {
  id: string
  title: string
  /** Run-relative path of the work item, for linking back to the record. */
  path: string
  /** Null when the status cell is not a word contracts/work-item.yaml names. */
  status: WorkItem['status']
  /** The status cell verbatim. */
  statusText: string
  /** The declared surface, verbatim — what membership below was judged against. */
  surface: string[]
}

export interface SurfaceScopedDiff {
  /** Readable work items, in the order the task set gave them. */
  items: SurfaceItemRef[]
  /**
   * Positional against the file list this was derived from: for each changed
   * file, the ids of the items declaring contact with it. An empty entry is a
   * file no item declared — a fact, not a finding.
   */
  declaredBy: string[][]
  /**
   * Why the scoping must withhold itself, or null when it applies. A run with
   * no readable task set gets the plain diff and this reason, per the fork
   * fallback (FRONTEND.md §4.1) — never a diff silently labelled from nothing.
   */
  withheld: string | null
}

/** Both sides of a rename count: a surface may name the path before or after. */
function pathsOf(file: DiffFile): string[] {
  return [file.newPath, file.oldPath].filter((p, i, all) => p !== '' && all.indexOf(p) === i)
}

/**
 * Label each changed file with the work items that declared it. Pure in both
 * inputs — no repository access, no host, no network — which is why a
 * `local_only` run gets exactly the same view as any other.
 */
export function scopeDiff(files: DiffFile[], set: TaskSet): SurfaceScopedDiff {
  const readable = set.items.filter((i) => i.withheld === null)
  return {
    items: readable.map((item) => ({
      id: item.id,
      title: item.title,
      path: item.path,
      status: item.status,
      statusText: item.statusText,
      surface: item.fileContactSurface,
    })),
    declaredBy: files.map((file) =>
      readable.filter((item) => pathsOf(file).some((p) => inSurface(item, p))).map((item) => item.id),
    ),
    withheld: set.withheld,
  }
}

/**
 * Indices of files no readable item declared — the Boundary check made
 * checkable, stated as the fact it is. Positional against the same file list.
 */
export function undeclaredIndices(scoped: SurfaceScopedDiff): number[] {
  return scoped.declaredBy.flatMap((ids, i) => (ids.length === 0 ? [i] : []))
}
