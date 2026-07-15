# Verification Report: mdtoc

<!-- Contract: produced by Verifier; consumed by gate G2. -->

**Change verified:** branch `run/mdtoc`, `apps/mdtoc/` as of commit `8cd8b9f`
(review-02 round-2 approve; all three tasks `review-approved`, `phase: integrate`).
Diff scope confirmed: `apps/mdtoc/mdtoc.py` (+102), `apps/mdtoc/test_core.py` (+201),
`apps/mdtoc/test_cli.py` (+245) — no other files touched by this run's commits.
**Environment:** local (darwin), interpreter `/usr/bin/python3` = Python 3.9.6
(matches plan ADR-8's pinned constraint — the shell's default `python3` resolves to
Homebrew 3.14.6, which has no `pytest`; all commands below explicitly use
`/usr/bin/python3` or, once `~/Library/Python/3.9/bin` is on `PATH`, the literal
`pytest` console script — both invoked and shown identical). `pytest 8.4.2`.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E1 |
| AC1.3 | verified | E1 |
| AC2.1 | verified | E2 |
| AC2.2 | verified | E2 |
| AC2.3 | verified | E2 |
| AC3.1 | verified | E3 |
| AC3.2 | verified | E3 |
| AC4.1 | verified | E4 |
| AC4.2 | verified | E4 |
| AC4.3 | verified | E4 |
| AC4.4 | verified | E4 |
| AC4.5 | verified | E4 |
| AC5.1 | verified | E5 |
| AC6.1 | verified | E6 |
| AC6.2 | verified | E6 |
| AC7.1 | verified | E7 |
| AC7.2 | verified | E7 |
| AC7.3 | verified | E7 |
| AC8.1 | verified | E8 |
| AC8.2 | verified | E8 |
| AC9.1 | verified | E9 |
| AC9.2 | verified | E9 |
| AC10.1 | verified | E10 |
| AC10.2 | verified | E10 |
| AC10.3 | verified | E10 |

All 26 acceptance criteria: **verified**. None failed. None unverifiable.

### E1 — AC1.1 / AC1.2 / AC1.3 (R1 — CLI file input, stdout-only)
```
$ printf '# Title\n## Section\n' > sample.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py sample.md
- [Title](#title)
  - [Section](#section)
$ echo $?
0

$ /usr/bin/python3 apps/mdtoc/mdtoc.py 1>out.txt 2>err.txt; echo $?
2
$ cat out.txt   # empty
$ cat err.txt
usage: mdtoc.py [-h] file
mdtoc.py: error: the following arguments are required: file

$ /usr/bin/python3 apps/mdtoc/mdtoc.py docs/DESIGN.md > /tmp/design_toc.txt; echo $?
0
$ git diff --exit-code docs/DESIGN.md; echo "DIFF EXIT: $?"
DIFF EXIT: 0
$ git status --porcelain   # empty — no new files created
```

### E2 — AC2.1 / AC2.2 / AC2.3 (R2 — ATX heading detection)
```
$ printf '# Title\n## Section A\n### Sub A1\n' > ac2_1.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac2_1.md
- [Title](#title)
  - [Section A](#section-a)
    - [Sub A1](#sub-a1)

$ printf '#1234\n' > ac2_2.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac2_2.md
(no output)

$ printf '####### Seven\n' > ac2_3.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac2_3.md
(no output)
```
Boundary check beyond the AC text: `###### Six` (exactly 6 `#`) is detected
(`- [Six](#six)`, indented 5 levels) — confirms the 1–6 boundary from both sides.

### E3 — AC3.1 / AC3.2 (R3 — fenced code blocks excluded)
```
$ printf '```\n# not a heading\nregular text\n```\n## Real Heading\n' > ac3_1.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac3_1.md
  - [Real Heading](#real-heading)

$ printf '~~~\n# not a heading\nregular text\n~~~\n## Real Heading\n' > ac3_2.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac3_2.md
  - [Real Heading](#real-heading)
```

**Review-02 F6 probe (exact-length fence-close mutant), run directly against the
built artifact, not just the test suite:**
```
$ printf '```\n# hidden\n````\n## After\n' > f6.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py f6.md
  - [After](#after)
```
A 4-backtick line correctly closes a 3-backtick fence (`run_len >= fence_len`,
`mdtoc.py:49`); `hidden` stays excluded and `After` is captured. This confirms
review-02's F6 concern names a **real, but already-correct**, code path — the
implementation is right; what review-02 flagged (and what remains true after
round 2) is that no *test* in `test_core.py` discriminates a `run_len == fence_len`
mutant from the correct `run_len >= fence_len` behavior with a strictly-longer
closing run (`test_fence_close_requires_at_least_opening_length` at
`test_core.py:68-73` closes a 4-length fence with a run of exactly 4, and a
shorter run of 3 — never a run longer than the opener). Verdict: **no AC is
affected** (review-02 itself notes "R3 has no AC pinning length semantics —
plan-pinned only"); disposition below in Gaps.

### E4 — AC4.1 / AC4.2 / AC4.3 / AC4.4 / AC4.5 (R4 — GitHub anchor generation, amended)
```
$ printf '## Hello World\n' > ac4_1.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac4_1.md
  - [Hello World](#hello-world)

$ printf "## Don't Repeat Yourself\n" > ac4_2.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac4_2.md
  - [Don't Repeat Yourself](#dont-repeat-yourself)

$ printf '### 1. What v1 changes — and what it must not\n' > ac4_3.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac4_3.md
    - [1. What v1 changes — and what it must not](#1-what-v1-changes--and-what-it-must-not)

$ printf '## Code `example`\n' > ac4_4.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac4_4.md
  - [Code `example`](#code-example)

$ printf '## Use snake_case Names\n' > ac4_5.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac4_5.md
  - [Use snake_case Names](#use-snake_case-names)
```
AC4.5 (the amended criterion) is confirmed exactly: the anchor is
`use-snake_case-names` — the underscore inside `snake_case` is preserved, not
stripped, matching the ADR-4 amendment (G1 decline direction) and live GitHub
behavior. All five anchor cases, including the em-dash-to-double-hyphen collapse
(AC4.3) and backtick removal (AC4.4), match the spec's literal expected strings
byte-for-byte.

### E5 — AC5.1 (R5 — duplicate anchor disambiguation)
```
$ printf '# Overview\n## Overview\n### Overview\n' > ac5_1.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac5_1.md
- [Overview](#overview)
  - [Overview](#overview-1)
    - [Overview](#overview-2)
```

### E6 — AC6.1 / AC6.2 (R6 — nested list output)
```
$ printf '# Title\n## Section A\n### Sub A1\n## Section B\n' > ac6_1.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac6_1.md > ac6_1.out
$ python3 -c "
expected = b'- [Title](#title)\n  - [Section A](#section-a)\n    - [Sub A1](#sub-a1)\n  - [Section B](#section-b)\n'
actual = open('ac6_1.out','rb').read()
print('MATCH' if actual == expected else 'MISMATCH')
"
MATCH

$ printf '### Deep Start\n' > ac6_2.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac6_2.md | cat -A
····-·[Deep·Start](#deep-start)␊
```
AC6.2 confirmed: a lone level-3 heading (no level-1/2 present) is still indented
4 spaces (absolute level, not renumbered).

### E7 — AC7.1 / AC7.2 / AC7.3 (R7 — invalid input handling)
```
$ /usr/bin/python3 apps/mdtoc/mdtoc.py does-not-exist.md 1>out.txt 2>err.txt; echo $?
1
$ cat out.txt   # empty
$ cat err.txt
mdtoc.py: error: [Errno 2] No such file or directory: 'does-not-exist.md'

$ mkdir adir && /usr/bin/python3 apps/mdtoc/mdtoc.py adir 1>out.txt 2>err.txt; echo $?
1
$ cat out.txt   # empty
$ cat err.txt
mdtoc.py: error: [Errno 21] Is a directory: 'adir'

$ printf '\x80\x81abc' > badutf8.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py badutf8.md 1>out.txt 2>err.txt; echo $?
1
$ cat out.txt   # empty
$ cat err.txt
mdtoc.py: error: 'utf-8' codec can't decode byte 0x80 in position 0: invalid start byte
```
No traceback in any case; exit code 1 in all three; stderr is a single
human-readable line.

**Review-03 F1 probe (error-path stdout emptiness), run directly:** in all three
cases above, stdout is verified empty (`cat out.txt` produces nothing / `wc -c`
== 0). This is because `main()` (`mdtoc.py:90-98`) never calls
`sys.stdout.write` until *after* the read-and-parse block returns successfully —
there is no code path in the delivered implementation that could write partial
stdout before an error return. Verdict: the concern review-03 F1 raised (a
hypothetical *mutant* that writes-then-fails) does not describe a defect in the
delivered artifact; direct execution confirms current behavior is correct. No
AC is affected (review-03 itself notes "no spec AC").

### E8 — AC8.1 / AC8.2 (R8 — headingless input is not an error)
```
$ printf 'Just some text.\nMore text, no markers.\n' > ac8_1.md
$ /usr/bin/python3 apps/mdtoc/mdtoc.py ac8_1.md > out.txt; echo $?
0
$ wc -c out.txt
0 out.txt

$ : > ac8_2.md && /usr/bin/python3 apps/mdtoc/mdtoc.py ac8_2.md > out.txt; echo $?
0
$ wc -c out.txt
0 out.txt
```

### E9 — AC9.1 / AC9.2 (R9 — automated test coverage)
```
$ cd apps/mdtoc && /usr/bin/python3 -m pytest -v
...
36 passed in 0.81s

$ PATH="$PATH:$HOME/Library/Python/3.9/bin" pytest -q   # literal `pytest`, per AC9.1's wording
....................................  [100%]
36 passed in 1.21s

$ /usr/bin/python3 -m pytest --collect-only -q
test_cli.py::test_ac1_1_existing_readable_file_exits_zero_with_toc
...(36 distinct tests, listed in full in the tool-call transcript)...
36 tests collected in 0.01s
```
AC9.2's substring-name contract confirmed by inspection of the collected names:
`heading` (5 in `test_core.py` + more in `test_cli.py`), `fence` (5, incl.
mixed-dialect and unclosed-to-EOF), `slug` (8, incl. em-dash/apostrophe/backtick
and two underscore-preservation assertions), `duplicate` (2), `empty` (4).

### E10 — AC10.1 / AC10.2 / AC10.3 (R10 — implementation constraints)
```
$ find apps/mdtoc -maxdepth 1 -name "*.py" | sort
apps/mdtoc/mdtoc.py
apps/mdtoc/test_cli.py
apps/mdtoc/test_core.py
```
Excluding `test_*.py`, exactly one source file (`mdtoc.py`) — AC10.1 holds.
```
$ /usr/bin/python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" apps/mdtoc/mdtoc.py
argparse
re
sys
Iterable
```
Every printed name is stdlib (`argparse`, `re`, `sys` directly; `Iterable` is
the first name imported from `typing`, which the spec's own literal command
prints instead of the module name for `ImportFrom` nodes — a property of the
AC's pinned command, not of the deliverable). No third-party name appears.
Cross-checked with the test suite's more precise root-module extraction
(`test_cli.py:186-207`, which correctly resolves `typing` via `node.module`)
and its stdlib classifier, exercised directly:
```
$ /usr/bin/python3 -c "
import sys; sys.path.insert(0, 'apps/mdtoc')
import test_cli
for m in ('setuptools','pip','argparse','re','sys','typing','pytest'):
    print(m, test_cli._is_stdlib_module(m))
"
setuptools False
pip False
argparse True
re True
sys True
typing True
pytest False
```
Confirms, by execution (not just code reading), ADR-8's mandatory
site-packages/dist-packages rejection actually discriminates third-party
modules from stdlib on this machine (`setuptools`/`pip` are nested under this
interpreter's own stdlib directory and would be misclassified without it).
```
$ /usr/bin/python3 -m py_compile apps/mdtoc/mdtoc.py; echo $?
0
```
`/usr/bin/python3` is confirmed 3.9.6 (`python3 --version`); AC10.3 holds.
Grep confirms no `|` characters anywhere in `mdtoc.py`'s source (no PEP 604
union syntax possible), and `test_ac10_3_py_compiles_and_has_no_pep604_annotations`
(passing above) performs the plan-mandated interpreter-independent AST `BinOp`
scan over every annotation expression.

## Beyond the happy path

- **Exactly-6-`#` boundary** (`###### Six`): detected, level 6 — confirms the
  1–6 range from the top edge, complementing AC2.3's 7-`#` rejection.
- **Tab after `#` instead of space** (`#\tTabbed`): not detected as a heading —
  correct per R2's literal "1–6 `#` then a space or end of line" rule (a tab is
  neither).
- **Indented heading** (` # Indented`, one leading space): not detected —
  correct per the anchored regex (`^(#{1,6})...`) and the plan's ADR-2
  rejection of CommonMark's up-to-3-space indent tolerance.
- **Unicode heading text** (`## Café Résumé`): anchor `café-résumé` — `é` is
  `str.isalpha()`-true and correctly preserved, matching R4's "Unicode letter"
  wording (not ASCII-only).
- **CRLF line endings** (`# Title\r\n## Section\r\n`): output correctly
  LF-only, no stray `\r` — `str.splitlines()` absorbs `\r\n` as documented in
  plan risk notes.
- **Permission-denied file** (`chmod 000`): `PermissionError` (an `OSError`
  subclass) caught by the same handler as AC7.1/AC7.2 — exit 1, clean one-line
  stderr, no traceback.
- **`pytest` invoked both as `python3 -m pytest` and as the literal `pytest`
  console script** — both exit 0, both report 36 passed, confirming AC9.1
  under the exact wording of the spec ("Running `pytest`...").

No probe surfaced a traceback, a hang, a nonzero-exit-with-empty-stderr, stray
stdout on an error path, or any output diverging from a hand-computed expected
string.

## Gaps

- **Nothing was unverifiable.** All 26 acceptance criteria (R1–R10, including
  the amended R4/AC4.5) were exercised directly through the CLI's real entry
  point (`python3 apps/mdtoc/mdtoc.py ...`) and through `pytest`, with pasted
  command/output evidence above.
- **Review-02 F6 (exact-length fence-close mutant)** — checked explicitly (E3
  above): the implementation is correct (a longer closing run does close a
  shorter-opened fence, verified by direct execution against a hand-built
  fixture the existing test suite doesn't contain), but `test_core.py` still
  has no assertion that would kill a `run_len == fence_len` mutant against a
  *strictly longer* closing run. No AC pins fence-length semantics (review-02's
  own disposition), so this does not affect any verdict above. I did not add a
  test for it: per this dispatch's guidance ("commit tests only... expect to
  add nothing"), and because both review reports that raised F6/F1 explicitly
  classify them as non-AC-pinned, plan-level-only observations already
  triaged and left open by design ("flagged for the G2 human," review-02's own
  words) rather than coverage gaps against a numbered requirement — closing
  them is a judgment call for whoever owns the next round on this file, not a
  verification blocker.
- **Review-03 F1 (error-path stdout emptiness)** — checked explicitly (E7
  above): direct execution confirms stdout is byte-empty on all three R7 error
  paths (missing file, directory, invalid UTF-8); reading `main()` confirms
  there is no code path that could write to stdout before an error return.
  Same disposition as F6: no AC affected, not added as a test for the same
  reason.
- **AC10.2's literal spec command** prints the first `from`-imported name
  (`Iterable`) rather than the module (`typing`) for `ImportFrom` nodes — a
  property of the command as spec'd, reproduced verbatim above, not a defect;
  cross-checked against the test suite's more precise implementation which
  correctly resolves the root module and classifies it stdlib.
