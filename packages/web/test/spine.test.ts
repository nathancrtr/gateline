// The run header's phase spine (#254). What is under test is the part that
// could quietly become a lie: which cells exist for a profile, where the run is
// standing, and which gate is on the table. The rendering is chips.tsx's job.
import { describe, expect, it } from 'vitest'
import {
  GATE_PHASES as CORE_GATE_PHASES,
  PROFILE_GATES as CORE_PROFILE_GATES,
  PROFILE_PHASES as CORE_PROFILE_PHASES,
  CLOSURES as CORE_CLOSURES,
  CLOSURE_MEANINGS as CORE_CLOSURE_MEANINGS,
} from '@gateline/core/record'
import { GATE_QUESTIONS as CORE_GATE_QUESTIONS, PATCH_G1_QUESTION as CORE_PATCH_G1_QUESTION } from '@gateline/core/view-model'
import {
  CLOSURES,
  CLOSURE_MEANINGS,
  GATE_PHASES,
  GATE_QUESTIONS,
  PATCH_G1_QUESTION,
  PROFILE_GATES,
  PROFILE_PHASES,
  type GateId,
  type Profile,
  type RunSummary,
} from '../src/api.ts'
import { SPINE_NOTE_RUNGS, gateNote, noteRung, phaseSpine, spineFit, type GateCell, type PhaseCell } from '../src/spine.ts'

type Ledger = RunSummary['gates']

const undecided = { approved: false, decided: false, by: null, at: null }
const approved = (by: string, at: string) => ({ approved: true, decided: true, by, at })
const declined = (by: string, at: string) => ({ approved: false, decided: true, by, at })

const ledger = (over: Partial<Ledger> = {}): Ledger => ({
  G0: undecided,
  G1: undecided,
  G2: undecided,
  G3: undecided,
  ...over,
})

const run = (over: Partial<Parameters<typeof phaseSpine>[0]> = {}) =>
  phaseSpine({ profile: 'full', phase: 'implement', pausedReason: null, gates: ledger(), ...over })

const phases = (cells: ReturnType<typeof phaseSpine>['cells']) =>
  cells.filter((c): c is PhaseCell => c.kind === 'phase').map((c) => c.phase)
const gates = (cells: ReturnType<typeof phaseSpine>['cells']) =>
  cells.filter((c): c is GateCell => c.kind === 'gate').map((c) => c.gate)
const gateCell = (spine: ReturnType<typeof phaseSpine>, id: GateId) =>
  spine.cells.find((c): c is GateCell => c.kind === 'gate' && c.gate === id)
const phaseCell = (spine: ReturnType<typeof phaseSpine>, name: string) =>
  spine.cells.find((c): c is PhaseCell => c.kind === 'phase' && c.phase === name)

// The browser takes types from core but never values, so the closed vocabulary
// is mirrored in api.ts. A mirror that drifts would put the wrong shape in the
// header while every core test still passed, so it is checked here — this is
// the one place both copies are in scope at once.
describe('the mirrored vocabulary matches core', () => {
  it('PROFILE_GATES, PROFILE_PHASES and GATE_PHASES are byte-equal to the originals', () => {
    expect(PROFILE_GATES).toEqual(CORE_PROFILE_GATES)
    expect(PROFILE_PHASES).toEqual(CORE_PROFILE_PHASES)
    expect(GATE_PHASES).toEqual(CORE_GATE_PHASES)
  })

  it('the closure vocabulary matches core — the disposition set is the record’s, not the UI’s (#200)', () => {
    expect(CLOSURES).toEqual([...CORE_CLOSURES])
    expect(CLOSURE_MEANINGS).toEqual(CORE_CLOSURE_MEANINGS)
  })

  it('the gate questions are quoted, not paraphrased', () => {
    expect(GATE_QUESTIONS).toEqual(CORE_GATE_QUESTIONS)
    expect(PATCH_G1_QUESTION).toBe(CORE_PATCH_G1_QUESTION)
  })
})

describe('the spine is shaped by the profile', () => {
  it('full: six phases and four gates, in sequence', () => {
    const spine = run({ profile: 'full' })
    expect(phases(spine.cells)).toEqual(['spec', 'plan', 'implement', 'integrate', 'release', 'done'])
    expect(gates(spine.cells)).toEqual(['G0', 'G1', 'G2', 'G3'])
  })

  it('patch: four phases and two gates — no G0 or G3 cell anywhere', () => {
    const spine = run({ profile: 'patch', phase: 'plan' })
    expect(phases(spine.cells)).toEqual(['plan', 'implement', 'integrate', 'done'])
    expect(gates(spine.cells)).toEqual(['G1', 'G2'])
    expect(gateCell(spine, 'G0')).toBeUndefined()
    expect(gateCell(spine, 'G3')).toBeUndefined()
  })

  it('standard: five phases and three gates, ending at G2', () => {
    const spine = run({ profile: 'standard', phase: 'spec' })
    expect(phases(spine.cells)).toEqual(['spec', 'plan', 'implement', 'integrate', 'done'])
    expect(gates(spine.cells)).toEqual(['G0', 'G1', 'G2'])
  })

  it('a gate spanning two phases renders once, after the last of them', () => {
    const spine = run()
    const order = spine.cells.map((c) => (c.kind === 'phase' ? c.phase : c.gate))
    expect(order).toEqual(['spec', 'G0', 'plan', 'G1', 'implement', 'integrate', 'G2', 'release', 'G3', 'done'])
  })

  it('every profile places every one of its gates and nothing else', () => {
    for (const profile of ['patch', 'standard', 'full'] as Profile[]) {
      expect(gates(run({ profile, phase: 'done' }).cells)).toEqual(PROFILE_GATES[profile])
    }
  })
})

describe('where the run stands', () => {
  it('lights the current phase and marks the ones behind it as past', () => {
    const spine = run({ phase: 'implement' })
    expect(spine.position).toBe('implement')
    expect(phaseCell(spine, 'spec')!.state).toBe('past')
    expect(phaseCell(spine, 'plan')!.state).toBe('past')
    expect(phaseCell(spine, 'implement')!.state).toBe('current')
    expect(phaseCell(spine, 'release')!.state).toBe('future')
  })

  it('a phase that names no position in the profile lights nothing', () => {
    const spine = run({ phase: 'unknown' })
    expect(spine.position).toBeNull()
    expect(phases(spine.cells).every((p) => phaseCell(spine, p)!.state === 'future')).toBe(true)
  })

  it('a patch run is never placed at spec or release — they are not its phases', () => {
    const spine = run({ profile: 'patch', phase: 'spec' })
    expect(spine.position).toBeNull()
    expect(phaseCell(spine, 'spec')).toBeUndefined()
  })
})

describe('gate states', () => {
  it('decided gates carry their approver and date verbatim', () => {
    const spine = run({
      phase: 'implement',
      gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') }),
    })
    expect(gateCell(spine, 'G0')).toMatchObject({ state: 'approved', by: 'operator', at: '2026-07-12T09:00:00Z' })
    expect(gateCell(spine, 'G1')).toMatchObject({ state: 'approved', by: 'operator' })
  })

  it('the gate on the table is pending; the ones beyond it are not', () => {
    const spine = run({ phase: 'implement', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }) })
    expect(gateCell(spine, 'G2')!.state).toBe('pending')
    expect(gateCell(spine, 'G3')!.state).toBe('future')
  })

  it('G2 is on the table through integrate as well as implement', () => {
    expect(gateCell(run({ phase: 'integrate' }), 'G2')!.state).toBe('pending')
  })

  it('a declined gate reads as decided, not as waiting', () => {
    const spine = run({ phase: 'plan', gates: ledger({ G1: declined('operator', '2026-07-20T08:00:00Z') }) })
    expect(gateCell(spine, 'G1')).toMatchObject({ state: 'declined', by: 'operator' })
  })

  it('a run at rest has no gate on the table', () => {
    const spine = run({ phase: 'paused', pausedReason: 'budget-exhausted', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }) })
    expect(gateCell(spine, 'G2')!.state).toBe('future')
  })
})

describe('rest states are overlaid, never a position in the sequence', () => {
  it('paused stands where it stopped — the phase of its first unapproved gate', () => {
    const spine = run({ phase: 'paused', pausedReason: 'budget-exhausted', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }) })
    expect(spine.rest).toBe('paused')
    expect(spine.position).toBe('implement')
    expect(phaseCell(spine, 'implement')!.state).toBe('current')
  })

  it('staged stands at the start and is distinguishable from paused', () => {
    const spine = run({ phase: 'paused', pausedReason: 'staged' })
    expect(spine.rest).toBe('staged')
    expect(spine.position).toBe('spec')
  })

  it('a staged patch run stands at plan, its own first phase', () => {
    expect(run({ profile: 'patch', phase: 'paused', pausedReason: 'staged' }).position).toBe('plan')
  })

  it('a moving run is never at rest', () => {
    expect(run({ phase: 'implement' }).rest).toBeNull()
  })

  it('closed rests where the run stopped and is never drawn as a position of its own (#200)', () => {
    const spine = run({ phase: 'closed', gates: ledger({ G0: approved('operator', 'x') }) })
    expect(spine.rest).toBe('closed')
    expect(spine.position).toBe('plan') // G0 approved, G1 not
    // The sequence is the profile's phases; `closed` is not one of its steps.
    expect(phases(spine.cells)).not.toContain('closed')
    expect(phaseCell(spine, 'plan')!.state).toBe('current')
  })

  it('a run whose gates are all approved rests at the end', () => {
    const all = ledger({ G0: approved('o', 'x'), G1: approved('o', 'x'), G2: approved('o', 'x'), G3: approved('o', 'x') })
    expect(run({ phase: 'paused', pausedReason: 'escalation', gates: all }).position).toBe('done')
  })
})

// The width the run header actually gives the spine, at a given viewport: the
// app shell is a 192px sidebar (md and up) plus `px-6` on <main>, inside a
// `max-w-5xl` (1024px) column. These are the three widths #295 reproduces on
// plus the wide case, translated once here so the assertions below read in
// viewport terms.
const spineWidthAt = (viewport: number) => Math.min(1024, viewport - 192 - 48)
const AT_800 = spineWidthAt(800) // 560
const AT_900 = spineWidthAt(900) // 660
const AT_1000 = spineWidthAt(1000) // 760
const AT_1280 = spineWidthAt(1280) // 1024

/** The spine keeps its notes in the open at this container width. */
const notesShownAt = (spine: ReturnType<typeof phaseSpine>, width: number) => width >= noteRung(spine)

describe('the under-cell note is the record, not a gloss (#295)', () => {
  it('a gate on the table says so; a decided one gives approver over date', () => {
    const spine = run({ phase: 'implement', gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', 'x') }) })
    expect(gateNote(gateCell(spine, 'G0')!)).toEqual(['operator', '2026-07-12'])
    expect(gateNote(gateCell(spine, 'G2')!)).toEqual(['on the table'])
  })

  it('a gate the run has not reached has nothing to say', () => {
    expect(gateNote(gateCell(run({ phase: 'spec' }), 'G3')!)).toBeNull()
  })

  it('a declined gate is provenance too — the note is about decidedness, not approval', () => {
    const spine = run({ phase: 'plan', gates: ledger({ G1: declined('operator', '2026-07-20T08:00:00Z') }) })
    expect(gateNote(gateCell(spine, 'G1')!)).toEqual(['operator', '2026-07-20'])
  })
})

// #295: the spine wrapped in the 800–1000px band, and a wrapped sequence is not
// the shape the spine exists to show. It now never wraps, so what is left to get
// right is *when* it demotes the under-cell notes to the tooltip — early enough
// that the sequence still fits, late enough that #254's decision to carry
// provenance in the open survives at the widths it was made for.
describe('the fit decides when provenance is demoted', () => {
  // The three demo states #295 reproduces the wrap on. Checked together rather
  // than one at a time: the density work this page has been through failed
  // twice by fixing the state under review and breaking a different one.
  const g2Pending = () =>
    run({ phase: 'implement', gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') }) })
  const doneMerged = () =>
    run({
      phase: 'done',
      gates: ledger({
        G0: approved('operator', '2026-06-28T09:00:00Z'),
        G1: approved('operator', '2026-06-30T09:00:00Z'),
        G2: approved('operator', '2026-07-01T09:00:00Z'),
        G3: approved('operator', '2026-07-02T09:00:00Z'),
      }),
    })
  const closedDelivered = () =>
    run({
      phase: 'closed',
      gates: ledger({ G0: approved('operator', '2026-06-28T09:00:00Z'), G1: approved('operator', '2026-06-30T09:00:00Z') }),
    })
  const fullProfileStates = () => [g2Pending(), doneMerged(), closedDelivered()]

  it('a full profile keeps its notes at 1280px and gives them up through the wrapping band', () => {
    for (const spine of fullProfileStates()) {
      expect(notesShownAt(spine, AT_1280)).toBe(true)
      expect(notesShownAt(spine, AT_1000)).toBe(false)
      expect(notesShownAt(spine, AT_900)).toBe(false)
      expect(notesShownAt(spine, AT_800)).toBe(false)
    }
  })

  it('demoting them is what buys the fit — a dense full spine is inside the 900px band', () => {
    // Not merely tidier: at 900px the notes were the difference between one row
    // and two, and dropping them (with the gaps, so the connectors touch the
    // pills they join) has to actually clear the width. Below that the row
    // crops and scrolls, which is still one sequence; wrapping is not.
    for (const spine of fullProfileStates()) {
      const { withNotes, dense } = spineFit(spine)
      expect(withNotes).toBeGreaterThan(AT_1000)
      expect(dense).toBeLessThanOrEqual(AT_1000)
      expect(dense).toBeLessThanOrEqual(AT_900)
    }
  })

  it('patch keeps its provenance at every width the header offers — it always fitted', () => {
    const patch = run({ profile: 'patch', phase: 'implement', gates: ledger({ G1: approved('operator', '2026-07-14T11:30:00Z') }) })
    for (const width of [AT_800, AT_900, AT_1000, AT_1280]) expect(notesShownAt(patch, width)).toBe(true)
  })

  it('standard keeps its provenance at 900px and above, and yields only at 800', () => {
    const standard = run({
      profile: 'standard',
      phase: 'implement',
      gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') }),
    })
    expect(notesShownAt(standard, AT_1280)).toBe(true)
    expect(notesShownAt(standard, AT_1000)).toBe(true)
    expect(notesShownAt(standard, AT_900)).toBe(true)
    expect(notesShownAt(standard, AT_800)).toBe(false)
  })

  it('a lighter profile never asks for more room than a heavier one', () => {
    const g = ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') })
    const widths = (['patch', 'standard', 'full'] as Profile[]).map((profile) => spineFit(run({ profile, phase: 'implement', gates: g })).withNotes)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  })

  it('a long approver name asks for more room rather than pushing the sequence into a second row', () => {
    const short = run({ phase: 'implement', gates: ledger({ G0: approved('op', 'x'), G1: approved('op', 'x') }) })
    const long = run({ phase: 'implement', gates: ledger({ G0: approved('nathan.andrew.carter', 'x'), G1: approved('op', 'x') }) })
    expect(spineFit(long).withNotes).toBeGreaterThan(spineFit(short).withNotes)
    // …and the pill row is the same width either way: the note is what grew.
    expect(spineFit(long).dense).toBe(spineFit(short).dense)
  })

  it('every rung is a width the header can actually reach, so provenance is never unreachable in the open', () => {
    expect([...SPINE_NOTE_RUNGS]).toEqual([...SPINE_NOTE_RUNGS].sort((a, b) => a - b))
    expect(SPINE_NOTE_RUNGS[SPINE_NOTE_RUNGS.length - 1]).toBeLessThanOrEqual(AT_1280)
  })

  it('the rung is rounded up, so at the rung itself the notes provably fit', () => {
    for (const profile of ['patch', 'standard', 'full'] as Profile[]) {
      const spine = run({ profile, phase: 'implement', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }) })
      expect(noteRung(spine)).toBeGreaterThanOrEqual(spineFit(spine).withNotes)
    }
  })
})

describe('each gate carries the question it asks', () => {
  it('quotes GATE_QUESTIONS for the standard profiles', () => {
    const spine = run({ profile: 'full' })
    expect(gateCell(spine, 'G2')!.question).toBe('Does the evidence support merging?')
  })

  it('a patch run asks the absorbed G0/G1 question at G1', () => {
    const spine = run({ profile: 'patch', phase: 'plan' })
    expect(gateCell(spine, 'G1')!.question).toBe(PATCH_G1_QUESTION)
    expect(gateCell(spine, 'G2')!.question).toBe(GATE_QUESTIONS.G2)
  })
})
