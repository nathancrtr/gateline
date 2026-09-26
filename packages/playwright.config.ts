import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Cold /api/runs walks every fixture run's git history (~4.3s measured) —
  // the 5s default expect timeout made inbox/portfolio flake under load.
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    // No baseURL: each spec spawns its own server on an OS-assigned port and
    // navigates against the origin it reads back (demo-server.ts, #438) — a
    // pinned default here would be one more fixed port a concurrent worktree
    // could collide with, and nothing left reads it.
    //
    // The default, not the only width. Behaviour and content tests run here;
    // anything about layout belongs in `e2e/geometry.spec.ts`, which builds its
    // own context and sweeps 800/900/1000/1280. #301 was filed because this pin
    // was effectively the whole suite's world view: one test in thirty ever
    // changed it, and its assertion had been written to match whatever the
    // layout did that day.
    viewport: { width: 1280, height: 900 },
  },
  // The e2e suite manages its own server (it needs the fixture repo's path
  // to assert on the commits decisions produce).
})
