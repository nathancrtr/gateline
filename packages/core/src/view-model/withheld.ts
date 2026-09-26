// Why a packet half stood down, as facts (docs/SEAM.md §5 "Withheld view",
// §7 "its withheld reasons are structured", #424).
//
// Contracts are forkable, so a view that reads an artifact's grammar must be
// able to say it found another shape and stand down. What it says used to be a
// sentence written here — with markdown backticks, a filename, sometimes an
// issue number — that every surface then printed as-is. Core now states only
// the facts: the grammar looked for, the token in the record's own spelling,
// and the artifact it looked in. Each surface composes its own sentence from
// them (web's `Withheld`, the CLI's line), so no cockpit prose is written in
// the view-model and no path travels as prose.
//
// The grammar is the framework's voice: a contract section or key, named in
// plain words, lower case, reading as the object of "looked for" — `a section
// headed`, `a top-level key`. The token, when there is one, is the record's
// spelling — `## Escalation`, `### E<k> — AC<n>.<m>`, `file_contact_surface:`
// — and completes the grammar phrase. Where a view could have stood down for
// two reasons, the reason names the first; the artifact itself is one click
// away and says the rest.
import { type ArtifactRef, artifactRef } from './artifact-ref.ts'
import type { TaskSet } from './tasks.ts'

/**
 * What a view looked for, without where. The browser-safe leaf parsers
 * (`plan.ts`, `tasks.ts`) may import nothing, so they return this shape —
 * structurally, with no import — and the packet that knows the artifact adds
 * `lookedIn`.
 */
export interface WithheldGrammar {
  /** The contract section or key looked for, in the framework's words. No markup, no paths. */
  grammar: string
  /** The exact grammar token in the record's spelling, when there is one. */
  token?: string
}

/** Why a packet half was not composed: what was looked for, and where. */
export interface WithheldReason extends WithheldGrammar {
  /**
   * The artifact the view looked in — the one a reader opens to see the shape
   * it has instead. Null when the record has no such artifact at all, so
   * there is nothing to open.
   */
  lookedIn: ArtifactRef | null
}

/** Attach where a grammar was looked for. `path` null means the record has no such artifact. */
export function withheldIn(grammar: WithheldGrammar | null, path: string | null): WithheldReason | null {
  if (grammar === null) return null
  const reason: WithheldReason = { grammar: grammar.grammar, lookedIn: path === null ? null : artifactRef(path) }
  if (grammar.token !== undefined) reason.token = grammar.token
  return reason
}

/**
 * A task set's reason, looked for in its first withheld work item — the first
 * cause. A set with no files at all looked in nothing.
 */
export function taskSetWithheld(set: TaskSet): WithheldReason | null {
  const first = set.items.find((i) => i.withheld !== null) ?? null
  return withheldIn(set.withheld, first?.path ?? null)
}
