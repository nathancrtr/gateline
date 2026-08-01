// The run header's phase spine (#254): one sequence in which gates are the
// transitions between phases, and the profile is legible as shape rather than
// spelled out in prose.
//
// The header used to state the same four facts three times — an eyebrow reading
// "IMPLEMENT PHASE · FULL PROFILE", a chip, and a GATES rail — because nothing
// in its arrangement said that gates *are* the transitions, or that the profile
// decides how many there are. Since #249 closed the gate and profile vocabulary,
// both are derivable: PROFILE_PHASES fixes the sequence, GATE_PHASES fixes where
// each gate sits in it, and PROFILE_GATES fixes which ones exist at all.
//
// Two rules keep this a rendering of the record rather than a reading of it:
//
//   * A gate absent from the profile is absent from the spine — never an empty
//     cell, never an auto-approved one.
//   * A run at rest has no gate on the table. `paused` and `staged` are rest
//     states overlaid on the sequence (ADR-1: `staged` is `phase: paused` with a
//     reason, not a seventh phase), so the spine shows where such a run stands
//     and the phase chip beside it says that it is not moving.
//
// Pure and type-only by design, so it is unit-testable without a DOM and carries
// no React or core-runtime weight into the bundle — same contract as landing.ts.
import {
  GATE_PHASES,
  GATE_QUESTIONS,
  PATCH_G1_QUESTION,
  PROFILE_GATES,
  PROFILE_PHASES,
  type GateId,
  type Phase,
  type Profile,
  type RunSummary,
} from './api.ts'

export type PhaseCellState = 'past' | 'current' | 'future'
/** `pending` is the gate on the table; `future` is one the run has not reached. */
export type GateCellState = 'approved' | 'declined' | 'pending' | 'future'

export interface PhaseCell {
  kind: 'phase'
  phase: Phase
  state: PhaseCellState
}

export interface GateCell {
  kind: 'gate'
  gate: GateId
  state: GateCellState
  /** Approver and ISO timestamp, verbatim from the ledger; null until decided. */
  by: string | null
  at: string | null
  question: string
}

export type SpineCell = PhaseCell | GateCell

export interface Spine {
  /** Phases and gates interleaved, left to right, in the profile's own order. */
  cells: SpineCell[]
  /** A rest state overlaid on the sequence, or null while the run is moving. */
  rest: 'paused' | 'staged' | null
  /** The phase the run stands at, or null when its phase names no position (a malformed record). */
  position: Phase | null
}

export interface SpineInput {
  profile: Profile
  phase: string
  pausedReason: string | null
  gates: RunSummary['gates']
}

/** The profile's phase sequence. `paused` is a rest state, not a step in it. */
function sequenceOf(profile: Profile): Phase[] {
  return PROFILE_PHASES[profile].filter((p) => p !== 'paused')
}

/**
 * Where a run at rest stands: the phase of the first gate it has not yet
 * approved, which is also where resuming would put it (core's
 * `deriveResumePhase`). A paused run has still travelled — showing it parked at
 * the start would be a worse lie than showing it parked where it stopped.
 */
function restingPosition(profile: Profile, gates: RunSummary['gates']): Phase {
  const sequence = sequenceOf(profile)
  for (const gate of PROFILE_GATES[profile]) {
    if (!gates[gate].approved) {
      const first = GATE_PHASES[gate].find((p) => sequence.includes(p))
      if (first) return first
    }
  }
  return sequence[sequence.length - 1]!
}

/** The question a gate asks, given the profile it is asked in. */
export function gateQuestion(gate: GateId, profile: Profile): string {
  return profile === 'patch' && gate === 'G1' ? PATCH_G1_QUESTION : GATE_QUESTIONS[gate]
}

/**
 * The spine for one run: its profile's phases with its profile's gates as the
 * transitions between them.
 *
 * A gate is placed after the last phase it is on the table in — G2's decision
 * spans `implement` and `integrate`, so it renders once, after `integrate`, and
 * not twice. A phase whose gate does not exist in the profile simply flows into
 * the next one, which is what a reduced profile *means*.
 */
export function phaseSpine(run: SpineInput): Spine {
  const sequence = sequenceOf(run.profile)
  const gates = PROFILE_GATES[run.profile]

  // Which gate, if any, closes each phase.
  const closedBy = new Map<Phase, GateId>()
  for (const gate of gates) {
    const spanned = GATE_PHASES[gate].filter((p) => sequence.includes(p))
    const last = spanned[spanned.length - 1]
    if (last) closedBy.set(last, gate)
  }

  const rest = run.phase === 'paused' ? (run.pausedReason === 'staged' ? 'staged' : 'paused') : null
  // A phase outside the profile's sequence names no position — the malformed
  // case (`phase: unknown`), where the state block above the spine says so.
  const position = rest
    ? restingPosition(run.profile, run.gates)
    : sequence.includes(run.phase as Phase)
      ? (run.phase as Phase)
      : null
  const here = position === null ? -1 : sequence.indexOf(position)

  const cells: SpineCell[] = []
  sequence.forEach((phase, i) => {
    cells.push({
      kind: 'phase',
      phase,
      state: here < 0 ? 'future' : i < here ? 'past' : i === here ? 'current' : 'future',
    })
    const gate = closedBy.get(phase)
    if (!gate) return
    const cell = run.gates[gate]
    // Pending means *on the table*, which a run at rest has nothing on.
    const state: GateCellState = cell.approved
      ? 'approved'
      : cell.decided
        ? 'declined'
        : !rest && position !== null && GATE_PHASES[gate].includes(position)
          ? 'pending'
          : 'future'
    cells.push({ kind: 'gate', gate, state, by: cell.by, at: cell.at, question: gateQuestion(gate, run.profile) })
  })

  return { cells, rest, position }
}
