// The narrow-viewport geometry sweep (#301).
//
// Gatehouse had two test layers and a gap between them, and every finding of
// the 2026-08-02 design review lived in the gap. `vitest` tests pure derivation
// and — through `renderToStaticMarkup` — component structure; neither lays out,
// so neither can ever see wrap, overflow, or width. The rest of the e2e suite
// asserts behaviour and content at one pinned viewport (1280×900). Nothing
// asked what the pages *do* when the band narrows, and the one test that ever
// changed the viewport had its assertion written to match whatever the layout
// happened to do on the day — it permitted a two-row spine, which #295 then
// established was the defect itself.
//
// So this file states rules rather than states. Each assertion below is an
// invariant that must hold for every fixture state at every width; none of them
// encode a pixel or a snapshot of current behaviour, and when one fails it names
// the state, the width, the measurement, and the element that caused it.
//
// **No screenshot baselines** — a decision, not an omission (#301 asked for it
// either way). A `toHaveScreenshot` baseline states what the page looked like;
// these assertions state what must be true of it. The baseline fails on every
// deliberate change, is re-blessed rather than diagnosed, needs pinned rendering
// to be stable across machines, and when it does fail it says "these 4,000
// pixels differ" — which is not a bug report. Revisit only if a defect class
// turns up that no invariant can be written for.
//
// Shape: one browser context and one page for the whole file, reused across
// every state and width — that is the CI-time constraint #301 set, and a fresh
// context per combination would pay for a cold `/api/runs` (which walks every
// fixture run's git history) a hundred times over. Within it each combination
// is navigated fresh rather than resized into: an early draft resized, and the
// stale-layout artefacts it produced were indistinguishable from real findings.
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { generateFixtureRepo } from '@gateline/fixtures'

const PORT = 4395
// The page is built with `browser.newPage()` rather than taken from the `page`
// fixture — one context for the whole file — so it carries no `baseURL` and
// navigates absolutely.
const ORIGIN = `http://127.0.0.1:${PORT}`

/**
 * The band the design review found broken, plus the pinned width the rest of
 * the suite runs at — so a fix aimed at the narrow band that regresses the wide
 * one is caught here too.
 */
const WIDTHS = [800, 900, 1000, 1280] as const

interface KnownBroken {
  /** The open issue that owns the defect. Every entry needs one: an excluded
   *  combination with nobody's name on it is a debt that never gets paid. */
  issue: number
  /** What the sweep measured, so the next reader does not re-derive it. */
  why: string
  widths: readonly number[]
  invariant: InvariantId
}

type InvariantId = 'no-sideways-scroll' | 'one-row-spine' | 'finding-title-floor' | 'needs-you-visible'

interface SweepState {
  name: string
  /** Path under the origin, given the fixture source id. */
  path: (src: string) => string
  /** Rendered-and-settled signal: the sweep measures nothing before this. */
  ready: string
  /**
   * The defects already known on this state, one entry per owning issue. The
   * combination is excluded from the invariant it breaks and re-asserted by the
   * `test.fixme` at the bottom of this file, so the debt is declared in the
   * table — with its cause, its widths and its owner — rather than absorbed
   * into a weakened assertion. Weakening the assertion instead is the mistake
   * #301 was filed to correct.
   *
   * Only combinations the sweep actually observed breaching are listed. A
   * declaration for a combination that currently passes would silently absorb
   * the next regression on it.
   */
  broken?: KnownBroken[]
}

/**
 * Why the page body currently scrolls sideways in the 800–1000 band, in the two
 * causes the sweep could separate — and it is worth being precise, because the
 * attribution turned out not to match the issues that filed the symptoms.
 *
 * **#308 — the idle lexicon hover card.** `.lex-card` is `invisible absolute
 * left-0 top-full w-[26rem]`, and `visibility: hidden` still takes part in
 * layout (`display: none` would not). Every R/AC/ADR reference on the page
 * therefore hangs a 416px box off its own left edge, and a reference right of
 * centre pushes the page body — while showing nothing. The tell is a *constant*
 * measurement rather than a viewport-dependent one: the number is set by the
 * rightmost reference, so it reads the same at 800, 900 and 1000px.
 *
 * Suppressing `.lex-card` in the browser drops every state declared below to
 * exactly the viewport width, with one exception.
 *
 * **#281 — the Record pane.** That exception: with the card suppressed,
 * `verification-report.md` at 800px still measures 813px, a markdown table
 * escaping a reader that never decided what yields. That is #281's own
 * diagnosis, and stacking the picker plus an `overflow-x` guard is what closes
 * it. Note for anyone reading #281's filed table: its headline 1012px at all
 * three widths is #308's card, not the grid — 13px of that number is the pane.
 */
const LEX_CARD = (widths: readonly number[]): KnownBroken => ({
  issue: 308,
  why: 'the idle .lex-card is laid out and hangs past the right edge; same measurement at every width in the band',
  widths,
  invariant: 'no-sideways-scroll',
})

const RECORD_PANE: KnownBroken = {
  issue: 281,
  why: 'a markdown table escapes the reader pane — 813px at 800px with .lex-card suppressed, so this part is the grid',
  widths: [800],
  invariant: 'no-sideways-scroll',
}

/** The band #308 reproduces in on the states below. */
const BAND = [800, 900, 1000] as const

/**
 * Every state worth laying out. The run surfaces are enumerated explicitly
 * rather than crawled: `decide`, `record` and `history` are three different
 * layouts, and the review's findings were spread across all three.
 */
const STATES: SweepState[] = [
  { name: 'inbox', path: () => '/', ready: '[data-inbox-row]' },
  { name: 'portfolio', path: () => '/portfolio', ready: 'table' },
  { name: 'metrics', path: () => '/metrics', ready: 'h1' },
  { name: 'new run', path: () => '/portfolio/new', ready: 'h1' },

  { name: 'g0-pending · decide', path: (s) => `/runs/${s}/g0-pending?decide=G0`, ready: '[data-needs-card]' },
  { name: 'g0-pending · history', path: (s) => `/runs/${s}/g0-pending?tab=history`, ready: '[data-spine]' },

  { name: 'g1-pending · decide', path: (s) => `/runs/${s}/g1-pending?decide=G1`, ready: '[data-g1-packet]' },

  {
    name: 'g2-pending · decide',
    path: (s) => `/runs/${s}/g2-pending?decide=G2`,
    ready: '[data-needs-card]',
    broken: [LEX_CARD([800])],
  },
  { name: 'g2-pending · history', path: (s) => `/runs/${s}/g2-pending?tab=history`, ready: '[data-spine]' },

  { name: 'g3-pending · decide', path: (s) => `/runs/${s}/g3-pending?decide=G3`, ready: '[data-needs-card]' },

  { name: 'escalated', path: (s) => `/runs/${s}/escalated`, ready: '[data-spine]' },
  { name: 'round-cap', path: (s) => `/runs/${s}/round-cap`, ready: '[data-spine]' },
  { name: 'paused-budget', path: (s) => `/runs/${s}/paused-budget`, ready: '[data-spine]' },
  { name: 'closed-delivered', path: (s) => `/runs/${s}/closed-delivered`, ready: '[data-spine]' },
  { name: 'done-merged', path: (s) => `/runs/${s}/done-merged`, ready: '[data-spine]' },
  { name: 'patch-g1-pending', path: (s) => `/runs/${s}/patch-g1-pending?decide=G1`, ready: '[data-spine]' },
  { name: 'patch-g2-pending', path: (s) => `/runs/${s}/patch-g2-pending`, ready: '[data-spine]' },
  {
    name: 'forked-contract',
    path: (s) => `/runs/${s}/forked-contract`,
    ready: '[data-spine]',
    broken: [LEX_CARD([800])],
  },
  { name: 'malformed-spec · bounce', path: (s) => `/runs/${s}/malformed-spec?decide=G0`, ready: '[data-needs-card]' },
  { name: 'malformed-release · bounce', path: (s) => `/runs/${s}/malformed-release?decide=G3`, ready: '[data-needs-card]' },
  { name: 'bad-state', path: (s) => `/runs/${s}/bad-state`, ready: 'main' },

  // The record's reader, artifact by artifact: what the pane does with its
  // width is a property of what is in it, and a markdown table, a fenced
  // command and a YAML dump are three different pressures. Pinned with
  // `?artifact=` rather than left to the landing rule, so the sweep cannot
  // quietly stop covering the wide ones when that rule changes.
  //
  // The artifacts carrying R/AC/ADR references are the ones #308 reaches.
  ...recordStates('g2-pending', ['verification-report.md'], [LEX_CARD(BAND), RECORD_PANE]),
  ...recordStates('g2-pending', ['plan.md'], [LEX_CARD(BAND)]),
  ...recordStates('round-cap', ['review-01.md', 'review-02.md'], [LEX_CARD(BAND)]),
  ...recordStates('g1-pending', ['plan.md'], [LEX_CARD(BAND)]),
  // …and these hold up as they are, which is what makes the list above a
  // statement about those artifacts rather than about the Record tab.
  ...recordStates('g2-pending', ['spec.md', 'state.yaml', 'tasks/01-core.yaml']),
  ...recordStates('g1-pending', ['tasks/02-errors.yaml']),
  ...recordStates('malformed-spec', ['spec.md']),
  { name: 'g2-pending · diff', path: (s) => `/runs/${s}/g2-pending?tab=diff`, ready: 'main' },
]

function recordStates(slug: string, artifacts: string[], broken?: KnownBroken[]): SweepState[] {
  return artifacts.map((artifact) => ({
    name: `${slug} · record · ${artifact}`,
    path: (s: string) => `/runs/${s}/${slug}?tab=record&artifact=${encodeURIComponent(artifact)}`,
    ready: 'article',
    broken,
  }))
}

interface Measurement {
  state: string
  width: number
  /** The page's own overflow. `clientWidth` is the layout viewport — narrower
   *  than `innerWidth` by the scrollbar, and the honest thing to compare to. */
  bodyScrollWidth: number
  docScrollWidth: number
  viewportWidth: number
  /** Guards against a vacuous pass: an empty page overflows nothing. */
  elementCount: number
  /** Widest-first, the elements actually sticking out past the viewport. */
  culprits: string[]
  /** Distinct top edges among the spine's cells; 1 is the only correct answer. */
  spineRows: number
  spineCells: number
  findingTitles: { id: string; width: number; floor: number }[]
  needsYou: { slug: string; overflowLeft: number; overflowRight: number }[]
}

let fixtureDir: string
let server: ChildProcess
let page: Page
const measurements: Measurement[] = []

const sourceId = () => fixtureDir.replace(/\/+$/, '').split('/').pop()!

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  // ~25 states × 4 widths, one navigation each: well past the per-test default.
  test.setTimeout(300_000)
  fixtureDir = generateFixtureRepo().dir
  server = spawn('node', ['server/src/main.ts', '--repo', fixtureDir, '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok
    } catch {
      /* not up yet */
    }
    if (!up) await new Promise((r) => setTimeout(r, 500))
  }
  if (!up) throw new Error('server did not come up')

  page = await browser.newPage({ viewport: { width: WIDTHS[WIDTHS.length - 1], height: 900 } })
  for (const state of STATES) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(ORIGIN + state.path(sourceId()))
      await expect(page.locator(state.ready).first()).toBeVisible()
      await settle(page)
      measurements.push({ state: state.name, width, ...(await measure(page)) })
    }
  }
})

test.afterAll(async () => {
  await page?.close()
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

/**
 * Wait until the page has stopped changing shape, and fail loudly if it never
 * does.
 *
 * This is the load-bearing part of the sweep, and the first draft got it wrong
 * in the way that matters: the run page's spine renders long before the
 * artifact body its own query is still fetching, so a sweep gated on
 * `[data-spine]` measured an empty reader and reported no overflow. A geometry
 * test that measures a page mid-load does not fail — it *passes*, which is the
 * exact failure this file exists to stop. So: web fonts resolved (a font swap
 * moves every text width), no `.skel` placeholder left anywhere, and the
 * element count and both scroll extents unchanged across two samples.
 */
async function settle(p: Page) {
  await p.evaluate(async () => {
    const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await document.fonts?.ready
    let previous = ''
    for (let i = 0; i < 60; i++) {
      await frame()
      const loading = document.querySelectorAll('.skel').length
      const shape = `${loading}/${document.getElementsByTagName('*').length}/${Math.round(
        document.body.scrollHeight,
      )}/${Math.round(document.body.scrollWidth)}`
      if (loading === 0 && shape === previous) return
      previous = shape
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`page never settled (loading/elements/height/width = ${previous})`)
  })
}

async function measure(p: Page): Promise<Omit<Measurement, 'state' | 'width'>> {
  return await p.evaluate(() => {
    const round = (n: number) => Math.round(n * 100) / 100

    const spineCells = [
      ...document.querySelectorAll<HTMLElement>('[data-spine] > [data-spine-phase], [data-spine] > [data-spine-gate]'),
    ]
    // Subpixel rounding differs between a phase pill and a gate pill on the
    // same line; whole pixels is the resolution the question is asked at.
    const spineRows = new Set(spineCells.map((c) => Math.round(c.getBoundingClientRect().top)))

    // 24ch, or the card's own content width where that is narrower —
    // recomputed from the element's font rather than read out of the
    // stylesheet, so the invariant survives the fix being written a different
    // way. The reference for "or narrower" is the finding card, deliberately
    // not the title's immediate parent: the wrapper the title sits in today is
    // #296's implementation, and measuring against it would let a future
    // regression that collapses the wrapper collapse the floor with it.
    const ctx = document.createElement('canvas').getContext('2d')!
    const findingTitles = [...document.querySelectorAll<HTMLElement>('[data-finding-title]')].map((el) => {
      const cs = getComputedStyle(el)
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const ch = ctx.measureText('0').width
      const card = el.closest<HTMLElement>('[data-finding]')
      const cardStyle = card ? getComputedStyle(card) : null
      // `clientWidth`, not the bounding box: the box includes the card's 1px
      // border on each side, and counting those makes the floor 2px wider than
      // any child could ever be.
      const available = card
        ? card.clientWidth - parseFloat(cardStyle!.paddingLeft) - parseFloat(cardStyle!.paddingRight)
        : Infinity
      return {
        id: card?.getAttribute('data-finding') ?? '?',
        width: round(el.getBoundingClientRect().width),
        floor: round(Math.min(24 * ch, available)),
      }
    })

    // The portfolio's needs-you mark leads the run cell inside a pane that
    // scrolls horizontally (#297); "inside the visible wrapper" means inside
    // that pane's box, not inside the table's.
    // Scoped to the portfolio by pathname: the metrics page and the record
    // reader have tables of their own, and neither has a needs-you rail.
    const pane = location.pathname === '/portfolio' ? (document.querySelector('table')?.parentElement ?? null) : null
    const paneBox = pane?.getBoundingClientRect()
    const needsYou: { slug: string; overflowLeft: number; overflowRight: number }[] = []
    if (paneBox) {
      for (const td of document.querySelectorAll<HTMLElement>('tbody tr > td:first-child')) {
        const mark = td.querySelector<HTMLElement>(':scope > div > span:first-child')
        if (!mark) continue
        const box = mark.getBoundingClientRect()
        needsYou.push({
          slug: td.querySelector('a')?.textContent ?? '?',
          overflowLeft: round(Math.max(0, paneBox.left - box.left)),
          overflowRight: round(Math.max(0, box.right - paneBox.right)),
        })
      }
    }

    // Only worth computing when there is something to explain. An element
    // under a scroll container is allowed past the edge — that containment is
    // the fix, not the bug — so anything with a non-visible `overflow-x`
    // ancestor is dropped. What is left is what reached the page body.
    const viewport = document.documentElement.clientWidth
    const culprits: { label: string; right: number }[] = []
    if (document.body.scrollWidth > viewport || document.documentElement.scrollWidth > viewport) {
      for (const el of document.querySelectorAll<HTMLElement>('main *')) {
        const box = el.getBoundingClientRect()
        if (box.width === 0 || box.right <= viewport + 0.5) continue
        let contained = false
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') contained = true
        }
        if (contained) continue
        const cls = el.getAttribute('class')?.split(/\s+/).slice(0, 4).join('.') ?? ''
        culprits.push({
          label: `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> reaches ${round(box.right)}px`,
          right: box.right,
        })
      }
      // Widest first: the element whose right edge *is* the body's scroll width
      // is the one that set it, and everything else is riding along.
      culprits.sort((a, b) => b.right - a.right)
    }

    return {
      bodyScrollWidth: round(document.body.scrollWidth),
      docScrollWidth: round(document.documentElement.scrollWidth),
      viewportWidth: document.documentElement.clientWidth,
      elementCount: document.querySelectorAll('main *').length,
      culprits: culprits.slice(0, 3).map((c) => c.label),
      spineRows: spineRows.size,
      spineCells: spineCells.length,
      findingTitles,
      needsYou,
    }
  })
}

/**
 * The rules. Each returns `null` when the measurement satisfies it and a
 * sentence naming the breach when it does not. They are written once and used
 * twice: by the tests below, and by the `test.fixme` that re-asserts them on
 * the combinations a known defect currently owns.
 */
const CHECKS: Record<InvariantId, (m: Measurement) => string | null> = {
  /**
   * The invariant the whole sweep exists for. A page that scrolls sideways is
   * a layout that never decided what yields; there is no state of this app in
   * which it is correct.
   */
  'no-sideways-scroll': (m) =>
    Math.max(m.bodyScrollWidth, m.docScrollWidth) > m.viewportWidth
      ? `body ${m.bodyScrollWidth}px in a ${m.viewportWidth}px viewport; pushed by ${
          m.culprits.join(', ') || 'an element the culprit walk could not attribute'
        }`
      : null,

  /**
   * #295: a wrapped sequence is not a sequence. The spine is nowrap and crops,
   * so its cells occupy one row at every width or the fix has regressed. This
   * is the rule the retired `rows.size <= 2` in `smoke.spec.ts` refused to
   * state.
   */
  'one-row-spine': (m) =>
    m.spineCells > 0 && m.spineRows !== 1 ? `${m.spineCells} cells across ${m.spineRows} rows` : null,

  /**
   * #296: the title was the only shrinkable item in a row of `shrink-0`
   * metadata, so it absorbed every pixel of pressure and rendered one word per
   * line beside empty row space. The rule is a floor — 24ch, or the card's own
   * width where that is narrower — under which the words never go.
   */
  'finding-title-floor': (m) => {
    const squeezed = m.findingTitles.filter((t) => t.width < t.floor - 1)
    return squeezed.length === 0
      ? null
      : squeezed.map((t) => `${t.id} is ${t.width}px against a ${t.floor}px floor`).join('; ')
  },

  /**
   * #297: the mark saying a run wants a human was the last column of a table
   * wider than its pane, so the one fact the page exists to surface was the
   * first thing clipped — and clipped silently. It leads the row now; this is
   * the assertion that it stays inside the pane.
   */
  'needs-you-visible': (m) => {
    const clipped = m.needsYou.filter((n) => n.overflowLeft > 0.5 || n.overflowRight > 0.5)
    return clipped.length === 0
      ? null
      : clipped.map((n) => `${n.slug} clipped by ${n.overflowLeft || n.overflowRight}px`).join('; ')
  },
}

/** The declarations, if any, that own this combination. */
function declaredBroken(state: string, width: number, invariant: InvariantId): KnownBroken[] {
  return (STATES.find((s) => s.name === state)?.broken ?? []).filter(
    (b) => b.invariant === invariant && b.widths.includes(width),
  )
}

/** Every breach of one rule that no declaration owns. */
function sweep(invariant: InvariantId): string[] {
  const failures: string[] = []
  for (const m of measurements) {
    const problem = CHECKS[invariant](m)
    if (problem === null || declaredBroken(m.state, m.width, invariant).length > 0) continue
    failures.push(`${m.state} @ ${m.width}px — ${problem}`)
  }
  return failures
}

test('no state scrolls the page sideways at any width', () => {
  expect(measurements.length).toBe(STATES.length * WIDTHS.length)
  // An empty page overflows nothing, so prove every state rendered before
  // trusting anything it says about width. The first draft of this file gated
  // on the spine and measured the run page before its artifact arrived; it
  // reported no overflow on states that overflow by 200px.
  const empty = measurements.filter((m) => m.elementCount < 40).map((m) => `${m.state} @ ${m.width}px`)
  expect(empty, `states that rendered almost nothing:\n${empty.join('\n')}`).toEqual([])

  const failures = sweep('no-sideways-scroll')
  expect(failures, `states whose page body overflows its viewport:\n${failures.join('\n')}`).toEqual([])
})

test('the phase spine occupies exactly one row at every width', () => {
  expect(measurements.filter((m) => m.spineCells > 0).length).toBeGreaterThan(40)
  const failures = sweep('one-row-spine')
  expect(failures, `spines that wrapped:\n${failures.join('\n')}`).toEqual([])
})

test('no finding title is squeezed below its width floor', () => {
  expect(measurements.flatMap((m) => m.findingTitles).length).toBeGreaterThan(20)
  const failures = sweep('finding-title-floor')
  expect(failures, `finding titles below their floor:\n${failures.join('\n')}`).toEqual([])
})

test("the portfolio's needs-you mark is inside the visible pane at every width", () => {
  expect(measurements.filter((m) => m.state === 'portfolio').flatMap((m) => m.needsYou).length).toBeGreaterThan(20)
  const failures = sweep('needs-you-visible')
  expect(failures, `needs-you marks outside the pane:\n${failures.join('\n')}`).toEqual([])
})

/**
 * The debt, asserted rather than assumed.
 *
 * Every combination the table above declares broken is re-checked here under
 * the same rule. It is `fixme` because it fails today; drop the annotation once
 * #308 and #281 are both closed, and this becomes the proof that they are.
 * Keeping the excluded set inside a test — rather than as a quiet `continue` —
 * is what stops it growing without anyone noticing.
 */
test.fixme('the states #281 and #308 own hold their invariants too', () => {
  const declared = measurements.flatMap((m) =>
    (Object.keys(CHECKS) as InvariantId[])
      .filter((id) => declaredBroken(m.state, m.width, id).length > 0)
      .map((id) => ({ m, id })),
  )
  expect(declared.length).toBeGreaterThan(0)
  const failures = declared
    .map(({ m, id }) => {
      const problem = CHECKS[id](m)
      if (problem === null) return null
      const owners = declaredBroken(m.state, m.width, id)
        .map((o) => `#${o.issue} — ${o.why}`)
        .join('\n    ')
      return `${m.state} @ ${m.width}px — ${problem}\n    ${owners}`
    })
    .filter((f): f is string => f !== null)
  expect(failures, `declared-broken states still breaching:\n${failures.join('\n')}`).toEqual([])
})
