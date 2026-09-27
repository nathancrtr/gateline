// #499 in a browser, over throwaway repositories (`scenarios.ts`): one
// repository's unreadable runs as one row, reached by pointer and by keyboard
// and kept in the URL; a run in a `view` repository with no decision
// controls; the staging picker leaving a `view` repository out; and the
// outage banner raised by the mode, under `up` and not under `ui`.
import { renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { floodedRepo, fullRepo, type ScenarioServer, scenarioRoot, spawnScenario, writeConfig } from './scenarios.ts'

const collapsed = (page: Page) => page.locator('[data-inbox-collapsed="local/website"] > button[aria-expanded]')
const selected = (page: Page) => page.locator('[data-inbox-row][aria-current="true"]')

test.describe('one repository’s unreadable runs', () => {
  let root: string
  let s: ScenarioServer
  test.beforeAll(async () => {
    root = scenarioRoot()
    const website = floodedRepo(root, 'website', 24)
    const billing = floodedRepo(root, 'billing', 0)
    s = await spawnScenario({ repos: [website.dir, billing.dir] })
  })
  test.afterAll(() => {
    s?.server.kill()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('are one row that opens in place, and the open state lives in the URL', async ({ page }) => {
    await page.goto(`${s.origin}/`)
    // 30 items: 6 decisions and 24 unreadable runs, drawn as 7 rows.
    await expect(page.locator('[data-inbox-row]')).toHaveCount(7)
    await expect(page.locator('[data-inbox-filters] button').first()).toHaveText('All 30')
    await expect(page.locator('aside [data-inbox-badge]')).toHaveText('30')
    await expect(collapsed(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(collapsed(page)).toContainText('24 runs in website have unreadable state')

    await collapsed(page).click()
    await expect(page).toHaveURL(`${s.origin}/?expand=local%2Fwebsite`)
    await expect(collapsed(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-inbox-row]')).toHaveCount(31)
    await expect(page.locator('#collapsed-local-website [data-inbox-row]')).toHaveCount(24)

    await page.reload()
    await expect(collapsed(page)).toHaveAttribute('aria-expanded', 'true')
    await page.locator('[data-collapsed-end]').click()
    await expect(page).toHaveURL(`${s.origin}/`)
    await expect(page.locator('[data-inbox-row]')).toHaveCount(7)
  })

  test('are one stop for j and k, which enter opens, and then each run is a stop', async ({ page }) => {
    await page.goto(`${s.origin}/`)
    await expect(collapsed(page)).toBeVisible()
    // Rows: two escalations, then the collapsed row.
    await page.keyboard.press('j')
    await page.keyboard.press('j')
    await expect(collapsed(page)).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Enter')
    await expect(collapsed(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(page).toHaveURL(/expand=local%2Fwebsite/)
    await page.keyboard.press('j')
    await expect(selected(page)).toContainText('broken-01')
    await page.keyboard.press('k')
    await expect(collapsed(page)).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('Enter')
    await expect(collapsed(page)).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('j')
    await expect(selected(page)).toContainText('nightly-report')
  })
})

test.describe('a view repository', () => {
  let root: string
  let s: ScenarioServer
  test.beforeAll(async () => {
    root = scenarioRoot()
    const billing = floodedRepo(root, 'billing', 0)
    const website = floodedRepo(root, 'website', 0)
    const xdg = writeConfig(root, [
      { path: billing.dir, mode: 'view' },
      { path: website.dir, mode: 'decide' },
    ])
    s = await spawnScenario({ xdg })
  })
  test.afterAll(() => {
    s?.server.kill()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('a run in it offers no decision, says why, and keeps its packet readable', async ({ page }) => {
    await page.goto(`${s.origin}/repos/local/billing/-/runs/csv-export?decide=G0`)
    await expect(page.locator('[data-needs-card]')).toBeVisible()
    await expect(page.locator('[data-g0-packet]')).toContainText('Assumptions')
    await expect(page.locator('[data-view-mode-line]')).toHaveText('This deployment records no decisions in this repository.')
    await expect(page.locator('[data-decide]')).toHaveCount(0)
    // The same run in a decide repository has the controls.
    await page.goto(`${s.origin}/repos/local/website/-/runs/csv-export?decide=G0`)
    await expect(page.locator('[data-decide="approve"]')).toBeVisible()
    await expect(page.locator('[data-view-mode-line]')).toHaveCount(0)
  })

  test('is not offered by the staging picker, and the form says why', async ({ page }) => {
    await page.goto(`${s.origin}/portfolio/new`)
    await expect(page.locator('[data-repository-withheld]')).toHaveText('Not offered: billing, which is in view mode here, so nothing is written to it.')
    await expect(page.locator('select#source')).toHaveCount(0)
    await expect(page.locator('aside [data-scope-item="local/billing"] [data-repository-facts]')).toHaveText('Mode view. No engine in this deployment.')
  })
})

test.describe('the outage banner follows the mode', () => {
  let root: string
  test.beforeAll(() => {
    root = scenarioRoot()
    fullRepo(root, 'demo')
  })
  test.afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('under ui, an absent engine is a plain fact; under up, it is an outage', async ({ page }) => {
    const ui = await spawnScenario({ repos: [join(root, 'demo')] })
    try {
      await page.goto(`${ui.origin}/`)
      await expect(page.locator('[data-inbox-row]').first()).toBeVisible()
      await expect(page.locator('[data-engine-outage]')).toHaveCount(0)
      await expect(page.locator('aside [data-repository-facts]')).toHaveText('Mode decide. No engine in this deployment.')
    } finally {
      ui.server.kill()
    }
    const up = await spawnScenario({ repos: [join(root, 'demo')], engine: true })
    try {
      await page.goto(`${up.origin}/`)
      await expect(page.locator('[data-engine-outage]')).toHaveText(
        'The orchestrator does not appear to be running in demo. Decisions will be recorded but nothing will dispatch — no heartbeat has been written.',
      )
      await expect(page.locator('aside [data-repository-facts]')).toHaveText('Mode dispatch. No recent heartbeat from its engine.')
    } finally {
      up.server.kill()
    }
  })
})

test.describe('a repository that cannot be read', () => {
  let root: string
  let s: ScenarioServer
  test.beforeAll(async () => {
    root = scenarioRoot()
    const website = floodedRepo(root, 'website', 0)
    const ledger = floodedRepo(root, 'ledger', 0)
    s = await spawnScenario({ repos: [website.dir, ledger.dir] })
    // Gone from under the running server, as a repository removed from disk is.
    renameSync(join(ledger.dir, '.git'), join(ledger.dir, '.git-away'))
  })
  test.afterAll(() => {
    s?.server.kill()
    if (root) rmSync(root, { recursive: true, force: true })
  })

  test('is named at the top of the page and marked in the rail', async ({ page }) => {
    await page.goto(`${s.origin}/`)
    await expect(page.locator('[data-unreadable-notice]')).toContainText('One repository could not be read, so its decisions are not shown here.')
    await expect(page.locator('[data-unreadable-repository="local/ledger"] [data-address]')).toHaveText('local/ledger')
    await expect(page.locator('aside [data-scope-item="local/ledger"] [data-repository-facts]')).toHaveText('Could not be read.')
    await expect(page.locator('aside [data-inbox-badge]')).toHaveAttribute('title', '3 waiting. Not counted: ledger, which could not be read')
    await page.goto(`${s.origin}/portfolio`)
    await expect(page.locator('[data-unreadable-notice]')).toContainText('so its runs are not shown here.')
    await page.goto(`${s.origin}/metrics`)
    await expect(page.locator('[data-unreadable-notice] p')).toHaveText('One repository could not be read, so its figures are not counted.')
    await expect(page.locator('[data-unreadable-repository="local/ledger"] [data-address]')).toHaveText('local/ledger')
    await page.goto(`${s.origin}/metrics?repo=local%2Fwebsite`)
    await expect(page.locator('h1')).toHaveText('Metrics')
    await expect(page.locator('[data-unreadable-notice]')).toHaveCount(0)
  })
})
