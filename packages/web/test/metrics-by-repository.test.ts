// The Metrics gate table over several repositories (#499; docs/MULTI-REPO.md
// §9.4, decision P11).
//
// What is pinned: under a one-repository scope the table is that
// repository's figures, one row per gate, with no label; with no scope over
// several repositories each gate is a group, its total and then one row per
// repository in display-name order, with the flag on a repository's row and
// never on the total; a one-repository set reads as it always did, the flag
// on its total; a row with fewer than five decisions shows its counts, no
// rate and no bar.
//
// The responses are written out as literals, the figures core computes for
// two repositories (worked by hand in core/test/metrics-by-repository.test.ts):
// at G0, Billing approved 5 of 5 and infra 7 of 10; at G1, Billing 10 of 10
// and infra 4 of 4. The served order puts infra first, so a table that kept
// the served order instead of the display-name order would fail.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { GateMetrics, HealthResponse, InboxResponse, MetricsResponse, RunsResponse } from '../src/api.ts'
import { MetricsPage } from '../src/pages/metrics.tsx'

const INFRA = 'gitlab.example.com/ops/infra'
const BILLING = 'github.com/acme/billing'

const mix = (confirmation: number, light = 0, heavy = 0) => ({ confirmation, 'light-correction': light, 'heavy-correction': heavy })
const none = (gate: GateMetrics['gate']): GateMetrics => ({
  gate,
  decisions: 0,
  approvals: 0,
  approvalRate: null,
  overTriggering: false,
  burdenMix: mix(0),
  burdenUnrecorded: 0,
  medianLatencySeconds: null,
})

const billingGates: GateMetrics[] = [
  { gate: 'G0', decisions: 5, approvals: 5, approvalRate: 1, overTriggering: true, burdenMix: mix(5), burdenUnrecorded: 0, medianLatencySeconds: 60 },
  { gate: 'G1', decisions: 10, approvals: 10, approvalRate: 1, overTriggering: true, burdenMix: mix(10), burdenUnrecorded: 0, medianLatencySeconds: 60 },
  none('G2'),
  none('G3'),
]
const infraGates: GateMetrics[] = [
  { gate: 'G0', decisions: 10, approvals: 7, approvalRate: 0.7, overTriggering: false, burdenMix: mix(5, 2, 3), burdenUnrecorded: 0, medianLatencySeconds: 3600 },
  { gate: 'G1', decisions: 4, approvals: 4, approvalRate: null, overTriggering: false, burdenMix: mix(3), burdenUnrecorded: 1, medianLatencySeconds: 3600 },
  none('G2'),
  none('G3'),
]
/** The pooled total over both: no flag, though G1's 14 of 14 is above 90%. */
const pooledGates: GateMetrics[] = [
  { gate: 'G0', decisions: 15, approvals: 12, approvalRate: 0.8, overTriggering: false, burdenMix: mix(10, 2, 3), burdenUnrecorded: 0, medianLatencySeconds: 3600 },
  { gate: 'G1', decisions: 14, approvals: 14, approvalRate: 1, overTriggering: false, burdenMix: mix(13), burdenUnrecorded: 1, medianLatencySeconds: 60 },
  none('G2'),
  none('G3'),
]

const decision = (source: string, sourceName: string, slug: string) =>
  ({ source, sourceName, slug, gate: 'G0', approved: true, by: 'Pat Doe', decidedAt: 1, readyAt: null, latencySeconds: null, burden: null, notes: null }) as const

const base = { runs: [], roundCap: 3, unreadable: [], rateMinDecisions: 5 }

/** Both repositories read: the total unflagged, each repository its own figures. */
const twoRead: MetricsResponse = {
  ...base,
  decisions: [decision(INFRA, 'infra', 'rotate-keys'), decision(BILLING, 'Billing', 'refunds')],
  perGate: pooledGates,
  perRepository: [
    { source: INFRA, sourceName: 'infra', perGate: infraGates },
    { source: BILLING, sourceName: 'Billing', perGate: billingGates },
  ],
}

/** A set of one, Billing alone: the total is Billing's figure and core flags it. */
const oneRepository: MetricsResponse = {
  ...base,
  decisions: [decision(BILLING, 'Billing', 'refunds')],
  perGate: billingGates,
  perRepository: [{ source: BILLING, sourceName: 'Billing', perGate: billingGates }],
}

/** A set of two where infra could not be read: the breakdown has Billing alone, and core flags the total. */
const oneOfTwoRead: MetricsResponse = {
  ...oneRepository,
  unreadable: [{ source: INFRA, sourceName: 'infra', error: 'fatal: not a git repository' }],
}

const health = (sources: string[]): HealthResponse => ({ ok: true, apiVersion: 3, sources })
const inbox: InboxResponse = { items: [], now: 0, unreadable: [] }
const runs = (sources: [string, string][]): RunsResponse => ({ runs: sources.map(([source, sourceName]) => ({ source, sourceName, slug: 'x' })), unreadable: [] }) as unknown as RunsResponse

function render(metrics: MetricsResponse, route: string, set: [string, string][] = [[INFRA, 'infra'], [BILLING, 'Billing']]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  client.setQueryData(['health'], health(set.map(([id]) => id)))
  client.setQueryData(['inbox'], inbox)
  client.setQueryData(['runs'], runs(set))
  client.setQueryData(['metrics'], metrics)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [route] }, createElement(MetricsPage))))
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

interface Row {
  gate: string
  total: boolean
  repository: string | null
  text: string
  flagged: boolean
  markup: string
}

/** The gate table's rows, in page order. */
function gateRows(html: string): Row[] {
  return [...html.matchAll(/<tr data-gate-row="(G\d)"([^>]*)>([\s\S]*?)<\/tr>/g)].map((m) => ({
    gate: m[1]!,
    total: /data-gate-total="true"/.test(m[2]!),
    repository: /data-gate-repository="([^"]*)"/.exec(m[2]!)?.[1] ?? null,
    text: text(m[3]!),
    flagged: m[3]!.includes('over-triggering?'),
    markup: m[3]!,
  }))
}

describe('the gate table under a one-repository scope', () => {
  it('shows that repository’s figures, one row per gate, with no label', () => {
    const html = render(twoRead, `/metrics?repo=${encodeURIComponent(INFRA)}`)
    expect(gateRows(html).map((r) => [r.gate, r.total, r.repository, r.text, r.flagged])).toEqual([
      ['G0', false, null, 'G0 10 70% 1h', false],
      ['G1', false, null, 'G1 4 4 of 4 approved too few to rate confirmation: 3 unrecorded: 1 1h', false],
      ['G2', false, null, 'G2 — no decisions — —', false],
      ['G3', false, null, 'G3 — no decisions — —', false],
    ])
    expect(html).not.toContain('data-gate-group')
    expect(html).not.toContain('data-gate-scope')
    expect(html).not.toContain('Counted across all repositories')
    expect(html).not.toContain('data-gate-grouping')
    expect(html).toContain('>gate</th>')
  })

  it('flags the scope’s repository where its own figures are over the line', () => {
    const html = render(twoRead, `/metrics?repo=${encodeURIComponent(BILLING)}`)
    expect(gateRows(html).map((r) => [r.gate, r.text, r.flagged])).toEqual([
      ['G0', 'G0 5 100% over-triggering? 1m', true],
      ['G1', 'G1 10 100% over-triggering? 1m', true],
      ['G2', 'G2 — no decisions — —', false],
      ['G3', 'G3 — no decisions — —', false],
    ])
  })
})

describe('the gate table with no scope over several repositories', () => {
  it('groups each gate: the total, then one row per repository in display-name order', () => {
    const html = render(twoRead, '/metrics')
    expect(gateRows(html).map((r) => [r.gate, r.total, r.repository])).toEqual([
      ['G0', true, null],
      ['G0', false, BILLING],
      ['G0', false, INFRA],
      ['G1', true, null],
      ['G1', false, BILLING],
      ['G1', false, INFRA],
      ['G2', true, null],
      ['G2', false, BILLING],
      ['G2', false, INFRA],
      ['G3', true, null],
      ['G3', false, BILLING],
      ['G3', false, INFRA],
    ])
    expect([...html.matchAll(/<tbody data-gate-group="(G\d)"/g)].map((m) => m[1])).toEqual(['G0', 'G1', 'G2', 'G3'])
    expect(html).toContain('>gate and repository</th>')
    expect(text(/<p[^>]*data-gate-grouping[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe(
      'Each gate shows its total across all repositories, then each repository’s own figures. Over-triggering is judged for each repository, because a total that pools several can hide a gate that over-triggers in one of them.',
    )
    expect(html).not.toContain('Counted across all repositories')
  })

  it('draws the flag on a repository’s row and never on the total', () => {
    const rows = gateRows(render(twoRead, '/metrics'))
    const g0 = rows.filter((r) => r.gate === 'G0')
    expect(g0.map((r) => [r.text, r.flagged])).toEqual([
      ['G0 all repositories 15 80% 1h', false],
      ['G0, Billing 5 100% over-triggering? 1m', true],
      ['G0, infra 10 70% 1h', false],
    ])
    // G1's total is 14 of 14, above the line, and carries no flag: it pools two repositories.
    const g1 = rows.filter((r) => r.gate === 'G1')
    expect(g1.map((r) => [r.text, r.flagged])).toEqual([
      ['G1 all repositories 14 100% 1m', false],
      ['G1, Billing 10 100% over-triggering? 1m', true],
      ['G1, infra 4 4 of 4 approved too few to rate confirmation: 3 unrecorded: 1 1h', false],
    ])
  })

  it('names each repository by its display name, with its id on hover', () => {
    const rows = gateRows(render(twoRead, '/metrics')).filter((r) => r.gate === 'G0' && !r.total)
    expect(rows.map((r) => /<span[^>]*title="([^"]*)"[^>]*data-repository-name[^>]*>([^<]*)</.exec(r.markup)!.slice(1))).toEqual([
      [BILLING, 'Billing'],
      [INFRA, 'infra'],
    ])
  })

  it('keeps the total unflagged when only one repository of the set could be read', () => {
    const rows = gateRows(render(oneOfTwoRead, '/metrics'))
    expect(rows.filter((r) => r.gate === 'G0').map((r) => [r.total, r.repository, r.flagged])).toEqual([
      [true, null, false],
      [false, BILLING, true],
    ])
  })
})

describe('a set of one repository', () => {
  it('reads as it always did: one row per gate, the flag on the total', () => {
    const html = render(oneRepository, '/metrics', [[BILLING, 'Billing']])
    expect(gateRows(html).map((r) => [r.gate, r.total, r.repository, r.text, r.flagged])).toEqual([
      ['G0', false, null, 'G0 5 100% over-triggering? 1m', true],
      ['G1', false, null, 'G1 10 100% over-triggering? 1m', true],
      ['G2', false, null, 'G2 — no decisions — —', false],
      ['G3', false, null, 'G3 — no decisions — —', false],
    ])
    expect(html).toContain('>gate</th>')
    expect(html).not.toContain('data-gate-group')
    expect(html).not.toContain('data-gate-grouping')
    expect(html).not.toContain('data-repository-name')
  })
})

describe('a row with fewer than five decisions', () => {
  it('shows its counts, no rate, no meter and no burden bar', () => {
    const row = gateRows(render(twoRead, '/metrics')).find((r) => r.gate === 'G1' && r.repository === INFRA)!
    expect(row.markup).toContain('data-gate-too-few')
    expect(row.markup).not.toMatch(/\d+%/)
    expect(row.markup).not.toContain('role="img"')
    expect(row.markup).not.toContain('90% over-triggering threshold')
    expect(row.markup).toContain('data-burden-counts')
  })

  it('is explained once, with the sample the rate needs', () => {
    const html = render(twoRead, '/metrics')
    expect([...html.matchAll(/<p[^>]*data-gate-sample[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]!))).toEqual([
      'A rate needs at least 5 decisions. A row with fewer shows its counts only.',
    ])
    // Billing's own page has no such row, and no such sentence.
    expect(render(twoRead, `/metrics?repo=${encodeURIComponent(BILLING)}`)).not.toContain('data-gate-sample')
  })
})

describe('a server that sends no per-repository figures', () => {
  const unsplit: MetricsResponse = { ...twoRead, perRepository: undefined, rateMinDecisions: undefined }

  it('shows the total alone with no scope, and says under a scope that it cannot split them', () => {
    const joined = render(unsplit, '/metrics')
    expect(gateRows(joined).map((r) => [r.gate, r.total, r.repository])).toEqual([
      ['G0', false, null],
      ['G1', false, null],
      ['G2', false, null],
      ['G3', false, null],
    ])
    const scoped = render(unsplit, `/metrics?repo=${encodeURIComponent(INFRA)}`)
    expect(gateRows(scoped)).toEqual([])
    expect(text(/<p[^>]*data-gate-unsplit[^>]*>([\s\S]*?)<\/p>/.exec(scoped)![1]!)).toBe(
      'This server sends gate figures for all repositories together, so none can be shown for one repository until it is updated.',
    )
  })
})
