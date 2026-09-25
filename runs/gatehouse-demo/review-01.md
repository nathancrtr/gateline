# Review Report: 01-artifact-path-route

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** `run/gatehouse-demo`, `git diff d5d2ad6 97edb9d` (828d99c harvested `contract.ts`/`app.ts`; 97edb9d tests + task notes)

## Findings

### F1 — major — Malformed percent-encoding in the path form escapes as an uncaught `URIError`, so the route answers a text/plain 500 where the query form answers a JSON 404
- **Where:** `packages/server/src/app.ts:405`
- **Failure scenario:** `GET /api/runs/fixture/g1-pending/artifact/%E0%A4%A` (or `…/artifact/%`) → `decodeURIComponent` throws → Hono's default handler → `500 text/plain "Internal Server Error"` (verified in-process). The same input on the query form, `…/artifact?path=%E0%A4%A`, → `404 {"error":"no artifact at %E0%A4%A"}`. The two forms drift on exactly the class of input a hand-typed or truncated deep link produces, and the response is not the one error shape `respond.ts` `fail()` promises for every route. Fix is inside the surface: catch the decode failure and `fail(c, 400, …)`, plus a test that pins it.
- **Requirement:** plan "Interface contracts → Server route" ("otherwise identical behaviour and body to the query form"); ADR-2; task scope "so the two forms cannot drift".

### F2 — minor — No test pins the empty-remainder 400 the plan specifies
- **Where:** `packages/server/test/app.test.ts:142-173`
- **Failure scenario:** mutant: regex group `(.+)` → `(.*)` and the `if (!remainder)` guard at `app.ts:404` removed → `GET …/artifact/` reaches `readArtifact` with `''` → `git show ref:runs/g1-pending/` → `200` with a tree listing as `content`. All five new cases still pass.
- **Requirement:** plan "Server route" (empty remainder → 400 `artifact path required`).

### F3 — minor — No test exercises a percent-encoded segment, so dropping the decode step survives the suite
- **Where:** `packages/server/test/app.test.ts:150-154`
- **Failure scenario:** mutant: `app.ts:405` becomes `const path = remainder` → all five new cases pass (none of their paths contain an encoded byte); `GET …/artifact/spec%2Emd` then 404s instead of returning `path: 'spec.md'`. One case with an encoded segment (e.g. `spec%2Emd` → 200, `path` equal to `spec.md`) kills it.
- **Requirement:** plan ADR-2 / contract doc comment ("URL-encoded per segment"); task scope ("remainder is `decodeURIComponent` of group 1").

## Coverage

I read the whole diff against requirement one and the plan's artifact-route contract, ran the workspace typecheck, lint and full test suite after installing the missing dependencies, and probed the new wildcard artifact route and the existing query route in-process with nested, encoded, double-encoded, traversal, malformed and empty paths; the only defect found is the malformed-encoding path in the first finding, and everything below is clean or pre-existing.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R1 / AC1.2 (server half) | `packages/server/src/app.ts:401-406` | path form resolves any path the recursive artifact listing names; nested file → 200 with the literal run-relative path | ✓ AC1.2 (server half; generator is task 02) |
| ADR-2 one shared helper | `packages/server/src/app.ts:373-388` | both forms call `readArtifact`; run lookup, both 404s and validation live once | ✓ |
| regex / remainder | `packages/server/src/app.ts:402-404` | group 1 anchored after `/artifact/`; empty remainder → 400 JSON; query string and fragment excluded by using `pathname` | ✓ (untested — F2) |
| decode | `packages/server/src/app.ts:405` | single decode (`%252F` stays `%2F`); `%2F` yields a slash in the path; malformed input throws | partial — F1, F3 |
| path traversal | `packages/core/src/sources/local-source.ts:237` | decoded `..` rejected by core → 404 JSON; literal `../` and `%2e%2e/` are dot-segment-normalised by URL parsing before the match → route miss 404 | ✓ |
| ADR-5 constant | `packages/server/src/contract.ts:80-85` | `FIXTURE_SOURCE_ID = 'fixture'` with the plan's doc comment | ✓ |
| ApiRoutes key | `packages/server/src/contract.ts:372-377` | wildcard key typed `ArtifactResponse`, ADR-2 doc comment | ✓ |
| API_VERSION rule | `packages/server/src/contract.ts:20-24` | header names both primitive values; version stays 1; nothing removed or narrowed | ✓ |
| `respond<K>` generic | `packages/server/src/app.ts:373-388` | tsc probe: an excess field and a missing field on the generic key both fail typecheck, so the comment's claim holds | ✓ |
| listed acceptance tests | `packages/server/test/app.test.ts:142-173` | five cases match the task's listed vitest cases one for one; deep-equal body, nested path, 404 string error, unknown run, query form | ✓ |
| toolchain claims | `packages/` | `npm ci`, then typecheck, lint and `npm test`: 1245 passed, 2 skipped | ✓ |
| Hono `*` after named params (plan risk) | `packages/server/src/app.ts:401` | matches with and without a remainder; sibling routes unaffected | ✓ |
| null byte in path | `packages/core/src/sources/local-source.ts:236-239` | both forms 500 on `%00` — pre-existing in core, identical in both forms, outside this surface | n/a (pre-existing) |
| directory as path | `packages/core/src/sources/local-source.ts:236-239` | both forms answer 200 with a git tree listing for a directory name — pre-existing, identical in both forms | n/a (pre-existing) |
| not-yet-dispatched tasks | `runs/gatehouse-demo/tasks/03-web-static-mode.yaml:66` | the `api.artifact` switch ADR-2 requires is owned by task 03; nothing this task leaves unowned | ✓ no escalation |

## Boundary check

Inside the surface. The range touches only `packages/server/src/contract.ts`, `packages/server/src/app.ts` and `packages/server/test/app.test.ts`, all three declared. The `state.yaml` hunks in the range are the orchestrator's own dispatch/meter/harvest records, and the task file change is the implementer's `notes:` block. The implementer's harvest claim checks out: 828d99c carries the src changes and they match the plan's contract line for line; 97edb9d adds only tests and notes. Worktree was clean before and after review (a transient tsc probe file was removed).

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** `git diff ac05a02 736dd24` (736dd24: `app.ts` try/catch, three new `app.test.ts` cases, task-file `notes:`); round-1 range was `d5d2ad6..97edb9d`

## Verify round
- **F1 — resolved** — `app.ts:405-410` wraps only the decode in try/catch and answers `fail(c, 400, …)`; `%E0%A4%A`, `%` and `%zz` on the path form now return `400 application/json {"error":"malformed artifact path"}` in-process, and removing the try/catch fails `app.test.ts:181` with the exact `URIError` / non-JSON body symptom.
- **F2 — resolved** — `app.test.ts:169-173` pins `…/artifact/` → 400 with a string error; the `(.+)`→`(.*)` + dropped-guard mutant fails that test (200 instead of 400).
- **F3 — resolved** — `app.test.ts:175-179` pins `spec%2Emd` → 200 with `path` equal to `spec.md`; the `const path = remainder` mutant fails it (404 instead of 200).

No new findings: the fix introduces no defect in the changed hunks.

## Coverage

I confined this round to the round-two hunks in the server app and its test file and the three prior findings: I re-ran the round-one repros and a set of neighbouring inputs in-process against a generated fixture repo, applied the implementer's three named mutants plus one of my own to the route handler and watched the new tests fail on each, and re-ran the workspace typecheck, lint and full test suite; everything is clean, and the one status-code divergence between the two forms on malformed input is the one the round-one finding prescribed.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| F1 fix scope | `packages/server/src/app.ts:405-410` | only `decodeURIComponent` sits inside the try; the `readArtifact` call is outside it, so run-lookup and git failures surface exactly as before | ✓ |
| F1 body shape | `packages/server/src/app.ts:409` | `fail()` with an `ApiErrorBody`; probe shows `application/json` and a non-empty string `error` | ✓ |
| F1 fix under mutation | `packages/server/test/app.test.ts:181-185` | try/catch removed → test fails on `URIError` / non-JSON body; catch answering 404 instead of 400 → test fails on status | ✓ |
| F2 under mutation | `packages/server/test/app.test.ts:169-173` | `(.*)` + guard dropped → 200 tree listing, test fails | ✓ |
| F3 under mutation | `packages/server/test/app.test.ts:175-179` | decode dropped → 404, test fails (the malformed case fails too, as expected) | ✓ |
| query form unchanged | `packages/server/src/app.ts:390-394` | hunks untouched; probes for `spec.md`, `spec%2Emd`, empty and malformed `path=` answer as in round 1 | ✓ |
| drift on malformed input | `packages/server/src/app.ts:409` | path form 400, query form 404 via Hono's lenient decode; both the one JSON error shape; 400 is what F1 prescribed | n/a (accepted) |
| decode before run lookup | `packages/server/src/app.ts:405` | unknown run with malformed remainder → 400 on the path form, 404 on the query form; input validation before lookup matches the existing empty-remainder guard | ✓ |
| query string ignored by path form | `packages/server/src/app.ts:402` | `spec.md?path=nope.md` → path form serves `spec.md` | ✓ |
| encoded slash and traversal | `packages/server/src/app.ts:405` | `tasks%2F01-core.yaml` → 200 with the slash decoded; `%2E%2E%2Fspec.md` and `%2F` → 404 JSON from core | ✓ |
| definite assignment on `let path` | `packages/server/src/app.ts:405` | tsc accepts the try-assigned `let`; no `!` or widening added | ✓ |
| toolchain claims | `packages/` | `npm ci`, then typecheck clean, lint clean over 224 files, `npm test` 1248 passed / 2 skipped (1245 + the 3 new cases, as the notes state) | ✓ |
| mutant claims in notes | `runs/gatehouse-demo/tasks/01-artifact-path-route.yaml:95-107` | all three named mutants reproduced with the stated failing test and symptom | ✓ |

## Boundary check

Inside the surface. 736dd24 touches `packages/server/src/app.ts` and `packages/server/test/app.test.ts` (both declared) plus the task file's `notes:` block; `contract.ts` is untouched, as the notes claim. Worktree was clean before review and is clean after: the transient probe file was removed and each of the four mutants was reverted with `git checkout` and confirmed by an empty `git status`.
