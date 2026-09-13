// E2E for closing a run (#200): the run-level affordance, the typed
// disposition, what the record ends up holding, and the reopen that undoes it.
//
// Follows staging.spec.ts's idioms — its own fixture repo, its own server on
// its own port, and git assertions read through plumbing rather than a
// checkout, so the committed record is checked the way an operator would
// inspect it. Ports in use: 4399 smoke, 4398 staging, 4397 host-link, 4396
// here — each spec needs its own so parallel workers never collide.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { expect, test } from '@playwright/test'

const PORT = 4396
test.use({ baseURL: `http://127.0.0.1:${PORT}` })

let fixtureDir: string
let server: ChildProcess

const git = (args: string[]) => execFileSync('git', ['-C', fixtureDir, ...args], { encoding: 'utf8' })

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

test('close: a paused run is ended from its own page with a typed disposition, and leaves the inbox', async ({ page }) => {
  // The run is in the inbox before the closure — this is the item the whole
  // feature exists to clear. The inbox is the app's root route, and rows are
  // matched by hasText (smoke.spec's idiom) because a row renders
  // `{source}/{slug}` as separate nodes.
  const rows = page.locator('[data-inbox-row]')
  const inboxRow = rows.filter({ hasText: 'paused-budget' })
  await page.goto('/')
  await expect(inboxRow).toHaveCount(1)

  await page.goto(`/runs/${sourceId()}/paused-budget`)
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
  await page.goto('/')
  await expect(rows.first()).toBeVisible() // the box rendered, and this run is not in it
  await expect(inboxRow).toHaveCount(0)
})

test('close is not offered on a done run — a finished run is already its own record', async ({ page }) => {
  await page.goto(`/runs/${sourceId()}/done-merged`)
  await expect(page.locator('[data-decide="close"]')).toHaveCount(0)
})

test('reopen: a closure is a decision, not a deletion — undoing it is another commit', async ({ page }) => {
  await page.goto(`/runs/${sourceId()}/closed-delivered`)

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
