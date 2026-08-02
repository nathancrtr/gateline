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
import { phaseSpine, type GateCell, type PhaseCell } from '../src/spine.ts'

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
