// #551: while /api/health is still loading, the served set is empty, so the
// rail's links must not resolve `?repo=` to `unknown` and drop it — "not
// loaded yet" and "not a repository served here" are different states. This
// is the reviewer's reproduction for #550 (kept as `r550-race.spec.ts` in the
// review record), promoted into the suite once the race had a fix: delay
// `/api/health` and click a rail link the instant the page has painted, well
// before the delayed response can land.
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { type DemoSet, generateDemoSet } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { DEMO_SMALL_ID, spawnDemoServer } from './demo-server.ts'

let demo: DemoSet
let server: ChildProcess
let ORIGIN: string
const SMALL_Q = `repo=${encodeURIComponent(DEMO_SMALL_ID)}`

test.beforeAll(async () => {
  demo = generateDemoSet()
  ;({ server, origin: ORIGIN } = await spawnDemoServer(demo.repos.map((r) => r.dir)))
})
test.afterAll(() => {
  server?.kill()
  if (demo) rmSync(demo.root, { recursive: true, force: true })
})

/** Delay every `/api/health` response by `delayMs`, if given. */
async function delayHealth(page: Page, delayMs: number): Promise<void> {
  if (!delayMs) return
  await page.route('**/api/health', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.continue()
  })
}

for (const delayMs of [0, 1500]) {
  test(`with /api/health delayed ${delayMs} ms, the Portfolio link already carries repo and a click right after load keeps it`, async ({ page }) => {
    await delayHealth(page, delayMs)
    await page.goto(`${ORIGIN}/?${SMALL_Q}`)
    const link = page.locator('aside').getByRole('link', { name: 'Portfolio', exact: true })
    // The href is correct at first paint — before /api/health can possibly
    // have answered — because the rail carries the URL's own `repo` while the
    // served set is unknown, rather than resolving it against an empty set.
    await expect(link).toHaveAttribute('href', `/portfolio?${SMALL_Q}`)
    await link.click()
    await expect(page).toHaveURL(`${ORIGIN}/portfolio?${SMALL_Q}`)
    // The page settles once health has answered, and the scope still holds.
    await expect(page.locator('[data-scope-heading]')).toContainText('demo-small')
  })

  test(`with /api/health delayed ${delayMs} ms, the Metrics and Inbox links also keep repo before and after it answers`, async ({ page }) => {
    await delayHealth(page, delayMs)
    await page.goto(`${ORIGIN}/?${SMALL_Q}`)
    const aside = page.locator('aside')
    await expect(aside.getByRole('link', { name: 'Metrics', exact: true })).toHaveAttribute('href', `/metrics?${SMALL_Q}`)
    await expect(aside.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', `/?${SMALL_Q}`)
    // The scope control only ever appears once /api/health has resolved (the
    // served set is what it lists), so waiting for it — rather than an
    // arbitrary pause — is waiting for exactly the state that legitimately
    // needs the set loaded: confirming the links still carry the scope once
    // it has actually resolved, not only in the window before.
    await expect(page.locator('aside nav[aria-label="Repository scope"]')).toBeVisible()
    await expect(aside.getByRole('link', { name: 'Metrics', exact: true })).toHaveAttribute('href', `/metrics?${SMALL_Q}`)
    await expect(aside.getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', `/?${SMALL_Q}`)
  })
}
