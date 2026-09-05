// The RunSource driver seam (plan §2.2): everything above this interface is
// indifferent to whether runs come from a local clone or (later) the GitHub
// API. Nothing above it may know which driver it is talking to.
import type { CommitInfo } from './git.ts'
import type { Identity, RunState, StateDocMutation, StateParseResult } from '../record/schema.ts'
import type { RunScaffold } from '../record/scaffold.ts'
import type { ContractTemplates } from '../record/validate.ts'

export interface RunRef {
  /** Source id this run belongs to. */
  source: string
  slug: string
  /** Git rev the run is read at (branch name, remote ref, or default branch). */
  ref: string
  kind: 'branch' | 'remote' | 'default'
  /** The run branch name recorded in state (run/<slug>), for writes. */
  branch: string
}

export interface StateCommit extends CommitInfo {
  state: RunState | null
}

export type { Identity, StateDocMutation }

export type WriteFailure = 'ref-moved' | 'dirty-worktree' | 'stale-checkout' | 'no-branch' | 'no-identity' | 'error'

/** Why `stageRun` refused to mint a genesis commit (plan ADR-4). */
export type StageRefusal = 'no-identity' | 'slug-taken' | 'conflict'

export type StageOutcome =
  | { outcome: 'created'; slug: string; branch: string; commit: string; pushFailed?: string }
  | { outcome: 'exists'; slug: string; branch: string } // idempotent replay (AC1.3) — a success
  | { outcome: 'refused'; reason: StageRefusal; message: string }

/**
 * Thrown when a source requests local-only and an explicit push in the same
 * breath (mode-resolution table, rule 1) — at either tier: `--local-only
 * --push` on the CLI, or `local_only: true` with `push: true` on a config
 * entry. Raised by `loadSources` and, independently, by the standalone
 * orchestrator binary, which never goes through it (ADR-5, AC4.1).
 *
 * It lives here rather than beside `loadSources` because push mode is a
 * property of a source, not of the frontend's view of one. That placement was
 * also the orchestrator's only reach into the view-model layer, and moving it
 * is what lets `orchestrator/test/core-ceiling.test.ts` hold the engine to
 * record + sources (#132).
 */
export class LocalOnlyPushConflictError extends Error {
  constructor(source: string) {
    super(`source ${source}: local-only and push are both explicitly requested — they conflict (local-only forces push off); pick one`)
    this.name = 'LocalOnlyPushConflictError'
  }
}

export interface WriteResult {
  ok: boolean
  commit?: string
  reason?: WriteFailure
  message?: string
  /**
   * Set when the commit landed locally but origin rejected the push (#103).
   * `ok` stays true — the local write succeeded — but a pushing writer must
   * treat this as "origin moved past the observed tip": the derivation
   * behind the commit is stale, and acting on it (launching a dispatch)
   * would act on state another writer already changed.
   */
  pushFailed?: string
}

export interface RunSource {
  readonly id: string
  /** Contract templates of this repo, for R3 validation. */
  readonly templates: ContractTemplates
  listRuns(): Promise<RunRef[]>
  readState(ref: RunRef): Promise<StateParseResult & { raw: string | null }>
  /** Run-relative artifact paths (e.g. "spec.md", "tasks/01-x.yaml"). */
  listArtifacts(ref: RunRef): Promise<string[]>
  readArtifact(ref: RunRef, path: string): Promise<string | null>
  /** Unified diff of the run branch against the default branch, runs/ excluded. */
  readDiff(ref: RunRef): Promise<string>
  stateHistory(ref: RunRef): Promise<StateCommit[]>
  /**
   * Every commit on the run branch touching the run's own directory, newest
   * first — the branch's own order, which is what "after" means when the
   * clocks that stamped the facts disagree (#346, `branch-order.ts`). One log,
   * no per-commit reads: `stateHistory` is the expensive walk, this is the
   * cheap index that places its commits alongside the artifact landings.
   *
   * Optional, like the origin-divergence counts: a driver with no history to
   * offer omits it, and its callers fall back to timestamps.
   */
  runHistory?(ref: RunRef): Promise<CommitInfo[]>
  /** Most recent commit touching any of the given run-relative paths. */
  lastTouched(ref: RunRef, paths: string[]): Promise<CommitInfo | null>
  /**
   * Most recent commit touching anything in the run directory except the
   * given run-relative paths — the delta guard (#188): state.yaml alone
   * moving (bookkeeping, a resolution note) is not "something landed".
   */
  lastTouchedExcept(ref: RunRef, excludePaths: string[]): Promise<CommitInfo | null>
  identity(): Promise<Identity | null>
  /**
   * Commits on the run branch that origin does not yet have — unpushed
   * writes (#149): the lineage Gatehouse renders and the lineage origin
   * consumers see have silently diverged. Absent method or null result
   * means "not knowable" (no origin tracking, remote-kind run) — display
   * nothing, never zero.
   */
  aheadOfOrigin?(ref: RunRef): Promise<number | null>
  /**
   * Commits origin has that the local run branch does not (#99). Non-zero
   * together with aheadOfOrigin means the branch has genuinely diverged —
   * local-wins observation is then a deliberate choice that must be visible,
   * never silent. Absent method or null means "not knowable".
   */
  behindOrigin?(ref: RunRef): Promise<number | null>
  /**
   * This source's `remote.origin.url`, verbatim, for deriving a link out to
   * the git host (#267 — `view-model/host-link.ts` decides what it means).
   * Null means there is nothing to link to and the caller keeps its local
   * view: no remote configured, or a local-only source, which has no origin
   * by definition (FRONTEND.md §4.1 — degrade to the local view, never to a
   * dead end). Absent method means the same.
   */
  originUrl?(): Promise<string | null>
  /**
   * The single write path (rule R2): apply a mutation to state.yaml and commit
   * it to the run branch, compare-and-swap semantics. `expectedTip` extends
   * the CAS window back to the caller's read: when given and the branch no
   * longer points there, the write refuses with ref-moved — the machine
   * co-writer's derive-then-write guard (ORCHESTRATOR.md §4.4). Human
   * surfaces omit it: their reads happen inside this call.
   */
  writeState(ref: RunRef, mutate: StateDocMutation, message: string, options?: { expectedTip?: string }): Promise<WriteResult>
  /**
   * The only branch-minting path (plan ADR-3, R1): builds a genesis commit
   * from `scaffold.files` against the default branch's tip and lands it via
   * create-only CAS. Always authored as `who` — never a bot-pinned source
   * identity — because a staged run must be attributable to the human who
   * staged it, whoever is holding the write path.
   */
  stageRun(scaffold: RunScaffold, who: Identity): Promise<StageOutcome>
}
