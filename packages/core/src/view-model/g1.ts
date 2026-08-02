// G1's packet (#255): the two claims the gate actually asks about.
//
// "Is this how we'd want it built, cut into safe parallel pieces?" is two
// questions, and the page helped check neither — plan.md and N task files
// rendered as sibling entries in an alphabetical list, opened one at a time.
// Both claims are mechanically checkable from committed state:
//
//   * Coverage. contracts/plan.md mandates the Requirement → task mapping and
//     says an uncovered requirement is a malformed plan. Gatehouse holds the
//     spec's `R<n>` set and the mapping table, and never compared them.
//   * Parallel safety. `file_contact_surface` and `depends_on` are required
//     work-item keys. Two tasks with no dependency between them and an
//     overlapping surface are the decomposition defect G1 exists to catch.
//
// This is the check no external tool can do, because only Gatehouse holds the
// work items and the spec together.
//
// Presence, not verdicts — the line evidence.ts draws for G2 holds here. This
// states what the record contains: this requirement appears in no mapping row;
// these two surfaces name the same path and no dependency orders them. It
// never scores a plan, never calls a decomposition unsafe, and never computes a
// coverage percentage. Whether an overlap is acceptable is the approver's call
// — two tasks may touch one file by design, which is why an ordered overlap is
// reported as ordered rather than dropped.
import type { Lexicon } from './lexicon.ts'
import { parseRequirementMapping, type MappingRow, type RequirementMapping } from './plan.ts'
import { buildTaskSet, type TaskSet, type WorkItem } from './tasks.ts'

export interface CoverageRow {
  /** 'R1' — a requirement id, from the spec or from the mapping. */
  id: string
  /** The spec's heading title for it, verbatim; '' when the spec does not define it. */
  shortName: string
  /** spec.md defines it; false → the mapping names a requirement the spec does not. */
  defined: boolean
  /** Task tokens the mapping row names, verbatim. */
  mapped: string[]
  /** Of those, the ones matching no committed `tasks/*.yaml` id. */
  unknownTasks: string[]
  /** Ids of work items whose own `requirements:` list claims this requirement. */
  claimedBy: string[]
  /** The mapping row verbatim, or null when no row names this requirement. */
  row: string | null
}

export interface SurfaceOverlap {
  /** The two work-item ids, in the order the set declares them. */
  a: string
  b: string
  /** The surface entries that met, verbatim from each item. */
  entries: { a: string; b: string }[]
  /**
   * A `depends_on` path connects them, in either direction — the overlap is
   * ordered, so the two tasks never run at once. Reported, not hidden: the
   * approver is entitled to see every overlap the record declares.
   */
  ordered: boolean
}

export interface G1Packet {
  /** One row per requirement the spec defines, then any the mapping invents. */
  coverage: CoverageRow[]
  /** Work-item ids no mapping row names — the reverse of an uncovered requirement. */
  unmappedTasks: string[]
  /** Surface overlaps between work items, ordered ones included and marked. */
  overlaps: SurfaceOverlap[]
  /** The work items themselves, so the surface view needs no second fetch. */
  tasks: WorkItem[]
  /** Why the coverage view must withhold itself, or null. */
  mappingWithheld: string | null
  /** Why the parallel-safety view must withhold itself, or null. */
  tasksWithheld: string | null
}

/**
 * Do two surface entries name the same ground? Exact match, or a
 * trailing-slash entry read as a directory prefix — the same rule
 * `tasks.ts:inSurface` applies to a changed file, applied between two
 * declarations. Nothing else is inferred: no globbing, no path normalization.
 */
export function entriesOverlap(a: string, b: string): boolean {
  if (a === b) return true
  if (a.endsWith('/') && b.startsWith(a)) return true
  if (b.endsWith('/') && a.startsWith(b)) return true
  return false
}

/** Ids reachable from `id` by following `depends_on`, transitively. */
function reachable(id: string, edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(edges.get(id) ?? [])]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (seen.has(next)) continue
    seen.add(next)
    stack.push(...(edges.get(next) ?? []))
  }
  return seen
}

/** Every declared overlap between two readable work items, ordered ones marked. */
export function surfaceOverlaps(items: WorkItem[]): SurfaceOverlap[] {
  const readable = items.filter((i) => i.withheld === null && i.id !== '')
  const edges = new Map<string, string[]>(readable.map((i) => [i.id, i.dependsOn]))
  const out: SurfaceOverlap[] = []
  for (let i = 0; i < readable.length; i++) {
    for (let j = i + 1; j < readable.length; j++) {
      const a = readable[i]!
      const b = readable[j]!
      const entries: { a: string; b: string }[] = []
      for (const ea of a.fileContactSurface) {
        for (const eb of b.fileContactSurface) {
          if (entriesOverlap(ea, eb)) entries.push({ a: ea, b: eb })
        }
      }
      if (entries.length === 0) continue
      const ordered = reachable(a.id, edges).has(b.id) || reachable(b.id, edges).has(a.id)
      out.push({ a: a.id, b: b.id, entries, ordered })
    }
  }
  // Unordered overlaps lead: they are the ones nothing in the record resolves.
  return out.sort((x, y) => Number(x.ordered) - Number(y.ordered))
}

/**
 * Compose G1's packet from the run's own artifacts.
 *
 * Coverage joins three independent statements about the same requirement: the
 * spec defines it, the plan's table maps it to tasks, and a work item claims
 * it. They are reported side by side rather than reconciled — a requirement
 * claimed by a task but absent from the table is a different fact from one no
 * task mentions at all, and flattening them would hide the difference.
 */
export function buildG1Packet(input: {
  lexicon: Lexicon
  plan: string | null
  tasks: { path: string; content: string }[]
}): G1Packet {
  const mapping: RequirementMapping = parseRequirementMapping(input.plan)
  const taskSet: TaskSet = buildTaskSet(input.tasks)
  const items = taskSet.items
  const knownIds = new Set(items.filter((i) => i.withheld === null && i.id !== '').map((i) => i.id))

  const rowsFor = new Map<string, MappingRow[]>()
  for (const row of mapping.rows) {
    for (const id of row.requirements) rowsFor.set(id, [...(rowsFor.get(id) ?? []), row])
  }

  const defined = input.lexicon.entries.filter((e) => e.kind === 'requirement')
  const definedIds = new Set(defined.map((e) => e.id))
  // The spec's order first, then any requirement the mapping names that the
  // spec does not define — a fact about the record, reported, never dropped.
  const ids = [...defined.map((e) => e.id), ...[...rowsFor.keys()].filter((id) => !definedIds.has(id))]

  const coverage: CoverageRow[] = ids.map((id) => {
    const rows = rowsFor.get(id) ?? []
    const mapped = [...new Set(rows.flatMap((r) => r.tasks))]
    const entry = defined.find((e) => e.id === id)
    return {
      id,
      shortName: entry?.shortName ?? '',
      defined: definedIds.has(id),
      mapped,
      unknownTasks: mapped.filter((t) => !knownIds.has(t)),
      claimedBy: items.filter((i) => i.withheld === null && i.requirements.includes(id)).map((i) => i.id),
      row: rows[0]?.text ?? null,
    }
  })

  const mappedTasks = new Set(mapping.rows.flatMap((r) => r.tasks))
  return {
    coverage,
    unmappedTasks: [...knownIds].filter((id) => !mappedTasks.has(id)),
    overlaps: surfaceOverlaps(items),
    tasks: items,
    mappingWithheld: mapping.withheld,
    tasksWithheld: taskSet.withheld,
  }
}
