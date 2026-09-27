// The scope and grouping in a browser (#498; docs/MULTI-REPO.md §9.1, §9.2),
// against the two-repository demo: `demo`, every state the cockpit renders,
// and `demo-small`, four runs. 14 decisions wait in demo and 3 in demo-small.
//
// Which form each suite runs against is a decision. This file is the
// two-repository form; every other spec (smoke, geometry, seam, staging,
// close-run, host-link) serves the one-repository form, `--demo=single`'s
// shape, because what they assert — packets, decisions, commits, layout of
// the run pages — lives inside one repository, and #497 already pinned that a
// one-repository set looks as it always did. What only exists with several
// repositories is pinned here: the control, the URL carrying the scope, the
// badge, grouping, and the widths the rail and the top bar take.
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { type DemoSet, generateDemoSet } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { DEMO_ID, DEMO_SMALL_ID, spawnDemoServer } from './demo-server.ts'

let demo: DemoSet
let server: ChildProcess
let ORIGIN: string

const goto = (page: Page, path: string) => page.goto(ORIGIN + path)
const control = (page: Page) => page.locator('aside nav[aria-label="Repository scope"]')
const entry = (page: Page, name: string) => control(page).getByRole('link', { name: new RegExp(`^${name} \\d+ waiting$`) })
const badge = (page: Page) => page.locator('aside [data-inbox-badge]')
const rows = (page: Page) => page.locator('[data-inbox-row]')
const SMALL_Q = `repo=${encodeURIComponent(DEMO_SMALL_ID)}`

test.beforeAll(async () => {
  demo = generateDemoSet()
  ;({ server, origin: ORIGIN } = await spawnDemoServer(demo.repos.map((r) => r.dir)))
})

test.afterAll(() => {
  server?.kill()
  if (demo) rmSync(demo.root, { recursive: true, force: true })
})

test('the control lists the set with each repository’s waiting count, and scopes the inbox through the URL', async ({ page }) => {
  await goto(page, '/')
  await expect(rows(page)).toHaveCount(17)
  await expect(control(page).getByRole('link')).toHaveText([/^All repositories\s*17/, /^demo\s*14/, /^demo-small\s*3/])
  await expect(control(page).getByRole('link', { name: /^All repositories/ })).toHaveAttribute('aria-current', 'page')
  await expect(badge(page)).toHaveText('17')

  await entry(page, 'demo-small').click()
  await expect(page).toHaveURL(`${ORIGIN}/?${SMALL_Q}`)
  await expect(rows(page)).toHaveCount(3)
  await expect(entry(page, 'demo-small')).toHaveAttribute('aria-current', 'page')
  // The badge still counts the whole set: 3 here, of 17.
  await expect(badge(page).locator('[aria-hidden="true"]')).toHaveText('3 of 17')
  await expect(badge(page).locator('.sr-only')).toHaveText('3 waiting in demo-small, 17 in all repositories')
  // Named once, in the heading; the rows carry the slug alone.
  await expect(page.locator('[data-scope-heading]')).toHaveText(/^demo-small\s*local\/demo-small$/)
  await expect(rows(page).locator('[data-run-name]')).toHaveText(['retry-policy', 'nightly-report', 'csv-export'])
  await expect(page).toHaveTitle('Inbox · demo-small — Gatehouse')

  // The scope survives a reload, because it is in the URL.
  await page.reload()
  await expect(rows(page)).toHaveCount(3)
  await expect(page).toHaveURL(`${ORIGIN}/?${SMALL_Q}`)
})

test('a fresh visit shows everything: the scope is kept nowhere but the URL', async ({ page }) => {
  await goto(page, `/?${SMALL_Q}`)
  await expect(rows(page)).toHaveCount(3)
  await goto(page, '/')
  await expect(rows(page)).toHaveCount(17)
  await expect(badge(page)).toHaveText('17')
  await expect(page.locator('[data-scope-heading]')).toHaveCount(0)
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))
  expect(kept).toEqual({ local: 0, session: 0, cookie: '' })
})

test('moving between Inbox, Portfolio and Metrics keeps the scope, and so does opening a run and coming back', async ({ page }) => {
  await goto(page, `/?${SMALL_Q}`)
  await page.locator('aside').getByRole('link', { name: 'Portfolio', exact: true }).click()
  await expect(page).toHaveURL(`${ORIGIN}/portfolio?${SMALL_Q}`)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await expect(page.locator('table th', { hasText: 'repository' })).toHaveCount(0)
  await expect(page).toHaveTitle('Portfolio · demo-small — Gatehouse')

  await page.getByRole('link', { name: 'csv-export', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/repos/${DEMO_SMALL_ID}/-/runs/csv-export$`))
  await page.goBack()
  await expect(page).toHaveURL(`${ORIGIN}/portfolio?${SMALL_Q}`)
  await expect(page.locator('tbody tr')).toHaveCount(4)

  // The run page's repository link lands on the Portfolio in that scope.
  await page.getByRole('link', { name: 'retry-policy', exact: true }).click()
  await page.locator('[data-run-repository] a').click()
  await expect(page).toHaveURL(`${ORIGIN}/portfolio?${SMALL_Q}`)
  await expect(page.locator('[data-scope-heading]')).toContainText('demo-small')

  await page.locator('aside').getByRole('link', { name: 'Metrics', exact: true }).click()
  await expect(page).toHaveURL(`${ORIGIN}/metrics?${SMALL_Q}`)
  await expect(page.locator('[data-gate-scope]')).toHaveText(
    'Counted across all repositories. Gate figures are not yet split by repository, so this table does not follow the scope.',
  )
  await expect(page.locator('section', { hasText: 'Budget honesty' }).locator('tbody tr')).toHaveCount(4)

  await page.locator('aside').getByRole('link', { name: /^Inbox/ }).click()
  await expect(page).toHaveURL(`${ORIGIN}/?${SMALL_Q}`)
  await control(page).getByRole('link', { name: /^All repositories/ }).click()
  await expect(page).toHaveURL(`${ORIGIN}/`)
  await expect(rows(page)).toHaveCount(17)
})

test('grouping heads each repository with its name, id and count, and is kept in the URL', async ({ page }) => {
  await goto(page, '/')
  const toggle = page.getByRole('button', { name: 'Group by repository' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(page).toHaveURL(`${ORIGIN}/?group=repository`)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const headings = page.locator('[data-group-heading]')
  await expect(headings).toHaveText([/^demo\s*local\/demo\s*14 entries$/, /^demo-small\s*local\/demo-small\s*3 entries$/])
  await expect(headings.locator('[data-address]')).toHaveText([DEMO_ID, DEMO_SMALL_ID])
  await expect(page.locator(`[data-inbox-group="${DEMO_SMALL_ID}"] [data-inbox-row] [data-run-name]`)).toHaveText([
    /retry-policy$/,
    /nightly-report$/,
    /csv-export$/,
  ])
  await page.reload()
  await expect(headings).toHaveCount(2)

  // A scope entry keeps the grouping for when the scope is lifted; under the
  // scope there is one repository, and nothing to group or toggle.
  await entry(page, 'demo').click()
  await expect(page).toHaveURL(`${ORIGIN}/?group=repository&repo=${encodeURIComponent(DEMO_ID)}`)
  await expect(headings).toHaveCount(0)
  await expect(toggle).toHaveCount(0)
  await expect(rows(page)).toHaveCount(14)

  await goto(page, '/portfolio?group=repository')
  await expect(page.locator('[data-group-heading]')).toHaveText([/^demo\s*local\/demo\s*16 runs, 14 need you$/, /^demo-small\s*local\/demo-small\s*4 runs, 3 need you$/])
  await page.getByRole('button', { name: 'Group by repository' }).click()
  await expect(page).toHaveURL(`${ORIGIN}/portfolio`)
  await expect(page.locator('[data-group-heading]')).toHaveCount(0)
})

test('a repository the deployment does not serve shows everything, and says so once', async ({ page }) => {
  await goto(page, '/?repo=github.com%2Facme%2Fnope')
  await expect(page.locator('[data-scope-unknown]')).toHaveText('No repository github.com/acme/nope is served here, so every repository is shown.')
  await expect(rows(page)).toHaveCount(17)
  await expect(badge(page)).toHaveText('17')
})

/** Sideways scroll of the page, in pixels. */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

for (const width of [1400, 800, 390]) {
  test(`at ${width}px the scope control shows, the page never scrolls sideways, and nothing sits under the top bar`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    try {
      for (const path of ['/', `/?${SMALL_Q}`, '/?group=repository', '/portfolio?group=repository', `/portfolio?${SMALL_Q}`, `/metrics?${SMALL_Q}`]) {
        await goto(page, path)
        await expect(page.locator('main h1')).toBeVisible()
        expect(await sideways(page), `${path} at ${width}px`).toBe(0)
        // Below 768px the rail is the fixed top bar, with the scope as its second row.
        const where = width < 768 ? '[data-top-bar]' : 'aside'
        await expect(page.locator(`${where} nav[aria-label="Repository scope"]`), `${path} at ${width}px`).toBeVisible()
        if (width < 768) {
          const bar = (await page.locator('[data-top-bar]').boundingBox())!
          const first = (await page.locator('main > *').first().boundingBox())!
          expect(first.y, `${path} at ${width}px: content starts below the top bar`).toBeGreaterThanOrEqual(bar.y + bar.height)
        }
      }
    } finally {
      await page.close()
    }
  })
}

test.describe('long display names', () => {
  let long: DemoSet
  let longServer: ChildProcess
  let LONG_ORIGIN: string
  const FULL = 'payments-reconciliation-service'
  const SMALL = 'customer-notifications-and-preferences'

  test.beforeAll(async () => {
    long = generateDemoSet({ names: { full: FULL, small: SMALL } })
    ;({ server: longServer, origin: LONG_ORIGIN } = await spawnDemoServer(long.repos.map((r) => r.dir)))
  })
  test.afterAll(() => {
    longServer?.kill()
    if (long) rmSync(long.root, { recursive: true, force: true })
  })

  for (const width of [1400, 800, 390]) {
    test(`are cut in the rail, kept whole in the title, and never push the page sideways at ${width}px`, async ({ browser }) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      try {
        for (const path of ['/', `/?repo=${encodeURIComponent(`local/${SMALL}`)}`, '/?group=repository', '/portfolio?group=repository']) {
          await page.goto(LONG_ORIGIN + path)
          await expect(page.locator('main h1')).toBeVisible()
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}px`).toBe(0)
        }
        const where = width < 768 ? '[data-top-bar]' : 'aside'
        const link = page.locator(`${where} nav[aria-label="Repository scope"] a[data-scope-entry="local/${SMALL}"]`)
        await expect(link).toHaveAttribute('title', `local/${SMALL}`)
        await expect(link.locator('[data-scope-name]')).toHaveText(SMALL)
      } finally {
        await page.close()
      }
    })
  }
})
