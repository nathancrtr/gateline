import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalGitSource } from '../src/index.ts'
import { isHumanDecision, parseLedgerSubject } from '../src/view-model/ledger.ts'

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
