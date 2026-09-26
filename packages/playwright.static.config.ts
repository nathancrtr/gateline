import { defineConfig } from '@playwright/test'

// The static render check (plan ADR-7, "Static render check"): a Playwright
// pass over a Pages-like static server (`web/scripts/serve-static.mjs`)
// serving an already-assembled demo tree — never the live cockpit, never
// `playwright.config.ts`'s `./e2e` (which stays untouched and unaffected by
// this file). `DEMO_SITE_ROOT` is the assembled tree's root — the parent of
// `demo/` — defaulting to `../_site`, the Pages workflow's own output root
// (task 06).
const root = process.env.DEMO_SITE_ROOT ?? '../_site'

export default defineConfig({
  testDir: './e2e-static',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4397',
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `node web/scripts/serve-static.mjs --root ${root} --port 4397`,
    url: 'http://127.0.0.1:4397/demo/api/health.json',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
