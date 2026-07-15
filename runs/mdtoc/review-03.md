# Review Report: 03-cli-tests

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit fa5c3e4 (branch run/mdtoc)

## Findings

### F1 — minor — error-path stdout is unasserted, so a mutant writing to stdout before failing survives
- **Where:** `apps/mdtoc/test_cli.py:81-108` (AC7.1–AC7.3 tests)
- **Failure scenario:** a wrong `main()` that writes partial output to stdout
  before returning 1 on a missing/dir/bad-UTF-8 path passes all three AC7
  tests (they assert returncode, stderr non-empty, no `Traceback` — exactly
  and only the task's pinned assertions). Plan's CLI contract ("nothing else
  is ever written to stdout") is pinned by no AC on the error path; the gap
  traces to the task scope's assertion list, not implementer deviation, hence
  minor. One-line strengthening (`assert result.stdout == b""` in AC7 tests)
  available at the implementer's option or the Verifier's discretion.
- **Requirement:** plan.md CLI contract (stdout exclusivity); no spec AC.

## Coverage

Reviewed against spec.md (R1, R7, R8, R10; R6 via AC6.1) and plan.md (CLI
contract, test-layout contract, ADR-8) directly; the commit message was
context only. Static reasoning per dispatch — git only, no test execution, so
AC9.1 (pytest exits 0) is taken from the Verifier's lane, not confirmed here.

- **Process-boundary honesty** ✓ — `run_cli` (`test_cli.py:16-21`) is a real
  `subprocess.run([sys.executable, str(SCRIPT), ...], capture_output=True)`;
  no `text=True`, so every stdout/stderr assertion is on raw bytes; real
  returncodes; `SCRIPT` located exactly per the test-layout contract
  (`Path(__file__).parent / "mdtoc.py"`, absolute — survives the AC1.3
  `cwd=tmp_path` run). The file never imports `mdtoc` — no function-level
  duplication of task 02.
- **Bullet-for-bullet coverage** ✓ — 12 task bullets, 12 distinct tests named
  by AC number, each making the task's mandated assertions: AC1.1 (rc 0 +
  exact TOC bytes — stronger than "TOC on stdout"), AC1.2 (rc == 2, stderr
  non-empty), AC1.3 (bytes-before/after + directory-entry set with
  `cwd=tmp_path`), AC6.1 (byte-exact four-heading fixture, matches the task's
  literal expected bytes), AC7.1–7.3 (rc != 0, stderr non-empty, no
  `Traceback`; UTF-8 fixture is the task's `b'\x80\x81abc'` written as
  bytes), AC8.1–8.2 (rc 0, `stdout == b""`), AC10.1–10.3.
- **Mutation discrimination (tests-as-product)** ✓ — traced killers for:
  wrong exit codes (AC1.1/1.2/8.x assert exact codes); `print()` newline or
  `\r\n` drift (AC1.1/AC6.1 byte-exact); TOC to stderr or reordered/misdented
  output (AC6.1); unhandled traceback masquerading as failure (`Traceback`
  substring discriminates crash from clean error, R7); in-place edit or file
  creation (AC1.3 bytes + entry-set); a second source file (AC10.1 glob,
  test_/conftest exclusions per task text); a third-party import (AC10.2:
  site-packages origin → rejected; uninstalled module → `ModuleNotFoundError
  ⊂ ImportError` → fails closed; `spec.origin is None` → fails closed); a
  sneaked relative import (`assert node.level == 0`); an emptied import list
  (`assert roots`); a PEP 604 annotation in mdtoc.py (AST BinOp scan). Sole
  survivor is F1 above.
- **ADR-8 mechanism fidelity (AC10.2)** ✓ — `_is_stdlib_module`
  (`test_cli.py:126-171`) implements the sanctioned check verbatim:
  `sys.builtin_module_names`, `find_spec` origin `"built-in"`/`"frozen"`,
  resolved-path containment under `sysconfig.get_paths()["stdlib"]`, with the
  **mandatory site-packages/dist-packages rejection** present (applied before
  containment — logically equivalent to "under stdlib with no site-packages
  component", and per the wordfreq review-04 F1 rationale the rejection is
  what carries the soundness). No `sys.stdlib_module_names`. Root names
  collected from both `Import` and `ImportFrom` via `.split(".")[0]`.
- **ADR-8 mechanism fidelity (AC10.3)** ✓ — (a) `py_compile` via
  `sys.executable` asserted rc 0; (b) annotation collector covers `returns`,
  all six arg slots (posonly/args/kwonly/vararg/kwarg), and
  `AnnAssign.annotation` — the three surfaces the task pins — with a full
  `ast.walk` of each annotation expression for `BinOp`.
- **Test file's own 3.9-safety** ✓ — zero annotations (nothing for PEP 604 to
  bite), no 3.10+ syntax; `Path.is_relative_to` and
  `subprocess.run(capture_output=...)` are 3.9-available; stdlib + pytest
  fixtures only; fixtures written with `encoding="utf-8"` except the
  deliberate bytes case.
- **Not assessed:** execution of the suite (AC9.1) and the Verifier's literal
  `docs/DESIGN.md` + git-diff form of AC1.3 — both explicitly other lanes per
  the task scope and dispatch.

Minor observations, not findings: the AC10.3 docstring implies `py_compile`
catches PEP 604 on 3.9 — it does not (valid 3.9 syntax, evaluation-time
failure); the plan's ADR-8 carries the same framing, and the operative AST
scan is present, so behavior is unaffected. The `except ValueError` guard
around `is_relative_to` (`test_cli.py:168-171`) is dead code —
`is_relative_to` returns bool, never raises — harmless. The AC10.3
`py_compile` run drops a `__pycache__/` beside `mdtoc.py`; it is outside the
AC10.1 glob (`*.py`, non-recursive) and outside AC1.3's `tmp_path`, so no
test perturbs another.

## Boundary check

Declared `file_contact_surface`: `apps/mdtoc/test_cli.py` — the only code
file touched (new file); `mdtoc.py` and `test_core.py` untouched. The diff
also edits `runs/mdtoc/state.yaml` (ledger entry appended, derived
`cost_spent_usd` 5.71 → 5.93 arithmetic checks out, task 03 status
`dispatched` → `in-review`); orchestrator bookkeeping, gates section
untouched — consistent with the mdtoc review-01 / wordfreq precedent. In
bounds.
