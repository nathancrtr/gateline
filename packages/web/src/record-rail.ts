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
// What each file *is* arrives on the payload (#415): the server sends an
// `ArtifactRef` per artifact — kind, id, and for a review the task its header
// names — derived once, by core's `describeArtifact`. Nothing here reads a
// path to learn a kind. That is also why a review's entry names its task from
// the first paint: it used to wait for the reports to load and then relabel.
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
import type { ArtifactKind, ArtifactRef } from './api.ts'

/**
 * The picker was alphabetical, which is not an order — it is the absence of
 * one, and it put `review-01.md` above `spec.md` so the run's narrative came
 * out as an accident of naming. Reading top to bottom is how anyone catches up
 * on a run they did not watch happen, so the list reads the way the run went:
 * brief, spec, plan, the work items, the reviews of them, the verification, the
 * release plan, and `state.yaml` last as the ledger that records all of it.
 *
 * Ranks, not a comparator table: a file the framework has no position for
 * lands between the phases and the ledger rather than at an arbitrary end, and
 * ties inside a rank stay alphabetical, which is the right order for `tasks/*`
 * and `review-*` because their names are numbered.
 */
const RANK: Record<ArtifactKind, number> = {
  'intent-brief': 0,
  spec: 1,
  plan: 2,
  'work-item': 3,
  'review-report': 4,
  'verification-report': 5,
  'release-plan': 6,
  'docs-delta': 7,
  'integration-profile': 7,
  other: 7,
  state: 8,
}

export function artifactRank(ref: ArtifactRef): number {
  return RANK[ref.kind]
}

export function orderArtifacts(refs: readonly ArtifactRef[]): ArtifactRef[] {
  return [...refs].sort((a, b) => artifactRank(a) - artifactRank(b) || a.path.localeCompare(b.path))
}

/**
 * @deprecated A path test, kept only because `pages/run/decide-card.tsx`'s
 * packet chip row still reads bare paths. It goes in #411 step 3 (packet chips
 * become reference rows), which moves that row onto `InboxItem.packetRefs`.
 * New code reads `ArtifactRef.kind`.
 */
export const isReviewPath = (path: string) => /^review-\d+.*\.md$/.test(path)

/** The kinds the framework fixes one per run, and what each one's rail entry says. */
const KIND_LABELS: Partial<Record<ArtifactKind, string>> = {
  'intent-brief': 'Brief',
  spec: 'Spec',
  plan: 'Plan',
  'verification-report': 'Verification',
  'release-plan': 'Release plan',
}

export interface RailLabel {
  /** What the entry says. */
  text: string
  /** True when `text` is the file's own name rather than a name for its kind. */
  literal: boolean
}

/**
 * A work item's entry is its id — the record's own name for the task, what
 * `depends_on` cites, what the task board shows, what a review's header
 * names — so the entry reads the same as every other mention of it. The
 * leading number stays because `contracts/work-item.yaml` makes it a display
 * fact. A filename off the `NN-slug` grammar still gives a name (`hotfix`);
 * only a file nested under `tasks/` has none, and is shown as the file it is.
 */
function taskLabel(ref: ArtifactRef): RailLabel {
  return ref.id !== null ? { text: ref.id, literal: false } : { text: ref.path, literal: true }
}

/**
 * A review's entry names the task it reviews, as the report's own
 * `# Review Report: <id>` header says (`reviewOf`, read on the server). A
 * report with no readable header is named by the id its filename gives it
 * (`01`), under the Reviews caption that says what it is — a name, never the
 * filename (docs/SEAM.md §2). Where a run keeps a file per round, several
 * reports name one task, and each entry carries its round so they stay
 * distinct; one that states no round carries its id instead.
 */
function reviewLabel(ref: ArtifactRef, sharedTask: boolean): RailLabel {
  const id = ref.id ?? ref.path
  const task = ref.reviewOf?.task ?? null
  if (task === null) return { text: id, literal: false }
  if (!sharedTask) return { text: task, literal: false }
  const round = ref.reviewOf?.round ?? null
  return { text: round === null ? `${task} · ${id}` : `${task} · round ${round}`, literal: false }
}

/**
 * The words one rail entry goes by. `all` is the rail's whole set of refs,
 * which a review needs to know whether another report names the same task.
 */
export function railLabel(ref: ArtifactRef, all: readonly ArtifactRef[] = [ref]): RailLabel {
  const kind = KIND_LABELS[ref.kind]
  if (kind) return { text: kind, literal: false }
  if (ref.kind === 'work-item') return taskLabel(ref)
  if (ref.kind === 'review-report') {
    const task = ref.reviewOf?.task ?? null
    const shared = task !== null && all.filter((r) => r.kind === 'review-report' && r.reviewOf?.task === task).length > 1
    return reviewLabel(ref, shared)
  }
  return { text: ref.path, literal: true }
}

export interface RailEntry extends RailLabel {
  path: string
}

export interface RailGroup {
  /** The caption above the group, or null for entries that stand alone. */
  caption: string | null
  entries: RailEntry[]
}

/** The numbered families, and the caption each one reads under. */
const FAMILY_CAPTIONS: Partial<Record<ArtifactRef['family'], string>> = {
  'work-items': 'Work items',
  reviews: 'Reviews',
}

/**
 * The rail, in reading order, with the numbered families gathered under a
 * caption: `Work items · 6` and `Reviews · 2` say once what `tasks/` and
 * `review-` said on every line. Every other entry stands alone under no
 * caption, as before. A family with no members has no caption.
 */
export function railGroups(refs: readonly ArtifactRef[]): RailGroup[] {
  const groups: RailGroup[] = []
  for (const ref of orderArtifacts(refs)) {
    const entry: RailEntry = { path: ref.path, ...railLabel(ref, refs) }
    const family = FAMILY_CAPTIONS[ref.family] ?? null
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
