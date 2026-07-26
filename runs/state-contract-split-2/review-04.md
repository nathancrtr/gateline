# Review Report: 03-generic-read-path

<!-- Round-1 report for task 03-generic-read-path. Report filenames in this
     run are sequential across tasks, not per-task (review-01 =
     01-contracts-split, review-02 = 04-docs-landed, review-03 =
     02-state-contract-resolution), so this report takes the next number, as
     review-02.md and review-03.md did. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 9257ca6 on `run/state-contract-split-2`; verified
`git diff 9257ca6 HEAD -- frontend/packages/core/` is empty (the only later
commits are orchestrator state bookkeeping), so no later commit altered this
task's file-contact surface.

## Findings

The implementation matches the plan's view-model and read-path contracts on
every point I checked; all findings are test-discrimination gaps in the new
test file, the same failure family review-03 bounced on one layer down.
Dispatch barred me from editing source, so mutants below are proven by
inspection of the fixture, not executed — each survival argument is mechanical.

### F1 — blocking — the generic gate-cell construction has no discriminating test: gateOrder use and the undecided-cell fallback are both unpinned
- **Where:** `frontend/packages/core/test/generic-host.test.ts:31-38` (fixture)
  vs `frontend/packages/core/src/view-model/portfolio.ts:113`
- **Failure scenario:** two surviving mutants. (a) Replace `generic.gateOrder`
  with `Object.keys(generic.gates)` — the fixture's file order equals contract
  order and every declared gate is present, so the AC4.2 test passes; a host
  file listing gates out of declared order renders cells misordered, and a
  declared-but-absent gate loses its cell (plan: "one cell per gateOrder entry").
  (b) Replace `generic.gates[id] ? cell(...) : UNDECIDED_CELL` with
  `cell(generic.gates[id]!)` — the fallback is dead code under this suite
  (both declared gates are present in `DEMO_RUN_STATE`), and a legitimate
  generic run state omitting a declared gate (absent = undecided, per the plan's
  generic schema semantics) then throws reading `.approved` of `undefined`,
  which `buildPortfolio` does not catch — one such run takes down the whole
  fleet view. Kill both with one case, mirroring review-03 F3's kill fixture:
  a run state with gates out of contract order and one declared gate absent,
  asserting exact `Object.keys(summary.gates)` and the absent gate's
  undecided cell.
- **Requirement:** AC4.2; plan "view-model deltas" (gates: one cell per
  gateOrder entry); plan generic schema semantics (absent = undecided).

### F2 — minor — the generic summary's remaining derived fields have no discriminating test
- **Where:** `frontend/packages/core/src/view-model/portfolio.ts:84-115`
  (`phase` fallback, `pausedReason`, `escalationsOpen`)
- **Failure scenario:** surviving mutants: `escalationsOpen:
  generic.escalations.length` (no resolved filter — fixture escalations are
  empty), `phase: generic.phase ?? 'unknown'` (fixture declares a phase;
  AC4.2 forbids `unknown` by name), `pausedReason: null` (fixture
  paused_reason is null). The F1 kill fixture extended with a `paused_reason`,
  no `phase` key, and one resolved plus one unresolved escalation kills all
  three alongside F1's.
- **Requirement:** AC4.2; plan "view-model deltas" (field-by-field spec).

### F3 — minor — UNDECIDED_CELL is one shared mutable object across every absent gate in every summary
- **Where:** `frontend/packages/core/src/view-model/portfolio.ts:59` vs the
  `emptyLedger` idiom at `portfolio.ts:158-161` (fresh `{ ...c }` per cell)
- **Failure scenario:** PLAUSIBLE — no current consumer mutates a
  `GateLedgerCell`, so none constructible today; recorded because the file's
  own existing code deliberately clones per cell, and a future consumer
  annotating cells in place would contaminate every absent-gate cell in every
  generic summary at once. `Object.freeze` or per-entry spread closes it in
  one token.
- **Requirement:** none violated; view-model purity idiom only.

## Coverage

Everything outside the three findings was checked and is clean: the
implementation follows the plan's interface contracts exactly, I ran the full
suite and typecheck myself with the claimed results, and the gaps are all in
how hard the new tests pin the new branch.

- Plan interface conformance ✓ — local-source memoization, the readiness
  early return, and every field of the portfolio generic branch match the
  plan's "view-model deltas" and "local-source deltas" verbatim, including
  `profile: 'full'` commented as the ADR-6 typed filler
- Memoization ✓ — promise-cached per source exactly like
  `memoizedFrameworkRoots` (framework-roots.ts:83-89), including the
  cached-rejection stance; one resolution shared by both `readState` and
  `stateHistory`, and no invalidation is needed because templates read from
  the default branch, the same lifetime assumption `frameworkRoots` already makes
- Readiness paths ✓ — a failed generic parse sets `generic: null`
  (schema.ts:205), so malformed generic-host states still get the malformed
  card; the missing-file return carries no `generic` field and is untouched;
  every SDLC path byte-identical, readiness.test.ts unedited and passing
- GateLedgerMap statics ✓ — the widened intersection type is the plan's
  exact ADR-3/ADR-4 type; typecheck across cli/web/server/orchestrator is
  clean, confirming static `GateId` access held; the runtime-absent `G0` on a
  generic summary is ADR-4's named consequence deferred by ADR-6, documented
  in the type's doc comment, not a new defect
- Undecided-cell equivalence ✓ — the implementer-note claim holds:
  `undecidedGate()` in schema.ts is private and returns a `GateEntry`, not a
  `GateLedgerCell`, and `cell()` of an all-null entry yields exactly
  `UNDECIDED_CELL`'s values (`decided: g.approved || g.by !== null` → false),
  so the local helper is equivalence, not drift
- AC5.1 / acceptance run ✓ — ran `npm test` (419 passed, 1 skipped, 45+1
  files) and `npm run typecheck` (clean, both tsconfig projects) myself;
  no existing test file is touched by the commit
- AC3.1 ✓ — real-repo.test.ts absent from the diff and passing in the suite
- AC5.2 guard ✓ — the wordfreq assertions duplicate real-repo.test.ts's
  phase check and add an exact gate-key-set assertion real-repo lacks (guards
  against generic keys leaking into SDLC summaries); no rot risk, since
  completed runs are historical records by repo invariant
- stateHistory threading ✓ — verified present, though behaviorally inert
  today: only `.state` is retained and it is null for generic runs under
  either contract; matches the plan's instruction regardless
- Test hygiene ✓ — per-test `mkdtempSync` fixtures removed in `afterEach`
  (splice + recursive force rmSync, failure-safe), gitconfig isolated with
  the code-tree.test.ts idiom
- Lockfile ✓ — the commit contains no package-lock change; I reproduced the
  same platform-metadata churn on fresh install and reverted it, tree clean
- Concurrency not assessed — no concurrent access in this diff's scope

## Boundary check

The commit touches exactly the four declared surface files plus the task's own
`tasks/03-generic-read-path.yaml` (status/notes bookkeeping — the
implementer's report channel, treated as non-product surface as in review-02
and review-03). Nothing outside `frontend/packages/core` changed, so the
task's no-diff-outside-core acceptance test and AC6.1 hold, and no other
task's work rides in the diff.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 22753d8 on `run/state-contract-split-2`; verified
`git diff 22753d8 HEAD -- frontend/packages/core/` is empty (later commits are
orchestrator state bookkeeping only), and the cumulative task diff
`9675807..HEAD` touches exactly the four declared surface files plus this
report and the task's own YAML.

## Resolution of round-1 findings

Dispatch again barred editing source or test files, so each mutant kill below
is proven by mechanical reasoning about the committed fixture — the
implementer's claimed mutant executions were not taken on faith, each failure
mode is re-derived independently — plus my own run of the full suite.

- **F1 — resolved.** The kill fixture's contract declares gates in order
  intake/review/publish (`gateIds` preserves template key order,
  state-contract.ts:44); the run file lists publish then intake and omits
  `review`. Mutant (a) `Object.keys(generic.gates)`: parseGeneric passes the
  file's own key order through (record/schema.ts:214), so keys would be
  `['publish','intake']` — the exact-order assertion
  (generic-host.test.ts:167) fails on both order and the dropped `review`.
  Mutant (b) unguarded `cell(generic.gates[id]!)`: `generic.gates['review']`
  is `undefined`, so `cell` throws reading `.approved` (portfolio.ts:52),
  failing both new tests. The undecided shape and both present-gate cells
  (including `decided: true` via non-null `by`) are asserted exactly
  (generic-host.test.ts:167-170).
- **F2 — resolved.** Same fixture: no `phase` key (the generic schema
  normalizes absent to null, record/schema.ts:179, so `?? '—'` is the only
  path to the asserted `'—'` and the `?? 'unknown'` mutant fails); a non-null
  `paused_reason` asserted verbatim (the `null` mutant fails); one resolved
  plus one unresolved escalation with `escalationsOpen` asserted `1` (the
  unfiltered `.length` mutant yields 2 and fails). Both escalation entries
  satisfy escalationSchema (only `reason` and `resolved` are required,
  record/schema.ts:89-99), so the fixture parses — confirmed by the passing
  run, not assumed.
- **F3 — resolved.** portfolio.ts:85 now spreads `{ ...UNDECIDED_CELL }` per
  absent-gate entry, matching the file's own `emptyLedger` idiom; the new
  reference-inequality test (generic-host.test.ts:179-187) asserts the
  absent-gate cells of two independent `summarizeRun` calls are distinct
  objects, which the shared-instance mutant fails (same reference both
  times). Present-gate cells were already fresh via `cell()`.

## Findings (round 2)

None.

## Coverage (round 2)

The round-2 diff is a one-token source fix plus one new test block, and
everything in it checked clean.

- F1/F2/F3 kill discrimination ✓ — each argued mechanically above
- Fixture parse mechanics ✓ — the kill run state is valid under the generic
  schema (gate entries and escalations schema-valid, the unquoted author name
  parses as a plain YAML string), and `Object.fromEntries` preserves
  insertion order for these non-numeric keys, so the exact-order assertion is
  deterministic
- Source-change minimality ✓ — the portfolio.ts diff is exactly the
  per-entry spread; the generic branch is otherwise byte-identical to round 1
- Test hygiene ✓ — the kill-fixture repo registers in the shared cleanup
  list and reuses the gitconfig isolation idiom
- Acceptance run ✓ — ran `npm test` (45 passed + 1 skipped files, 421 passed
  + 1 skipped tests — round 1's 419 plus the two new cases) and
  `npm run typecheck` (clean, both tsconfig projects) myself; targeted run of
  generic-host.test.ts: 7 of 7 passing; reverted my own install's
  package-lock churn, tree clean
- AC4.1 / AC4.2 / AC4.3 ✓ — the four round-1 test cases unchanged and passing
- AC3.1 / AC5.2 ✓ — real-repo.test.ts absent from the cumulative diff and
  passing; the wordfreq regression guard passing
- Round-1 section integrity ✓ — this round is appended only; the round-1
  content above is untouched

## Boundary check (round 2)

Commit 22753d8 touches `frontend/packages/core/src/view-model/portfolio.ts`,
`frontend/packages/core/test/generic-host.test.ts`, and the task's own
`tasks/03-generic-read-path.yaml` (status/notes bookkeeping, the implementer's
report channel as in prior rounds) — all inside the declared surface. Nothing
outside `frontend/packages/core` changed, no later commit touched the
surface, and the cumulative diff carries no other task's work.
