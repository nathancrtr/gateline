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
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { type Browser, expect, type Page, test } from '@playwright/test'
import { spawnDemoServer } from './demo-server.ts'

// The page is built with `browser.newPage()` rather than taken from the `page`
// fixture — one context for the whole file — so it carries no `baseURL` and
// navigates absolutely. The server binds an OS-assigned port (demo-server.ts,
// #438), set once `beforeAll` resolves it, so a concurrent worktree's server
// on some other port is never the one this file measures.
let ORIGIN: string

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

type InvariantId =
  | 'no-sideways-scroll'
  | 'one-row-spine'
  | 'finding-title-floor'
  | 'needs-you-visible'
  | 'idle-card-collapsed'
  | 'inbox-rows-contained'

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
 * The table is empty, and that is the finding.
 *
 * This file shipped declaring 17 broken combinations against two causes, and
 * both are now closed — so every declaration was re-measured and removed rather
 * than left standing. What they were, because the attribution is the part worth
 * keeping:
 *
 * **#308 — the idle lexicon hover card**, which owned 16 of the 17. `.lex-card`
 * was `invisible absolute left-0 top-full w-[26rem]`, and `visibility: hidden`
 * still takes part in layout (`display: none` does not). Every R/AC/ADR
 * reference hung a 416px box off its own left edge, and a reference right of
 * centre pushed the page body while showing nothing. The tell was a *constant*
 * measurement rather than a viewport-dependent one: the number was set by the
 * rightmost reference, so it read the same at 800, 900 and 1000px. The idle card
 * is `display: none` now.
 *
 * **#281 — the Record pane** owned the other one: with the card suppressed,
 * `verification-report.md` at 800px still measured 813px, a markdown table
 * escaping a reader that never decided what yields. Stacking the picker and
 * making the reader its own `overflow-x` container closed it.
 *
 * These declarations were written before #281's fix landed, and re-running them
 * after it showed 15 of the 16 #308 combinations already passing — not because
 * the card had stopped being laid out, but because the reader pane now contains
 * it. That containment is what `idle-card-collapsed` below exists for: on the
 * Record tab a returning #308 would no longer reach the page body, so the
 * sideways-scroll rule would never see it again.
 */

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

  { name: 'g2-pending · decide', path: (s) => `/runs/${s}/g2-pending?decide=G2`, ready: '[data-needs-card]' },
  { name: 'g2-pending · history', path: (s) => `/runs/${s}/g2-pending?tab=history`, ready: '[data-spine]' },

  { name: 'g3-pending · decide', path: (s) => `/runs/${s}/g3-pending?decide=G3`, ready: '[data-needs-card]' },

  { name: 'escalated', path: (s) => `/runs/${s}/escalated`, ready: '[data-spine]' },
  { name: 'round-cap', path: (s) => `/runs/${s}/round-cap`, ready: '[data-spine]' },
  { name: 'paused-budget', path: (s) => `/runs/${s}/paused-budget`, ready: '[data-spine]' },
  { name: 'closed-delivered', path: (s) => `/runs/${s}/closed-delivered`, ready: '[data-spine]' },
  { name: 'done-merged', path: (s) => `/runs/${s}/done-merged`, ready: '[data-spine]' },
  { name: 'patch-g1-pending', path: (s) => `/runs/${s}/patch-g1-pending?decide=G1`, ready: '[data-spine]' },
  { name: 'patch-g2-pending', path: (s) => `/runs/${s}/patch-g2-pending`, ready: '[data-spine]' },
  { name: 'forked-contract', path: (s) => `/runs/${s}/forked-contract`, ready: '[data-spine]' },
  { name: 'malformed-spec · bounce', path: (s) => `/runs/${s}/malformed-spec?decide=G0`, ready: '[data-needs-card]' },
  { name: 'staged · arm', path: (s) => `/runs/${s}/staged?decide=staged`, ready: '[data-staged-brief]' },
  { name: 'malformed-release · bounce', path: (s) => `/runs/${s}/malformed-release?decide=G3`, ready: '[data-needs-card]' },
  { name: 'bad-state', path: (s) => `/runs/${s}/bad-state`, ready: 'main' },

  // The record's reader, artifact by artifact: what the pane does with its
  // width is a property of what is in it, and a markdown table, a fenced
  // command and a YAML dump are three different pressures. Pinned with
  // `?artifact=` rather than left to the landing rule, so the sweep cannot
  // quietly stop covering the wide ones when that rule changes.
  //
  // The first four carry R/AC/ADR references and were where #308 reproduced;
  // `verification-report.md` is also the markdown table #281 was filed on. Kept
  // named and separate now that both are closed, because they are the artifacts
  // that put the most pressure on the reader.
  ...recordStates('g2-pending', ['verification-report.md']),
  ...recordStates('g2-pending', ['plan.md']),
  ...recordStates('round-cap', ['review-01.md', 'review-02.md']),
  ...recordStates('g1-pending', ['plan.md']),
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
  /** Lexicon hover cards on the page. The sweep hovers and focuses nothing, so
   *  every one of them is idle, and `laidOut` is how many still have a box. */
  lexCards: { total: number; laidOut: number }
  /** Inbox rows whose text cell paints past its own box (#280): the slug that
   *  ran across the time column. `over` is how far, in px. */
  inboxRows: { slug: string; over: number }[]
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
  ;({ server, origin: ORIGIN } = await spawnDemoServer(fixtureDir))

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

    // Idle hover cards (#308). Asked of the box rather than of `display`, so
    // the rule survives the fix being written another way — a zero-size
    // wrapper, `content-visibility`, anything: what must be true is that an
    // unrevealed card occupies no space, not that one particular property has
    // one particular value.
    const cards = [...document.querySelectorAll<HTMLElement>('.lex-card')]
    const lexCards = {
      total: cards.length,
      laidOut: cards.filter((c) => {
        const box = c.getBoundingClientRect()
        return box.width > 0 || box.height > 0
      }).length,
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

    // Inbox rows (#280). The text cell is `min-width: 0` inside its grid
    // column, and each line in it truncates; the rule is that nothing inside
    // it reaches past its own right edge, where the time column begins. Asked
    // of the cell's descendants rather than of `overflow`, so it survives the
    // fix being written another way — a `text-overflow`, a `contain`, an
    // `overflow: hidden` on the cell would all satisfy it.
    const inboxRows = [...document.querySelectorAll<HTMLElement>('[data-inbox-row]')].map((row) => {
      const cell = row.querySelector<HTMLElement>('[data-inbox-text]')
      const cellBox = cell?.getBoundingClientRect()
      let over = 0
      if (cell && cellBox) {
        for (const el of cell.querySelectorAll<HTMLElement>('*')) {
          const box = el.getBoundingClientRect()
          if (box.width > 0) over = Math.max(over, box.right - cellBox.right)
        }
      }
      return { slug: cell?.querySelector('.font-mono')?.textContent ?? '?', over: round(over) }
    })

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
      lexCards,
      inboxRows,
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

  /**
   * #308: a hidden thing that is still laid out is a phantom. The idle lexicon
   * card was `visibility: hidden`, so 416px of it sat beside every reference,
   * pushing page width and poisoning every `scrollWidth` above it.
   *
   * Stated separately rather than left to `no-sideways-scroll`, because that
   * rule can no longer see this defect where it started: the Record reader is
   * an `overflow-x` container since #281, so a card returning to layout inside
   * it would widen the reader's scroll extent — a cue with nothing to scroll
   * to — without ever reaching the page body. The sideways rule caught 16
   * combinations before #281's fix and would catch two after it.
   */
  'idle-card-collapsed': (m) =>
    m.lexCards.laidOut > 0
      ? `${m.lexCards.laidOut} of ${m.lexCards.total} idle .lex-card boxes still occupy layout`
      : null,

  /**
   * #280: the run slug was the one `shrink-0` item in a cell whose title
   * truncated, so at 800px it wrapped to its own line and ran straight across
   * the time column, text over the clock chip. Title and slug follow one
   * overflow rule now; this is the assertion that the cell keeps its contents.
   */
  'inbox-rows-contained': (m) => {
    const spilled = m.inboxRows.filter((r) => r.over > 0.5)
    return spilled.length === 0 ? null : spilled.map((r) => `${r.slug} paints ${r.over}px past its cell`).join('; ')
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

test('no idle lexicon hover card occupies layout at any width', () => {
  // Non-vacuity: if the fixture ever stops citing ids, this rule quietly stops
  // testing anything, and the defect it guards is exactly the kind that comes
  // back in a refactor.
  const cards = measurements.reduce((n, m) => n + m.lexCards.total, 0)
  expect(cards, 'no .lex-card rendered anywhere in the sweep').toBeGreaterThan(100)
  const failures = sweep('idle-card-collapsed')
  expect(failures, `idle hover cards still laid out:\n${failures.join('\n')}`).toEqual([])
})

test('no inbox row paints its text past its own cell at any width', () => {
  expect(measurements.filter((m) => m.state === 'inbox').flatMap((m) => m.inboxRows).length).toBeGreaterThan(20)
  const failures = sweep('inbox-rows-contained')
  expect(failures, `inbox rows whose text reaches into the time column:\n${failures.join('\n')}`).toEqual([])
})

// The `test.fixme` that used to close this file is gone, and so is everything it
// re-asserted. It existed to hold #281 and #308 declared-but-unfixed; both are
// closed, the `broken` table above is empty, and all six rules now run against
// every state at every width with nothing excluded. The mechanism stays —
// `KnownBroken`, `declaredBroken`, the `broken` field — because the next defect
// found this way should be declared in the table with an owner rather than
// absorbed into a weakened assertion. Re-add the fixme alongside the first entry
// that needs it.
