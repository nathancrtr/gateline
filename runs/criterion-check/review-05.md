# Review Report: 05-record-reader-check

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit f9b700e (`git diff f9b700e^ f9b700e`)
**Summary:** The change does what the Record reader requirement asks: a spec criterion's check is wrapped so it starts its own line, and everything else renders as before. All four findings are gaps in what the tests would catch or rare input shapes, none a defect in ordinary use. Approving accepts that the browser task is the first test of the reader with a lexicon loaded.

## Findings

### F1 — minor — No test renders a checked criterion with a lexicon loaded, the only state the reader runs in
- **Where:** `packages/web/test/reader-check.test.ts:17-18`
- **Failure scenario:** The code is correct today, but no test in this task would notice if the step stopped running in the real Record reader, which always has a lexicon. I registered the step only on the no-lexicon branch of the plugin list (`packages/web/src/components/markdown.tsx:88`), so the reader would never wrap a check. All 8 tests still passed. Until the browser task lands, nothing guards that branch.
- **Requirement:** plan.md "Record reader render step", the registration rule (with or without a lexicon); AC5.1
- **Fix:** One render of a checked criterion inside a `LexiconProvider`, asserting the check element is present and an id cited inside the check still resolves.

### F2 — minor — The widened stop list (code block, blockquote, table) has no test
- **Where:** `packages/web/src/components/criterion-check.ts:29`
- **Failure scenario:** The code is correct today; with the stop list cut back to nested lists alone, all 8 tests pass, so a check could swallow a code block unnoticed.

### F3 — minor — No test has a check whose wrapped line also begins with the label
- **Where:** `packages/web/src/components/criterion-check.ts:50`
- **Failure scenario:** The code is correct today; splitting at the last label instead of the first passes all 8 tests, and would leave the check's first line in the promise.

### F4 — minor — A check reached through a hard break or spanning emphasis gets no check element
- **Where:** `packages/web/src/components/criterion-check.ts:26`
- **Failure scenario:** A promise line ending in two spaces, or emphasis opened in the promise and closed in the check, renders with no check element, while the lexicon would report a check.

## Coverage

Every criterion this task claims was checked by reading the diff and by running it: the new tests, the whole web suite, typecheck, lint, thirteen deliberate breaks, and twenty-four probe renders with and without a lexicon.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R5 | `criterion-check.ts:37-57` | check wrapped in a span with the hook and the block class; promise stays outside | ✓ AC5.1 |
| R5 | `criterion-check.ts:40-42` | wrapped check, inline code, raw placeholders, ordered and nested items, CRLF and tab indents all wrap correctly | ✓ AC5.1 |
| R5 | `markdown.tsx:87-89` | probe render inside a lexicon provider with line stamping wraps the check and resolves ids inside it | ✓ AC5.1 |
| R5 | `reader-check.test.ts:46-60` | dupefind spec equals the no-kind render and a rebuilt pre-change pipeline | ✓ AC5.2 |
| R5 | `criterion-check.ts:60-61` | kind gate and criterion test; removing either fails the matching unchanged-render test | ✓ AC5.3 |
| R5 | `criterion-check.ts:26` | case-sensitive label after a line break; case-insensitive variant fails the lower-case test | ✓ AC5.3 |
| plan: render step contract | `criterion-check.ts:12` | signature matches; type-only import; bundle guard test passes | ✓ |
| plan: untouched item | `criterion-check.ts:45` | early return before any node is replaced | ✓ |
| plan: DOM hooks | `criterion-check.ts:54` | hook name and block class as the table gives them; class already in use in the web package | ✓ |
| AC8.5 claim | `markdown.tsx:87` | step unregistered: the four AC5.1 tests fail, the other four pass | ✓ |
| AC8.6 claim | `reader-check.test.ts:64-85` | each unchanged-render test fails under its named break and passes once restored | ✓ |
| suite, typecheck, lint | `packages/` | 33 files and 537 tests pass; typecheck and lint clean | ✓ |
| line placement in a browser | — | not assessed: owned by the browser task, 06 | n/a |
| lexicon and reader agreement | — | not assessed: the lexicon change is on another task's branch; the browser task compares them | n/a |

## Boundary check

The three code files changed are exactly the task's declared surface. The commit also appends the round-1 notes to the task's own work item, which is where implementer notes live. My deliberate breaks and one temporary probe test were reverted; the working tree holds this report and nothing else.
