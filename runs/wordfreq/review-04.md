# Review Report: 04-cli-tests

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit c8917bc (branch run/wordfreq)

## Findings

### F1 — blocking — `_is_stdlib_module` classifies third-party modules in the interpreter's own `site-packages` as stdlib, so the AC10.2 test cannot detect a class of R10 violations present on this machine
- **Where:** `apps/wordfreq/test_cli.py:141-162` (`_is_stdlib_module`, specifically
  the `is_relative_to(stdlib_dir)` check at :158-161)
- **Failure scenario:** On this environment,
  `sysconfig.get_paths()["stdlib"]` is
  `/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9`,
  and the interpreter's prefix `site-packages` is a *subdirectory* of that path
  (`.../lib/python3.9/site-packages/`). Verified: `pip` and `setuptools` both
  resolve there right now. Mutation: add `import setuptools` (a third-party
  package, absent from 3.10+'s `sys.stdlib_module_names`) to the top of
  `wordfreq.py`. `test_ac10_2_only_stdlib_imports` still passes —
  `setuptools` is not builtin, `find_spec` returns an origin of
  `.../python3.9/site-packages/setuptools/__init__.py`, and
  `Path(origin).resolve().is_relative_to(stdlib_dir)` is True. The test
  claims AC10.2 coverage ("no third-party package imports", spec R10) but
  does not pin it for any package installed in the prefix site-packages —
  the same discriminating-power defect class as review-03 F1/F2. The
  specified mechanism (`sys.stdlib_module_names`) would have caught this
  mutant; the substitute is therefore strictly weaker, not equivalent.
  (User-site installs like this machine's `pytest` at
  `~/Library/Python/3.9/...` *are* caught — the hole is specifically
  paths nested under the stdlib directory.)
- **Fix (one line):** treat any origin with a `site-packages` (or, for
  portability, `dist-packages`) path component as non-stdlib before the
  stdlib-dir check, e.g.
  `if "site-packages" in Path(spec.origin).parts: return False`. Excluding
  `sysconfig` `purelib`/`platlib` alone is NOT sufficient here — on this
  machine `purelib` is `/Library/Python/3.9/site-packages`, a *different*
  directory from the framework's own site-packages where pip/setuptools
  live.
- **Requirement:** spec R10/AC10.2; task scope bullet AC10.2.

### F2 — minor — Statically-parsed relative imports (`from . import x`) escape the AC10.2 root collection — PLAUSIBLE only
- **Where:** `apps/wordfreq/test_cli.py:177-180` (`node.module is not None`
  skips `ImportFrom` nodes with `level >= 1`)
- **Failure scenario:** PLAUSIBLE — I could not construct a real R10
  violation through this gap. A relative import in a top-level single-file
  script cannot resolve to a third-party package (there is no parent
  package to be relative to), so while such a node is silently unchecked,
  it cannot smuggle in non-stdlib code. Note for completeness; no action
  strictly required. If fixed alongside F1, asserting `node.level == 0`
  for all `ImportFrom` nodes closes it.
- **Requirement:** spec R10/AC10.2 (edge of the collection rule only).

## Deviation assessment (dispatch item 2) and recommendation for G2

The implementer's deviation from the task text (`sys.stdlib_module_names` →
`_is_stdlib_module`) is **necessary and correctly diagnosed** — the attribute
is 3.10+ and this environment is pinned at 3.9.6 (plan ADR-8; independently
confirmed by review-03's coverage note). The *approach* (builtin names +
spec-origin classification) is the right 3.9 equivalent in principle, but the
implementation as shipped is **not genuinely equivalent** for AC10.2's
purpose, per F1: it admits third-party modules nested under the stdlib
directory, which `sys.stdlib_module_names` (a fixed frozenset of stdlib
names) would exclude. With the F1 fix applied, equivalence for AC10.2's
purpose holds for every import class reachable in this environment (builtin,
frozen, stdlib file, lib-dynload extension, prefix site-packages, user site,
local module).

**Recommendation to G2 / Architect:** this is the second independent
surfacing of the 3.9-only environment breaking plan/task text (first:
review-02 F1 → ADR-8). Fold it in as an ADR-8 sibling (or ADR-8 addendum):
"AC10.2's verification mechanism on 3.9 is builtin_module_names +
spec-origin classification with an explicit site-packages exclusion; the
spec's AC10.2 wording ('modules present in the Python 3 standard library')
is the requirement, `sys.stdlib_module_names` was only ever the task-text
mechanism." The spec itself is not defective — its AC10.2 command only
lists the imports; only the task's suggested assertion mechanism was
3.10-specific. Hence request-changes (test defect, fixable in-task) rather
than escalate, matching the review-02 → ADR-8 precedent.

## Coverage

Reviewed against spec.md and plan.md directly; implementer notes used as
context only. Static trace of every assertion against the merged
`wordfreq.py`, plus mutation reasoning per AC (the review-03 standard). One
read-only environment diagnostic was run to substantiate F1 (a `python3 -c`
inspection of `sysconfig` paths and `find_spec` origins for pip/setuptools/
pytest — no code from the diff executed); everything else is git + reading.

- **AC1.1 / AC1.2 (R1)** ✓ clean — exit 0 on a real file; no-arg run pinned
  to nonzero exit + non-empty stderr (test_cli.py:26-38). Spec demands only
  "non-zero", so not asserting argparse's specific exit 2 is correct scoping.
- **AC4.1 (R4)** ✓ clean — 15 distinct words, no flag, exactly 10 stdout
  lines; kills wrong-default mutants (n=9 or n=11 both fail the length
  assertion). Ordering is deliberately not pinned here (all counts equal 1);
  that property is pinned by AC4.2/AC5.1.
- **AC4.2 (R4)** ✓ clean — input `a a a b b c c d` with `-n 3`, **full
  byte-exact stdout** `b"a\t3\nb\t2\nc\t2\n"` (test_cli.py:59). Kills:
  count-ascending sort (`d\t1` first), missing truncation (4 lines),
  print-with-extra-newline, header-row mutants. The b/c tie coincides with
  insertion order here, but the alphabetical-vs-insertion discrimination is
  AC5.1's job and is done there.
- **AC4.3 (R4)** ✓ clean — `-n 100` vs 5 distinct: exit 0 + exactly 5
  lines; kills padding and range-error mutants.
- **AC5.1 (R5)** ✓ clean — `zebra apple zebra apple`, insertion order
  contradicts required alphabetical order, byte-exact expected stdout
  `b"apple\t2\nzebra\t2\n"` kills the `Counter.most_common()` mutant ADR-4
  warns about; identical command run twice, stdout compared byte-for-byte
  (test_cli.py:74-82) — cross-process determinism genuinely exercised.
- **AC6.1 (R6)** ✓ clean — `result.stdout == b"cat\t2\ndog\t1\n"` pins tab
  separator, per-line trailing `\n`, no header, no CRLF, nothing else on
  stdout (test_cli.py:92).
- **AC7.1 / AC7.2 (R7)** ✓ clean — nonexistent path under tmp_path (no cwd
  dependence) and tmp_path-as-directory; both pin nonzero exit, non-empty
  stderr, and `b"Traceback" not in stderr` — an unhandled-exception mutant
  exits 1 (nonzero) but is killed by the Traceback assertion.
- **AC8.1 / AC8.2 (R8)** ✓ clean — genuine 0-byte file and
  punctuation-only file; exit 0 and `stdout == b""` exactly (a lone-newline
  mutant fails).
- **AC10.1 (R10)** ✓ clean — glob + exclusion rule exactly as the task
  specifies; a second source file fails `len == 1`. It does not additionally
  pin the survivor's name as `wordfreq.py`, but every other test dereferences
  `SCRIPT` and fails loudly if that file is absent — no gap in combination.
- **AC10.2 (R10)** ✗ — see F1 (and F2, minor). The rest of the test is
  clean: root extraction handles dotted names via `split(".")[0]` for both
  Import and ImportFrom, and `assert roots` guards against a vacuously-empty
  loop (a nice touch — an ast-parse-of-the-wrong-file mutant is caught).
- **Test-layout contract (plan)** ✓ — script located via
  `Path(__file__).parent / "wordfreq.py"`, invoked as
  `[sys.executable, str(SCRIPT), *args]` with `capture_output=True`; all
  file inputs via `tmp_path`, written with `encoding="utf-8"`; no import of
  `wordfreq`, no duplication of task 03's function-level tests.
- **Python 3.9 compatibility of the test file** ✓ (review-03 asked this
  review to confirm) — no PEP 604 unions anywhere; `Path.is_relative_to`
  is 3.9.0+; no 3.10+ constructs. The `except ValueError` around
  `is_relative_to` is dead-but-harmless defensiveness (it returns bool,
  never raises ValueError, on 3.9).
- **Constraints** ✓ — stdlib-only imports in the test file (ast,
  importlib.util, subprocess, sys, sysconfig, pathlib; pytest used only via
  fixtures/runner, never imported); no conftest.py, no `__init__.py`, no
  edits to `wordfreq.py` or `test_core.py`.
- **Not assessed:** actual pytest execution (dispatch restricts execution;
  implementer reports 26 passed across both files, corroborated by static
  trace — note the reported pass includes the F1-defective test passing
  against *correct* code, which is expected: F1 is a discrimination gap,
  not a false failure); concurrency/performance (out of scope).

## Boundary check

Declared `file_contact_surface`: `apps/wordfreq/test_cli.py` — the only code
file touched (new file, 188 lines). The diff also updates
`runs/wordfreq/tasks/04-cli-tests.yaml` (status → `in-review`, implementer
report + deviation appended to `notes:`) — the same pipeline-bookkeeping
pattern accepted in reviews 01-03; the `notes:` section is where the scope
directs deviations to be recorded. In bounds.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 76892a6 (branch run/wordfreq)

Correctness standard for the stdlib check this round is **ADR-9**
(plan.md, amended commit 7801086), which supersedes the stale task-text
mechanism (`sys.stdlib_module_names`) — per ADR-9's own consequences
clause, the fixed helper is reviewed against the ADR, not the task text.

## Findings

None. Both round-1 findings are genuinely resolved; no new defects
introduced.

### F1 (blocking) — RESOLVED
- **Where fixed:** `apps/wordfreq/test_cli.py:178-181` (in
  `_is_stdlib_module`): the resolved origin is rejected if
  `"site-packages" in origin.parts or "dist-packages" in origin.parts`,
  *before* the stdlib-dir containment check at :182-186.
- **Verified against ADR-9, clause by clause:** (1) builtin names check at
  :169 ✓; (2) `"built-in"`/`"frozen"` origin check at :176 ✓; (3)
  containment under `sysconfig.get_paths()["stdlib"]` gated by the
  site-packages/dist-packages component rejection on the **resolved** path
  (`Path(spec.origin).resolve().parts`), rejection ordered before
  acceptance ✓ — this is the exact mechanism ADR-9 sanctions, including
  the two properties ADR-9's rejected-alternatives list forbids (no bare
  containment (c), no purelib/platlib-only exclusion (d)).
- **Static re-trace of the round-1 failure scenario:** mutant
  `import setuptools` → root `"setuptools"` → not builtin → spec origin
  `.../lib/python3.9/site-packages/setuptools/__init__.py` (environment
  fact established by round 1's diagnostic) → resolved parts contain
  `site-packages` → `return False` → test fails with
  `"setuptools is not a standard-library module"`. The mutant that
  survived round 1 is now killed. Corroborated by the implementer's
  round-2 evidence in the task notes (mutant run: 1 failed; restored
  file: 26 passed), which matches the static trace exactly.
- **No over-rejection:** `wordfreq.py`'s actual roots (argparse, re, sys,
  collections, typing) — `sys` accepted at clause 1; the rest resolve to
  files under the stdlib dir with no site-packages component → accepted.
  A stdlib module cannot legitimately carry a `site-packages` path
  component (the stdlib does not live inside site-packages on any layout
  in scope), so the rejection cannot misfire on clause-3 acceptances.

### F2 (minor, PLAUSIBLE) — RESOLVED
- **Where fixed:** `apps/wordfreq/test_cli.py:198-203`:
  `assert node.level == 0, "relative imports are not permitted"` for
  every `ImportFrom` node, before root collection. A mutant introducing
  `from . import x` (module=None, level=1 — previously silently skipped)
  or `from .foo import x` now fails loudly. Placement before the
  `node.module is not None` guard is correct — it fires for both forms.

## Coverage (round 2)

Delta review: `git diff c8917bc 76892a6` traced hunk-by-hunk; ADR-9 read
in full against the fixed helper; no execution this round per dispatch
(implementer's execution evidence in the task notes is consistent with
the static trace and includes the discriminating mutant kill this review
demanded in round 1).

- The code delta to `test_cli.py` is exactly three things: the expanded
  `_is_stdlib_module` docstring (accurate, matches ADR-9's context), the
  3-line origin refactor + site-packages/dist-packages rejection (F1),
  and the `node.level == 0` assertion + comment (F2). **No other test,
  helper, or assertion was touched** — all round-1 clean verdicts
  (AC1.x, AC4.x, AC5.1, AC6.1, AC7.x, AC8.x, AC10.1, test-layout
  contract, constraints) carry over unchanged.
- **Python 3.9 compatibility of the new lines** ✓ — `Path.parts`,
  `Path.resolve()`, `is_relative_to` (3.9.0+), plain `assert`; no 3.10+
  constructs.
- **Equivalence scrutiny per the plan's risk note** ✓ — with the F1 fix,
  the helper matches `sys.stdlib_module_names`' verdict for every import
  class reachable in this environment (builtin, frozen, stdlib file,
  lib-dynload, prefix site-packages nested under stdlib dir, user site,
  local module); no reachable class remains where the substitute is
  weaker.
- **Not assessed:** pytest execution (dispatch restriction, as round 1);
  the ADR-9 plan amendment itself (Architect-owned, separate commit
  7801086, not part of this diff — noted as consistent with round 1's
  recommendation to G2).

## Boundary check (round 2)

Commit 76892a6 touches exactly two files: `apps/wordfreq/test_cli.py`
(the declared `file_contact_surface`) and
`runs/wordfreq/tasks/04-cli-tests.yaml` (`notes:` round-2 report — the
accepted bookkeeping pattern). `wordfreq.py` and `test_core.py`
untouched. The plan amendment lives in a separate commit by the
Architect; the implementer correctly did not touch `plan.md`. In bounds.
