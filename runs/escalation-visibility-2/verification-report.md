# Verification Report: escalation-visibility-2

**Change verified:** run/escalation-visibility-2 @ e94267f (merge-base 70947d88bd2c678008273f322267536c8c6ec621)
**Environment:** local — macOS/Darwin 25.3.0, Node v24.12.0, npm workspace in `frontend/`; Playwright chromium via `npx playwright test` (browsers already present, no install needed); a scratch fixture repo generated with `npx tsx fixtures/src/main.ts /tmp/verify-fixture-repo` and a scratch server instance on `localhost:4599` for direct HTTP verification. All scratch artifacts removed before finishing; nothing committed.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |
| AC1.3 | verified | see E3 |
| AC1.4 | verified | see E4 |
| AC2.1 | verified | see E5 |
| AC2.2 | verified | see E6 |
| AC2.3 | verified | see E8 |
| AC3.1 | verified | see E9 |
| AC3.2 | verified | see E7 |
| AC4.1 | verified | see E10 |
| AC4.2 | verified | see E11 |
| AC4.3 | verified | see E12 |

### E1 — AC1.1
Ran the implementer's targeted unit test directly, then confirmed by hand
against a scratch fixture served over real HTTP (E6/E7 below carry the HTTP
proof of the same shape). The unit test feeds `parseRunState` a document with
an out-of-enum `phase` and a fully well-formed `escalations` array:
```
$ npx vitest run packages/core/test/escalation-recovery.test.ts -t "AC1.1"
 ✓ packages/core/test/escalation-recovery.test.ts (1 test)
   ✓ AC1.1: an out-of-enum phase with well-formed escalations recovers the list; state stays null, error unchanged
Test Files  1 passed (1)
     Tests  1 passed (1)
```
The test asserts `result.state === null`, `result.error` matches
`/does not match the contract/` and `/phase/`, and `result.bestEffortEscalations`
equals the two well-formed entries in order. Independently confirmed at the
server layer: `GET /api/runs/verify-fixture-repo/esc-recovered` returns
`"state": null`, a non-null `stateError` naming the phase violation, and a
populated `recoveredEscalations` array (E7).

### E2 — AC1.2
```
$ npx vitest run packages/core/test/escalation-recovery.test.ts -t "AC1.2"
 ✓ AC1.2: the existing YAML-parse-failure fixture recovers nothing — byte-for-byte unchanged
```
The test feeds `parseRunState` the exact `bad-state` fixture string
(`run: bad-state\nbranch: run/bad-state\nphase: [this is\n  not: valid yaml for a phase\n`)
and asserts the whole result object equals `{ state: null, error: <the
existing YAML-parse message> }`, with `'bestEffortEscalations' in result ===
false`. Also confirmed live against the scratch server:
```
$ curl -s http://localhost:4599/api/runs/verify-fixture-repo/bad-state | python3 -c "import json,sys; print('recoveredEscalations' in json.load(sys.stdin))"
False
```

### E3 — AC1.3
```
$ npx vitest run packages/core/test/escalation-recovery.test.ts -t "AC1.3"
 ✓ AC1.3: a malformed escalation entry (resolved as a string) recovers nothing, even though a well-formed sibling entry sits right beside it
 ✓ AC1.3: a malformed escalation entry (missing reason) recovers nothing, even though a well-formed sibling entry sits right beside it
```
Both cases place one well-formed escalation entry next to one malformed
entry (`resolved: "false"` as a string; a missing `reason`) and assert
`'bestEffortEscalations' in result === false` — the whole list is discarded
rather than partially salvaged, matching R1's "recovery never invents,
repairs, or guesses" rule.

### E4 — AC1.4
```
$ npx vitest run packages/core/test/escalation-recovery.test.ts -t "AC1.4"
 ✓ AC1.4: extra violations in tasks/gates still recover only escalations — state stays null, nothing else reconstructed
```
The fixture adds a second unrelated violation (`gates.G1.approved: "yes"`,
`tasks` shaped wrong) on top of the AC1.1 phase violation. The test asserts
`state` stays `null` and `bestEffortEscalations` still recovers the one
well-formed escalation — no task or gate data appears anywhere in the parse
result, because `StateParseResult` has no such fields to leak through.

### E5 — AC2.1
Built the real server (`createApp` from `packages/server/src/app.ts`) over a
freshly generated fixture repo and hit it with `curl`, independent of the
implementer's own server test:
```
$ curl -s http://localhost:4599/api/runs | python3 -c "...runs[].slug=='esc-recovered'..."
{
  "malformed": "state.yaml does not match the contract: phase: Invalid enum value...",
  "escalationsOpen": 2,
  ...
}
```
`GET /api/runs`'s matching entry for `esc-recovered` reports
`escalationsOpen: 2`, matching the fixture's two `resolved: false`
escalations (N = 2).

### E6 — AC2.2
```
$ curl -s http://localhost:4599/api/runs/verify-fixture-repo/esc-recovered | python3 -m json.tool
{
  "summary": { "escalationsOpen": 2, "malformed": "state.yaml does not match the contract: phase: Invalid enum value...", ... },
  ...
}
```
The same run's `GET /api/runs/:src/:slug` response has
`summary.escalationsOpen === 2`. The implementer's own
`packages/server/test/escalation-recovery.test.ts` asserts the same value and
passed in the full suite run (`npm test`, see below).

### E7 — AC3.2
```
$ curl -s http://localhost:4599/api/runs/verify-fixture-repo/esc-recovered | python3 -m json.tool
{
  ...
  "recoveredEscalations": [
    {"at": "2026-07-25T22:46:56.000Z", "from_role": "implementer", "reason": "file_contact_surface conflict with a parallel task; escalating rather than guessing which owns the shared module"},
    {"at": "2026-07-25T22:46:56.000Z", "from_role": "verifier", "reason": "AC2.2 unverifiable: the oversized-input fixture referenced by the spec is missing from the repo"}
  ]
}
```
The top-level `recoveredEscalations` key names exactly the two open entries
with `at`/`from_role`/`reason`, omitting the third (`resolved: true`) entry.

### E8 — AC2.3
```
$ npx vitest run packages/core/test/escalation-recovery.test.ts -t "AC2.3"
 ✓ buildPortfolio: RunSummary.escalationsOpen counts only the recovered unresolved entries (N=2)
 ✓ deriveReadiness: the malformed item leads, followed by one non-reviewable escalation item per open recovered entry
```
This exercises `buildPortfolio()` — the function `agentic status`/`agentic
inbox` both call — directly against a test-local schema-invalid git branch
(not the server), independent of the server layer as AC2.3 requires, and
asserts `summary.escalationsOpen === 2`.

### E9 — AC3.1
Ran the real CLI against the scratch fixture repo:
```
$ npx tsx packages/cli/src/main.ts --repo /tmp/verify-fixture-repo inbox
...
malformed    1d  verify-fixture-repo/esc-recovered  Malformed run state
                 ✕ BOUNCED: state.yaml does not match the contract: phase: Invalid enum value...
escalation   1d  verify-fixture-repo/esc-recovered  Escalation from implementer — file_contact_surface conflict with a parallel task; escalating rather than guessing which owns the shared module
escalation   1d  verify-fixture-repo/esc-recovered  Escalation from verifier — AC2.2 unverifiable: the oversized-input fixture referenced by the spec is missing from the repo
```
One line per open recovered escalation names both `from_role` (in the title)
and `reason` (after the em-dash), alongside the pre-existing malformed-run
line — both requirements of AC3.1 satisfied in the same output.

### E10 — AC4.1
Ran the real Playwright e2e suite against a built web bundle and a live
server, not just read the test source:
```
$ npm run build && npx playwright test
✓ e2e/smoke.spec.ts:55:1 › recovered escalations show role and reason with no resolve control (AC4.1) (257ms)
✓ e2e/smoke.spec.ts:66:1 › a schema-valid run keeps its resolve control (253ms)
15 passed (15.5s)
```
The first test navigates to the `esc-recovered` run page, asserts two
`Escalation from …` cards render with their reason text, and asserts
`page.locator('[data-decide="resolve"]')` has count 0. The second test is
the regression guard: the same locator has count 1 on a schema-valid run
(`escalated`) that does carry a real, actionable escalation — proving the
fix is `reviewable`-gated, not a blanket removal of the Resolve button.

### E11 — AC4.2
```
$ curl -s -X POST http://localhost:4599/api/decisions -d '{"source":"verify-fixture-repo","slug":"esc-recovered","action":"resolve-escalation","escalationIndex":0,"notes":"test"}' -w "\nHTTP_STATUS:%{http_code}\n"
{"error":"run state is malformed: state.yaml does not match the contract: phase: Invalid enum value..."}
HTTP_STATUS:409

$ curl -s -X POST http://localhost:4599/api/decisions -d '{"source":"verify-fixture-repo","slug":"esc-recovered","action":"approve","gate":"G2","burden":"confirmation"}' -w "\nHTTP_STATUS:%{http_code}\n"
{"error":"run state is malformed: state.yaml does not match the contract: phase: Invalid enum value..."}
HTTP_STATUS:409
```
Also confirmed `decline` returns the same 409 in the implementer's server
test (`escalation-recovery.test.ts`, "AC4.2: decline still returns the
malformed-state refusal"), which passed in the full suite run. All three
actions (`resolve-escalation`, `approve`, `decline`) against the AC1.1-shaped
fixture's slug are refused with the existing 409, unchanged.

### E12 — AC4.3
```
$ grep -rln "recoveredEscalations\|bestEffortEscalations" frontend/packages --include="*.ts" --include="*.tsx"
frontend/packages/core/src/record/schema.ts
frontend/packages/core/src/view-model/readiness.ts
frontend/packages/core/src/view-model/portfolio.ts
frontend/packages/server/src/app.ts
(+ the two new test files)
```
Every production hit is a pure field on an existing parse/derivation result
(`StateParseResult`, `RunSummary`, `InboxItem[]`, the run-detail payload) or a
projection computed inline in the route handler — no new file, class, or
persisted structure appears. `GenerationCache` (`packages/server/src/cache.ts`)
predates this change (absent from the diff's file list) and is the same
request-scoped, recomputed-per-read cache every other route already uses, not
a new store.

## Beyond the happy path

I probed a few things the acceptance criteria did not name directly, beyond
running the suites and hand-driving the CLI, server, and web UI above.

- A schema-invalid run with an absent `escalations` key, and one where the
  key is present but not an array, both recover nothing (core test: "absent
  escalations key recovers nothing").
- A schema-*valid* document never carries `bestEffortEscalations` at all,
  and its Resolve button still renders — confirmed live in the e2e run
  ("a schema-valid run keeps its resolve control").
- The orchestrator's dry-run tick over the full fixture repo, including the
  new `esc-recovered` run, still derives rule D0 ("rest") rather than
  dispatching on the recovered escalations — the risk the plan calls out
  explicitly.
- `npm run typecheck` passed with no new `any` or suppressed errors from the
  optional-field plumbing.

Full suite for a second cross-check beyond the targeted runs above:
```
$ npm test
 Test Files  45 passed | 1 skipped (46)
      Tests  412 passed | 1 skipped (413)
```
(The one skip is `live-smoke.test.ts`, pre-existing and unrelated — it needs
live provider credentials.)

## Gaps

Two things fall short of full independent proof, and neither changes a
verdict above.

- A coverage-strength gap, first flagged by review-05, is real but does not
  affect any acceptance criterion. The CLI's malformed-line assertion in
  `cli.test.ts` checks only that the line is present (`toBeTruthy()`), not
  that its tail is unchanged. A mutant that appends a reason suffix to
  malformed lines too would slip through that one assertion. The full CLI
  suite still catches such a mutant elsewhere, which the reviewer verified in
  a scratch worktree, and AC3.1 itself is unaffected. I did not add a test
  for it since it falls outside any spec acceptance criterion.
- I did not independently re-derive the mutation-testing claims cited in the
  task reviews (review-01 through review-05). I relied instead on running the
  resulting test suites myself and reading the diffs, which is the
  verifier's own evidence bar rather than a re-run of mutation analysis.
