import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['*/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Bound the worker pool (#227). Vitest's default forks one process per
    // core — 14 on the maintainer's machine — and the engine dispatches
    // implementers with no concurrency cap, each of which `roles/implementer.md`
    // requires to run this whole suite. The default multiplies out to tens of
    // GB across concurrent dispatches. 4 keeps a single run brisk while leaving
    // headroom for peers; raise it locally via `--maxWorkers` when running
    // interactively on an idle machine.
    poolOptions: { forks: { maxForks: 4, minForks: 1 } },
  },
})
