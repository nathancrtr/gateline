// The RunSource driver seam (plan §2.2): everything above this interface is
// indifferent to whether runs come from a local clone or (later) the GitHub
// API. Nothing above it may know which driver it is talking to.
import type { Document } from 'yaml'
import type { CommitInfo } from './git.ts'
import type { RunState, StateParseResult } from './schema.ts'
import type { ContractTemplates } from './validate.ts'

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

export type StateDocMutation = (doc: Document) => void

export type WriteFailure = 'ref-moved' | 'dirty-worktree' | 'no-branch' | 'no-identity' | 'error'

export interface WriteResult {
  ok: boolean
  commit?: string
  reason?: WriteFailure
  message?: string
}

export interface Identity {
  name: string
  email: string
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
  /** Most recent commit touching any of the given run-relative paths. */
  lastTouched(ref: RunRef, paths: string[]): Promise<CommitInfo | null>
  identity(): Promise<Identity | null>
  /**
   * The single write path (rule R2): apply a mutation to state.yaml and commit
   * it to the run branch, compare-and-swap semantics. `expectedTip` extends
   * the CAS window back to the caller's read: when given and the branch no
   * longer points there, the write refuses with ref-moved — the machine
   * co-writer's derive-then-write guard (ORCHESTRATOR.md §4.4). Human
   * surfaces omit it: their reads happen inside this call.
   */
  writeState(ref: RunRef, mutate: StateDocMutation, message: string, options?: { expectedTip?: string }): Promise<WriteResult>
}
