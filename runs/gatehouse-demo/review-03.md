# Review Report: 03-web-static-mode

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit 866b2d9 (`git diff 866b2d9^ 866b2d9`)

## Findings

### F1 — major — Nothing in the suite pins the build-time flag or the wiring from `api` into the helpers, so the one switch ADR-4 hinges on is unguarded
- **Where:** `packages/web/src/static-mode.ts:22-25` (untested); `packages/web/test/static-mode.test.ts:64-71` is the only test that reaches the module-level `env`, and it asserts only that calls do not throw
- **Failure scenario:** three independent mutants each pass `tsc`, `vitest`, `npm run build`, `npm run build:static`, `check-bundle` and the live Playwright suite: (a) `static-mode.ts:24` compares to `'true'` (or reads a misspelt variable) → the static bundle inlines `isStatic:!1` → the demo requests `/demo/api/inbox` with no `.json`, every page errors, and `use-live.ts:17` opens an `EventSource` against `/demo/api/events` that reconnects forever — exactly AC4.2's forbidden state; (b) `api.ts:181` reverts to `fetch(path)` → same outcome for every read; (c) `api.ts:232` reverts to the query form → `readUrl` throws on every artifact open in the demo. The implementer's hand check (notes: grep of `/demo/assets/` in `dist-static/index.html`) does not discriminate either: asset URLs come from Vite's `base`, not from the flag. Task 05's render check is the plan's end-to-end proof, but it is not part of `npm test`, and this task's product is the unit that should fail first. The pin is feasible under vitest without a DOM: `vi.stubEnv('VITE_GATELINE_STATIC', '1')` + `vi.resetModules()` + dynamic `import()` gives `env.isStatic === true`, and with `vi.stubGlobal('fetch', …)` a call to `api.inbox()` / `api.artifact(…)` can be asserted to hit `/api/inbox.json` / `…/artifact/tasks/01-core.yaml.json` (verified in a scratch vitest run outside the tree; all three mutants above fail it).
- **Requirement:** R4 / AC4.2, R6 / AC6.1, plan ADR-4 ("every branch keys on the flag"), task scope item 1–2

### F2 — minor — The `?` guard's static-only condition is pinned on one side only
- **Where:** `packages/web/test/static-mode.test.ts:55-61`
- **Failure scenario:** mutant: `static-mode.ts:37` drops `e.isStatic &&` → every listed test still passes (no live case carries a `?`); a live-build GET that ever carries a query would then throw instead of fetching, breaking the task's "byte-identical live requests" constraint silently. One case, `readUrl('/api/x?y=1', LIVE)` → `/api/x?y=1`, kills it.
- **Requirement:** task scope item 1 ("throw if static and the path contains `?`"), task constraints

### F3 — minor — The empty-bundle diagnostic still names `dist/` after the directory became a parameter
- **Where:** `packages/web/scripts/check-bundle.mjs:96`
- **Failure scenario:** `node scripts/check-bundle.mjs dist-static` against a `dist-static/` that exists but holds no JavaScript → exit 1 with "no JavaScript in dist/", pointing the operator at the wrong directory; line 85 already interpolates `DIST` and this message should too.
- **Requirement:** task scope item 7

### F4 — minor — The diff adds the only lint diagnostic in the workspace
- **Where:** `packages/web/src/static-mode.ts:53`
- **Failure scenario:** `npm run lint` now reports `lint/style/useTemplate` (info, exit 0) on this line where the tree was previously silent; the auto-fix is a template literal and keeps `biome check` clean for the next person, which is the repo's standing state.
- **Requirement:** none (hygiene)

## Coverage

I read the whole diff against requirements one, four, five and six and the plan's web-client and web-build contracts, ran the web typecheck, the full web vitest suite, lint and both builds from a clean output directory, inspected the two emitted bundles for how the build-time environment was inlined, and probed the client's artifact URL grammar in-process against the merged server route over a generated fixture; the product is correct in both builds, and the findings are all in the test product and in diagnostics, not in the shipped behaviour.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R1 / AC1.2 (client half) | `packages/web/src/api.ts:202-239` | every `api` GET is a query-free path through `getJson` → `readUrl`; artifact now via `artifactPath` | ✓ AC1.2 (client half; files are task 02) |
| ADR-2 grammar agreement | `packages/web/src/api.ts:193-198` | in-process: all nine fixture artifacts of `g2-pending` (incl. `tasks/01-core.yaml`) answer 200 on the path form with a body deep-equal to the query form; `''` → 400 JSON; `a b/c?d.md` → `a%20b/c%3Fd.md` decodes back exactly | ✓ |
| ADR-2 `..` segment | `packages/web/src/api.ts:194` | `../x` is dot-normalised by URL parsing → route miss, text/plain 404 → `getJson` still raises `ApiError(404)`; no caller supplies one (paths come from the server's own list) | n/a (accepted) |
| R4 / AC4.2 | `packages/web/src/use-live.ts:15-17` | `eventsUrl()` null-checked before `new EventSource`; hook still called unconditionally at `app.tsx:155`, so hook order is unchanged | ✓ AC4.2 (runtime proof is task 05) |
| R5 / AC5.1, AC5.2 | `packages/web/src/api.ts:211,241` | POSTs go through `writeUrl` (never suffixed); the `ApiError` branches at 223-229 and 246-247 are untouched hunks | ✓ AC5.1, AC5.2 (runtime proof is task 05) |
| R6 / AC6.1 | `packages/web/src/main.tsx:32` | `basename: routerBasename()`; all in-app links are router-relative (`Link to="/…"`, `navigate('/…')` in `app.tsx`, `portfolio.tsx`, `run.tsx:209`, `new-run.tsx:171`), so they resolve under `/demo`; `window.location.search` reads in `run.tsx` are basename-independent | ✓ AC6.1 (fresh-request proof is task 05) |
| plan signatures | `packages/web/src/static-mode.ts:12-60` | `StaticModeEnv`, `env`, `pathPrefix(e)`, `readUrl(path, e?)`, `writeUrl(path, e?)`, `eventsUrl(e?)`, `routerBasename(e?)` match the contract line for line; `pathPrefix` takes a required env as the plan writes it | ✓ |
| live byte-identity | `packages/web/dist/assets/index-*.js` | live bundle inlines `{baseUrl:'/',isStatic:!1}`; `readUrl`/`writeUrl` reduce to `'' + path`; `eventsUrl` to `/api/events`; basename `/` is React Router's default | ✓ |
| static wiring (product) | `packages/web/dist-static/assets/index-*.js` | static bundle inlines `{baseUrl:'/demo/',isStatic:!0}`; no `import.meta.env` or `VITE_GATELINE_STATIC` text survives in either bundle | ✓ (untested — F1) |
| ADR-4 build mode | `packages/web/vite.config.ts:9-11` | `--mode static` → `base '/demo/'`, `outDir dist-static`; plugins and proxy hunks unchanged; both builds from clean: live `index.html` references `/assets/…`, static `/demo/assets/…`; `check-bundle` clean on both | ✓ |
| `.env.static` loading | `packages/web/.env.static:1` | root `.gitignore` ignores only `/.env`, so the file is tracked normally; the flag reached the static bundle (row above) | ✓ |
| `vite-env.d.ts` | `packages/web/src/vite-env.d.ts:1-6` | global `ImportMetaEnv` augmentation; `tsc -p web/tsconfig.json` clean | ✓ |
| `check-bundle.mjs` arg | `packages/web/scripts/check-bundle.mjs:22` | `argv[2] ?? 'dist'` resolved against `packages/web`; `scan` export and CLI guard untouched; `web/test/bundle-guard.test.ts` green | ✓ (message — F3) |
| tests vs. mutants | `packages/web/test/static-mode.test.ts:12-89` | the four mutants the notes name are killed as stated; also killed: `.json` on writes, prefix dropped on reads, trailing-slash basename, whole-path or `encodeURI` encoding in `artifactPath` | partial — F1, F2 |
| toolchain claims | `packages/` | `npm ci`; `tsc -p web/tsconfig.json` clean; `vitest run web/test` 21 files / 254 tests pass (`boundary.test.ts` green); `biome check` exit 0 with one info | ✓ |
| Playwright | — | not run this round (dispatch: no specific reason); the artifact-path change is covered by the in-process grammar probe above and the implementer reports 49/49 | n/a |
| not-yet-dispatched tasks | `runs/gatehouse-demo/plan.md` "Demo tree layout" | the client requests `artifact/<segment-encoded path>.json`; every artifact name under `runs/` is plain `[A-Za-z0-9._/-]`, so encoded and literal filenames coincide for task 02's generator | ✓ no escalation |

## Boundary check

Inside the surface. 866b2d9 touches exactly the eleven declared files plus the task file's `notes:` block; nothing under `packages/server`, `packages/core`, `e2e/` or the root config moved. Worktree was clean before review and is clean after: `npm ci` changed no tracked file, both build outputs land in ignored directories (`dist/`, `dist-static/`), and the two scratch probes lived under `/tmp` and were removed.
