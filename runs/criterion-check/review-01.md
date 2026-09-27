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
