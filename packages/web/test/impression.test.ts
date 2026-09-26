// Colour carries state (#419, settled decision 8 in packages/web/DESIGN.md).
//
// Colour means health, plus the one ready decision. The mapping is fixed and
// inspectable, so it is asserted here as a table: each inbox kind and gate
// state, each gate-ledger cell and each spine gate cell, to the tone class it
// renders. Whether the result reads well was checked in the browser; this is
// what keeps the mapping from drifting once it does.
//
// Two rules are asserted on their own because the first mapping broke them and
// was rejected: nothing in the inbox or on a card is the yellow, and nothing on
// a bounced packet is red.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { GateId, InboxItem, RunDetailResponse, RunSummary } from '../src/api.ts'
import { GATE_STATE_TONE, GateChip, KindChip, kindTone, PhaseSpine, spineGateTone } from '../src/components/chips.tsx'
import { NeedsYouCard } from '../src/pages/run/decide-card.tsx'
import { NO_FACTS } from './inbox-facts.helper.ts'

const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: 'G1',
    escalationIndex: null,
    inflight: null,
    reviewable: true,
    title: 'G1 — Is this how we’d want it built, cut into safe parallel pieces?',
    detail: 'a-run is waiting on G1',
    since: 1,
    packet: [],
    packetRefs: [],
    problems: [],
    ...NO_FACTS,
    question: 'Is this how we’d want it built, cut into safe parallel pieces?',
    ...(over as object),
  }) as InboxItem

const READY = {}
const BOUNCED = { reviewable: false, problems: ['plan.md: missing required sections — Work breakdown'] }
const INFLIGHT = { reviewable: false, inflight: { role: 'architect', since: 2 } }

/** The class list of the first impression in some markup. */
function impClasses(html: string): string[] {
  const m = /class="(imp[^"]*)"/.exec(html)
  if (!m) throw new Error(`no impression in ${html}`)
  return m[1]!.split(/\s+/).filter(Boolean)
}

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)))
}

const undecided = { approved: false, decided: false, by: null, at: null, burden: null }
const summary = (gates: Partial<RunSummary['gates']> = {}, phase = 'plan'): RunSummary =>
  ({
    source: 'local',
    slug: 'a-run',
    ref: 'run/a-run',
    kind: 'branch',
    phase,
    profile: 'full',
    pausedReason: null,
    closure: null,
    budget: { limit: 25, spent: 0 },
    tasks: { total: 0, done: 0, maxRounds: 0, roundCap: 3 },
    updatedAt: null,
    aheadOfOrigin: null,
    behindOrigin: null,
    gates: { G0: undecided, G1: undecided, G2: undecided, G3: undecided, ...gates },
  }) as unknown as RunSummary

describe('the inbox chip takes the tone of the cockpit’s state', () => {
  // [what the row is, the item, the tone it takes]
  const TABLE: [string, Partial<InboxItem>, string][] = [
    ['a gate ready to decide', READY, 'go'],
    ['a bounced packet — the engine re-dispatches', BOUNCED, 'dot'],
    ['a superseded, in-flight packet', INFLIGHT, 'dot'],
    ['an escalation', { kind: 'escalation', gate: null }, 'warn'],
    ['a round cap', { kind: 'round-cap', gate: null }, 'warn'],
    ['a malformed record', { kind: 'malformed', gate: null, reviewable: false }, 'hatch mark'],
    ['a staged run', { kind: 'staged', gate: null }, 'dot'],
    ['a paused run', { kind: 'paused', gate: null }, 'dot'],
  ]

  it.each(TABLE)('%s', (_, over, tone) => {
    expect(kindTone(item(over))).toBe(tone)
    const classes = impClasses(renderToStaticMarkup(createElement(KindChip, { item: item(over) })))
    for (const t of tone.split(' ')) expect(classes).toContain(`imp-${t}`)
  })

  it('is never the yellow, and a bounced packet is never red', () => {
    for (const [, over] of TABLE) {
      const html = renderToStaticMarkup(createElement(KindChip, { item: item(over) }))
      expect(html).not.toContain('imp-cur')
    }
    const bounced = renderToStaticMarkup(createElement(KindChip, { item: item(BOUNCED) }))
    expect(bounced).not.toContain('imp-mark')
    expect(bounced).not.toContain('imp-hatch')
  })
})

describe('the gate ledger reads approved and declined by colour and glyph', () => {
  const TABLE: [string, RunSummary['gates'][GateId], string[], string][] = [
    ['approved', { approved: true, decided: true, by: 'operator', at: '2026-09-26' }, ['imp-ok'], '✓'],
    ['declined', { approved: false, decided: true, by: 'operator', at: '2026-09-26' }, ['imp-struck', 'imp-mark'], '✕'],
    ['pending', { approved: false, decided: false, by: null, at: null }, [], '·'],
  ] as never

  it.each(TABLE)('%s', (_, cell, tones, glyph) => {
    const html = renderToStaticMarkup(createElement(GateChip, { id: 'G1', cell }))
    const classes = impClasses(html)
    expect(classes.filter((c) => c !== 'imp')).toEqual(tones)
    expect(html).toContain(`G1 ${glyph}`)
  })
})

describe('the spine’s gate cells take the ledger’s colours, and keep the yellow for the gate on the table', () => {
  it('maps each cell state', () => {
    expect(GATE_STATE_TONE).toEqual({ approved: 'ok', declined: 'struck mark', pending: 'cur', next: '', future: 'dot' })
  })

  it('dots a pending gate that offers no decision, bounced or in flight', () => {
    expect(spineGateTone('pending', null)).toBe('cur')
    expect(spineGateTone('pending', 'bounced')).toBe('dot')
    expect(spineGateTone('pending', 'inflight')).toBe('dot')
    // A decided gate is what it is, whatever the inbox holds.
    expect(spineGateTone('approved', 'bounced')).toBe('ok')
  })

  const spineHtml = (items: InboxItem[]) =>
    renderToStaticMarkup(
      createElement(PhaseSpine, { summary: summary({ G0: { approved: true, decided: true, by: 'operator', at: '2026-09-25' } } as never), items }),
    )
  const cellClasses = (items: InboxItem[], gate: GateId) => {
    const html = spineHtml(items)
    const span = new RegExp(`data-spine-gate="${gate}"[^>]*>\\s*(<span[^>]*>)`).exec(html)?.[1]
    if (!span) throw new Error(`no ${gate} cell in ${html}`)
    return { classes: impClasses(span), title: /title="([^"]*)"/.exec(span)?.[1] ?? '' }
  }

  it('renders the approved cell green and the table’s gate yellow', () => {
    expect(cellClasses([item(READY)], 'G0').classes).toContain('imp-ok')
    expect(cellClasses([item(READY)], 'G1').classes).toContain('imp-cur')
  })

  // #420: the yellow is derived from the gate item, never from the phase. A
  // run at `plan` with only an escalation open is working toward G1, and
  // nobody is wanted there: the plain undecided mark, and no yellow anywhere.
  it('keeps the yellow off a gate with no item up for it, whatever the run’s phase', () => {
    for (const items of [[], [item({ kind: 'escalation', gate: null })], [item({ kind: 'round-cap', gate: null })]]) {
      const g1 = cellClasses(items, 'G1')
      expect(g1.classes).toEqual(['imp'])
      expect(g1.title).toContain('not on the table yet')
      expect(spineHtml(items)).not.toContain('imp-cur')
    }
  })

  it('does not call an in-flight gate bounced — the fix found on the way (#159 reaches the spine)', () => {
    const inflight = cellClasses([item(INFLIGHT)], 'G1')
    expect(inflight.classes).toContain('imp-dot')
    expect(inflight.title).toContain('superseded, waiting on architect')
    expect(inflight.title).not.toContain('bounced')
    const bounced = cellClasses([item(BOUNCED)], 'G1')
    expect(bounced.classes).toContain('imp-dot')
    expect(bounced.classes).not.toContain('imp-mark')
    expect(bounced.title).toContain('packet bounced')
  })
})

describe('the decide card’s eyebrow', () => {
  const detail = { summary: summary(), items: [], state: null, stateError: null, artifacts: [], history: [], validations: [] } as unknown as RunDetailResponse
  const eyebrow = (over: Partial<InboxItem>) => {
    const html = render(createElement(NeedsYouCard, { item: item(over), now: 10, detail }))
    const card = html.slice(html.indexOf('data-needs-card'))
    const m = /<span[^>]*class="(imp[^"]*)"[^>]*>([^<]*)/.exec(card)
    if (!m) throw new Error(`no eyebrow in ${card}`)
    return { classes: m[1]!.split(/\s+/).filter((c) => c && c !== 'imp'), text: m[2]! }
  }

  it('is the signal blue, hollow, on a gate ready to decide', () => {
    expect(eyebrow(READY)).toEqual({ classes: ['imp-go'], text: 'needs you · G1' })
  })

  it('is dotted on a bounced packet and on an in-flight one — the machine’s turn', () => {
    expect(eyebrow(BOUNCED).classes).toEqual(['imp-dot'])
    expect(eyebrow(BOUNCED).text).toBe('bounced · G1')
    expect(eyebrow(INFLIGHT).classes).toEqual(['imp-dot'])
  })

  it('is the plain mark on any other kind, so the kind chip beside it carries the colour', () => {
    expect(eyebrow({ kind: 'escalation', gate: null }).classes).toEqual([])
  })

  it('puts no yellow on any card, and no red on a bounced one', () => {
    for (const over of [READY, BOUNCED, INFLIGHT, { kind: 'escalation', gate: null }, { kind: 'round-cap', gate: null }] as Partial<InboxItem>[]) {
      expect(render(createElement(NeedsYouCard, { item: item(over), now: 10, detail }))).not.toContain('imp-cur')
    }
    const bounced = render(createElement(NeedsYouCard, { item: item(BOUNCED), now: 10, detail }))
    expect(bounced).not.toMatch(/text-bad|imp-mark/)
  })
})
