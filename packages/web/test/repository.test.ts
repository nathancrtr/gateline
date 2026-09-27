// A run's repository, named (#497; docs/MULTI-REPO.md §6.2, §9.2).
//
// What is pinned: with several repositories an inbox row reads `billing /
// add-export`, and the two registers — the Portfolio and the Metrics budget
// table — give the repository a column of its own, left of the run; with one
// repository every row shows the slug alone and the registers have no such
// column. The run page's header names the repository whatever the set, and
// links to the Portfolio; the full id is the tooltip; the browser tab names
// the run and its repository.
//
// The rows are rendered from what the server actually sends, over the demo
// fixture, and the pages from a query cache seeded with those responses —
// including `/api/health`, which is where the pages learn the set's size.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HealthResponse, InboxResponse, MetricsResponse, RunDetailResponse, RunsResponse } from '../src/api.ts'
import { runPageTitle, useNamesRepository } from '../src/components/repository.tsx'
import { InboxPage, InboxRow } from '../src/pages/inbox.tsx'
import { MetricsPage } from '../src/pages/metrics.tsx'
import { PortfolioPage } from '../src/pages/portfolio.tsx'
import { RunHeader, repositoryPortfolioHref } from '../src/pages/run/header.tsx'

const BILLING = 'github.com/acme/billing'
const WEBSITE = 'github.com/acme/website'

/** What one deployment's server says, route by route. */
interface Served {
  health: HealthResponse
  inbox: InboxResponse
  runs: RunsResponse
  metrics: MetricsResponse
  detail: RunDetailResponse
}

let fixture: FixtureRepo
/** Two repositories: billing (display name from the id) and website (a configured name). */
let several: Served
/** The same billing repository alone. */
let one: Served

async function serve(sources: LocalGitSource[]): Promise<Served> {
  const app = createApp({ sources })
  const get = async <T>(path: string): Promise<T> => {
    const res = await app.request(path)
    expect(res.status, path).toBe(200)
    return (await res.json()) as T
  }
  return {
    health: await get('/api/health'),
    inbox: await get('/api/inbox'),
    runs: await get('/api/runs'),
    metrics: await get('/api/metrics'),
    detail: await get(`/api/repos/${BILLING}/-/runs/g1-pending`),
  }
}

beforeAll(async () => {
  fixture = generateFixtureRepo()
  // Two sources over one fixture stand in for two repositories: the server
  // reads each by its own id, so every run appears once per repository.
  const billing = new LocalGitSource(BILLING, fixture.dir)
  const website = new LocalGitSource(WEBSITE, fixture.dir, { displayName: 'marketing-site' })
  several = await serve([billing, website])
  one = await serve([billing])
}, 120_000)
afterAll(() => rm(fixture.root, { recursive: true, force: true }))

/** Render with a query cache already holding the server's responses. */
function renderWith(served: Served, node: ReactNode, route = '/'): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  client.setQueryData(['health'], served.health)
  client.setQueryData(['inbox'], served.inbox)
  client.setQueryData(['runs'], served.runs)
  client.setQueryData(['metrics'], served.metrics)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [route] }, node)),
  )
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')

/** Every run name on the page, as a reader sees it and with its tooltip. */
function runNames(html: string): { text: string; title: string }[] {
  return [...html.matchAll(/<span([^>]*data-run-name[^>]*)>((?:<span[^>]*>[^<]*<\/span>)*[^<]*)<\/span>/g)].map((m) => ({
    text: decode(m[2]!.replace(/<[^>]+>/g, '')),
    title: decode(/ title="([^"]*)"/.exec(m[1]!)?.[1] ?? ''),
  }))
}

/** A register's header cells and body rows, each cell as its markup. */
function register(html: string): { heads: string[]; rows: string[][] } {
  const table = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html)![1]!
  const thead = /<thead>([\s\S]*?)<\/thead>/.exec(table)![1]!
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(table)![1]!
  const heads = [...thead.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => decode(m[1]!.replace(/<[^>]+>/g, '')))
  const rows = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1]!.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => `<td${c[1]}>${c[2]}`),
  )
  return { heads, rows }
}
const textOf = (markup: string) => decode(markup.replace(/<[^>]+>/g, ''))

describe('the set’s size, read from /api/health', () => {
  function Probe() {
    return createElement('output', null, JSON.stringify(useNamesRepository()))
  }
  const probe = (health: HealthResponse | undefined) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    if (health) client.setQueryData(['health'], health)
    return JSON.parse(decode(/<output>(.*)<\/output>/.exec(renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe))))![1]!))
  }

  it('names the repository when the set has several, and not when it has one', () => {
    expect(several.health.sources).toEqual([BILLING, WEBSITE])
    expect(probe(several.health)).toEqual({ ready: true, show: true })
    expect(probe(one.health)).toEqual({ ready: true, show: false })
  })

  it('is not ready until the list arrives, so rows never change after they paint', () => {
    expect(probe(undefined)).toEqual({ ready: false, show: true })
  })
})

describe('inbox rows', () => {
  const item = (served: Served, source: string, slug: string) => {
    const found = served.inbox.items.find((i) => i.source === source && i.slug === slug)
    expect(found, `${source} ${slug}`).toBeDefined()
    return found!
  }
  const row = (served: Served, source: string, slug: string, showRepository: boolean) =>
    runNames(renderWith(served, createElement('ul', null, createElement(InboxRow, { item: item(served, source, slug), now: served.inbox.now, selected: false, showRepository }))))

  it('reads `billing / g1-pending` with several repositories, the configured name for the other', () => {
    expect(row(several, BILLING, 'g1-pending', true)).toEqual([{ text: 'billing / g1-pending', title: `${BILLING}/g1-pending` }])
    expect(row(several, WEBSITE, 'g1-pending', true)).toEqual([
      { text: 'marketing-site / g1-pending', title: `${WEBSITE}/g1-pending` },
    ])
  })

  it('reads the slug alone with one, the full name still on hover', () => {
    expect(row(one, BILLING, 'g1-pending', false)).toEqual([{ text: 'g1-pending', title: `${BILLING}/g1-pending` }])
  })

  it('the page decides from the set: every row named with several, none with one', () => {
    const many = runNames(renderWith(several, createElement(InboxPage)))
    expect(many.length).toBe(several.inbox.items.length)
    expect(many.length).toBeGreaterThan(20)
    for (const n of many) expect(n.text).toMatch(/^(billing|marketing-site) \/ [a-z0-9-]+$/)

    const single = runNames(renderWith(one, createElement(InboxPage)))
    expect(single.length).toBe(one.inbox.items.length)
    for (const n of single) expect(n.text).toMatch(/^[a-z0-9-]+$/)
    expect(single.map((n) => n.title)).toContain(`${BILLING}/g1-pending`)
  })

  it('never prints the id as text where it names the repository', () => {
    const html = renderWith(several, createElement(InboxPage))
    const visible = html.replace(/<[^>]+>/g, ' ')
    expect(visible).not.toContain(BILLING)
    expect(visible).not.toContain(WEBSITE)
  })
})

describe('the Portfolio, a register', () => {
  const portfolio = (served: Served) => register(renderWith(served, createElement(PortfolioPage), '/portfolio'))
  /** The row for one run, found by the href its link carries. */
  const rowOf = (rows: string[][], source: string, slug: string) => {
    const row = rows.find((cells) => cells.some((c) => c.includes(`href="/repos/${source}/-/runs/${slug}"`)))
    expect(row, `${source} ${slug}`).toBeDefined()
    return row!
  }

  it('gives the repository its own column, left of the run, with several repositories', () => {
    const { heads, rows } = portfolio(several)
    expect(heads).toEqual(['Needs you', 'repository', 'run', 'phase', 'gates', 'tasks', 'rounds', 'budget', 'updated'])
    expect(rows.length).toBe(several.runs.runs.length)
    for (const [source, name] of [
      [BILLING, 'billing'],
      [WEBSITE, 'marketing-site'],
    ] as const) {
      const row = rowOf(rows, source, 'g1-pending')
      expect(textOf(row[1]!)).toBe(name)
      expect(row[1]).toContain(`title="${source}"`)
    }
  })

  it('keeps the run cell to the slug, with the repository in the link’s accessible name', () => {
    const { rows } = portfolio(several)
    const run = rowOf(rows, BILLING, 'g1-pending')[2]!
    const link = /<a([^>]*)>([^<]*)<\/a>/.exec(run)!
    expect(link[2]).toBe('g1-pending')
    expect(decode(link[1]!)).toContain('aria-label="billing, g1-pending"')
    expect(decode(link[1]!)).toContain(`title="${BILLING}/g1-pending"`)
    // No row prints the repository inline before its slug any more.
    for (const cells of rows) expect(textOf(cells[2]!)).not.toMatch(/ \/ /)
  })

  it('folds the name under the slug below 1280px, out of the reading order, above the profile', () => {
    const { rows } = portfolio(several)
    const run = rowOf(rows, WEBSITE, 'g1-pending')
    expect(run[1]).toMatch(/^<td class="[^"]*max-xl:hidden/)
    expect(run[2]).toMatch(
      /<div class="xl:hidden" aria-hidden="true" data-repository-fold="true"><span[^>]*>marketing-site<\/span><\/div><div class="mt-\[2px\] font-ui text-\[11\.5px\] text-muted">full<\/div>/,
    )
  })

  it('is the table it always was with one repository: no column, no name, no label', () => {
    const { heads, rows } = portfolio(one)
    expect(heads).toEqual(['Needs you', 'run', 'phase', 'gates', 'tasks', 'rounds', 'budget', 'updated'])
    const html = renderWith(one, createElement(PortfolioPage), '/portfolio')
    expect(html).not.toContain('data-repository-name')
    expect(html).not.toContain('aria-label="billing')
    expect(textOf(rowOf(rows, BILLING, 'g1-pending')[1]!)).toMatch(/^g1-pending/)
  })
})

describe('the Metrics budget table, a register too', () => {
  const budget = (served: Served) => {
    const html = renderWith(served, createElement(MetricsPage), '/metrics')
    // The budget table is the page's last table.
    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0])
    return register(tables.at(-1)!)
  }

  it('gives the repository its own column with several repositories', () => {
    const { heads, rows } = budget(several)
    expect(heads).toEqual(['repository', 'run', 'limit', 'recorded spend', 'metering'])
    expect(rows.length).toBe(several.metrics.runs.length)
    const names = rows.map((cells) => [textOf(cells[0]!), /^<td[^>]*>([^<]*)/.exec(cells[1]!)![1]])
    expect(names).toContainEqual(['billing', 'g1-pending'])
    expect(names).toContainEqual(['marketing-site', 'g1-pending'])
  })

  it('shows the slug alone, and no column, with one', () => {
    const { heads, rows } = budget(one)
    expect(heads).toEqual(['run', 'limit', 'recorded spend', 'metering'])
    expect(rows.map((cells) => textOf(cells[0]!))).toContain('g1-pending')
  })
})

describe('the run header', () => {
  const header = (served: Served) => renderWith(served, createElement(RunHeader, { summary: served.detail.summary, detail: served.detail }), `/repos/${BILLING}/-/runs/g1-pending`)
  const repositoryLine = (html: string) => /<p[^>]*data-run-repository[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? null

  it('names the repository above the run, linking to the Portfolio with the repository as its scope', () => {
    const line = repositoryLine(header(several))
    expect(line).not.toBeNull()
    expect(decode(line!.replace(/<[^>]+>/g, ''))).toBe('billing')
    expect(line).toContain(`href="/portfolio?repo=github.com%2Facme%2Fbilling"`)
    expect(line).toContain(`title="${BILLING}"`)
    // Above the name: the line comes before the heading in the header.
    const html = header(several)
    expect(html.indexOf('data-run-repository')).toBeLessThan(html.indexOf('<h1'))
  })

  it('names it with one repository too, which is the case the run page used to leave out', () => {
    expect(decode(repositoryLine(header(one))!.replace(/<[^>]+>/g, ''))).toBe('billing')
  })

  it('builds the Portfolio link from the id', () => {
    expect(repositoryPortfolioHref('local/demo')).toBe('/portfolio?repo=local%2Fdemo')
  })
})

describe('the browser tab', () => {
  it('names the run, then its repository', () => {
    expect(runPageTitle('add-export', 'billing')).toBe('add-export · billing — Gatehouse')
  })
})
