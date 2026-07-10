import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4399',
    viewport: { width: 1280, height: 900 },
  },
  // The e2e suite manages its own server (it needs the fixture repo's path
  // to assert on the commits decisions produce).
})
