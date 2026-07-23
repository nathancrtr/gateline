# Review Report: 03-server-staging-routes

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit d10e809 (run/web-staging)

## Findings

### F1 — minor — AC4.1's server half (no-identity → 400 + verbatim message) is unpinned by any test
- **Where:** `frontend/packages/server/src/app.ts:241` vs
  `frontend/packages/server/test/app.test.ts:220–348` (no test drives the path).
- **Failure scenario (surviving mutant):** change line 241 to map `no-identity`
  to 409, or pre-empt `stageRun` with a differently-worded identity check (the
  thing the task's scope explicitly forbids) — the suite still passes, because
  the fixture source always resolves 'Fixture Operator'. Cheap kill without
  git-config gymnastics: a stub `RunSource` whose `identity()` resolves null
  and whose `stageRun` returns the refused/no-identity outcome, asserting 400
  and the message verbatim. The behavior itself is correct as written
  (stageRun guards at local-source.ts:406–411; the route passes its message
  through untouched); only the HTTP mapping is untested.
- **Requirement:** AC4.1 (listed in this task's acceptance_tests). The task's
  scope item 4 enumerates the required tests and omits this one, so the
  implementer followed instructions; fold in at next touch or let task 06's
  e2e cover it.

### F2 — minor — AC1.3's multi-source refusal is unpinned: a mutant that always defaults to the first source survives
- **Where:** `frontend/packages/server/src/app.ts:185–192`; all staging tests
  run against a single-source app (`test/app.test.ts:62`).
- **Failure scenario (surviving mutant):** replace lines 187–192 with
  `source = deps.sources[0]!` — every test passes, yet a two-source deployment
  posting without `source` silently stages into whichever source is listed
  first instead of refusing `invalid-input`. Cheap kill: a second
  `createApp({ sources: [a, b] })` in-test, POST without `source` → 400, with
  `source: 'b'` → stages into b.
- **Requirement:** AC1.3 (server half; the form half is task 04's). Same
  disposition as F1 — the task's enumerated test list omits it.

### F3 — minor — The invalid-input 400 family is unpinned; one mutant turns a bad profile into a 500
- **Where:** `frontend/packages/server/src/app.ts:170–177, 223–226`.
- **Failure scenario (surviving mutant):** drop the `PROFILES.includes`
  clause at line 176 — POST with `profile: 'bogus'` then reaches
  `planRunScaffold`, where `PROFILE_GATES['bogus']` is undefined and `.map`
  throws TypeError → 500 instead of 400; no test notices. Invalid JSON,
  missing required fields, unknown `source`, and the ScaffoldError path
  (e.g. slug `'Bad Slug'`) are likewise untested. The `pushFailed`
  passthrough (app.ts:232–234) is also unpinned — untestable against the
  fixture source (no push remote); an accepted gap for task 06/deploy.
- **Requirement:** plan "Server routes" response contract (the 400
  invalid-input rows).

### F4 — minor — `intake` shape is never validated, so off-contract values flow into committed YAML and defeat replay detection
- **Where:** `frontend/packages/server/src/app.ts:220` (body.intake passed
  through as-is).
- **Failure scenario:** POST with `intake: { clientKey: 123 }` (off-contract
  but expressible JSON) → `yamlScalar(123)` writes `client_key: 123` and the
  partial object's other keys interpolate as the literal string `undefined`
  (scaffold.ts:50–52 with an undefined argument); state.yaml still parses
  (intake rides schema.ts's `.passthrough()`), but `readIntake`'s
  string-guard returns null for the numeric key, so replaying the identical
  request gets 409 slug-taken instead of 200 exists — an AC8.1 violation for
  a non-conforming client. A shallow type-check of the four intake fields
  (string|null) before line 220 closes it. Requires an off-contract client;
  task 04's typed client never sends this.
- **Requirement:** R8/AC8.1 (degraded only for off-contract input); plan
  "Server routes" body contract.

## Coverage

Requirement coverage for this task's claims (R1, R2's server half, R3, R4,
R8): clean except the test gaps in F1–F3. Both routes match the plan's
"Server routes" interface contract field-for-field — GET `/api/staging`'s
per-source `{id, identity, briefSections, briefTemplate}` plus top-level
`slugPattern` (core `SLUG_PATTERN`, scaffold.ts:41), and POST `/api/runs`'s
six-row response taxonomy with the outcome discriminant always in the body
(ADR-1). The prescribed sequence holds exactly: body validation → source
resolution → section check → `planRunScaffold` → `stageRun` → `cache.bump()`
on created (task scope item 2; plan route order). No pre-empted identity
check exists — the route resolves `identity()` only to feed `stagedBy` and
lets `stageRun`'s own guard refuse, per the task's explicit instruction.

Single-truth section derivation (AC2.2): `requiredBriefSections`
(app.ts:91–94) is called by both routes on each route's own fresh
`templates.read('intent-brief.md')`, and its template-nonempty-else-builtin
logic is behaviorally identical to `validateArtifact`'s own derivation
(validate.ts:123–127) including the empty-template-falls-back-to-builtins
edge; the completeness check is core `missingSections` (validate.ts:38–41),
and the 422 message is built from its return value in the contract's exact
format, pinned verbatim by the test at app.test.ts:263. R3: the route
accepts only the nullable free-form intake quad plus clientKey — no tracker
surface.

Outcome mapping traced against the actual `StageOutcome` union
(source.ts:29–34) and `stageRun`/`scanForExisting`
(local-source.ts:365–451): created→201 with pushFailed passthrough,
exists→200, no-identity→400, slug-taken and conflict→409 — total over the
union, no unreachable arm, messages passed through verbatim (the slug-taken
message names the existing branch, satisfying AC8.2's wording demand at the
source). The CAS-race conflict arm is untestable single-threaded and is
correctly grouped with slug-taken as 409.

Tests as product, mutation reasoning on what IS pinned: wrong 422
message/missing-array, branch-created-on-refusal, second commit on replay
(tip oid pinned), wrong 409 reason or unnamed branch, wrong commit author or
staged_by, wrong arm commit message, and reordered/renamed brief sections in
GET config all die against exact-match assertions. AC1.2 is executed for all
three profiles with `parseRunState` zero-error round-trips read back through
git plumbing, plus `validateArtifact` on the patch task stub. The surviving
mutants are F1–F3's. The cache.bump-dropped mutant is only
nondeterministically caught (the arm test's `findRun` re-fetches when the
30s TTL at cache.ts:20 has lapsed — the suite runs ~48s); task 06's
post-stage-navigation signal is the plan's designated backstop (Risks).

Executed: `npx vitest run packages/server` → 2 files, 32 tests, all pass,
against a working tree whose server package is byte-identical to d10e809
(the post-d10e809 commits touch only task 05's web surface, reverted in the
worktree). `npm run typecheck` → exactly one error, the pre-existing
chips.tsx:42 'staged' member failure already recorded as review-02 F1
(task 05's surface, plan-intended per ADR-4) — this diff adds no typecheck
error; the task's "npm run typecheck passes" criterion inherits review-02
F1's disposition (discharged when task 05 lands, before G2). All three spec
grep guards (AC2.3, AC3.2, AC1.1's git-primitive grep) run clean over
`frontend/packages/server/src`. The read-route count assertions
(app.test.ts:72,81) run before the staging describe in file order, so the
five branches these tests mint don't disturb them, and the shared fixture
generator is untouched (ADR-8). Concurrency: not assessed beyond the CAS
arm noted above — the route is a thin carrier over stageRun's own race
handling.

## Boundary check

Clean. `git show --stat d10e809` lists exactly the two
`file_contact_surface` files plus the task's own yaml, whose change is a
pure zero-deletion append to `notes` — the append-only implementer log the
work-item contract prescribes (same precedent review-02 accepted). No core,
web, cli, or fixtures file is touched; the header-comment amendment
(app.ts:1–4) is the task's own scope item 3. The commit's parent is an
orchestrator state commit, so the range bounds this task's changes alone.
