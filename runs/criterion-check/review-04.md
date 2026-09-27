# Review Report: 04-hover-card-and-cited-list

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 20be864 (`git diff 20be864^ 20be864`)
**Summary:** The hover card and the cited-ids list behave as the spec asks, confirmed in a browser at both widths. The findings are gaps in what the tests would catch, not defects in shipped behaviour. The largest is that nothing in this run, the browser task included, would notice the hover card cutting a long check again.

## Findings

### F1 — major — No test notices the style rule that stops the hover card cutting a check being lost
- **Where:** `packages/web/test/lexicon-check.test.ts:153-155`
- **Failure scenario:** The code is correct today: a long checked criterion shows whole in the hover card at a 320-pixel width. No test would notice if the card went back to cutting it at six lines, which would hide the end of a check from anyone reading the card on a phone. The test named for lifting the cut reads the quotation's class name and nothing else; no test reads the stylesheet rule that class depends on (`packages/web/src/styles.css:480-482`). I measured a mutant, meaning a copy I broke on purpose to see whether a test fails: the same markup without the rule's effect. In headless Chromium at 320 pixels, with a 190-character promise and a 190-character check, the quotation was cut to 132 pixels of a 219-pixel content height and the check's last word fell below the visible box. With the rule, the last word was inside. The later browser task cannot catch this either. The demo criterion it reads fills five lines at 320 pixels, and its quotation measured 117 pixels tall with the rule and without it, so the plan's named early signal, a cut check in the 320-pixel screenshot, cannot appear.
- **Requirement:** the plan's third decision (ADR-3); the plan's DOM hooks contract, which says the six-line cut does not apply to an entry with a check; the can-fail criterion for guards (AC8.6)
- **Fix:** in the task's own test file, compile the stylesheet as the round-1 notes describe and assert the modifier's rule sets the line clamp to unset and comes after the base rule. The repository's contrast test already reads the stylesheet from a test.

### F2 — minor — No test notices the promise or the check losing its markdown rendering
- **Where:** `packages/web/test/lexicon-check.test.ts:130-138`
- **Failure scenario:** The code is correct today: the promise and the check each go through the markdown renderer. No test would notice if either were printed as plain text, which would show a reader literal backticks and asterisks in any criterion that uses them. The fixture criterion holds no markdown, and the tests compare text with tags stripped. Two mutants, the promise printed as plain text and the check printed as plain text, each passed all 13 tests. The same break on the path for a criterion without a check fails one test, because that test compares the inner markup.
- **Requirement:** the task's scope, item 1 (each through the markdown renderer the card uses today); the plan's DOM hooks contract (the hover card keeps rendering markdown)
- **Fix:** give the checked fixture criterion a code span in its check, and assert the check element's inner markup holds a paragraph with a code element.

### F3 — minor — No test notices a cut or a truncating class added inside the checked quotation
- **Where:** `packages/web/test/lexicon-check.test.ts:140-144`
- **Failure scenario:** The code is correct today; a one-line truncation class on the check element, a two-line cut around the promise, and text cut at 110 characters each passed all 13 tests.

### F4 — minor — The web build cannot run in a job worktree, and the browser task needs it
- **Where:** `packages/orchestrator/src/deps.ts:73-83`
- **Failure scenario:** The next implementer's required build command fails until they reinstall: dependencies are seeded from the root and one folder down, and the build's React plugin installs two folders down.

## Coverage

Both requirements this task claims were checked by reading the diff and by running it: the new tests, the web suite, typecheck, lint, twenty-six deliberately broken copies of the component, and the compiled styles measured in a headless browser at both widths.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R4 | `lexicon.tsx:227-232` | promise, whitespace, then the check in a block span carrying the check hook, each through the markdown renderer | ✓ AC4.1 (markup half) |
| R4 | `lexicon.tsx:227` | quotation carries the quote hook; its text, whitespace collapsed, equals the full text | ✓ AC4.2 (markup half) |
| R4 | `lexicon.tsx:234-236` | criterion without a check renders the full text through the old path; the quote hook is the only markup difference | ✓ AC4.3 (markup half) |
| R4 | `lexicon.tsx:234` | requirements and decisions get no hook and no modifier; opening tag equals the pre-change tag | ✓ |
| R4 | `lexicon.tsx:226` | check branch taken only when the check key is present; the lexicon never writes an empty check | ✓ |
| ADR-3 | `styles.css:480-482` | compiled rule sets display block, overflow visible, line clamp unset, after the base rule | ✓ |
| ADR-3 | headless Chromium, 320 and 1280 | long checked criterion shows whole with the rule; base rule alone cuts it at 320 | ✓ |
| ADR-3 | `lexicon-check.test.ts:153-155` | the test reads the class name only; the rule itself is unguarded | partial: F1 |
| check starts a line | headless Chromium, 320 and 1280 | check element's top sits 4 pixels below the promise's bottom; right edge inside the card | ✓ |
| R6 | `lexicon.tsx:359` | checked criterion's entry shows the promise, whitespace collapsed; the existing truncation classes unchanged | ✓ AC6.1 (markup half) |
| R6 | `lexicon.tsx:359` | criterion without a check, requirements and decisions take the old expression | ✓ AC6.2 (markup half) |
| empty promise | `lexicon.tsx:228`, `359` | the plan's unusual criterion with an empty first line renders an empty promise and none of the check | ✓ |
| new tests fail before the change | `lexicon-check.test.ts` | pre-change component fails 7 of 13, every checked-criterion test included | ✓ AC8.5 claim |
| checked-path breaks | `lexicon-check.test.ts:123-156` | dropped modifier, dropped hook, no separating space, no block class, stripped label, body as promise each fail | ✓ |
| guard tests can fail | `lexicon-check.test.ts:158-200` | unchecked path: dropped hook, hook on every kind, added modifier, added class, definition quoted, plain text each fail | ✓ AC8.6 claim |
| list breaks | `lexicon-check.test.ts:185-200` | list quoting the full text, the check, or the definition each fail | ✓ |
| test strength | `lexicon-check.test.ts` | eight of the twenty-six broken copies pass every test | partial: F2, F3 |
| test helpers | `lexicon-check.test.ts:60-111` | element finder balances nested tags; fixture test pins the lexicon's own promise and check | ✓ |
| untouched functions | `lexicon.tsx` | card placement, the rehype stage, cited text and the walk carry no changed line | ✓ |
| web suite, typecheck, lint | `packages/` | 35 files and 557 tests pass; typecheck and lint exit 0 | ✓ |
| web build | `packages/web` | fails to load the React plugin in this worktree; not a check this task names | n/a: F4 |
| browser tests against the real page | — | not assessed: owned by the browser test task, and the build cannot run here | n/a |

## Boundary check

The three code files changed are exactly the task's declared surface. The commit also appends the round-1 notes to the task's own work item, which is where implementer notes live.

Housekeeping: my broken copies were two temporary files beside the component and its test, removed after the run; the working tree holds this report and nothing else. My browser measurements used hand-built markup matching the component's output and the browser's default fonts, since the web fonts are served by the build.
