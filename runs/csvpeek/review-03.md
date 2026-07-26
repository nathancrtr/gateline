# Review Report: 03-unit-tests

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit `f629da3` (branch `run/csvpeek`); `apps/csvpeek/test_core.py` blob `a817e25`, working tree verified byte-identical.

## Findings

### F1 — blocking — no test exercises the ADR-11 amended `detect_delimiter` contract; the suite passes with the ADR-11 fix reverted
- **Where:** `apps/csvpeek/test_core.py:40-63` (delimiter section: only `;`, `,`, and `''` inputs)
- **Failure scenario:** verified by mutation — deleting the probe block (`csvpeek.py:36-39`, ADR-11 step 3) leaves all 24 tests passing, yet `parse_csv('"')` again raises `ValueError: bad delimiter or quotechar value` on Python 3.14.6 — the exact review-01 F1 defect, which already recurred once in this run as a fix-on-paper-only (review-01 round 2). An interpreter-portable assertion exists: for pathological inputs (`'"'`, `'"""'`), `detect_delimiter` does not raise and `csv.reader([], delimiter=csvpeek.detect_delimiter(text))` constructs (the contract's guarantee), plus `parse_csv` on those inputs not raising.
- **Requirement:** plan.md ADR-11 Consequences ("Task 03's delimiter tests should exercise the amended contract as written"); amended `detect_delimiter` docstring/guarantee in "Interface contracts"; task scope line "Test against the interface contract … in plan.md" (R4).

### F2 — blocking — the AC7.2 assertion `len(result) <= 5` cannot fail for truncation-bound mutants; `TOP_N = 4` survives the entire suite
- **Where:** `apps/csvpeek/test_core.py:131-136`; no other test uses a column with >5 distinct values (populated fixture `:188-207` maxes at 3)
- **Failure scenario:** verified by mutation — changing `TOP_N = 5` to `4` (equally `[:4]`/`[:3]` in `top_values`) passes all 24 tests; a real report over a 6+-distinct-value column would then list 4 common values, violating the spec's "up to 5 most frequent" and the plan's `TOP_N: int  # = 5`. Correct behavior for the test's own 7 distinct values returns exactly 5 pairs — assert the full expected 5-pair list (which also pins tie-break selection under truncation) instead of `<= 5`.
- **Requirement:** AC7.2 + spec Assumption (top-5 bound); plan interface contract `TOP_N`/`top_values`; task acceptance test 3 ("corresponding function-level assertion" — present but unable to discriminate).

### F3 — minor — `parse_csv` ragged passthrough (and AC8.1's row-count-inclusion clause) unpinned at unit level
- **Where:** `apps/csvpeek/test_core.py:149-166` (ragged section tests `column_values` only; every `parse_csv` test uses uniform rows)
- **Failure scenario:** verified by mutation — a `parse_csv` that drops rows with `len(row) != len(header)` passes all 24 tests; `parse_csv("a,b,c\nx,y\n")` → `([...], [])`, so a ragged row vanishes from the row count (AC8.1: "that row is included in the row count"). Minor because task 04's e2e AC8.1 test is mapped to catch this at CLI level; a one-line `parse_csv` ragged-row assertion closes it here.
- **Requirement:** AC8.1; plan `parse_csv` contract ("kept exactly as csv.reader yields them").

### F4 — minor — the blank rule ("blank iff exactly `''`") is never tested against a whitespace-only value
- **Where:** `apps/csvpeek/test_core.py:105-117` (missing section; no whitespace-only value appears anywhere in the suite)
- **Failure scenario:** verified by mutation — `count_missing` using `v.strip() == ""` passes all 24 tests; `count_missing([" "])` would return 1 instead of 0 (and a strip-based blank rule in `infer_type`/`top_values` is likewise undetectable).
- **Requirement:** spec Assumption (blank = exactly the empty string, no whitespace handling); plan `count_missing` contract (R6).

### F5 — minor — lexicographic tie-break for numeric-looking values untested
- **Where:** `apps/csvpeek/test_core.py:139-146` (ties test uses alphabetic strings only)
- **Failure scenario:** verified by mutation — a numeric-aware tie key passes all 24 tests but yields `top_values(['10','2','10','2']) == [('2', 2), ('10', 2)]`; the plan pins `'10'` before `'2'` ("lexicographic on the string, even for numeric-looking values", ADR-6 consequence).
- **Requirement:** plan `top_values` contract / ADR-6; spec tie-break assumption (R7).

## Coverage

Checked and found clean (all executed, not just read; Python 3.14.6, pytest 9.1.1, from `apps/csvpeek/`):

- **Acceptance tests:** `pytest test_core.py` → 24 passed (AC11.1 partial ✓); `pytest test_core.py --collect-only` → 24 distinct, individually named tests; all six AC11.2 substrings present in collected names — `row_count` ×3, `columns` ×1, `delimiter` ×3, `type` ×6, `missing` ×3, `common` ×3 ✓.
- **Minimum-behaviors list:** every bullet in the task scope has a corresponding assertion against the right function with independently derived expected values — AC2.1, AC2.2, AC10.1 (`parse_csv`), AC3.1, AC4.1, AC4.2 + empty-text fallback, AC5.1–5.3 (both 5.3 variants), AC6.2, empty/all-blank→`string`, AC6.1 (three cases), AC7.1 (full ranked list, not just first place), tie order + repeat-call determinism, ragged pad + extra-ignore, AC10.1/AC10.2/populated `format_report` ✓. No vacuous test (every test has an assertion that can fail); no test asserts implementation internals over contract.
- **Byte-exact fixtures vs plan "Report format":** hand-verified — empty report exactly `Rows: 0\nColumns: 0\n`; populated fixture pins summary-line order, one blank line before each column block, two-space indentation, header order (`name` before `age`), `Common:` ordering (count desc, then ascending value among the x/y/z tie), `Missing: 1`, `integer`/`string` types, `(none)` handling (header-only test), every line `\n`-terminated, no trailing blank line ✓. The AC10.2 substring-style test is non-vacuous in combination with the byte-exact fixtures.
- **Mutation screening (all seven functions under test):** killed mutants confirmed include hardcoded-comma parsing (semicolon test), `Counter.most_common` insertion-tie-order (apple/zebra test), blank-values-ranked-as-common (populated fixture's `age` column), all-float-without-int-distinction `infer_type` (AC5.1 test), wrong pad value / unignored extras in `column_values`, trailing-blank-line and reordered-block `format_report` mutants (byte-exact tests). The only surviving mutants found are F1–F5 above, each verified by running the mutated module against the unmodified suite.
- **Constraints:** imports = `csvpeek` only; stdlib + pytest discovery only; no fixture files on disk; no `conftest.py`, no `__init__.py` created (matches notes; the pre-authorized fallback was indeed unneeded — `import csvpeek` works from `apps/csvpeek/`) ✓.
- **Implementer notes:** 24-test count, pass claim, collect-only claim, and interpreter versions all reproduce exactly ✓. The notes' own flag that no pathological-delimiter test was added is accurate — but deferring it to task 04 is wrong per ADR-11 (F1): the guarantee is a core-function contract, and task 04 tests the CLI, not `detect_delimiter`.
- **Not assessed:** CLI/e2e behavior, R1/R9 exit codes, `error`-substring naming, AC12 constraint checks (task 04's file); repo-root pytest collection (pre-existing condition per ADR-10 §5).

## Boundary check

In bounds. The diff touches `apps/csvpeek/test_core.py` (the sole declared `file_contact_surface` entry) plus `runs/csvpeek/tasks/03-unit-tests.yaml` status/notes — the notes edit is the task contract's own reporting mechanism (same handling as review-01's boundary check). No other files changed; sibling commit `13ba1a5` (task 02) is out of scope and was not reviewed. Working-tree `test_core.py` verified byte-identical to the reviewed commit blob (`a817e25`).
