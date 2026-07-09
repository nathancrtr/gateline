# Verification Report: wordfreq

<!-- Contract: produced by Verifier; consumed by gate G2. -->

**Change verified:** branch `run/wordfreq`, commit `1071dd8` (review-04 round-2 approval)
plus this Verifier's own test-only commit `789a5f9` (adds one CLI test; no production
code touched).
**Environment:** local (darwin), interpreter `/usr/bin/python3` = Python 3.9.6
(matches plan ADR-8/ADR-9's pinned constraint), `pytest 8.4.2` (invoked via
`python3 -m pytest`, and directly as `pytest` once its script directory —
`~/Library/Python/3.9/bin`, present but not on this shell's default `PATH` — is
added; both invocations are identical in behavior/output).

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E1 |
| AC2.1 | verified | E2 |
| AC2.2 | verified | E2 |
| AC2.3 | verified | E2 |
| AC3.1 | verified | E3 |
| AC4.1 | verified | E4 |
| AC4.2 | verified | E4 |
| AC4.3 | verified | E4 |
| AC5.1 | verified | E5 |
| AC6.1 | verified | E6 |
| AC7.1 | verified | E7 |
| AC7.2 | verified | E7 |
| AC8.1 | verified | E8 |
| AC8.2 | verified | E8 |
| AC9.1 | verified | E9 |
| AC9.2 | verified | E9 |
| AC10.1 | verified | E10 |
| AC10.2 | verified | E10 |

All 19 acceptance criteria: **verified**. None failed. None unverifiable.

### E1 — AC1.1 / AC1.2 (R1 — CLI file input)
```
$ printf 'hello world' > existing.txt
$ python3 wordfreq.py existing.txt
hello	1
world	1
exit=0

$ python3 wordfreq.py
usage: wordfreq.py [-h] [-n N] file
wordfreq.py: error: the following arguments are required: file
exit=2
```

### E2 — AC2.1 / AC2.2 / AC2.3 (R2 — word extraction rule)
```
$ printf 'Hello, hello! World.' > f.txt && python3 wordfreq.py f.txt
hello	2
world	1

$ printf "don't stop" > f.txt && python3 wordfreq.py f.txt
don't	1
stop	1

$ printf 'co-located items' > f.txt && python3 wordfreq.py f.txt
co	1
items	1
located	1
```

### E3 — AC3.1 (R3 — case-insensitive counting)
```
$ printf 'The the THE' > f.txt && python3 wordfreq.py f.txt
the	3
```

### E4 — AC4.1 / AC4.2 / AC4.3 (R4 — ranking and top-N)
```
$ python3 -c "print(' '.join(f'word{i}' for i in range(15)))" > f.txt
$ python3 wordfreq.py f.txt | wc -l
      10

$ printf 'a a a b b c c d' > f.txt && python3 wordfreq.py f.txt -n 3
a	3
b	2
c	2
$ python3 wordfreq.py f.txt -n 3 | wc -l
       3

$ printf 'apple banana cherry date egg' > f.txt && python3 wordfreq.py f.txt -n 100
apple	1
banana	1
cherry	1
date	1
egg	1
$ python3 wordfreq.py f.txt -n 100 | wc -l ; echo exit=$?
       5
exit=0
```

### E5 — AC5.1 (R5 — deterministic tie-breaking)
```
$ printf 'zebra apple zebra apple' > f.txt
$ python3 wordfreq.py f.txt -n 2 > run1.txt
$ python3 wordfreq.py f.txt -n 2 > run2.txt
$ cat run1.txt
apple	2
zebra	2
$ diff run1.txt run2.txt && echo IDENTICAL
IDENTICAL
```

### E6 — AC6.1 (R6 — output format)
```
$ printf 'cat cat dog' > f.txt && python3 wordfreq.py f.txt | xxd
00000000: 6361 7409 320a 646f 6709 310a            cat.2.dog.1.
$ python3 wordfreq.py f.txt > out.txt
$ printf 'cat\t2\ndog\t1\n' > expected.txt
$ diff out.txt expected.txt && echo "EXACT MATCH"
EXACT MATCH
```

### E7 — AC7.1 / AC7.2 (R7 — error handling)
```
$ python3 wordfreq.py /tmp/does-not-exist.txt ; echo exit=$?
wordfreq.py: error: [Errno 2] No such file or directory: '/tmp/does-not-exist.txt'
exit=1

$ python3 wordfreq.py /tmp/wordfreq_verify ; echo exit=$?
wordfreq.py: error: [Errno 21] Is a directory: '/tmp/wordfreq_verify'
exit=1
```
(No traceback in either case, confirmed with `grep -c Traceback` returning 0
and by the `test_ac7_1_.../test_ac7_2_...` assertions passing above.)

### E8 — AC8.1 / AC8.2 (R8 — empty/wordless input)
```
$ : > empty.txt && python3 wordfreq.py empty.txt ; echo exit=$?
exit=0
$ python3 wordfreq.py empty.txt | wc -c
       0

$ printf '... !!! ,,,' > punct.txt && python3 wordfreq.py punct.txt ; echo exit=$?
exit=0
$ python3 wordfreq.py punct.txt | wc -c
       0
```

### E9 — AC9.1 / AC9.2 (R9 — automated test coverage)
```
$ cd apps/wordfreq && python3 -m pytest ; echo exit=$?
[... 26 passed / 27 after this Verifier's added test ...]
============================== 27 passed in 0.82s ==============================
exit=0

$ PATH="$PATH:$HOME/Library/Python/3.9/bin" pytest    # literal `pytest`, per AC9.1's wording
============================== 26 passed in 0.80s ==============================
exit=0
```
Note on environment: this shell's default `PATH` does not include the directory
holding the `pytest` console script (`~/Library/Python/3.9/bin`), so the bare
`pytest` command is initially "command not found" here — this is a shell/session
`PATH` configuration detail of this particular verifier environment, not a
defect in the deliverable. `python3 -m pytest` (functionally identical) works
unconditionally, and `pytest` itself works once that directory is on `PATH`,
confirming AC9.1 holds.

```
$ python3 -m pytest --collect-only -q
test_cli.py::test_ac1_1_existing_readable_file_exits_zero
...
test_core.py::test_tokenize_strips_surrounding_punctuation
test_core.py::test_tokenize_keeps_internal_apostrophe
test_core.py::test_tokenize_hyphen_splits_words
test_core.py::test_case_insensitive_tokenize_and_count
test_core.py::test_top_n_orders_by_descending_count
test_core.py::test_top_n_truncates_and_orders_by_count_not_alphabet
test_core.py::test_top_n_larger_than_distinct_words_returns_all_no_padding
test_core.py::test_tie_breaks_alphabetically_and_is_reproducible
test_core.py::test_empty_string_tokenizes_to_no_words
test_core.py::test_empty_punctuation_only_tokenizes_to_no_words
...
27 tests collected in 0.01s
```
Individually named tests with substrings `tokeniz`, `case`, `top_n`, `tie`,
`empty` are all present and distinct, per the plan's test-name contract for
AC9.2.

### E10 — AC10.1 / AC10.2 (R10 — implementation constraints)
```
$ ls apps/wordfreq/*.py
test_cli.py
test_core.py
wordfreq.py
```
Excluding `test_*.py`, exactly one source file (`wordfreq.py`) remains — AC10.1
holds.
```
$ python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" wordfreq.py
argparse
re
sys
Counter
Iterable
```
Every name printed (`argparse`, `re`, `sys`, and the `from`-imported names
`Counter`, `Iterable`) is standard-library; no third-party package appears —
AC10.2 holds as the spec's own command defines it. I additionally exercised the
test suite's independent stdlib-classification helper (`_is_stdlib_module`,
added in task 04 round 2 to fix review-04 F1) directly in this environment to
corroborate the review's static reasoning with real execution:
```
$ python3 -c "
import sys; sys.path.insert(0, '.')
import test_cli
for m in ('setuptools','pip','argparse','re','sys','collections','typing','pytest'):
    print(m, test_cli._is_stdlib_module(m))
"
setuptools False
pip False
argparse True
re True
sys True
collections True
typing True
pytest False
```
This confirms, by execution (not just code reading), that on this machine
`setuptools`/`pip` — both nested under this interpreter's own stdlib directory,
which is exactly the layout review-04's F1 finding described — are correctly
rejected as non-stdlib, while every module `wordfreq.py` actually imports is
correctly accepted, and the reviewer's fix genuinely works, not just plausibly.

## Beyond the happy path

Probed well past the ACs; nothing here is a numbered acceptance criterion, but
all of it exercises `main()`'s error/edge paths.

- **`-n 0` / `-n -1` / `-n abc`**: all rejected by argparse's `positive_int`
  converter, exit 2, clean one-line usage + error message on stderr, no
  traceback. Correct — the spec/plan's `positive_int` contract holds.
- **`--top` long flag, `-n=2` / `--top=2` combined forms, flag before the
  positional arg**: all work identically to `-n 2` / `-n 2` after the file.
  Standard argparse behavior, no surprises.
- **`-h`/`--help`**: prints usage + option help, exits 0.
- **Extra positional argument** (`wordfreq.py file.txt extra.txt`): rejected
  by argparse (`unrecognized arguments`), exit 2 — no silent multi-file
  behavior, consistent with the spec's "out of scope: multi-file input."
- **`--` separator with a file named like a flag** (`-weird.txt`): works
  correctly via argparse's standard `--` handling.
- **Binary input (`/dev/urandom` bytes)**: `UnicodeDecodeError` caught, clean
  one-line stderr message, exit 1, no traceback. Confirms assumption 6's
  "bad-encoding is an R7 error" resolution actually holds at runtime — **this
  path was not covered by the existing automated suite** (see Gaps below; I
  added a test for it).
- **Non-UTF-8 (Latin-1-encoded) text file** (`café résumé` encoded as
  Latin-1): same as above — clean error, exit 1, no traceback.
- **Permission-denied file** (`chmod 000`): `PermissionError` (an `OSError`
  subclass) caught by the same handler as AC7.1/AC7.2 — clean error, exit 1.
- **Accented UTF-8 words** (`café café résumé`): counted correctly as UTF-8
  alphanumeric words (`café	2`, `résumé	1`) — confirms ADR-3's rejection of an
  ASCII-only character class was the right call for assumption-6-committed
  UTF-8 input.
- **Typographic apostrophe U+2019** (`don’t`): splits into `don`, `t` (the
  regex only recognizes ASCII `'`). **Double internal apostrophe**
  (`rock'n'roll`): splits into `rock'n` + `roll`. **Leading/trailing
  apostrophe** (`students'`): trailing apostrophe stripped → `students`.
  **Underscore** (`snake_case`): splits into `snake`, `case` (`\W` excludes
  `_` from "word chars" but `[^\W_]` explicitly excludes it too, per ADR-3).
  All four are exactly the behaviors ADR-3 documents as accepted consequences
  of the regex, not bugs — flagging here only to confirm the documented
  consequences match observed behavior, which they do.
- **CRLF line endings**: `\r` correctly excluded from words (not appended to
  the last word on a line); output is CRLF-free, tab/`\n`-only.
- **Huge file** (200,000 lines / ~1,000,000 tokens, 5.6 MB): completes in
  ~0.6s wall time, correct top-10 ranking, exit 0 — no scalability problem
  in practice, though the spec explicitly puts performance out of scope.
- **Broken symlink**: resolves to `FileNotFoundError` (an `OSError`), same
  clean-error path as AC7.1, exit 1.

No probe surfaced a traceback, a hang, a nonzero-exit-with-empty-stderr, or
any other unhandled-failure mode.

## Gaps

- **Coverage gap closed by this Verifier:** the `UnicodeDecodeError` branch of
  `main()`'s `except (OSError, UnicodeDecodeError)` handler (spec assumption
  6 — invalid-UTF-8 input is an R7-style read error) was exercised by manual
  probing above but had **no automated test** before this verification pass —
  the existing 26-test suite's R7 coverage (AC7.1/AC7.2) only exercises the
  `OSError` side (missing path, directory). I added
  `test_invalid_utf8_input_exits_nonzero_no_traceback` to
  `apps/wordfreq/test_cli.py` (commit `789a5f9`, tests only, no production
  code touched) and confirmed it passes together with the full existing suite
  (27 passed). This is not a numbered AC, so its absence does not block G2,
  but it closes a real branch-coverage gap in R7's error handling.
- **AC9.1's literal `pytest` command required a `PATH` adjustment** in this
  particular verifier shell session (the `pytest` console script lives outside
  this shell's default `PATH`). This is an environment/session detail, not a
  finding against the deliverable — `python3 -m pytest` and `pytest` (once on
  `PATH`) behave identically and both exit 0. Flagging only so G2 understands
  why the first literal invocation attempt failed before I diagnosed it.
- **Nothing was unverifiable.** Every one of R1-R10's acceptance criteria was
  exercised directly through the CLI's real entry point (`python3 wordfreq.py
  ...`) or through `pytest`, with pasted command/output evidence above; no
  criterion required infrastructure, credentials, or data this environment
  lacked.
- **FIFO/named-pipe input** was attempted as an additional edge probe but
  aborted (this sandbox's shell lacks `timeout`/`gtimeout`, and a blocking
  read against a FIFO risked hanging the session) — not completed, and not
  required by any AC (the spec restricts input to a file-path argument, and a
  FIFO opened by path is a valid but out-of-scope edge case). Noted as an
  incomplete probe, not a failure.
