// #499 on the pages: the collapsed row, the notice for a repository that
// could not be read, liveness by mode in the rail and the banner, the drift
// and deferral marks, the staging picker's names, and a run in a `view`
// repository. The responses are what the server sends over throwaway
// repositories (`e2e/scenarios.ts`): `website` holds the small set's three
// decisions plus some number of unreadable runs, `billing` the three alone.
// Heartbeats, which are about time, are built by hand as the server would
// send them. Every expected value is written out.
import { rm } from 'node:fs/promises'
import { LocalGitSource, loadSources, type RunSource } from '@gateline/core'
import { createApp } from '@gateline/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { floodedRepo, scenarioRoot } from '../../e2e/scenarios.ts'
import type {
  EngineHealthEntry,
  EngineHealthResponse,
  HealthResponse,
  InboxItem,
  InboxResponse,
  RunDetailResponse,
  RunsResponse,
  MetricsResponse,
  StagingConfigResponse,
} from '../src/api.ts'
import { App } from '../src/app.tsx'
import { VIEW_MODE_LINE } from '../src/components/repository.tsx'
import { InboxPage } from '../src/pages/inbox.tsx'
import { NewRunPage } from '../src/pages/new-run.tsx'
import { MetricsPage } from '../src/pages/metrics.tsx'
import { PortfolioPage } from '../src/pages/portfolio.tsx'
import { NeedsYouCard } from '../src/pages/run/decide-card.tsx'

const WEBSITE = 'local/website'
const BILLING = 'local/billing'

interface Served {
  health: HealthResponse
  inbox: InboxResponse
  runs: RunsResponse
  staging: StagingConfigResponse
  metrics: MetricsResponse
  app: ReturnType<typeof createApp>
}

let root: string
let flooded: Served // website: 24 unreadable runs; billing: none
let three: Served // website: 3 unreadable runs
let twoEach: Served // website: 2, billing: 2
let unreadable: Served // flooded, plus a repository that cannot be read
let modes: Served // website decide, billing view

async function serve(sources: RunSource[]): Promise<Served> {
  const app = createApp({ sources })
  const get = async <T>(path: string): Promise<T> => {
    const res = await app.request(path)
    expect(res.status, path).toBe(200)
    return (await res.json()) as T
  }
  return { health: await get('/api/health'), inbox: await get('/api/inbox'), runs: await get('/api/runs'), staging: await get('/api/staging'), metrics: await get('/api/metrics'), app }
}

/** A repository whose runs cannot be listed, the way one gone from disk fails. */
const broken = (id: string, displayName: string, error: string): RunSource =>
  ({
    id,
    displayName,
    templates: { read: async () => null },
    identity: async () => null,
    listRuns: async () => {
      throw new Error(error)
    },
  }) as unknown as RunSource

beforeAll(async () => {
  root = scenarioRoot()
  const w24 = floodedRepo(root, 'website', 24)
  const b0 = floodedRepo(root, 'billing', 0)
  const w3 = floodedRepo(root, 'website3', 3)
  const w2 = floodedRepo(root, 'website2', 2)
  const b2 = floodedRepo(root, 'billing2', 2)
  const site = (dir: string, over = {}) => new LocalGitSource(WEBSITE, dir, { displayName: 'website', ...over })
  const bill = (dir: string, over = {}) => new LocalGitSource(BILLING, dir, { displayName: 'billing', ...over })
  flooded = await serve([site(w24.dir), bill(b0.dir)])
  three = await serve([site(w3.dir), bill(b0.dir)])
  twoEach = await serve([site(w2.dir), bill(b2.dir)])
  unreadable = await serve([site(w24.dir), bill(b0.dir), broken('local/ledger', 'ledger', 'fatal: not a git repository: /srv/ledger/.git')])
  modes = await serve([site(w24.dir, { mode: 'decide' }), bill(b0.dir, { mode: 'view' })])
}, 180_000)
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

function renderWith(served: Served, node: ReactNode, route: string, engines: EngineHealthResponse['engines'] = {}, seed?: (c: QueryClient) => void): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  client.setQueryData(['health'], served.health)
  client.setQueryData(['inbox'], served.inbox)
  client.setQueryData(['runs'], served.runs)
  client.setQueryData(['staging-config'], served.staging)
  client.setQueryData(['metrics'], served.metrics)
  client.setQueryData(['engine-health'], { engines, now: NOW } satisfies EngineHealthResponse)
  seed?.(client)
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, { initialEntries: [route] }, node)))
}

/** The shell (rail, banner, marks) around a page. */
function renderApp(served: Served, route: string, engines: EngineHealthResponse['engines'] = {}): string {
  const at = route.split('?')[0]!
  const page = at === '/portfolio' ? PortfolioPage : InboxPage
  return renderWith(
    served,
    createElement(
      Routes,
      null,
      createElement(Route, { path: '/', element: createElement(App) }, createElement(Route, at === '/' ? { index: true, element: createElement(page) } : { path: at.slice(1), element: createElement(page) })),
    ),
    route,
    engines,
  )
}

const NOW = Math.floor(Date.parse('2026-09-27T12:00:00Z') / 1000)
const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, ''))
const rail = (html: string) => /<aside[\s\S]*?<\/aside>/.exec(html)?.[0] ?? ''

/** Each drawn inbox row, in order: a collapsed row as `[collapsed <repo>]`, an item row as its slug. */
function drawnRows(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<button[^>]*data-inbox-row[^>]*>|<a[^>]*data-inbox-row[^>]*>[\s\S]*?data-run-name[^>]*>([\s\S]*?)<\/span>(?=<\/span>)/g)) {
    if (m[0].startsWith('<button')) out.push(`[collapsed ${/data-inbox-collapsed="([^"]+)"/.exec(html.slice(0, m.index! + 1).split('<li').at(-1)!)?.[1] ?? '?'}]`)
    else out.push(text(m[1]!.replace(/<span class="sr-only">[^<]*<\/span>/g, '')).split(' / ').at(-1)!)
  }
  return out
}

/** The kind filter tabs, as "label count". */
const tabs = (html: string) =>
  [.../<div[^>]*data-inbox-filters[^>]*>([\s\S]*?)<\/div>/.exec(html)![1]!.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => text(m[1]!).replace(/\s+/g, ' ').trim())
    .filter((t) => t !== 'Group by repository')

/** The rail's Inbox badge: shown, heard and title. */
function badge(html: string): { shown: string; heard: string; title: string | null } | null {
  const m = /<span([^>]*data-inbox-badge[^>]*)>([\s\S]*?)<\/span><\/a>/.exec(rail(html))
  if (!m) return null
  const title = /title="([^"]*)"/.exec(m[1]!)?.[1] ?? null
  const hidden = /<span aria-hidden="true">([^<]*)<\/span>/.exec(m[2]!)
  const sr = /<span class="sr-only">([\s\S]*?)<\/span>/.exec(m[2]!)
  return hidden ? { shown: hidden[1]!, heard: text(sr![1]!), title: title && decode(title) } : { shown: text(m[2]!), heard: text(m[2]!), title }
}

/** The scope control's entries: [name, count as drawn]. */
function entries(html: string): [string, string][] {
  const control = /<nav aria-label="Repository scope"[\s\S]*?<\/nav>/.exec(rail(html))?.[0] ?? ''
  return [...control.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((m) => [
    text(/data-scope-name[^>]*>([^<]*)</.exec(m[1]!)![1]!),
    /data-scope-count="([^"]+)"/.exec(m[1]!)![1]!,
  ])
}

describe('one repository’s unreadable runs collapse into one row', () => {
  it('draws the 24 as one row, at the place of the oldest, among rows that never collapse', () => {
    const html = renderWith(flooded, createElement(InboxPage), '/')
    // Oldest first: website's escalation at 5 days, then its oldest broken run
    // at 4.5, then the budget pauses at 3, then the G0 gates at 1.
    expect(drawnRows(html)).toEqual([
      'retry-policy',
      'retry-policy',
      '[collapsed local/website]',
      'nightly-report',
      'nightly-report',
      'csv-export',
      'csv-export',
    ])
    expect((html.match(/data-inbox-collapsed=/g) ?? []).length).toBe(1)
  })

  it('says how many, where, and of how many entries, with the age of the oldest', () => {
    const html = renderWith(flooded, createElement(InboxPage), '/')
    const row = /<li[^>]*data-inbox-collapsed="local\/website"[\s\S]*?<\/button>/.exec(html)![0]
    expect(text(/data-collapsed-title[^>]*>([\s\S]*?)<\/span><span/.exec(row)![1]!)).toBe('24 runs in website have unreadable state')
    expect(text(/data-collapsed-line[^>]*>([\s\S]*?)<\/span><\/span>/.exec(row)![1]!)).toBe('Stands for 24 of the 30 entries. Show them')
    expect(text(/data-inbox-age[^>]*>([\s\S]*?)<\/span><\/span>/.exec(row)![1]!)).toBe('⏱4d')
    expect(row).toContain('aria-expanded="false"')
    expect(row).toContain('malformed')
  })

  it('keeps every count a count of items: the tabs, the footer, the badge and the scope control', () => {
    const html = renderApp(flooded, '/')
    expect(tabs(html)).toEqual(['All 30', 'gate 2', 'escalation 2', 'round-cap 0', 'paused 2', 'staged 0', 'malformed 24'])
    expect(text(/<span class="tabular-nums">(\d+ entr[a-z]+)<\/span>/.exec(html)![1]!)).toBe('30 entries')
    expect(badge(html)).toEqual({ shown: '30', heard: '30', title: null })
    expect(entries(html)).toEqual([
      ['All repositories', '30'],
      ['billing', '3'],
      ['website', '27'],
    ])
  })

  it('does not collapse three, nor two in each of two repositories', () => {
    for (const served of [three, twoEach]) {
      const html = renderWith(served, createElement(InboxPage), '/')
      expect(html).not.toContain('data-inbox-collapsed')
      expect(drawnRows(html).length).toBe(served.inbox.items.length)
    }
    expect(three.inbox.items.length).toBe(9)
    expect(twoEach.inbox.items.length).toBe(10)
  })

  it('opens from the URL, revealing each run as an ordinary row beneath it', () => {
    const html = renderWith(flooded, createElement(InboxPage), '/?expand=local%2Fwebsite')
    const rows = drawnRows(html)
    expect(rows.slice(0, 3)).toEqual(['retry-policy', 'retry-policy', '[collapsed local/website]'])
    expect(rows.slice(3, 27)).toEqual(Array.from({ length: 24 }, (_, i) => `broken-${String(i + 1).padStart(2, '0')}`))
    expect(rows.length).toBe(31)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-controls="collapsed-local-website"')
    expect(html).toContain('<ul id="collapsed-local-website" aria-label="24 runs in website with unreadable state"')
    expect(text(/data-collapsed-end[^>]*>([\s\S]*?)<\/button>/.exec(html)![1]!)).toBe('End of the 24 runs in website. Hide them')
  })

  it('collapses within its group, counted against the group', () => {
    const html = renderWith(flooded, createElement(InboxPage), '/?group=repository')
    const site = html.slice(html.indexOf('data-inbox-group="local/website"'))
    expect(drawnRows(site)).toEqual(['retry-policy', '[collapsed local/website]', 'nightly-report', 'csv-export'])
    expect(text(/data-collapsed-line[^>]*>([\s\S]*?)<\/span><\/span>/.exec(site)![1]!)).toBe('Stands for 24 of the 27 entries. Show them')
    // Under the heading the row leaves the name off, as item rows do; a screen reader still hears it.
    expect(text(/data-collapsed-title[^>]*>([\s\S]*?)<\/span><span/.exec(site)![1]!)).toBe('24 runs in website have unreadable state')
    expect(site).toContain('<span class="sr-only">in website </span>')
  })

  it('collapses under a one-repository scope too', () => {
    const html = renderWith(flooded, createElement(InboxPage), '/?repo=local%2Fwebsite')
    expect(drawnRows(html)).toEqual(['retry-policy', '[collapsed local/website]', 'nightly-report', 'csv-export'])
  })

  it('leaves the Portfolio a register of every run', () => {
    const html = renderWith(flooded, createElement(PortfolioPage), '/portfolio')
    expect(html).not.toContain('data-inbox-collapsed')
    expect((html.match(/href="\/repos\/local\/website\/-\/runs\/broken-/g) ?? []).length).toBe(24)
  })
})

describe('a repository that could not be read', () => {
  it('is named once at the top of Inbox and Portfolio, by name and id, with the machine’s error', () => {
    for (const [page, rows] of [
      ['/', 'decisions'],
      ['/portfolio', 'runs'],
    ] as const) {
      const html = renderApp(unreadable, page)
      const notices = [...html.matchAll(/<div[^>]*data-unreadable-notice[^>]*>([\s\S]*?)<\/div>/g)]
      expect(notices.length, page).toBe(1)
      const notice = notices[0]![1]!
      expect(text(/<p>([\s\S]*?)<\/p>/.exec(notice)![1]!)).toBe(`One repository could not be read, so its ${rows} are not shown here.`)
      expect(text(/data-unreadable-name[^>]*>([^<]*)</.exec(notice)![1]!)).toBe('ledger')
      expect(notice).toContain('data-address="true">local/ledger<')
      expect(text(/<span data-diagnostic="true">([\s\S]*?)<\/span><\/span>/.exec(notice)![1]!)).toBe('Reading it failed with fatal: not a git repository: /srv/ledger/.git')
    }
  })

  it('is listed in the scope control with no count, saying in words that it could not be read', () => {
    const html = renderApp(unreadable, '/')
    expect(entries(html)).toEqual([
      ['All repositories', '30'],
      ['billing', '3'],
      ['ledger', 'unknown'],
      ['website', '27'],
    ])
    const ledger = /<li[^>]*data-scope-item="local\/ledger"[\s\S]*?<\/li>/.exec(rail(html))![0]
    expect(ledger).toMatch(/<span class="[^"]*\bsr-only"[^>]*data-scope-count="unknown">, could not be read<\/span>/)
    expect(ledger).not.toMatch(/data-scope-count="\d/)
    expect(text(/data-repository-facts="unreadable"[^>]*>([^<]*)</.exec(ledger)![1]!)).toBe('Could not be read.')
  })

  it('is named on Metrics too, whose figures do not count it, filtered to the scope', () => {
    const notice = (html: string) => /<div[^>]*data-unreadable-notice[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]
    const joined = notice(renderWith(unreadable, createElement(MetricsPage), '/metrics'))!
    expect(text(/<p>([\s\S]*?)<\/p>/.exec(joined)![1]!)).toBe('One repository could not be read, so its figures are not counted.')
    expect(text(/data-unreadable-name[^>]*>([^<]*)</.exec(joined)![1]!)).toBe('ledger')
    expect(joined).toContain('data-address="true">local/ledger<')
    expect(text(/<span data-diagnostic="true">([\s\S]*?)<\/span><\/span>/.exec(joined)![1]!)).toBe('Reading it failed with fatal: not a git repository: /srv/ledger/.git')
    // Scoped to a repository that was read: no notice. Scoped to the one that was not: it is named.
    expect(notice(renderWith(unreadable, createElement(MetricsPage), '/metrics?repo=local%2Fwebsite'))).toBeUndefined()
    expect(notice(renderWith(unreadable, createElement(MetricsPage), '/metrics?repo=local%2Fledger'))).toContain('local/ledger')
    // Nothing unreadable: no notice.
    expect(notice(renderWith(flooded, createElement(MetricsPage), '/metrics'))).toBeUndefined()
  })

  it('keeps an empty page from claiming nothing waits when nothing could be read', async () => {
    const heading = (html: string) => text(/<h2 class="text-\[20px\][^"]*">([\s\S]*?)<\/h2>/.exec(html)![1]!)
    const alone = await serve([broken('local/ledger', 'ledger', 'gone')])
    expect(heading(renderWith(alone, createElement(InboxPage), '/'))).toBe('This repository could not be read.')
    expect(text(/data-portfolio-unread[^>]*>([^<]*)</.exec(renderWith(alone, createElement(PortfolioPage), '/portfolio'))![1]!)).toBe(
      'This repository could not be read.',
    )
    const both = await serve([broken('local/ledger', 'ledger', 'gone'), broken('local/infra', 'infra', 'gone')])
    expect(heading(renderWith(both, createElement(InboxPage), '/'))).toBe('No repository here could be read.')
  })

  it('leaves the badge its size, and has it say what it did not count', () => {
    expect(badge(renderApp(unreadable, '/'))).toEqual({
      shown: '30',
      heard: '30 waiting. Not counted: ledger, which could not be read',
      title: '30 waiting. Not counted: ledger, which could not be read',
    })
  })
})

describe('liveness by mode (§9.5)', () => {
  const fresh = (over: Partial<EngineHealthEntry> = {}): EngineHealthEntry => ({ at: '2026-09-27T11:58:00Z', inFlight: 0, pushRejections: {}, stale: false, ...over })
  const stale: EngineHealthEntry = { ...fresh(), at: '2026-09-27T09:00:00Z', stale: true }
  const withModes = (website: string | null, billing: string | null): Served => ({
    ...flooded,
    health: {
      ...flooded.health,
      repositories: [
        { id: WEBSITE, name: 'website', mode: website as never },
        { id: BILLING, name: 'billing', mode: billing as never },
      ],
    },
  })
  const banner = (html: string) => /<div[^>]*data-engine-outage[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]
  const facts = (html: string, id: string) => {
    const li = /<li[^>]*data-scope-item="([^"]+)"[\s\S]*?<\/li>/g
    for (const m of rail(html).matchAll(li)) if (m[1] === id) return text(/data-repository-facts[^>]*>([\s\S]*?)<\/p>/.exec(m[0])?.[1] ?? '')
    return null
  }

  it('dispatch, fresh: nothing but the mode', () => {
    const html = renderApp(withModes('dispatch', 'decide'), '/', { [WEBSITE]: fresh(), [BILLING]: null })
    expect(banner(html)).toBeUndefined()
    expect(facts(html, WEBSITE)).toBe('Mode dispatch.')
  })

  describe('a fact every repository shares is said once', () => {
    /** The rail foot's set-wide line, or null. */
    const foot = (html: string) => {
      const m = /data-set-facts[^>]*>([\s\S]*?)<\/p>/.exec(rail(html))
      return m ? text(m[1]!) : null
    }
    /** The page foot (below 768px), as text. */
    const pageFoot = (html: string) => text(/<footer[^>]*data-page-foot-facts[^>]*>([\s\S]*?)<\/footer>/.exec(html)?.[1] ?? '')

    it('two repositories sharing mode and engine state: once at the foot, nothing under the entries', () => {
      const html = renderApp(withModes('decide', 'decide'), '/', { [WEBSITE]: null, [BILLING]: stale })
      expect(foot(html)).toBe('All repositories: mode decide. No engine in this deployment.')
      expect(facts(html, WEBSITE)).toBe('')
      expect(facts(html, BILLING)).toBe('')
      expect(rail(html)).not.toContain('data-repository-facts')
      expect(pageFoot(html)).toBe('All repositories: mode decide. No engine in this deployment.')
    })

    it('two live engines seen at different times share a state', () => {
      const html = renderApp(withModes('dispatch', 'dispatch'), '/', { [WEBSITE]: fresh(), [BILLING]: fresh({ at: '2026-09-27T11:40:00Z' }) })
      expect(foot(html)).toBe('All repositories: mode dispatch.')
      expect(rail(html)).not.toContain('data-repository-facts')
    })

    it('two silent dispatch engines: said once, with the banner unchanged', () => {
      const html = renderApp(withModes('dispatch', 'dispatch'), '/', { [WEBSITE]: null, [BILLING]: stale })
      expect(foot(html)).toBe('All repositories: mode dispatch. No recent heartbeat from their engines.')
      expect(banner(html)).toBeDefined()
    })

    it('differing modes: each entry says its own, and the foot says nothing', () => {
      const html = renderApp(withModes('decide', 'view'), '/', { [WEBSITE]: null, [BILLING]: null })
      expect(foot(html)).toBeNull()
      expect(facts(html, WEBSITE)).toBe('Mode decide. No engine in this deployment.')
      expect(facts(html, BILLING)).toBe('Mode view. No engine in this deployment.')
      expect(pageFoot(html)).toBe('billingMode view. No engine in this deployment.websiteMode decide. No engine in this deployment.')
    })

    it('differing engine states: each entry says its own', () => {
      const html = renderApp(withModes('dispatch', 'dispatch'), '/', { [WEBSITE]: fresh(), [BILLING]: null })
      expect(foot(html)).toBeNull()
      expect(facts(html, WEBSITE)).toBe('Mode dispatch.')
      expect(facts(html, BILLING)).toBe('Mode dispatch. No recent heartbeat from its engine.')
    })

    it('one engine outside this deployment: the set differs, whatever the rest share', () => {
      const html = renderApp(withModes('decide', 'decide'), '/', { [WEBSITE]: fresh(), [BILLING]: fresh() })
      expect(foot(html)).toBeNull()
      expect(facts(html, WEBSITE)).toBe('Mode decide. An engine outside this deployment, last seen 2m ago.')
      expect(facts(html, BILLING)).toBe('Mode decide. An engine outside this deployment, last seen 2m ago.')
    })

    it('one unreadable plus two sharing: the pair once, and the unreadable one keeps its mark', () => {
      const three: Served = {
        ...unreadable,
        health: {
          ...unreadable.health,
          repositories: [
            { id: WEBSITE, name: 'website', mode: 'decide' },
            { id: BILLING, name: 'billing', mode: 'decide' },
            { id: 'local/ledger', name: 'ledger', mode: 'decide' },
          ],
        },
      }
      const html = renderApp(three, '/', { [WEBSITE]: null, [BILLING]: null, 'local/ledger': null })
      expect(foot(html)).toBe('All repositories: mode decide. No engine in this deployment.')
      expect(facts(html, WEBSITE)).toBe('')
      expect(facts(html, BILLING)).toBe('')
      expect(facts(html, 'local/ledger')).toBe('Could not be read.')
      expect(pageFoot(html)).toBe('All repositories: mode decide. No engine in this deployment.ledgerCould not be read.')
    })
  })

  it('dispatch, stale or absent: the outage banner, naming each repository', () => {
    const html = renderApp(withModes('dispatch', 'dispatch'), '/', { [WEBSITE]: stale, [BILLING]: null })
    expect(text(banner(html)!)).toBe(
      'The orchestrator does not appear to be running in website and billing. Decisions will be recorded but nothing will dispatch — last heartbeat website 3h ago, billing never.',
    )
    expect(banner(html)).toContain('title="local/website"')
    const one = renderApp(withModes('dispatch', 'decide'), '/', { [WEBSITE]: null, [BILLING]: null })
    expect(text(banner(one)!)).toBe('The orchestrator does not appear to be running in website. Decisions will be recorded but nothing will dispatch — no heartbeat has been written.')
  })

  it('view or decide, absent: "No engine in this deployment", and no banner', () => {
    const html = renderApp(withModes('decide', 'view'), '/', { [WEBSITE]: null, [BILLING]: null })
    expect(banner(html)).toBeUndefined()
    expect(facts(html, WEBSITE)).toBe('Mode decide. No engine in this deployment.')
    expect(facts(html, BILLING)).toBe('Mode view. No engine in this deployment.')
  })

  it('view or decide, fresh: an engine outside this deployment, last seen', () => {
    const html = renderApp(withModes('decide', 'view'), '/', { [WEBSITE]: fresh(), [BILLING]: null })
    expect(banner(html)).toBeUndefined()
    expect(facts(html, WEBSITE)).toBe('Mode decide. An engine outside this deployment, last seen 2m ago.')
  })

  it('view or decide, stale: "No engine in this deployment", and no banner', () => {
    const html = renderApp(withModes('decide', 'view'), '/', { [WEBSITE]: stale, [BILLING]: stale })
    expect(banner(html)).toBeUndefined()
    expect(facts(html, WEBSITE)).toBe('Mode decide. No engine in this deployment.')
  })

  it('a repository given by --repo under `ui` is decide, so an absent engine raises no banner', async () => {
    const { sources } = await loadSources({ repoOverrides: [`${root}/website`], engine: false })
    expect(sources.map((s) => s.mode)).toEqual(['decide'])
    const served = await serve(sources)
    expect(served.health.repositories).toEqual([{ id: 'local/website', name: 'website', mode: 'decide' }])
    const html = renderApp(served, '/', { 'local/website': null })
    expect(banner(html)).toBeUndefined()
    // With one repository there is no scope control: the fact is at the rail's foot.
    expect(html).not.toContain('data-scope-control')
    expect(text(/<aside[\s\S]*?data-repository-facts[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('Mode decide. No engine in this deployment.')
    // Under `up` the same repository is dispatch, and the same absent heartbeat is an outage.
    const up = await serve((await loadSources({ repoOverrides: [`${root}/website`], engine: true, push: false })).sources)
    expect(up.health.repositories![0]!.mode).toBe('dispatch')
    expect(text(banner(renderApp(up, '/', { 'local/website': null }))!)).toContain('does not appear to be running in website')
  })

  it('shows drift once, naming no repository, when two engines report it', () => {
    const html = renderApp(withModes('dispatch', 'dispatch'), '/', {
      [WEBSITE]: fresh({ at: '2026-09-27T11:58:00Z', commit: 'aaaaaaa111', codeHead: 'bbbbbbb222' }),
      [BILLING]: fresh({ at: '2026-09-27T11:59:00Z', commit: 'aaaaaaa111', codeHead: 'ccccccc333' }),
    })
    const marks = [...html.matchAll(/<div[^>]*data-engine-drift[^>]*>([\s\S]*?)<\/div>/g)]
    expect(marks.length).toBe(1)
    expect(text(marks[0]![1]!)).toBe('engine at aaaaaaa · main at ccccccc')
  })

  it('names the deferral’s repository and the limit that held it', () => {
    const html = renderApp(withModes('dispatch', 'dispatch'), '/', {
      [WEBSITE]: fresh({
        deferrals: [{ slug: 'csv-export', rule: 'MC', reason: '2/2 dispatches running; cap 2', since: '2026-09-27T11:55:00Z', limit: 'concurrency', repository: WEBSITE }],
      }),
      [BILLING]: fresh({ deferrals: [{ slug: 'nightly-report', rule: 'HB', reason: 'window at $40 of $40', since: '2026-09-27T11:00:00Z', limit: 'new-limit' }] }),
    })
    const marks = [...html.matchAll(/<p[^>]*data-deferral="[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]!))
    expect(marks).toEqual([
      'engine holding back csv-export in website (MC, held by the concurrency cap) for 5m — 2/2 dispatches running; cap 2',
      'engine holding back nightly-report in billing (HB, held by the limit new-limit) for 1h — window at $40 of $40',
    ])
  })
})

describe('the staging form’s repository picker', () => {
  it('names each repository it offers, and leaves out a view repository with the reason', () => {
    const both = { ...modes, staging: { ...modes.staging, sources: [...modes.staging.sources, { ...modes.staging.sources[0]!, id: 'local/infra', name: 'infra', mode: 'decide' as const }] } }
    const html = renderWith(both, createElement(NewRunPage), '/portfolio/new')
    const picker = /<div[^>]*data-repository-picker[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!
    expect([...picker.matchAll(/<option value="([^"]+)" title="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((m) => [m[1], m[2], m[3]])).toEqual([
      ['local/website', 'local/website', 'website'],
      ['local/infra', 'local/infra', 'infra'],
    ])
    expect(text(/data-repository-withheld[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('Not offered: billing, which is in view mode here, so nothing is written to it.')
  })
})

describe('a run in a view repository', () => {
  it('offers no decision controls, says why in their place, and keeps the packet', async () => {
    const res = await modes.app.request('/api/repos/local/billing/-/runs/csv-export')
    const detail = (await res.json()) as RunDetailResponse
    const item = detail.items.find((i: InboxItem) => i.kind === 'gate')!
    const card = (readOnly: boolean) => renderWith(modes, createElement(NeedsYouCard, { item, now: NOW, detail, readOnly }), '/')
    const viewCard = card(true)
    expect(viewCard).not.toContain('data-decide="approve"')
    expect(viewCard).not.toContain('data-decide="decline"')
    expect(text(/data-view-mode-line[^>]*>([^<]*)</.exec(viewCard)![1]!)).toBe(VIEW_MODE_LINE)
    expect(VIEW_MODE_LINE).toBe('This deployment records no decisions in this repository.')
    expect(text(viewCard)).toContain('G0 — Is this what we actually want built?')
    expect(viewCard).toContain('data-ref-row')
    // The same card where decisions are recorded.
    expect(card(false)).toContain('data-decide="approve"')
    expect(card(false)).not.toContain('data-view-mode-line')
  })
})

describe('with one repository and nothing unreadable, the rail is as it was', () => {
  it('draws no facts when the server states no mode', async () => {
    const served = await serve([new LocalGitSource(WEBSITE, `${root}/billing`)])
    expect(served.health.repositories).toEqual([{ id: WEBSITE, name: 'website', mode: null }])
    const html = renderApp(served, '/')
    expect(html).not.toContain('data-repository-facts')
    expect(html).not.toContain('data-page-foot-facts')
    expect(html).not.toContain('data-unreadable-notice')
  })
})
