// #159's web half: three gate-card states out of two flags, and the surfaces
// that used to read `!reviewable` as "bounced" reading them through one place.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { InboxItem } from '../src/api.ts'
import { KindChip } from '../src/components/chips.tsx'
import { BOUNCED_INSTRUCTION, DecidePanel, INFLIGHT_INSTRUCTION } from '../src/components/decide.tsx'
import { gateCardState, isBouncedGate, isInflightGate } from '../src/gate-state.ts'
import { cardInstruction } from '../src/pages/run.tsx'

const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: 'G0',
    escalationIndex: null,
    inflight: null,
    reviewable: true,
    title: 'G0 — Is this what we actually want built?',
    detail: 'a-run is waiting on G0',
    since: 1,
    packet: [],
    problems: [],
    ...(over as object),
  }) as InboxItem

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)))
}

const INFLIGHT = { reviewable: false, inflight: { role: 'analyst', since: 2 } }
const BOUNCED = { reviewable: false, problems: ['spec.md: missing required sections — Assumptions'] }

describe('gateCardState', () => {
  it('reads reviewable, in-flight and bounced apart', () => {
    expect(gateCardState(item({}))).toBe('reviewable')
    expect(gateCardState(item(INFLIGHT))).toBe('inflight')
    expect(gateCardState(item(BOUNCED))).toBe('bounced')
  })

  it('is null for everything that is not a gate', () => {
    for (const kind of ['escalation', 'round-cap', 'paused', 'staged', 'malformed'] as const) {
      expect(gateCardState(item({ kind, gate: null, reviewable: false }))).toBeNull()
    }
  })

  it('gives the two predicates no overlap — the bug was one state doing for both', () => {
    expect([isBouncedGate(item(INFLIGHT)), isInflightGate(item(INFLIGHT))]).toEqual([false, true])
    expect([isBouncedGate(item(BOUNCED)), isInflightGate(item(BOUNCED))]).toEqual([true, false])
  })
})

describe('the in-flight card', () => {
  it('takes its own instruction, not the bounce card’s "fix the artifacts"', () => {
    expect(cardInstruction(item(INFLIGHT))?.text).toBe(INFLIGHT_INSTRUCTION)
    expect(cardInstruction(item(BOUNCED))?.text).toBe(BOUNCED_INSTRUCTION)
    expect(cardInstruction(item({}))).toBeNull()
  })

  it('offers no approve or decline affordance', () => {
    const html = render(createElement(DecidePanel, { item: item(INFLIGHT), profile: 'full' as const }))
    expect(html).not.toContain('data-decide="approve"')
    expect(html).not.toContain('data-decide="decline"')
    // And the reviewable card still does, so the assertion above can fail.
    const ok = render(createElement(DecidePanel, { item: item({}), profile: 'full' as const }))
    expect(ok).toContain('data-decide="approve"')
  })

  it('is not hatched like a malformed packet — nothing here is wrong', () => {
    // A bounced packet's impression is hatched (the texture for "on the
    // table, offering no decision"); an in-flight one is the plain mark.
    const inflight = renderToStaticMarkup(createElement(KindChip, { item: item(INFLIGHT) }))
    const bounced = renderToStaticMarkup(createElement(KindChip, { item: item(BOUNCED) }))
    expect(inflight).not.toContain('imp-hatch')
    expect(bounced).toContain('imp-hatch')
  })
})
