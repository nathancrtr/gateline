// History renders what the humans wrote at their decisions, and names what the
// engine's rows point at (#426, docs/SEAM.md §8.6 and §9 step 10).
//
// Layer 2: static markup, no DOM. The entries are built the way the server
// builds them — `parseLedgerSubject` for the subject's reading — with the
// state facts `readLedger` adds spelled out beside it, so each case says which
// fact it is about. Raw mode is a click away and so is the browser's to check;
// what is asserted here is the default reading, where the `#<n>` index must
// not appear.

import { artifactRef, parseLedgerSubject } from '@gateline/core/view-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ArtifactRef, HistoryEntry, InboxItem, LedgerEntry } from '../src/api.ts'
import { HistoryTab, ledgerLink, noteCaption, noteFolds } from '../src/pages/run/history.tsx'
import { NO_FACTS } from './inbox-facts.helper.ts'

let n = 0
const row = (subject: string, facts: Partial<LedgerEntry> = {}, phase: string | null = 'implement'): HistoryEntry => ({
  oid: `${(n++).toString(16).padStart(7, '0')}abcdef`,
  time: 1_780_000_000 - n * 3600,
  author: 'Nathan Carter',
  subject,
  phase,
  ledger: { ...parseLedgerSubject(subject), ...facts },
})

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)))
}

const history = (h: HistoryEntry[], opts: { items?: InboxItem[]; artifacts?: ArtifactRef[] } = {}) =>
  render(createElement(HistoryTab, { history: h, src: 'fixture', slug: 'toy', ...opts }))

/** The page's visible words: tags and attributes stripped, entities decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

/** The markup of the first element carrying `attr` through to its row's end. */
const block = (html: string, attr: string) => {
  const i = html.indexOf(attr)
  if (i < 0) throw new Error(`no ${attr} in ${html}`)
  return html.slice(html.lastIndexOf('<', i), html.indexOf('</li>', i))
}

const escalationItem = (index: number): InboxItem =>
  ({ kind: 'escalation', gate: null, escalationIndex: index, source: 'fixture', slug: 'toy', title: '', detail: '', since: 0, reviewable: true, problems: [], inflight: null, packet: [], packetRefs: [], ...NO_FACTS }) as InboxItem

describe('a gate decision carries the approver’s note', () => {
  const notes = 'Accept **ADR-2** as written.\n\nThe fixture label stays.'
  const html = history([row('state(toy): G1 approved by Nathan Carter [burden: confirmation]', { notes: [{ gate: 'G1', by: 'Nathan Carter', text: notes }] })])

  it('quotes the note under the row as rendered markdown, in the one boxed kind', () => {
    const note = block(html, 'data-ledger-note="notes"')
    expect(note).toContain('<strong>ADR-2</strong>')
    expect(note).toContain('<p>The fixture label stays.</p>')
    expect(note).not.toContain('<pre')
    expect(note).toMatch(/class="border px-3 py-2 border-line bg-surface"/)
  })

  it('captions it with whose words they are, and names the gate only when the row does not', () => {
    expect(text(block(html, 'data-ledger-note="notes"'))).toContain('note by Nathan Carter')
    expect(text(block(html, 'data-ledger-note="notes"'))).not.toContain('G1 note')
    const other = history([row('state(toy): run complete', { notes: [{ gate: 'G2', by: 'operator', text: 'merged' }] })])
    expect(text(other)).toContain('G2 note by operator')
  })

  it('renders no note block for a decision that recorded none', () => {
    expect(history([row('state(toy): G0 approved by operator [burden: confirmation]')])).not.toContain('data-ledger-note')
  })

  it('folds a long note behind its caption instead of truncating it', () => {
    const long = Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the decline.`).join('\n')
    expect(noteFolds(long)).toBe(true)
    expect(noteFolds('merged')).toBe(false)
    const folded = history([row('state(toy): G2 declined by Ada L', { notes: [{ gate: 'G2', by: 'Ada L', text: long }] })])
    expect(folded).toContain('data-fold')
    expect(text(folded)).toContain('note by Ada L')
  })
})

describe('a closure carries its reason', () => {
  const reason = 'The work landed by another path; this record closes to match reality.'
  it('quotes the reason under the closure row, attributed to the human who closed it', () => {
    const html = history([row('state(toy): closed by operator [disposition: already-delivered]', { reason: { gate: null, by: 'operator', text: reason } })])
    const note = block(html, 'data-ledger-note="reason"')
    expect(text(note)).toContain('reason by operator')
    expect(text(note)).toContain(reason)
  })

  it('says “closure reason” when the row it sits under is not the closure’s own', () => {
    const html = history([row('state(toy): artifacts', { reason: { gate: null, by: 'operator', text: reason } })])
    expect(text(html)).toContain('closure reason by operator')
  })

  it('captions from facts alone', () => {
    expect(noteCaption({ gate: null, by: null, text: 'x' }, { gate: null, kind: 'closed' }, 'reason')).toBe('reason')
  })
})

describe('an escalation resolution is named, not numbered', () => {
  const subject = 'state(toy): escalation #0 resolved by Nathan Carter [disposition: re-review]'
  const html = history([
    row(subject, {
      escalatedBy: 'reviewer',
      escalatedAbout: '04-fixture-label',
      notes: [{ gate: null, by: 'Nathan Carter', text: 'Re-review with the fixture fixed.' }],
    }),
  ])

  it('reads “<role> escalated · <task>” with both as Names, and the resolver and disposition after', () => {
    // The row's first line only: the notes follow it in the same row.
    const line = block(html, 'data-ledger-escalation').split('</div>')[0]!
    expect(text(line).trim()).toBe('reviewer escalated · 04-fixture-label · resolved by Nathan Carter re-review')
    expect(line.match(/data-name/g)).toHaveLength(2)
    expect(line).toContain('data-quoted-word="re-review"')
  })

  it('quotes the resolution under it', () => {
    expect(text(block(html, 'data-ledger-note="notes"'))).toContain('Re-review with the fixture fixed.')
  })

  it('never says escalation #<n> outside raw mode — not in the text, not in a tooltip', () => {
    expect(text(html)).not.toMatch(/escalation #\d/)
    expect(html).not.toMatch(/escalation #\d/)
  })

  it('still reads when the entry could not be found: the stamp and the resolver, no index', () => {
    const bare = history([row(subject)])
    expect(text(bare)).not.toMatch(/escalation #\d/)
    expect(text(bare)).toContain('resolved by Nathan Carter')
  })
})

describe('an engine row links to the view that exists', () => {
  const review = artifactRef('review-02.md') as ArtifactRef
  const state = artifactRef('state.yaml') as ArtifactRef
  const ctx = { src: 'fixture', slug: 'toy', items: [] as InboxItem[], artifacts: [review, state] }
  const bouncedSubject = 'state(toy): bounced review-02.md — re-dispatching reviewer (missing: Boundary check)'
  const escalatedSubject = 'state(toy): escalated (paused: escalation) — reviewer escalated task 02-errors — see review-02.md'
  const escalatedFacts: Partial<LedgerEntry> = { escalationIndex: 0, target: { decide: 'esc-0', artifact: review } }

  it('keeps the engine’s subject verbatim and puts one UI word after it', () => {
    const html = history([row(bouncedSubject)], { artifacts: ctx.artifacts })
    expect(text(html)).toContain('bounced review-02.md — re-dispatching reviewer (missing: Boundary check)')
    const link = html.match(/<a [^>]*data-ledger-link[^>]*>([^<]*)<\/a>/)!
    expect(link[1]).toBe('open the review report')
    expect(link[0]).toContain(`href="/runs/fixture/toy?tab=record&amp;artifact=review-02.md"`)
  })

  it('opens the card while the run still has the escalation, the report once it does not', () => {
    expect(ledgerLink(escalatedFacts.target!, { ...ctx, items: [escalationItem(0)] })).toEqual({ label: 'open the card', to: '/runs/fixture/toy?decide=esc-0' })
    expect(ledgerLink(escalatedFacts.target!, ctx)).toEqual({ label: 'open the review report', to: '/runs/fixture/toy?tab=record&artifact=review-02.md' })
    const live = history([row(escalatedSubject, escalatedFacts)], { items: [escalationItem(0)], artifacts: ctx.artifacts })
    const link = live.match(/<a [^>]*data-ledger-link[^>]*>([^<]*)<\/a>/)!
    expect(link[1]).toBe('open the card')
    expect(link[0]).toContain('href="/runs/fixture/toy?decide=esc-0"')
  })

  it('falls back to the run state for an engine-originated escalation', () => {
    expect(ledgerLink({ decide: 'esc-3', artifact: state }, ctx)).toEqual({ label: 'open the run state', to: '/runs/fixture/toy?tab=record&artifact=state.yaml' })
  })

  it('offers no link when neither the card nor the artifact exists — never a dead one', () => {
    expect(ledgerLink({ decide: 'esc-1', artifact: review }, { ...ctx, artifacts: [] })).toBeNull()
    expect(history([row(bouncedSubject)])).not.toContain('data-ledger-link')
  })

  it('never links a human row', () => {
    const html = history([row('state(toy): G1 approved by operator', { target: { decide: 'G1', artifact: review } })], { artifacts: ctx.artifacts })
    expect(html).not.toContain('data-ledger-link')
  })
})
