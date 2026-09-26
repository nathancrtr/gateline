// Why a run's state could not be read, as a fact (#435).
//
// A run whose `state.yaml` yields no state used to reach the view as one
// string: the parser's message when there was one, and otherwise a sentence
// core wrote in its place (`state.yaml unreadable`). The view set both under
// "Run state parser", so core's own sentence read as the parser's. Here the
// cases are kept apart, and only the parser's message travels as words — the
// sentence for every other case is the view's to compose (docs/SEAM.md §7:
// facts, not sentences).

import type { StateParseResult } from '../record/schema.ts'
import { type ArtifactRef, artifactRef } from './artifact-ref.ts'

/** Where the run state lives in a run: the record layer's name, never a view's. */
const STATE_PATH = 'state.yaml'

export type StateProblem =
  /** The file is there and the run state parser refused it. `diagnostic` is its message, verbatim, caret and all. */
  | { kind: 'parser'; diagnostic: string; ledger: ArtifactRef }
  /** No state file at the run's ref, so there was nothing to parse. */
  | { kind: 'absent'; ledger: ArtifactRef }
  /** The file is there, no state came of it, and the source gave no reason. */
  | { kind: 'unexplained'; ledger: ArtifactRef }

/** The problem with one `readState` result, or null when it yielded a state. */
export function stateProblem(read: StateParseResult & { raw: string | null }): StateProblem | null {
  if (read.state) return null
  const ledger = artifactRef(STATE_PATH)
  // An absent file's `error` is the source's sentence about the absence, not
  // a parser's diagnostic: nothing was parsed. It is dropped here.
  if (read.raw === null) return { kind: 'absent', ledger }
  if (read.error === null) return { kind: 'unexplained', ledger }
  return { kind: 'parser', diagnostic: read.error, ledger }
}
