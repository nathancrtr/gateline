# Review Report: 01-core-logic

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 8306865 (branch run/wordfreq)

## Findings

None. No blocking, major, or minor defects identified against spec.md R2–R6,
R8, R10 or plan.md's interface contracts / ADR-3 / ADR-4.

## Coverage

Reviewed against spec.md and plan.md directly; the implementer's notes were not
used as the standard. Static reasoning only (per dispatch, no commands beyond
`git show` were run) — each behavior below was traced by hand through the regex
and code paths.

- **R2 word rule (AC2.1–AC2.3)** ✓ — `WORD_RE` is exactly ADR-3's
  `r"[^\W_]+(?:'[^\W_]+)?"` (`wordfreq.py:9`). Verified the apostrophe group is
  non-capturing, so `findall` returns full matches (a capturing group here
  would have silently returned only the apostrophe-suffix text — checked,
  absent). Traced: `"Hello, hello! World."` → `['hello','hello','world']`;
  `"don't stop"` → `["don't",'stop']`; `"co-located"` → `['co','located']`.
  ADR-3's pinned consequences also hold: `"students'"` → `['students']`
  (trailing apostrophe is a delimiter), `"rock'n'roll"` → `["rock'n",'roll']`
  (second internal apostrophe splits), underscore excluded, Unicode
  alphanumerics (`café`) kept whole.
- **R3 case folding (AC3.1)** ✓ — `str.lower()` per ADR-3 (not `casefold`),
  applied per-token (`wordfreq.py:16`); `"The the THE"` → single `the` × 3.
- **R4/R5 ranking and tie-break (AC4.3, AC5.1)** ✓ — `Counter` + explicit
  `sorted(key=(-count, word))[:n]` (`wordfreq.py:23-24`); `most_common()` is
  not used, per ADR-4. `['zebra','apple','zebra','apple'], n=2` →
  `[('apple',2),('zebra',2)]`; slice yields fewer pairs without error when
  distinct words < n. Accepts a one-shot generator safely (single consumption
  point). `n < 1` is contract-undefined ("caller validates") — not assessed as
  a defect.
- **R6/R8 formatting (AC6.1, AC8.1, AC8.2)** ✓ — `format_lines`
  (`wordfreq.py:30`) emits real `\t`/`\n` characters via f-string join; `''`
  for empty input with no lone newline. `tokenize('')` and punctuation-only
  input → `[]`.
- **R10 / import cleanliness (AC10.2)** ✓ — imports are `re`,
  `collections.Counter`, `typing.Iterable` only; sole import-time side effect
  is compiling `WORD_RE`; no `main()`, no `__main__` guard, no I/O, no `sys` —
  file is left import-clean for task 02 as the task scope requires. Builtin
  generic annotations (`list[str]`, `tuple[str, int]`) are runtime-valid on
  Python ≥ 3.9.
- **Docstrings** ✓ — module docstring states the word rule (R2) as scoped;
  function docstrings match the plan's pinned signatures and semantics
  verbatim.
- **Not assessed:** concurrency (no concurrent access in scope); performance
  (out of scope per spec); acceptance tests were not executed (dispatch
  restricts execution to git — all nine were traced statically and each
  checks out).

Minor observations, not findings: plan.md annotates `WORD_RE: re.Pattern[str]`;
the implementation omits the annotation but the object and pattern are exactly
as pinned — no consumer contract depends on the annotation. The module
docstring says "Word frequency CLI" though the CLI arrives in task 02 —
accurate for the file's eventual whole, no requirement touched.

## Boundary check

Declared `file_contact_surface`: `apps/wordfreq/wordfreq.py` — the only code
file touched (new file). The diff also edits
`runs/wordfreq/tasks/01-core-logic.yaml` (status `pending` → `in-review`,
implementer notes appended). That is the pipeline's own bookkeeping artifact,
which the process directs the implementer to update (the task file's `notes:`
section exists for exactly this); it is not product code and is not counted as
a boundary violation. In bounds.
