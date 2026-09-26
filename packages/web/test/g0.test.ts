// G0's packet and the staged card's brief (#440), rendered over the demo
// fixtures through the real server route, the way `ui --demo` serves them.
//
// What is pinned: the Assumptions lead, each quoted whole with its line one
// gesture away and linked into the reader; the roster is Names with their
// short names; the brief's sections are captioned by kind, not by file; Out of
// scope is a fold that starts closed; each part that cannot be composed says
// what it looked for; and nothing on the packet names a file outside an
// Address.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { buildG0Packet } from '@gateline/core/view-model'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RunDetailResponse } from '../src/api.ts'
import { G0Packet, StagedBrief } from '../src/components/g0.tsx'
import { NeedsYouCard } from '../src/pages/run/decide-card.tsx'

const SRC = 'fixture'

let fixture: FixtureRepo
let app: ReturnType<typeof createApp>

async function get<T>(path: string): Promise<T> {
  const res = await app.request(path)
  if (res.status !== 200) throw new Error(`${path} → ${res.status}`)
  return (await res.json()) as T
}

/** A client seeded with the run's own payloads, so every query the card makes is answered. */
async function seeded(slug: string): Promise<{ client: QueryClient; detail: RunDetailResponse }> {
  const base = `/api/runs/${SRC}/${slug}`
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  const detail = await get<RunDetailResponse>(base)
  client.setQueryData(['run', SRC, slug], detail)
  for (const key of ['g0', 'g1', 'g3', 'evidence', 'reviews', 'lexicon'] as const) {
    client.setQueryData([key, SRC, slug], await get(`${base}/${key}`))
  }
  for (const ref of detail.artifactRefs.filter((r) => r.kind === 'work-item')) {
    client.setQueryData(['artifact', SRC, slug, ref.path], await get(`${base}/artifact?path=${encodeURIComponent(ref.path)}`))
  }
  return { client, detail }
}

const draw = (client: QueryClient, node: ReactNode) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)))

async function packet(slug: string, mode: 'gate' | 'patch' = 'gate'): Promise<string> {
  const { client } = await seeded(slug)
  return draw(client, createElement(G0Packet, { src: SRC, slug, mode }))
}

async function card(slug: string): Promise<string> {
  const { client, detail } = await seeded(slug)
  const item = detail.items[0]!
  return draw(client, createElement(NeedsYouCard, { item, now: detail.now ?? Math.floor(Date.now() / 1000), detail }))
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:])/g, '$1')
    .trim()

/** The markup with every Address removed: what is left may name no file. */
const outsideAddresses = (html: string) => html.replace(/<(span|a)\b[^>]*\bdata-address\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
const FILENAME = /\S\.(?:md|ya?ml|json)\b|runs\//

/** The words a reader reads at rest: the passages without the `at <address>` each carries in its corner. */
const words = (html: string) => text(html.replace(/<span[^>]*data-at[^>]*>[\s\S]*?<\/a><\/span>/g, ' '))

const withheld = (html: string) => [...html.matchAll(/<p [^>]*data-withheld-view[^>]*>(.*?)<\/p>/g)].map((m) => text(m[1]!))

beforeAll(async () => {
  fixture = generateFixtureRepo()
  app = createApp({ sources: [new LocalGitSource(SRC, fixture.dir)] })
}, 120_000)
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('the G0 packet over g0-pending', () => {
  it('leads with the Assumptions, each quoted whole, its line an Address linked into the reader', async () => {
    const html = await packet('g0-pending')
    expect(html).toContain('G0 packet — composed from the record')
    // Assumptions come before the roster and before the brief.
    const order = ['data-g0-assumptions', 'data-g0-requirements', 'data-g0-section="problem"', 'data-g0-section="constraints"'].map((h) =>
      html.indexOf(h),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    const assumption = /<li[^>]*data-assumption="(\d+)"[^>]*>([\s\S]*?)<\/li>/.exec(html)!
    expect(text(assumption[2]!)).toContain('ASSUMPTION: input fits in memory → resolved as yes because samples are <1MB.')
    // The address says where, and the link opens the spec in the reader on that line (#441).
    const link = new RegExp(`<a([^>]*)>spec\\.md:${assumption[1]}</a>`).exec(assumption[2]!)
    expect(link?.[1]).toContain('data-address')
    expect(link?.[1]).toContain(`href="/runs/${SRC}/g0-pending?tab=record&amp;artifact=spec.md&amp;anchor=L${assumption[1]}"`)
    // Quoted as a passage: the hairline box, the record's markdown rendered.
    expect(assumption[0]).toMatch(/border-line bg-surface/)
    expect(assumption[2]).toContain('<strong>ASSUMPTION:</strong>')
    // The item keeps its marker, so it renders as the list it is — bullet suppressed, one item per box.
    expect(assumption[2]).toMatch(/class="prose-card[^"]*\[&amp;&gt;ul\]:list-none![^"]*"><ul>\s*<li>/)
  })

  it('names each requirement as the spec heads it, the address landing on its heading', async () => {
    const html = await packet('g0-pending')
    const rows = [...html.matchAll(/<li[^>]*data-requirement="(R\d+)"[^>]*>([\s\S]*?)<\/li>/g)]
    expect(rows.map((r) => [r[1], text(r[2]!).replace(/ at spec\.md:\d+$/, '')])).toEqual([
      ['R1', 'R1 Core behavior'],
      ['R2', 'R2 Error handling'],
    ])
    for (const r of rows) {
      expect(r[2]).toMatch(new RegExp(`data-name[^>]*>${r[1]}<`))
      expect(r[2]).toMatch(new RegExp(`href="[^"]*artifact=spec\\.md&amp;anchor=def-${r[1]}"`))
    }
    expect(text(html)).toContain('2 requirements')
  })

  it('quotes the brief’s Problem and Constraints under their kind, never the filename', async () => {
    const html = await packet('g0-pending')
    expect(words(html)).toContain('Problem, from the brief The CSV importer workflow is manual and error-prone today.')
    expect(words(html)).toContain('Constraints, from the brief Must run offline; none otherwise known.')
  })

  it('folds Out of scope, closed, to its heading', async () => {
    const html = await packet('g0-pending')
    const fold = /<div[^>]*data-fold[^>]*data-g0-fold="out-of-scope"[^>]*>([\s\S]*?)<\/div>/.exec(html)
    expect(fold).not.toBeNull()
    expect(fold![0]).toContain('data-open="false"')
    expect(text(fold![1]!)).toBe('▸ Out of scope')
    // Closed means closed: the body is not in the markup until opened.
    expect(text(html)).not.toContain('Concurrency; internationalization.')
  })

  it('withholds nothing, and names no file outside an Address', async () => {
    const html = await packet('g0-pending')
    expect(withheld(html)).toEqual([])
    expect(text(outsideAddresses(html))).not.toMatch(FILENAME)
  })
})

describe('the G0 packet over malformed-spec', () => {
  it('withholds the Assumptions and the roster, naming the grammar looked for in the spec; the brief half stands', async () => {
    const html = await packet('malformed-spec')
    expect(withheld(html)).toEqual([
      'Assumptions withheld — looked for a section headed ## Assumptions in the spec. Open the spec',
      'Requirement roster withheld — looked for a requirement heading ### R<n> — <short name> in the spec. Open the spec',
    ])
    expect(words(html)).toContain('Problem, from the brief The webhook relay workflow is manual and error-prone today.')
    expect(html).toContain('data-g0-fold="out-of-scope"')
    expect(text(outsideAddresses(html))).not.toMatch(FILENAME)
  })

  it('renders on the bounced G0 card, beside the bounce line', async () => {
    const html = await card('malformed-spec')
    expect(html).toContain('data-bounce="spec.md"')
    expect(html).toContain('data-g0-packet')
  })
})

describe('the G0 packet on other cards', () => {
  it('the G0 card carries it', async () => {
    const html = await card('g0-pending')
    expect(html).toMatch(/data-g0-packet[^>]*data-g0-mode="gate"/)
  })

  it('a patch run’s G1 takes the brief half and the work item — no plan, no spec half, nothing withheld', async () => {
    const html = await card('patch-g1-pending')
    expect(html).toMatch(/data-g0-packet[^>]*data-g0-mode="patch"/)
    expect(html).toContain('G1 packet — composed from the record')
    expect(html).not.toContain('data-g1-packet')
    expect(html).not.toContain('data-g0-spec')
    expect(words(html)).toContain('Problem, from the brief The typo hotfix workflow is manual and error-prone today.')
    // The brief contract names no audit-time section: its Out of scope is decide-time, open.
    expect(words(html)).toContain('Out of scope, from the brief Changing the upstream data format.')
    expect(html).not.toContain('data-g0-fold')
    // The work item the gate approves with the brief, read as fields, headed by its id.
    const item = /data-patch-work-item="01-hotfix"[\s\S]*/.exec(html)?.[0] ?? ''
    expect(item).toMatch(/data-name[^>]*>01-hotfix</)
    expect(item).toContain('data-field-view="work-item"')
    expect(withheld(html)).toEqual([])
    expect(text(outsideAddresses(html.replace(/<div[^>]*data-field-view[\s\S]*$/, '')))).not.toMatch(FILENAME)
  })
})

describe('the G0 packet over shapes the fixtures do not carry', () => {
  const SPEC = `# Specification: x

## Requirements

### R1 — one

### R3 - three

### R2 — two

## Assumptions
<!-- Each ambiguity in the brief. -->
Two readings of the brief, teed up for G0:

- **ASSUMPTION:** the export format → two readings:

    CSV or JSON. Resolved as CSV.

## Out of scope
<!-- Explicit non-goals. -->
`

  async function over(spec: string, audit: string[] = []): Promise<string> {
    const { client } = await seeded('g0-pending')
    const g0 = buildG0Packet({ spec, brief: '## Problem\np\n\n## Constraints\nc\n', audit: { spec: audit } })
    client.setQueryData(['g0', SRC, 'g0-pending'], g0)
    return draw(client, createElement(G0Packet, { src: SRC, slug: 'g0-pending' }))
  }

  it('quotes the lead-in that tees a choice up as a passage of its own, before the item', async () => {
    const html = await over(SPEC)
    const kinds = [...html.matchAll(/data-passage-kind="(\w+)"/g)].map((m) => m[1])
    expect(kinds).toEqual(['prose', 'item'])
    expect(words(html)).toContain('Two readings of the brief, teed up for G0:')
    expect(html).not.toContain('Each ambiguity in the brief')
  })

  it('an item’s indented continuation stays a paragraph of the item, never a code block', async () => {
    const html = await over(SPEC)
    const item = html.slice(html.indexOf('data-passage-kind="item"'), html.indexOf('data-g0-requirements'))
    expect(item).toContain('<p>CSV or JSON. Resolved as CSV.</p>')
    expect(item).not.toContain('<pre>')
  })

  it('a heading the grammar misses withholds the roster’s count, and lists what it read', async () => {
    const html = await over(SPEC)
    expect(withheld(html)).toContain('Requirement roster withheld — looked for a requirement heading ### R<n> — <short name> in the spec. Open the spec')
    expect(html).not.toContain('data-count')
    expect([...html.matchAll(/data-requirement="(R\d+)"/g)].map((m) => m[1])).toEqual(['R1', 'R2'])
  })

  it('a section holding only the template’s comment says it is empty, open when decide-time', async () => {
    const html = await over(SPEC)
    expect(html).not.toContain('data-g0-fold')
    expect(words(html)).toContain('Out of scope The spec’s Out of scope section is empty.')
  })

  it('folds Out of scope exactly when the contract calls it audit-time', async () => {
    expect(await over(SPEC, ['Out of scope'])).toContain('data-g0-fold="out-of-scope"')
    expect(await over(SPEC, [])).not.toContain('data-g0-fold')
  })

  it('an empty Assumptions section says so', async () => {
    const html = await over('# S\n\n### R1 — one\n\n## Assumptions\n<!-- If none, say "none". -->\n\n## Out of scope\nx\n')
    expect(words(html)).toContain('The spec’s Assumptions section is empty.')
  })
})

describe('the staged card', () => {
  it('quotes the brief’s Problem and Constraints, then states the profile and the recorded ceiling, then offers Arm', async () => {
    const html = await card('staged')
    const brief = html.indexOf('data-staged-brief')
    const terms = html.indexOf('data-staged="true"')
    expect(brief).toBeGreaterThan(0)
    expect(terms).toBeGreaterThan(brief)
    expect(words(html)).toContain('Problem, from the brief The changelog linter workflow is manual and error-prone today.')
    expect(words(html)).toContain('Constraints, from the brief Must run offline; none otherwise known.')
    // The facts the record states: the profile as its Name, the ceiling as recorded.
    expect(text(html)).toContain('Profile standard · budget ceiling $18.50, set by cost_limit_usd')
    expect(/data-staged="true"[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1]).toMatch(/data-name[^>]*>standard</)
    expect(html).not.toContain('data-quoted-word="standard"')
    expect(html).toMatch(/<button[^>]*>[^<]*Arm/)
    expect(withheld(html)).toEqual([])
    expect(text(outsideAddresses(html))).not.toMatch(FILENAME)
  })

  it('a staged run with no brief says the brief half is withheld and has nothing to open', async () => {
    const { client } = await seeded('bad-state')
    const html = draw(client, createElement(StagedBrief, { src: SRC, slug: 'bad-state' }))
    expect(withheld(html)).toEqual(['Problem and Constraints withheld — looked for an intent brief, and the record has none.'])
  })
})
