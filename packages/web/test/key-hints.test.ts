// The keyboard loop's advertisement (#284).
//
// The loop itself shipped complete and unmentioned, so what these tests hold
// is not that the keys work — `use-keys.ts` has not changed — but that the
// pixels naming them exist, name the right keys for the card in front of them,
// and are absent in the two places they would lie: on a card the keyboard does
// not drive, and inside a form where `a` and `1` are characters.
//
// Layer 2 of `vitest.config.ts`'s map: `renderToStaticMarkup`, no DOM. What it
// cannot reach is the transition — clicking `Approve…` and watching the hint
// go — which is asserted in the browser instead and recorded in the PR.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InboxItem } from '../src/api.ts'
import { KeyHints } from '../src/components/chips.tsx'
import { DecidePanel, decideHints } from '../src/components/decide.tsx'
import type { KeyHint } from '../src/use-keys.ts'

const item = (over: Partial<InboxItem>): InboxItem => ({
  source: 'local',
  slug: 'a-run',
  kind: 'gate',
  gate: 'G2',
  escalationIndex: null,
  inflight: null,
  reviewable: true,
  title: 'G2 — Does the evidence support merging?',
  detail: 'a-run is waiting on G2',
  since: 1,
  packet: [],
  packetRefs: [],
  problems: [],
  ...(over as object),
}) as InboxItem

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)),
  )
}

const PAGE_HINTS: KeyHint[] = [
  ['e', 'next artifact'],
  ['esc', 'inbox'],
]

const panel = (over: Partial<InboxItem>, primary: boolean) =>
  render(
    createElement(DecidePanel, {
      item: item(over),
      profile: 'full' as const,
      primary,
      pageHints: PAGE_HINTS,
    }),
  )

describe('KeyHints', () => {
  it('renders each key as a kbd beside its verb', () => {
    const html = renderToStaticMarkup(createElement(KeyHints, { hints: [['j', 'down'] as KeyHint] }))
    expect(html).toContain('<kbd')
    expect(html).toContain('j</kbd>')
    expect(html).toContain('down')
    expect(html).toContain('data-key-hints')
  })

  it('renders nothing at all when there is nothing to advertise', () => {
    expect(renderToStaticMarkup(createElement(KeyHints, { hints: [] }))).toBe('')
  })

  it('stays in the quiet mono register rather than competing with the card', () => {
    const html = renderToStaticMarkup(createElement(KeyHints, { hints: [['a', 'approve'] as KeyHint] }))
    expect(html).toContain('font-mono')
    expect(html).toContain('text-muted')
  })
})

describe('decideHints', () => {
  it('offers approve and decline only where the panel offers the buttons', () => {
    expect(decideHints(item({}))).toEqual([
      ['a', 'approve'],
      ['x', 'decline'],
      ['1/2/3', 'burden'],
    ])
  })

  it('says nothing about approving a bounced gate — the panel offers no approval', () => {
    expect(decideHints(item({ reviewable: false }))).toEqual([])
  })

  it('names resolve on an escalation, which is what `a` does there', () => {
    expect(decideHints(item({ kind: 'escalation', gate: null, escalationIndex: 0 }))).toEqual([['a', 'resolve']])
  })

  it('leaves the kinds whose only affordance is a button to the page hints', () => {
    for (const kind of ['paused', 'staged', 'round-cap', 'malformed'] as const) {
      expect(decideHints(item({ kind, gate: null }))).toEqual([])
    }
  })
})

describe('the decision card advertises the loop', () => {
  it('names the whole loop — the card keys, then the page keys — on the primary card', () => {
    const html = panel({}, true)
    expect(html).toContain('data-key-hints')
    for (const key of ['a</kbd>', 'x</kbd>', '1/2/3</kbd>', 'e</kbd>', 'esc</kbd>']) expect(html).toContain(key)
  })

  it('says nothing on a card the keyboard does not drive', () => {
    // `useKeys` is enabled on `primary`; a second card on the page has no keys
    // at all, and a hint there would be an outright lie.
    expect(panel({}, false)).not.toContain('data-key-hints')
  })

  it('carries the page keys but no approve key on a bounced gate', () => {
    const html = panel({ reviewable: false }, true)
    expect(html).toContain('esc</kbd>')
    expect(html).not.toContain('approve')
  })
})
