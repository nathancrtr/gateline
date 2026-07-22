# Review Report: 05-cli-new-arm

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** feea482 (run/creation-seam)

## Findings

### F1 — major — arm's ensureDraftPr call site (task scope item 2, "printing its note") is never observed by any test
- **Where:** `frontend/packages/cli/test/cli.test.ts:164-186` (arm tests) vs `frontend/packages/cli/src/main.ts:549-553`
- **Failure scenario:** mutant passes wrong args (e.g. `ref.slug` for branch → ensure always skips "branch not pushed" even when pushed) or drops the note print; every arm test still passes — AC8.1's CLI half regresses green. The fixture repo has no origin, so the skip note *is* printed in these very tests (verified live: `no remote.origin.url configured — nothing to open a PR against`); a one-line `expect(stdout).toMatch(/PR|skip|origin/)` in an existing arm test kills the mutant.
- **Requirement:** R8/AC8.1 (arm call site); task 05 scope item 2

### F2 — minor — AC2.3 test cannot distinguish "names the missing flags" from "names all flags"
- **Where:** `frontend/packages/cli/test/cli.test.ts:149-158`
- **Failure scenario:** mutant unconditionally prints `--slug, --title, --brief-file`; test (which passes `--slug`) still passes since it never asserts `--slug` is absent from stderr. Behavior is currently correct (verified live: `--title` supplied → only `--slug, --brief-file` named); add `expect(stderr).not.toContain('--slug')`.
- **Requirement:** AC2.3

### F3 — minor — interactive path checks identity only after the full prompt/edit/confirm session
- **Where:** `frontend/packages/cli/src/main.ts:443-463` (identity check at 459, after `runInteractiveNew` returns)
- **Failure scenario:** operator in a no-identity repo with a TTY answers prompts, authors a full brief in $EDITOR, confirms `stage? y` → refusal, temp file already deleted (main.ts:363), prose survives only in the printed preview/scrollback. decide() checks identity immediately after resolve (main.ts:142-146); hoisting the check above the interactive branch costs nothing. AC7.1's letter ("before any git write") is met — this is session-loss UX, not a spec violation.
- **Requirement:** AC7.1 (shape), plan §CLI (decide()'s resolve → identity ordering)

### F4 — minor — prompted slug is validated only by ScaffoldError after the editor session
- **Where:** `frontend/packages/cli/src/main.ts:325-326` (prompt loop accepts any non-empty string) vs scaffold.ts's `SLUG_RE`
- **Failure scenario:** operator answers `slug: My Run`, completes edit + confirm → `ScaffoldError` exit 1, whole session discarded (same loss shape as F3). Validate against `/^[a-z0-9][a-z0-9-]*$/` in the prompt loop (the flag help at main.ts:502 already names the regex).
- **Requirement:** R2 (interactive fallback usability); plan §scaffold slug grammar

### F5 — minor — armRun duplicates decide()'s body verbatim (refusal strings, exit-code map) — drift risk
- **Where:** `frontend/packages/cli/src/main.ts:520-548` vs `main.ts:139-168`
- **Failure scenario:** future change to decide()'s refusal wording/exit mapping (e.g. ref-moved → new code) skips armRun; `arm` and `resume` diverge on identical failures. Deviation itself ruled acceptable — see Coverage. Note the recorded rationale is partly inaccurate: decide() returns normally on success (only failure branches `process.exit`), so `await decide(...); ensureDraftPr(...)` was viable; the returned-exit-code shape chosen is still the better runUpgrade-precedent form.
- **Requirement:** AC6.1; plan §CLI ("`arm` = `decide()` flow")

### F6 — minor — missingBriefSections normalizes (lowercase+trim) more strictly than core validate.ts's `normalize` (strips punctuation/whitespace runs)
- **Where:** `frontend/packages/cli/src/main.ts:287-290` vs `frontend/packages/core/src/record/validate.ts:30`
- **Failure scenario:** fork template H2 `Constraints & risks`, brief writes `Constraints  &  risks` (internal double space) → CLI refuses a brief core's `validateArtifact` would accept. Strictly fail-closed (never accepts what core rejects), so no R3 exposure — consistency nit only.
- **Requirement:** plan §CLI (extractSections validation)

## Coverage

- **Deviation ruling (requested by implementer):** `armRun` in place of literal `decide()` reuse **satisfies AC6.1**. The substance of AC6.1 is the write path — `planDecision({action:'arm'})` → `writeState` CAS, human attribution, no plumbing bypass — and armRun preserves it verbatim (main.ts:534-535), with decide()'s exact identity refusal, malformed-state refusal, DecisionError→1, ref-moved→2. Verified live: staged→armed produces exactly one commit `state(<slug>): armed by <name>` authored by the arming human; double-arm refuses `run is not staged (phase: spec)` exit 1. Residual cost recorded as F5.
- **R2/AC2.1:** flags-complete path stages with no prompts, exit 0; test reads back phase/paused_reason/profile/budget from a fresh `LocalGitSource` ✓. AC2.2 via `runInteractiveNew` unit tests (prompt sequence asserted incl. `stage? [y/N]`); the stub seam (`InteractiveNewIO.editFile`) is the whole temp-file/$EDITOR round trip, so the stub is honest — only `realInteractiveIO` itself (main.ts:350-369) is untested, per the plan's own risk mitigation ✓.
- **R2/AC2.3, R3/AC3.2:** non-TTY refusal names each genuinely missing flag (verified live: `--title` given → `missing required content: --slug, --brief-file`), exit 1, nothing staged (listRuns asserted empty) ✓; modulo F2's mutant.
- **R3:** `draftBriefMarkdown` rewrites only the first `/^#\s+/` line (H2s can't match — `##` fails `\s`), copies template otherwise; BUILTIN_SECTIONS fallback emits bare `## <section>` headings, zero prose; flags path takes `--brief-file` verbatim; re-edit loop re-opens the editor, never pads (unit test drives one failing edit → re-edit → pass) ✓. Missing-section refusal verified live against the builtin fallback ✓.
- **Outcome/exit mapping:** created→0, exists→0 with exact `already staged: <slug> (<branch>)` line (asserted verbatim), refused→1, conflict→2 (main.ts:496); ref-moved→2 in arm. Conflict/ref-moved paths unexercised by tests (CAS race not constructible in a spawned-process test; core covers them in task 03) — noted, not required by the task's test list.
- **AC7.1 CLI half:** identity refusal precedes `stageRun`, message matches plan §stageRun step 1 exactly; arm reuses decide()'s message exactly; no-identity test uses a dedicated scratch repo with global/system config nulled and asserts zero runs after ✓ (F3 is ordering-UX only).
- **AC6.2:** non-staged (`g0-pending`) and nonexistent (`findRun`) refusals both exit 1 with named errors ✓.
- **Acceptance commands run by me:** `npx vitest run packages/cli/test/cli.test.ts` → 20/20 passed; `npm test` → 305 passed | 1 skipped (38 files); `npm run typecheck` → clean (tsc both projects). (`npm install` had to be run first in this checkout.)
- Not assessed: concurrent `new` racing the same slug from two processes (core CAS owns it, task 03); real `$EDITOR` spawn behavior (no TTY available; plan accepts this).

## Boundary check

Diff touches exactly `frontend/packages/cli/src/main.ts`, `frontend/packages/cli/test/cli.test.ts` (the declared file_contact_surface), plus `runs/creation-seam/tasks/05-cli-new-arm.yaml` notes — the implementer's own report channel, in-process, not a violation. No core, server, or orchestrator files touched; no new server route (AC1.4 unaffected) ✓.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** 9716546 (run/creation-seam)

## Prior-finding disposition

- **F1 (major) — resolved.** Two-pronged: the arm-standard test now asserts the exact no-origin skip note (`cli.test.ts:178`), and a new dedicated test (`cli.test.ts:187-205`) stages+arms in a scratch repo with a configured-but-unfetched origin, forcing the branch-not-pushed note that literally embeds `refs/remotes/origin/run/arm-note`. Mutants re-applied by me: (a) dropped `console.log(note.note)` → arm-standard test fails; (b) `ensureDraftPr(dir, slug, slug)` → branch-argument test fails; real code passes 23/23. Hermetic: `example.invalid` is RFC 6761 guaranteed-NXDOMAIN, `ensureDraftPr` reaches the skip via local `revParse` only (pr-ensure.ts:48-49), and the tolerated push failure (local-source.ts:395-401) is by-design behavior.
- **F2 (minor) — resolved.** `cli.test.ts:156` asserts `--slug` absent from stderr. Mutant (unconditional three-flag message) re-applied → test fails.
- **F3 (minor) — resolved.** Identity check hoisted to immediately after source resolution (`main.ts:441-445`), before template read, missing-flag computation, and the interactive branch; later duplicate removed. AC7.1 test still passes; ordering now matches decide()'s resolve→identity. (Side effect, accepted: a no-identity repo with missing flags non-TTY now gets the identity refusal instead of the missing-flags list — same exit 1, and exactly the ordering F3 asked for.)
- **F4 (minor) — resolved.** Prompt loop validates against `SLUG_RE` with a logged reason (`main.ts:359-362`); the duplicated regex is byte-identical to core scaffold.ts:38 and stays inside the task's file surface. Unit test `cli.test.ts:318-334` asserts the double `slug:` prompt and the `must match` log. Mutant (revert to `while (!slug)`) re-applied → test fails.
- **F5 (minor) — resolved.** `planAndWrite` (`main.ts:151-174`) is the single copy of the readState→planDecision→writeState→exit-code core; `decide()` (main.ts:184-185) and `armRun` (main.ts:568-569) both call it. Body verified semantically identical to the round-1 duplicates (same refusal strings, ref-moved→2, DecisionError→1, success summary + warn). Exercised by the existing decision-loop and arm tests, all green.
- **F6 (minor) — resolved.** `normalizeSection` (`main.ts:310`) is byte-identical to core validate.ts:30's `normalize`. New CLI test (`cli.test.ts:250-279`) stages a brief whose punctuated H2 differs only in internal whitespace. Mutant (revert to lowercase+trim) re-applied → test fails.

All five re-applied mutants were reverted; working tree clean after review.

## Findings

None. No regressions or new defects found in the round-2 delta.

## Coverage

- **Round-2 delta reviewed in full** (`git show 9716546`): main.ts refactor (planAndWrite extraction, identity hoist, slug-loop validation, normalization fix) and 4 new/updated tests. No behavior outside the six findings was changed; `stageNewRun`'s flags-complete path, outcome/exit mapping, and `armRun`'s ensureDraftPr chaining are unchanged from the round-1-reviewed code.
- **Mutation testing:** 5 mutants hand-applied (dropped note print; branch→slug arg; unconditional missing-flags list; unvalidated prompt slug; lowercase+trim normalization) — each killed by exactly the test targeting it; real code passes.
- **Acceptance commands re-run by me:** `npx vitest run packages/cli/test/cli.test.ts` → 23/23 passed; `npm test` → 308 passed | 1 skipped (38 files, same pre-existing live-smoke skip); `npm run typecheck` → clean (both tsconfig projects).
- **Round-1 coverage stands:** AC2.1-2.3, AC3.1-3.2, AC6.1/6.2, AC7.1's CLI half, R3 structure-only drafting — re-verified green through the refactor; the round-1 deviation ruling (armRun in place of literal decide() reuse satisfies AC6.1) is strengthened by F5's fix, since the CAS core is now literally shared.
- Residual nit, not a finding: the arm-standard F1 assertion depends on the shared fixture repo having no origin; if `generateFixtureRepo` ever grows one, that exact-string assert breaks loudly (the dedicated branch-argument test is fixture-independent).
- Not assessed (unchanged from round 1): real `$EDITOR` spawn (`realInteractiveIO`, per the plan's accepted risk); concurrent-stage CAS races (core-owned, task 03).

## Boundary check

Round-2 diff touches exactly `frontend/packages/cli/src/main.ts`, `frontend/packages/cli/test/cli.test.ts` (the declared file_contact_surface), plus `runs/creation-seam/tasks/05-cli-new-arm.yaml` notes — the implementer's report channel, in-process. No core, server, or orchestrator files ✓.
