# Review Report: 03-unit-tests

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 98e4498 (branch run/wordfreq)

## Findings

### F1 — blocking — Descending-count ordering (AC4.2) is never actually discriminated: every expected `top_words` ordering coincides with plain alphabetical order
- **Where:** `apps/wordfreq/test_core.py:37-51` (also `:31-34`, `:56-62`)
- **Failure scenario:** Replace `top_words` with the subtly wrong
  `return sorted(Counter(tokens).items())` — sort by word alone, counts
  ignored. All 12 tests pass:
  - `test_top_n_orders_by_descending_count` — tokens `a a a b b c`; expected
    `[('a',3),('b',2),('c',1)]` is also exactly alphabetical order.
  - `test_top_n_larger_than_distinct_words_returns_all_no_padding` —
    `apple(2), banana(1), cherry(1), date(1)`: descending-count-then-alpha
    order equals alphabetical order.
  - `test_tie_breaks_alphabetically_and_is_reproducible` — both counts equal,
    so alphabetical is the expected order by construction.
  - `test_case_insensitive_tokenize_and_count` — single entry.
  Yet this mutant violates AC4.2 for any input where the most frequent word
  is not alphabetically first (e.g. `"dog dog cat"` → mutant yields
  `cat 1` first). The suite claims AC4.2 coverage but does not pin the one
  property AC4.2 exists to pin: count-descending order. Fix: at least one
  test whose count ranking contradicts alphabetical order, e.g.
  `tokenize("zebra zebra zebra mango mango apple")`, expect
  `[('zebra',3),('mango',2),('apple',1)]`.
- **Requirement:** spec R4/AC4.2; plan interface contract for `top_words`
  ("ordered by count descending, then word ascending"); task scope line
  "top_n: AC4.2 ordering (descending count, ...)".

### F2 — blocking — Top-N truncation is never exercised: no test has more distinct words than `n`
- **Where:** `apps/wordfreq/test_core.py:37-42`
- **Failure scenario:** Replace `top_words` with a version that omits the
  `[:n]` slice (returns *all* distinct words). All 12 tests pass:
  - `test_top_n_orders_by_descending_count` uses n=3 with exactly 3 distinct
    words — the equality assertion holds whether or not truncation happens.
  - Every other call site has n ≥ distinct count (n=100/4 distinct, n=2/2,
    n=10/1, n=10/0).
  Yet this mutant violates AC4.2 ("outputs exactly 3 lines" — the *3 most
  frequent* of more) and R4's core demand, "report only the N most frequent
  distinct words". The task scope explicitly requires "exactly n results"
  under AC4.2; the docstring at test_core.py:39-40 claims "exactly n results
  returned when at least n distinct words exist" but the chosen input
  (distinct == n) cannot detect a missing truncation. Fix: a test with
  distinct > n, e.g. 4+ distinct words and n=2, asserting the exact
  2-element result. (A single added test with distinct > n *and*
  count-order ≠ alphabetical order resolves both F1 and F2.)
- **Requirement:** spec R4/AC4.2; task acceptance test 3 ("All listed spec
  ACs ... have a corresponding assertion at function level" — the AC4.2
  assertion exists but does not pin the behavior).

No major or minor findings.

## Coverage

Reviewed against spec.md and plan.md directly; implementer notes used as
context only. Static analysis (dispatch restricts execution to git); each
assertion was traced by hand against the plan's interface contract and
against candidate wrong implementations (mutation reasoning).

- **R2 tokenization (AC2.1, AC2.2, AC2.3)** ✓ clean — all three assert exact
  full token lists (test_core.py:10-23), pinning lowercasing, order of
  appearance, punctuation stripping, internal-apostrophe retention, and
  hyphen splitting. A `str.split`+`strip(punctuation)` mutant fails AC2.3's
  test; an apostrophe-splitting mutant fails AC2.2's.
- **R3 case folding (AC3.1)** ✓ clean — exact list `['the','the','the']` plus
  exact aggregation `[('the', 3)]` (test_core.py:28-32); pins both lowercase
  reporting and single-entry aggregation.
- **R4 top-N** ✗ — see F1/F2. AC4.3 itself (n > distinct → all words, no
  padding, no error) is cleanly pinned by exact equality + length
  (test_core.py:45-51).
- **R5 tie-breaking (AC5.1)** ✓ clean at unit level — input `"zebra apple
  zebra apple"` is well chosen: insertion order (zebra first) contradicts the
  required alphabetical output, so a `Counter.most_common()` implementation
  (the realistic wrong implementation ADR-4 warns about) fails this test.
  The repeated-call assertion (test_core.py:59-61) adds little for a pure
  function in one process, but cross-run byte-identity is task 04's CLI
  surface per the plan's mapping — acceptable here.
- **R6 format (AC6.1)** ✓ clean — byte-exact string equality
  `'cat\t2\ndog\t1\n'` (test_core.py:68); pins tab separator, embedded
  newlines, trailing newline on last line, no header. Tuple-vs-list result
  types are also pinned throughout (tuple != list under `==`).
- **R8 empty semantics (AC8.1, AC8.2)** ✓ clean — all three functions
  covered exactly: `tokenize('') == []`, punctuation-only `== []`,
  `top_words([], 10) == []`, `format_lines([]) == ''` (no lone newline)
  (test_core.py:73-90).
- **AC9.2 naming contract** ✓ clean — verified by inspection: substrings
  `tokeniz` (tests at :10, :16, :21, :28), `case` (:28), `top_n` (:37, :45),
  `tie` (:56), `empty` (:73, :78, :83, :88) all present in individually
  named top-level test functions; `pytest --collect-only` will list them.
- **Constraints** ✓ clean — stdlib + pytest only (sole import is
  `wordfreq`); no on-disk fixtures; no `__init__.py`; no conftest.py added
  (the plan's rootdir risk did not materialize per implementer notes, and
  the diff is consistent with that); no subprocess/CLI usage leaking into
  task 04's surface.
- **Not assessed:** actual pytest execution (dispatch restricts to git —
  AC9.1's exit-0 claim is the implementer's report, corroborated by static
  trace against the merged `wordfreq.py`); concurrency/performance (out of
  scope).
- **Note for G2 / task 04:** the implementer's environment flag is sound —
  the only interpreter here is Python 3.9.6, and the merged `wordfreq.py`
  is 3.9-safe as written (`Optional[Sequence[str]]` at wordfreq.py:43, not
  PEP 604 `X | None`; builtin generics `list[str]` are runtime-valid on
  3.9). No action needed in this task; task 04's review should confirm
  `wordfreq.py` stays 3.9-compatible.

## Boundary check

Declared `file_contact_surface`: `apps/wordfreq/test_core.py` — the only
code file touched (new file, 90 lines). The diff also edits
`runs/wordfreq/tasks/03-unit-tests.yaml` (status `pending` → `in-review`,
implementer report appended to `notes:`). Consistent with review-01's
treatment: that is the pipeline's own bookkeeping artifact, which the task
file's `notes:` section exists to receive (the scope explicitly directs
deviations to be recorded there); not counted as a boundary violation.
In bounds.

---

# Review Report: 03-unit-tests — Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit e57277f (branch run/wordfreq)

## Findings

None. Both round-1 blocking findings are resolved; no new defects introduced.

### Resolution of round-1 findings

- **F1 (blocking, resolved)** — `apps/wordfreq/test_core.py:44-54`
  (`test_top_n_truncates_and_orders_by_count_not_alphabet`). Input
  `"zebra zebra zebra mango mango apple"` has its highest-count word
  ('zebra', 3) alphabetically *last*. Traced against the F1 mutant
  `sorted(Counter(tokens).items())` (count-blind alphabetical sort): it
  yields `[('apple',1), ('mango',2), ('zebra',3)]`, which fails the
  asserted `[('zebra',3), ('mango',2)]` whether or not the mutant also
  truncates (`[:2]` of the alphabetical order is
  `[('apple',1), ('mango',2)]` — still wrong). Count-descending order is
  now genuinely pinned. Killed.
- **F2 (blocking, resolved)** — same test. 3 distinct words with n=2:
  the F2 mutant (correct sort key `(-count, word)` but missing `[:n]`)
  returns a 3-element list `[('zebra',3), ('mango',2), ('apple',1)]`,
  failing the exact 2-element equality. Truncation is now genuinely
  exercised. Killed.
- Cross-check against the real implementation (`wordfreq.py:21-26` at
  e57277f): `sorted(counts.items(), key=lambda pair: (-pair[1],
  pair[0]))[:n]` produces exactly `[('zebra',3), ('mango',2)]` — the new
  assertion passes against correct code, so this is not a
  false-failing test.

## Coverage

Reviewed against spec.md and plan.md directly; implementer round-2 notes
used as context only. Static analysis (dispatch restricts execution to
git); the new assertion and both mutants traced by hand against the
merged `wordfreq.py` at commit e57277f.

- **New test correctness** ✓ clean — input is plain whitespace-separated
  lowercase words, so no interaction with the trickier tokenize paths;
  expected value matches the actual implementation; docstring accurately
  describes the two mutants it discriminates.
- **R4/AC4.2** ✓ now clean — count-descending order and exact-n
  truncation are each pinned by at least one test where a wrong
  implementation produces a detectably different result. The retained
  `test_top_n_orders_by_descending_count` (distinct == n) remains valid
  as the "exactly n results" case; the new test covers distinct > n.
- **No regression to round-1 clean areas** ✓ — the diff is additive: all
  12 round-1 tests are byte-identical (verified via the diff hunks);
  R2/R3/R5/R6/R8 coverage conclusions from round 1 stand unchanged.
- **AC9.2 naming contract** ✓ — new function name contains `top_n`; all
  five required substrings (tokeniz, case, top_n, tie, empty) still
  present in individually named top-level test functions.
- **Constraints** ✓ — still stdlib + pytest only (sole import
  `wordfreq`); no conftest.py, no `__init__.py`, no fixtures, no
  subprocess/CLI usage.
- **Not assessed:** actual pytest execution (implementer reports 13
  passed; static trace corroborates); uncommitted parallel work on
  test_cli.py (task 04's surface, explicitly out of scope for this
  review per dispatch).
- **Bookkeeping note for G2 (not a finding):** the task file still shows
  `review_rounds: 0` at e57277f despite this being round 2; whichever
  role owns that counter (orchestrator per the pipeline design) should
  true it up. Does not affect code correctness.

## Boundary check

Declared `file_contact_surface`: `apps/wordfreq/test_core.py`. The diff
touches that file (13 added lines, one test function) plus
`runs/wordfreq/tasks/03-unit-tests.yaml` (round-2 notes appended) —
the same bookkeeping pattern accepted in round 1. In bounds.
