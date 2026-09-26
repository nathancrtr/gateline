// The run header's phase spine (#254). What is under test is the part that
// could quietly become a lie: which cells exist for a profile, where the run is
// standing, and which gate is on the table. The rendering is chips.tsx's job.

import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import {
  CLOSURE_MEANINGS as CORE_CLOSURE_MEANINGS,
  CLOSURES as CORE_CLOSURES,
  GATE_PHASES as CORE_GATE_PHASES,
  PROFILE_GATES as CORE_PROFILE_GATES,
  PROFILE_PHASES as CORE_PROFILE_PHASES,
} from '@gateline/core/record'
import { GATE_QUESTIONS as CORE_GATE_QUESTIONS, PATCH_G1_QUESTION as CORE_PATCH_G1_QUESTION } from '@gateline/core/view-model'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CLOSURE_MEANINGS,
  CLOSURES,
  GATE_PHASES,
  GATE_QUESTIONS,
  type GateId,
  type InboxItem,
  PATCH_G1_QUESTION,
  PROFILE_GATES,
  PROFILE_PHASES,
  type Profile,
  type RunDetailResponse,
  type RunSummary,
} from '../src/api.ts'
import { PhaseSpine } from '../src/components/chips.tsx'
import {
  type GateCell,
  gateNote,
  noteRung,
  type PhaseCell,
  phaseSpine,
  SPINE_NOTE_RUNGS,
  SPINE_WORD_RUNGS,
  spineFit,
  spineWordFit,
  wordRung,
} from '../src/spine.ts'
import { NO_FACTS } from './inbox-facts.helper.ts'

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

/** An inbox item as core would send it; a gate item for `gate` unless told otherwise. */
const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: null,
    escalationIndex: null,
    inflight: null,
    reviewable: true,
    title: '',
    detail: '',
    since: 1,
    packet: [],
    packetRefs: [],
    problems: [],
    ...NO_FACTS,
    ...(over as object),
  }) as InboxItem
/** A gate the inbox holds an item for: what "on the table" means. */
const up = (gate: GateId, over: Partial<InboxItem> = {}) => item({ kind: 'gate', gate, ...over })

const run = (over: Partial<Parameters<typeof phaseSpine>[0]> = {}) =>
  phaseSpine({ profile: 'full', phase: 'implement', pausedReason: null, gates: ledger(), items: [], ...over })

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
    const spine = run({ phase: 'implement', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }), items: [up('G2')] })
    expect(gateCell(spine, 'G2')!.state).toBe('pending')
    expect(gateCell(spine, 'G3')!.state).toBe('future')
  })

  it('G2 is on the table through integrate as well as implement', () => {
    expect(gateCell(run({ phase: 'integrate', items: [up('G2')] }), 'G2')!.state).toBe('pending')
  })

  it('a declined gate reads as decided, not as waiting', () => {
    const spine = run({ phase: 'plan', gates: ledger({ G1: declined('operator', '2026-07-20T08:00:00Z') }) })
    expect(gateCell(spine, 'G1')).toMatchObject({ state: 'declined', by: 'operator' })
  })

  it('a run at rest has no gate on the table', () => {
    const spine = run({
      phase: 'paused',
      pausedReason: 'budget-exhausted',
      gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }),
      items: [item({ kind: 'paused' })],
    })
    expect(gateCell(spine, 'G2')!.state).toBe('future')
  })
})

// #420: the spine called the gate after the current phase "on the table" (the
// yellow) whenever the run was moving, whether or not a gate item existed. On
// `escalated` G2 was yellow while the inbox held only the escalation. The
// yellow means a human is wanted at this spot (settled decision 4), so what
// makes a gate pending is the item that says so.
describe('a gate is on the table only when the inbox holds a gate item for it (#420)', () => {
  const moving = { phase: 'implement', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }) }

  it('with no gate item, the gate the run is working toward is `next`, never pending', () => {
    for (const items of [[], [item({ kind: 'escalation' })], [item({ kind: 'round-cap' })]]) {
      const spine = run({ ...moving, items })
      expect(gateCell(spine, 'G2')!.state).toBe('next')
      expect(spine.cells.some((c) => c.kind === 'gate' && c.state === 'pending')).toBe(false)
      // Nothing to say under it: it is neither up nor decided.
      expect(gateNote(gateCell(spine, 'G2')!)).toBeNull()
    }
  })

  it('an item for another gate does not put this one on the table', () => {
    expect(gateCell(run({ ...moving, items: [up('G3')] }), 'G2')!.state).toBe('next')
  })

  it('carries the card state of the item that put it there', () => {
    expect(gateCell(run({ ...moving, items: [up('G2')] }), 'G2')).toMatchObject({ state: 'pending', card: 'reviewable', role: null })
    expect(gateCell(run({ ...moving, items: [up('G2', { reviewable: false, problems: ['x'] })] }), 'G2')).toMatchObject({
      state: 'pending',
      card: 'bounced',
    })
    expect(
      gateCell(run({ ...moving, items: [up('G2', { reviewable: false, inflight: { role: 'implementer', since: 2 } })] }), 'G2'),
    ).toMatchObject({ state: 'pending', card: 'inflight', role: 'implementer' })
  })

  it('a gate beyond the one the run works toward stays `future`, with or without items', () => {
    expect(gateCell(run(moving), 'G3')!.state).toBe('future')
  })
})

// The same rule over the demo fixtures, through the real server route the run
// page reads, so the spine is asked what the header will actually be handed.
describe('the demo fixtures put the yellow only where the inbox has a gate up (#420)', () => {
  const SRC = 'fixture'
  let fixture: FixtureRepo
  let app: ReturnType<typeof createApp>
  beforeAll(async () => {
    fixture = generateFixtureRepo()
    app = createApp({ sources: [new LocalGitSource(SRC, fixture.dir)] })
  }, 120_000)
  afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

  const detail = async (slug: string): Promise<RunDetailResponse> => {
    const res = await app.request(`/api/runs/${SRC}/${slug}`)
    expect(res.status).toBe(200)
    return (await res.json()) as RunDetailResponse
  }
  const spineOf = (d: RunDetailResponse) => phaseSpine({ ...d.summary, items: d.items })
  const yellow = (d: RunDetailResponse) =>
    [...renderToStaticMarkup(createElement(PhaseSpine, { summary: d.summary, items: d.items })).matchAll(/imp-cur/g)].length

  it.each(['escalated', 'round-cap'])('%s: moving at implement with no gate item — G2 is next, and nothing is yellow', async (slug) => {
    const d = await detail(slug)
    // The premise, so the test cannot pass on a fixture that stopped being this case.
    expect(d.summary.phase).toBe('implement')
    expect(d.items.map((i) => i.kind)).toEqual([slug === 'escalated' ? 'escalation' : 'round-cap'])
    const spine = spineOf(d)
    expect(gateCell(spine, 'G2')!.state).toBe('next')
    expect(spine.cells.filter((c) => c.kind === 'gate' && c.state === 'pending')).toEqual([])
    expect(yellow(d)).toBe(0)
  })

  it('g2-pending: the reviewable G2 item is on the table, and is the one yellow cell', async () => {
    const d = await detail('g2-pending')
    const spine = spineOf(d)
    expect(gateCell(spine, 'G2')).toMatchObject({ state: 'pending', card: 'reviewable' })
    expect(yellow(d)).toBe(1)
  })

  it('malformed-spec: a bounced G0 is on the table but not yellow', async () => {
    const d = await detail('malformed-spec')
    expect(gateCell(spineOf(d), 'G0')).toMatchObject({ state: 'pending', card: 'bounced' })
    expect(yellow(d)).toBe(0)
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
    const spine = run({
      phase: 'implement',
      gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', 'x') }),
      items: [up('G2')],
    })
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
    run({
      phase: 'implement',
      gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') }),
      items: [up('G2')],
    })
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
    // crops and scrolls, which is still one sequence; wrapping is not. (With
    // the UI face's narrower notes the tightest full state comes within 3px
    // of fitting at 1000 with its notes open; the rung rounds it up and demotes
    // them there anyway, which the test above holds. The premise here is 900.)
    for (const spine of fullProfileStates()) {
      const { withNotes, dense } = spineFit(spine)
      expect(withNotes).toBeGreaterThan(AT_900)
      expect(dense).toBeLessThanOrEqual(AT_1000)
      expect(dense).toBeLessThanOrEqual(AT_900)
    }
  })

  it('patch keeps its provenance at every width the header offers — it always fitted', () => {
    const patch = run({
      profile: 'patch',
      phase: 'implement',
      gates: ledger({ G1: approved('operator', '2026-07-14T11:30:00Z') }),
      items: [up('G2')],
    })
    for (const width of [AT_800, AT_900, AT_1000, AT_1280]) expect(notesShownAt(patch, width)).toBe(true)
  })

  it('standard keeps its provenance at 900px and above, and yields only at 800', () => {
    const standard = run({
      profile: 'standard',
      phase: 'implement',
      gates: ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') }),
      items: [up('G2')],
    })
    expect(notesShownAt(standard, AT_1280)).toBe(true)
    expect(notesShownAt(standard, AT_1000)).toBe(true)
    expect(notesShownAt(standard, AT_900)).toBe(true)
    expect(notesShownAt(standard, AT_800)).toBe(false)
  })

  it('a lighter profile never asks for more room than a heavier one', () => {
    const g = ledger({ G0: approved('operator', '2026-07-12T09:00:00Z'), G1: approved('operator', '2026-07-14T11:30:00Z') })
    const widths = (['patch', 'standard', 'full'] as Profile[]).map((profile) => spineFit(run({ profile, phase: 'implement', gates: g, items: [up('G2')] })).withNotes,
    )
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
      const spine = run({ profile, phase: 'implement', gates: ledger({ G0: approved('operator', 'x'), G1: approved('operator', 'x') }), items: [up('G2')] })
      expect(noteRung(spine)).toBeGreaterThanOrEqual(spineFit(spine).withNotes)
    }
  })
})

// #427: at 390px the spine needed 574px and cropped inside its row. Below its
// word rung it now folds instead: the phase the run stands at keeps its word,
// the others become ticks, every gate keeps its code. What is pinned here is
// the arithmetic; the e2e geometry sweep measures the real row at 390px and
// across the 800–1280px band.
describe('below its word rung the spine folds, and folded it fits a phone (#427)', () => {
  const PROFILES = ['patch', 'standard', 'full'] as Profile[]
  /** The row a phone gives the spine: the viewport less `max-md:px-4` on <main>. */
  const phoneRow = (viewport: number) => viewport - 32
  /** The row at 900px, as measured in Chromium (#427's before/after table). */
  const ROW_AT_900 = 636
  /** Every position a moving run can stand at, for every profile. */
  const everyPosition = () =>
    PROFILES.flatMap((profile) => PROFILE_PHASES[profile].filter((p) => p !== 'paused' && p !== 'closed').map((phase) => run({ profile, phase })))

  it('folded, every profile fits a 360px phone at every position — the widest word it keeps is `implement`', () => {
    for (const spine of everyPosition()) expect(spineWordFit(spine).folded).toBeLessThanOrEqual(phoneRow(360))
  })

  it('in words, a full spine does not fit a 390px phone — the premise of folding', () => {
    expect(spineWordFit(run({ profile: 'full' })).words).toBeGreaterThan(phoneRow(390))
  })

  it('every profile keeps its words at 900px and above: the fold never hides a name that fits', () => {
    for (const spine of everyPosition()) expect(wordRung(spine)).toBeLessThanOrEqual(ROW_AT_900)
  })

  it('the rung is rounded up, so at the rung itself the words provably fit', () => {
    for (const spine of everyPosition()) expect(wordRung(spine)).toBeGreaterThanOrEqual(spineWordFit(spine).words)
    expect([...SPINE_WORD_RUNGS]).toEqual([...SPINE_WORD_RUNGS].sort((a, b) => a - b))
  })

  it('the notes yield before the words do: every note rung is wider than the word rung', () => {
    for (const spine of everyPosition()) expect(noteRung(spine)).toBeGreaterThan(wordRung(spine))
  })

  it('a lighter profile folds at a narrower width than a heavier one', () => {
    const rungs = PROFILES.map((profile) => wordRung(run({ profile })))
    expect(rungs).toEqual([360, 480, 600])
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
