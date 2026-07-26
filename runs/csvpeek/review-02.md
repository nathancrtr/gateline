# Review Report: 02-cli-shell

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 13ba1a5 (`csvpeek: task 02-cli-shell round 1`)

## Findings

### F1 — major — argparse default `-h/--help` flags exist, violating the "no flags of any kind" CLI contract
- **Where:** `apps/csvpeek/csvpeek.py:141` (`argparse.ArgumentParser(prog="csvpeek.py")` without `add_help=False`)
- **Failure scenario:** `python3 csvpeek.py --help` → exit 0 with help text on stdout, where the plan's CLI contract requires FILE to be the only accepted argument ("no flags of any kind") and "Nothing else is ever written to stdout"; contract-conformant behavior is argparse error → exit 2. Task scope repeats it: "no other arguments or flags of any kind" (02-cli-shell.yaml:20-21). A task-04 test written from the contract (unknown-flag → exit 2) fails against this diff.
- **Requirement:** plan.md "CLI contract" (FILE only, no flags; stdout exclusivity); spec Out of scope ("CLI flags of any kind"); precedent: `apps/dupefind/dupefind.py:105` resolved the identical contract language with `add_help=False`. Fix: pass `add_help=False`.

## Coverage
Checked and found clean, against spec.md / plan.md directly:
- **R1 (AC1.1, AC1.2):** required positional `file`, `prog="csvpeek.py"`; missing arg takes argparse's own stderr usage + exit 2 path (csvpeek.py:141-143); success path returns 0.
- **R9 (AC9.1, AC9.2):** single try/except `(OSError, UnicodeDecodeError)` wrapping both `open` and `f.read()` (csvpeek.py:145-150) — covers FileNotFoundError, IsADirectoryError (whether raised at open or at read), PermissionError, bad UTF-8; exactly one stderr line of the pinned form `csvpeek.py: error: <reason>`; return 1; no traceback. Multi-line stderr via a filename containing `\n` was considered and dismissed: OSError formats the filename with `%r`, so the newline stays escaped on one line.
- **R10 (AC10.1, AC10.2):** empty/header-only files flow through the success path; traced `parse_csv("") → ([], []) → format_report` producing exactly `Rows: 0\nColumns: 0\n`; header-only yields blocks with `Type: string` / `Common: (none)` and exit 0.
- **R12 (AC12.1, AC12.2):** no new files; added imports (`argparse`, `sys`, `typing`) are stdlib-only.
- **Plan interface contract:** `main` signature is the pinned 3.9-safe spelling (`Optional[Sequence[str]]` from `typing`, ADR-3); `argv=None → sys.argv[1:]`; output via `sys.stdout.write(format_report(...))`, not `print` (ADR-8); `open(..., encoding="utf-8", newline="")` per ADR-7; guard is exactly `if __name__ == "__main__": raise SystemExit(main())`.
- **Task-01 code untouched:** the diff only adds import lines and appends `main()` + guard; no core function signature or body changed (ADR-11's `detect_delimiter` probe predates this commit and is unchanged).
- Not assessed: runtime execution of acceptance tests (static review per role; task 04 executes them) and concurrency (none in scope).

## Boundary check
Clean. The diff touches only `apps/csvpeek/csvpeek.py`, the task's sole `file_contact_surface` entry. Sibling commit f629da3 (03-unit-tests) was excluded from review scope as directed.
