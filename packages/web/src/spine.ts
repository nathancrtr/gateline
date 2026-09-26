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
// Three rules keep this a rendering of the record rather than a reading of it:
//
//   * A gate absent from the profile is absent from the spine — never an empty
//     cell, never an auto-approved one.
//   * A gate is on the table only when the inbox holds a gate item for it
//     (#420). Being the next gate after the run's phase is not the same fact:
//     a run at `implement` with only an escalation open is working toward G2,
//     and nobody is wanted there yet. The yellow means a human is wanted at
//     this spot (packages/web/DESIGN.md, settled decision 4), so it is derived
//     from the item that says so, never from the phase.
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
  type InboxItem,
  PATCH_G1_QUESTION,
  type Phase,
  PROFILE_GATES,
  PROFILE_PHASES,
  type Profile,
  type RunSummary,
} from './api.ts'
import { type GateCardState, gateCardState } from './gate-state.ts'

export type PhaseCellState = 'past' | 'current' | 'future'
/**
 * `pending` is the gate on the table — the inbox holds a gate item for it.
 * `next` is the undecided gate the moving run is working toward, with nothing
 * on the table yet (#420): the plain mark, as the ledger draws an undecided
 * gate. `future` is one the run has not reached, or any undecided gate of a run
 * at rest.
 */
export type GateCellState = 'approved' | 'declined' | 'pending' | 'next' | 'future'

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
  /**
   * The gate item's card state when the gate is `pending` — reviewable, in
   * flight or bounced, read through `gateCardState` like every other surface —
   * and null otherwise. Only `reviewable` offers a decision.
   */
  card: GateCardState | null
  /** The producing role out with a fresh dispatch, when `card` is `inflight`. */
  role: string | null
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
  /**
   * The run's inbox items. Required rather than defaulted: the gate on the
   * table is the gate an item says is up, and a spine drawn without the items
   * could only guess it from the phase — the bug #420 was filed on.
   */
  items: readonly InboxItem[]
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

  // The gate items in the inbox, by gate: the only evidence a gate is up.
  const onTable = new Map<GateId, InboxItem>()
  for (const item of run.items) {
    if (item.kind === 'gate' && item.gate !== null) onTable.set(item.gate, item)
  }

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
    const item = onTable.get(gate) ?? null
    // On the table means an item is up for it; nothing else says so. A run at
    // rest gets no item from core (readiness: closed and declined runs get
    // none, paused and staged ones get a pause item, never a gate item), so
    // the rest rule holds by the same reading.
    const state: GateCellState = cell.approved
      ? 'approved'
      : cell.decided
        ? 'declined'
        : item
          ? 'pending'
          : !rest && position !== null && GATE_PHASES[gate].includes(position)
            ? 'next'
            : 'future'
    const card = state === 'pending' && item ? gateCardState(item) : null
    cells.push({
      kind: 'gate',
      gate,
      state,
      by: cell.by,
      at: cell.at,
      question: gateQuestion(gate, run.profile),
      card,
      role: card === 'inflight' ? (item?.inflight?.role ?? null) : null,
    })
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
// nothing. So the row is `nowrap`, and the only question left is how much of
// itself it can show in the open before it has to yield. The notes yield first
// (below); since #427 the phase words yield next (*Folding*, further down), so
// the row fits every width the app supports and its `overflow-x-auto` is a
// safety net rather than the layout.
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

// --- Folding (#427) -------------------------------------------------------
//
// The note rungs decide when the *notes* yield. Below them the sequence used
// to crop and scroll inside its row, and at phone width that was most of it: a
// full spine needs about 574px in words, a 390px phone gives it 358, and the
// reader saw half the cells and had to scroll a header to learn where the run
// stood. The commitment behind the crop was that every phase is labelled in
// words at every width. That is the one that yields now, because the sequence
// is what the spine is for, and the phase words are a fixed, closed vocabulary.
//
// So below its word rung a spine *folds*. The phase the run stands at keeps its
// word. Every other phase becomes a blank tick in its own texture: hollow
// behind, dotted ahead. Every gate keeps its code and glyph, because a gate is
// what a person decides. A folded phase keeps its name as its accessible text
// and its hover text, so nothing becomes unreachable; it only stops taking
// room.
//
// The shapes not chosen:
//
//   * Wrapping splits one sequence into two rows at an accident of label
//     widths (#295 settled that).
//   * A vertical spine at phone width is ten rows of header above the decision.
//   * Abbreviated words (`impl`, `intg`) still overflow 358px for a full
//     spine, and invent spellings the record never uses.
//
// These constants are measured, and they are not the note fit's. `spineFit`
// predates the impression's 6px padding and over-estimates a phase pill by 8px.
// That is the safe side for deciding when notes show, and the 800–1280px tests
// pin the rungs it produces. The word rung has to be close instead: a spine
// that folds at a width where its words fit (900px) hides names for nothing.

/** `.imp`'s 6px side padding and 1px border, both sides. */
const IMP_CHROME = 14
/** IBM Plex Mono at 11px (6.60) plus `.imp`'s 0.02em letter-spacing. */
const IMP_CHAR = 6.82
/** A gate pill reads `G2 ●`: code, space, glyph. */
const GATE_LABEL_CHARS = 4
/** A folded phase: `.imp-tick`, 3px padding either side of nothing, plus the border. */
const TICK = 8
/** A connector between folded cells, where the row is tightest. */
const FOLDED_CONNECTOR_MIN = 4

function impWidth(cell: SpineCell): number {
  return IMP_CHROME + IMP_CHAR * (cell.kind === 'phase' ? cell.phase.length : GATE_LABEL_CHARS)
}

/** Whether a phase keeps its word when the spine folds: it is where the run stands. */
export function keepsWordFolded(cell: PhaseCell): boolean {
  return cell.state === 'current'
}

export interface SpineWordFit {
  /** px the row needs with every phase in words, notes demoted, connectors at 8px. */
  words: number
  /** px it needs folded: only the standing phase in words, connectors at 4px. */
  folded: number
}

/** How wide this spine needs to be in words, and folded. */
export function spineWordFit(spine: Spine): SpineWordFit {
  const cells = spine.cells
  if (cells.length === 0) return { words: 0, folded: 0 }
  const connectors = cells.length - 1
  const words = cells.reduce((w, c) => w + impWidth(c), 0) + connectors * CONNECTOR_MIN
  const folded =
    cells.reduce((w, c) => w + (c.kind === 'phase' && !keepsWordFolded(c) ? TICK : impWidth(c)), 0) +
    connectors * FOLDED_CONNECTOR_MIN
  return { words: Math.ceil(words), folded: Math.ceil(folded) }
}

/**
 * The widths a fold breakpoint may land on. Literal for the same reason the
 * note rungs are: `chips.tsx` maps each to a static container-query variant.
 * Today's profiles land on 360 (patch), 480 (standard) and 600 (full).
 */
export const SPINE_WORD_RUNGS = [360, 420, 480, 540, 600] as const
export type SpineWordRung = (typeof SPINE_WORD_RUNGS)[number]

/**
 * The container width at or above which every phase keeps its word. Rounded
 * up, so at the rung the words provably fit; below it the spine folds rather
 * than crop.
 */
export function wordRung(spine: Spine): SpineWordRung {
  const { words } = spineWordFit(spine)
  return SPINE_WORD_RUNGS.find((r) => r >= words) ?? SPINE_WORD_RUNGS[SPINE_WORD_RUNGS.length - 1]!
}
