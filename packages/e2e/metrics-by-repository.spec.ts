// The Metrics gate table over several repositories in a browser (#499;
// docs/MULTI-REPO.md §9.4, decision P11), against the two-repository demo
// and the one-repository form.
//
// The demo's own gate decisions, all approvals: `demo` has 10 at G0, 8 at
// G1, 3 at G2 and 1 at G3; `demo-small` has 3 at G0, 2 at G1 and 1 at G2.
// So demo's G0 and G1 are rated at 100% and flagged, every demo-small row is
// too few to rate, and the pooled totals (13 at G0, 10 at G1) carry no flag.
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { type DemoSet, generateDemoSet } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { DEMO_ID, DEMO_SMALL_ID, spawnDemoServer } from './demo-server.ts'

let demo: DemoSet
let single: DemoSet
let server: ChildProcess
let singleServer: ChildProcess
let ORIGIN: string
let SINGLE: string

test.beforeAll(async () => {
  demo = generateDemoSet()
  single = generateDemoSet({ single: true })
  ;({ server, origin: ORIGIN } = await spawnDemoServer(demo.repos.map((r) => r.dir)))
  ;({ server: singleServer, origin: SINGLE } = await spawnDemoServer(single.repos[0]!.dir))
})

test.afterAll(() => {
  server?.kill()
  singleServer?.kill()
  if (demo) rmSync(demo.root, { recursive: true, force: true })
  if (single) rmSync(single.root, { recursive: true, force: true })
})

const gateRows = (page: Page) => page.locator('tr[data-gate-row]')
/** Each gate row as [gate, repository id or 'total' or '', its cells' text joined by spaces, whitespace collapsed]. */
const readRows = (page: Page) =>
  gateRows(page).evaluateAll((rows) =>
    rows.map((r) => [
      r.getAttribute('data-gate-row'),
      r.hasAttribute('data-gate-total') ? 'total' : (r.getAttribute('data-gate-repository') ?? ''),
      [...r.children]
        .map((cell) => cell.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ]),
  )

test('with no scope, each gate shows its total and then each repository, the flag only on a repository', async ({ page }) => {
  await page.goto(`${ORIGIN}/metrics`)
  await expect(page.locator('tbody[data-gate-group]')).toHaveCount(4)
  const g0 = (await readRows(page)).filter(([gate]) => gate === 'G0')
  expect(g0).toEqual([
    ['G0', 'total', 'G0 all repositories 13 100% 1m'],
    ['G0', DEMO_ID, 'G0, demo 10 100% over-triggering? 1m'],
    ['G0', DEMO_SMALL_ID, 'G0, demo-small 3 3 of 3 approved too few to rate confirmation: 3 1m'],
  ])
  // The total is over the line and carries no flag; the repository's row does.
  const group = page.locator('tbody[data-gate-group="G0"]')
  await expect(group.locator('tr[data-gate-total] .imp', { hasText: 'over-triggering?' })).toHaveCount(0)
  await expect(group.locator(`tr[data-gate-repository="${DEMO_ID}"]`)).toContainText('over-triggering?')
  // A repository is named by its display name, its id on hover.
  await expect(group.locator(`tr[data-gate-repository="${DEMO_SMALL_ID}"] [data-repository-name]`)).toHaveAttribute('title', DEMO_SMALL_ID)
  await expect(page.locator('[data-gate-scope]')).toHaveCount(0)
})

test('under a scope, the gate table is that repository’s own figures', async ({ page }) => {
  await page.goto(`${ORIGIN}/metrics?repo=${encodeURIComponent(DEMO_SMALL_ID)}`)
  await expect(page.locator('[data-scope-heading]')).toContainText('demo-small')
  expect(await readRows(page)).toEqual([
    ['G0', '', 'G0 3 3 of 3 approved too few to rate confirmation: 3 1m'],
    ['G1', '', 'G1 2 2 of 2 approved too few to rate confirmation: 2 1m'],
    ['G2', '', 'G2 1 1 of 1 approved too few to rate light correction: 1 1m'],
    ['G3', '', 'G3 — no decisions — —'],
  ])
  await expect(page.locator('tbody[data-gate-group]')).toHaveCount(0)
  await expect(page.getByText('over-triggering?')).toHaveCount(0)

  await page.goto(`${ORIGIN}/metrics?repo=${encodeURIComponent(DEMO_ID)}`)
  const rows = await readRows(page)
  expect(rows.map(([gate, , text]) => [gate, text])).toEqual([
    ['G0', 'G0 10 100% over-triggering? 1m'],
    ['G1', 'G1 8 100% over-triggering? 1m'],
    ['G2', 'G2 3 3 of 3 approved too few to rate confirmation: 2 light correction: 1 1m'],
    // The release plan was committed after G3 was decided, so no latency is known.
    ['G3', 'G3 1 1 of 1 approved too few to rate confirmation: 1 —'],
  ])
})

test('a one-repository set shows one row per gate, the flag on the total', async ({ page }) => {
  await page.goto(`${SINGLE}/metrics`)
  await expect(page.locator('main h1')).toHaveText('Metrics')
  expect((await readRows(page)).map(([gate, where]) => [gate, where])).toEqual([
    ['G0', ''],
    ['G1', ''],
    ['G2', ''],
    ['G3', ''],
  ])
  await expect(gateRows(page).first()).toContainText('over-triggering?')
  await expect(page.locator('table [data-repository-name]')).toHaveCount(0)
})

test('at 1400px the grouped table fits without scrolling sideways', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  try {
    await page.goto(`${ORIGIN}/metrics`)
    await expect(page.locator('tbody[data-gate-group]')).toHaveCount(4)
    const table = page.locator('section', { hasText: 'Gate decisions' }).locator('div.overflow-x-auto')
    expect(await table.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0)
  } finally {
    await page.close()
  }
})

for (const width of [1400, 800, 390]) {
  test(`at ${width}px the Metrics page never scrolls sideways, scoped or not`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    try {
      for (const path of ['/metrics', `/metrics?repo=${encodeURIComponent(DEMO_SMALL_ID)}`, `/metrics?repo=${encodeURIComponent(DEMO_ID)}`]) {
        await page.goto(ORIGIN + path)
        await expect(gateRows(page).first()).toBeVisible()
        // The screen-reader labels in rows scrolled out of the table's box
        // once widened the page by 45px at 390px; the box now holds them.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}px`).toBe(0)
      }
    } finally {
      await page.close()
    }
  })
}
