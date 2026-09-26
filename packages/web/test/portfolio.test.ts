// The portfolio's left-edge mark and its scroll cue (#297). Both decisions
// used to be implicit in JSX, where the one thing that could go wrong went
// wrong: the mark the page exists for sat in the last column of a table that
// is wider than its wrapper below 1000px, and the clipping was silent. What is
// under test is what the mark says and in which texture (#452), and the
// arithmetic that decides whether a pane admits it is cut off.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { createApp } from '@gateline/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NeedFact, RunSummary, RunsResponse } from '../src/api.ts'
import { NeedsYou, needsYouMark, scrollCue } from '../src/pages/portfolio.tsx'

const need = (kind: NeedFact['kind'], over: Partial<NeedFact> = {}): NeedFact => ({ kind, gate: null, reviewable: true, inflight: null, ...over })
const run = (needs: NeedFact[]) => ({ needs })
/** The `imp-*` classes on the mark, sorted. */
const tones = (html: string) => [...html.matchAll(/class="imp ([^"]*)"/g)].flatMap((m) => m[1]!.split(' ').filter((c) => c.startsWith('imp-'))).sort()

describe('needsYouMark', () => {
  it('counts every need and takes its tone from the first', () => {
    const mark = needsYouMark(run([need('escalation'), need('gate', { gate: 'G2' }), need('paused')]))
    expect(mark).toMatchObject({ kind: 'needs', count: 3, tone: 'warn', glyph: '⚑', label: '3 items need you (escalation first)' })
  })

  it('singularizes one item, and names a gate by its code', () => {
    expect(needsYouMark(run([need('gate', { gate: 'G1' })]))).toMatchObject({ count: 1, tone: 'go', glyph: '', label: '1 item needs you (G1 gate)' })
  })

  it('says which gates are not ready: bounced, or superseded while the producer reworks it', () => {
    expect(needsYouMark(run([need('gate', { gate: 'G0', reviewable: false })])).label).toBe('1 item needs you (G0 gate, bounced)')
    const inflight = need('gate', { gate: 'G0', reviewable: false, inflight: { role: 'analyst', since: 1 } })
    expect(needsYouMark(run([inflight])).label).toBe('1 item needs you (G0 gate, superseded)')
  })

  it('is quiet when the run asks nothing of you — whatever its escalation count', () => {
    const closed: Pick<RunSummary, 'needs' | 'needsHuman' | 'escalationsOpen'> = { needs: [], needsHuman: 0, escalationsOpen: 1 }
    expect(needsYouMark(closed)).toEqual({ kind: 'quiet', count: 0, label: 'nothing needs you' })
  })
})

// The chip per kind, as settled decision 8 maps them (packages/web/DESIGN.md).
// `fill` is "done, or a decision taken"; nothing waiting may wear it.
describe('the needs-you chip takes the texture of what is waiting (#452)', () => {
  it.each([
    ['a ready gate', need('gate', { gate: 'G1' }), ['imp-go'], '1'],
    ['a bounced gate', need('gate', { gate: 'G0', reviewable: false }), ['imp-dot'], '1'],
    ['a superseded gate', need('gate', { gate: 'G0', reviewable: false, inflight: { role: 'analyst', since: 1 } }), ['imp-dot'], '1'],
    ['an escalation', need('escalation'), ['imp-warn'], '⚑1'],
    ['a round cap', need('round-cap'), ['imp-warn'], '⟲1'],
    ['a malformed record', need('malformed', { reviewable: false }), ['imp-hatch', 'imp-mark'], '1'],
    ['a pause', need('paused'), ['imp-dot'], '1'],
    ['a staged run', need('staged'), ['imp-dot'], '1'],
  ] as const)('%s', (_, lead, expected, text) => {
    const html = renderToStaticMarkup(createElement(NeedsYou, { mark: needsYouMark(run([lead])) }))
    expect(tones(html)).toEqual([...expected].sort())
    expect(html).not.toContain('imp-fill')
    expect(html).not.toContain('imp-cur')
    expect(html.replace(/<[^>]+>/g, '')).toBe(text)
  })
})

// The same chips over the demo fixtures, through the route the portfolio
// reads, so the mark is asked about what the page will actually be handed.
describe('the demo portfolio, row by row (#452)', () => {
  const SRC = 'fixture'
  let fixture: FixtureRepo
  let runs: RunSummary[]
  beforeAll(async () => {
    fixture = generateFixtureRepo()
    const app = createApp({ sources: [new LocalGitSource(SRC, fixture.dir)] })
    const res = await app.request('/api/runs')
    expect(res.status).toBe(200)
    runs = ((await res.json()) as RunsResponse).runs
  }, 120_000)
  afterAll(() => rm(fixture.dir, { recursive: true, force: true }))

  const chip = (slug: string) => {
    const row = runs.find((r) => r.slug === slug)
    expect(row, slug).toBeDefined()
    return renderToStaticMarkup(createElement(NeedsYou, { mark: needsYouMark(row!) }))
  }

  it.each([
    ['g0-pending', ['imp-go']],
    ['g1-pending', ['imp-go']],
    ['g2-pending', ['imp-go']],
    ['g3-pending', ['imp-go']],
    ['patch-g1-pending', ['imp-go']],
    ['patch-g2-pending', ['imp-go']],
    ['escalated', ['imp-warn']],
    ['round-cap', ['imp-warn']],
    ['bad-state', ['imp-hatch', 'imp-mark']],
    ['malformed-spec', ['imp-dot']],
    ['malformed-release', ['imp-dot']],
    ['paused-budget', ['imp-dot']],
    ['staged', ['imp-dot']],
  ])('%s: %j', (slug, expected) => {
    expect(tones(chip(slug))).toEqual([...expected].sort())
  })

  it('no waiting row wears fill', () => {
    const waiting = runs.filter((r) => r.needs.length > 0)
    expect(waiting.length).toBeGreaterThan(10)
    for (const r of waiting) expect(chip(r.slug), r.slug).not.toContain('imp-fill')
  })

  it.each(['closed-delivered', 'done-merged'])('%s: no mark at all', (slug) => {
    const html = chip(slug)
    expect(html).not.toContain('class="imp')
    expect(html).not.toMatch(/esc/)
  })

  it('closed-delivered still holds its open escalation in the record — the mark ignores it', () => {
    expect(runs.find((r) => r.slug === 'closed-delivered')).toMatchObject({ phase: 'closed', escalationsOpen: 1, needs: [] })
  })
})

describe('scrollCue', () => {
  it('says nothing when the table fits its pane', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 744, clientWidth: 744 })).toEqual({ left: false, right: false })
  })

  // The measurement from the issue: a 1043px table in a 758px wrapper at a
  // 1000px viewport. Unscrolled, the cue must appear on the right before the
  // user touches anything — that is the whole defect.
  it('cues the right edge before any interaction when the table overflows', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: false, right: true })
  })

  it('cues both edges mid-scroll', () => {
    expect(scrollCue({ scrollLeft: 120, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: true, right: true })
  })

  it('drops the right cue at the end of the scroll', () => {
    expect(scrollCue({ scrollLeft: 299, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: true, right: false })
  })

  it('tolerates a sub-pixel overhang rather than claiming a cut-off table', () => {
    expect(scrollCue({ scrollLeft: 0.5, scrollWidth: 744.6, clientWidth: 744 })).toEqual({ left: false, right: false })
  })
})
