# Review Report: 02-snapshot-generator

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit 0b754f2 (`git diff 667ccfe 0b754f2`)

## Findings

### F1 — blocking — Nothing in the suite discriminates the `phase: done` filter, so the one rule R2 exists for is unguarded
- **Where:** `packages/server/test/snapshot.test.ts:69-79` (the only tests of `survey`/`listRuns`); the guard they should pin is `packages/server/src/snapshot.ts:62-65`
- **Failure scenario:** the stand-in repo's default branch carries exactly one run directory (`done-merged`), so every classification branch but "included" is unreachable from the tests. Mutant: delete `snapshot.ts:62-65` (admit every run with a parseable `state.yaml`) → all 16 tests pass (verified: `vitest run server/test/snapshot.test.ts` green with the mutant applied). Against this repository the same mutant lists `fleetview-design` (release), `runner-agent` (release) and `escalation-visibility-2` (spec) in `runs.json` — the exact set the CLI's own stderr names as excluded — which is AC2.1's "no run whose `state.yaml` reads any other phase" violated with a green suite. The `state.yaml unreadable` and `no state.yaml` branches (`snapshot.ts:53-61`), the reason strings, and the slug sort at `:76` are equally unpinned (one run cannot be out of order). The task file prescribed this shape ("`survey().excluded` empty since only one run lives on the fixture's main"), but the fix is inside the surface: in `beforeAll`, commit onto the stand-in's `main` a schema-valid non-done run (copy `done-merged`'s `state.yaml` with `phase:` swapped), a second `done` run, a `state.yaml` that is not YAML, and a run directory with no `state.yaml`, then assert `survey()` names each excluded slug with its reason and `listRuns()` equals the two done slugs in order. I ran exactly that shape in-process outside the tree (four `execFileSync('git', …)` calls): the product classifies all five correctly, so only the test is missing.
- **Requirement:** R2 / AC2.1, AC2.2; plan ADR-3; task scope item 1

### F2 — major — The route, suffix and shell sets are only tested against themselves, so a dropped route survives every test
- **Where:** `packages/server/test/snapshot.test.ts:112-118, 128-135, 165-173` iterate `SNAPSHOT_GLOBAL_ROUTES`, `SNAPSHOT_RUN_ROUTES`, `ROUTE_SHELLS` imported from the module under test; the literals live at `packages/server/src/snapshot.ts:142, 145, 148`
- **Failure scenario:** mutants: remove `'/api/metrics'` from `:142`, `'/diff'` from `:145`, `'metrics'` from `:148` → all 16 tests pass (verified with all three applied at once). The demo's metrics page and every run's diff tab then 404 on the static host, and `/demo/metrics` as a fresh GET has no shell — AC1.2 names metrics and diff by name, AC6.1 names `/demo/metrics`. One `toEqual` per constant against the literal list the plan's contract writes (or iterating literal lists in the tests instead of the exports) kills all three.
- **Requirement:** R1 / AC1.2, R6 / AC6.1; plan "Snapshot generator" contract; task acceptance tests "every route in the plan's tree layout exists" and "shells exist for '', portfolio, portfolio/new, metrics"

### F3 — minor — `--repo-id` or `--web-dist` as the last argument is accepted silently and fails a minute later with a misleading route error
- **Where:** `packages/server/src/snapshot.ts:282-283` (`args[++i]!` hides the `undefined`)
- **Failure scenario:** `node src/snapshot.ts --repo <repo> --out <dir> --repo-id` → the source is constructed with `id === undefined`, the six global routes are written, `/api/runs` lists 22 runs with `source: "undefined"`, and the run exits 1 with `/api/runs/undefined/writestate-kill-window → 404` after the full global pass (verified). A trailing `--repo`/`--out` reaches the usage error correctly; the other two flags should too, and an unrecognised flag (`--bogus`) is ignored rather than refused.
- **Requirement:** task scope item 4 ("exit 1 with the error message on failure")

### F4 — minor — The per-run route assertion checks existence only, not that the file parses, which is half of the listed acceptance test
- **Where:** `packages/server/test/snapshot.test.ts:128-135`
- **Failure scenario:** the task's acceptance test reads "exists as `<route>.json` and parses as JSON"; only the global loop (`:115`) and the artifact loop (`:143`) parse. A per-run write that lands a non-JSON body (a mutant that writes `res.statusText` for suffix routes, or an upstream route that starts answering text) passes the loop. `JSON.parse` on each file in the loop is the fix.
- **Requirement:** task acceptance test "every route … exists as `<route>.json` and parses as JSON"

### F5 — minor — Encoded-request / decoded-filename split is unexercised: every fixture artifact name is plain, so the two coincide — PLAUSIBLE
- **Where:** `packages/server/src/snapshot.ts:240-247`; `packages/server/test/snapshot.test.ts:140-151`
- **Failure scenario:** mutant: `fileRoute` uses `encoded` instead of `path` → all tests pass, because no artifact in `generateFixtureRepo()` (or under this repository's `runs/`, per review-03's check) carries a byte `encodeURIComponent` changes. No real input triggers the divergence today, hence PLAUSIBLE; a fixture artifact with a space or `#` would make it concrete.
- **Requirement:** task scope item 3 ("segments `encodeURIComponent`-ed in the request, decoded in the filename")

### F6 — minor — Two temp directories per test run are created and never removed
- **Where:** `packages/server/test/snapshot.test.ts:192, 201`
- **Failure scenario:** `mkdtempSync(… 'gateline-snapshot-out2-')` and `'gateline-snapshot-fail-'` are not in the `afterAll` list at `:60-66`; each `npm test` leaves two directories (one holding six JSON files) under the OS temp dir on every machine and CI runner.
- **Requirement:** none (hygiene)

## Coverage

I read the whole diff against requirements one, two, four, six and nine and the plan's snapshot-generator and demo-tree contracts, ran the workspace typecheck, lint and full test suite, drove the generator's command line twice against this checkout (once with a fake web bundle under an isolated temp directory) and inspected the output tree file by file, probed the wrapping source in-process against a repository whose default branch carries closed, release, done, unparseable and state-less runs, and applied four mutants to the module to see which the suite kills; the shipped generator and wrapper behave correctly in every case I constructed, and every finding is in the test product or in the command line's argument handling.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R1 / AC1.1 | `packages/server/src/snapshot.ts:204-207` | every read is `app.request(route)` in-process; no import of `./main.ts` or `@hono/node-server`; `grep -E 'serve\(\|\.listen\('` on the module is empty | ✓ AC1.1 |
| R1 / AC1.2 | `/tmp` snapshot tree from the CLI run | 354 files: 6 global, 22 runs × 7 suffixes, 194 artifacts (nested `tasks/…` included); all 354 parse as JSON; matches `api.ts`'s GET list | ✓ AC1.2 (route sets untested — F2) |
| R1 / AC1.3 | `packages/cli/src` | `grep -ril snapshot` empty; `gateline --help` has no match; `package.json` script only under `packages/server` | ✓ AC1.3 |
| R2 / AC2.1 | `packages/server/src/snapshot.ts:44-69` | CLI against this checkout lists exactly the seven spec-time `done` slugs and excludes the other eight with the right reason each; cross-checked against `git show main:runs/<slug>/state.yaml` for every directory on `main` | ✓ AC2.1 (product; suite cannot pin it — F1) |
| R2 / AC2.2 | `packages/server/src/snapshot.ts:47-52` | in-process: a second schema-valid `done` run committed on the stand-in's `main` appears in `listRuns()` with no code change; `release`, unparseable and state-less siblings excluded with the contract's reasons | ✓ AC2.2 (product; untested — F1) |
| ADR-3 wrapper shape | `packages/server/src/snapshot.ts:71-77` | `RunRef {source: id, slug, ref: defaultBranch, kind: 'default', branch: run/<slug>}`, sorted; real runs in `runs.json` carry `ref: main`, `kind: default`, null origin counts | ✓ |
| ADR-3 delegation | `packages/server/src/snapshot.ts:84-138` | every `RunSource` member including the four optional ones forwards to `inner`; `templates` and `id` copied; compared against `core/src/sources/source.ts:72-145` member by member | ✓ |
| no `dir` on wrapper | `packages/server/src/snapshot.ts:79-82` | `'dir' in wrapper` false; generated `engine-health.json` is `{"engines":{"fixture":null}}` — the real source is skipped as intended | ✓ |
| ADR-5 fixture source | `packages/server/src/snapshot.ts:170-173` | `FIXTURE_SOURCE_ID` from `./contract.ts`; both sources `localOnly: true`; `health.json` lists `["gateline","fixture"]` | ✓ |
| R4 / AC4.1 | `/tmp` snapshot tree | only `api/**/*.json`, `index.html` shells and the copied bundle; no script, no POST target; module holds no listener | ✓ AC4.1 (server half; static-host proof is task 05) |
| R6 / AC6.1 | `packages/server/src/snapshot.ts:251-266` | with `--web-dist`: 26 shells — `''`, `portfolio`, `portfolio/new`, `metrics`, one per run in `runs.json`; top-level `index.html` is the bundle's own copy, not overwritten | ✓ AC6.1 (shells; render proof is task 05) |
| R9 / AC9.1 | diff | nothing under `deploy/`, no new deploy target; output path is the caller's `--out` | ✓ AC9.1 |
| non-2xx handling | `packages/server/src/snapshot.ts:206` | `!res.ok` → `Error("<route> → <status>")`; test at `:199-203` pins the message; bad `--repo` exits 1 with the git error and creates no output dir | ✓ |
| tree layout | `packages/server/src/snapshot.ts:176-186` | `<out>/api/runs/<src>/<slug>.json` beside `<slug>/` directory; artifact files at `artifact/<literal path>.json` | ✓ |
| CLI guard + cleanup | `packages/server/src/snapshot.ts:272-307` | plan's argv/`import.meta.url` idiom; excluded slugs to stderr, one-line summary to stdout; exit 0 with no lingering handle; isolated `TMPDIR` empty after the run (fixture dir removed) | ✓ (dangling flag values — F3) |
| erasable TS | `packages/server/src/snapshot.ts` | no parameter properties, enums or namespaces; runs under `node` directly; `.ts` extensions on both local imports | ✓ |
| no new deps | `packages/server/package.json` | only the `snapshot` script added; `@gateline/fixtures` already a devDependency; `package-lock.json` untouched | ✓ |
| tests vs. mutants | `packages/server/test/snapshot.test.ts` | killed: unwrapped `listRuns` (runs.json exact set), wrong `kind`/`ref`/`branch`, error-message format, top-level shell clobber; surviving: phase guard, each route/suffix/shell removal, encoded filename | partial — F1, F2, F5 |
| toolchain claims | `packages/` | typecheck clean; `biome check` 229 files clean; full `npm test` twice: first run hit one 30s hook timeout in `core/test/readiness.test.ts` while my two CLI passes were competing for CPU (passes alone, 44/44); second run (no concurrent load, tree at edb08b8 after the orchestrator harvested a sibling task mid-review) 101 files / 1287 tests passed, 2 skipped, exit 0 | ✓ |
| not-yet-dispatched tasks | `runs/gatehouse-demo/plan.md` "Pages workflow" | the plan's invocation (`node server/src/snapshot.ts … --web-dist web/dist-static` from `packages/`) matches the argv this guard parses; nothing left unowned for 05 or 06 | ✓ no escalation |

## Boundary check

Inside the surface. 0b754f2 touches `packages/server/package.json`, `packages/server/src/snapshot.ts`, `packages/server/test/snapshot.test.ts` (all three declared) plus the task file's `notes:` block; no `state.yaml`, `packages/cli`, `vitest.config.ts` or lockfile hunk. The 180s `beforeAll` timeout the notes describe is local to the test file, as claimed. Worktree: the mutants were reverted with `git checkout` and confirmed by an empty `git status`; every CLI output tree, fake bundle, isolated temp dir and probe script lived under `/tmp` and was removed. A concurrent reviewer's `review-03.md` edit was present in the tree during this review and was committed by the orchestrator mid-round; it is not mine.
