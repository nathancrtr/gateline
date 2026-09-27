# Review Report: 06-e2e-criterion-check

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 7424730 (`git diff 7424730^ 7424730`)
**Summary:** The browser test passes, saves all twelve screenshots, and catches every break the implementer named. One gap in what it would catch blocks approval: a check that is hidden or cut off from below passes every test in the repository. No shipped behaviour is wrong today. Approving now would accept that a vanished check goes unnoticed.

## Findings

### F1 — blocking — A check that is clipped out of sight still passes every placement and containment test
- **Where:** `packages/e2e/criterion-check.spec.ts:167-178`
- **Failure scenario:** The views are correct today. No test would notice if a view stopped showing the check, so an approver could be handed a criterion with no visible check while every suite stays green. I made a deliberate break, a temporary edit to the code under test that I reverted afterwards: one rule appended to the web stylesheet (`packages/web/src/styles.css`) giving the check element a six-pixel maximum height with its overflow hidden. The saved screenshots then showed the promise alone in the G2 card, the hover card and the Record reader, at both widths. All 17 tests of this file passed, as did the whole browser suite (83) and the web package's static tests (564). The placement helper (`:96-119`) and the containment helper (`:122-134`) read where the check's text is laid out, and clipped text keeps its layout position. Containment compares the right edge only. The same break written as classes on the G2 card's check (`packages/web/src/components/evidence.tsx:361`) also passed everything.
- **Requirement:** AC3.1, AC4.1, AC5.1 (the check is shown on its own line); AC8.4 (no check runs past the edge of what holds it); plan.md Risks, the entry on a cut check in the hover card
- **Fix:** Assert the check is painted as well as placed. Either require every line box of the check to lie inside each clipping ancestor up to the container, bottom edge included, or hit-test the middle of the check's last line box and require the element found to be inside the check.

### F2 — minor — The screenshot clip stops at the viewport, so a word past it is cropped
- **Where:** `packages/e2e/criterion-check.spec.ts:161-162`
- **Failure scenario:** A word running past the viewport's right edge would be cropped from the saved picture the verifier reads; every container sits inside the viewport today, so no current capture is affected.

## Coverage

Every criterion the task claims was checked by reading the diff and by running it: the full browser suite, the unit suites, typecheck, lint, the pre-change web build, eight deliberate breaks, and one probe of container positions at the phone width.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R3 | `criterion-check.spec.ts:189-201` | G2 check made inline: the test fails at both widths | ✓ AC3.1 |
| R3 | `criterion-check.spec.ts:199` | quotation compared with the spec read from the fixture repository by git, not with a copied string | ✓ AC3.2 |
| R4 | `criterion-check.spec.ts:214-235` | hover card opened on the first reference; placement, block display and quotation asserted | ✓ AC4.1, AC4.2 |
| R5 | `criterion-check.spec.ts:256-267` | reader check made unwrappable: the test fails at 320 pixels | ✓ AC5.1 |
| R3, R4, R5 | `criterion-check.spec.ts:167-178` | check clipped from below in all three views: every test passes | ✗ F1 |
| R6 | `criterion-check.spec.ts:309-312` | list made to quote the full text of a checked criterion: the test fails | ✓ AC6.1 |
| R6 | `criterion-check.spec.ts:314-316` | unchecked entry cut to 30 characters: the test fails, and passes once restored | ✓ AC6.2, AC8.6 claim |
| R8 | `criterion-check.spec.ts:319-325` | G2 card holds one criterion with a check element and one without | ✓ AC8.1 |
| R8 | `criterion-check.spec.ts:152-164` | twelve images written under the planned names; six opened and read | ✓ AC8.2, AC8.3 |
| R8 | `criterion-check.spec.ts:122-134` | right-edge overrun against card or pane; unwrappable check fails in hover card and reader | partial AC8.4, F1 |
| R8 | position probe at 320 pixels | hover card, reader pane and page all lie inside the viewport, none scrolling sideways | ✓ |
| AC8.5 claim | web source of commit 458c851 | 10 of 17 tests fail, the 7 others pass, all twelve screenshots are written | ✓ |
| plan ADR-2 | `criterion-check.spec.ts:279-291` | reader check text compared with G2 card check text at both widths | ✓ |
| plan ADR-3 | `packages/web/test/lexicon-check.test.ts:227-232` | six-line cut restored: a static stylesheet test from task 04 fails, the browser file does not | ✓ |
| plan ADR-6 | `criterion-check.spec.ts:163` | no committed image and no baseline comparison anywhere in the file | ✓ |
| task scope: own server | `criterion-check.spec.ts:44-53` | fixture repository generated and served on a port the system assigns; no existing browser file edited | ✓ |
| full browser suite | `packages/` | build succeeds; 83 tests pass, the existing files included | ✓ |
| unit suites, typecheck, lint | `packages/` | 1745 pass; one untouched core file timed out in setup under load, then passed alone with 72 | ✓ |
| rendered agent files | repository root | render staleness check reports every file up to date | ✓ |
| AC3.3, AC4.3 | — | not assessed: the verifier compares the plain screenshots with pre-change captures | n/a |

## Boundary check

The one code file changed is the task's declared surface. The commit also appends the round-1 notes to the task's own work item, which is where implementer notes live.

Housekeeping: the worktree's installed dependencies were incomplete, so I reinstalled them from the lockfile before building. Each deliberate break and the temporary probe file were reverted or removed; the working tree holds this report and nothing else.
