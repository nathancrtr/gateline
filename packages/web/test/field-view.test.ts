// Field views for YAML in the Record reader (#434). The views are built the
// way the server builds them — core's `workItemView` / `runStateView` over
// the record's text — and rendered as static markup through the reader, so
// each case says what the reader shows by default: fields through the
// vocabulary, the bytes behind "show bytes", resolved entries folded, and
// every character the record wrote still there. The click itself is the
// browser's to check (packages/e2e).

import { parseRunState } from '@gateline/core/record'
import { artifactRef, runStateView, workItemContract, workItemView } from '@gateline/core/view-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ArtifactResponse, FieldView, RunDetailResponse, Validation } from '../src/api.ts'
import { bodyForm, FieldViewBody, RecordSurface } from '../src/pages/run/record.tsx'
import { refs } from './artifact-refs.helper.ts'

// Real lines: the scope is fleetview-design's 03-shell-masthead, the list
// entries dupefind's and mdtoc's acceptance tests.
const WORK_ITEM = `id: 04-fixture-label
title: Label every page with its fixture
requirements: [R3]

scope: |
  \`<main>\` still renders <Outlet/> inside the shell, and **every** page is labelled.

file_contact_surface:
  - packages/web/src/pages/run.tsx
  - packages/web/test/

acceptance_tests:
  - AC3.1
  - "python3 -m dupefind __main__ guard exits 0"
  - "assert render_toc(...) == '- [Title](#title)'"

depends_on: [01-core]

status: in-review

notes: |
`

const STATE = `run: toy
branch: run/toy
phase: paused
profile: patch
paused_reason: budget-exhausted   # set when phase=paused
budget:
  cost_limit_usd: 10
  cost_spent_usd: 10.10
  ledger:
    - {at: 2026-09-01T10:00:00Z, role: reviewer, task: 04-fixture-label, round: 1, adapter: a, model: m, tokens_in: 1, tokens_out: 1, cost_usd: 10.1}
gates:
  G1: {approved: true, by: operator, at: 2026-09-01T09:00:00Z, notes: all 7 ADRs accepted, incl. apps/<slug>/ convention (ADR-1), burden: confirmation}
  G2: {approved: false, by: null, at: null, notes: null}
tasks:
  - {id: 04-fixture-label, status: in-review, review_rounds: 2}
escalations:
  - {at: 2026-09-01T12:00:00Z, from_role: orchestrator, reason: "reviewer escalated task 04-fixture-label — see review-04.md", resolved: true, resolved_by: operator, resolved_at: 2026-09-01T13:00:00Z, resolution: "Widen it.", disposition: return-to-implement}
  - {at: 2026-09-02T12:00:00Z, from_role: orchestrator, reason: "round cap reached", resolved: false}
`

const PATHS = ['intent-brief.md', 'tasks/04-fixture-label.yaml', 'state.yaml', 'retro.md', 'notes.txt']
const OK: Validation = { contract: null, ok: true, missing: [], notes: [] }

function render(node: ReactNode, artifacts: Record<string, ArtifactResponse> = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  for (const [path, body] of Object.entries(artifacts)) client.setQueryData(['artifact', 'repo', 'run', path], body)
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(QueryClientProvider, { client }, node)))
}

function reader(path: string, body: Omit<ArtifactResponse, 'path' | 'validation'>, validation: Validation = OK): string {
  const detail = {
    summary: { source: 'repo', slug: 'run', profile: 'patch' },
    items: [],
    state: null,
    stateError: null,
    stateRaw: null,
    validations: {},
    artifacts: PATHS,
    artifactRefs: refs(PATHS),
    history: [],
    branchUrl: null,
    now: 0,
  } as unknown as RunDetailResponse
  return render(createElement(RecordSurface, { detail, selected: path, onSelect: () => {} }), { [path]: { path, validation, ...body } })
}

const workItem = (text = WORK_ITEM) => workItemView('tasks/04-fixture-label.yaml', text, workItemContract(null))
const state = (text = STATE): FieldView => runStateView(parseRunState(text).state!, text)

/** The markup of the element carrying `attr`, through the first `until` after it. */
const slice = (html: string, attr: string, until: string) => {
  const i = html.indexOf(attr)
  if (i < 0) throw new Error(`no ${attr} in ${html}`)
  return html.slice(html.lastIndexOf('<', i), html.indexOf(until, i))
}

describe('a work item reads as fields in the reader', () => {
  const html = reader('tasks/04-fixture-label.yaml', { content: WORK_ITEM, fields: workItem() })

  it('labels each key in the contract’s words, not the YAML key', () => {
    expect(html).toContain('data-field-view="work-item"')
    for (const label of ['Id', 'Requirements', 'Scope', 'File-contact surface', 'Acceptance tests', 'Depends on', 'Status', 'Notes']) {
      expect(html).toContain(`>${label}</dt>`)
    }
    expect(html).not.toContain('>file_contact_surface<')
    expect(html).not.toContain('Files touched')
  })

  it('keeps every character of a passage, raw HTML included', () => {
    const scope = slice(html, 'data-field-passage="scope"', '</div></div>')
    expect(scope).toContain('<code>&lt;main&gt;</code>')
    expect(scope).toContain('still renders &lt;Outlet/&gt; inside the shell')
    expect(scope).toContain('<strong>every</strong>')
  })

  it('sets each list entry in its own face: an id is a Name, a sentence is the line as written', () => {
    const tests = slice(html, 'data-field="acceptance_tests"', '</dd>')
    expect(slice(tests, 'data-field-entry-face="name"', '</li>')).toContain('data-name')
    // Not markdown: `__main__` is not bold "main", and `(#title)` survives.
    expect(tests).toContain('python3 -m dupefind __main__ guard exits 0')
    expect(tests).not.toContain('<strong>')
    expect(tests).toContain('[Title](#title)')
    expect(slice(html, 'data-field="depends_on"', '</dd>')).toContain('>01-core<')
  })

  it('renders the rest through the vocabulary', () => {
    expect(slice(html, 'data-field="id"', '</dd>')).toContain('data-name')
    expect(html).toContain('data-quoted-word="in-review"')
    const surface = slice(html, 'data-field="file_contact_surface"', '</ul>')
    expect(surface.match(/data-address/g)).toHaveLength(2)
    expect(surface).toContain('>packages/web/test/<')
    expect(slice(html, 'data-field="notes"', '</dd>')).toContain('>empty<')
  })

  it('heads the reader with the title, and does not say it twice', () => {
    expect(html).toContain('data-task-title')
    expect(html.match(/Label every page with its fixture/g)).toHaveLength(1)
    expect(html).toContain('runs/run/tasks/04-fixture-label.yaml')
  })

  it('keeps the bytes behind the toggle: no <pre> until "show bytes"', () => {
    expect(slice(html, 'data-show-bytes', '</button>')).toContain('aria-pressed="false"')
    expect(html).toContain('>show bytes</button>')
    expect(html).not.toContain('<pre')
  })
})

describe('state.yaml reads as the run’s ledger', () => {
  const html = reader('state.yaml', { content: STATE, fields: state() })

  it('a gate quotes its `approved:` as written, tinted from that token', () => {
    const g1 = slice(html, 'data-field-entry="G1"', '</li>')
    expect(g1).toContain('>Approved</dt>')
    expect(g1).toMatch(/border-ok-line[^"]*"[^>]*data-quoted-word="true"/)
    expect(g1).not.toContain('>approved<')
    expect(g1).toContain('>operator<')
    expect(g1).toContain('2026-09-01T09:00:00Z')
    expect(g1).toContain('data-quoted-word="confirmation"')
    // `false` with no name beside it is undecided, and plain.
    expect(slice(html, 'data-field-entry="G2"', '</li>')).toMatch(/border-line bg-inset[^"]*"[^>]*data-quoted-word="false"/)
  })

  it('a declined gate — `false` with a name — takes the bad tint, and the word stays `false`', () => {
    const declined = STATE.replace('G2: {approved: false, by: null, at: null', 'G2: {approved: false, by: operator, at: 2026-09-02T09:00:00Z')
    const markup = reader('state.yaml', { content: declined, fields: state(declined) })
    const g2 = slice(markup, 'data-field-entry="G2"', '</li>')
    expect(g2).toMatch(/border-bad-line[^"]*"[^>]*data-quoted-word="false"/)
    expect(g2).not.toContain('declined')
  })

  it('the budget as the file spelled it; the ledger sized under the contract’s word', () => {
    expect(html).toContain('data-quoted-word="budget-exhausted"')
    const budget = slice(html, 'data-field-group="budget"', '</section>')
    expect(budget).toContain('10.10 USD')
    expect(budget).toContain('>Ledger</dt>')
    expect(budget).toContain('1 entry')
    expect(budget).not.toContain('tokens_in')
  })

  it('a written null budget is shown as written', () => {
    const unlimited = STATE.replace('cost_limit_usd: 10', 'cost_limit_usd: null')
    const budget = slice(reader('state.yaml', { content: unlimited, fields: state(unlimited) }), 'data-field-group="budget"', '</section>')
    expect(budget).toMatch(/<code[^>]*>null<\/code>/)
  })

  it('what the view does not type is named by path, comments included', () => {
    const raw = slice(html, 'data-raw-keys', '</p>')
    expect(raw).toContain('>budget.ledger<')
    // wordfreq's G1 note, split by YAML at its comma: the remainder is named.
    expect(raw).toContain('>gates.G1.incl. apps/&lt;slug&gt;/ convention (ADR-1)<')
    expect(raw).toContain('>comments<')
  })

  it('a defaulted profile is captioned as the contract’s default', () => {
    const unwritten = STATE.replace('profile: patch\n', '').replace('G1: {', 'G0: {approved: true, by: a, at: x, notes: null}\n  G1: {').replace('G2: {approved: false, by: null, at: null, notes: null}', 'G2: {approved: false, by: null, at: null, notes: null}\n  G3: {approved: false, by: null, at: null, notes: null}')
    const markup = reader('state.yaml', { content: unwritten, fields: state(unwritten) })
    expect(slice(markup, 'data-field="profile"', '</dd>')).toContain('data-field-defaulted')
    expect(slice(html, 'data-field="profile"', '</dd>')).not.toContain('data-field-defaulted')
  })

  it('a task’s rounds are a count against the cap', () => {
    expect(slice(html, 'data-field-entry="04-fixture-label"', '</li>')).toContain('rounds 2/3')
  })

  it('an open escalation reads in full; a resolved one folds; nothing is parsed out of the reason', () => {
    const escalations = slice(html, 'data-field-group="escalations"', '</section>')
    expect(escalations).toContain('round cap reached')
    expect(escalations).toContain('data-field-fold="escalations"')
    expect(escalations).toContain('Resolved escalations')
    expect(escalations).not.toContain('Widen it.')
    expect(escalations).not.toContain('Escalated by')
    expect(escalations).not.toContain('>About<')
  })

  it('shows no <pre> for the ledger until "show bytes"', () => {
    expect(html).toContain('data-field-view="state"')
    expect(html).not.toContain('<pre')
  })
})

describe('the bytes, on demand', () => {
  it('a withheld view shows the bytes alone, says why, and offers no way back to a guessed view', () => {
    const forked = WORK_ITEM.replace(
      'file_contact_surface:\n  - packages/web/src/pages/run.tsx\n  - packages/web/test/',
      'file_contact_surface:\n  mode: exclusive\n  paths:\n    - src/x.py',
    )
    const view = workItemView('tasks/04-fixture-label.yaml', forked)
    const html = render(createElement(FieldViewBody, { view, content: forked, kind: 'work-item', src: 'repo', slug: 'run' }))
    expect(html).toContain('data-withheld-view')
    expect(slice(html, 'data-bytes', '</pre>')).toContain('mode: exclusive')
    expect(html).not.toContain('data-show-bytes')
    expect(html).not.toContain('File-contact surface')
    expect(html).not.toContain('>none<')
    expect(html).not.toContain('data-withheld-open')
  })

  it('an unreadable state.yaml is the parser’s diagnostic under a failing badge, the bytes one toggle away', () => {
    const view: FieldView = {
      kind: 'state',
      fields: [{ key: 'error', label: 'Run state parser', kind: 'diagnostic', value: 'state.yaml is not valid YAML: x' }],
      groups: [],
      rawKeys: [],
      comments: false,
      withheld: null,
    }
    const failing: Validation = { contract: 'state.yaml', ok: false, missing: [], notes: ['state.yaml is not valid YAML: x'] }
    const html = reader('state.yaml', { content: 'run: [', fields: view }, failing)
    expect(html).toContain('data-diagnostic')
    expect(html.match(/Run state parser/g)).toHaveLength(1)
    expect(html).toContain('>show bytes</button>')
    expect(html).toContain('fails the run state contract')
    expect(slice(html, 'data-contract-failure', '</p>')).not.toContain('missing:')
  })
})

describe('the renderer is chosen by the ref, never by extension in web', () => {
  it('reads kind and format off the ref', () => {
    expect(bodyForm(artifactRef('spec.md'), null)).toBe('markdown')
    expect(bodyForm(artifactRef('review-01.md'), null)).toBe('markdown')
    expect(bodyForm(artifactRef('tasks/01-core.yaml'), workItem())).toBe('fields')
    expect(bodyForm(artifactRef('state.yaml'), state())).toBe('fields')
    expect(bodyForm(artifactRef('retro.md'), null)).toBe('markdown')
    expect(bodyForm(artifactRef('notes.txt'), null)).toBe('bytes')
    expect(bodyForm(artifactRef('sweep.yaml'), null)).toBe('bytes')
  })

  it('an older server with no field view, or a path with no ref, shows the bytes', () => {
    expect(bodyForm(artifactRef('state.yaml'), null)).toBe('bytes')
    expect(bodyForm(null, null)).toBe('bytes')
  })

  it('a retro reads as markdown; a text file as its bytes', () => {
    expect(reader('retro.md', { content: '# Retro\n\nIt went **well**.\n', fields: null })).toContain('<strong>well</strong>')
    expect(reader('notes.txt', { content: 'plain **text**', fields: null })).toContain('<pre data-bytes')
  })
})
