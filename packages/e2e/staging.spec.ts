// E2E staging (plan ADR-8, task 06): stage a run through the web form,
// confirm the staged rest state renders distinctly, arm it, and prove
// replay/collision are distinguishable outcomes — all against a fresh
// fixture repo minted through the real seam (planRunScaffold + stageRun via
// the actual UI/API this suite drives, not a pre-baked fixture run). Follows
// smoke.spec.ts's idioms (spawned server, readiness poll, execFileSync git
// assertions) but is fully self-contained: its own fixture dir and its own
// server on a port other than 4399, so it never collides with smoke.spec's
// server under parallel Playwright workers (plan Risk 2).
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'

const PORT = 4398
test.use({ baseURL: `http://127.0.0.1:${PORT}` })

// The fixture's built-in intent-brief.md template (packages/fixtures/src/index.ts's
// CONTRACTS['intent-brief.md']) — the same order GET /api/staging serves.
const SECTIONS = ['Problem', 'Motivation', 'Constraints', 'Out of scope']

const STAGE_TITLE = 'E2E Staging Flow'
const STAGE_SLUG = 'e2e-staging-flow'

let fixtureDir: string
let server: ChildProcess

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

// The server derives a zero-config source's id from its repo path's last
// segment (loadSources' slugForPath) — not a fixed literal (smoke.spec.ts's
// own sourceId() idiom).
function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  server = spawn('node', ['server/src/main.ts', '--repo', fixtureDir, '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not come up')
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

/** Mirrors new-run.tsx's own slugify — used only to compute the slug an
 * auto-suggest is expected to land on, never sent to the app. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Fills one textarea per required brief section — structure from the
 * contract, words supplied here stand in for the operator's own. */
async function fillBrief(page: Page, filler: (heading: string) => string = (h) => `${h} — filled for the e2e run.`) {
  for (const heading of SECTIONS) {
    await page.locator(`#section-${slugify(heading)} textarea`).fill(filler(heading))
  }
}

/** The genesis commit's `intake.client_key` from a `state.yaml` blob — the
 * replay flow reuses it to prove a same-key resubmission is idempotent. */
function extractClientKey(stateYaml: string): string {
  const m = stateYaml.match(/client_key: "([^"]+)"/)
  if (!m) throw new Error('state.yaml carries no client_key')
  return m[1]!
}

test('entry + stage: Portfolio → New run → fill the brief → land on the run detail page (AC1.2, AC4.2, AC7.1)', async ({ page }) => {
  await page.goto('/portfolio')

  // AC7.1: the nav still shows exactly Inbox/Portfolio/Metrics — staging's
  // entry point is reachable from an existing page, not a new top-level route.
  const navLinks = page.locator('nav a')
  await expect(navLinks).toHaveCount(3)
  await expect(navLinks).toHaveText(['Inbox', 'Portfolio', 'Metrics'])

  await page.getByRole('link', { name: 'New run' }).click()
  await expect(page).toHaveURL(/\/portfolio\/new$/)

  await expect(page.locator('#title')).toBeVisible()
  await page.locator('#title').fill(STAGE_TITLE)
  // Slug auto-suggested from the title, before any manual edit.
  await expect(page.locator('#slug')).toHaveValue(STAGE_SLUG)
  // Profile stays at its default ("standard") — no click needed.
  await fillBrief(page)

  await page.getByRole('button', { name: 'Stage run' }).click()
  await expect(page).toHaveURL(new RegExp(`/runs/${sourceId()}/${STAGE_SLUG}$`))

  // Assert via git (ADR-8's own idiom): branch, author, subject, state.
  const subject = git(['log', '-1', '--format=%s', `run/${STAGE_SLUG}`]).trim()
  expect(subject).toMatch(new RegExp(`^state\\(${STAGE_SLUG}\\): staged by Fixture Operator \\[client-key: [0-9a-f-]{36}\\]$`))
  const author = git(['log', '-1', '--format=%an', `run/${STAGE_SLUG}`]).trim()
  expect(author).toBe('Fixture Operator')

  const state = git(['show', `run/${STAGE_SLUG}:runs/${STAGE_SLUG}/state.yaml`])
  expect(state).toContain('phase: paused')
  expect(state).toContain('paused_reason: staged')
  expect(state).toContain('staged_by: "Fixture Operator"')
})

test('submit stays disabled while a required section is left empty (AC2.1/AC2.2 prevention)', async ({ page }) => {
  await page.goto('/portfolio/new')
  await expect(page.locator('#title')).toBeVisible()
  await page.locator('#title').fill('Partial Brief Probe')
  // Fill every section but the last — one blank required section is enough.
  for (const heading of SECTIONS.slice(0, -1)) {
    await page.locator(`#section-${slugify(heading)} textarea`).fill(`${heading} — filled.`)
  }
  await expect(page.getByRole('button', { name: 'Stage run' })).toBeDisabled()
})

test('a staged run renders distinctly and offers only Arm, never Resume (AC6.1/AC6.2)', async ({ page }) => {
  await page.goto('/portfolio')
  const row = page.locator('tr', { hasText: STAGE_SLUG })
  await expect(row).toContainText('staged')
  await expect(row).not.toContainText('paused')

  await page.goto(`/runs/${sourceId()}/${STAGE_SLUG}`)
  // The PhaseChip itself (its data hook) — not the header at large, which
  // also carries the genesis-preview candidate's permanent "staged by
  // <name>" provenance line regardless of current phase.
  const phaseChip = page.locator('header [data-phase-chip]')
  await expect(phaseChip).toHaveText('staged')
  // …and the spine says where that rest state is standing (#254): a staged run
  // sits at the first phase of its profile with no gate on the table.
  await expect(page.locator('[data-spine]')).toHaveAttribute('data-rest', 'staged')
  await expect(page.locator('[data-spine] [data-spine-gate][data-state="pending"]')).toHaveCount(0)

  const card = page.locator('[data-needs-card]').first()
  await expect(card.locator('[data-decide="arm"]')).toHaveCount(1)
  await expect(card.locator('[data-decide="resume"]')).toHaveCount(0)
})

test('arm commits "armed by" and clears the staged treatment (AC5.1)', async ({ page }) => {
  await page.goto(`/runs/${sourceId()}/${STAGE_SLUG}`)
  const card = page.locator('[data-needs-card]').first()
  await card.locator('[data-decide="arm"]').click()
  await card.locator('[data-decide="arm-confirm"]').click()
  await expect(card.getByRole('status')).toContainText(/committed [0-9a-f]{10}/)

  const subject = git(['log', '-1', '--format=%s', `run/${STAGE_SLUG}`]).trim()
  expect(subject).toBe(`state(${STAGE_SLUG}): armed by Fixture Operator`)

  const state = git(['show', `run/${STAGE_SLUG}:runs/${STAGE_SLUG}/state.yaml`])
  expect(state).not.toContain('phase: paused')

  await page.reload()
  // The chip is a rest-state overlay now (#254), so an armed run has none at
  // all: the spine alone carries the phase, and carries it once.
  await expect(page.locator('header [data-phase-chip]')).toHaveCount(0)
  await expect(page.locator('[data-spine]')).not.toHaveAttribute('data-rest', 'staged')
  await expect(page.locator('[data-spine] [data-spine-phase][data-state="current"]')).toHaveCount(1)
})

test('replaying the same client key reports "already staged", no second commit (AC8.1)', async ({ page }) => {
  const priorState = git(['show', `run/${STAGE_SLUG}:runs/${STAGE_SLUG}/state.yaml`])
  const clientKey = extractClientKey(priorState)
  const tipBefore = git(['rev-parse', `run/${STAGE_SLUG}`]).trim()

  await page.goto('/portfolio/new')
  await expect(page.locator('#title')).toBeVisible()
  // Same slug (same title auto-suggests it) — the same staging request,
  // resubmitted. The form always mints a fresh client key per page load
  // (crypto.randomUUID(), ux REC8), so the outgoing POST is intercepted and
  // its clientKey swapped for the one the first submission already used —
  // proving the server-side replay match, not a client-side shortcut.
  await page.locator('#title').fill(STAGE_TITLE)
  await fillBrief(page)

  await page.route('**/api/runs', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON() as { intake: { clientKey: string | null } }
    body.intake.clientKey = clientKey
    await route.continue({ postData: JSON.stringify(body) })
  })

  await page.getByRole('button', { name: 'Stage run' }).click()
  // Informational tone (role=status), not the error tone (role=alert).
  const status = page.getByRole('status')
  await expect(status).toContainText('Already staged')
  await expect(page.getByText(/no second commit was made/i)).toBeVisible()

  expect(git(['rev-parse', `run/${STAGE_SLUG}`]).trim()).toBe(tipBefore)
})

test('staging a taken slug refuses, naming the existing run, no branch mutation (AC8.2)', async ({ page }) => {
  const tipBefore = git(['rev-parse', 'run/g0-pending']).trim()

  await page.goto('/portfolio/new')
  await expect(page.locator('#title')).toBeVisible()
  await page.locator('#title').fill('Collision Probe')
  await page.locator('#slug').fill('g0-pending')
  await fillBrief(page)

  await page.getByRole('button', { name: 'Stage run' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Refused')
  await expect(alert).toContainText('run/g0-pending')

  expect(git(['rev-parse', 'run/g0-pending']).trim()).toBe(tipBefore)
})

// Optional / best-effort (AC5.2's e2e slice) — deliberately not kept: a
// second-page stale arm attempt is not observable reliably here. These
// e2e-minted runs carry only intent-brief.md/state.yaml (staging never
// authors spec.md), so once armed a standard-profile run has no reviewable
// readiness item at all; react-query's refetchOnWindowFocus (main.tsx's
// QueryClient default) refetches the second page's ['run', ...] query on the
// OS-level focus change Playwright's context.newPage()/page switching
// itself triggers, which removes the needs-card (and the error flash inside
// it) before it can be asserted — independent of whether the arm refusal
// itself worked (it does; AC5.2's server-side behavior is covered by task
// 03's app.test.ts). Per this task's "keep if stable" instruction, this
// flow is left out rather than landed flaky.
