# Verification Report: dupefind

<!-- Contract: produced by Verifier; consumed by gate G2.
     Every in-scope acceptance criterion gets a row and evidence.
     Evidence = the command you ran and the output you observed.
     BUDGET: paste FAILING output in full; for passing checks the command plus
     its concluding line/exit code suffices. Never paste entire suites or
     restate the spec — reference criteria by number. -->

**Change verified:** `run/dupefind` @ `f1d51e7` (`apps/dupefind/dupefind.py`,
`apps/dupefind/test_core.py`, `apps/dupefind/test_cli.py`)
**Environment:** local, darwin (Darwin 25.5.0). Two interpreters present:
`/usr/bin/python3` = 3.9.6 (the plan's pinned, sanctioned interpreter, ADR-8) and
`/usr/local/bin/python3` = 3.14.6 (used only for verifier scratch scripting, never
for exercising the tool itself or running its test suite). All AC evidence below
ran under `/usr/bin/python3` 3.9.6 unless noted.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E1 |
| AC2.1 | verified | E2 |
| AC2.2 | verified | E2 |
| AC2.3 | verified | E2 |
| AC3.1 | verified | E3 |
| AC3.2 | verified | E3 |
| AC3.3 | verified | E3 |
| AC4.1 | verified | E4 |
| AC4.2 | verified | E4 |
| AC5.1 | verified | E5 |
| AC5.2 | verified | E5 |
| AC5.3 | verified | E5 |
| AC6.1 | verified | E6 |
| AC6.2 | verified | E6 |
| AC7.1 | verified | E7 |
| AC7.2 | verified | E7 |
| AC8.1 | verified | E8 |
| AC8.2 | verified | E8 |
| AC9.1 | verified | E9 |
| AC9.2 | verified | E9 |
| AC9.3 | verified | E9 |

### E1 — AC1.1 / AC1.2
```
$ mkdir existing-dir && echo x > existing-dir/a.txt
$ /usr/bin/python3 apps/dupefind/dupefind.py existing-dir
AC1.1 exit=0

$ /usr/bin/python3 apps/dupefind/dupefind.py 2>ac1_2.stderr
AC1.2 exit=2
$ cat ac1_2.stderr
usage: dupefind.py root
dupefind.py: error: the following arguments are required: root
```

### E2 — AC2.1 / AC2.2 / AC2.3
Built via subprocess with `timeout=30` (mandatory per plan risk: a FIFO
regression must fail, not hang).
```
AC2.1 (root/a/x.txt, root/b/c/y.txt byte-identical): exit=0
stdout: 'r2/a/x.txt\nr2/b/c/y.txt\n'

AC2.2 (file symlink to a dup target + directory symlink cycle "sub/loop -> root"):
exit=0
stdout: 'r22/other_real.txt\nr22/target.txt\n'
(link_to_target.txt and the cycle symlink appear nowhere in output; run
completed instantly — cycle terminated)

AC2.3 (os.mkfifo'd FIFO alongside one unique real file): exit=0, stdout='',
completed well within the 30s timeout (no hang)
```

### E3 — AC3.1 / AC3.2 / AC3.3
```
$ printf aaaaaaaa > a.txt; printf bbbbbbbb > b.txt; printf aaaaaaaa > c.txt
$ printf xyz > d.txt; printf xyz > e.txt; printf xyz > f.txt
$ /usr/bin/python3 apps/dupefind/dupefind.py r3
/tmp/.../r3/a.txt
/tmp/.../r3/c.txt

/tmp/.../r3/d.txt
/tmp/.../r3/e.txt
/tmp/.../r3/f.txt
exit=0
```
a/c (identical content) grouped (AC3.1); b.txt (same size as a/c, different
content) never appears anywhere in output (AC3.2); d/e/f triplet lands in one
3-member group, not split into pairs (AC3.3).

### E4 — AC4.1 / AC4.2
```
$ touch e1.txt e2.txt e3.txt
$ /usr/bin/python3 apps/dupefind/dupefind.py r4 ; echo exit=$?
AC4.2 exit=0
$ /usr/bin/python3 apps/dupefind/dupefind.py r4 | wc -c
0
$ /usr/bin/python3 apps/dupefind/dupefind.py --include-empty r4
usage: dupefind.py root
dupefind.py: error: unrecognized arguments: --include-empty
exit=2
```
Three 0-byte files never grouped (AC4.1), zero stdout bytes with exit 0
(AC4.2), and no flag exists anywhere to override this — confirmed the CLI
accepts no override mechanism.

### E5 — AC5.1 / AC5.2 / AC5.3
```
$ # a.txt/b.txt dup, c/d.txt/e.txt dup, f.txt unique
$ OUT1=$(/usr/bin/python3 apps/dupefind/dupefind.py r5)
.../r5/a.txt
.../r5/b.txt
<blank line>
.../r5/c/d.txt
.../r5/e.txt
$ OUT2=$(/usr/bin/python3 apps/dupefind/dupefind.py r5)
$ [ "$OUT1" = "$OUT2" ] && echo MATCH
AC5.2 REPRODUCIBLE: MATCH
$ echo "$OUT1" | grep -c f.txt
0
```
Exact group content/order/separators per AC5.1; byte-identical across two
runs (AC5.2); the unique file `f.txt` never appears (AC5.3).

### E6 — AC6.1 / AC6.2
```
$ # r6a has a.txt="alpha", b.txt="bravo" (no duplicate content)
$ /usr/bin/python3 apps/dupefind/dupefind.py r6a ; echo exit=$?, len=$(... | wc -c)
AC6.1 exit=0 stdout_len=0
$ mkdir r6b  # empty directory
$ /usr/bin/python3 apps/dupefind/dupefind.py r6b
AC6.2 exit=0 stdout_len=0
```

### E7 — AC7.1 / AC7.2
```
$ /usr/bin/python3 apps/dupefind/dupefind.py .../does-not-exist-dir
AC7.1 exit=1
dupefind.py: error: no such directory: /tmp/.../does-not-exist-dir

$ printf x > regfile.txt
$ /usr/bin/python3 apps/dupefind/dupefind.py regfile.txt
AC7.2 exit=1
dupefind.py: error: not a directory: /tmp/.../regfile.txt
```
Both are single human-readable stderr lines, no `Traceback`, non-zero exit.

### E8 — AC8.1 / AC8.2
```
$ cd apps/dupefind && /usr/bin/python3 -m pytest -q
................................ [snip 38 dots] ......
38 passed in 1.39s
```
(21 tests in `test_core.py` + 17 in `test_cli.py` = 38, matching the stated
suite size; exit code 0.)

`pytest --collect-only -q` name-substring audit (plan's test-name contract for
AC8.2), grep against the collected list:
- `symlink`: `test_ac2_2_ac2_3_symlinks_and_fifo_excluded_completes_within_timeout`,
  `test_scan_files_excludes_symlink_file_and_directory_cycle`,
  `test_scan_files_through_symlinked_root_does_not_resolve_paths`
- `fifo`: `test_ac2_2_ac2_3_symlinks_and_fifo_excluded_completes_within_timeout`,
  `test_scan_files_excludes_fifo`
- `same_size`: `test_find_duplicate_groups_same_size_different_content_not_grouped`
- `empty`: 9 tests across both files (unit + e2e)
- `order`: `test_find_duplicate_groups_order_independent_of_input_order`
- `no_duplicates`: `test_find_duplicate_groups_no_duplicates_when_content_unique`,
  `test_scan_files_empty_directory_no_duplicates`
- `reproduc`: `test_ac5_2_reproducible_across_two_runs`

All required substrings present with distinct, individually named tests.

### E9 — AC9.1 / AC9.2 / AC9.3
```
$ find apps/dupefind -maxdepth 1 -name "*.py" ! -name "test_*"
apps/dupefind/dupefind.py
```
Exactly one non-test `.py` file (AC9.1).

```
$ /usr/bin/python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(...) ...]" apps/dupefind/dupefind.py
argparse
hashlib
os
stat
sys
Iterable
```
Note: the spec's literal AC9.2 command prints the *first imported alias name*
for `ImportFrom` nodes rather than the module name (`n.names[0].name`, not
`n.module`) — hence `Iterable` (from `from typing import Iterable, Optional,
Sequence`) instead of `typing`. This is a pre-existing quirk in the literal
command text in spec.md itself, not a defect in the implementation; none of
the printed names are third-party. Independently re-derived the correct
module-root set using the plan's ADR-8-sanctioned mechanism (`ast.Import`/
`ast.ImportFrom.module`, `node.level == 0` asserted, stdlib-path check with
`site-packages`/`dist-packages` rejection — the same mechanism
`test_ac9_2_all_imports_are_stdlib` in `test_cli.py` implements and which
passed above in E8):
```
module roots: {'stat', 'argparse', 'hashlib', 'os', 'sys', 'typing'}
```
All six are stdlib; no third-party import anywhere (AC9.2 satisfied under the
sanctioned mechanism, which is what the plan actually binds).

```
$ /usr/bin/python3 -m py_compile apps/dupefind/dupefind.py; echo exit=$?
exit=0
```
`/usr/bin/python3` is confirmed 3.9.6 (`python3 --version` above), so this is
literally the AC9.3-mandated compile under 3.9 (no separate `python3.9`
binary exists on this machine; `/usr/bin/python3` *is* the pinned 3.9.6
interpreter per ADR-8, and py_compile succeeded). The AST `ast.BinOp`-in-
annotation scan (`test_ac9_3_py_compile_succeeds_and_no_binop_in_annotations`)
also passed in E8, confirming no PEP 604 unions in any evaluated annotation.

## Review-01 F2/F3 — TOCTOU races confirmed race-only, not static-tree defects

Independently reproduced both findings by deliberately injecting the
adversarial mutation each describes, and confirmed neither fires on any
static tree (all AC2.x/AC3.x/AC4.x/AC5.x/AC6.x/AC7.x evidence above uses
static, non-mutating trees and all pass).

**F3** (same-size files truncated to 0 between lstat and hash get grouped as
"empty"): called `scan_files()` on a static 2-file tree, then *externally
truncated both files to 0 bytes* before calling `find_duplicate_groups()` on
the already-captured scan result —
```
scanned (pre-mutation): [('.../race_f3/b.txt', 2), ('.../race_f3/a.txt', 2)]
groups after injected truncation race: [['.../race_f3/a.txt', '.../race_f3/b.txt']]
```
confirms the finding fires only under an injected mutation between the two
calls; the same two files, unmutated (as in AC4.1/AC4.2/AC3.x above), never
group.

**F2** (regular file swapped for a FIFO between scan and hash hangs `open()`):
called `scan_files()` on a static 2-file same-size tree, then *externally
unlinked one file and replaced it with a FIFO* (`os.mkfifo`) before calling
`find_duplicate_groups()`, under an 8s subprocess timeout:
```
CONFIRMED HANG: F2 scenario blocks open() on FIFO with no writer, as review-01 predicted
```
confirms the hang requires the injected swap; AC2.3's static-tree FIFO test
(FIFO present from the start, filtered by `S_ISREG` in `scan_files` before
anything opens it) completed instantly with no hang, both in the suite (E8)
and in manual reproduction (E2).

Both findings are exactly what review-01 characterized them as: PLAUSIBLE-
only races reachable solely via adversarial mid-scan mutation, not defects
reachable from any acceptance criterion or any static tree. No AC in the
G0-amended spec covers a mutating tree, and the plan's ADR-3/ADR-6 explicitly
accept this class of race. Not gating.

## Beyond the happy path

Probed scenarios with no dedicated AC, all against the built `dupefind.py`:

- **Trailing slash on root** (`dupefind.py r5/`) — exit 0, correct grouping,
  no double-slash artifact in output paths.
- **Unicode and space-containing filenames** (`héllo world.txt`, `日本語.txt`,
  identical content) — exit 0, both grouped correctly, paths printed intact.
- **Dangling (broken target) symlink** inside the tree, alongside one unique
  real file — exit 0, no error, dangling path absent from output (broken
  symlinks are `S_ISLNK` via `lstat`, filtered like any other symlink).
- **Root argument itself a symlink to a directory** — accepted (`isdir`
  follows links, per the plan's documented "not covered by any AC"
  behavior); output paths are constructed from the symlink root string
  verbatim, not resolved.
- **Hardlinked paths** (two links, one inode, same content) — both paths
  reported in a group, exit 0; matches spec assumption 4 (no inode-aware
  exclusion).
- **Unreadable subdirectory** (`chmod 000`) containing a would-be-duplicate
  file — exit 0, no error; that subtree's file is silently absent from
  output; the sibling duplicate pair outside it is still reported correctly
  (`os.walk`'s default `onerror=None` skip, per ADR-6).
- **Deep nesting** (50 levels) — exit 0, duplicate at depth 50 correctly
  grouped with a file at the root; no recursion-depth issue (`os.walk` is
  iterative, not recursive).

No unexpected exit codes, hangs, tracebacks, or malformed output encountered
in any of these probes.

## Gaps

None. All 22 in-scope acceptance criteria (AC1.1 through AC9.3) were
independently exercised end-to-end through the real CLI entry point (or, for
AC8.x, through `pytest` as R8 mandates) and verified — none required
inference from code reading alone. The 38-test suite (21 unit + 17 e2e)
required no additions; existing coverage was sufficient to corroborate every
criterion, and this verifier's own independent manual reproductions (E1–E9,
plus the F2/F3 race reproductions and the beyond-happy-path probes) did not
surface any discrepancy from the suite's results. No source files or
`state.yaml` were modified by this verification pass.
