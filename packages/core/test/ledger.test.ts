import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalGitSource } from '../src/index.ts'
import { parseRunState, type RunState } from '../src/record/schema.ts'
import { isHumanDecision, type LedgerCommit, parseLedgerSubject, readLedger } from '../src/view-model/ledger.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
const source = new LocalGitSource('sandbox', repoRoot)

// The subjects below are copied from the two seams that write state.yaml —
// record/actions.ts + record/scaffold.ts for human decisions, and
// orchestrator/src/engine.ts for the bot verbs. If a template there changes,
// these fail, which is the point: the ledger is a reading of that grammar.
describe('parseLedgerSubject — human decisions', () => {
  it('reads a gate approval with its approver and burden', () => {
    const e = parseLedgerSubject('state(wordfreq): G1 approved by Nathan Carter [burden: confirmation]')
    expect(e.kind).toBe('gate-approved')
    expect(e.actor).toBe('human')
    expect(e.gate).toBe('G1')
    expect(e.by).toBe('Nathan Carter')
    expect(e.burden).toBe('confirmation')
    expect(e.slug).toBe('wordfreq')
  })

  it('reads an approval that was also held', () => {
    const e = parseLedgerSubject('state(mdtoc): G2 approved by Ada L [burden: light-correction] and held (waiting on CI)')
    expect(e.kind).toBe('gate-approved')
    expect(e.by).toBe('Ada L')
    expect(e.burden).toBe('light-correction')
  })

  it('reads an approval with no burden recorded', () => {
    const e = parseLedgerSubject('state(dupefind): G0 approved by Nathan Carter')
    expect(e.kind).toBe('gate-approved')
    expect(e.by).toBe('Nathan Carter')
    expect(e.burden).toBeNull()
  })

  it('reads a decline', () => {
    const e = parseLedgerSubject('state(csvpeek): G1 declined by Nathan Carter')
    expect(e.kind).toBe('gate-declined')
    expect(e.actor).toBe('human')
    expect(e.gate).toBe('G1')
    expect(e.by).toBe('Nathan Carter')
  })

  it('reads an escalation resolution, with and without a disposition', () => {
    const withD = parseLedgerSubject('state(csvpeek): escalation #2 resolved by Nathan Carter [disposition: replan]')
    expect(withD.kind).toBe('escalation-resolved')
    expect(withD.by).toBe('Nathan Carter')

    const withoutD = parseLedgerSubject('state(csvpeek): escalation #1 resolved by Nathan Carter')
    expect(withoutD.kind).toBe('escalation-resolved')
    expect(withoutD.by).toBe('Nathan Carter')
  })

  it('reads pause, resume, arm and stage', () => {
    expect(parseLedgerSubject('state(x): paused by Nathan Carter (budget review)')).toMatchObject({
      kind: 'paused',
      by: 'Nathan Carter',
    })
    expect(parseLedgerSubject('state(x): resumed to implement by Nathan Carter (G2 re-opened)')).toMatchObject({
      kind: 'resumed',
      by: 'Nathan Carter',
    })
    expect(parseLedgerSubject('state(x): armed by Nathan Carter')).toMatchObject({ kind: 'armed', by: 'Nathan Carter' })
    // #200 — a closure and its undo are human decisions, not `other`.
    expect(parseLedgerSubject('state(x): closed by Nathan Carter [disposition: already-delivered]')).toMatchObject({
      kind: 'closed',
      actor: 'human',
      verb: 'closed',
      by: 'Nathan Carter',
    })
    expect(parseLedgerSubject('state(x): reopened to implement by Nathan Carter (was closed as abandoned)')).toMatchObject({
      kind: 'reopened',
      actor: 'human',
      by: 'Nathan Carter',
    })
    expect(parseLedgerSubject('state(x): staged by Nathan Carter [client-key: abc123]')).toMatchObject({
      kind: 'staged',
      by: 'Nathan Carter',
    })
  })

  it('does not coerce a gate token outside the closed set', () => {
    const e = parseLedgerSubject('state(x): G9 approved by Nathan Carter')
    expect(e.kind).toBe('gate-approved')
    expect(e.gate).toBeNull()
  })

  it('does not coerce an unknown burden', () => {
    const e = parseLedgerSubject('state(x): G0 approved by Nathan Carter [burden: enthusiastic]')
    expect(e.burden).toBeNull()
  })
})

describe('parseLedgerSubject — orchestrator verbs', () => {
  it('reads every verb the engine emits, attributed to the orchestrator', () => {
    const cases: [string, string][] = [
      ['state(x): dispatched implementer(01-core-logic)', 'dispatched'],
      ['state(x): bounced spec.md — re-dispatching analyst (missing: Acceptance criteria)', 'bounced'],
      ['state(x): advanced — phase implement → integrate', 'advanced'],
      ['state(x): escalated (paused: escalation) — reviewer did not converge', 'escalated'],
      ['state(x): metered implementer(01-core-logic r1) $0.91', 'metered'],
      ['state(x): harvested 3 artifacts', 'harvested'],
    ]
    for (const [subject, kind] of cases) {
      const e = parseLedgerSubject(subject)
      expect(e.kind, subject).toBe(kind)
      expect(e.actor, subject).toBe('orchestrator')
      expect(isHumanDecision(e), subject).toBe(false)
    }
  })

  it('reads an escalation with no pause clause', () => {
    expect(parseLedgerSubject('state(x): escalated — round cap reached').kind).toBe('escalated')
  })
})

describe('parseLedgerSubject — verbatim and unknown grammars', () => {
  it('keeps detail byte-identical to the record after the state() frame', () => {
    const detail = 'G2 approved by Nathan Carter [burden: heavy-correction]'
    expect(parseLedgerSubject(`state(run): ${detail}`).detail).toBe(detail)
  })

  it('returns a non-state subject verbatim rather than guessing', () => {
    const e = parseLedgerSubject('feat: add the thing')
    expect(e.kind).toBe('other')
    expect(e.actor).toBe('unknown')
    expect(e.slug).toBeNull()
    expect(e.detail).toBe('feat: add the thing')
  })

  it('keeps the slug but stays "other" for a state grammar it does not know', () => {
    const e = parseLedgerSubject('state(run): manual recovery')
    expect(e.kind).toBe('other')
    expect(e.slug).toBe('run')
    expect(e.detail).toBe('manual recovery')
  })

  it('never reports a human actor for an orchestrator verb', () => {
    // The orchestrator structurally never writes gates.* (AGENTS.md); the
    // ledger must not be the place that blurs it.
    const e = parseLedgerSubject('state(x): advanced — G1 approved')
    expect(e.actor).toBe('orchestrator')
    expect(e.gate).toBeNull()
  })
})

// Acceptance check against this repository's real history, in the idiom of
// real-repo.test.ts and the shadow replays: the grammar this parser claims to
// read is the grammar the seams actually wrote across every finished run.
describe('this repository — the ledger reads the history it claims to', () => {
  it('reads creation-seam — an orchestrator-era run merged to the default branch', async () => {
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'creation-seam')!
    const history = await source.stateHistory(ref)
    expect(history.length).toBeGreaterThan(0)

    const entries = history.map((h) => parseLedgerSubject(h.subject))

    // Gate decisions are present and every one names a human.
    const decisions = entries.filter((e) => e.kind === 'gate-approved' || e.kind === 'gate-declined')
    expect(decisions.length).toBeGreaterThan(0)
    for (const d of decisions) {
      expect(d.actor).toBe('human')
      expect(d.by).toBeTruthy()
    }

    // The engine acted here too, and its verbs are attributed to it.
    expect(entries.some((e) => e.actor === 'orchestrator')).toBe(true)

    // The orchestrator never writes gates.* (AGENTS.md). Nothing carrying an
    // engine verb may come back as a human decision, or the ledger would be
    // asserting an approval no human made.
    for (const e of entries) {
      if (e.actor === 'orchestrator') expect(e.gate).toBeNull()
      if (e.kind === 'gate-approved' || e.kind === 'gate-declined') expect(e.actor).toBe('human')
    }

    // The overwhelming majority of an engine-run's state commits are legible as
    // ledger entries — this guards against the grammar drifting away from the
    // parser without anyone noticing.
    const legible = entries.filter((e) => e.kind !== 'other').length
    expect(legible / entries.length).toBeGreaterThan(0.9)
  })

  it('degrades to verbatim prose on the v0 runs, which predate the state() grammar', async () => {
    // wordfreq/mdtoc/dupefind were human-orchestrated: their state.yaml commits
    // are `<slug>: <prose>` harvest messages, not decision records. The ledger
    // must render those as-is rather than force them into a verb — the bounce
    // rule turned on the UI. Gate decisions for these runs remain available
    // from collectRunDecisions, which reads state.yaml content, not subjects.
    const runs = await source.listRuns()
    const ref = runs.find((r) => r.slug === 'wordfreq')!
    const history = await source.stateHistory(ref)
    const entries = history.map((h) => parseLedgerSubject(h.subject))

    expect(entries.every((e) => e.kind === 'other')).toBe(true)
    for (const [i, e] of entries.entries()) expect(e.detail).toBe(history[i]!.subject)
  })
})

// #426: the ledger joined to the state each commit wrote. The facts are the
// record's own fields — the approver's `notes:`, the closure's `reason:`, the
// escalation entry a row is about — never a sentence composed from them.
describe('readLedger — facts from the state each commit wrote', () => {
  const gate = (o: { by?: string; notes?: string; approved?: boolean } | null) =>
    o ? `{approved: ${o.approved ?? true}, by: ${o.by ?? 'Nathan Carter'}, at: 2026-09-01T09:00:00Z, notes: ${o.notes ? JSON.stringify(o.notes) : 'null'}}` : '{approved: false, by: null, at: null, notes: null}'
  type GateOpt = Parameters<typeof gate>[0]
  const state = (o: { gates?: Partial<Record<'G0' | 'G1' | 'G2' | 'G3', GateOpt>>; escalations?: string[]; closure?: string } = {}): RunState => {
    const yaml = [
      'run: toy',
      'branch: run/toy',
      `phase: ${o.closure ? 'closed' : 'implement'}`,
      ...(o.closure ? [`closure: ${o.closure}`] : []),
      'gates:',
      ...(['G0', 'G1', 'G2', 'G3'] as const).map((g) => `  ${g}: ${gate(o.gates?.[g] ?? null)}`),
      `escalations:${o.escalations?.length ? `\n${o.escalations.map((e) => `  - ${e}`).join('\n')}` : ' []'}`,
    ].join('\n')
    const parsed = parseRunState(yaml)
    if (!parsed.state) throw new Error(`test state did not parse: ${parsed.error}`)
    return parsed.state
  }
  const at = (subject: string, s: RunState | null): LedgerCommit => ({ subject: `state(toy): ${subject}`, state: s })

  it('lifts the approver\'s notes onto a gate decision, attributed to the gate entry\'s named human', () => {
    const notes = 'Accept ADR-2 as written.\n\nThe fixture label stays.'
    const [e] = readLedger([at('G1 approved by Nathan Carter [burden: confirmation]', state({ gates: { G0: {}, G1: { notes } } })), at('G0 approved by Nathan Carter', state({ gates: { G0: {} } }))])
    expect(e!.notes).toEqual([{ gate: 'G1', by: 'Nathan Carter', text: notes }])
    expect(e!.reason).toBeNull()
  })

  it('lifts a decline\'s notes — the reason the gate was sent back', () => {
    const [e] = readLedger([at('G2 declined by Ada L', state({ gates: { G2: { by: 'Ada L', approved: false, notes: 'AC3.2 is untested.' } } }))])
    expect(e!.kind).toBe('gate-declined')
    expect(e!.notes).toEqual([{ gate: 'G2', by: 'Ada L', text: 'AC3.2 is untested.' }])
  })

  it('carries no note when the gate recorded none', () => {
    const [e] = readLedger([at('G0 approved by Nathan Carter', state({ gates: { G0: {} } }))])
    expect(e!.notes).toEqual([])
  })

  it('names an escalation resolution by who escalated and about what, and keeps the index as an address', () => {
    const esc =
      '{at: 2026-09-01T09:00:00Z, from_role: orchestrator, reason: "reviewer escalated task 04-fixture-label — see review-04.md", resolved: true, resolved_by: Nathan Carter, resolution: "Re-review with the fixture fixed.", disposition: re-review}'
    const [e] = readLedger([at('escalation #0 resolved by Nathan Carter [disposition: re-review]', state({ escalations: [esc] }))], ['review-04.md'])
    expect(e).toMatchObject({
      kind: 'escalation-resolved',
      escalationIndex: 0,
      escalatedBy: 'reviewer',
      escalatedAbout: '04-fixture-label',
      disposition: 're-review',
      notes: [{ gate: null, by: 'Nathan Carter', text: 'Re-review with the fixture fixed.' }],
    })
  })

  it('names an engine-originated escalation by its writer, and reads the round cap\'s task', () => {
    const cap = '{at: 2026-09-01T09:00:00Z, from_role: orchestrator, reason: "task 02-errors: 3 review rounds without convergence — usually a spec ambiguity", resolved: true, resolved_by: Nathan Carter, resolution: another round}'
    const other = '{at: 2026-09-01T08:00:00Z, from_role: verifier, reason: "AC2.1 unverifiable at G2", resolved: false}'
    const [e] = readLedger([at('escalation #1 resolved by Nathan Carter', state({ escalations: [other, cap] }))])
    expect(e).toMatchObject({ escalationIndex: 1, escalatedBy: 'orchestrator', escalatedAbout: '02-errors' })
    const [v] = readLedger([at('escalation #0 resolved by Nathan Carter', state({ escalations: [other, cap] }))])
    expect(v).toMatchObject({ escalationIndex: 0, escalatedBy: 'verifier', escalatedAbout: 'G2' })
  })

  it('points an engine escalation at its card, with the report the reason names — else the run state — behind it', () => {
    const esc = '{at: 2026-09-01T09:00:00Z, from_role: orchestrator, reason: "reviewer escalated task 04-x — see review-04.md", resolved: false}'
    const history = [at('escalated (paused: escalation) — reviewer escalated task 04-x — see review-04.md', state({ escalations: [esc] })), at('dispatched reviewer(04-x r1)', state())]
    const [withReport] = readLedger(history, ['review-04.md'])
    expect(withReport).toMatchObject({ escalationIndex: 0, escalatedBy: 'reviewer', escalatedAbout: '04-x' })
    expect(withReport!.target).toMatchObject({ decide: 'esc-0', artifact: { path: 'review-04.md', kind: 'review-report' } })
    const [without] = readLedger(history, [])
    expect(without!.target).toMatchObject({ decide: 'esc-0', artifact: { path: 'state.yaml', kind: 'state' } })
  })

  it('attributes nothing across an unreadable predecessor', () => {
    const esc = '{at: 2026-09-01T09:00:00Z, from_role: orchestrator, reason: "round cap", resolved: false}'
    const [e] = readLedger([at('escalated — round cap', state({ escalations: [esc] })), at('manual edit', null)])
    expect(e!.target).toBeNull()
    expect(e!.escalationIndex).toBeNull()
  })

  it('reads a commit outside the grammar for the gates it decided, and only those', () => {
    const history = [
      at('harvest', state({ gates: { G0: { notes: 'fine' }, G1: { notes: 'ADR-1 accepted' } } })),
      at('seed', state({ gates: { G0: { notes: 'fine' } } })),
    ]
    const [harvest, seed] = readLedger(history)
    expect(harvest!.kind).toBe('other')
    expect(harvest!.notes).toEqual([{ gate: 'G1', by: 'Nathan Carter', text: 'ADR-1 accepted' }])
    expect(seed!.notes).toEqual([{ gate: 'G0', by: 'Nathan Carter', text: 'fine' }])
  })

  it('never reads the state for an engine verb that cannot carry a human\'s words', () => {
    const [e] = readLedger([at('advanced — phase implement', state({ gates: { G0: { notes: 'fine' } } }))])
    expect(e!.notes).toEqual([])
    expect(e!.reason).toBeNull()
  })

  it('keeps parseLedgerSubject a reading of the subject alone — every state fact empty', () => {
    const e = parseLedgerSubject('state(x): G1 approved by Nathan Carter')
    expect(e).toMatchObject({ notes: [], reason: null, escalationIndex: null, escalatedBy: null, escalatedAbout: null, target: null })
  })
})

// The same facts over the demo fixtures (@gateline/fixtures), which the
// browser check and the server serve. What they lack is said where it bites:
// no fixture commits an `escalated` or an `escalation #<n> resolved` subject,
// so those rows are exercised above against states built in the test.
describe('readLedger — over the demo fixtures', () => {
  let fx: FixtureContext
  beforeAll(async () => {
    fx = await makeFixture()
  })
  afterAll(() => dropFixture(fx))

  const ledgerOf = async (slug: string) => {
    const ref = (await fx.source.listRuns()).find((r) => r.slug === slug)!
    const [history, artifacts] = await Promise.all([fx.source.stateHistory(ref), fx.source.listArtifacts(ref)])
    return readLedger(history, artifacts)
  }

  it('puts closed-delivered\'s closure reason under the commit that recorded it', async () => {
    const ledger = await ledgerOf('closed-delivered')
    const withReason = ledger.filter((e) => e.reason)
    expect(withReason).toHaveLength(1)
    expect(withReason[0]!.reason).toEqual({ gate: null, by: 'operator', text: 'The work landed by another path; this record closes to match reality.' })
  })

  it('puts every decided gate\'s notes under the commit that decided it', async () => {
    const done = (await ledgerOf('done-merged')).flatMap((e) => e.notes)
    expect(done).toEqual([
      { gate: 'G1', by: 'operator', text: 'ADR-1 accepted' },
      { gate: 'G2', by: 'operator', text: 'merged' },
    ])
    const g3 = (await ledgerOf('g3-pending')).flatMap((e) => e.notes)
    expect(g3).toEqual([{ gate: 'G2', by: 'operator', text: 'merged' }])
  })

  it('reads g2-pending\'s decision rows, which recorded no notes, as carrying none', async () => {
    const decisions = (await ledgerOf('g2-pending')).filter((e) => e.kind === 'gate-approved')
    expect(decisions.map((e) => e.gate)).toEqual(['G1', 'G0'])
    for (const d of decisions) expect(d.notes).toEqual([])
  })

  it('points g2-pending\'s bounce at the review report it bounced', async () => {
    const bounced = (await ledgerOf('g2-pending')).find((e) => e.kind === 'bounced')!
    expect(bounced.target).toMatchObject({ decide: null, artifact: { path: 'review-02.md', kind: 'review-report', id: '02' } })
  })
})
