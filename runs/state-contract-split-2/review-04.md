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
