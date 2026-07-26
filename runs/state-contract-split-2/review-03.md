# Review Report: 02-state-contract-resolution

<!-- Round-1 report for task 02-state-contract-resolution. Report filenames in
     this run are sequential across tasks, not per-task (review-01 =
     01-contracts-split, review-02 = 04-docs-landed), so this report takes the
     next number, as review-02.md did. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 65adb86 on `run/state-contract-split-2`; verified
`git diff 65adb86 HEAD -- frontend/packages/core/` is empty, so no later
commit altered this task's file-contact surface.

## Findings

All four findings are in the new test file, not the implementation — the
implementation matches the plan's interface contracts on every point I
checked. But this diff's product includes the tests that must hold R4's
behavior in place, and three plan-normative behaviors have concretely
constructible wrong implementations the suite cannot distinguish from the
correct one (plan "Interface contracts": "Classification rule (normative for
implementers and tests)").

### F1 — blocking — required-key tests cannot distinguish template-derived keys from the hardcoded list ADR-5 rejected
- **Where:** `frontend/packages/core/test/state-contract.test.ts:182-208`
- **Failure scenario:** mutant replaces the whole template-resolution block in
  `validate.ts:127-148` with `required = BUILTIN_STATE_KEYS` — the exact
  approach plan ADR-5 rejects by name — and the full suite still passes,
  because this repo's `contracts/state.yaml` top-level keys equal
  `BUILTIN_STATE_KEYS` exactly (verified) and both validate tests read only
  this repo's template. The same mutant deletes the untested
  `state-core.yaml` fallback branch (`validate.ts:137-147`) undetected. A
  host with a forked or core-only contract then validates against our
  compiled keys instead of its own — the precise AC4.3/R4 defect this task
  exists to remove. Kill: a stub `ContractTemplates` returning a key set that
  differs from the builtin list (the plan's five-key fixture works), asserting
  `missing`/`ok` against those keys; plus one case where only
  `state-core.yaml` is offered.
- **Requirement:** AC4.3; plan ADR-5 (rejected alternative); task scope item 5
  ("via a stub ContractTemplates").

### F2 — blocking — classification tests cannot distinguish `every`-marker from `any`-marker SDLC detection, nor detect a dead `branchRequired` derivation
- **Where:** `frontend/packages/core/test/state-contract.test.ts:39-66`
- **Failure scenario:** mutant changes `SDLC_MARKERS.every` to
  `SDLC_MARKERS.some` in `state-contract.ts:69` — every template tested has
  either zero markers (plan fixture) or all three (this repo's template), so
  all 16 tests pass; a host template carrying `branch` but not
  `budget`/`tasks` then classifies `sdlc` and every one of that host's runs
  bounces against the compiled G0–G3 schema. Second surviving mutant on the
  same rows: `deriveGeneric` returning `branchRequired: false`
  unconditionally (`state-contract.ts:44`) — the branch-required parse test
  at line 138 constructs its contract literally rather than deriving it. One
  added case kills both: a partial-marker template with top-level `branch`
  only, expected `generic` with `branchRequired: true`.
- **Requirement:** plan classification table row 2 ("lacking any of those
  three markers"); R4.

### F3 — major — gateOrder tests cannot distinguish the declared-first/contract-order rule from plain file-key order
- **Where:** `frontend/packages/core/test/state-contract.test.ts:105-115`
- **Failure scenario:** mutant replaces `gateOrder: [...contract.gateIds,
  ...undeclared]` with `gateOrder: Object.keys(s.gates)`
  (`schema.ts:215`) and both gateOrder tests pass — in each, file order
  coincides with contract order and every declared gate is present in the
  file. A state file listing `publish` before `intake`, or omitting a
  declared gate entirely (absent = undecided per the plan), then feeds task
  03's `summarizeRun` the wrong cell order or drops the undecided declared
  gate's cell. Kill: one file with declared gates out of contract order and
  one declared gate absent, asserting the exact `gateOrder`.
- **Requirement:** plan `GenericRunState` contract ("Declared gate ids
  (contract order) first, then undeclared ids present in the file").

### F4 — minor — AC3.2's mdtoc and dupefind halves have no direct parse evidence
- **Where:** `frontend/packages/core/test/state-contract.test.ts:194-207`
- **Failure scenario:** PLAUSIBLE — none constructible against this diff,
  since the SDLC branch of `parseRunState` and `runStateSchema` are verified
  line-identical and wordfreq is parsed by the real-repo suite; recorded
  because the task's acceptance list names AC3.2 and the sweep checks
  key-presence via `validateArtifact` only, never `parseRunState`. Cheap to
  close while fixing F1–F3: have the sweep also assert
  `parseRunState(content).error === null` per file.
- **Requirement:** AC3.2.

## Coverage

Everything outside the four findings was checked and is clean: the
implementation follows the plan's interface contracts exactly, the full
frontend suite and typecheck pass as claimed, and the diff stays inside its
surface — the gaps are all in how hard the new tests pin the new behavior.

- Plan interface conformance ✓ — `StateContract` union, frozen
  `SDLC_STATE_CONTRACT`, pure `deriveStateContract`, async
  `resolveStateContract` signatures and semantics match the plan verbatim
- Classification table ✓ — all four rows implemented, including the literal
  reading of row 4 the implementer notes flag: a present-but-unparseable
  `state.yaml` yields `sdlc` without consulting the core template
  (state-contract.ts:65-76), and `resolveStateContract` reads
  `state-core.yaml` only when `state.yaml` is absent
- SDLC path byte-stability ✓ — the diff leaves `runStateSchema`, `PHASES`,
  `PROFILE_GATES`, and every existing export untouched; `parseRunState` gains
  only the defaulted parameter and one early `generic` branch, so AC3.1/AC3.2
  hold by construction plus the passing real-repo suite
- Generic schema semantics ✓ — `run` required, branch gated on
  `branchRequired` via superRefine, scalars normalized to string-or-null,
  gates a required mapping per-entry through the existing `gateEntrySchema`,
  escalations defaulting empty, unknown keys tolerated, and the error string
  format identical to the SDLC path's (schema.ts:198-219)
- validate.ts mirror ✓ — the state branch reproduces the work-item branch's
  try/parse/catch, note wording, and not-valid-YAML handling exactly, with
  the core-template fallback inserted (validate.ts:121-160)
- AC5.1 precondition ✓ — ran the suite myself: 410 passed, 1 skipped,
  matching the claimed 394 baseline plus 16 new, with zero edits to
  readiness.test.ts, profiles.test.ts, or real-repo.test.ts in the commit
- Typecheck ✓ — `npm run typecheck` clean, confirming the plan's
  hidden-consumer risk did not fire
- Implementer-note claims ✓ — the wildcard re-export claim holds
  (src/index.ts:5 already exports record/index.ts, which now exports
  state-contract.ts), and the package-lock revert claim holds (the commit
  contains no lockfile change; I reproduced and reverted the same churn)
- Sweep arithmetic ✓ — the runs/ sweep validated a nonzero set covering all
  committed state files, and this repo's template keys match the audited
  eight-key set
- Concurrency not assessed — no concurrent access in this diff's scope

## Boundary check

The commit touches exactly five of the six declared surface files plus the
task's own `tasks/02-state-contract-resolution.yaml` (status/notes
bookkeeping — the implementer's report channel, treated as non-product
surface here as in review-02). `src/index.ts` is declared but untouched,
which is permitted: the surface is a ceiling, and the existing wildcard
export makes the edit unnecessary. Nothing outside
`frontend/packages/core` changed (AC6.1 holds for this task), and no other
task's work rides in the diff.

---

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit bc1d1e1 on `run/state-contract-split-2` (round-2 delta
over 65adb86); verified `git diff bc1d1e1 HEAD -- frontend/packages/core/` is
empty — no later commit touched this task's surface. The commit adds 82 lines to
`test/state-contract.test.ts` and the round-2 notes to the task YAML; no
implementation change, matching the implementer's account.

### Prior-finding resolution

- **F1 (blocking) — RESOLVED.** Two new stub-template cases
  (`test/state-contract.test.ts:254-289`) pin required keys to the offered
  template. Ran the mutant myself: deleted the template-resolution block
  (`validate.ts:128-148`, leaving `required = BUILTIN_STATE_KEYS` — the
  ADR-5-rejected approach); both new tests fail (2 failed | 18 passed): the
  primary case expects the four-entry missing set and gets the seven-entry
  builtin-derived one, and the state-core-only case pins the fallback branch
  specifically, with `notes: []` distinguishing fallback from no-contracts.
  Reverted; tree clean.
- **F2 (blocking) — RESOLVED.** New partial-marker classification case
  (`test/state-contract.test.ts:67-85`). Ran both named mutants:
  `SDLC_MARKERS.every` → `.some` (`state-contract.ts:64`) fails exactly the new
  case (1 failed | 19 passed); unconditional `branchRequired: false`
  (`state-contract.ts:46`) fails the same case. One case kills both, as the
  round-1 kill prescription specified. Reverted.
- **F3 (major) — RESOLVED.** New gateOrder case
  (`test/state-contract.test.ts:158-177`) with file order `publish, intake` and
  the declared `review` gate absent. Ran the mutant
  `gateOrder: Object.keys(s.gates)` (`schema.ts:215`): fails exactly the new
  case (1 failed | 19 passed) — `['publish','intake']` vs the required
  `['intake','publish','review']`, discriminating on both axes (file order,
  absent declared gate). Reverted.
- **F4 (minor) — RESOLVED.** The sweep (`test/state-contract.test.ts:249`) now
  asserts `parseRunState(content).error === null` per file under the default
  SDLC contract; seven committed `runs/*/state.yaml` files checked, giving
  mdtoc and dupefind the direct parse evidence AC3.2 names. Verified in the
  passing suite.

### Findings

### F5 — minor — the stub-template test's disjointness claim is false, though the assertion it guards is sound
- **Where:** `frontend/packages/core/test/state-contract.test.ts:255-259` (repeated
  in the task YAML's round-2 notes)
- **Failure scenario:** PLAUSIBLE — none constructible today: the comment claims
  the stub's five keys are "none of which are the eight-key builtin/this-repo
  list", but all five are a proper subset of `BUILTIN_STATE_KEYS`; the kill
  actually rests on the exact-equality `missing` assertion (four entries vs the
  mutant's seven), which I verified fires. Risk is only that a future edit
  trusting the stated disjointness relaxes the assertion (e.g. to
  `arrayContaining`) and silently revives the mutant. Non-blocking.
- **Requirement:** none violated; test-comment accuracy only.

### Coverage

I re-ran the full suite and typecheck, executed all four named mutants by hand
and reverted them, and re-checked every acceptance criterion; the round-2 delta
holds up on all of them and adds nothing beyond the four tests the findings
asked for.

- Mutation kills F1–F3 ✓ — four mutants applied and reverted locally; each
  killed by exactly the advertised test, with the failure counts pasted above;
  tree verified clean after each revert (`git status --porcelain` empty)
- Full suite ✓ — 414 passed, 1 skipped (44 files passed, 1 skipped), matching
  the claimed 410 + 4
- Typecheck ✓ — `npm run typecheck` clean
- AC3.1 ✓ — real-repo.test.ts absent from the commit and passing in the suite
- AC3.2 ✓ — the sweep now parses all seven committed run-state files with a
  null error, covering the wordfreq, mdtoc, and dupefind halves directly
- AC4.3 ✓ — template-derived required keys pinned against both the primary
  template and the state-core fallback via stub `ContractTemplates`
- Test-coverage criterion ✓ — classification rows (now including the
  partial-marker row), generic accept/reject, default-path stability, and the
  required-keys sweep are all present in the one new test file
- Lockfile ✓ — bc1d1e1 contains no package-lock change; I reproduced the same
  npm-version metadata churn on a fresh install and reverted it
- Zero expected-value edits ✓ — readiness.test.ts, profiles.test.ts,
  real-repo.test.ts untouched by the commit
- Implementer-note accuracy — one inaccuracy found (F5's disjointness claim);
  every other checkable round-2 claim verified true, including the predicted
  seven-entry mutant missing set for the F1 kill

### Boundary check

The round-2 commit touches exactly one declared surface file
(`frontend/packages/core/test/state-contract.test.ts`) plus the task's own
`tasks/02-state-contract-resolution.yaml` notes (the implementer's report
channel, treated as non-product surface as in round 1). `git diff bc1d1e1 HEAD
-- frontend/packages/core/` is empty, so no later commit rides on this surface,
and nothing outside `frontend/packages/core` changed (AC6.1 holds).
