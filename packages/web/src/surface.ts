// Arranging the surface-scoped diff for reading (#270). Core derives the
// labelling — which work item declared which changed file — and this decides
// how the labelled diff is laid out: what leads, what groups, what it is
// called. Same split as landing.ts, which holds "which artifact opens" while
// core holds what the gate packet is.
//
// The ordering rule is one sentence: the files nobody declared come first.
// That is not a severity judgement — an undeclared file is often fine, and
// surfaces widen legitimately — it is that the approver cannot check a boundary
// they have to go looking for. Everything else follows the task set's own order.
import type { DiffFile, SurfaceItemRef, SurfaceScopedDiff } from './api.ts'

export interface SurfaceGroup {
  item: SurfaceItemRef
  files: DiffFile[]
}

export interface ArrangedDiff {
  /** Changed files no readable work item declared. Rendered first. */
  undeclared: DiffFile[]
  /** One group per item that any changed file falls under, in task-set order. */
  groups: SurfaceGroup[]
  /** True when the scoping applies and there is something to scope. */
  scoped: boolean
}

/**
 * Group a diff by the surfaces its files were declared under.
 *
 * A file two items both declared appears under both: the record says two work
 * items claimed it, and picking one would be this view choosing an owner. So
 * the groups and `undeclared` need not partition the diff, and callers keep the
 * full file list either way — scoping labels the diff, it never filters it.
 */
export function arrangeDiff(files: DiffFile[], surface: SurfaceScopedDiff | undefined): ArrangedDiff {
  if (!surface || surface.withheld !== null) return { undeclared: [], groups: [], scoped: false }
  const byId = new Map(surface.items.map((item) => [item.id, [] as DiffFile[]]))
  const undeclared: DiffFile[] = []
  files.forEach((file, i) => {
    const ids = surface.declaredBy[i] ?? []
    if (ids.length === 0) undeclared.push(file)
    for (const id of ids) byId.get(id)?.push(file)
  })
  return {
    undeclared,
    groups: surface.items.map((item) => ({ item, files: byId.get(item.id)! })).filter((g) => g.files.length > 0),
    scoped: files.length > 0,
  }
}

/** Changed files, additions and deletions — the size of what is on the table. */
export function totals(files: DiffFile[]): { files: number; additions: number; deletions: number } {
  return {
    files: files.length,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
  }
}

/** The path a file is known by now — the new one, unless it was deleted. */
export function fileLabel(file: DiffFile): string {
  if (file.status === 'renamed') return `${file.oldPath} → ${file.newPath}`
  return file.newPath || file.oldPath
}

/**
 * The one-line boundary fact, for the G2 packet: what changed, and how much of
 * it nobody declared. Null when the scoping withheld — the packet then says
 * nothing rather than implying a clean check it never ran.
 */
export function boundaryLine(
  files: DiffFile[],
  surface: SurfaceScopedDiff | undefined,
): { changed: number; undeclared: DiffFile[] } | null {
  if (!surface || surface.withheld !== null) return null
  return { changed: files.length, undeclared: arrangeDiff(files, surface).undeclared }
}
// probe: a web-only change, to prove the packages slice skips (#318)
