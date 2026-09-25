// The Record rail: the order the run's artifacts read in, and the words each
// entry goes by (#401).
//
// The rail used to be a directory listing. It printed `tasks/06-pages-workflow.yaml`
// in monospace, truncated it at 280px to the part nobody was reading, and
// repeated `runs/<slug>/` above a list whose every entry lived there. The
// reader had to translate filenames back into a vocabulary the page already
// held: `artifactRank` sorts by brief → spec → plan → work items → reviews →
// verification → release plan → ledger, and never said so.
//
// Now the rail says the kind and the reader header says the bytes. An entry
// is a name for what the framework knows the file to be — `Spec`, a work
// item's id, the task a review is of — and `runs/<slug>/<path>`
// stays printed beside the contract badge, where the file-level truth belongs.
// Labelling `spec.md` "Spec" is a view, not a paraphrase: the #261 rule is
// about the artifact's words, and the address stays one glance away.
//
// Two entries keep their filename on purpose. `state.yaml` is the record's
// index rather than an artifact in the reader's sense, and the human decision
// grammar lives in it by name. A file the framework has no position for is
// shown as the file it is: mixed labels are honest — these are the kinds the
// framework knows, this one it does not. `literal` marks both, so the rail can
// set them in the code face and the kinds in the UI face: a monospace entry is
// a path, a proportional one is a name.
//
// Pure and type-only, so it is unit-testable without a DOM.
import type { ReviewReport } from './api.ts'

/**
 * The picker was alphabetical, which is not an order — it is the absence of
 * one, and it put `review-01.md` above `spec.md` so the run's narrative came
 * out as an accident of naming. Reading top to bottom is how anyone catches up
 * on a run they did not watch happen, so the list reads the way the run went:
 * brief, spec, plan, the work items, the reviews of them, the verification, the
 * release plan, and `state.yaml` last as the ledger that records all of it.
 *
 * Ranks, not a comparator table: a file the framework has not met yet lands
 * between the phases and the ledger rather than at an arbitrary end, and ties
 * inside a rank stay alphabetical, which is the right order for `tasks/*` and
 * `review-*` because their names are numbered.
 */
export function artifactRank(path: string): number {
  if (path === 'intent-brief.md') return 0
  if (path === 'spec.md') return 1
  if (path === 'plan.md') return 2
  if (isTaskPath(path)) return 3
  if (isReviewPath(path)) return 4
  if (path === 'verification-report.md') return 5
  if (path === 'release-plan.md') return 6
  if (path === 'state.yaml') return 8
  return 7
}

export function orderArtifacts(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => artifactRank(a) - artifactRank(b) || a.localeCompare(b))
}

export const isTaskPath = (path: string) => path.startsWith('tasks/') && path.endsWith('.yaml')
export const isReviewPath = (path: string) => /^review-\d+.*\.md$/.test(path)

/** The kinds the framework fixes, and what each one's rail entry says. */
const KIND_LABELS: Record<string, string> = {
  'intent-brief.md': 'Brief',
  'spec.md': 'Spec',
  'plan.md': 'Plan',
  'verification-report.md': 'Verification',
  'release-plan.md': 'Release plan',
}

export interface RailLabel {
  /** What the entry says. */
  text: string
  /** True when `text` is the file's own name rather than a name for its kind. */
  literal: boolean
}

/**
 * A work item's entry is its id, verbatim from the filename the architect
 * chose, without the `tasks/` that is the group's heading and the `.yaml`
 * that is the contract's. The id is the record's own name for the task — what
 * `depends_on` cites, what the task board shows, what a review's header
 * names — so the entry reads the same as every other mention of it. The
 * leading number stays because `contracts/work-item.yaml` makes it a display
 * fact. A filename off the `NN-slug` grammar is shown as it is.
 */
function taskLabel(path: string): RailLabel {
  const stem = path.slice('tasks/'.length, -'.yaml'.length)
  return /^\d+-.+$/.test(stem) ? { text: stem, literal: false } : { text: stem, literal: true }
}

/**
 * A review's entry names the task it reviews, read from the report's own
 * `# Review Report: <id>` header (core's `parseReview` carries it as `task`).
 * Reports load lazily; until they do, or when a report has no readable
 * header, the entry is the filename stem, which is the same fallback an
 * unknown file gets. Where a run keeps a file per round, several reports name
 * one task, and each entry carries its round so they stay distinct.
 */
function reviewLabel(path: string, reports: readonly ReviewReport[] | undefined, sharedTask: boolean): RailLabel {
  const report = reports?.find((r) => r.path === path)
  if (!report?.task) return { text: path.slice(0, -'.md'.length), literal: true }
  if (!sharedTask) return { text: report.task, literal: false }
  const round = report.rounds[0]?.round ?? null
  return round === null
    ? { text: path.slice(0, -'.md'.length), literal: true }
    : { text: `${report.task} · round ${round}`, literal: false }
}

/** The words one rail entry goes by. `reports` may be absent while loading. */
export function railLabel(path: string, reports?: readonly ReviewReport[]): RailLabel {
  const kind = KIND_LABELS[path]
  if (kind) return { text: kind, literal: false }
  if (isTaskPath(path)) return taskLabel(path)
  if (isReviewPath(path)) {
    const task = reports?.find((r) => r.path === path)?.task ?? null
    const shared = task !== null && (reports ?? []).filter((r) => r.task === task).length > 1
    return reviewLabel(path, reports, shared)
  }
  return { text: path, literal: true }
}

export interface RailEntry extends RailLabel {
  path: string
}

export interface RailGroup {
  /** The caption above the group, or null for entries that stand alone. */
  caption: string | null
  entries: RailEntry[]
}

/**
 * The rail, in reading order, with the numbered families gathered under a
 * caption: `Work items · 6` and `Reviews · 2` say once what `tasks/` and
 * `review-` said on every line. Every other entry stands alone under no
 * caption, as before. A family with no members has no caption.
 */
export function railGroups(paths: readonly string[], reports?: readonly ReviewReport[]): RailGroup[] {
  const groups: RailGroup[] = []
  for (const path of orderArtifacts(paths)) {
    const entry: RailEntry = { path, ...railLabel(path, reports) }
    const family = isTaskPath(path) ? 'Work items' : isReviewPath(path) ? 'Reviews' : null
    const last = groups.at(-1)
    if (family && last?.caption?.startsWith(family)) {
      last.entries.push(entry)
      last.caption = `${family} · ${last.entries.length}`
    } else {
      groups.push({ caption: family ? `${family} · 1` : null, entries: [entry] })
    }
  }
  return groups
}
