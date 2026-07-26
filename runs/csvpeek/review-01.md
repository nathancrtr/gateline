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

---

# Round 2

**Verdict:** request-changes
**Round:** 2 of 3
**Diff reviewed:** branch `run/csvpeek` at `765711c`; sole code commit remains `fdf6100` — working tree clean, `apps/csvpeek/csvpeek.py` blob `6758b29`, byte-identical to the round-1 diff. **No round-2 implementer commit exists.**

## Findings

### F1 (carried, round 1) — blocking — unresolved in code: `detect_delimiter` lacks the ADR-11 probe; the fix landed only in the plan
- **Where:** `apps/csvpeek/csvpeek.py:18-27` (missing ADR-11 step 3) and `:39` (still raises); docstring at `:19-21` is the superseded pre-ADR-11 wording, not the amended interface-contract docstring.
- **Failure scenario:** re-ran the round-1 repro on Python 3.14.6 from `apps/csvpeek/` — `parse_csv('"')` and `parse_csv('"""')` still raise `ValueError: bad delimiter or quotechar value` at line 39; `detect_delimiter('"')` returns `'"'`, and ADR-11's own regression-evidence commands (plan.md ADR-11 Consequences) exit 1 with tracebacks, so the new contract guarantee ("returned delimiter is always accepted by csv.reader construction") is violated.
- **Requirement:** plan.md ADR-11 (binding pinned mechanism, steps 1–3 + guarantee) and the amended `detect_delimiter` docstring in "Interface contracts". The plan defect is cured, so this is now an ordinary implementation gap → `request-changes`, not escalate: the next round must apply ADR-11 (validate the sniffed delimiter via `csv.reader([], delimiter=<sniffed>)` in `try/except (TypeError, ValueError)` → fallback `','`) and update the docstring to the amended wording.

## Coverage

Checked this round (all executed on Python 3.14.6, pytest 9.1.1, from `apps/csvpeek/`):

- **F1 resolution:** verified NOT resolved — see finding. Confirmed via `git log --all -- apps/csvpeek/csvpeek.py` (only `fdf6100` touches the file) and `git hash-object` (working tree == `fdf6100` blob), so the "resumed to implement" state entry produced no code change; the fix exists on paper only.
- **Amended plan conformance:** code matches every part of the current plan except ADR-11/the amended `detect_delimiter` docstring (the finding). ADR-10 changes no interface contract; its environment premise is satisfied (interpreter observed = 3.14.6, matching task notes). No other contract changed between the round-1 and current plan (amendment headers confirm; `parse_csv` et al. unchanged).
- **Regression re-check:** all 14 executable acceptance tests (task file lines 61–74) re-run verbatim — all pass. Constraint checks re-verified by AST scan: imports = `csv`, `io`, `collections` (all stdlib), no `def main`, no `__main__` guard, no PEP 604 unions, module imports cleanly. Identical-blob identity makes broader regression impossible; round-1 coverage (report format, ADR-4/5/6 semantics, tie-breaks, ragged handling) therefore stands without re-derivation.
- **New-issue sweep:** no new code to review (empty implementation delta); re-examined `detect_delimiter`'s never-raises claim beyond F1 — `Sniffer.sniff` raises only `csv.Error` on the exercised undeterminable inputs (`''`, `'\n'`, single-token text) ✓. Nothing new found.
- **Not assessed:** CLI behavior, exit codes, R1/R9/R11 (tasks 02–04); performance (out of scope).

## Boundary check

In bounds, trivially: the implementation delta since round 1 is empty. Commits since `fdf6100` touch only `runs/csvpeek/` (plan amendment `b20f25c` — architect artifact — and orchestrator state), none authored by the task-01 implementer, nothing in the task's `file_contact_surface` beyond the already-reviewed round-1 diff.
