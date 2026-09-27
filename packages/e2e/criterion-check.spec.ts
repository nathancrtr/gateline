// A criterion's check on a line of its own (criterion-check R3–R6, R8).
//
// The static markup tests in packages/web/test prove each view wraps the
// check in an element of its own. Only a browser lays out, so only a browser
// can say that element starts a new line, and that at a phone width the
// check's last word stays inside the card or pane that holds it. This file
// measures both at 320px and 1280px in the three views that show a check —
// the G2 card, the lexicon hover card and the Record reader on spec.md — and
// reads the cited-ids list, which quotes a checked criterion's promise alone.
//
// The spec's words are read from the fixture repository the server is
// serving, never copied into this file, so each quotation assertion compares
// the page with the spec itself.
//
// Screenshots: one per view × criterion shape × width, saved into this test's
// output folder as `<view>-<shape>-<width>.png` for the verifier to attach.
// No baseline is committed and nothing here compares pixels (criterion-check
// plan ADR-6; geometry.spec.ts says why). Each is taken before any assertion
// about the check, and finds its view through markup that predates the
// check, so a pre-change web build still yields every capture the verifier
// compares against.
import { type ChildProcess, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { type ElementHandle, expect, type Page, type TestInfo, test } from '@playwright/test'
import { spawnDemoServer } from './demo-server.ts'

/** The run awaiting G2. Its AC1.1 has a check; its AC2.1 has none. */
const SLUG = 'g2-pending'
const CHECKED = 'AC1.1'
const PLAIN = 'AC2.1'
const WIDTHS = [320, 1280] as const

let fixtureDir: string
let server: ChildProcess
let ORIGIN: string
let spec: string

const sourceId = () => fixtureDir.replace(/\/+$/, '').split('/').pop()!
const goto = (page: Page, query = '') => page.goto(`${ORIGIN}/runs/${sourceId()}/${SLUG}${query}`)
/** Each run of whitespace to one space, and none at either end. */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  ;({ server, origin: ORIGIN } = await spawnDemoServer(fixtureDir))
  spec = execFileSync('git', ['-C', fixtureDir, 'show', `run/${SLUG}:runs/${SLUG}/spec.md`], { encoding: 'utf8' })
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// The spec, as the fixture repository holds it.

/** A criterion's item in the spec: the text after its `- [ ] AC<n>.<m> — ` marker, then each indented line under it. */
function criterionLines(id: string): string[] {
  const lines = spec.split('\n')
  const marker = `- [ ] ${id} — `
  const at = lines.findIndex((l) => l.startsWith(marker))
  expect(at, `${id} is in ${SLUG}'s spec`).toBeGreaterThanOrEqual(0)
  const out = [lines[at]!.slice(marker.length)]
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]!); i++) out.push(lines[i]!)
  return out
}

const isCheckLine = (l: string, i: number) => i > 0 && l.trim().startsWith('Check:')

/** The spec's words for a criterion, whitespace collapsed. */
const criterionText = (id: string) => collapse(criterionLines(id).join(' '))

/** The spec's words before a criterion's `Check:` line, whitespace collapsed. */
function promiseText(id: string): string {
  const lines = criterionLines(id)
  const check = lines.findIndex(isCheckLine)
  return collapse(lines.slice(0, check === -1 ? undefined : check).join(' '))
}

test('the fixture offers both criterion shapes (the premise every other test rests on)', () => {
  expect(criterionLines(CHECKED).some(isCheckLine), `${CHECKED} has a check line`).toBe(true)
  expect(criterionLines(PLAIN).some(isCheckLine), `${PLAIN} has no check line`).toBe(false)
})

// ---------------------------------------------------------------------------
// Measurement. Every rect below is a text line box: the client rects of each
// non-blank text node. An element's own box is never used for text, because a
// block is as wide as its parent whatever its words do, and a paragraph's box
// includes margins no line occupies.

/**
 * Where the promise's last line box ends and the check's first begins. The
 * promise is every text inside `holder` that precedes `check` in the document.
 */
function placement(holder: ElementHandle<Element>, check: ElementHandle<Element>) {
  return holder.evaluate((root, el) => {
    const boxes = (from: Node, keep: (t: Node) => boolean) => {
      const out: DOMRect[] = []
      const walker = document.createTreeWalker(from, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n as Text).data.trim() || !keep(n)) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(r)
      }
      return out
    }
    const precedes = (t: Node) => !el.contains(t) && (el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    const promise = boxes(root, precedes)
    const check = boxes(el, () => true)
    return {
      promiseLines: promise.length,
      checkLines: check.length,
      promiseBottom: Math.max(...promise.map((r) => r.bottom)),
      checkTop: Math.min(...check.map((r) => r.top)),
    }
  }, check)
}

/** How far any text inside `inner` paints past the right edge of `container`, in px; 0 or less is inside. */
function overrun(inner: ElementHandle<Element>, container: ElementHandle<Element>) {
  return container.evaluate((box, el) => {
    let right = Number.NEGATIVE_INFINITY
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n as Text).data.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 0) right = Math.max(right, r.right)
    }
    return right - box.getBoundingClientRect().right
  }, inner)
}

/**
 * How far any text line of `inner` lies outside what an element between it
 * and `container` lets show, in px; 0 or less is all shown. Text keeps its
 * line boxes when an ancestor with a height cap and hidden overflow cuts it
 * off, so the measures above would still find a clipped check in place. This
 * walks from `inner` itself up to `container`, and on each axis an element
 * does not leave visible, requires every line box inside its padding box.
 */
function clipped(inner: ElementHandle<Element>, container: ElementHandle<Element>) {
  return container.evaluate((stop, el) => {
    const lines: DOMRect[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n as Text).data.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) lines.push(r)
    }
    let worst = Number.NEGATIVE_INFINITY
    for (let a: Element | null = el; a; a = a === stop ? null : a.parentElement) {
      const style = getComputedStyle(a)
      const clipsX = style.overflowX !== 'visible'
      const clipsY = style.overflowY !== 'visible'
      if (!clipsX && !clipsY) continue
      const b = a.getBoundingClientRect()
      const x0 = b.left + a.clientLeft
      const y0 = b.top + a.clientTop
      for (const r of lines) {
        if (clipsX) worst = Math.max(worst, x0 - r.left, r.right - (x0 + a.clientWidth))
        if (clipsY) worst = Math.max(worst, y0 - r.top, r.bottom - (y0 + a.clientHeight))
      }
    }
    return worst
  }, inner)
}

/** The Record reader's pane: the nearest ancestor that clips sideways (#281). */
async function paneOf(el: ElementHandle<Element>): Promise<ElementHandle<Element>> {
  const pane = await el.evaluateHandle((node) => {
    let p = node.parentElement
    while (p && getComputedStyle(p).overflowX === 'visible') p = p.parentElement
    return p ?? document.documentElement
  })
  return pane as ElementHandle<Element>
}

/**
 * Save `<name>.png`: the page around `focus`, spanning `container` and the
 * furthest line of `focus`'s text plus a margin on each side, so a word
 * running past the container's edge, or past the viewport's, is in the picture
 * rather than cut away with it. `settle` runs after the scroll that brings
 * `focus` into view, for a view the scroll can disturb.
 */
async function capture(page: Page, testInfo: TestInfo, name: string, container: ElementHandle<Element>, focus: ElementHandle<Element>, settle?: () => Promise<void>) {
  await focus.scrollIntoViewIfNeeded()
  await settle?.()
  const c = (await container.boundingBox())!
  const f = (await focus.boundingBox())!
  const textRight = f.x + f.width + Math.max(0, await overrun(focus, focus))
  // The clip is in page coordinates once the capture may reach past the viewport.
  const page_ = await page.evaluate(() => ({
    sx: window.scrollX,
    sy: window.scrollY,
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))
  const pad = 12
  const x = Math.max(0, Math.min(c.x, f.x) - pad + page_.sx)
  const y = Math.max(0, f.y - pad + page_.sy)
  const right = Math.min(page_.width, Math.max(c.x + c.width, textRight) + pad + page_.sx)
  const bottom = Math.min(page_.height, f.y + f.height + pad + page_.sy)
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, clip: { x, y, width: right - x, height: bottom - y } })
}

/** The shared assertions on a view's checked criterion: placement (AC3.1/4.1/5.1) and containment (AC8.4). */
async function expectCheckPlaced(holder: ElementHandle<Element>, check: ElementHandle<Element>, container: ElementHandle<Element>, where: string) {
  expect(collapse((await check.textContent()) ?? ''), `${where}: the check opens with its label`).toMatch(/^Check:/)
  const p = await placement(holder, check)
  expect(p.promiseLines, `${where}: the promise has text before the check`).toBeGreaterThan(0)
  expect(p.checkLines, `${where}: the check has text`).toBeGreaterThan(0)
  expect(p.checkTop, `${where}: the check's first line starts below the promise's last`).toBeGreaterThanOrEqual(p.promiseBottom - 0.5)
  // The geometry alone cannot tell a check that starts a line from one the
  // promise happened to wrap in front of, which at 320px is where the fixture's
  // promise ends. A block is what makes the new line hold for any promise.
  expect(await check.evaluate((el) => getComputedStyle(el).display), `${where}: the check is laid out as a block`).toBe('block')
  expect(await overrun(check, container), `${where}: the check's last word stays inside its container`).toBeLessThanOrEqual(0.5)
  // Placed is not shown: a check cut off by a height cap, or hidden, keeps
  // every line box measured above.
  expect(await check.evaluate((el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })), `${where}: the check is visible`).toBe(true)
  expect(await clipped(check, container), `${where}: no element between the check and its container cuts any of its lines off`).toBeLessThanOrEqual(0.5)
}

// ---------------------------------------------------------------------------
// The three views, at each width.

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test(`G2 card: ${CHECKED}'s check starts a line of its own and fits the card (AC3.1, AC3.2, AC8.4)`, async ({ page }, testInfo) => {
      await goto(page)
      const card = page.locator(`[data-g2-packet] [data-criterion="${CHECKED}"]`)
      await expect(card).toBeVisible()
      const cardEl = (await card.elementHandle())!
      await capture(page, testInfo, `g2-check-${width}`, cardEl, cardEl)

      const quote = card.locator('[data-criterion-quote]')
      const check = quote.locator('[data-criterion-check]')
      await expect(check).toHaveCount(1)
      expect(collapse((await quote.textContent()) ?? ''), 'AC3.2: the quotation is the spec\'s words').toBe(criterionText(CHECKED))
      await expectCheckPlaced((await quote.elementHandle())!, (await check.elementHandle())!, cardEl, `G2 card at ${width}px`)
    })

    test(`G2 card: ${PLAIN} reads within the card (control for AC8.4; AC3.3 capture)`, async ({ page }, testInfo) => {
      await goto(page)
      const card = page.locator(`[data-g2-packet] [data-criterion="${PLAIN}"]`)
      await expect(card).toBeVisible()
      const cardEl = (await card.elementHandle())!
      await capture(page, testInfo, `g2-plain-${width}`, cardEl, cardEl)
      // The row that quotes the criterion; the evidence below it is not this run's.
      const row = (await card.locator(':scope > div').first().elementHandle())!
      expect(await overrun(row, cardEl), `G2 card at ${width}px: ${PLAIN}'s quotation stays inside its card`).toBeLessThanOrEqual(0.5)
    })

    test(`hover card: ${CHECKED}'s check starts a line of its own and fits the card (AC4.1, AC4.2, AC8.4)`, async ({ page }, testInfo) => {
      await goto(page, '?tab=record&artifact=verification-report.md')
      const ref = page.locator('.prose-artifact .lex-ref', { hasText: CHECKED }).first()
      await ref.hover()
      const card = ref.locator('.lex-card')
      await expect(card).toBeVisible()
      const cardEl = (await card.elementHandle())!
      // Scrolling to take the picture can move the reference from under the
      // mouse, which closes the card: reopen it before the picture and after.
      const reopen = async () => {
        await ref.hover()
        await expect(card).toBeVisible()
      }
      await capture(page, testInfo, `hover-check-${width}`, cardEl, cardEl, reopen)
      await reopen()

      const quote = card.locator('[data-criterion-quote]')
      const check = quote.locator('[data-criterion-check]')
      await expect(check).toHaveCount(1)
      expect(collapse((await quote.textContent()) ?? ''), 'AC4.2: the quotation is the spec\'s words').toBe(criterionText(CHECKED))
      await expectCheckPlaced((await quote.elementHandle())!, (await check.elementHandle())!, cardEl, `hover card at ${width}px`)
    })

    test(`hover card: ${PLAIN} reads within the card (control for AC8.4; AC4.3 capture)`, async ({ page }, testInfo) => {
      await goto(page, '?tab=record&artifact=verification-report.md')
      const ref = page.locator('.prose-artifact .lex-ref', { hasText: PLAIN }).first()
      await ref.hover()
      const card = ref.locator('.lex-card')
      await expect(card).toBeVisible()
      const cardEl = (await card.elementHandle())!
      // Scrolling to take the picture can move the reference from under the
      // mouse, which closes the card: reopen it before the picture and after.
      const reopen = async () => {
        await ref.hover()
        await expect(card).toBeVisible()
      }
      await capture(page, testInfo, `hover-plain-${width}`, cardEl, cardEl, reopen)
      await reopen()
      const def = (await card.locator('.lex-card-def').elementHandle())!
      expect(await overrun(def, cardEl), `hover card at ${width}px: ${PLAIN}'s quotation stays inside its card`).toBeLessThanOrEqual(0.5)
    })

    test(`Record reader: ${CHECKED}'s check starts a line of its own and fits the pane (AC5.1, AC8.4)`, async ({ page }, testInfo) => {
      await goto(page, '?tab=record&artifact=spec.md')
      const item = page.locator('[data-reader] .prose-artifact li', { hasText: `${CHECKED} —` })
      await expect(item).toBeVisible()
      const itemEl = (await item.elementHandle())!
      const pane = await paneOf(itemEl)
      await capture(page, testInfo, `reader-check-${width}`, pane, itemEl)

      const check = item.locator('[data-criterion-check]')
      await expect(check).toHaveCount(1)
      await expectCheckPlaced(itemEl, (await check.elementHandle())!, pane, `Record reader at ${width}px`)
    })

    test(`Record reader: ${PLAIN} reads within the pane (control for AC8.4)`, async ({ page }, testInfo) => {
      await goto(page, '?tab=record&artifact=spec.md')
      const item = page.locator('[data-reader] .prose-artifact li', { hasText: `${PLAIN} —` })
      await expect(item).toBeVisible()
      const itemEl = (await item.elementHandle())!
      const pane = await paneOf(itemEl)
      await capture(page, testInfo, `reader-plain-${width}`, pane, itemEl)
      expect(await overrun(itemEl, pane), `Record reader at ${width}px: ${PLAIN} stays inside the pane`).toBeLessThanOrEqual(0.5)
    })

    test(`the Record reader and the G2 card split ${CHECKED} at the same line (plan ADR-2)`, async ({ page }) => {
      // Two rules find the check: the lexicon's, which the card reads, and the
      // reader's render step. Drift between them shows here.
      await goto(page, '?tab=record&artifact=spec.md')
      const readerCheck = page.locator('[data-reader] .prose-artifact li', { hasText: `${CHECKED} —` }).locator('[data-criterion-check]')
      await expect(readerCheck).toHaveCount(1)
      const inReader = collapse((await readerCheck.textContent()) ?? '')

      await goto(page)
      const cardCheck = page.locator(`[data-g2-packet] [data-criterion="${CHECKED}"] [data-criterion-check]`)
      await expect(cardCheck).toHaveCount(1)
      expect(inReader).toBe(collapse((await cardCheck.textContent()) ?? ''))
    })
  })
}

// ---------------------------------------------------------------------------
// At the width the rest of the suite pins.

test.describe('1280px only', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
  })

  test('cited-ids list: a checked criterion quotes its promise alone, an unchecked one its full text (AC6.1, AC6.2)', async ({ page }) => {
    await goto(page, '?tab=record&artifact=verification-report.md')
    const list = page.locator('.lex-cited')
    await list.locator('summary').click()
    const entry = (id: string) => list.locator('li').filter({ has: page.getByText(id, { exact: true }) })

    const checked = entry(CHECKED)
    await expect(checked).toHaveCount(1)
    expect(await checked.textContent(), 'AC6.1: no part of the check').not.toContain('Check:')
    expect(collapse((await checked.locator('.truncate').textContent()) ?? '')).toBe(promiseText(CHECKED))

    const plain = entry(PLAIN)
    await expect(plain).toHaveCount(1)
    expect(collapse((await plain.locator('.truncate').textContent()) ?? ''), 'AC6.2: the full text, as before').toBe(criterionText(PLAIN))
  })

  test('the demo run awaiting G2 shows one criterion with a check and one without (AC8.1)', async ({ page }) => {
    await goto(page)
    const packet = page.locator('[data-g2-packet]')
    await expect(packet.locator(`[data-criterion="${CHECKED}"] [data-criterion-check]`)).toHaveCount(1)
    await expect(packet.locator(`[data-criterion="${PLAIN}"]`)).toBeVisible()
    await expect(packet.locator(`[data-criterion="${PLAIN}"] [data-criterion-check]`)).toHaveCount(0)
  })
})
