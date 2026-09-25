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
//   * A run at rest has no gate on the table. `paused`, `staged` and `closed`
//     are rest states overlaid on the sequence (ADR-1: `staged` is `phase:
//     paused` with a reason, not a seventh phase; `closed` is a real phase but
//     not a step, since a run ends *at* a position rather than moving to one),
//     so the spine shows where such a run stands and the phase chip beside it
//     says that it is not moving.
//
// Pure and type-only by design, so it is unit-testable without a DOM and carries
// no React or core-runtime weight into the bundle — same contract as landing.ts.
import {
  GATE_PHASES,
  GATE_QUESTIONS,
  type GateId,
  PATCH_G1_QUESTION,
  type Phase,
  PROFILE_GATES,
  PROFILE_PHASES,
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
  rest: 'paused' | 'staged' | 'closed' | null
  /** The phase the run stands at, or null when its phase names no position (a malformed record). */
  position: Phase | null
}

export interface SpineInput {
  profile: Profile
  phase: string
  pausedReason: string | null
  gates: RunSummary['gates']
}

/** The profile's phase sequence. `paused` and `closed` are rest states, not steps in it. */
function sequenceOf(profile: Profile): Phase[] {
  return PROFILE_PHASES[profile].filter((p) => p !== 'paused' && p !== 'closed')
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

  // A closed run is at rest the same way a paused one is — overlaid on the
  // sequence at the phase it stopped in, never drawn as a position of its own
  // (#200). The spine says where it got to; the chip beside it says it ended.
  const rest: Spine['rest'] =
    run.phase === 'closed' ? 'closed' : run.phase === 'paused' ? (run.pausedReason === 'staged' ? 'staged' : 'paused') : null
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

/**
 * The under-cell note lines: "on the table" while a gate is up, approver over
 * date once it is decided, nothing for a gate the run has not reached.
 *
 * Approver over date rather than beside it — a gate cell as wide as
 * `operator · 2026-06-28` is wider than three phase pills, and the sequence is
 * what the spine is for. It lives here rather than in the renderer because the
 * fit arithmetic below has to measure the same strings the renderer draws.
 */
export function gateNote(cell: GateCell): string[] | null {
  if (cell.state === 'pending') return ['on the table']
  if (cell.by === null && cell.at === null) return null
  return [cell.by ?? '—', cell.at ? String(cell.at).slice(0, 10) : '']
}

// --- Fit (#295) ---------------------------------------------------------
//
// The spine never wraps: a wrapped sequence is not one shape, its wrap point is
// an accident of label widths, and its connectors dangle at row ends meaning
// nothing. So the row is `nowrap` and scrolls, and the only question left is how
// much of itself it can show in the open before it has to crop.
//
// The answer is arithmetic on the cells, because a container query needs a
// literal width in the stylesheet and CSS cannot measure text for us. The
// numbers below are deliberately approximate — they decide only *when* the
// under-cell notes are demoted to the tooltip, never whether the record stays
// reachable (the cell's `title` and accessible name carry it at every width) and
// never whether the row stays a single line (`overflow-x-auto` does that).

/** `gap-x-1.5` between every item in the row. */
const CELL_GAP = 6
/** Connectors compress to this before anything else yields (`min-w-[8px]`). */
const CONNECTOR_MIN = 8
/** `px-2.5` plus the 1px border of a phase pill. */
const PHASE_CHROME = 22
/** `px-2`, the border, the `gap-1`, and the state glyph of a gate pill. */
const GATE_CHROME = 29
/** One character's advance in a cell: IBM Plex Mono at the 11px the
 *  impressions are set in — 600 units per em, measured 6.60 in Chromium. */
const CELL_CHAR = 6.6
/** One character's advance in a note: Atkinson Hyperlegible Next at 10.5px.
 *  A date, the widest note, measured 5.73 per character in Chromium; the
 *  words run narrower (4.6–4.9), so this over-estimates them — the safe
 *  side for a fit test. */
const NOTE_CHAR = 5.8

const cellText = (s: string): number => s.length * CELL_CHAR
const noteText = (s: string): number => s.length * NOTE_CHAR

function pillWidth(cell: SpineCell): number {
  return cell.kind === 'phase' ? PHASE_CHROME + cellText(cell.phase) : GATE_CHROME + cellText(cell.gate)
}

function cellWidth(cell: SpineCell): number {
  const pill = pillWidth(cell)
  if (cell.kind === 'phase') return pill
  const note = gateNote(cell)
  return note ? Math.max(pill, ...note.map(noteText)) : pill
}

export interface SpineFit {
  /** px the row needs with its notes in the open and its connectors at minimum. */
  withNotes: number
  /** px it needs once the notes are demoted to the tooltip and the gaps close. */
  dense: number
}

/** How wide this spine needs to be, with its notes and without them. */
export function spineFit(spine: Spine): SpineFit {
  const cells = spine.cells
  if (cells.length === 0) return { withNotes: 0, dense: 0 }
  const connectors = cells.length - 1
  const between = connectors * CONNECTOR_MIN
  const gaps = (cells.length + connectors - 1) * CELL_GAP
  const pills = cells.reduce((w, c) => w + pillWidth(c), 0)
  const widest = cells.reduce((w, c) => w + cellWidth(c), 0)
  // Dense drops the gaps too: with nothing under the cells, a connector that
  // touches the pills it joins reads as "flows into" better than a floating dash.
  return { withNotes: Math.ceil(widest + gaps + between), dense: Math.ceil(pills + between) }
}

/**
 * The widths a note breakpoint may land on. A container query needs a literal
 * width in the stylesheet, so the fit is rounded up to one of these rather than
 * emitted per run — `chips.tsx` maps each rung to a static Tailwind variant.
 */
export const SPINE_NOTE_RUNGS = [500, 580, 660, 740, 820, 900, 980] as const
export type SpineNoteRung = (typeof SPINE_NOTE_RUNGS)[number]

/**
 * The container width at or above which this spine keeps its notes in the open.
 *
 * Rounded *up*, so at the rung itself the notes provably fit; below it they are
 * demoted to the tooltip rather than allowed to push the sequence into a second
 * row. A reduced profile asks for a lower rung because it has fewer cells to
 * fit, which is why `patch` keeps its provenance at widths where `full` cannot.
 */
export function noteRung(spine: Spine): SpineNoteRung {
  const { withNotes } = spineFit(spine)
  return SPINE_NOTE_RUNGS.find((r) => r >= withNotes) ?? SPINE_NOTE_RUNGS[SPINE_NOTE_RUNGS.length - 1]!
}
