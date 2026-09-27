// The scope control, the badge, grouping and the scoped pages (#498;
// docs/MULTI-REPO.md §9.1, §9.2).
//
// What is pinned: with one repository nothing of the scope is drawn and every
// page reads as it did; with two, the rail lists the set with each
// repository's count of waiting decisions, the Inbox badge counts the whole
// set and reads `3 of 17` under a scope, the scoped page states the
// repository once in its heading and leaves it off the rows, an unknown
// `repo` shows everything and says so once, grouping heads each repository
// with its name, id and counts, the Metrics gate table says it covers every
// repository, and the rail's links carry the scope. The scope is read from
// the URL alone.
//
// The responses are what the server actually sends over the two demo
// fixtures — `demo`, every state, and `demo-small`, four runs — so the counts
// below are the demo's: 14 decisions wait in demo and 3 in demo-small.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type DemoSet, generateDemoSet } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { HealthResponse, InboxResponse, MetricsResponse, RunsResponse } from '../src/api.ts'
import { App } from '../src/app.tsx'
import { InboxPage } from '../src/pages/inbox.tsx'
import { MetricsPage } from '../src/pages/metrics.tsx'
import { PortfolioPage } from '../src/pages/portfolio.tsx'

const DEMO = 'local/demo'
const SMALL = 'local/demo-small'

interface Served {
  health: HealthResponse
  inbox: InboxResponse
  runs: RunsResponse
  metrics: MetricsResponse
}

let demo: DemoSet
let two: Served
let one: Served

async function serve(sources: LocalGitSource[]): Promise<Served> {
  const app = createApp({ sources })
  const get = async <T>(path: string): Promise<T> => {
    const res = await app.request(path)
    expect(res.status, path).toBe(200)
    return (await res.json()) as T
  }
  return { health: await get('/api/health'), inbox: await get('/api/inbox'), runs: await get('/api/runs'), metrics: await get('/api/metrics') }
}

beforeAll(async () => {
  demo = generateDemoSet()
  const [full, small] = demo.repos
  two = await serve([new LocalGitSource(DEMO, full!.dir), new LocalGitSource(SMALL, small!.dir)])
  one = await serve([new LocalGitSource(DEMO, full!.dir)])
}, 120_000)
afterAll(() => rm(demo.root, { recursive: true, force: true }))

function renderWith(served: Served, node: ReactNode, route: string): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  client.setQueryData(['health'], served.health)
  client.setQueryData(['inbox'], served.inbox)
  client.setQueryData(['runs'], served.runs)
  client.setQueryData(['metrics'], served.metrics)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [route] }, node)))
}

/** The whole shell: the rail around the page at `route`. */
function renderApp(served: Served, route: string): string {
  const page = route.startsWith('/portfolio') ? PortfolioPage : route.startsWith('/metrics') ? MetricsPage : InboxPage
  const at = route.split('?')[0]!
  return renderWith(
    served,
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/', element: createElement(App) }, createElement(Route, at === '/' ? { index: true, element: createElement(page) } : { path: at.slice(1), element: createElement(page) })),
    ),
    route,
  )
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, ''))
/** The rail itself, without the mobile bar's copy of it. */
const rail = (html: string) => /<aside[\s\S]*?<\/aside>/.exec(html)?.[0] ?? ''

/** The scope control's entries, as [name, count, href, current?]. */
function entries(html: string): [string, string, string, boolean][] {
  const control = /<nav aria-label="Repository scope"[\s\S]*?<\/nav>/.exec(rail(html))?.[0]
  if (!control) return []
  return [...control.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => [
    text(/data-scope-name="true">([^<]*)</.exec(m[2]!)?.[1] ?? /data-scope-name[^>]*>([^<]*)</.exec(m[2]!)![1]!),
    /data-scope-count="(\d+)"/.exec(m[2]!)![1]!,
    decode(/href="([^"]*)"/.exec(m[1]!)![1]!),
    /aria-current="page"/.test(m[1]!),
  ])
}

/** The rail's three page links, as [label, href]. */
function navLinks(html: string): [string, string][] {
  const navs = [...rail(html).matchAll(/<nav(?: class="[^"]*")?>([\s\S]*?)<\/nav>/g)]
  const main = navs.at(-1)![1]!
  return [...main.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [text(/<span>([^<]*)<\/span>/.exec(m[2]!)![1]!), decode(m[1]!)])
}

/** The Inbox badge in the rail: what is shown, and what a screen reader hears. */
function badge(html: string): { shown: string; heard: string } | null {
  const m = /<span[^>]*data-inbox-badge[^>]*>([\s\S]*?)<\/span><\/a>/.exec(rail(html))
  if (!m) return null
  const inner = m[1]!
  const hidden = /<span aria-hidden="true">([^<]*)<\/span>/.exec(inner)
  const sr = /<span class="sr-only">([\s\S]*?)<\/span>/.exec(inner)
  return hidden ? { shown: hidden[1]!, heard: text(sr![1]!) } : { shown: text(inner), heard: text(inner) }
}

/** Every run name on the page as a reader sees it (the visible part). */
function runNames(html: string): string[] {
  return [...html.matchAll(/<span[^>]*data-run-name[^>]*>([\s\S]*?)<\/span>(?=<\/span>|<p|$)/g)].map((m) =>
    text(m[1]!.replace(/<span class="sr-only">[^<]*<\/span>/g, '')),
  )
}

describe('with one repository, nothing of the scope is drawn', () => {
  it('has no scope control, no grouping toggle, and the badge as a single number', () => {
    const html = renderApp(one, '/')
    expect(html).not.toContain('data-scope-control')
    expect(html).not.toContain('data-group-toggle')
    expect(badge(html)).toEqual({ shown: '14', heard: '14' })
    expect(navLinks(html)).toEqual([
      ['Inbox', '/'],
      ['Portfolio', '/portfolio'],
      ['Metrics', '/metrics'],
    ])
  })

  it('renders every page exactly as it does without a repo parameter, even one naming the repository', () => {
    for (const path of ['/', '/portfolio', '/metrics']) {
      const bare = renderApp(one, path)
      expect(renderApp(one, `${path}?repo=${encodeURIComponent(DEMO)}`), path).toBe(bare)
      expect(renderApp(one, `${path}?group=repository`), path).toBe(bare)
      expect(bare).not.toContain('data-scope-heading')
    }
  })
})

describe('the scope control, with two repositories', () => {
  it('lists all repositories, then each by display name, with its count of waiting decisions', () => {
    expect(entries(renderApp(two, '/'))).toEqual([
      ['All repositories', '17', '/', true],
      ['demo', '14', '/?repo=local%2Fdemo', false],
      ['demo-small', '3', '/?repo=local%2Fdemo-small', false],
    ])
  })

  it('marks the scope in force as the current page, and keeps the page and its grouping in each link', () => {
    expect(entries(renderApp(two, '/portfolio?group=repository&repo=local%2Fdemo-small'))).toEqual([
      ['All repositories', '17', '/portfolio?group=repository', false],
      ['demo', '14', '/portfolio?group=repository&repo=local%2Fdemo', false],
      ['demo-small', '3', '/portfolio?group=repository&repo=local%2Fdemo-small', true],
    ])
  })

  it('counts a repository with nothing waiting as 0', async () => {
    // demo-small with its three decisions taken off the inbox.
    const quiet: Served = { ...two, inbox: { ...two.inbox, items: two.inbox.items.filter((i) => i.source === DEMO) } }
    expect(entries(renderApp(quiet, '/'))).toEqual([
      ['All repositories', '14', '/', true],
      ['demo', '14', '/?repo=local%2Fdemo', false],
      ['demo-small', '0', '/?repo=local%2Fdemo-small', false],
    ])
  })
})

describe('the Inbox badge', () => {
  it('counts the whole set with no scope', () => {
    expect(badge(renderApp(two, '/'))).toEqual({ shown: '17', heard: '17' })
  })

  it('reads as two numbers under a scope, the scope’s first, on every scoped page', () => {
    for (const path of ['/', '/portfolio', '/metrics'])
      expect(badge(renderApp(two, `${path}?repo=local%2Fdemo-small`)), path).toEqual({
        shown: '3 of 17',
        heard: '3 waiting in demo-small, 17 in all repositories',
      })
    expect(badge(renderApp(two, '/?repo=local%2Fdemo'))!.shown).toBe('14 of 17')
  })
})

describe('the rail’s links carry the scope', () => {
  it('to Inbox, Portfolio and Metrics', () => {
    expect(navLinks(renderApp(two, '/metrics?repo=local%2Fdemo-small'))).toEqual([
      ['Inbox', '/?repo=local%2Fdemo-small'],
      ['Portfolio', '/portfolio?repo=local%2Fdemo-small'],
      ['Metrics', '/metrics?repo=local%2Fdemo-small'],
    ])
    expect(navLinks(renderApp(two, '/'))).toEqual([
      ['Inbox', '/'],
      ['Portfolio', '/portfolio'],
      ['Metrics', '/metrics'],
    ])
  })
})

describe('a page under a one-repository scope', () => {
  it('states the repository once, above the title, and leaves it off the inbox rows', () => {
    const html = renderWith(two, createElement(InboxPage), '/?repo=local%2Fdemo-small')
    const heading = /<p[^>]*data-scope-heading[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!
    expect(text(heading)).toBe('demo-smalllocal/demo-small')
    expect(heading).toContain('data-address')
    expect(html.indexOf('data-scope-heading')).toBeLessThan(html.indexOf('<h1'))
    expect(runNames(html)).toEqual(['retry-policy', 'nightly-report', 'csv-export'])
    expect(html).not.toContain('data-repository-name')
    expect(text(/<p[^>]*data-scope-line[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('14 decisions are waiting in other repositories. Show all repositories')
  })

  it('matches the id without case, and names the repository by its own id', () => {
    const html = renderWith(two, createElement(InboxPage), '/?repo=LOCAL%2FDemo-Small')
    expect(text(/<p[^>]*data-scope-heading[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('demo-smalllocal/demo-small')
    expect(runNames(html).length).toBe(3)
  })

  it('draws no repository column on the Portfolio, and keeps its rows to the scope', () => {
    const html = renderWith(two, createElement(PortfolioPage), '/portfolio?repo=local%2Fdemo-small')
    expect(html).not.toContain('>repository</th>')
    expect(html).not.toContain('data-repository-name')
    expect([...html.matchAll(/<a[^>]*href="\/repos\/([^"]*)"/g)].map((m) => m[1])).toEqual([
      'local/demo-small/-/runs/csv-export',
      'local/demo-small/-/runs/nightly-report',
      'local/demo-small/-/runs/retry-policy',
      'local/demo-small/-/runs/docs-refresh',
    ])
    expect(html).not.toContain('data-group-toggle')
  })

  it('labels the Metrics gate table as covering every repository, and filters the budget table', () => {
    const scoped = renderWith(two, createElement(MetricsPage), '/metrics?repo=local%2Fdemo-small')
    expect(text(/<p[^>]*data-gate-scope[^>]*>([\s\S]*?)<\/p>/.exec(scoped)![1]!)).toBe(
      'Counted across all repositories. Gate figures are not yet split by repository, so this table does not follow the scope.',
    )
    const budget = /Budget honesty[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(scoped)![1]!
    expect([...budget.matchAll(/title="([^"]*)"/g)].map((m) => m[1])).toEqual([
      'local/demo-small/csv-export',
      'local/demo-small/docs-refresh',
      'local/demo-small/nightly-report',
      'local/demo-small/retry-policy',
    ])
    expect(scoped).not.toContain('>repository</th>')
    const joined = renderWith(two, createElement(MetricsPage), '/metrics')
    expect(joined).not.toContain('data-gate-scope')
    expect(joined).toContain('>repository</th>')
  })
})

describe('an unknown repository', () => {
  it('shows every repository and says once that the one named is not served here', () => {
    const html = renderWith(two, createElement(InboxPage), '/?repo=github.com%2Facme%2Fnope')
    const notices = [...html.matchAll(/<p[^>]*data-scope-unknown[^>]*>([\s\S]*?)<\/p>/g)]
    expect(notices.map((m) => text(m[1]!))).toEqual(['No repository github.com/acme/nope is served here, so every repository is shown.'])
    expect(runNames(html).length).toBe(17)
    expect(html).not.toContain('data-scope-heading')
    for (const Page of [PortfolioPage, MetricsPage])
      expect(renderWith(two, createElement(Page), '/portfolio?repo=nope').match(/data-scope-unknown/g)?.length).toBe(1)
  })
})

describe('grouping', () => {
  /** Each group heading's name, id and counts, in order. */
  const headings = (html: string) =>
    [...html.matchAll(/data-group-heading="([^"]*)"[^>]*>([\s\S]*?)<\/span><\/span>/g)].map((m) => ({
      id: m[1],
      name: text(/data-group-name[^>]*>([^<]*)</.exec(m[2]!)![1]!),
      address: text(/data-address[^>]*>([^<]*)</.exec(m[2]!)![1]!),
      counts: text(/data-group-counts[^>]*>([\s\S]*)$/.exec(m[2]!)![1]!),
    }))

  it('heads each inbox group with the display name, the full id and its count, and drops the name from the rows', () => {
    const html = renderWith(two, createElement(InboxPage), '/?group=repository')
    expect(headings(html)).toEqual([
      { id: DEMO, name: 'demo', address: DEMO, counts: '14 entries' },
      { id: SMALL, name: 'demo-small', address: SMALL, counts: '3 entries' },
    ])
    const names = runNames(html)
    expect(names.length).toBe(17)
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/)
    // A screen reader still hears which repository each row is in.
    expect(html).toContain('<span class="sr-only">demo-small / </span>retry-policy')
    expect(html).toContain('aria-pressed="true"')
  })

  it('keeps each group oldest first', () => {
    const html = renderWith(two, createElement(InboxPage), '/?group=repository')
    const small = html.slice(html.indexOf(`data-inbox-group="${SMALL}"`))
    expect(runNames(small)).toEqual(['retry-policy', 'nightly-report', 'csv-export'])
  })

  it('heads each portfolio group with its runs and how many need you, in one table', () => {
    const html = renderWith(two, createElement(PortfolioPage), '/portfolio?group=repository')
    expect(headings(html)).toEqual([
      { id: DEMO, name: 'demo', address: DEMO, counts: '16 runs, 14 need you' },
      { id: SMALL, name: 'demo-small', address: SMALL, counts: '4 runs, 3 need you' },
    ])
    expect(html.match(/<table/g)?.length).toBe(1)
    expect(html).not.toContain('>repository</th>')
    // The link still says which repository, where the heading is out of earshot.
    expect(decode(html)).toContain('aria-label="demo-small, csv-export"')
  })

  it('is offered unpressed on a joined page, and not offered under a scope', () => {
    expect(renderWith(two, createElement(InboxPage), '/')).toContain('aria-pressed="false"')
    const scoped = renderWith(two, createElement(InboxPage), '/?group=repository&repo=local%2Fdemo')
    expect(scoped).not.toContain('data-group-toggle')
    expect(scoped).not.toContain('data-group-heading')
  })
})

describe('the scope lives in the URL alone (decision P9)', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('shows every repository on a visit with no repo parameter, whatever the browser has stored', () => {
    // Storage that answers every key with a scope, as a remembered one would.
    const remembered = { getItem: () => SMALL, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 1 }
    Object.defineProperty(globalThis, 'localStorage', { value: remembered, configurable: true, writable: true })
    Object.defineProperty(globalThis, 'sessionStorage', { value: remembered, configurable: true, writable: true })
    const html = renderApp(two, '/')
    expect(badge(html)).toEqual({ shown: '17', heard: '17' })
    expect(html).not.toContain('data-scope-heading')
    expect(entries(html)[0]).toEqual(['All repositories', '17', '/', true])
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage
  })
})
