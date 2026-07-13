# Review Report: 03-cli-tests

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit cdfeb23 (branch run/dupefind)

## Findings

### F1 — blocking — AC2.2's directory-symlink half is unpinned: a `followlinks=True` mutant passes the whole suite
- **Where:** `apps/dupefind/test_cli.py:102-136` (only `link_to_a.txt` and `a_fifo` asserted absent)
- **Failure scenario:** mutant `scan_files` walks with `os.walk(root, followlinks=True)`. On this fixture the cycle self-terminates (each `cycle_back` component counts toward the kernel's per-lookup symlink limit; after ~32 levels `opendir` fails ELOOP and `os.walk`'s default `onerror=None` swallows it), so the process exits 0 well inside the timeout, stdout holding one huge group of `<root>/sub/cycle_back/...` paths reached *through* the directory symlink. Every assertion still passes: rc 0 ✓, `expected_a`/`expected_b` present ✓, `<root>/link_to_a.txt` and `<root>/a_fifo` are not substrings of any cycle path ✓ — yet AC2.2 ("the symlink's path never appears in any reported group", file **or directory**) is violated at the process boundary this task claims to pin (task bullet 4; plan mapping R2 → 03). Kill: assert exact stdout bytes for this fixture (single group: `real_b.txt` then `sub/real_a.txt`, per the render formula), or at minimum `assert b"cycle_back" not in result.stdout`.
- **Requirement:** spec AC2.2; tasks/03-cli-tests.yaml bullet 4; plan requirement→task mapping (R2).

### F2 — blocking — byte-empty-stdout contract unpinned on both root-error paths (AC7.1/AC7.2)
- **Where:** `apps/dupefind/test_cli.py:237-255` (no `result.stdout == b""` in either test)
- **Failure scenario:** mutant `main()` writes any diagnostic to stdout on the root-validation failure path (e.g. echoes the error to stdout as well as stderr) before returning 1 — a direct violation of the plan CLI contract's "Nothing else is ever written to stdout" — and both AC7 tests pass (rc != 0 ✓, stderr non-empty ✓, no `Traceback` ✓); no other test exercises these paths. The suite pins stdout == b"" on all five argparse-rejection tests (lines 53, 66, 76, 86, 96) but on neither error path, and the commit message's "byte-empty stdout on all error paths" claim is untrue for exactly these two. Kill: `assert result.stdout == b""` in both tests.
- **Requirement:** plan CLI contract (stdout exclusivity); dispatch adversarial focus (byte-empty stdout on every rejection **and error** path). The task bullet omits the assertion too, but the suite's own preamble scope ("stdout bytes") and its consistency elsewhere make this an implementer-fixable gap, not a plan defect.

### F3 — minor — root-error pins are weaker than the plan's CLI contract: exit code 1 and message shape unasserted
- **Where:** `apps/dupefind/test_cli.py:242,253` (`returncode != 0` only)
- **Failure scenario:** mutant returns 2 (or emits an argparse-style message) for a nonexistent/non-directory root; plan pins root errors to exit **1** with `dupefind.py: error: no such directory|not a directory: <root>` — distinct from argparse's 2 — and both tests pass. Minor, not blocking: the omission traces to the task bullet's own text ("returncode != 0", mirroring spec AC7.1's "non-zero"), so the implementer transcribed the contract as cut; tightening (`rc == 1`, message-prefix assertion) is one line each and G2 may direct it alongside F2's fix.
- **Requirement:** plan CLI contract exit-code table vs. tasks/03-cli-tests.yaml AC7 bullets.

### F4 — minor — commit touches `runs/dupefind/state.yaml`, outside the task's declared file_contact_surface
- **Where:** `runs/dupefind/state.yaml` (ledger entry 9, spent total, task 03 status dispatched→in-review)
- **Failure scenario:** none — orchestrator dispatch metering per the operating mode, identical in kind to review-01 F4 (dismissed with attribution at that round); gates untouched. Recorded because out-of-surface changes are automatic findings.
- **Requirement:** tasks/03-cli-tests.yaml `file_contact_surface` (apps/dupefind/test_cli.py only).

## Coverage

Checked against spec.md (R1, R2 process-level, R4–R7, R9; R3/R8-unit are task 02's) and plan.md (CLI contract, test-layout contract, ADR-6, ADR-8); static review only — per dispatch I executed nothing but git, so AC8.1 ("pytest exits 0") rests on the implementer's claim pending the Verifier. `test_core.py` not reviewed here (sibling task).

- **Process-boundary honesty (dispatch focus)** — every functional assertion runs the real script via `subprocess.run([sys.executable, str(SCRIPT)], capture_output=True)` with no `text=`/`encoding=`, so comparisons are raw bytes against real exit codes ✓; script located per test-layout contract (`pathlib.Path(__file__).parent / "dupefind.py"`, line 24) ✓; no in-process `main()` calls anywhere ✓.
- **Timeout contract** — `timeout=30` on every subprocess invocation: `run_cli` default (line 31) covers all 15 CLI calls; the AC9.3 py_compile call carries its own (line 325) ✓ — a FIFO regression fails via `TimeoutExpired` instead of hanging (AC2.3, plan risk) ✓.
- **Path construction** — all fixture expectations built with `os.path.join` from the exact root string; no `.resolve()`/`realpath()` on fixture paths (the `realpath` at 290–291 is ADR-8's own "resolved path" step in the stdlib check, sanctioned) ✓ — macOS `/tmp` symlink hazard avoided.
- **Task bullets** — all 14 required bullets present as distinct tests (17 total); the three extra no-flags variants (`--help`, `-h` with and without root) pin review-01 F1's `add_help=False` fix at the process boundary ✓.
- **Rejection paths / G0 veto** — AC1.2 and all four flag tests assert exact rc == 2 (stronger than the bullet's != 0, matching the plan's exit-code table), non-empty stderr, and byte-empty stdout ✓ — a mutant that accepts `--include-empty` (rc 0) or restores auto-help (`--help` → stdout usage, rc 0) fails ✓. The no-flags contract is pinned four ways as claimed.
- **AC5.1 exact-byte pin** — verified the expected-bytes formula (lines 177–183) constant-folds, for this fixture, to exactly the task's literal sequence (`a.txt`, `b.txt`, blank line, `c/d.txt`, `e.txt`, single trailing newline); the `sorted()` calls operate on fixed known strings, not on tool output, so the test is not tautological. Kills the render/ordering mutant family: `print()` extra newline, trailing blank line, missing final newline, descending group order, descending within-group order, singleton (`f.txt`) inclusion ✓. AC5.3 covered by exact equality plus the explicit `f_path` absence ✓.
- **Byte-empty success paths** — AC4.2, AC6.1, AC6.2 all assert `stdout == b""` exactly ✓.
- **AC5.2** — name contains `reproduc` (plan name contract, feeds AC8.2) ✓; non-empty stdout asserted so the test cannot pass vacuously ✓. Inherent limit noted, not a finding: a same-process double run cannot discriminate readdir-order-dependent determinism — that is AC5.2's own shape; ordering itself is pinned byte-exactly by AC5.1.
- **AC2.2/AC2.3** — file-symlink exclusion, FIFO exclusion, and cycle-completes-within-timeout all pinned ✓; the directory-symlink-path half of AC2.2 is the F1 gap.
- **AC7** — non-zero exit, non-empty stderr, no `Traceback` pinned on both paths ✓; stdout (F2) and exit-code/message strength (F3) are the gaps.
- **AC9.1** — glob beside the test file, `test_`/`conftest.py` exclusions per bullet, plus a name pin on `dupefind.py` ✓.
- **AC9.2** — ADR-8 mechanism present in full: `sys.builtin_module_names`, find_spec origin `"built-in"`/`"frozen"`, stdlib-dir containment on resolved paths, and the **mandatory** site-packages/dist-packages rejection (lines 290–296) ✓; no `sys.stdlib_module_names` anywhere ✓; `node.level == 0` asserted on every ImportFrom and the collected root set asserted non-empty ✓. One deviation, accepted as clean: "component" is implemented as substring containment — strictly conservative (can only false-*fail* on pathological directory names, can never let a real site-packages origin pass), so the wordfreq review-04 F1 unsoundness cannot recur.
- **AC9.3** — both prongs per the bullet: py_compile under `sys.executable` (= 3.9.6, ADR-8) rc 0, and the interpreter-independent AST scan covering arg annotations, `returns` (incl. `AsyncFunctionDef`), and `AnnAssign.annotation`, no `ast.BinOp` in any ✓.
- **Test file self-compliance** — 3.9-safe: no PEP 604, no 3.10+ syntax, `.format()` throughout; imports are stdlib + pytest fixtures only ✓. Statically traced every test against the approved `dupefind.py`: all 17 should pass (no false-failure risk found) ✓.
- **Not assessed:** runtime execution (nothing run); `test_core.py` overlap/duplication (bullet "do not duplicate task 02's tests" — no function-level imports of dupefind exist in this file, so no duplication by construction ✓ at the mechanism level).

## Boundary check

`apps/dupefind/test_cli.py` — inside the declared surface ✓; `dupefind.py` and `test_core.py` untouched by this commit ✓. The same commit modifies `runs/dupefind/state.yaml` (metering); attributed to the orchestrator and recorded as F4, consistent with review-01 F4. No other files touched.
