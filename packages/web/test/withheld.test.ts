// Every withheld view the demo fixtures produce, composed in web (#424).
//
// Core states a withheld reason as facts — the grammar looked for, the token
// in the record's spelling, the artifact looked in — and each surface composes
// its own sentence. This walks the fixture repository `ui --demo` serves,
// through the real server routes, into the real packet components, and reads
// back every withheld notice as a reader would see it: the sentence each one
// says, and that none of them carries what a core-written sentence used to —
// markdown backticks, an issue number, a run path.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DiffResponse, Profile, RunDetailResponse } from '../src/api.ts'
import { DiffView } from '../src/components/diff-view.tsx'
import { EscalationPacket } from '../src/components/escalation.tsx'
import { EvidenceRollupPanel, G2Packet } from '../src/components/evidence.tsx'
import { G0Packet } from '../src/components/g0.tsx'
import { G1Packet } from '../src/components/g1.tsx'
import { G3Packet } from '../src/components/g3.tsx'
import { RoundCapPanel } from '../src/components/rounds.tsx'

const SRC = 'fixture'

let fixture: FixtureRepo
let app: ReturnType<typeof createApp>
/**
 * Every withheld notice each fixture run's surfaces render, as text, by
 * surface. Every surface renders for every run — a sweep, not a page — so a
 * run whose card never shows the round comparison still has one here.
 */
const notices = new Map<string, Record<string, string[]>>()

async function get<T>(path: string): Promise<T> {
  const res = await app.request(path)
  if (res.status !== 200) throw new Error(`${path} → ${res.status}`)
  return (await res.json()) as T
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

/** The Withheld roots in a render, each as the sentence a reader sees. */
const withheldIn = (html: string) => [...html.matchAll(/<p [^>]*data-withheld-view[^>]*>(.*?)<\/p>/g)].map((m) => text(m[1]!))

/** Every packet surface a run can show, over the run's own payloads. */
async function render(slug: string): Promise<Record<string, string[]>> {
  const base = `/api/runs/${SRC}/${slug}`
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })
  const detail = await get<RunDetailResponse>(base)
  const diff = await get<DiffResponse>(`${base}/diff`)
  client.setQueryData(['run', SRC, slug], detail)
  client.setQueryData(['diff', SRC, slug], diff)
  for (const [key, route] of [
    ['g0', 'g0'],
    ['g1', 'g1'],
    ['g3', 'g3'],
    ['evidence', 'evidence'],
    ['reviews', 'reviews'],
    ['lexicon', 'lexicon'],
  ] as const) {
    client.setQueryData([key, SRC, slug], await get(`${base}/${route}`))
  }
  const escalations = detail.state?.escalations ?? []
  for (let i = 0; i < escalations.length; i++) {
    client.setQueryData(['escalation', SRC, slug, i], await get(`${base}/escalation/${i}`))
  }
  const profile: Profile = detail.summary.profile
  const surfaces: [string, ReactNode][] = [
    ['g0', createElement(G0Packet, { src: SRC, slug })],
    ['g1', createElement(G1Packet, { src: SRC, slug })],
    ['g2', createElement(G2Packet, { src: SRC, slug, profile })],
    ['g3', createElement(G3Packet, { src: SRC, slug })],
    ['reader', createElement(EvidenceRollupPanel, { src: SRC, slug })],
    ['rounds', createElement(RoundCapPanel, { src: SRC, slug, task: null })],
    ['diff', createElement(DiffView, { files: diff.files, surface: diff.surface, src: SRC, slug })],
    ...escalations.map((_, index): [string, ReactNode] => [`escalation ${index}`, createElement(EscalationPacket, { src: SRC, slug, index })]),
  ]
  const out: Record<string, string[]> = {}
  for (const [name, surface] of surfaces) {
    const found = withheldIn(renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, surface))))
    if (found.length > 0) out[name] = found
  }
  return out
}

beforeAll(async () => {
  fixture = generateFixtureRepo()
  app = createApp({ sources: [new LocalGitSource(SRC, fixture.dir)] })
  for (const run of fixture.runs) notices.set(run.slug, await render(run.slug))
  if (process.env.WITHHELD_DEBUG) console.log(JSON.stringify(Object.fromEntries(notices), null, 2))
}, 120_000)
afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

describe('withheld views over the demo fixtures (#424)', () => {
  it('a forked contract: the work item, the criterion view, the reader’s citations and the diff grouping each name their grammar', () => {
    const work = 'looked for a list under the key file_contact_surface: in work item 01-core.'
    const evidence = 'looked for an evidence block headed ### E<k> — AC<n>.<m> in the verification report.'
    expect(notices.get('forked-contract')).toMatchObject({
      g1: [`Parallel safety withheld — ${work} Open the work item`],
      g2: [`Criterion view withheld — ${evidence} Open the verification report`],
      reader: [`Evidence citations withheld — ${evidence} The report is below.`],
      diff: [`Contact-surface grouping withheld — ${work} The full diff is below, in git's order. Open the work item`],
    })
  })

  it('a malformed release plan: the rollback facts name the first missing line, and CI health its section', () => {
    expect(notices.get('malformed-release')).toMatchObject({
      g3: [
        'Rollback facts withheld — looked for a bold-label line **Change released:** in the release plan. Open the release plan',
        'CI health withheld — looked for a section headed ## CI health in the release plan. Open the release plan',
      ],
    })
  })

  it('a spec with no Assumptions section: the Assumptions view and the roster each name their grammar, in the spec (#440)', () => {
    expect(notices.get('malformed-spec')).toMatchObject({
      g0: [
        'Assumptions withheld — looked for a section headed ## Assumptions in the spec. Open the spec',
        'Requirement roster withheld — looked for a requirement heading ### R<n> — <short name> in the spec. Open the spec',
      ],
    })
    // A well-formed spec and brief withhold nothing.
    expect(notices.get('g0-pending')?.g0).toBeUndefined()
  })

  it('a run with no plan and no work items has nothing to open, and says so without a link', () => {
    expect(notices.get('patch-g1-pending')).toMatchObject({ g1: ['Coverage withheld — looked for a plan, and the record has none.'] })
    expect(notices.get('g0-pending')).toMatchObject({
      g1: [
        'Coverage withheld — looked for a plan, and the record has none.',
        'Parallel safety withheld — looked for a work item, and the record has none.',
      ],
    })
  })

  it('a single review round: the comparison names the round line it looked for, in the review report', () => {
    expect(notices.get('patch-g2-pending')).toMatchObject({
      rounds: ['Round comparison withheld — looked for a second numbered round **Round:** <n of 3> in the review report. Open the review report'],
    })
    // The round-cap run has rounds to compare, and withholds nothing.
    expect(notices.get('round-cap')).toEqual({})
  })

  it('every withheld notice on every fixture is one sentence in the cockpit’s voice — no backtick, no issue number, no run path', () => {
    const all = [...notices.values()].flatMap((bySurface) => Object.values(bySurface).flat())
    expect(all.length).toBeGreaterThan(0)
    for (const notice of all) {
      expect(notice).not.toContain('`')
      expect(notice).not.toMatch(/#\d/)
      expect(notice).not.toContain('runs/')
      expect(notice).not.toMatch(/\.(md|ya?ml)\b/)
      expect(notice).toMatch(/^[A-Z][^—]* withheld — looked for /)
    }
  })
})
