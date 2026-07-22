# Review Report: 06-derive-tests-engine-ensure

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve (round 2; round 1 verdict: escalate — preserved below)
**Round:** 2 of 3
**Diff reviewed:** commit 343f06c (branch run/creation-seam)

## Findings

### F1 — blocking — the engine's ensure call site makes remote-configured engine tests shell out to whatever `gh` binary is in PATH, and no task surface can fix it
- **Where:** `frontend/packages/orchestrator/src/engine.ts:445` (call with no `opts.exec`), exercised by `frontend/packages/orchestrator/test/push.test.ts:60`/`hosted.test.ts:43` (both configure an origin and reach a successful dispatch tick)
- **Failure scenario:** empirically verified — running `push.test.ts` or `hosted.test.ts` with a shim `gh` first in PATH logs `gh-invoked: pr list --head run/toy --state all --limit 1 --json number`: the successful intent push updates `refs/remotes/origin/run/toy`, both `pr-ensure.ts` git guards pass, and `defaultExec` spawns real `gh`. Tests pass today only because any `gh` failure degrades to `skipped`; a `gh` that prompts, hangs on network, or is a different binary named `gh` stalls or perturbs the suite, and behavior now differs between machines with and without `gh` installed.
- **Requirement:** plan.md Risks — "tests must never shell out to real `gh`; the injectable exec seam in `ensureDraftPr` is mandatory" — versus the plan's own engine call-site citation `ensureDraftPr(this.cfg.repoDir, ref.branch, ref.slug)` (no exec threading, no `EngineConfig` seam) and a task decomposition in which neither task 04 nor 06's `file_contact_surface` includes `push.test.ts`/`hosted.test.ts`. The implementation follows the plan's citation exactly; the mandatory mitigation is unsatisfiable inside this task's declared surface (an in-surface `EngineConfig` hook would still leave those two files on the real-`gh` default). This is a plan-level gap — escalating rather than papering over with an out-of-surface fix. Resolution needs an architect/orchestrator call: thread an ensure/exec seam through `EngineConfig` and amend a task surface to stub it in the remote-configured tests (or equivalent).

### F2 — minor — the new post-arm patch derive case duplicates an existing test verbatim
- **Where:** `frontend/packages/orchestrator/test/derive.test.ts:585-588` vs pre-existing `:580-583`
- **Failure scenario:** none (no wrong implementation passes one and fails the other — identical state, artifacts differing only in the stub filename, identical assertion); zero added mutant-killing power. Task scope mandated the case, so this is compliance duplication — fold into or annotate the existing test at the implementer's discretion; not gating.
- **Requirement:** task 06 scope item 1 / AC4.2 (satisfied either way)

## Coverage

- **AC5.3 ✓** — `derive.test.ts:90-98` loops all three `PROFILES` over `phase: paused` + `STAGED_REASON` + `tasks: []`, asserting not-dispatch, not-escalate, and `rule: 'D2'`. Mutation reasoning: a mutant reordering D2 after the D21 profile checks falls through the phase switch to a `D0` rest — the `rule: 'D2'` assertion kills it; a dispatch/escalate mutant is killed directly. Fidelity of the four-undecided-gates helper shape checked against `record/schema.ts:141-147`: `parseRunState` normalizes every profile's state to a total four-gate record with undecided fill, so the test state is exactly what a parsed real scaffold looks like — clean.
- **AC8.1 (engine half) ✓ code, ✓ test** — ensure sits after the push-rejection recovery and accepted-push notes, before the launch loop (`engine.ts:437-447`), exactly where the task places it; memo is module-level per-process keyed by slug per ADR-5. The engine test's memo mutant is killed: deleting the memo yields a second `draft PR ensure` log line on the second dispatching tick (architect after G0 approve), failing the `toHaveLength(1)` at `engine.test.ts:443`. PR-creation itself is task 04's test surface; per this task's scope the skipped path suffices here.
- **AC8.2 ✓** — `makeToyRepo` (engine.helper.ts:104-165) configures no remote; the test asserts the log line matches `/skipped/` and that phase converged to `spec` then `plan` with `gates.G0.by` null — a mutant that lets the ensure result touch `wrote`/`launched` breaks those phase assertions. `pr-ensure.ts` verified never-throwing (outer belt-and-braces catch), so the engine's reliance on that contract without its own try/catch is sound, not a finding.
- **ADR-5 grep invariant ✓** — `grep -rn stageRun frontend/packages/orchestrator/src` returns nothing.
- **`vi.resetModules()` deviation ✓ accepted** — the implementer's rationale holds: the module-level memo means the same-slug static-module tests would pre-pollute a naive case; the fresh dynamic import observes a genuine first attempt order-independently. Verified the later dynamic imports of `seam.ts`/`manifest.ts` (engine.test.ts:452,468) are pure-module re-instantiations unaffected by the reset, and statically-bound `Engine` users are untouched.
- **Acceptance commands ✓** — `derive.test.ts` 49 passed; `engine.test.ts` 11 passed (106s, hermetic — the gh probe recorded zero invocations from this file); `push.test.ts` 3 passed and `hosted.test.ts` 6 passed (but see F1: each invoked the probe `gh` once); `npm run typecheck` clean.
- Not assessed: `npm test` full-workspace run (implementer reports 282 passed; individual suites re-verified above), and real `gh` created/exists paths (task 04's surface).

## Boundary check

Clean. Commit 343f06c touches exactly the three declared surface files (`src/engine.ts`, `test/derive.test.ts`, `test/engine.test.ts`) plus the task YAML's own `notes:` update (expected orchestration bookkeeping). F1's *effect* lands in `push.test.ts`/`hosted.test.ts` at runtime, but the diff does not modify them.

---

## Round 2

**Verdict:** approve
**Diff reviewed:** commit 343f06c — verified no later commit touches the task's `file_contact_surface` (`git log 343f06c..HEAD -- src/engine.ts test/derive.test.ts test/engine.test.ts` is empty; working tree clean).

### Prior-finding resolution

- **F1 — resolved-by-disposition (code unchanged; residual risk tracked).** Re-inspected: `engine.ts:445` still calls `ensureDraftPr(this.cfg.repoDir, ref.branch, ref.slug)` directly; `EngineConfig` (`engine.ts:17`) has no ensure/exec member; `ensureDraftPr` (`frontend/packages/core/src/sources/pr-ensure.ts:35`) still exposes its exec seam only at its own signature; no commit since 343f06c touches `plan.md`, `runs/creation-seam/tasks/` (still exactly seven task files — no amended surface yet), `pr-ensure.ts`, `push.test.ts`, or `hosted.test.ts`. The escalation this finding raised was resolved by the run owner (`state.yaml` escalations[1], Nathan Carter, 2026-07-22T18:53Z): the proposed remedy — "thread an ensure/exec seam through EngineConfig and amend a task surface to stub it in the remote-configured tests" — was accepted and routed to an architect-level plan/task amendment. That is exactly what round 1's escalation asked for: the defect is a plan-level gap, unfixable inside task 06's declared surface, and ownership has now transferred to the forthcoming amendment. Task 06's own diff was verified clean in round 1; request-changes would demand out-of-surface work from this implementer, and re-escalating a resolved escalation would loop. **Residual risk, explicitly tracked for G2:** until the amended task lands, `push.test.ts`/`hosted.test.ts` invoke whatever real `gh` is in PATH — re-demonstrated this round with the shim probe (two `gh-invoked: pr list --head run/toy --state all --limit 1 --json number` lines, one per file; suites still pass only because failure degrades to `skipped`). G2 should not treat the plan's hermeticity mitigation as satisfied until the seam amendment is implemented and reviewed.
- **F2 — unresolved, still minor, non-gating.** `derive.test.ts:585-588` remains a verbatim duplicate of `:580-583` (re-read this round). No failure scenario; fold-in remains at the implementer's discretion — reasonable to bundle into the seam-amendment task's touch of this file if convenient.

### New findings

None. The surface delta since round 1 is empty; nothing new to review.

### Coverage (round 2 re-runs)

- `npx vitest run packages/orchestrator/test/derive.test.ts packages/orchestrator/test/engine.test.ts` — 2 files, 60/60 passed (105.6s).
- `npm run typecheck` — clean (both tsconfigs).
- gh-shim probe re-run: `push.test.ts` 3 passed + `hosted.test.ts` 6 passed with shim `gh` first in PATH; probe log shows exactly two invocations (one per file), matching round 1 — confirms F1's exposure is unchanged and confined to those two files (engine/derive suites recorded zero invocations).
- Not re-assessed: full `npm test` workspace run; real-`gh` created/exists paths (task 04's surface).

### Boundary check (round 2)

Clean. No commits after 343f06c touch the three surface files; the only post-343f06c commits are orchestration state commits and task 03's separate review/implement traffic, none of which contact this task's surface.
