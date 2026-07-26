# Review Report: 03-server-surface

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 81c70b4 (branch run/escalation-visibility-2; sibling commits for tasks 04/05 and all state commits excluded as out of scope)

## Findings

### F1 — blocking — the recovered entries' `at` value is unbound: a mutant that nulls it survives every test
- **Where:** `frontend/packages/server/test/escalation-recovery.test.ts:60-64` (only `toHaveProperty('at')`); mutant site `frontend/packages/server/src/app.ts:282`
- **Failure scenario:** mutant verified surviving — change the projection to `at: null` in app.ts:282; all 8 new tests pass (`toHaveProperty` accepts a null value, and neither `toMatchObject` names `at`), yet every recovered entry's timestamp is erased from the payload AC3.2 exists to pin. The exact value is computable and I verified it round-trips: `new Date((fixture.now - 86400) * 1000).toISOString()` matches the payload's `at` for both open entries (`FixtureRepo` exposes `now`; the fixture writes both at now − 1 day).
- **Requirement:** AC3.2 (names `at` as one of the three fields); task scope item AC3.2 ("at fields matching the fixture's open entries").

### F2 — major — the projection shape is unbound: a mutant that leaks the whole escalation entry survives
- **Where:** `frontend/packages/server/test/escalation-recovery.test.ts:59-72` (no exact-equality assertion); mutant site `frontend/packages/server/src/app.ts:282`
- **Failure scenario:** mutant verified surviving — replace the projection with `.map((e) => ({ ...e }))`; all 8 tests pass, yet the payload now carries `resolved`, `resolved_by`, `resolved_at`, `resolution`, and — because `escalationSchema` is `.passthrough()` — any arbitrary key present in the malformed state.yaml, straight to API consumers. ADR-5 pins the projection to exactly `{ at, from_role, reason }`.
- **Requirement:** plan ADR-5; task scope item 1 ("projected to { at, from_role, reason }"). One fix kills both F1 and F2: replace the per-property checks with a single `toEqual` of the two exact expected objects (expected `at` from `fixture.now` as above) — that also preserves the order and open-only kills already in place.

## Coverage

I re-ran the server suite at the reviewed commit, applied five mutants to the route by hand, and checked the implementation against the plan's server contract line by line; everything except the two findings came back clean.

- ADR-5 implementation ✓ — spread-conditional key, open-only filter, list order, `{at, from_role, reason}` projection, computed inside the cached payload builder; matches the plan's contract exactly (app.ts:279-283).
- AC1.2 rider ✓ — absent-not-null bound: my null-instead-of-absent mutant fails the bad-state key-absence test (1 failed / 7 passed). Full byte-identity is untestable at this layer (the payload carries a live `now`), and the task's own acceptance list defines the rider as key absence, which the test implements faithfully.
- R2 counting ✓ — AC2.1 and AC2.2 assert the recovered count 2 plus a non-null malformed message; the values relay core's approved task-01 derivations unchanged.
- R4 write refusal ✓ — all three actions (resolve-escalation with index+notes, approve with gate+burden, decline with gate+notes) reach the untouched `if (!state) → 409` guard and the tests pin status and a /malformed/ message; the diff confirms POST /api/decisions is untouched.
- R4 item shape ✓ — 2 escalation items with `reviewable false` and null `escalationIndex` asserted; the weak-looking `some(kind !== 'escalation')` check is adequate for this fixture because a null-state run derives only the malformed item plus recovered items, so dropping the malformed item flips it false.
- Mutation checks run: `at: null` (survives — F1), whole-entry leak (survives — F2), null-instead-of-absent (killed), include-resolved (killed), reversed order (killed); dropped-`at`-key and misspelled-key mutants killed by construction (`toHaveProperty`, `toHaveLength` on undefined).
- Type safety ✓ — `escalationSchema` transforms nullish `at`/`from_role` to null, so the projection can never emit undefined-dropped keys; the plan's `at: string | null` payload type holds even for entries missing optional fields.
- Verification ✓ — `npx vitest run packages/server` 43/43 green re-run by me at the reviewed tree; the implementer's router.test.ts full-suite timeout reproduced passing in isolation (6/6, ~8s), consistent with their contention-flake attribution. Full-suite re-run not attempted by me: a sibling task's implementer was live in this checkout, so a concurrent full run would not be attributable evidence.
- Not assessed: web/CLI surfacing (tasks 04/05); core derivation internals beyond the relay (task 01, already approved).

## Boundary check

Clean. Commit 81c70b4 touches exactly the two declared surface files plus the task YAML's own `notes:` block, the accepted implementer report channel. No fixture, core, lockfile, or sibling-package change. (Unrelated to the diff: the branch advanced under this checkout mid-review as tasks 04/05 landed their own commits; nothing from them is reviewed here.)
