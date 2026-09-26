// The static render check (plan ADR-7): proves the assembled demo tree
// renders and refuses correctly from files alone, served by the Pages-like
// `serve-static.mjs` (playwright.static.config.ts's webServer) — never the
// live cockpit. Every navigation below is a fresh `page.goto`, a fresh HTTP
// request against the static host, never a client-side route change.
import type { InboxResponse, RunsResponse, StagingConfigResponse } from '@gateline/server/contract'
import { expect, test } from '@playwright/test'

const BASE = 'http://127.0.0.1:4397'
const FIXTURE_SOURCE = 'fixture'
const FIXTURE_SLUG = 'g2-pending'

/** Mirrors `new-run.tsx`'s own slugify — used only to address the section
 * textarea a required heading renders as, never sent to the app. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json() as Promise<T>
}

// The one real (non-fixture) run and the fixture run every test below
// addresses — resolved once, from the assembled tree's own `/api/runs.json`,
// never a hand-picked slug. Fails loudly (rather than skipping) when either
// is missing: a demo tree with no real run or no `g2-pending` fixture is a
// build defect, not an empty-state to render around.
let realRun: { source: string; slug: string }

test.beforeAll(async () => {
  const { runs } = await getJson<RunsResponse>('/demo/api/runs.json')
  const real = runs.find((r) => r.source !== FIXTURE_SOURCE)
  if (!real) throw new Error('no real (non-fixture) run in the assembled demo tree — expected at least one `done` run')
  const fixture = runs.find((r) => r.source === FIXTURE_SOURCE && r.slug === FIXTURE_SLUG)
  if (!fixture) throw new Error(`fixture run ${FIXTURE_SOURCE}/${FIXTURE_SLUG} is missing from the assembled demo tree`)
  realRun = real
})

test('the shell routes resolve on a fresh GET and render their heading (AC6.1)', async ({ page }) => {
  const cases: [string, string][] = [
    ['/demo/', 'Inbox'],
    // Neither has a trailing slash — each is a directory on the static host,
    // so the static server's 301 must be followed before the shell renders.
    ['/demo/portfolio', 'Portfolio'],
    ['/demo/metrics', 'Metrics'],
  ]
  for (const [path, heading] of cases) {
    const res = await page.goto(path)
    expect(res?.status(), path).toBe(200)
    await expect(page.locator('h1')).toHaveText(heading)
  }
})

test('a real run and the fixture run both resolve on a deep link; only the fixture carries the label (AC3.1, AC3.2, AC6.1)', async ({
  page,
}) => {
  const realRes = await page.goto(`/demo/runs/${realRun.source}/${realRun.slug}`)
  expect(realRes?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText(realRun.slug)
  await expect(page.locator('[data-fixture-label]')).toHaveCount(0)

  const fixtureRes = await page.goto(`/demo/runs/${FIXTURE_SOURCE}/${FIXTURE_SLUG}`)
  expect(fixtureRes?.status()).toBe(200)
  await expect(page.locator('h1')).toHaveText(FIXTURE_SLUG)
  const label = page.locator('[data-fixture-label]')
  await expect(label.first()).toBeVisible()
  await expect(label.first()).toContainText('fixture data')
})

test('the artifact path form resolves: the reader shows the fixture run\'s spec.md', async ({ page }) => {
  const res = await page.goto(`/demo/runs/${FIXTURE_SOURCE}/${FIXTURE_SLUG}?tab=record&artifact=spec.md`)
  expect(res?.status()).toBe(200)
  await expect(page.locator('[data-reader]')).toContainText(`runs/${FIXTURE_SLUG}/spec.md`)
})

test('no EventSource is ever constructed (AC4.2)', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __es: unknown[] }).__es = []
    class RecordingEventSource {
      constructor(...args: unknown[]) {
        ;(window as unknown as { __es: unknown[] }).__es.push(args)
      }
    }
    // biome-ignore lint/suspicious/noExplicitAny: replacing the global constructor for the length of this test only.
    ;(window as any).EventSource = RecordingEventSource
  })
  await page.goto('/demo/')
  await expect(page.locator('[data-inbox-row]').first()).toBeVisible()
  const es = await page.evaluate(() => (window as unknown as { __es: unknown[] }).__es)
  expect(es).toEqual([])
})

test('approving a gate refuses against the demo, and the gate stays undecided (AC5.1)', async ({ page }) => {
  await page.goto(`/demo/runs/${FIXTURE_SOURCE}/${FIXTURE_SLUG}?decide=G2`)
  const card = page.locator('[data-needs-card]').first()
  await card.locator('[data-decide="approve"]').click()
  await card.getByText('Light correction').click()

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith('/api/decisions') && res.request().method() === 'POST'),
    card.locator('[data-decide="approve-confirm"]').click(),
  ])
  expect(response.ok(), `POST /api/decisions answered ${response.status()} — the static host has no such route`).toBe(false)

  // The failure path renders (`ApiError` handling in `web/src/api.ts`): a
  // status flash, and the confirm button back to its idle label rather than
  // a spinner left running.
  await expect(card.getByRole('status')).toBeVisible()
  const confirmButton = card.locator('[data-decide="approve-confirm"]')
  await expect(confirmButton).toBeEnabled()
  await expect(confirmButton).toHaveText('Approve G2')

  // The gate's chip does not advance: the spine's G2 cell still reads
  // pending, never approved (chips.tsx's `SpineGate` — `data-state` is the
  // hook the spine draws its cells from).
  const g2Cell = page.locator('[data-spine] [data-spine-gate="G2"]')
  await expect(g2Cell).not.toHaveAttribute('data-state', 'approved')
})

test('staging a new run refuses against the demo, and the inbox is unchanged (AC5.2)', async ({ page }) => {
  const inboxBefore = await getJson<InboxResponse>('/demo/api/inbox.json')
  const staging = await getJson<StagingConfigResponse>('/demo/api/staging.json')
  const headings = staging.sources[0]?.briefSections ?? []
  expect(headings.length).toBeGreaterThan(0)

  await page.goto('/demo/portfolio/new')
  await expect(page.locator('#title')).toBeVisible()
  await page.locator('#title').fill('Static Demo Staging Probe')
  // Keep the auto-suggested slug — fill every required section (staging.spec.ts's own idiom).
  for (const heading of headings) {
    await page.locator(`#section-${slugify(heading)} textarea`).fill(`${heading} — filled for the static render check.`)
  }

  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith('/api/runs') && res.request().method() === 'POST'),
    page.getByRole('button', { name: 'Stage run' }).click(),
  ])
  expect(response.ok(), `POST /api/runs answered ${response.status()} — the static host has no such route`).toBe(false)
  await expect(page.getByRole('alert')).toBeVisible()

  await page.goto('/demo/')
  await expect(page.locator('[data-inbox-row]')).toHaveCount(inboxBefore.items.length)
})

test('an unknown path gets the site\'s 404 handling, not a bare host default (AC6.2)', async ({ page }) => {
  const res = await page.goto('/demo/nope/never')
  expect(res?.status()).toBe(404)
  await expect(page.locator('h1')).toHaveText('Page not found')
})
