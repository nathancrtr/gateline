// What a file in a run directory *is* (docs/SEAM.md §7, #415).
//
// Before this module the answer lived as regexes at every leaf that needed it:
// the contract lookup here in the record layer, the review test in schema.ts,
// the work-item test in readiness, the G2 trigger in metrics, and in the
// browser the rail's ranking and labels and the landing's review and task
// tests — each re-deriving the kind from the path, and free to drift. Now it
// is one function, and everything that needs to know what a path is asks it.
//
// The record layer says what a file is; it says nothing about how it reads.
// The display names below are the contracts' own names for what they
// define, the framework's vocabulary — not labels for a screen. How an entry
// is captioned, ordered or faced is web's to decide from the kind.
//
// Pure and dependency-free, like the rest of this layer: browser-safe by
// construction (test/layering.test.ts).

/**
 * The artifact kinds the contracts define, one per file under `contracts/`,
 * plus `other` for everything the framework has no contract for (`retro.md`,
 * a design note, a screenshot). Closed on purpose: a new kind is a new
 * contract, and a new contract is a maintainer decision (AGENTS.md).
 */
export const ARTIFACT_KINDS = [
  'intent-brief',
  'spec',
  'plan',
  'work-item',
  'review-report',
  'verification-report',
  'release-plan',
  'state',
  'docs-delta',
  'integration-profile',
  'other',
] as const

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

/**
 * How the kinds group. `gate` is the one-per-run artifact a phase produces
 * and a gate reads; `work-items` and `reviews` are the numbered families, one
 * file per task or report; `ledger` is `state.yaml`, the record's index and
 * the home of the decision grammar; `other` is everything else — including a
 * sweep's `docs-delta.md`, which no gate reads: a historian sweep is
 * gate-less, and merging its branch is the approval.
 */
export type ArtifactFamily = 'gate' | 'work-items' | 'reviews' | 'ledger' | 'other'

/**
 * What an artifact's bytes are written in (#434): the renderer's question,
 * answered here beside the kind so there is one classifier of a path. Every
 * kind the contracts define fixes its own format — the markdown contracts are
 * markdown, a work item and the run state are YAML. `other` is the one kind
 * that does not (a retro, a design note, a page of HTML), and for it alone the
 * extension answers.
 */
export type ArtifactFormat = 'markdown' | 'yaml' | 'text'

export interface ArtifactDescription {
  kind: ArtifactKind
  /**
   * The id the path gives the artifact, or null when the kind alone names it.
   *
   * - A work item: its filename stem (`tasks/06-pages-workflow.yaml` →
   *   `06-pages-workflow`). On the contract's `tasks/NN-slug.yaml` grammar
   *   that is the task's id — the name `depends_on`, the task board and a
   *   review's header all use. Off the grammar (`tasks/hotfix.yaml` →
   *   `hotfix`) it is still a name: no slash, no extension. Null only for a
   *   file in a subdirectory of `tasks/`, whose stem is a path.
   * - A review report: what follows `review-` in its filename (`review-04.md`
   *   → `04`, `review-03-round2.md` → `03-round2`). An opaque ordering token,
   *   not a fact about the review: the current engine harvests reports as
   *   `review-<task NN>*.md`, older runs numbered them by dispatch order, and
   *   neither is a round — rounds are sections appended inside one report.
   *   The authority on what a report reviews is its `# Review Report:`
   *   header, which the view-model reads (`ArtifactRef.reviewOf`).
   * - Every other kind: null. There is one spec, one plan, one ledger per run.
   */
  id: string | null
  /**
   * The contract template this artifact is checked against, as a filename
   * under `contracts/` — or null when it is checked for presence only. A
   * validation's contract stays a filename: it is one.
   *
   * `docs-delta.md` and `integration-profile.md` have contracts but are
   * presence-only today; their kinds are known, and validating them is a
   * separate decision from naming them.
   */
  contract: string | null
  /** The contract's own name for what it defines (`work item`, `review report`), or null for `other`. */
  contractName: string | null
  family: ArtifactFamily
  format: ArtifactFormat
}

/**
 * The one-per-run kinds, keyed by the run-relative path the contracts fix for
 * them. A `Map`, not an object literal: a path is arbitrary input, and
 * `constructor` or `__proto__` must be `other`, not an inherited property.
 */
const FIXED_KINDS: Record<string, Omit<ArtifactDescription, 'id'>> = {
  'intent-brief.md': { kind: 'intent-brief', contract: 'intent-brief.md', contractName: 'intent brief', family: 'gate', format: 'markdown' },
  'spec.md': { kind: 'spec', contract: 'spec.md', contractName: 'spec', family: 'gate', format: 'markdown' },
  'plan.md': { kind: 'plan', contract: 'plan.md', contractName: 'plan', family: 'gate', format: 'markdown' },
  'verification-report.md': {
    kind: 'verification-report',
    contract: 'verification-report.md',
    contractName: 'verification report',
    family: 'gate',
    format: 'markdown',
  },
  // G3's packet is checkable as of #260. Before that it was bare presence: a
  // release plan of one sentence passed exactly as one carrying a rollback,
  // and G3 was the one gate no structured surface could be built for.
  'release-plan.md': { kind: 'release-plan', contract: 'release-plan.md', contractName: 'release plan', family: 'gate', format: 'markdown' },
  'state.yaml': { kind: 'state', contract: 'state.yaml', contractName: 'run state', family: 'ledger', format: 'yaml' },
  'docs-delta.md': { kind: 'docs-delta', contract: null, contractName: 'docs delta', family: 'other', format: 'markdown' },
  'integration-profile.md': {
    kind: 'integration-profile',
    contract: null,
    contractName: 'integration profile',
    family: 'gate',
    format: 'markdown',
  },
}
const FIXED = new Map(Object.entries(FIXED_KINDS))

/**
 * A review report's filename, at the run root: `review-<nn>[-suffix].md`. The
 * grammar is the reviewer's (`roles/reviewer.md`: "Produce
 * `runs/<slug>/review-NN.md`"); the contract fixes the report's contents.
 */
const REVIEW = /^review-(\d+[^/]*)\.md$/

const TASKS_DIR = 'tasks/'
const YAML = '.yaml'

/**
 * What the file at `path` is. `path` is run-relative, as `listArtifacts`
 * returns it (`spec.md`, `tasks/01-core.yaml`), never `runs/<slug>/…`.
 *
 * The kinds are matched where the contracts put them — the run root, and
 * `tasks/` for work items — so a file of the same name elsewhere in the run
 * directory (`design/spec.md`) is `other`, not a second spec.
 */
export function describeArtifact(path: string): ArtifactDescription {
  const fixed = FIXED.get(path)
  if (fixed) return { ...fixed, id: null }
  const review = REVIEW.exec(path)
  if (review) return { kind: 'review-report', id: review[1]!, contract: 'review-report.md', contractName: 'review report', family: 'reviews', format: 'markdown' }
  if (path.startsWith(TASKS_DIR) && path.endsWith(YAML) && path.length > TASKS_DIR.length + YAML.length) {
    const stem = path.slice(TASKS_DIR.length, -YAML.length)
    return {
      kind: 'work-item',
      id: stem.includes('/') ? null : stem,
      contract: 'work-item.yaml',
      contractName: 'work item',
      family: 'work-items',
      format: 'yaml',
    }
  }
  const format: ArtifactFormat = /\.(?:md|markdown)$/i.test(path) ? 'markdown' : /\.ya?ml$/i.test(path) ? 'yaml' : 'text'
  return { kind: 'other', id: null, contract: null, contractName: null, family: 'other', format }
}
