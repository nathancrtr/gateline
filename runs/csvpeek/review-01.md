# Review Report: 01-core-logic

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** commit `fdf6100` (branch `run/csvpeek`)

## Findings

### F1 — blocking (plan defect, not implementer error) — `parse_csv` raises `ValueError` when Sniffer returns `'"'` as the delimiter
- **Where:** `apps/csvpeek/csvpeek.py:39` (mechanism pinned by plan.md ADR-4 / interface contract)
- **Failure scenario:** `parse_csv('"')` (a readable file whose content is a single `"`; also `'"""'`) — `csv.Sniffer().sniff()` returns delimiter `'"'`, and on the run's recorded interpreter (Python 3.14.6) `csv.reader(..., delimiter='"')` raises `ValueError: bad delimiter or quotechar value` because delimiter == quotechar. Reproduced. After task 02 this becomes a traceback + non-zero exit on a valid readable file, since ADR-7's `main()` catches only `(OSError, UnicodeDecodeError)`.
- **Requirement:** Contradicts plan.md ADR-7 consequence ("Core functions stay exception-free") and `main()`'s "never raises for anticipated errors"; violates the spec's Sniffer-fallback assumption in spirit (degrade to comma rather than block) and the apps convention "never a traceback" (spec Context). The implementer followed ADR-4's pinned recipe exactly and could not fix this without deviating from the binding interface contract → plan amendment needed (e.g., `detect_delimiter` treats a sniffed delimiter that `csv.reader` rejects — `'"'` — as the fallback-to-`','` case, or `parse_csv` catches `ValueError` and re-parses with `','`). Escalating rather than papering over per role rules; no other change to the diff is requested.

## Coverage

Checked and found clean (everything executed, not just read; Python 3.14.6, pytest 9.1.1 — matching the task-notes evidence for acceptance test 16):

- **Acceptance tests:** all 14 executable `python3 -c` tests (task file lines 61–74) run verbatim from `apps/csvpeek/` — all pass. Test 15 verified by AST scan (imports = `csv`, `io`, `collections.Counter`, all in `sys.stdlib_module_names`; no `def main`, no `__main__` guard, import writes nothing to stdout/stderr in a subprocess). Test 16 verified: notes record Python 3.14.6, matching the interpreter I observed.
- **Report format (ADR-8, plan "Report format"):** byte-exact check of a 3-column report — blank line before each `Column:` block, `  Type:`/`  Missing:`/`  Common:` lines, `  Common: (none)` for an all-blank column, `Rows: 0\nColumns: 0\n` and nothing else for empty input, every line `\n`-terminated, no trailing blank line; header-only file produces per-column blocks with `Type: string` / `Common: (none)` (AC10.2) ✓.
- **Interface contract:** all eight names present with pinned signatures and semantics; `TOP_N = 5`; `top_values` uses explicit `sorted(key=lambda p: (-p[1], p[0]))`, not `most_common()` (ADR-6) — tie-break verified including `'10'` before `'2'` and lexicographic selection among equal counts under truncation ✓.
- **ADR-4:** `io.StringIO(text, newline="")`, first record = header, ragged rows kept as-is in `parse_csv`, padding/extra-field-ignore isolated in `column_values` (verified with a 2-field and a 4-field row against a 3-column header); quoted embedded newline counts as one record ✓. Sniffer fallback to `','` on undeterminable input (`''`, single column, `'\n'`) ✓ — except the F1 case above.
- **ADR-5:** `int()`/`float()` parseability incl. documented consequences (`' 3 '`, `'+3'`, `'1_000'` → integer; `'1e3'`, `'nan'`, `'inf'` → float); blanks never influence type; empty/all-blank column → `string` ✓.
- **Constraints (R12, ADR-3):** stdlib-only imports ✓; 3.9-safe spellings — no PEP 604 unions, PEP 585 subscriptions only ✓; no I/O, no `sys`/`argparse`, no import-time side effects ✓; `py_compile` clean ✓.
- **Not assessed:** CLI behavior, exit codes, R1/R9/R11 (tasks 02–04); performance (out of scope per spec).

## Boundary check

In bounds. Diff touches `apps/csvpeek/csvpeek.py` (the sole declared `file_contact_surface` entry) plus `runs/csvpeek/tasks/01-core-logic.yaml` status/notes — the notes edit is mandated by the task's own scope (record the Python version per ADR-2/ADR-3) and acceptance test 16; no other files changed. Working-tree file verified byte-identical to the reviewed commit blob (`6758b29`).
