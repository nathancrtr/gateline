// A run's repository, named (#497; docs/MULTI-REPO.md §6.2, §9.2).
//
// What is pinned: every row that names a run — inbox, portfolio, the metrics
// budget table — reads `billing / add-export` when the set has several
// repositories and the slug alone when it has one; the run page's header
// names the repository whatever the set, and links to the Portfolio; the full
// id is the tooltip and what a copy carries; the browser tab names the run
// and its repository.
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
import { fullRunName, runPageTitle, substituteFullNames, useNamesRepository } from '../src/components/repository.tsx'
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
function runNames(html: string): { text: string; title: string; full: string }[] {
  return [...html.matchAll(/<span([^>]*data-run-name[^>]*)>((?:<span[^>]*>[^<]*<\/span>)*[^<]*)<\/span>/g)].map((m) => ({
    text: decode(m[2]!.replace(/<[^>]+>/g, '')),
    title: decode(/ title="([^"]*)"/.exec(m[1]!)?.[1] ?? ''),
    full: decode(/ data-full-name="([^"]*)"/.exec(m[1]!)?.[1] ?? ''),
  }))
}

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
    expect(row(several, BILLING, 'g1-pending', true)).toEqual([{ text: 'billing / g1-pending', title: `${BILLING}/g1-pending`, full: `${BILLING}/g1-pending` }])
    expect(row(several, WEBSITE, 'g1-pending', true)).toEqual([
      { text: 'marketing-site / g1-pending', title: `${WEBSITE}/g1-pending`, full: `${WEBSITE}/g1-pending` },
    ])
  })

  it('reads the slug alone with one, the full name still on hover', () => {
    expect(row(one, BILLING, 'g1-pending', false)).toEqual([{ text: 'g1-pending', title: `${BILLING}/g1-pending`, full: `${BILLING}/g1-pending` }])
  })

  it('the page decides from the set: every row named with several, none with one', () => {
    const many = runNames(renderWith(several, createElement(InboxPage)))
    expect(many.length).toBe(several.inbox.items.length)
    expect(many.length).toBeGreaterThan(20)
    for (const n of many) expect(n.text).toMatch(/^(billing|marketing-site) \/ [a-z0-9-]+$/)

    const single = runNames(renderWith(one, createElement(InboxPage)))
    expect(single.length).toBe(one.inbox.items.length)
    for (const n of single) expect(n.text).toMatch(/^[a-z0-9-]+$/)
    expect(single.map((n) => n.full)).toContain(`${BILLING}/g1-pending`)
  })

  it('never prints the id as text where it names the repository', () => {
    const html = renderWith(several, createElement(InboxPage))
    const visible = html.replace(/<[^>]+>/g, ' ')
    expect(visible).not.toContain(BILLING)
    expect(visible).not.toContain(WEBSITE)
  })
})

describe('portfolio rows', () => {
  it('lead with `billing / g1-pending`, and the subline keeps only the profile', () => {
    const html = renderWith(several, createElement(PortfolioPage), '/portfolio')
    const names = runNames(html)
    expect(names.length).toBe(several.runs.runs.length)
    expect(names).toContainEqual({ text: 'billing / g1-pending', title: `${BILLING}/g1-pending`, full: `${BILLING}/g1-pending` })
    expect(names).toContainEqual({ text: 'marketing-site / g1-pending', title: `${WEBSITE}/g1-pending`, full: `${WEBSITE}/g1-pending` })
    // The id used to sit in the subline beside the profile; neither the id
    // nor the display name is there now.
    expect(html.replace(/<[^>]+>/g, ' ')).not.toContain(BILLING)
    expect(html).not.toMatch(/(billing|marketing-site) · (full|standard|patch)/)
  })

  it('the name is inside the run link, so the link says which repository', () => {
    const html = renderWith(several, createElement(PortfolioPage), '/portfolio')
    expect(html).toMatch(/<a[^>]*href="\/repos\/github\.com\/acme\/billing\/-\/runs\/g1-pending"[^>]*><span[^>]*data-run-name/)
  })

  it('read the slug alone with one repository', () => {
    const names = runNames(renderWith(one, createElement(PortfolioPage), '/portfolio'))
    expect(names.length).toBe(one.runs.runs.length)
    expect(names).toContainEqual({ text: 'g1-pending', title: `${BILLING}/g1-pending`, full: `${BILLING}/g1-pending` })
    for (const n of names) expect(n.text).not.toContain(' / ')
  })
})

describe('the metrics budget table', () => {
  it('follows the rows: named with several repositories, the slug alone with one', () => {
    const many = runNames(renderWith(several, createElement(MetricsPage), '/metrics'))
    expect(many.length).toBe(several.metrics.runs.length)
    expect(many.map((n) => n.text)).toContain('billing / g1-pending')
    expect(many.map((n) => n.text)).toContain('marketing-site / g1-pending')

    const single = runNames(renderWith(one, createElement(MetricsPage), '/metrics'))
    expect(single.length).toBe(one.metrics.runs.length)
    expect(single.map((n) => n.text)).toContain('g1-pending')
    for (const n of single) expect(n.text).not.toContain(' / ')
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
    expect(line).toContain(`data-full-name="${BILLING}"`)
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

describe('the copy rule', () => {
  it('a name the selection wholly holds is copied as its full name', () => {
    expect(substituteFullNames('billing / add-export', [{ shown: 'billing / add-export', full: fullRunName(BILLING, 'add-export') }])).toBe(
      'github.com/acme/billing/add-export',
    )
    expect(substituteFullNames('add-export', [{ shown: 'add-export', full: `${BILLING}/add-export` }])).toBe(`${BILLING}/add-export`)
  })

  it('keeps the rest of the selection, and replaces several names in order', () => {
    const names = [
      { shown: 'billing / a', full: `${BILLING}/a` },
      { shown: 'marketing-site / a', full: `${WEBSITE}/a` },
    ]
    expect(substituteFullNames('G1 billing / a 3d\nG2 marketing-site / a 1h', names)).toBe(`G1 ${BILLING}/a 3d\nG2 ${WEBSITE}/a 1h`)
  })

  it('leaves the copy alone when no whole name is in it', () => {
    expect(substituteFullNames('add-exp', [{ shown: 'add-export', full: `${BILLING}/add-export` }])).toBeNull()
  })
})
