# Review Report: 05-static-render-check

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit 9a79bf7 (`git diff 9a79bf7^ 9a79bf7`)

## Findings

### F1 — blocking — The deep-link test's bare `h1` locator is strict on a page that renders two `h1`s, so the suite passes only when its first poll beats the artifact fetch
- **Where:** `packages/e2e-static/demo.spec.ts:65` (same locator at `:71`, safe there only because the fixture run lands on the decide surface)
- **Failure scenario:** `goto('/demo/runs/gateline/writestate-kill-window')` → the record surface opens `landingArtifact` (`intent-brief.md`) inside `[data-reader]`, whose `# Intent Brief: …` heading renders as a second `<h1>` (`pages/run.tsx:285` plus `FoldedMarkdown`) → `page.locator('h1')` throws a strict-mode violation ("resolved to 2 elements"), which `toHaveText` does not retry through. On the tree the task's own recipe builds: 0/1 on the first full run, 0/6 on `--repeat-each 6`, 4/10 on `--repeat-each 10`, one pass inside the mutant-B run — 5 passes in 18. The implementer's 7/7 and their negative check both sat on the winning side of this race. Wired into task 06 as written, the Pages `build` job fails regression-free pull requests most of the time, which is the second half of AC7.3 inverted. One selector kills it: `page.locator('header h1')` (or `getByRole('heading', { level: 1 }).first()` — the header's `h1` is first in DOM order, and the label check at `:66` still runs after the header has rendered).
- **Requirement:** AC6.1, AC3.1; acceptance test "`npm run e2e:static` passes against a tree built by tasks 02 and 03"; AC7.3 ("a pull request with no such regression passes it")

### F2 — minor — The `EventSource` stub has no `addEventListener`/`close`, so a constructed `EventSource` crashes the app and the test fails at the inbox-row wait instead of at the recorded-calls check
- **Where:** `packages/e2e-static/demo.spec.ts:85-91`
- **Failure scenario:** mutant: `static-mode.ts:53` `eventsUrl` returns `/demo/api/events` in static mode (applied, rebuilt, snapshotted to a side tree, restored) → `use-live.ts:19` calls `es.addEventListener` on the stub → `TypeError` thrown inside the effect at the app shell (`app.tsx:155`) → React unmounts the root → the test fails with "element(s) not found" on `[data-inbox-row]` and `window.__es` is never read. Not a false pass — no mutant reaches the final assertion with an empty `__es` — but the failure names rendering, not the connection, and the `__es` assertion the test is built around is dead code on every path that would trigger it. Three no-op methods on `RecordingEventSource` (`addEventListener`, `removeEventListener`, `close`) make the recorded-calls assertion the one that fires.
- **Requirement:** AC4.2 (diagnosability of the check, not its power)

### F3 — minor — The inbox-count assertion runs after a fresh `goto`, so it cannot observe client-side pretend state and passes against any static tree
- **Where:** `packages/e2e-static/demo.spec.ts:147-148`
- **Failure scenario:** PLAUSIBLE. Mutant: `new-run.tsx:174` `onError` seeds the query cache with an optimistic inbox item and calls `navigate('/')` → the visible inbox grows by one row on the same page; the test's fresh `goto('/demo/')` discards the cache and re-reads the static JSON, so the count matches and the test passes. The task's scope item 3 prescribes exactly this shape, so the gap is in the prescription rather than the implementation, and it stays inside the task: one same-page assertion before the `goto` — `expect(page).toHaveURL(/\/demo\/portfolio\/new$/)` after the alert renders — kills the navigate-away mutant without a client-side route change and without touching the prescribed count check. Not escalated: AC5.1's same-page chip check already carries R5's "never change what is displayed" for decisions, and AC5.2's literal wording is met.
- **Requirement:** R5 / AC5.2 ("the inbox count is unchanged after the click")

## Coverage

I read the whole diff against requirements three through seven and the plan's static-server, render-check and ADR-7 sections, ran the task's own local recipe end to end after reinstalling the worktree's missing dependencies, probed the static server directly with twenty-four hand-built requests on side ports, ran the suite eighteen times to characterise the one failure, and applied four mutants in place — two to the spec, one to the server, one to the web client — restoring each and confirming a clean tree afterwards; the server and the configuration match the task word for word, six of seven tests discriminate the mutants they were built for, and the blocking defect is a selector race that makes the seventh fail on most runs.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| server: methods | `packages/web/scripts/serve-static.mjs:71-75` | POST, PUT, OPTIONS → 405 `text/plain` with a body naming the method; HEAD → same status and headers as GET, zero bytes | ✓ |
| server: path escape | `packages/web/scripts/serve-static.mjs:62-67` | `/../../../../etc/passwd`, `%2e%2e` segments, `..%2f` and `%00`, `%zz` all 404 via prefix check on the resolved path or the decode `catch`; `//demo` parses to `/` and lands on root, no protocol-relative redirect | ✓ |
| server: 301 | `packages/web/scripts/serve-static.mjs:99-103` | `/demo/portfolio?x=1&y=2` → 301 `Location: /demo/portfolio/?x=1&y=2`; `/demo` → `/demo/`; mutant dropping `url.search` is caught by the artifact test (test 3 fails, "element(s) not found") | ✓ |
| server: directory and index | `packages/web/scripts/serve-static.mjs:104-110` | `/demo/` and `/demo/portfolio/` → 200 `text/html`; `/demo/api/runs/` (no index) → 404 with the site's page | ✓ |
| server: 404 body | `packages/web/scripts/serve-static.mjs:47-57` | root with `404.html` → 404 `text/html`, body contains "Page not found" twice; root without → 404 `text/plain` "404 not found" | ✓ AC6.2 |
| server: MIME | `packages/web/scripts/serve-static.mjs:20-29` | byte-identical to `server/src/main.ts:51-60`; `.js` → `text/javascript`, `.css`, `.json` verified; `.xyz` missing → 404 before the fallback is reached | ✓ |
| server: listen line and deps | `packages/web/scripts/serve-static.mjs:12-14,128` | imports are `node:http`, `node:fs/promises`, `node:path`; stdout reads exactly `serve-static: http://127.0.0.1:4411 ← /tmp/gl-site` | ✓ |
| server: divergence from the host | `packages/web/scripts/serve-static.mjs:112-113` | `/demo/api/health.json/` serves the file (`resolve` strips the slash); Pages likely 404s; outside the task's rule set, recorded per ADR-7's "corrected if the first publication disagrees" | n/a |
| config values | `packages/playwright.static.config.ts:10-26` | every value the task lists is present verbatim; `DEMO_SITE_ROOT ?? '../_site'`; `--list` shows 7 tests in 1 file; root config still 49 tests in 5 files, all under `e2e/` | ✓ |
| `playwright.config.ts` | `packages/playwright.config.ts` | not in the commit's stat; `testDir: './e2e'` unchanged | ✓ |
| package.json / biome.json | `packages/package.json:30`, `packages/biome.json:9` | one script, one include entry; `npm run lint` 232 files clean; `web/scripts/` remains outside biome's includes, as `check-bundle.mjs` already was | ✓ |
| typecheck | `packages/tsconfig.json:15-23`, `packages/web/tsconfig.json:16` | neither `e2e/` nor `e2e-static/` is included, so the claim "same as e2e today" holds; both `tsc` runs exit 0 | ✓ |
| AC6.1 shells | `packages/e2e-static/demo.spec.ts:45-58` | fresh `goto` per route; final response 200 after the 301; inbox, portfolio and metrics each render one `h1` (`inbox.tsx:167`, `portfolio.tsx:122`, `metrics.tsx:59`) | ✓ |
| AC6.1 / AC3.1 / AC3.2 deep links | `packages/e2e-static/demo.spec.ts:60-74` | real run: strict `h1` races the reader's second heading — F1; fixture: label `toBeVisible` + `toContainText` kills the title-only mutant review-04 named; label count 0 is ordered after the header wait | ✗ F1 |
| artifact path form | `packages/e2e-static/demo.spec.ts:76-80` | the `runs/<slug>/<path>` strip lives inside `[data-reader]` (`run.tsx:868,982`) and only after data loads; deleting `spec.md.json` from the tree → fails with received "404 Not Found" | ✓ |
| AC4.2 | `packages/e2e-static/demo.spec.ts:82-97` | `useLiveInvalidation` is at the app shell (`app.tsx:155`), so `/demo/` covers every page; `eventsUrl` mutant fails the test — via the stub crash, not the `__es` check | ✓ AC4.2, F2 |
| AC5.1 | `packages/e2e-static/demo.spec.ts:99-124` | real POST observed (a static-mode short-circuit would hang `waitForResponse`); 405 has no JSON body so `api.ts:246-247` throws `ApiError` → `Flash` `role="status"` (`decide.tsx:523`); button back to `Approve G2`; spine selector pointed at `G9` → `not.toHaveAttribute` fails "element(s) not found", so the check is not vacuous; `pending` would be the stronger positive pin, no realistic mutant found | ✓ AC5.1 |
| AC5.2 | `packages/e2e-static/demo.spec.ts:126-149` | sections read from `staging.json`, not hardcoded; 405 → `api.ts:223` `ApiError` → `network-error` → `Flash tone="bad"` is `role="alert"` (`new-run.tsx:680`); the engine-outage banner (`app.tsx:47`) is absent on the demo, so the role is unambiguous; count check cannot fail — F3 | ✓ AC5.2, F3 |
| AC6.2 | `packages/e2e-static/demo.spec.ts:151-155` | 404 status plus the site page's only `h1`; passed even against an empty tree, as it should | ✓ AC6.2 |
| AC7.3 (this task's half) | `packages/e2e-static/demo.spec.ts` | negative half proven twice (detail JSON by the implementer, artifact JSON here); positive half fails on most runs until F1 | partial — F1 |
| recipe | `runs/gatehouse-demo/tasks/05-static-render-check.yaml:112-118` | reproduced verbatim after `npm ci`: 354 routes, 22 runs, bundle clean; `e2e:static` 6/7 on the first run | ✓ as recorded, minus F1 |
| `beforeAll` picks | `packages/e2e-static/demo.spec.ts:36-43` | `runs.find` on `RunsResponse.runs[].source`; throws rather than skips on either missing | ✓ |

## Boundary check

Inside the surface. 9a79bf7 touches exactly the five declared files plus the task file's `status:` line and `notes:` block; `playwright.config.ts`, `e2e/`, `server/`, `core/` and the workflow are untouched. Mutants A and B were applied to `e2e-static/demo.spec.ts` and `web/scripts/serve-static.mjs` (both in the surface) and mutant D to `web/src/static-mode.ts` (outside it, for the round trip only); each was restored with `git checkout --`, `dist-static/` was rebuilt clean from the restored source, and `git status --short` was empty after every restore and at the end. Operational note, not a finding: `packages/node_modules` was again missing `@vitejs/plugin-react` when this round began (the implementer's notes record installing it), so I ran `npm ci --no-audit --no-fund` — gitignored, nothing tracked moved. Scratch output went to `/tmp/gl-site` (rebuilt from scratch) and `/tmp/gl-site-mut` (removed); `test-results/` is gitignored.

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit 1f5d53f (`git show 1f5d53f`; cumulative `git diff cefc790 1f5d53f -- . ':!runs/gatehouse-demo/state.yaml'`)

## Verify round
- **F1 — resolved** — `demo.spec.ts:68` now reads `getByRole('heading', { level: 1 }).first()`; a DOM probe of the served real-run page shows two `h1`s with the `<header>` one first (`writestate-kill-window`) and the reader's `Intent Brief: …` second, so `.first()` names the record heading; 70/70 on `--repeat-each=10` against a tree rebuilt from the recipe, versus 5 passes in 18 in round 1; a missing header `h1` still fails, since `.first()` would then resolve to the reader's heading, whose text is not the slug.
- **F2 — resolved** — `demo.spec.ts:99-101` adds the three no-ops `use-live.ts:19-22` calls; the round-1 `eventsUrl` mutant (rebuilt, snapshotted to a side tree) now fails at `demo.spec.ts:109` with `[["/demo/api/events"]]` received, not at the inbox-row wait.
- **F3 — resolved** — `demo.spec.ts:163` pins the URL before the `goto`; the named mutant (synchronous `navigate('/')` in `new-run.tsx` `onError`) fails at `:158` because the redirect unmounts the alert, and a `setTimeout(…, 0)` variant fails the same way 3/3; a 400 ms-deferred navigate survives because `toHaveURL` is a positive assertion that resolves before the timer fires — a residual of the task's fresh-`goto` prescription rather than of the fix, and no plausible implementation defers an error redirect, so recorded here and not held open.

No new findings: the three changed hunks introduce no defect.

## Coverage

I verified each round-1 finding against its own mutant on a demo tree rebuilt from the task's recipe (after `npm ci`), ran the full static suite ten times over, re-proved the negative acceptance check by deleting a real run's detail JSON, and reran lint, typecheck and both suite listings; the delta is confined to the three changed hunks and the task notes, and nothing outside them moved.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| F1 heading locator | `packages/e2e-static/demo.spec.ts:68,71,76` | DOM probe on the side server: real run renders two `h1`s, header first; fixture run (with and without `?decide=G2`) renders one; `getByRole` level-1 list matches `$$('h1')` order; 70/70 across `--repeat-each=10` | ✓ AC3.1, AC3.2, AC6.1 |
| F2 stub | `packages/e2e-static/demo.spec.ts:91-102` | `use-live.ts` uses exactly `addEventListener`, `removeEventListener`, `close`, all three stubbed; `eventsUrl` mutant fails at `:109` with the recorded call in the diff | ✓ AC4.2 |
| F3 URL pin | `packages/e2e-static/demo.spec.ts:163` | regex accepts the static host's 301 form `/demo/portfolio/new/`; mutants A (sync) and B (next tick) killed at `:158`; mutant C (400 ms) survives — PLAUSIBLE residual, inherent to the fresh-`goto` prescription | ✓ AC5.2 |
| negative check | `<root>/demo/api/runs/gateline/writestate-kill-window.json` | deleted → 1 failed (deep-link test, `toHaveText` "element(s) not found") / 6 passed; restored → 7 passed | ✓ acceptance test "fails when a run's detail JSON is deleted" |
| lint / typecheck | `packages/` | biome: 232 files, no fixes; `tsc -p tsconfig.json && tsc -p web/tsconfig.json` exit 0 | ✓ |
| live suite unaffected | `packages/playwright.config.ts` | root `--list` still 49 tests in 5 files, all under `e2e/`; static `--list` 7 tests in 1 file | ✓ |
| unchanged files | `serve-static.mjs`, `playwright.static.config.ts`, `package.json`, `biome.json` | absent from 1f5d53f's stat; round-1 coverage rows stand | ✓ |
| notes accuracy | task file notes, "Implementer round 2" | every claim (70/70, F2 failure site, F3 alert-site failure, negative check, lint, typecheck, listings) reproduced here | ✓ |
| AC5.1, AC6.2, artifact path form | `packages/e2e-static/demo.spec.ts:82-86,112-137,169-173` | hunks unchanged since round 1; passed 10/10 each in the repeat run | ✓ |

## Boundary check

Inside the surface. 1f5d53f touches `packages/e2e-static/demo.spec.ts` and the task file's `notes:` block only; the cumulative range `cefc790..1f5d53f` is exactly the five declared files, the task file, and this review. Mutants were applied to `web/src/static-mode.ts` and `web/src/pages/new-run.tsx` (outside the surface, for the round trip only), each restored from a backup copy with `dist-static/` rebuilt from the restored source, and `git status --short` was empty after every restore and at the end. Operational note, not a finding: `packages/node_modules` again lacked `@vitejs/plugin-react` when the round began, so I ran `npm ci --no-audit --no-fund` (gitignored). Scratch trees `/tmp/gl-site-r2` and `/tmp/gl-site-mut-r2` and the helper scripts under `/tmp` were removed; Playwright's `test-results/` is gitignored.
