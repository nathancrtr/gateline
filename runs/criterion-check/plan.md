# Technical Plan: A criterion's check is shown apart from its promise

## Approach

The lexicon starts handing out a criterion's promise and its check as two separate pieces of text, and each view that quotes a criterion places them on separate lines or drops the check. The full text every view reads today stays as it is, so a criterion without a check takes the same code path and produces the same output as before.

The work falls into four moves:

- The lexicon gains the two new fields (R1, R2). It stays a module with no imports.
- The terminal footnotes and the demo fixtures change together (R7, R8). The fixture's one new check line alters terminal output that an existing test pins, so neither can land alone.
- Three web views change in three separate files (R3, R4, R5, R6). The G2 card and the hover card read the new fields. The Record reader renders the spec file itself, so it gets a small render step of its own that finds the check line inside a criterion's list item.
- One new browser test file proves the placement at both widths and saves the screenshots the verifier needs (R8).

Nothing in the protected set (R9) appears in any task's file list.

Tests follow the repository's three layers. The lexicon is tested as a pure function. The web views are tested as static markup. Line placement and overflow are tested in a real browser, because only a browser performs layout.

The environment was read and never executed, because this planning session had no shell. The workspace manifest asks for Node 24 or later, vitest 4.1 and Playwright 1.61. The Risks section names the early signal.

## Interface contracts

### Lexicon entry (task 01)

```ts
// packages/core/src/view-model/lexicon.ts
export interface LexiconEntry {
  // ...every existing field unchanged, `body` included
  /** Criteria only. The lines before the check, joined as `body` joins them. */
  promise?: string
  /** Criteria only, and only when the spec gives one. Begins with `Check:`. */
  check?: string
}
```

Rules, all in task 01:

- A criterion's lines are its first line after the `AC<n>.<m> — ` marker, then each continuation line trimmed.
- The check starts at the first continuation line whose trimmed text begins `Check:`, case-sensitive. It runs to the end of the item.
- `promise` and `check` each join their lines with one space and trim the result.
- With a check, `body` and `promise + ' ' + check` are equal once whitespace is collapsed in both. Collapsing turns each run of whitespace into one space and removes whitespace from both ends. Without a check, `promise === body` and the `check` key is absent, never `null` or `''`.
- Requirement and decision entries carry neither key.
- `body`, `definition`, `line` and every other field are computed exactly as today.

The server route and `packages/web/src/api.ts` re-export the core type, so the fields reach the browser with no server change.

### DOM hooks (tasks 03, 04, 05; read by task 06)

| Hook | Where | Meaning |
|------|-------|---------|
| `data-criterion-quote` | G2 card, hover card | Wraps promise and check. Its text content, whitespace collapsed, equals the entry's `body`. |
| `data-criterion-check` | G2 card, hover card, Record reader | Holds the check and nothing else. Displayed as a block, so it starts a line. |

A criterion without a check renders through today's code path from `body`. Its only permitted markup difference is the `data-criterion-quote` attribute.

The G2 card keeps quoting plain text. The hover card keeps rendering markdown, once for the promise and once for the check. In the hover card, the six-line clamp on `.lex-card-def` does not apply to an entry that has a check (ADR-3).

### Cited-ids list (task 04)

A criterion's entry shows `promise`, whitespace collapsed, truncated by the existing CSS. Requirements and decisions are unchanged.

### Record reader render step (task 05)

```ts
// packages/web/src/components/criterion-check.ts  (new; type-only imports)
export const criterionCheckRehype: (sourceKind?: ArtifactKind) => () => (tree: HNode) => void
```

- It acts only when `sourceKind === 'spec'`, and only inside a list item whose text begins with a criterion id and dash, the same test `lexiconRehype` uses.
- It looks at the item's own inline children, or those of its first paragraph when the list is loose. Code, links and nested lists are skipped.
- It finds the first text node in which a line break is followed directly by `Check:`. It splits there. The line break stays before the new element as whitespace.
- Everything from `Check:` to the end of that inline run, stopping before any nested list, moves into one `span` with `data-criterion-check` and the class `block`.
- `Markdown` registers it after `rawAsText` and before `lexiconRehype`, whether or not a lexicon is loaded.
- An item with no such line is returned untouched, node for node.

### Terminal footnotes (task 02)

Default mode, a criterion with a check: the quote is `promise`, whitespace collapsed, truncated to 110 as today.

Full mode, a criterion with a check, where `width` is the existing id column width:

```
  AC1.1  "The snapshot generator never opens a network port.
          Check: its script contains neither port-binding call the server makes."
```

The second line is indented `width + 5` spaces. One pair of quotation marks spans both lines. Every entry without a check prints through today's expression, unchanged.

### Fixture (task 02)

In `packages/fixtures/src/index.ts`, the `spec` template gains exactly one line, directly under its `AC1.1` item:

```
  Check: run it on the bundled sample and compare against the documented output.
```

No other line of the file changes. `g1Spec`, `malformedSpec` and every other template stay as they are.

### Screenshots (task 06)

The browser test saves twelve images with `testInfo.outputPath`, named `<view>-<shape>-<width>.png`. The values are `g2 | hover | reader`, `check | plain`, and `320 | 1280`. They are test output for the verifier and are never committed as baselines.

### Proving a test can fail (every task)

Each task's notes carry one `claim:` entry per new test file. A test of new behaviour names the command that failed on the pre-change code. A test guarding unchanged behaviour names the deliberate break that turned it red.

## Decisions (ADRs)

**For G1 to decide:**
- ADR-3 — the hover card stops cutting a criterion at six lines when it has a check
- ADR-4 — how the terminal's full mode lays out the check line
- ADR-5 — the check line goes into the fixture spec that ten demo runs share
- ADR-6 — screenshots are saved as test output and no baseline image is committed

### ADR-1: The lexicon splits a criterion once and every view reads the result
- **Choice:** The lexicon returns the promise and the check as two new pieces of text beside the full text. The exact fields and rules are in Interface contracts under "Lexicon entry".
- **Rejected:** Letting each view split the full text at the check's label. A criterion whose first line contains the label would split in the wrong place, and four views would each carry a copy of the rule.
- **Consequences:** Anything that reads the full text today keeps working with no change. The lexicon's response grows by roughly the length of each criterion.

### ADR-2: The Record reader finds the check in the rendered list item
- **Choice:** The Record reader gets a render step that runs only on a spec and only inside a criterion's list item. It wraps the check so that it starts a line. The signature is in Interface contracts under "Record reader render step".
- **Rejected:** A style rule that honours every line break inside list items. It would break each wrapped criterion of every finished spec at the column where its author wrapped it, which changes how those records read.
- **Consequences:** The rule for where a check starts now exists in two places, the lexicon and the reader. The browser test compares the two on the same criterion, so drift fails a test.

### ADR-3: The hover card shows a criterion with a check in full
- **Choice:** The hover card stops cutting its quotation at six lines when the criterion has a check. Every other card keeps the cut.
- **Rejected:** Keeping the six-line cut everywhere. On a phone-width card a criterion at the contract's word limit can run past six lines, and the cut would remove the end of the check, which the brief forbids.
- **Consequences:** A hover card for a checked criterion can be taller than any hover card is today. Cards for requirements, decisions and criteria without a check look exactly as before.

### ADR-4: Full-mode footnotes print the check indented under its promise
- **Choice:** In the terminal's full mode the check prints on the next line, indented to sit under the first letter of the promise. One pair of quotation marks opens before the promise and closes after the check. The layout is in Interface contracts under "Terminal footnotes".
- **Rejected:** Printing the check at the left margin with its own quotation marks. It would read as a separate footnote with no id, and the label would follow a quotation mark instead of opening the text.
- **Consequences:** The label is the first text on its line after the indentation, which is how this plan reads the full-mode criterion (AC7.2). A script that parses footnotes one line per id will meet a line with no id, in full mode only.

### ADR-5: The check line goes into the shared fixture spec
- **Choice:** The demo's shared spec template gains one check line under its first criterion. The terminal change and the fixture change ship as one task. The exact line is in Interface contracts under "Fixture".
- **Rejected:** A new spec template used only by the run awaiting G2. It needs a second edit outside any template to wire it in, which the one-template criterion (AC9.2) rules out.
- **Consequences:** Ten demo runs gain the check line, where the spec asked only about the run awaiting G2. Two further effects follow:
  - Every line below the first criterion in those specs moves down by one.
  - The demo plan already cites that criterion, so the terminal tests need no other fixture change.

### ADR-6: Screenshots are test output, and no baseline image is committed
- **Choice:** The browser test saves the twelve screenshots into its output folder for the verifier to attach. The two unchanged-look criteria (AC3.3, AC4.3) are settled by the verifier comparing a capture from the pre-change commit.
- **Rejected:** Committed baseline images that the test suite compares on every run. The repository's layout test suite already decided against baselines, because they need pinned rendering to hold across machines and fail on every deliberate change.
- **Consequences:** Nothing in CI guards the unchanged look after this run. The static markup tests guard the unchanged structure instead.

### ADR-7 (amendment, 2026-09-26): The full text matches the promise and check in words, and may differ in spacing
- **Context:** The reviewer of the lexicon task escalated a rule in this plan that two of its other rules make false for two unusual criteria, recorded as finding F4 in that task's review report.
- **Choice:** The plan now promises that a criterion's full text holds the same words in the same order as its promise followed by its check, and the two may differ in spacing alone. The human who resolved the escalation chose this wording. The exact rule is the fourth under "Lexicon entry" in Interface contracts.
- **Rejected:** Rebuilding the full text from the promise and the check, so that the old rule holds exactly. It would change what existing views print for a criterion whose first line ends in spaces, which the unchanged-reading requirement (R2) forbids. Leaving the rule as written was also turned down, because the plan would go on stating something the code does not do.
- **Consequences:** No shipped behaviour changes, and the code the lexicon task has already produced satisfies the amended rule. Two further effects follow:
  - Collapsing whitespace is defined here to include removing it from both ends. The resolution note did not spell that out, and one of the two unusual criteria needs it.
  - The two unusual criteria are a first line ending in spaces and an empty first line, each followed directly by a check. No spec in the repository has either shape.
- **Superseded:** See Context. Interface contracts, "Lexicon entry", the fourth rule: "With a check, `body === promise + ' ' + check`. Without one, `promise === body` and the `check` key is absent, never `null` or `''`."

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-lexicon-promise-check |
| R2 | 01-lexicon-promise-check |
| R3 | 03-g2-card-check, 06-e2e-criterion-check |
| R4 | 04-hover-card-and-cited-list, 06-e2e-criterion-check |
| R5 | 05-record-reader-check, 06-e2e-criterion-check |
| R6 | 04-hover-card-and-cited-list, 06-e2e-criterion-check |
| R7 | 02-cli-footnotes-and-fixture |
| R8 | 02-cli-footnotes-and-fixture, 06-e2e-criterion-check |
| R9 | 02-cli-footnotes-and-fixture |

Tasks 01 and 05 can start at once and run in parallel. Tasks 02, 03 and 04 wait for 01 and then run in parallel with each other. Task 06 waits for 02, 03, 04 and 05.

## Risks

- **Nothing in this plan was executed.** The planning session could read files and could not run a command. The early signal is the first test run in the lexicon task (01). A toolchain mismatch shows there before any view is touched.
- **The fixture's new line may break tests that pin the demo spec.** Line numbers below the first criterion shift by one in ten demo runs. The early signal is the full test suite in the terminal and fixture task (02), which that task must run whole.
- **The Record reader has never been laid out for a phone.** The layout test suite says so, and it sweeps only the run pages at 320 pixels. Two of the three views in the 320-pixel screenshots sit inside the reader. The early signal is the overflow assertion in the browser task (06) failing for a criterion without a check, which is an escalation because restyling is out of scope.
- **The G2 card's quotation may be squeezed at 320 pixels.** It sits between two elements that refuse to shrink, the pattern behind an earlier overflow defect on the G1 card (#454). The early signal is the same assertion, on the G2 card.
- **Lifting the six-line cut may behave unevenly across the hover card's two paragraphs.** The early signal is the 320-pixel hover screenshot showing a cut check.
- **The reader's rule could drift from the lexicon's.** The browser task compares the reader's check text with the G2 card's for the same criterion.
