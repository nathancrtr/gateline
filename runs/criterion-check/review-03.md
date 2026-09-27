# Review Report: 03-g2-card-check

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit c318081 (`git diff c318081^ c318081`)
**Summary:** The G2 card now quotes a checked criterion as its promise followed by its check in a block of its own, and a criterion without a check renders as before. Both findings are gaps in what the tests would catch, not defects in shipped behaviour. Approving accepts that the unchanged look rests on the verifier's screenshots.

## Findings

### F1 — minor — No test notices the quotation's styling classes changing, for either criterion shape
- **Where:** `packages/web/test/g2-criterion-check.test.ts:184-191`
- **Failure scenario:** The code is correct today: the quotation keeps the class list it had before the change. No test would notice if that list changed, which would alter how every criterion on the card looks to the approver. The tests read the quotation's text and its child elements, and never its opening tag. I tried a mutant, meaning a copy of the component I broke on purpose to see whether a test fails: the quotation's classes replaced with a larger, italic, muted style. All 7 tests passed. No other test in the web or browser suites names those classes. A second mutant that added a one-line truncation class to the check element also passed all 7.
- **Requirement:** the plan's DOM hooks contract (the attribute is the only permitted markup difference for a criterion without a check); the sixth decision's consequence (ADR-6), which names the static markup tests as the guard on unchanged structure once the run ends; the unchanged-look criterion (AC3.3)
- **Fix:** assert the unchecked quotation's opening tag equals the pre-change tag plus the new attribute.

### F2 — minor — No test notices a long promise or full text being cut short
- **Where:** `packages/web/test/g2-criterion-check.test.ts:30-34`
- **Failure scenario:** The code is correct today; both fixture criteria are under 80 characters, so cutting the promise at 110 characters, or the unchecked text at 120, passes all 7 tests.

## Coverage

The one requirement this task claims was checked by reading the diff and by running it: the new tests, the whole web suite, typecheck, lint, and the new tests against twelve deliberately broken copies of the component, of which seven failed a test.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R3 | `evidence.tsx:358-365` | promise, one space, then the check in a span with the block class and the check hook | ✓ AC3.1 (markup half) |
| R3 | `evidence.tsx:354` | quotation span carries the quote hook; its text, whitespace collapsed, equals the full text | ✓ AC3.2 (markup half) |
| R3 | `evidence.tsx:366-368` | criterion without a check renders the full text as the span's only child, class list unchanged | ✓ AC3.3 (markup half) |
| R3 | `evidence.tsx:358` | branch taken only when the check key is present; the lexicon never writes an empty check | ✓ |
| plan: DOM hooks | `evidence.tsx:354`, `361` | hook names match the contract; both pieces stay plain text; no label, colour or fold added | ✓ |
| undefined criterion | `evidence.tsx:369-371` | the cited-but-undefined message is unchanged and carries no hook | ✓ |
| new tests fail before the change | `g2-criterion-check.test.ts` | pre-change component fails 4 of 7, all three checked-criterion tests included | ✓ AC8.5 claim |
| checked-path breaks | `g2-criterion-check.test.ts:144-170` | no separating space, no block class, full text in place of promise, and swapped order each fail | ✓ |
| guard tests can fail | `g2-criterion-check.test.ts:184-191` | unchecked text wrapped in an element, or quoted from the definition, each fail | ✓ AC8.6 claim |
| test strength | `g2-criterion-check.test.ts` | changed classes and truncated text pass every test | partial: F1, F2 |
| which definition is quoted | `evidence.tsx:340` | taking the first definition of a repeated id passes every test; the line's behaviour predates this diff | n/a |
| test helpers | `g2-criterion-check.test.ts:94-124` | element finder balances nested tags; the block-class pattern rejects hyphenated and prefixed variants | ✓ |
| web suite, typecheck, lint | `packages/` | 34 files and 544 tests pass; typecheck and lint exit 0 | ✓ |
| line placement and overflow | — | not assessed: browser facts owned by the browser test task | n/a |

## Boundary check

The two code files changed are exactly the task's declared surface. The commit also appends the round-1 notes to the task's own work item, which is where implementer notes live. My broken copies were separate temporary files, removed after each run; the working tree holds this report and nothing else.
