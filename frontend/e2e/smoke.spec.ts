// E2E smoke (plan §9): inbox → gate card → approve → the commit exists with
// the right author, message, and preserved YAML comments; the bounce view
// offers no approval; the keyboard loop drives a decision end-to-end.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { generateFixtureRepo } from '@agentic/fixtures'

const PORT = 4399
let fixtureDir: string
let server: ChildProcess

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  server = spawn('node', ['packages/server/src/main.ts', '--repo', fixtureDir, '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  })
  // Wait for readiness.
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

test('inbox ranks oldest first and flags bounced packets', async ({ page }) => {
  await page.goto('/')
  const rows = page.locator('[data-inbox-row]')
  await expect(rows.first()).toContainText('escalated')
  const bounced = rows.filter({ hasText: 'malformed-spec' })
  await expect(bounced).toContainText('Bounced')
})

test('bounce view renders problems and offers no approval (R3)', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/malformed-spec?decide=G0')
  const card = page.locator('[data-needs-card]')
  await expect(card).toContainText('missing required sections')
  await expect(card.locator('[data-decide="approve"]')).toHaveCount(0)
  await expect(card).toContainText('no approval is offered')
})

test('recovered escalations show role and reason with no resolve control (AC4.1)', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/esc-recovered')
  await expect(page.getByText('Malformed run state').first()).toBeVisible()
  const cards = page.locator('[data-needs-card]')
  const escalationCards = cards.filter({ hasText: 'Escalation from' })
  await expect(escalationCards).toHaveCount(2)
  await expect(escalationCards.filter({ hasText: 'Escalation from implementer' })).toContainText('file_contact_surface conflict with a parallel task')
  await expect(escalationCards.filter({ hasText: 'Escalation from verifier' })).toContainText('AC2.2 unverifiable: the oversized-input fixture referenced by the spec is missing from the repo')
  await expect(page.locator('[data-decide="resolve"]')).toHaveCount(0)
})

test('a schema-valid run keeps its resolve control', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/escalated')
  await expect(page.locator('[data-decide="resolve"]')).toHaveCount(1)
})

test('the pointer decision loop: approve G0 with burden → correct commit', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g0-pending?decide=G0')
  const card = page.locator('[data-needs-card]').first()
  await card.locator('[data-decide="approve"]').click()
  await card.getByText('Light correction').click()
  await card.getByPlaceholder(/Notes \(optional\)/).fill('spec is right; two ACs tightened')
  await card.locator('[data-decide="approve-confirm"]').click()
  await expect(card.getByRole('status')).toContainText(/committed [0-9a-f]{10}/)

  const subject = git(['log', '-1', '--format=%s %an', 'run/g0-pending']).trim()
  expect(subject).toBe('state(g0-pending): G0 approved by Fixture Operator [burden: light-correction] Fixture Operator')
  const state = git(['show', 'run/g0-pending:runs/g0-pending/state.yaml'])
  expect(state).toContain('# a gate entry is written ONLY by the named human')
  expect(state).toContain('burden: light-correction')
  expect(state).toMatch(/phase: plan/)
})

test('the keyboard loop: a → 1 → approve on the primary card', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g1-pending?decide=G1')
  const card = page.locator('[data-needs-card]').first()
  await expect(card.locator('[data-decide="approve"]')).toBeVisible()
  await page.keyboard.press('a')
  await page.keyboard.press('1')
  await expect(card.getByText('Confirmation')).toBeVisible()
  await card.locator('[data-decide="approve-confirm"]').click()
  await expect(card.getByRole('status')).toContainText(/committed/)
  const state = git(['show', 'run/g1-pending:runs/g1-pending/state.yaml'])
  expect(state).toContain('burden: confirmation')
})

test('portfolio and metrics render', async ({ page }) => {
  await page.goto('/portfolio')
  await expect(page.getByRole('table')).toContainText('done-merged')
  await page.goto('/metrics')
  await expect(page.getByText('Gate decisions')).toBeVisible()
  await expect(page.getByText('Budget honesty')).toBeVisible()
})

test('run lexicon (#163): ids resolve to verbatim hover cards and jump to their definition', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending?tab=artifacts&artifact=verification-report.md')
  await expect(page.locator('.lex-cited > summary')).toContainText('Cites AC1.1, AC2.1')
  const ref = page.locator('.prose-artifact .lex-ref', { hasText: 'AC1.1' }).first()
  await ref.hover()
  const card = ref.locator('.lex-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('acceptance criterion')
  // Verbatim from the fixture spec — the card quotes, never paraphrases.
  await expect(card).toContainText('running the tool on sample input produces the documented output')
  await card.locator('.lex-card-jump').click()
  await expect(page).toHaveURL(/artifact=spec\.md/)
  await expect(page.locator('#def-R1')).toContainText('Core behavior')
  // Definition sites are not self-links: the R1 heading and the AC1.1 bullet
  // in spec.md render their own ids as plain text, while citations of ids
  // defined elsewhere (ADR-1, from plan.md) still resolve.
  await expect(page.locator('#def-R1 .lex-ref')).toHaveCount(0)
  await expect(page.locator('.prose-artifact li .lex-ref', { hasText: 'AC1.1' })).toHaveCount(0)
})

test('evidence rollup (#165): uncited criteria are the headline; anchors jump to the evidence block', async ({ page }) => {
  await page.goto('/runs/' + sourceId() + '/g2-pending')
  const rollup = page.locator('[data-evidence-rollup]').first()
  await expect(rollup).toContainText('No verification evidence cites:')
  await expect(rollup).toContainText('AC2.2')
  await expect(rollup).toContainText('report states')
  // No computed judgment anywhere — the only verdict text is the report's own words.
  await rollup.getByRole('link', { name: 'E1', exact: true }).click()
  await expect(page).toHaveURL(/artifact=verification-report\.md/)
  await expect(page.locator('#def-E1')).toBeVisible()
})

function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}
