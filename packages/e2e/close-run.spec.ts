// E2E for closing a run (#200): the run-level affordance, the typed
// disposition, what the record ends up holding, and the reopen that undoes it.
//
// Follows staging.spec.ts's idioms — its own fixture repo, its own server,
// and git assertions read through plumbing rather than a checkout, so the
// committed record is checked the way an operator would inspect it. The
// server binds an OS-assigned port (demo-server.ts, #438) so parallel workers
// — and parallel worktrees — never collide.
import { type ChildProcess, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { spawnDemoServer } from './demo-server.ts'

let fixtureDir: string
let server: ChildProcess
let ORIGIN: string

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}

/** Navigates against this file's own server — never one another suite started. */
const goto = (page: Page, path: string) => page.goto(ORIGIN + path)

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  ;({ server, origin: ORIGIN } = await spawnDemoServer(fixtureDir))
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

test('close: a paused run is ended from its own page with a typed disposition, and leaves the inbox', async ({ page }) => {
  // The run is in the inbox before the closure — this is the item the whole
  // feature exists to clear. The inbox is the app's root route, and rows are
  // matched by hasText (smoke.spec's idiom) because a row renders
  // `{source}/{slug}` as separate nodes.
  const rows = page.locator('[data-inbox-row]')
  const inboxRow = rows.filter({ hasText: 'paused-budget' })
  await goto(page, '/')
  await expect(inboxRow).toHaveCount(1)

  await goto(page, `/runs/${sourceId()}/paused-budget`)
  await page.locator('[data-decide="close"]').click()

  // Both halves are required: the confirm stays disabled until a disposition
  // and a reason are supplied.
  const confirm = page.locator('[data-decide="close-confirm"]')
  await expect(confirm).toBeDisabled()
  // The radio input is sr-only; the label is the control (smoke.spec's idiom).
  await page.locator('[data-close-run]').getByText('already-delivered', { exact: false }).click()
  await expect(confirm).toBeDisabled()
  await page.locator('[data-close-run] textarea').fill('Work landed via another PR; nothing left to retry.')
  await expect(confirm).toBeEnabled()

  // The button names the disposition it is about to write.
  await expect(confirm).toHaveText('Close as already-delivered')
  await confirm.click()

  // The record: one commit, the human decision grammar, the closure block.
  await expect(page.locator('[data-closure-record]')).toBeVisible()
  const subject = git(['log', '-1', '--format=%s', 'run/paused-budget']).trim()
  expect(subject).toBe('state(paused-budget): closed by Fixture Operator [disposition: already-delivered]')
  const author = git(['log', '-1', '--format=%an', 'run/paused-budget']).trim()
  expect(author).toBe('Fixture Operator')

  const state = git(['show', 'run/paused-budget:runs/paused-budget/state.yaml'])
  expect(state).toContain('phase: closed')
  expect(state).toContain('as: already-delivered')
  expect(state).toContain('by: Fixture Operator')
  expect(state).toContain('Work landed via another PR')

  // The chip reads as the disposition, never the bare word "closed".
  await expect(page.locator('[data-phase-chip]').first()).toContainText('already-delivered')

  // And it is out of the inbox — the point of the exercise.
  await goto(page, '/')
  await expect(rows.first()).toBeVisible() // the box rendered, and this run is not in it
  await expect(inboxRow).toHaveCount(0)
})

test('close is not offered on a done run — a finished run is already its own record', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/done-merged`)
  await expect(page.locator('[data-decide="close"]')).toHaveCount(0)
})

test('reopen: a closure is a decision, not a deletion — undoing it is another commit', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/closed-delivered`)

  const record = page.locator('[data-closure-record]')
  await expect(record).toContainText('already-delivered')
  await expect(record).toContainText('The work landed by another path')
  // Closing offers nothing further; the panel's counterpart replaces it.
  await expect(page.locator('[data-decide="close"]')).toHaveCount(0)

  await page.locator('[data-decide="reopen"]').click()
  await page.locator('[data-decide="reopen-confirm"]').click()

  await expect(page.locator('[data-closure-record]')).toHaveCount(0)
  const subject = git(['log', '-1', '--format=%s', 'run/closed-delivered']).trim()
  expect(subject).toMatch(/^state\(closed-delivered\): reopened to \S+ by Fixture Operator \(was closed as already-delivered\)$/)

  const state = git(['show', 'run/closed-delivered:runs/closed-delivered/state.yaml'])
  expect(state).not.toContain('phase: closed')
  expect(state).toContain('closure: null')
})
