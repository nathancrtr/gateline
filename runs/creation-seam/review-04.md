# Review Report: 02-record-scaffold-and-arm

<!-- Numbering note: the dispatch named review-03.md, but that slot was taken by
     the 04-pr-ensure round-1 review (commit e055a09) after the dispatch was
     written; this report takes the next free number rather than overwrite it. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit af8e73e (branch run/creation-seam)

## Findings

### F1 — blocking — patch task-stub title is interpolated into YAML unescaped; common titles emit an unparseable stub
- **Where:** `frontend/packages/core/src/record/scaffold.ts:83`
- **Failure scenario:** `planRunScaffold({ profile: 'patch', title: 'Fix: the parser bug', ... })` → `tasks/01-<slug>.yaml` line 2 is `title: Fix: the parser bug` → `yaml` parse error ("Nested mappings are not allowed in compact mappings"; reproduced). Colon titles are the norm (this task's own title has one); the stub AC4.2 calls "not cosmetic" arrives malformed and `validateArtifact` bounces it. Titles starting with `#`, `[`, `- `, `*`, `&` fail the same way. Fix: YAML-quote every free-form scalar (e.g. `JSON.stringify`).
- **Requirement:** R4/AC4.2; plan §Interface contracts (stub carries `title: <title>`)

### F2 — major — `stagedBy` and `intake.*` are interpolated into state.yaml unescaped: corruption/injection and silent nulling
- **Where:** `frontend/packages/core/src/record/scaffold.ts:40,60-65`
- **Failure scenario:** (a) `stagedBy: 'Eve\nphase: done'` (CLI will feed git `user.name` here, task 05) → emitted state.yaml is invalid ("Map keys must be unique"; reproduced) — or with a different payload, injects arbitrary keys; a name containing `: ` fails likewise. (b) `intake.ref: '#123'` → `ref: #123` parses as a comment → round-trips as `null` silently (reproduced) — this run stages nulls, but the exported planner is the seam tasks 03/05 build on. Same fix as F1: quote at `yamlScalar`/`staged_by`.
- **Requirement:** R1/AC1.1, R9/AC9.2 (intake fields must survive round-trip); plan §record/scaffold.ts

### F3 — major — `arm`'s mutation is never applied in any test; a mutate that no-ops or sets the wrong phase survives
- **Where:** `frontend/packages/core/test/scaffold.test.ts:156` (title claims "the planned mutation clears paused_reason and sets phase" but asserts only the commit message); `actions.ts:192` mutate untested
- **Failure scenario:** mutant `doc.setIn(['phase'], 'done')` (or an empty mutate) in the `arm` case → all 23 tests still pass, since targets are asserted only via `summary`/`message` strings. Precedent exists: `write-path.test.ts` applies `planned.mutate` and asserts the resulting state; here applying it to a `yaml` Document of the scaffolded state and re-parsing suffices.
- **Requirement:** task scope §3 ("mutation sets phase to target and paused_reason to null"); AC6.1 depends on this mutation being right

### F4 — minor — pause's staged-reason refusal compares pre-trim, so `' staged '` mints a fake staged rest state mid-flight
- **Where:** `frontend/packages/core/src/record/actions.ts:149` (check) vs `:150` (`.trim()` afterwards)
- **Failure scenario:** run at `phase: implement`, `planDecision(..., { action: 'pause', pauseReason: ' staged ' })` → refusal not triggered, recorded `paused_reason: staged` (reproduced) → `resume` now refuses ("use `agentic arm`") and `arm` accepts, writing an `armed by` audit line for a run that was never staged. Fix: compare the trimmed reason.
- **Requirement:** plan §record/actions.ts delta (`pause` refuses staged); AC6.2 integrity

### F5 — minor (PLAUSIBLE) — non-finite `costLimitUsd` emits `cost_limit_usd: NaN`, minting a branch whose state.yaml never parses
- **Where:** `frontend/packages/core/src/record/scaffold.ts:52,67`
- **Failure scenario:** `costLimitUsd: NaN` (e.g. an unvalidated `--budget` flag upstream) → `String(NaN)` = `NaN`, which YAML reads as the string `"NaN"` → `z.number()` fails on every later read, but nothing checks at scaffold time, so `stageRun` would commit a malformed run. PLAUSIBLE: depends on task 05 not validating the flag; a `Number.isFinite` guard in `ScaffoldError` territory closes it here.
- **Requirement:** R4/AC4.4 (emitted state must parse)

### F6 — minor — implementation notes claim the plan template's `# default 50 ... unless overridden` comment is "retained verbatim"; it is not emitted
- **Where:** `runs/creation-seam/tasks/02-record-scaffold-and-arm.yaml` (notes, "Deviations" paragraph) vs `scaffold.ts:67` (no comment on `cost_limit_usd`)
- **Failure scenario:** none in code (comments are non-semantic; parse shape holds) — but the G2 human reads a verification claim that is false; the notes should state the comment was dropped.
- **Requirement:** plan §record/scaffold.ts YAML template (comment lines), notes accuracy

## Coverage

Checked and found clean, against spec.md and plan.md directly:

- **ADR-1/R5 (AC5.2):** `STAGED_REASON` exported; `'staged'` added to `PAUSED_REASONS` only — no `PHASES`/`PROFILE_PHASES`/derivation change; scaffolded state parses per profile (`paused_reason` is a free string in `runStateSchema`, so no schema change was needed and none was made) ✓
- **ADR-2/R6:** `arm` legal only from `phase === 'paused' && paused_reason === STAGED_REASON`, target via `deriveResumePhase` (verified: all-undecided ledger → spec/spec/plan for full/standard/patch), refusal names the actual phase or paused_reason (AC6.2) ✓; `resume` staged-refusal points at `agentic arm` ✓
- **R4 (AC4.1/4.3/4.4):** gates blocks contain exactly `PROFILE_GATES[profile]`; the test discriminates the raw YAML via a direct `yaml` parse rather than the schema's gates-normalizing transform — a genuinely mutant-killing choice ✓. Patch stub carries every `BUILTIN_WORK_ITEM_KEYS` key (all nine, `requirements` included per the plan's correction of AC4.2's list) ✓
- **Purity/layering:** `scaffold.ts` imports `schema.ts` only; layering test green ✓. Barrel export added per scope §4 ✓
- **R9 (AC9.2):** planner input is source-agnostic; grep on `scaffold.ts` + `scaffold.test.ts` → zero matches; `schema.ts` retains exactly its 3 pre-existing `ZodError.issues`/`addIssue` lines, none added by the diff ✓
- **Commit grammar:** both `staged by` forms and `armed by` match the plan's grammar, byte-for-byte tested ✓
- **`readIntake`:** round-trip and absent-block cases correct (non-object/array-shaped `intake` degrades to null/nulls) ✓
- **Verification re-run (clean worktree at af8e73e):** `npx vitest run packages/core/test/scaffold.test.ts` 23/23 ✓; `npm run typecheck` clean ✓; full `npm test` 272 passed / 1 skipped / 0 failed — the implementer's reported orchestrator timeouts did not reproduce without concurrent dispatch load ✓
- **Not assessed (other tasks' scope):** `stageRun`/CAS/identity (task 03), CLI carriers (05), AC5.3 derive rest (06), sequencing/mutation-application through `writeState` (covered generically by pre-existing write-path tests, but not for `arm` — F3)

## Boundary check

Commit af8e73e touches exactly the five declared surface files plus the task file's own notes — inside `file_contact_surface`. The diff bounds this task only (no other tasks' work carried). Clean.
