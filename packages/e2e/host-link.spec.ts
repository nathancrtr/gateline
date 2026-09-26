// E2E for the link out to the git host (#267): #259 decided the generic views
// are retired in favor of derived ones, and that nothing may be deleted before
// its link-out exists. This proves the destination is really there — and that
// where no destination can be named honestly, the page keeps its local view
// rather than offering a dead link.
//
// Self-contained in smoke.spec.ts's idiom (own fixture, own server on an
// OS-assigned port so parallel Playwright workers and worktrees never
// collide, demo-server.ts, #438), because this fixture needs something the
// shared one deliberately lacks: a `remote.origin.url`. Giving the shared
// fixture an origin would also flip zero-config sources into push mode
// (view-model/config.ts's pushWhenOriginExists) and change what every other
// spec is testing.
import { type ChildProcess, execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { generateFixtureRepo } from '@gateline/fixtures'
import { expect, type Page, test } from '@playwright/test'
import { spawnDemoServer } from './demo-server.ts'

const REMOTE = 'git@github.com:acme/gateline-demo.git'

let fixtureDir: string
let server: ChildProcess
let ORIGIN: string

function sourceId(): string {
  return fixtureDir.replace(/\/+$/, '').split('/').pop()!
}

/** Navigates against this file's own server — never one another suite started. */
const goto = (page: Page, path: string) => page.goto(ORIGIN + path)

test.beforeAll(async () => {
  fixtureDir = generateFixtureRepo().dir
  // A remote that exists only in config: nothing here pushes or fetches, and
  // the link is derived from the URL string, never from reaching the host.
  execFileSync('git', ['-C', fixtureDir, 'remote', 'add', 'origin', REMOTE])
  ;({ server, origin: ORIGIN } = await spawnDemoServer(fixtureDir))
})

test.afterAll(() => {
  server?.kill()
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

test('the run header links the branch to its page on the host (AC2)', async ({ page }) => {
  await goto(page, `/runs/${sourceId()}/g2-pending`)
  const link = page.locator('[data-branch-link]')
  await expect(link).toHaveAttribute('href', 'https://github.com/acme/gateline-demo/tree/run/g2-pending')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toContainText('run/g2-pending')
})

test('a merged run names the ref it is read at, and links nothing — no dead end (AC3)', async ({ page }) => {
  // done-merged has no run branch left, so the ref shown is the default branch
  // the record is read *at* — never called "branch main", which would name a
  // branch that is not this run's.
  await goto(page, `/runs/${sourceId()}/done-merged`)
  await expect(page.locator('header')).toContainText('read at main')
  await expect(page.locator('header')).not.toContainText('branch main')
  await expect(page.locator('[data-branch-link]')).toHaveCount(0)
})
