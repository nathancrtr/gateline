# Review Report: 01-lexicon-promise-check

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit f5b1122 (branch run/criterion-check), against its parent 32f60ed
**Summary:** The lexicon splits a criterion into promise and check correctly, and every earlier spec reads as before. The findings are gaps in what the tests would catch, not defects in shipped behaviour. Approving now accepts a rule for where a check starts that three wrong versions of the code would pass.

## Findings

### F1 — blocking — No test notices a check starting at a line that only contains the label
- **Where:** `packages/core/test/lexicon-check.test.ts:76-80`
- **Failure scenario:** The code is correct today. No test would notice if a wrapped promise with the label in the middle of its second line were cut in two, which every view would then show as a false check. The only test of a label inside the text puts it on the criterion's first line. I tried a mutant, meaning a copy of the lexicon I broke on purpose to see whether a test fails: check detection changed from "line begins with the label" to "line contains the label". All 44 tests in the two lexicon test files passed. With that mutant, the criterion `The page shows the label` / `named Check: before the result.` returns the promise `The page shows the label` and a check of `named Check: before the result.`
- **Requirement:** the plan's Lexicon entry rules, second rule ("begins"); the spec's fifth assumption; the first decision (ADR-1), which rejects per-view splitting for this exact hazard; the can-fail criterion for guard tests (AC8.6)
- **Fix:** add a test with the label mid-line on a continuation line, asserting the whole line ends the promise and no `check` key exists.

### F2 — major — No test notices a check starting at the last labelled line instead of the first
- **Where:** `packages/core/test/lexicon-check.test.ts:48-93`
- **Failure scenario:** The code is correct today. No test would notice if a criterion with two labelled lines had the first one folded into its promise, so the terminal's default footnote and the cited-ids list would print a check as part of the promise. No test input has two labelled lines. I changed `findIndex` to `findLastIndex` at `packages/core/src/view-model/lexicon.ts:152`, and all 44 tests passed. With that change, `P.` / `Check: one.` / `Check: two.` returns the promise `P. Check: one.`
- **Requirement:** the plan's Lexicon entry rules, second rule ("the first continuation line ... runs to the end of the item")
- **Fix:** add a test with two labelled continuation lines, asserting the promise is the first line alone and the check holds both.

### F3 — minor — No test notices the label being matched without its colon
- **Where:** `packages/core/test/lexicon-check.test.ts:82-87`
- **Failure scenario:** The code is correct today. No test would notice if a continuation line beginning `Checks` or `Checking` were taken as a check, which would split an ordinary wrapped promise. The case test covers lower-case only. I changed the matched text at `packages/core/src/view-model/lexicon.ts:152` from `Check:` to `Check`, and all 44 tests passed. They also passed when the match demanded a space after the colon.
- **Requirement:** the plan's Lexicon entry rules, second rule (the label is `Check:`)

### F4 — minor — The plan's rule that full text equals promise, space, check is false for two inputs
- **Where:** `packages/core/src/view-model/lexicon.ts:148-153`
- **Failure scenario:** A later task that rebuilds the full text from the two parts would print different text from today for these criteria. The implementer's discovery note reports the first case, and I confirmed it. A first line ending in two spaces, followed directly by a check line, gives a full text with three spaces before the label, while promise plus one space plus check has one. A criterion whose first line is empty, followed directly by a check line, gives an empty promise, so the rebuilt text starts with a space. No spec in the repository has either shape: all 226 criteria across the eleven run specs hold the rule.
- **Requirement:** the plan's Lexicon entry rules, fourth rule, which cannot hold together with the sixth (full text computed as today). The code follows the sixth. This traces to the plan, and I have not escalated it: tasks 02 to 06 read the two fields or compare text with whitespace collapsed, and none depends on exact equality.

### F5 — minor — An unrelated line lost the space after its equals sign
- **Where:** `packages/core/src/view-model/lexicon.ts:60`
- **Failure scenario:** The decision-line pattern now reads `CHOICE_ITEM =/^`, a stray edit outside the task's scope that lint cannot catch because the formatter is disabled.

### F6 — minor — The wrapped-check test takes a fixed three lines from the spec contract
- **Where:** `packages/core/test/lexicon-check.test.ts:67`
- **Failure scenario:** If the contract's example check shrinks to one line, the test lifts the next example criterion as a continuation line and still passes.

## Coverage

Both requirements were checked by reading the diff, running the tests, typecheck and lint, and running the lexicon tests against twenty-one deliberately broken copies of the lexicon; seventeen failed a test and four passed.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R1 | `lexicon.ts:152-153` | promise is the lines before the first labelled continuation line, joined with one space | ✓ AC1.1, AC1.3 |
| R1 | `lexicon.ts:163` | check runs from that line to the item's end, label kept | ✓ AC1.2, AC1.4 |
| R1 | `lexicon.ts:152` | detection reads continuation lines only, never the first line | ✓ AC1.5 |
| R1 | `lexicon.ts:152` | label match is case-sensitive | ✓ AC1.6 |
| R1 | `lexicon-check.test.ts:76-87` | tests of where a check starts | partial: F1, F2, F3 |
| R2 | `lexicon.ts:147-148` | full text expression is the pre-change one with the line list named | ✓ AC2.1 |
| R2 | `lexicon-check.test.ts:128-138` | ten earlier specs, 192 criteria, none with a check, each promise equal to its full text | ✓ AC2.2, AC2.3 |
| R2 | `lexicon.test.ts:160-163` | import guard test passes, and the diff does not touch its file | ✓ AC2.4 |
| absent check key | `lexicon.ts:163` | key omitted; broken copies writing `undefined` or an empty string failed 13 tests | ✓ |
| other entry kinds | `lexicon.ts:131-139`, `190-199` | requirement and decision entries unchanged; broken copies adding a promise failed | ✓ |
| new tests fail before the change | `lexicon-check.test.ts` | pre-change lexicon fails 18 of the file's 29 tests, every AC1 test included | ✓ AC8.5 claim |
| guard tests can fail | `lexicon-check.test.ts:40`, `128`, `134` | empty-string join fails AC2.1 and AC2.2; every-line-a-check break fails AC2.3 | ✓ AC8.6 claim |
| this run's own spec | `runs/criterion-check/spec.md` | 34 criteria, 30 with a check, full text equals promise, space, check for each | ✓ |
| typecheck and lint | `packages/` | both exit 0 | ✓ |
| core test suite | `packages/core/test` | 40 of 41 files pass; the readiness file timed out in setup under load | partial |
| core test suite | `core/test/readiness.test.ts` | rerun alone, 72 of 72 pass; the diff does not touch it or its subject | ✓ |
| line endings | — | not assessed: a spec with Windows line endings yields no criteria before and after the change | n/a |

## Boundary check

The diff stays inside the declared surface: the lexicon module, the new test file, and appended notes in the task's own file, which the implementer role permits. The existing lexicon test file is untouched.

Housekeeping: I overwrote the lexicon module in place for each broken copy and wrote its original bytes back afterwards. The diff of `packages/` against the reviewed commit is empty, and `git status` shows only this report.

# Round 2

**Verdict:** escalate
**Round:** 2 of 3
**Diff reviewed:** commit 88e9206, against the round-1 commit f5b1122 for this task's three files
**Summary:** The round-2 tests close every gap round 1 found in where a check starts, and the shipped behaviour is unchanged and correct. One finding remains that the implementer cannot fix, because it is a rule in the plan that contradicts two others. Approving the diff accepts the code as it stands; the plan's wording needs a human decision.

## Escalation

**Diff verdict:** approve
**Traces to:** ADR-1, through the fourth of the Lexicon entry rules in the plan's Interface contracts, which conflicts with the third and sixth
**Outside every remaining surface:** `runs/criterion-check/plan.md`, which no task's file list names and no implementer may edit

The plan promises that a criterion's full text always equals its promise, one space, then its check. That promise is false for two unusual inputs, and no change inside this task can make it true. The plan also says the full text is computed exactly as today and that the promise is trimmed. Those two rules together produce the mismatch. The code follows them, which is the safer choice, because it keeps every existing view unchanged.

Nothing downstream is harmed if the run proceeds. The four tasks that compare a quotation with the full text all collapse whitespace first, and no spec in the repository has either input. What stays wrong is the record: the plan states a rule the code does not keep.

The two inputs, reproduced this round:

- A first line ending in two spaces, then a check line. The full text has three spaces before the label.
- An empty first line, then a check line. The promise is empty, so the rebuilt text starts with a space.

The options as I see them:
- Amend the plan's fourth rule to say the two texts are equal after whitespace is collapsed. This is what I would do. It matches the code and what the later tasks already test.
- Accept the plan as written and record the mismatch as known. The run proceeds unchanged, and the rule stays false for those two inputs.
- Change the code so the full text is rebuilt from the two parts. I would not. It breaks the plan's sixth rule and changes what existing views print for a first line with trailing spaces.

## Verify round

- **F1 — resolved** — A new test puts the label mid-line on a continuation line. I broke the lexicon to match a line that contains the label, and that test failed. It passed once restored.
- **F2 — resolved** — A new test gives two labelled lines. With `findLastIndex` in place of `findIndex`, that test failed. A second broken copy, which ended the check at the last labelled line, failed the contract-example test.
- **F3 — resolved** — A new test covers `Checks`, `Checking` and `Check:run`. It failed with the colon dropped from the label, and failed again with a space demanded after the colon. One narrower gap remains, recorded as the new finding F7.
- **F4 — stands** — Nothing changed, and nothing in this task could. I reproduced both inputs and the rule fails for each. The implementer's rebuttal is correct: the defect is in the plan. It is the subject of the Escalation section above.
- **F5 — resolved** — The space after the equals sign is back. It is the only change to the lexicon module this round.
- **F6 — resolved** — The test now reads to the next criterion and requires two check lines. I shortened the contract's example check to one line, and the test failed on that requirement. I restored the contract afterwards.

### F7 — minor — No test notices letters allowed between the label's word and its colon
- **Where:** `packages/core/test/lexicon-check.test.ts:93-102`
- **Failure scenario:** The code is correct today, but no test would notice a continuation line beginning `Checking:` taken as a check; a broken copy doing so passed all 47 lexicon tests.

## Coverage

The round-2 changes were checked by reading the diff, running the full test suite, typecheck and lint, and running the lexicon tests against eleven deliberately broken copies of the lexicon; ten failed a test and one passed.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R1 | `lexicon-check.test.ts:81-85` | label mid-line on a continuation line stays in the promise; contains-the-label break fails | ✓ F1 |
| R1 | `lexicon-check.test.ts:87-91` | first of two labelled lines starts the check; last-labelled-line break fails | ✓ F2 |
| R1 | `lexicon-check.test.ts:93-102` | label needs its colon and no space; both breaks fail | partial: F7 |
| R1 | `lexicon-check.test.ts:61-79` | contract example read to the next criterion; one-line check in the contract fails the test | ✓ AC1.4, F6 |
| R1 | `lexicon-check.test.ts:104-115` | first-line label and case-insensitive breaks still fail their round-1 tests | ✓ AC1.5, AC1.6 |
| R1 | `lexicon-check.test.ts:36-38` | break that strips the label from the check fails six tests | ✓ AC1.2 |
| R2 | `lexicon.ts:60` | only a restored space changed; the full-text expression is untouched | ✓ AC2.1 |
| R2 | `lexicon.test.ts` | import guard test passes; the round-2 commit does not touch its file | ✓ AC2.4 |
| fourth plan rule | `lexicon.ts:148-153` | full text against promise, space, check on two unusual inputs | ✗ F4 |
| lexicon test files | `packages/core/test` | 47 of 47 tests pass in the two lexicon files | ✓ |
| core test suite | `packages/core/test` | 41 files, 699 tests pass; no timeout this round | ✓ |
| full test suite | `packages/` | 123 files pass and 2 skip; 1782 tests pass and 2 skip | ✓ |
| typecheck and lint | `packages/` | both exit 0 | ✓ |

## Boundary check

The round-2 commit stays inside the declared surface: the lexicon module, the new test file, and appended notes in the task's own file.

Housekeeping: I overwrote the lexicon module for each broken copy and edited the spec contract's example once, for F6. Both were restored from byte copies. `git diff` is empty and `git status` shows only this report.

# Round 3

**Verdict:** approve
**Round:** 3 of 3
**Diff reviewed:** the plan amendment in commit 7354c47, against the round-2 review commit b92035a; no implementer commit landed since round 2, so the code under review is still commit 88e9206
**Summary:** The code is unchanged since round 2 and still correct, and the amended plan now describes what it does. Two minor gaps remain in what the tests would catch, both for inputs no spec in the repository has. Approving accepts those two gaps.

## Verify round

- **F1 — resolved** — Unchanged since round 2, when a broken copy of the lexicon failed the new test. The test file is byte-identical to the round-2 commit.
- **F2 — resolved** — Unchanged since round 2. This round a broken copy that kept only the first line of a check failed the two-labelled-lines test and the contract-example test.
- **F3 — resolved** — Unchanged since round 2. The narrower gap it left is the seventh finding, F7, below.
- **F4 — resolved** — The plan's fourth Lexicon entry rule now compares the two texts with whitespace collapsed and both ends trimmed. I ran the unchanged code on both unusual inputs and on a third with tabs and doubled spaces. The amended rule held for each, and for all 226 criteria in the eleven run specs.
- **F5 — resolved** — Unchanged since round 2.
- **F6 — resolved** — Unchanged since round 2.
- **F7 — stands** — Nothing changed. A broken copy that accepts letters between the label's word and its colon still passes all 47 lexicon tests. It is minor, breaks no requirement today, and does not block approval.

### F8 — minor — No test notices the full text being rebuilt from the promise and the check
- **Where:** `packages/core/test/lexicon-check.test.ts:40-45`
- **Failure scenario:** The code is correct today. No test would notice if the full text were rebuilt from the two parts, which would change what existing views print for a criterion whose first line ends in spaces. The plan's amendment, its seventh decision (ADR-7), rejects exactly that version. I broke the lexicon to return promise, one space, check as the full text whenever a check exists. All 699 tests in the core suite passed. With that copy, `First line.  ` followed by `Check: run it.` gives a full text with one space before the label, where today it has three. No spec in the repository has this shape.
- **Requirement:** the plan's Lexicon entry rules, sixth rule (full text computed as today); the unchanged-reading requirement (R2); the can-fail criterion for guard tests (AC8.6), which the implementer's empty-join claim does satisfy as written
- **Fix:** add a test with a first line ending in two spaces followed by a check line, asserting the full text keeps three spaces before the label.

## Coverage

The amended plan rule was checked by running the unchanged code against it, and the tests were rerun with typecheck, lint, and four deliberately broken copies of the lexicon; two failed a test and two passed.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| fourth plan rule, amended | `plan.md:40` | two unusual inputs and a tab-spaced one: texts equal once whitespace is collapsed | ✓ F4 |
| fourth plan rule, amended | `runs/*/spec.md` | 226 criteria, 30 with a check: the rule holds for every one | ✓ |
| fourth plan rule, no check | `runs/*/spec.md` | 196 criteria without a check: promise equals full text exactly | ✓ AC2.2 |
| amendment's claim | `plan.md:146-153` | ADR-7 says the existing code satisfies the amended rule; confirmed by execution | ✓ |
| code since round 2 | `packages/`, `contracts/`, `roles/` | diff from commit 88e9206 to the branch tip is empty | ✓ |
| task file | `tasks/01-lexicon-promise-check.yaml` | scope, surface and acceptance list unchanged by the amendment | ✓ |
| R1 | `lexicon.ts:163` | broken copy keeping one check line fails two tests | ✓ AC1.4 |
| R1 | `lexicon.ts:153` | broken copy joining the promise without spaces fails eight or more tests | ✓ AC1.3 |
| R1 | `lexicon.ts:152` | broken copy allowing letters before the colon passes every test | partial: F7 |
| R2 | `lexicon.ts:159` | broken copy rebuilding the full text passes every test | partial: F8 |
| lexicon test files | `packages/core/test` | 47 of 47 tests pass in the two lexicon files | ✓ |
| core test suite | `packages/core/test` | 40 of 41 files pass; the readiness file timed out in setup under load | partial |
| core test suite | `core/test/readiness.test.ts` | rerun alone, 72 of 72 pass; a later full run passed 41 files, 699 tests | ✓ |
| typecheck and lint | `packages/` | both exit 0 | ✓ |
| full test suite | `packages/` | not rerun: no code changed since round 2's passing run | n/a |

## Boundary check

Nothing inside the task's surface changed this round. The only changes since round 2 are the Architect's plan amendment and the orchestrator's state commits, neither of which is implementer work.

Housekeeping: I overwrote the lexicon module for each broken copy and restored it from a byte copy each time. My first attempt at the F8 copy did not apply its edit, so I discarded that run and repeated it with the edit confirmed in the diff. `git status` shows only this report.
