// Field views for the record's YAML (#434): a work item over its contract's
// keys, `state.yaml` as the run's ledger. What is under test is that every
// value is the record's own, as written, in the contract's order and under
// the contract's word; that nothing is inferred from prose; and that what the
// view does not type is named rather than dropped. The regressions quote real
// committed records line for line.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Field,
  type FieldView,
  parseRunState,
  type RunRef,
  runStateView,
  unreadableStateView,
  validateArtifact,
  workItemContract,
  workItemView,
} from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
let refs: Map<string, RunRef>

beforeAll(async () => {
  ctx = await makeFixture()
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

const read = async (slug: string, path: string) => (await ctx.source.readArtifact(refs.get(slug)!, path))!
const field = (view: FieldView, key: string) => view.fields.find((f) => f.key === key)
const group = (view: FieldView, key: string) => view.groups.find((g) => g.key === key)
const byKey = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.key, f]))

/** A run state read the way the server reads it: parsed, then viewed over the same text. */
const viewOf = (text: string): FieldView => {
  const { state, error } = parseRunState(text)
  expect(error).toBeNull()
  return runStateView(state!, text)
}
const stateView = async (slug: string) => viewOf(await read(slug, 'state.yaml'))

describe('workItemView', () => {
  /** Every key the contract names, each written; one list mixes ids and a sentence. */
  const EVERY_KEY = `id: 04-fixture-label
title: Label every page with its **fixture**
requirements: [R3, R4]

scope: |
  Stamp the fixture label on every page the demo serves.

  Cites AC3.1 and ADR-5.

file_contact_surface:
  - packages/web/src/pages/run.tsx
  - packages/web/test/
  - the shared stylesheet, whichever file holds it

acceptance_tests:
  - AC3.1
  - "pytest tests/test_thing.py passes"

depends_on: [01-core, 02-errors]

status: in-review

notes: |
  Round 1: widened the surface by the stylesheet (ADR-5).
`

  it('reads every key the contract names, in the contract’s order, under the contract’s word', async () => {
    const contract = workItemContract(await ctx.source.templates.read('work-item.yaml'))
    const view = workItemView('tasks/04-fixture-label.yaml', EVERY_KEY, contract)
    expect(view.kind).toBe('work-item')
    expect(view.fields.map((f) => [f.key, f.label])).toEqual([
      ['id', 'Id'],
      ['title', 'Title'],
      ['requirements', 'Requirements'],
      ['scope', 'Scope'],
      ['file_contact_surface', 'File-contact surface'],
      ['acceptance_tests', 'Acceptance tests'],
      ['depends_on', 'Depends on'],
      ['status', 'Status'],
      ['notes', 'Notes'],
    ])
    const f = byKey(view.fields)
    expect(f.id).toMatchObject({ kind: 'name', value: '04-fixture-label' })
    // Markdown stays markdown: the passage is the file's words, not a rendering.
    expect(f.title).toMatchObject({ kind: 'passage', value: 'Label every page with its **fixture**' })
    expect(f.requirements).toMatchObject({ kind: 'entries', value: [{ text: 'R3', face: 'name' }, { text: 'R4', face: 'name' }] })
    expect(f.scope).toMatchObject({ kind: 'passage', value: 'Stamp the fixture label on every page the demo serves.\n\nCites AC3.1 and ADR-5.\n' })
    // The record's own addresses, quoted — a prose entry included, unnormalized.
    expect(f.file_contact_surface).toMatchObject({
      kind: 'addresses',
      value: ['packages/web/src/pages/run.tsx', 'packages/web/test/', 'the shared stylesheet, whichever file holds it'],
    })
    // The face is per entry: the id beside a sentence is still a Name.
    expect(f.acceptance_tests).toMatchObject({
      kind: 'entries',
      value: [
        { text: 'AC3.1', face: 'name' },
        { text: 'pytest tests/test_thing.py passes', face: 'text' },
      ],
    })
    expect(f.depends_on).toMatchObject({ kind: 'entries', value: [{ text: '01-core', face: 'name' }, { text: '02-errors', face: 'name' }] })
    expect(f.status).toMatchObject({ kind: 'word', value: 'in-review' })
    expect(f.notes).toMatchObject({ kind: 'passage', value: 'Round 1: widened the surface by the stylesheet (ADR-5).\n' })
    expect(view.fields.some((x) => x.audience !== undefined)).toBe(false)
    expect(view.rawKeys).toEqual([])
    expect(view.comments).toBe(false)
    expect(view.withheld).toBeNull()
  })

  it('reads each fixture work item as fields, with the status the file wrote', async () => {
    const contract = workItemContract(await ctx.source.templates.read('work-item.yaml'))
    for (const [slug, path, status] of [
      ['g2-pending', 'tasks/01-core.yaml', 'review-approved'],
      ['g1-pending', 'tasks/03-cli.yaml', 'pending'],
      ['escalated', 'tasks/01-core.yaml', 'in-progress'],
      ['patch-g1-pending', 'tasks/01-hotfix.yaml', 'pending'],
    ] as const) {
      const view = workItemView(path, await read(slug, path), contract)
      expect(view.withheld, `${slug} ${path}`).toBeNull()
      expect(field(view, 'status')).toMatchObject({ kind: 'word', value: status })
      expect(field(view, 'file_contact_surface')?.kind).toBe('addresses')
    }
    const cli = workItemView('tasks/03-cli.yaml', await read('g1-pending', 'tasks/03-cli.yaml'), contract)
    expect(field(cli, 'depends_on')).toMatchObject({ kind: 'entries', value: [{ text: '01-core', face: 'name' }] })
    expect(field(cli, 'file_contact_surface')).toMatchObject({ value: ['src/cli.py', 'src/core.py'] })
  })

  it('a list entry is the line as written: a command stays literal text, markdown and all (mdtoc, dupefind)', () => {
    const mdtoc = `- "python3 -c \\"import mdtoc as m; assert m.render_toc([(1,'Title'),(2,'Section A'),(3,'Sub A1'),(2,'Section B')]) == '- [Title](#title)\\\\n  - [Section A](#section-a)\\\\n    - [Sub A1](#sub-a1)\\\\n  - [Section B](#section-b)\\\\n'\\"  # AC6.1"`
    const dupefind = `- "python3 -c \\"import dupefind as d; assert d.render_groups([]) == ''\\"  # AC4.2/AC6.1/AC6.2 zero bytes"`
    const view = workItemView('tasks/01-x.yaml', `id: 01-x\nfile_contact_surface: []\nacceptance_tests:\n  ${mdtoc}\n  ${dupefind}\n  - "python3 -m dupefind __main__ guard"\n`)
    const tests = field(view, 'acceptance_tests')!
    expect(tests.kind).toBe('entries')
    const value = (tests as Extract<Field, { kind: 'entries' }>).value
    expect(value.every((e) => e.face === 'text')).toBe(true)
    expect(value[0]!.text).toContain("'- [Title](#title)\\n")
    expect(value[2]!.text).toBe('python3 -m dupefind __main__ guard')
  })

  it('an empty list is declared empty; a key the file does not write has no field', () => {
    const view = workItemView('tasks/01-a.yaml', 'id: 01-a\nfile_contact_surface: []\ndepends_on: []\nstatus: pending\n')
    expect(field(view, 'depends_on')).toMatchObject({ kind: 'entries', value: [] })
    expect(field(view, 'title')).toBeUndefined()
    expect(field(view, 'notes')).toBeUndefined()
  })

  it('a fork’s surface written as a mapping withholds the view, and is never a field reading “none”', async () => {
    const path = 'tasks/01-core.yaml'
    const view = workItemView(path, await read('forked-contract', path))
    expect(view.withheld).toMatchObject({ grammar: 'a list under the key', token: 'file_contact_surface:', lookedIn: { kind: 'work-item', path } })
    // "Cannot read" is not "nothing declared": the key is bytes, not an empty field.
    expect(field(view, 'file_contact_surface')).toBeUndefined()
    expect(view.rawKeys).toEqual(['file_contact_surface'])
  })

  it('names the keys it does not type, and the comments it does not show', () => {
    const view = workItemView('tasks/01-a.yaml', '# header comment, the template’s\nid: 01-a\nfile_contact_surface: []  # a note\nowner: platform\nstatus: pending\n')
    expect(view.rawKeys).toEqual(['owner'])
    expect(view.comments).toBe(true)
    // A header comment alone is the template's, not this item's.
    expect(workItemView('tasks/01-a.yaml', '# header\nid: 01-a\nfile_contact_surface: []\n').comments).toBe(false)
  })

  it('reads its keys and order from the template, and folds nothing', () => {
    const contract = workItemContract('id: x\ntitle: t\nfile_contact_surface: []\nstatus: pending\nnotes: |\n')
    expect(contract).toEqual({ keys: ['id', 'title', 'file_contact_surface', 'status', 'notes'] })
    expect(workItemContract(null).keys).toContain('file_contact_surface')
  })
})

describe('runStateView', () => {
  it('paused-budget: the reason as a word, the budget as spelled, the ledger sized and left to the bytes', async () => {
    const view = await stateView('paused-budget')
    expect(view.kind).toBe('state')
    expect(view.fields.map((f) => [f.key, f.label])).toEqual([
      ['run', 'Run'],
      ['branch', 'Branch'],
      ['phase', 'Phase'],
      ['profile', 'Profile'],
      ['paused_reason', 'Paused reason'],
    ])
    expect(field(view, 'branch')).toMatchObject({ kind: 'addresses', value: ['run/paused-budget'] })
    expect(field(view, 'phase')).toMatchObject({ kind: 'word', value: 'paused' })
    expect(field(view, 'paused_reason')).toMatchObject({ kind: 'word', value: 'budget-exhausted' })
    // The fixture writes no `profile:`: full by the contract's default, and said so.
    expect(field(view, 'profile')).toMatchObject({ kind: 'name', value: 'full', defaulted: true })
    const budget = byKey(group(view, 'budget')!.entries[0]!.fields)
    expect(budget.cost_limit_usd).toMatchObject({ kind: 'amount', label: 'Cost limit', value: { text: '10', isNull: false } })
    expect(budget.cost_spent_usd).toMatchObject({ kind: 'amount', label: 'Cost spent', value: { text: '10.4', isNull: false } })
    expect(budget.ledger).toMatchObject({ kind: 'count', label: 'Ledger', value: { n: 0, unit: 'entries' } })
    expect(view.rawKeys).toEqual(['budget.ledger'])
    // The fixture carries the contract's inline comments.
    expect(view.comments).toBe(true)
    // The profile's gates, and only those; each quotes its `approved:` as written.
    const gates = group(view, 'gates')!.entries
    expect(gates.map((g) => g.name)).toEqual(['G0', 'G1', 'G2', 'G3'])
    expect(gates[0]!.fields).toEqual([
      { key: 'approved', label: 'Approved', kind: 'word', value: 'true' },
      { key: 'by', label: 'By', kind: 'name', value: 'operator' },
      { key: 'at', label: 'At', kind: 'time', value: '2026-06-27T09:00:00Z' },
      { key: 'burden', label: 'Burden', kind: 'word', value: 'confirmation' },
    ])
    expect(gates[1]!.fields).toEqual([{ key: 'approved', label: 'Approved', kind: 'word', value: 'false' }])
    expect(group(view, 'closure')).toBeUndefined()
    expect(group(view, 'escalations')).toBeUndefined()
  })

  it('closed-delivered: the closure — disposition, who, when, and the reason as a passage', async () => {
    const view = await stateView('closed-delivered')
    expect(field(view, 'phase')).toMatchObject({ kind: 'word', value: 'closed' })
    const closure = group(view, 'closure')!
    expect(closure.label).toBe('Closure')
    expect(closure.entries[0]!.fields).toEqual([
      { key: 'as', label: 'Disposition', kind: 'word', value: 'already-delivered' },
      { key: 'by', label: 'Closed by', kind: 'name', value: 'operator' },
      { key: 'at', label: 'Closed at', kind: 'time', value: '2026-06-29T11:00:00Z' },
      { key: 'reason', label: 'Reason', kind: 'passage', value: 'The work landed by another path; this record closes to match reality.' },
    ])
    // Its unresolved escalation is still open in the record, so it does not fold.
    const esc = group(view, 'escalations')!.entries
    expect(esc).toHaveLength(1)
    expect(esc[0]!.audience).toBeUndefined()
    expect(esc[0]!.fields.map((f) => f.key)).toEqual(['from_role', 'at', 'reason', 'resolved'])
    expect(byKey(esc[0]!.fields)).toMatchObject({
      from_role: { kind: 'name', label: 'From role', value: 'orchestrator' },
      reason: { kind: 'passage', value: 'implementer failed twice' },
      resolved: { kind: 'word', value: 'false' },
    })
    expect(group(view, 'tasks')!.entries[0]).toMatchObject({
      name: '01-core',
      fields: [
        { key: 'status', kind: 'word', value: 'failed' },
        { key: 'review_rounds', kind: 'count', value: { n: 0, unit: 'rounds', of: 3 } },
      ],
    })
  })

  it('escalated: nothing is parsed out of the reason line; the reason stays whole', async () => {
    const view = await stateView('escalated')
    const [esc] = group(view, 'escalations')!.entries
    expect(esc!.fields.map((f) => f.key)).toEqual(['from_role', 'at', 'reason', 'resolved'])
    const f = byKey(esc!.fields)
    expect(f.from_role).toMatchObject({ kind: 'name', value: 'verifier' })
    expect(f.reason).toMatchObject({ kind: 'passage', value: 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo' })
    expect(field(view, 'paused_reason')).toBeUndefined()
    expect(group(view, 'tasks')!.entries[0]!.fields[1]).toMatchObject({ value: { n: 1, unit: 'rounds', of: 3 } })
  })

  it('g2-pending: decided gates quote `true`; the gate on the table quotes `false`', async () => {
    const view = await stateView('g2-pending')
    const approved = (name: string) => group(view, 'gates')!.entries.find((g) => g.name === name)!.fields[0]
    expect(approved('G1')).toEqual({ key: 'approved', label: 'Approved', kind: 'word', value: 'true' })
    expect(approved('G2')).toEqual({ key: 'approved', label: 'Approved', kind: 'word', value: 'false' })
    expect(group(view, 'tasks')!.entries.map((e) => e.name)).toEqual(['01-core', '02-errors'])
  })

  it('wordfreq: an unquoted note split at its comma is named, not silently truncated', () => {
    // runs/wordfreq/state.yaml, lines 13–16 as committed. YAML reads the
    // comma in G1's note as the end of `notes:` and the rest as a key.
    const view = viewOf(`run: wordfreq
branch: run/wordfreq
phase: done               # spec | plan | implement | integrate | release | done | paused
paused_reason: null

budget:
  cost_limit_usd: 5      # exhaustion pauses the run; it never silently degrades
  cost_spent_usd: 0

gates:                    # a gate entry is written ONLY by the named human
  G0: {approved: true, by: nthncrtr, at: 2026-07-07, notes: all 8 assumptions accepted as resolved}
  G1: {approved: true, by: nthncrtr, at: 2026-07-08, notes: all 7 ADRs accepted, incl. apps/<slug>/ convention (ADR-1)}
  G2: {approved: true, by: nthncrtr, at: 2026-07-08, notes: merged; ADR-8/ADR-9 plan amendments acknowledged; budget-metering gap noted}
  G3: {approved: true, by: nthncrtr, at: 2026-07-08, notes: N/A — local CLI, no deploy surface; Ops not dispatched}

tasks: []
escalations: []
`)
    const g1 = byKey(group(view, 'gates')!.entries.find((g) => g.name === 'G1')!.fields)
    expect(g1.notes).toMatchObject({ kind: 'passage', value: 'all 7 ADRs accepted' })
    expect(view.rawKeys).toContain('gates.G1.incl. apps/<slug>/ convention (ADR-1)')
    expect(view.rawKeys).toContain('gates.G3.no deploy surface; Ops not dispatched')
    expect(field(view, 'profile')).toMatchObject({ value: 'full', defaulted: true })
  })

  it('mdtoc and runner-agent: a figure is its source text, and a written null is shown as written', () => {
    const spent = viewOf(`run: mdtoc
branch: run/mdtoc
phase: done
profile: patch
budget:
  cost_limit_usd: 50      # exhaustion pauses the run; it never silently degrades
  cost_spent_usd: 10.10   # derived: the sum of ledger[].cost_usd
gates:
  G1: {approved: true, by: a, at: x, notes: null}
  G2: {approved: true, by: a, at: x, notes: null}
`)
    expect(byKey(group(spent, 'budget')!.entries[0]!.fields).cost_spent_usd).toMatchObject({ value: { text: '10.10', isNull: false } })
    const unlimited = viewOf(`run: runner-agent
branch: run/runner-agent
phase: implement
profile: patch
budget:
  cost_limit_usd: null
  cost_spent_usd: 0
gates:
  G1: {approved: true, by: a, at: x, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
`)
    expect(byKey(group(unlimited, 'budget')!.entries[0]!.fields).cost_limit_usd).toMatchObject({ kind: 'amount', value: { text: 'null', isNull: true } })
  })

  it('a resolved escalation is history and folds; nested and top-level extras are named by path', () => {
    const view = viewOf(`run: toy
branch: run/toy
phase: implement
profile: patch
paused_reason: null
intake: {source: cli, ref: null, url: null, client_key: null, staged_by: someone}
budget: {cost_limit_usd: 5, cost_spent_usd: 1.25, ledger: [{at: x, role: reviewer, cost_usd: 1.25}]}
gates:
  G0: {approved: true, by: Nathan Carter, at: 2026-09-01T09:00:00Z, notes: null}
  G1: {approved: true, by: Nathan Carter, at: 2026-09-01T10:00:00Z, notes: "Accept **ADR-2**.", burden: light-correction}
  G2: {approved: false, by: Nathan Carter, at: 2026-09-02T10:00:00Z, notes: null}
tasks:
  - {id: 04-fixture-label, status: in-review, review_rounds: 1, owner: web}
escalations:
  - {at: 2026-09-01T12:00:00Z, from_role: orchestrator, reason: "reviewer escalated task 04-fixture-label — see review-04.md", resolved: true, resolved_by: Nathan Carter, resolved_at: 2026-09-01T13:00:00Z, resolution: "Widen the surface.", disposition: return-to-implement}
  - {at: 2026-09-03T12:00:00Z, from_role: orchestrator, reason: "round cap reached", resolved: false}
`)
    const gates = group(view, 'gates')!.entries
    expect(gates.map((g) => g.name)).toEqual(['G1', 'G2'])
    expect(byKey(gates[0]!.fields)).toMatchObject({
      by: { kind: 'name', value: 'Nathan Carter' },
      notes: { kind: 'passage', value: 'Accept **ADR-2**.' },
      burden: { kind: 'word', value: 'light-correction' },
    })
    // A declined gate quotes what the file wrote: `false`, with the name beside it.
    expect(byKey(gates[1]!.fields)).toMatchObject({ approved: { value: 'false' }, by: { value: 'Nathan Carter' } })
    const [resolved, open] = group(view, 'escalations')!.entries
    expect(resolved!.audience).toBe('audit')
    expect(open!.audience).toBeUndefined()
    expect(byKey(resolved!.fields)).toMatchObject({
      resolved: { kind: 'word', value: 'true' },
      resolved_by: { kind: 'name', value: 'Nathan Carter' },
      resolution: { kind: 'passage', value: 'Widen the surface.' },
      disposition: { kind: 'word', value: 'return-to-implement' },
    })
    expect(byKey(resolved!.fields).by).toBeUndefined()
    expect(byKey(resolved!.fields).about).toBeUndefined()
    expect(byKey(group(view, 'budget')!.entries[0]!.fields).ledger).toMatchObject({ value: { n: 1, unit: 'entries' } })
    // What the schema passes through untyped is named by path, and left to the bytes;
    // G0 is written but is no gate of a patch run.
    expect(view.rawKeys).toEqual(['intake', 'budget.ledger', 'gates.G0', 'tasks[0].owner'])
    expect(view.comments).toBe(false)
  })

  it('an unreadable state is the parser’s own words, as a diagnostic', () => {
    const view = unreadableStateView('state.yaml is not valid YAML: bad indentation')
    expect(view.fields).toEqual([{ key: 'error', label: 'Run state parser', kind: 'diagnostic', value: 'state.yaml is not valid YAML: bad indentation' }])
  })
})

describe('the run state contract badge', () => {
  it('bad-state fails its contract, with the parser’s words as the reason', async () => {
    const templates = { read: async () => null }
    const bad = await validateArtifact('state.yaml', await read('bad-state', 'state.yaml'), templates)
    expect(bad.ok).toBe(false)
    expect(bad.contract).toBe('state.yaml')
    expect(bad.notes.join('\n')).toContain('state.yaml is not valid YAML')
    const good = await validateArtifact('state.yaml', await read('g2-pending', 'state.yaml'), templates)
    expect(good).toMatchObject({ ok: true, missing: [] })
  })
})
