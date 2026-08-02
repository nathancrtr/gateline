import { defineConfig } from 'vitest/config'

/**
 * # What each test layer is for (#301)
 *
 * Three layers, and picking the wrong one is how a whole class of defect goes
 * uncaught. In order of what to reach for first:
 *
 * **1. Pure derivation — the default.** A module under some package's `test/`
 * directory, against `core`'s record → sources → view-model layers, or against
 * `web/src`'s own derivations (`landing`, `rounds`, `spine`, `surface`,
 * `portfolio`'s exported marks). No React, no DOM. Most questions
 * about *what the UI says* are really questions about a derivation, and belong
 * here.
 *
 * **2. Component structure — `renderToStaticMarkup`, no DOM needed.** A `.ts`
 * test file may import a `.tsx` component and render it to a string with
 * `renderToStaticMarkup` from `react-dom/server`. The `include` glob above
 * constrains the *test file's* extension, not what it imports, so this needs no
 * jsdom, no `@testing-library/*`, no new dependency, and no config change.
 * `web/test/findings.test.ts` is the worked example: it wraps the component in
 * `MemoryRouter` + `QueryClientProvider` and asserts on the markup.
 *
 *     const html = renderToStaticMarkup(
 *       createElement(MemoryRouter, null,
 *         createElement(QueryClientProvider, { client: new QueryClient() },
 *           createElement(FindingCard, { finding }))))
 *
 * Reach for this before extracting a pure function purely to make a `.tsx`
 * testable. PR #300 did that extraction as a workaround and it turned out to be
 * unnecessary; two implementers in one wave answered the same question two
 * different ways, which is why it is written down here.
 *
 * What static markup cannot reach is interaction and effects — clicks, state
 * transitions, focus, `useEffect`. Adding `jsdom` (or `happy-dom`) plus
 * `@testing-library/react` and widening the glob to `.tsx` is the answer *when
 * a test needs those*, decided on that evidence. It is not the answer to "I
 * want to assert on a component".
 *
 * **3. Geometry — Playwright, and nowhere else.** Neither static markup nor
 * jsdom performs layout, so neither can ever assert wrap, overflow, width, or
 * visibility. Do not let either become the place geometry is *believed* to be
 * covered. Width-dependent behaviour goes in `e2e/geometry.spec.ts`, which
 * sweeps every fixture state at 800/900/1000/1280 and asserts invariants.
 */
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
