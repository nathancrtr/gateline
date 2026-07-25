# Review Report: 01-seam-extend

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** run/runner-agent, 9303fa3..f73da87 (HEAD)

## Findings

### F1 — blocking — Diff contains no implementation: task 01-seam-extend was not attempted
- **Where:** `9303fa3..HEAD` (whole range); `frontend/packages/orchestrator/src/seam.ts:8-15`
- **Failure scenario:** All 7 commits in range (`76b9974`, `02b7a47`, `84b50d5`, `e975747`, `f98a735`, `e03af69`, `f73da87`) are orchestrator `state(...)` bookkeeping; `git diff --stat 9303fa3..HEAD` touches only `runs/runner-agent/state.yaml` (46+/2-), and the working tree is clean. `DispatchRequest` in seam.ts still lacks `slug` and `branch` fields, `launch()` in engine.ts is unchanged, and test/seam.test.ts gained no test — dispatching through the seam still conveys only `cwd`, so a remote dispatcher cannot resolve run identity and R2/AC2.1 fail outright.
- **Requirement:** R2, AC2.1; task acceptance "A new test verifies launch() passes slug and branch in the DispatchRequest"

**Redo round must deliver, as code commits on this branch:** (1) optional `slug` and `branch` fields on `DispatchRequest` in `frontend/packages/orchestrator/src/seam.ts`; (2) `launch()` in `frontend/packages/orchestrator/src/engine.ts` populating them from `ref.slug`/`ref.branch`; (3) a new test in `frontend/packages/orchestrator/test/seam.test.ts` asserting `launch()` passes both fields, with existing seam tests passing unmodified and no HeadlessDispatcher changes.

## Coverage
The diff was checked end to end and contains no implementer work, so nothing beyond the empty-diff finding could be assessed.

- Commit list and file-level diff stat for the full range ✓ (bookkeeping only)
- Working tree cleanliness on the branch ✓ (no uncommitted implementation)
- Absence of `slug`/`branch` in the request interface confirmed by grep ✓
- Requirement coverage R2/AC2.1 — not met (F1); correctness, tests, and mutation reasoning not assessable (no code to review)

## Boundary check
No implementer changes exist, so no boundary to judge: none of the three declared surface files was touched. The only file modified in range is the run's state file, written by the orchestrator's own bookkeeping commits, not by the implementer.

---

## Round 2 — 2026-07-23

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 5554ad9 (run/runner-agent)

### Prior-finding resolution

- **F1 (blocking, round 1: empty diff) — RESOLVED.** Commit 5554ad9 lands the implementation in code, verified directly: `DispatchRequest` gains optional `slug`/`branch` (seam.ts:16-17), `launch()` populates them from `ref.slug`/`ref.branch` (engine.ts:488-489), and a new test asserts both fields on the captured request (test/seam.test.ts:141-162). HeadlessDispatcher's class body is untouched; existing seam tests are unmodified (the diff only adds imports and a new describe block).

### Findings

#### M1 — minor — seam.ts doc comment overclaims: "the engine always sets these" is false for sweep dispatches
- **Where:** `frontend/packages/orchestrator/src/seam.ts:15`; counterexample at `frontend/packages/orchestrator/src/schedule.ts:328-333`
- **Failure scenario:** The sweep scheduler dispatches through the same seam with neither field set. Task 02's `RemoteDispatcher` throws when `req.slug`/`req.branch` are unset, so a sweep ever routed through the runner path fails at dispatch — and the comment tells a reader the case cannot exist. Not fixable in this task (schedule.ts is outside the declared surface); the wiring task (05) must either keep sweeps on `HeadlessDispatcher` or thread sweep identity through.
- **Requirement:** R2 (accuracy of the seam's stated contract); non-blocking for AC2.1.

### Coverage

I checked the full round-2 diff statically against the task scope, the spec, and the plan, and everything except the one comment inaccuracy came back clean; the test suite itself was not executable here because frontend/node_modules is absent, so the implementer's 12/12-pass claim rests on static verification plus the pattern match below, not an independent run.

- F1 remediation: all three deliverables present in code ✓ (seam.ts, engine.ts, seam.test.ts)
- R2/AC2.1 prerequisite: request now carries slug + branch; fields optional, so no existing `Dispatcher` or call site breaks ✓
- Task acceptance "existing seam tests pass unmodified": existing tests untouched; the pre-existing bare request literal (seam.test.ts:39) stays type-valid because the new fields are optional ✓
- Mutation reasoning on the new test: asserts exact values `'toy'`/`'run/toy'` on a real `launch()` dispatch — kills unset-field, swapped-field, and single-field mutants ✓; `calls[0]` is a genuine engine dispatch (fresh toy repo's first dispatch is the analyst, per engine.test.ts:118)
- Test scaffolding: every imported helper (`Engine` config shape, `FakeDispatcher.calls`, `agentCommit`, `makeToyRepo`, `removeRunCheckout(repoDir, branch)`) verified to exist with matching signatures; construction matches engine.test.ts:38 verbatim ✓
- Isolated-implementer semantics: passing the run branch (not the task branch) for isolated dispatches matches the plan (remote dispatches are workspace-isolated per ADR-3/ADR-4, harvest branches replace task branches) — consistent, not a defect ✓
- Test execution: not run — dependencies absent in this checkout (stated, not guessed)

### Boundary check

Code changes touch exactly the three declared surface files. The fourth changed file, `runs/runner-agent/tasks/01-seam-extend.yaml`, is the implementer's append-only `notes` entry — the contract's designated report-back channel, not a boundary violation. The notes' claims about unmodified imports (`engine.helper.ts`, `workspace.ts`) were verified: neither file is in the diff.
