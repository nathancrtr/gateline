# Review Report: 01-artifact-path-route

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** request-changes
**Round:** 1 of 3
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
