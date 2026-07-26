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

---

# Round 2

**Verdict:** escalate
**Round:** 2 of 3
**Diff reviewed:** commit 6e9c43d (`csvpeek: task 02-cli-shell round 2`), assessed against branch `run/csvpeek` at HEAD a642482 (worktree clean)

## Prior-finding disposition

### F1 (round 1, major — argparse default `-h/--help`) — **resolved in the reviewed diff; REVERTED at branch tip by a later out-of-scope commit**
- The diff itself is the correct one-line fix (`add_help=False`, csvpeek.py:141), matching the suggested remedy. Runtime evidence against the 6e9c43d blob:
  ```
  $ python3 csvpeek.py --help        # exit=2, stdout_bytes=0
  $ python3 csvpeek.py -h            # exit=2, stdout_bytes=0
  $ python3 csvpeek.py --frobnicate  # exit=2, stdout_bytes=0
  stderr (all three): usage: csvpeek.py file
                      csvpeek.py: error: the following arguments are required: file
  $ python3 csvpeek.py five.csv --help   # exit=2, stdout_bytes=0
  stderr: csvpeek.py: error: unrecognized arguments: --help
  ```
- **But commit cbc6307** (`csvpeek: review task 03-unit-tests round 1` — a *reviewer* commit) reverted `apps/csvpeek/csvpeek.py` 67cba95→245f386 (removing `add_help=False`) and reverted `runs/csvpeek/tasks/02-cli-shell.yaml` to `status: pending` / `notes: ""`, destroying the implementer's disposition notes. At HEAD:
  ```
  $ python3 csvpeek.py --help   # exit=0, stdout_bytes=114, help text on stdout
  $ grep -c add_help csvpeek.py # 0
  ```
  So the CLI-contract violation is live again in the product the run would ship.

## Findings

### F1 — blocking — the round-2 fix was clobbered post-merge by reviewer commit cbc6307; branch tip again ships default `-h/--help`
- **Where:** `apps/csvpeek/csvpeek.py:141` at HEAD a642482 (blob 245f386, byte-identical to round 1); clobbering commit cbc6307.
- **Failure scenario:** `python3 csvpeek.py --help` at HEAD → exit 0 with help text on stdout (verified above), violating the plan's CLI contract (FILE only, no flags; stdout exclusivity) exactly as in round 1.
- **Requirement:** plan.md "CLI contract"; spec Out of scope. **Not an implementer defect and not a plan/spec defect** — a pipeline-process breach: a reviewer commit modified product code (role spec: reviewers never modify code) and a task file it did not own, consistent with a stale-worktree overwrite. Remedy is orchestrator action, not another implementer round: restore the 6e9c43d state of both files (e.g. `git checkout 6e9c43d -- apps/csvpeek/csvpeek.py runs/csvpeek/tasks/02-cli-shell.yaml`) and fix the dispatch process so parallel-task commits cannot revert each other (third clobber-class incident this run, cf. review-01 round 2 and review-03 F1's context).

## Coverage
All checks run against the 6e9c43d blob (the diff under review), executed, not inferred; fixtures ad hoc under /tmp:
- **F1 re-verification:** `--help`, `-h`, unknown flag, and flag-after-FILE all take argparse's error path — exit 2, zero bytes on stdout, usage+error on stderr (output pasted above). The mutant is dead *in the diff*.
- **AC1.1** exit 0 on a readable CSV ✓; **AC1.2** no args → exit 2, usage on stderr, empty stdout ✓.
- **AC2.1** 5-data-row file → `Rows: 5` ✓; **AC3.1/AC4.2** `Column: name/age/city` blocks in header order ✓; **AC4.1** semicolon file → `Columns: 3` + three blocks ✓.
- **AC8.1** 3-col header with a 2-field row → exit 0, `Rows: 1`, empty stderr ✓.
- **AC9.1** nonexistent path → exit 1, exactly 1 stderr line, empty stdout, no traceback ✓; **AC9.2** directory path → exit 1, 1 stderr line (`[Errno 21] Is a directory`) ✓.
- **AC10.1** 0-byte file → exit 0, stdout exactly `'Rows: 0\nColumns: 0\n'` (repr-verified) ✓; **AC10.2** header-only → exit 0, three `Type: string` / `Common: (none)` blocks ✓.
- **AC12.1/AC12.2** still one non-test source file; the spec's AST one-liner lists argparse/csv/io/sys/Counter/Optional — all stdlib origins, unchanged since round 1 ✓.
- **Round-2 delta scope:** `git diff 13ba1a5..6e9c43d` net product change is the single `add_help=False` token; no core function touched; ADR-3 spellings, ADR-7 open/except, ADR-8 `sys.stdout.write`, ADR-11 probe all unchanged ✓. State.yaml/review-02.md changes in the range are orchestrator/reviewer commits, not part of this diff.
- Not assessed: pytest suites (tasks 03/04 own them); permission-denied variant of R9 (same OSError handler path as AC9.1/AC9.2).

## Boundary check
The reviewed diff (6e9c43d) touches `apps/csvpeek/csvpeek.py` (the sole `file_contact_surface` entry) plus its own task file's `status`/`notes` — standard implementer bookkeeping, clean. The boundary violation this round belongs to **cbc6307**, which wrote into `apps/csvpeek/csvpeek.py` and `runs/csvpeek/tasks/02-cli-shell.yaml` from the 03-unit-tests review context; flagged in F1 above.
