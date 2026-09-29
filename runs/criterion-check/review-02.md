# Review Report: 02-cli-footnotes-and-fixture

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 4d8e8e5 (`git diff 4d8e8e5^ 4d8e8e5`), the only implementation commit for this round
**Summary:** The terminal footnotes and the demo fixture do what the requirement and the plan ask, and finished runs print byte for byte as before. The findings are gaps in what the tests would catch, plus one rare input shape, none a defect in ordinary use. Approving now accepts two planned layout rules in new code that no test guards.

## Findings

### F1 — major — No test notices the check's indent ignoring the id column width
- **Where:** `packages/cli/test/cli.test.ts:673-685`
- **Failure scenario:** The code is correct today. No test would notice if the check stopped lining up under its promise whenever an artifact cites ids of different lengths, which anyone reading full-mode footnotes would see as a ragged block. The full-mode test sets its expected width from the literal `'AC1.1'.length`, and every id the demo plan cites is five characters or shorter, so the expected indent is always ten. I tried a mutant, meaning a copy of the code I broke on purpose to see whether a test fails: the indent computed from the current id's length instead of the column width (`packages/cli/src/main.ts:317`). All four new tests passed. With that mutant, a plan citing `AC1.1` beside `AC10.1` prints the first check one column left of its promise.
- **Requirement:** plan.md "Interface contracts — Terminal footnotes" (indent is `width + 5`); ADR-4; AC7.2
- **Fix:** One full-mode case where a checked criterion is cited beside a longer id. The shared fixture cannot grow (AC9.2), so the case needs a run built inside the test file, as its scratch-repo helper already does.

### F2 — major — No test notices a checked criterion's default footnote losing its 110-character cut
- **Where:** `packages/cli/test/cli.test.ts:665-671`
- **Failure scenario:** The code is correct today. No test would notice if a long promise printed in full in the default mode, which would wrap across a reader's terminal where every other footnote is cut. The only checked criterion in the fixture has a 64-character promise. With the cut removed from the checked branch (`packages/cli/src/main.ts:317`), all four new tests passed. A probe spec with a 209-character promise confirmed the shipped code cuts it and ends it with an ellipsis.
- **Requirement:** plan.md "Interface contracts — Terminal footnotes", default mode (truncated to 110 as today); spec Assumptions, first entry
- **Fix:** One default-mode case with a checked promise longer than 110 characters, in the same test-built run as F1.

### F3 — minor — The two unchanged-output tests cannot tell the default mode from the full mode
- **Where:** `packages/cli/test/cli.test.ts:687-701`
- **Failure scenario:** The code is correct today. No test would notice if a criterion without a check lost its cut in the default mode or gained one in the full mode, which is the behaviour these two tests exist to guard. Both assert the same 57-character literal, shorter than the cut. I removed the cut from the default mode, then added it to the full mode (`packages/cli/src/main.ts:322`). All nine tests in the `show` block passed each time. The implementer's own breaks, a cut at 40 and upper-casing, do fail the tests, so the AC8.6 claim holds as written.
- **Requirement:** AC7.3, AC7.4
- **Fix:** A criterion without a check and longer than 110 characters, asserted in both modes, in the same test-built run as F1.

### F4 — minor — A criterion with a check and an empty first line prints an empty quotation by default
- **Where:** `packages/cli/src/main.ts:315-317`
- **Failure scenario:** A criterion whose first line is empty, followed by a check, prints `""` in the default mode where the old code printed the check's words; no spec has this shape.

## Coverage

Every criterion this task claims was checked by reading the diff and by running it: the new tests, the whole suite twice, typecheck, lint, eight deliberate breaks, a before-and-after comparison on three finished runs, and one probe spec.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R7 | `main.ts:315-317` | default mode quotes the promise alone, whitespace collapsed, cut to 110 | ✓ AC7.1 |
| R7 | `main.ts:317` | full mode prints the check on the next line inside one pair of quotation marks | ✓ AC7.2 |
| R7 | `main.ts:317` | probe with a six-character id beside five-character ids: every check sits under its promise | ✓ AC7.2 |
| R7 | `main.ts:321-323` | lines for an entry without a check are untouched by the diff | ✓ AC7.3, AC7.4 |
| R7 | scratch repo | footnotes for dupefind, wordfreq and mdtoc, two artifacts, both modes: 396 lines identical before and after | ✓ AC7.3, AC7.4 |
| R7 | probe spec | wrapped promise and wrapped check each print as one line in full mode | ✓ |
| R8 | `fixtures/src/index.ts:98-103` | shared spec has one criterion with a check and one without; the run awaiting G2 uses it | ✓ AC8.1 |
| AC8.5 claim | `main.ts` at the parent commit | new fixture line with old code: both new-behaviour tests fail, and one older test with them | ✓ |
| AC8.6 claim | `main.ts:322` | cut at 40 fails the default-mode test alone; upper-casing fails the full-mode test alone | ✓ |
| indent claim | `main.ts:317` | indent of `width + 4` fails the full-mode test, nine against ten | ✓ |
| R9 | commit file list | no contract, role spec, rendered agent file, validator, orchestrator file or other run's record | ✓ AC9.1 |
| R9 | `fixtures/src/index.ts:99` | one added line, inside the shared spec template's criteria list | ✓ AC9.2, AC9.3 |
| plan: fixture line | `fixtures/src/index.ts:99` | text and two-space indent match the plan's line exactly | ✓ |
| suite, typecheck, lint | `packages/` | second full run: 123 files and 1786 tests pass; typecheck and lint exit 0 | ✓ |
| suite, first run | `packages/` | three timeouts in two files outside this surface, machine load near 146; both files pass alone | ✓ |
| browser tests | — | not run: owned by the browser task, 06; its demo-spec assertions are containment checks | n/a |
| G2 card view of both shapes | — | not assessed in a browser: the check of AC8.1 is the verifier's | n/a |

## Boundary check

The three code files changed are exactly the task's declared surface. The commit also appends the round-1 notes to the task's own work item, which is where implementer notes live. My deliberate breaks were restored with a checkout of the file, and the scratch repository lived outside the worktree and is deleted; the working tree holds this report and nothing else.

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit be1beea (`git diff 4d8e8e5 be1beea -- packages/`), the delta since the round-1 diff
**Summary:** The four round-one findings are closed, and each new test fails when the code it guards is broken on purpose. One small finding remains: a new test carries the label of a new-behaviour criterion yet passes on the old code. Approving accepts that label, and a bare quotation mark in full mode for a criterion shape no spec has.

## Verify round

A mutant here is a copy of the terminal command's source that I broke on purpose. I ran each one against a scratch run holding the new tests' spec, and compared its footnotes with the literals the tests assert.

- **F1 — resolved** — The new scratch run cites a six-character id beside the checked criterion and asserts the check line whole, at eleven spaces. The mutant that indents by the current id's length prints ten, so the test fails.
- **F2 — resolved** — A checked promise past 110 characters is asserted as a literal ending in an ellipsis. The mutant without the cut in the checked branch prints the promise whole, so the test fails.
- **F3 — resolved** — A long promise without a check is asserted cut by default and whole in full mode. Removing the default cut fails the first literal; adding a full-mode cut fails the second. The pre-change source prints both literals exactly.
- **F4 — resolved** — An empty promise with a check now prints the id and no quotation by default. The mutant that restores the unconditional quotation prints an empty pair of marks, which the new test rejects.

### F5 — minor — The long checked promise test is labelled AC7.1 but passes on the pre-change code
- **Where:** `packages/cli/test/cli.test.ts:758-763`
- **Failure scenario:** A verifier gathering failing output for new-behaviour tests by criterion label finds this one passing on the old commit, because the 110-character cut falls before the check's words.

## Coverage

The round-two delta was read in full and run: the terminal test file, the whole suite, typecheck, lint, five mutants and the pre-change source, all against a scratch run built outside the worktree.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R7 | `main.ts:318-319` | the delta changes the default mode for an empty promise only; full-mode expression is unchanged | ✓ |
| R7 | scratch run | shipped source prints every literal the four new tests assert, in both modes | ✓ AC7.1, AC7.2 |
| R7 | `main.ts:323-325` | lines for an entry without a check are untouched by the delta | ✓ AC7.3, AC7.4 |
| F3 literals | `main.ts` at `4d8e8e5^` | pre-change source prints both literals for the long promise without a check | ✓ |
| AC8.6 | `cli.test.ts:766-775` | two mutants of the path without a check each fail one literal | ✓ |
| empty promise, full mode | `main.ts:319` | prints an opening quotation mark alone on the id's line; unchanged since round 1, no test asserts it | partial |
| R9 | `be1beea` file list | two code files inside the surface, plus this task's own work item | ✓ AC9.1 |
| R8, R9 | `fixtures/src/index.ts` | no change to the fixture generator in the delta | ✓ AC9.2, AC9.3 |
| terminal test file | `cli/test/cli.test.ts` | 56 of 56 tests pass | ✓ |
| suite | `packages/` | 124 of 125 files pass, 1738 tests; one file's setup hook timed out at machine load near 130 | partial |
| suite, timed-out file | `core/test/readiness.test.ts` | run alone: 72 of 72 pass; the task's commits touch nothing under core | ✓ |
| typecheck, lint | `packages/` | both exit 0 | ✓ |
| mutants through the test runner | — | not run: mutant output was compared with the asserted literals by hand, leaving tracked files unedited | n/a |
| browser tests | — | not run: owned by the browser task, 06 | n/a |

## Boundary check

The delta changes `packages/cli/src/main.ts` and `packages/cli/test/cli.test.ts`, both inside the declared surface, and appends round-two notes to the task's own work item. My mutants were untracked copies beside the source, deleted after use; the scratch run is deleted; the working tree holds this report's appended section and nothing else.
