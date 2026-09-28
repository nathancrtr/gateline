// The RunSource driver seam (plan §2.2): everything above this interface is
// indifferent to whether runs come from a local clone or (later) the GitHub
// API. Nothing above it may know which driver it is talking to.

import type { RunScaffold } from '../record/scaffold.ts'
import type { Identity, RunState, StateDocMutation, StateParseResult } from '../record/schema.ts'
import type { ContractTemplates } from '../record/validate.ts'
import type { EngineHealth } from './engine-health.ts'
import type { CommitInfo } from './git.ts'
import { lastIdSegment } from './repository-id.ts'
import type { ViewRefs } from './view-refs.ts'

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

/**
 * What a deployment may do in one repository (docs/MULTI-REPO.md §7.3, P2):
 * `view` reads only; `decide` also records human decisions; `dispatch` also
 * lets an engine run. Order matters: each mode allows everything the one
 * before it does.
 */
export const REPOSITORY_MODES = ['view', 'decide', 'dispatch'] as const
export type RepositoryMode = (typeof REPOSITORY_MODES)[number]

/** `view-mode`: the source is in `view` mode and writes nothing (§7.3). */
export type WriteFailure = 'ref-moved' | 'dirty-worktree' | 'stale-checkout' | 'no-branch' | 'no-identity' | 'view-mode' | 'error'

/** Why `stageRun` refused to mint a genesis commit (plan ADR-4; `view-mode` per §7.3). */
export type StageRefusal = 'no-identity' | 'slug-taken' | 'conflict' | 'view-mode'

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
  /**
   * The repository's id (docs/MULTI-REPO.md §6): `<host>/<owner>/<name>` from
   * its origin, or `local/<name>` when it has none. What URLs, cache keys and
   * logs carry. Two ids that differ only in case name the same repository;
   * compare them with `sameRepositoryId`.
   */
  readonly id: string
  /**
   * The short name an interface shows. Presentation only: never in a URL, a
   * cache key or a commit. Optional so a driver or a test double need not say;
   * read it through `displayNameOf`, which falls back to the id's last segment.
   */
  readonly displayName?: string
  /**
   * Names this repository was reached by before its current id, so a link
   * made under one still resolves (§6.3, §6.4): the config's `former_ids:`,
   * and the ids a deployment used before #494 — the config `name`, the
   * directory's basename, and either with a `-2` suffix. Absent means none.
   */
  readonly formerIds?: readonly string[]
  /**
   * What this deployment may do here (§7.3), as resolved for this process:
   * a config entry's `mode`, except that a `dispatch` entry reads as
   * `decide` where no engine runs (`ui`, the CLI); a repository given by
   * `--repo` or the working directory is `dispatch` under `up` and `decide`
   * otherwise. Optional so a driver or a test double need not say, and
   * absent means no restriction — how the engine's own source is built.
   * A `view` source refuses every write (`writeState`, `stageRun`), which
   * is where the rule is enforced so that no caller can forget it.
   */
  readonly mode?: RepositoryMode
  /** Contract templates of this repo, for R3 validation. */
  readonly templates: ContractTemplates
  listRuns(): Promise<RunRef[]>
  /**
   * The refs this source's views read, as comparable strings (#461): what a
   * cache validates an entry against, and what decides whether a change is
   * worth announcing. Optional: a driver that cannot say omits it, and its
   * views are refreshed on a timer instead.
   */
  viewRefs?(): Promise<ViewRefs>
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
   * This source's origin URL as git resolves it (`git remote get-url origin`,
   * which applies `insteadOf` rewrites — the same string the id is derived
   * from), for deriving a link out to the git host (#267 —
   * `view-model/host-link.ts` decides what it means).
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

  // --- What a server needs from a repository beyond its records ---------------
  //
  // Each is optional, because a driver with no local clone (a later
  // `GitHubSource`, docs/MULTI-REPO.md §5 rule 3) could not provide it, and a
  // caller handles its absence without reaching past this interface.

  /**
   * Seconds between fetches from origin, when the operator configured this
   * repository to poll (`fetch_interval`). Absent means it does not poll.
   */
  readonly fetchIntervalSeconds?: number
  /** True when this repository is served local-only: nothing is fetched from or pushed to origin. */
  readonly localOnly?: boolean
  /**
   * Bring what origin has into this repository's view of it, so runs pushed
   * elsewhere show up. Absent means the driver reads origin directly and has
   * nothing to bring in.
   */
  syncFromRemote?(): Promise<void>
  /**
   * Watch where this repository's refs are stored. `onTouch` fires at once on
   * every write there, `onChange` once the writes have settled. Neither means
   * a ref moved (an index refresh writes there too); both mean the refs are
   * worth reading again. Resolves to a function that stops watching. Absent
   * means there is nothing local to watch, and the caller relies on its timer.
   */
  watchRefs?(onChange: () => void, options?: { debounceMs?: number; onTouch?: () => void }): Promise<() => void>
  /**
   * The heartbeat of an engine running on this machine beside the server
   * (#100), or null when none has ever written one here. Absent means this
   * driver cannot see a local engine, and the caller reports none.
   */
  engineHealth?(): Promise<EngineHealth | null>
  /**
   * The commit a branch points at now, or null when it names none. What the
   * remote runner's intents are pinned to (runner-api.ts). Absent means the
   * driver cannot resolve names.
   */
  branchTip?(branch: string): Promise<string | null>
  /**
   * The top directory of this repository's local clone: where a tool that
   * works inside a clone runs (`gh`, for a draft PR or a review sync; an
   * engine under `gateline up`). Absent on a source with no local clone,
   * and a caller that needs one says so rather than guessing a path.
   */
  workingDirectory?(): string
}

/** The name an interface shows for a source: its own display name, or else its id's last segment (§6.2). */
export function displayNameOf(source: Pick<RunSource, 'id' | 'displayName'>): string {
  return source.displayName ?? lastIdSegment(source.id)
}

/**
 * Why a write to this source is refused by its mode, or null when it is not
 * (§7.3). Only `view` refuses; `decide` and `dispatch` both record human
 * decisions. The message names the repository and its mode and says what to
 * change. A source's write methods call this first; a surface may also call
 * it early, before work the refusal would waste (an editor session, a call
 * to GitHub), but the source's own check is the one that holds.
 */
export function viewModeRefusal(source: Pick<RunSource, 'id' | 'displayName' | 'mode'>): string | null {
  if (source.mode !== 'view') return null
  return (
    `${displayNameOf(source)} (${source.id}) is in view mode: it is read here and nothing is written to it. ` +
    'To record decisions in it, set `mode: decide` on its entry in the config file'
  )
}
