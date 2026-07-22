# Review Report: 03-stage-run-source

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 02edade (branch run/creation-seam)

## Findings

### F1 — blocking — ADR-4 rule-2's `exists` branch (same-slug, null-key replay) has zero discriminating test coverage; a wrong implementation passes the full suite
- **Where:** `frontend/packages/core/test/stage-run.test.ts:88-121` (gap); code at `frontend/packages/core/src/sources/local-source.ts:334-340`
- **Failure scenario:** both replay tests carry a `clientKey`, so both route through scan rule 1 (client-key match, local-source.ts:323-329); rule 2's positive branch is never exercised. Surviving mutant: `isStagedRest` (or `keyMatches`) hardcoded `false` → same scaffold with `clientKey: null` staged twice returns `refused: slug-taken` instead of `exists` — AC1.3's "same slug" half breaks (CLI default path: `--key` is optional, plan's free-form intake is all-null) while all 8 tests still pass. I verified the current code is correct by executing a null-key double-stage against a fixture repo (`created` then `exists`), so this is a test gap, not a code defect — but the task's test list bullet "replay: same scaffold twice" is the only home for this behavior and the delivered scaffold's key defeats it. Fix: one test staging a null-key scaffold twice, expecting `exists`.
- **Requirement:** R1/AC1.3; plan ADR-4 rule 2; task 03 test list ("replay: same scaffold twice")

### F2 — minor — CAS-loss re-derivation's `exists` outcome is also uncovered; an unconditional-conflict mutant survives
- **Where:** `frontend/packages/core/test/stage-run.test.ts:123-146` (gap); code at `frontend/packages/core/src/sources/local-source.ts:388-393`
- **Failure scenario:** the conflict test's rival branch carries no `runs/race-run/state.yaml`, so the rescan yields `null` → generic conflict; the rescan-returns-`exists` branch (two operators racing identical staged scaffolds — plan step 4's "never a blind retry" re-derive) is never hit. Mutant dropping the rescan and returning `refused: conflict` on every CAS loss passes the suite; the losing operator of an identical replay would get exit 2 instead of the idempotent success. The task's test bullet ("-> refused conflict") is literally satisfied, hence minor, not blocking.
- **Requirement:** plan §"sources deltas" step 4; ADR-4 rule 3

### F3 — minor (PLAUSIBLE) — empty-default-branch refusal reuses `reason: 'conflict'` for a non-race condition
- **Where:** `frontend/packages/core/src/sources/local-source.ts:371`
- **Failure scenario:** `stageRun` against a repo whose default branch has no commits → `refused: conflict` with "re-check and retry" semantics (task 05's CLI will map it to exit 2, the ref-moved idiom) for a condition no retry can fix. The `StageRefusal` union (plan.md:138) offers no `error` member, so the plan boxed this in; PLAUSIBLE and cosmetic — the message itself names the real cause. No change required unless round 2 touches the file anyway.
- **Requirement:** plan §"Interface contracts" (StageRefusal)

## Coverage

Checked and found clean (all verified against the diff and by running the commands myself):

- **Interface contract** — `StageRefusal`/`StageOutcome`/`stageRun` signature in `source.ts:28-35,83-91` match plan.md:138-146 verbatim, including `pushFailed?` on `created` only.
- **5-step sequence** — identity precondition first (local-source.ts:359-364, message character-for-character per AC7.1/task scope), before any `hashObject`/`commitTree`/ref write; scan; genesis against `revParse(defaultBranch)`; create-only CAS; push last. Order verified by reading, refusal-before-write verified by the AC7.1 test's zero-new-refs assertion.
- **Create-only CAS** — `updateRefCAS(refs/heads/run/<slug>, commit, ZERO_OID)` (local-source.ts:388), same idiom as `writeState`'s remote-materialization (line 243); on `false`, re-scan then re-derive, never a blind retry.
- **Authorship** — `commitTree(..., who)` at local-source.ts:385; `this.options.identity` appears nowhere in `stageRun`/`scanForExisting`; the bot-pinned-source test (stage-run.test.ts:174-187) checks author name *and* email against `git log`, killing an `options.identity` mutant.
- **ADR-4 rule 1** — client-key scan spans all `listRuns()` results (local/remote-only/merged-into-default kinds), matching "across all runs, regardless of slug"; cross-slug test asserts the *first* run is named and no second branch is minted.
- **Refusal naming** — `slug-taken` message names the existing branch and phase (local-source.ts:344); AC1.2 test additionally proves the pre-existing branch tip is byte-identical after refusal.
- **Path prefixing** — `<runsRoot>/<slug>/<path>` via `frameworkRoots()` (local-source.ts:373-381), same root `runDir()` uses; AC10.1 test reads through a fresh `Git` instance with no shared cache and round-trips `parseRunState` (phase `paused`, `paused_reason: staged`); tip equals the returned commit.
- **Tree composition** — `writeTreeWithBlob` seeded with `tip`, previous tree OID as next base, with the required read-tree/tree-ish comment (local-source.ts:375-382); patch-profile test proves the third blob (`tasks/01-<slug>.yaml`) lands.
- **Push parity** — same try/catch + `pushFailed` shape as `writeState` (local-source.ts:395-402 vs 300-307). Push path itself not exercised by any test (no origin-configured fixture in this file) — consistent with the task's test list, which does not require one.
- **R9 hygiene** — the three diffed code/test files contain zero matches for `issue|label|assignee|milestone` (grep run on the diff). Repo-wide AC9.2 grep returns **three** matches, all in `record/schema.ts` (lines 136 `ctx.addIssue` — introduced by the #156 merge commit 70aae4c that task 01 pulled in — plus the two `ZodError.issues` lines 171/175). The implementer's task-file note is accurate; the spec's "confirm exactly two" count is stale but its operative "no new matches" clause holds. Verifier should update the expected count to three, all zod-API false positives.
- **Single implementer** — `grep "implements RunSource"` across `frontend/packages` returns only `LocalGitSource`; typecheck confirms no second implementer broke.
- **AC1.4** — no `frontend/packages/server` file in the diff.
- **Acceptance commands (run by me, this checkout):** `npx vitest run packages/core/test/stage-run.test.ts` → 8/8 pass; `npm test` → 290 passed, 1 skipped (the count includes task 06's later tests present on the branch tip); `npm run typecheck` → clean.
- **Plan-step-4 wording** — the plan's parenthetical "exists if the winner matches the staging identity" is operationalized as the ADR-4 table re-scan (staged-rest + key agreement) rather than a literal identity comparison; the task scope's own wording ("re-scan and re-derive exists vs refused conflict") endorses this reading — no finding.
- Concurrency beyond the single-process CAS race: not assessed (out of scope; git ref transactionality is the mechanism under test).

## Boundary check

Diff touches exactly the declared surface — `source.ts`, `local-source.ts`, `test/stage-run.test.ts` — plus the task file's own `notes:` field (the implementer's report channel, standard in this run). No boundary violations.
