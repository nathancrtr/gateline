# Technical Plan: Word Frequency CLI

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     Amended 2026-07-08 per review-02 F1: main() signature spelling (ADR-8).
     Amended 2026-07-08 per review-04 F1: AC10.2 stdlib-check mechanism on 3.9 (ADR-9). -->

## Approach

Greenfield deliverable, placed at `apps/wordfreq/` (ADR-1) to keep product code
separate from the pipeline scaffolding (`roles/`, `contracts/`, `runs/`) that makes up
the rest of this repo. The deliverable is three files:

```
apps/wordfreq/
  wordfreq.py       # the entire CLI — the single source file mandated by R10
  test_core.py      # unit tests importing wordfreq's pure functions (R9)
  test_cli.py       # end-to-end tests invoking the script via subprocess (R9)
```

`wordfreq.py` is internally layered into **pure core functions** (tokenize, rank,
format — no I/O, no `sys`) and a **CLI shell** (`main()` — argparse, file reading,
error handling, exit codes). This split exists *inside one file*, satisfying R10 while
making R9's "core logic verifiable independent of shell invocation" trivially true:
`test_core.py` imports the functions; `test_cli.py` exercises the process boundary
(exit codes, stderr, exact stdout bytes).

Data flow: `main()` parses args → reads the file as UTF-8 → `tokenize()` produces
lowercase word tokens → `top_words()` counts and ranks with deterministic tie-breaking
→ `format_lines()` renders tab-separated output → `main()` writes it to stdout and
returns an exit code. All failure modes (missing/unreadable/non-file path, bad UTF-8)
are caught in `main()` and reported as one-line stderr messages with a non-zero exit
(R7); empty results are success with empty stdout (R8).

Work is cut into four tasks: core functions (01), CLI shell (02, same file, so it
depends on 01), unit tests (03, parallel with 02), CLI/e2e tests (04, after 02).
Rationale in ADR-7.

## Interface contracts

These are binding. Implementers of tasks 03 and 04 write tests against exactly these
signatures and behaviors; do not invent others.

### Module: `apps/wordfreq/wordfreq.py`

```python
"""Module-level compiled pattern — the single definition of 'word' (R2)."""
WORD_RE: re.Pattern[str]  # r"[^\W_]+(?:'[^\W_]+)?"   (see ADR-3)

def tokenize(text: str) -> list[str]:
    """All word tokens in `text`, lowercased, in order of appearance.
    A word is a maximal run of alphanumeric characters optionally containing
    ONE internal apostrophe (R2, R3). Returns [] for wordless text (R8)."""

def top_words(tokens: Iterable[str], n: int) -> list[tuple[str, int]]:
    """At most `n` (word, count) pairs, ordered by count descending, then word
    ascending (R4, R5). Fewer than `n` pairs if fewer distinct words exist.
    Requires n >= 1 (caller validates)."""

def format_lines(pairs: Iterable[tuple[str, int]]) -> str:
    """One 'word\\tcount\\n' line per pair, concatenated, in given order (R6).
    Returns '' for an empty iterable — no trailing or lone newline (R8)."""

def positive_int(value: str) -> int:
    """argparse type= converter; raises argparse.ArgumentTypeError for < 1."""

def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None → sys.argv[1:]).
    Returns the process exit code; never raises for anticipated errors (R7)."""

if __name__ == "__main__":
    raise SystemExit(main())
```

> **Environment constraint (amendment, review-02 F1 / ADR-8):** the execution
> environment's only interpreter is `/usr/bin/python3` = Python **3.9.6**. PEP 604
> union syntax in evaluated annotations (`Sequence[str] | None`) raises `TypeError`
> at def time on 3.9, so `main()` is pinned in the `Optional[...]` spelling above
> (semantically identical union; `Optional` and `Sequence` come from `typing`).
> Do not copy `X | None` annotations into any code for this run — task 04 included.
> PEP 585 subscriptions (`list[str]`, `tuple[str, int]`, `re.Pattern[str]`) are
> fine on 3.9 and remain as written.

### CLI contract (what `test_cli.py` builds against)

- Invocation: `python3 apps/wordfreq/wordfreq.py FILE [-n N | --top N]`
  (names finalized per ADR-2).
- `FILE`: required positional, path to the text file (R1).
- `-n/--top`: optional int, default **10** (R4); values < 1 rejected via
  `positive_int` (argparse error → exit 2, usage on stderr).
- Exit codes: `0` success including empty/wordless input (R8); `2` argument errors,
  emitted by argparse itself (R1/AC1.2); `1` file errors — path missing, path is a
  directory, permission denied, or invalid UTF-8 (R7 and spec assumption 6).
- File errors are caught as `(OSError, UnicodeDecodeError)` in `main()`; the message
  is a single human-readable line on stderr of the form
  `wordfreq.py: error: <reason>` — never a traceback (R7).
- Success output: exactly `format_lines(top_words(tokenize(text), n))` written to
  stdout via `sys.stdout.write` — byte-exact per AC6.1, zero bytes for empty results
  (AC8.1/AC8.2). Nothing else is written to stdout, ever.
- File is read with `open(path, encoding="utf-8")` (spec assumption 6).

### Test-layout contract

- Both test files live in `apps/wordfreq/` beside `wordfreq.py`; `pytest` run from
  that directory (AC9.1) discovers both. Tests import the module as `import wordfreq`
  (pytest's default rootdir insertion puts the test file's directory on `sys.path`;
  there are no `__init__.py` files). `test_cli.py` locates the script as
  `pathlib.Path(__file__).parent / "wordfreq.py"` and runs it with
  `[sys.executable, str(script), ...]` via `subprocess.run`.
- Test-name contract for AC9.2 — `test_core.py` must contain individually named tests
  whose names include these substrings: `tokeniz` (R2), `case` (R3), `top_n` (R4),
  `tie` (R5), `empty` (R8).

## Decisions (ADRs)

### ADR-1: Deliverable lives at `apps/wordfreq/`
- **Choice:** Create a top-level `apps/` directory for run deliverables; this run's
  code goes in `apps/wordfreq/`.
- **Rejected:** (a) Inside `runs/wordfreq/` — run directories hold *process*
  artifacts (spec, plan, tasks, state); mixing product code into them means the
  product's home moves every run and dies with the run's relevance. (b) Repo root —
  pollutes the pipeline scaffolding and gives no pattern for the next run's
  deliverable.
- **Consequences:** Establishes `apps/<slug>/` as the convention for future runs'
  deliverables in this sandbox. `pytest` for AC9.1 is run from `apps/wordfreq/`.

### ADR-2: Keep the spec's illustrative names: `wordfreq.py`, `-n/--top`
- **Choice:** Adopt the placeholder names from the acceptance criteria as final.
- **Rejected:** Renaming (e.g., `wf.py`, `--count`) — spec assumption 8 permits it,
  but every AC command line is written against `wordfreq.py` and `-n`; keeping them
  lets the Verifier run the ACs verbatim. Renaming buys nothing and costs traceability.
- **Consequences:** AC1.x/AC4.x/AC10.2 command lines work as written (path-prefixed
  with `apps/wordfreq/`). `argparse` gets `prog="wordfreq.py"` so usage text is stable
  regardless of invocation path.

### ADR-3: Tokenization is one compiled regex, `[^\W_]+(?:'[^\W_]+)?`, plus `str.lower()`
- **Choice:** A single module-level `re.compile` of the above pattern; `tokenize`
  is `findall` + lowercase. `[^\W_]` is "Unicode alphanumeric excluding underscore",
  matching the spec's "alphanumeric" (underscore is not alphanumeric); the optional
  group allows exactly one internal ASCII apostrophe. Case folding is `str.lower()`.
- **Rejected:** (a) `str.split()` + `strip(punctuation)` — fails AC2.3 (`co-located`
  stays one token) and mishandles internal apostrophes. (b) ASCII-only class
  `[a-zA-Z0-9...]` — silently splits accented UTF-8 words (`café` → `caf`); since
  assumption 6 commits us to UTF-8 input, tokenization should not quietly mangle it.
  (c) `str.casefold()` over `lower()` — casefold rewrites some words (`ß` → `ss`),
  producing output tokens that never appeared in the input; AC3.1 only demands
  lowercase reporting, which `lower()` satisfies with less surprise.
- **Consequences:** `don't` is one token (AC2.2); a leading/trailing apostrophe is a
  delimiter (`students'` → `students`); two internal apostrophes split
  (`rock'n'roll` → `rock'n` + `roll`) — acceptable, the spec's rule says *single*
  internal apostrophe. The regex is the one place the word rule lives (R2's
  "consistently and unambiguously").

### ADR-4: Rank with `collections.Counter` + explicit `sorted` key, not `most_common()`
- **Choice:** `top_words` builds a `Counter`, then
  `sorted(counter.items(), key=lambda p: (-p[1], p[0]))[:n]`.
- **Rejected:** `Counter.most_common(n)` — its tie order is insertion order, which
  depends on token order in the file; that is stable for one file but is not the
  spec's mandated alphabetical tie-break (AC5.1 requires `apple` before `zebra`
  even though `zebra` appears first). A heap (`heapq.nsmallest` with the same key)
  was also considered — an O(k log n) optimization the spec explicitly puts out of
  scope (no large-file performance requirement).
- **Consequences:** Deterministic, byte-identical output across runs (R5); whole-file
  in-memory processing is fine per the out-of-scope list.

### ADR-5: `argparse` for the CLI surface
- **Choice:** Standard-library `argparse` with a `positive_int` type converter.
- **Rejected:** Hand-rolled `sys.argv` parsing — argparse gives AC1.2 (usage to
  stderr, exit 2 on missing argument), `-h`, and `-n/--top` aliasing for free;
  hand-rolling re-implements tested stdlib behavior and invites drift. (Third-party
  `click` is barred outright by R10.)
- **Consequences:** Argument errors exit `2` (argparse's convention) — distinct from
  file errors' `1`. Both satisfy "non-zero" in the ACs.

### ADR-6: Errors are caught in `main()` as `(OSError, UnicodeDecodeError)` → stderr + exit 1
- **Choice:** One try/except around open-and-read in `main()`; print
  `wordfreq.py: error: <reason>` to stderr, return 1. No LBYL pre-checks
  (`os.path.exists` etc.).
- **Rejected:** Pre-flight existence/type checks before opening — racy (TOCTOU) and
  duplicates what `open()` already reports; `IsADirectoryError`,
  `FileNotFoundError`, and `PermissionError` are all `OSError` subclasses, so one
  handler covers AC7.1 and AC7.2, and `UnicodeDecodeError` covers assumption 6.
- **Consequences:** Core functions stay exception-free and pure; every anticipated
  failure path is a return code from `main()`, never a traceback (R7).

### ADR-7: Four tasks: core → {CLI shell, unit tests} → CLI tests
- **Choice:** Split the work as 01 core functions, 02 CLI shell (same file as 01),
  03 unit tests, 04 CLI/e2e tests. 02 and 03 run in parallel after 01; 04 follows 02
  (03 and 04 are also mutually parallel — disjoint files).
- **Rejected:** One monolithic task — reviewable, but forfeits parallelism and makes
  the review a single large sitting. Fully parallel impl+tests from the interface
  contract alone was also considered — rejected because each test task's acceptance
  criterion is "pytest passes", which is unverifiable by its Implementer before the
  code it tests exists; `depends_on` makes that ordering explicit instead of implicit.
- **Consequences:** Tasks 01 and 02 share a file-contact surface
  (`apps/wordfreq/wordfreq.py`) — this overlap is intentional and serialized via
  `depends_on`; no other surfaces overlap. Two separate test files exist solely so 03
  and 04 never collide.

### ADR-8 (amendment, 2026-07-08): Annotations must evaluate on Python 3.9; `main()` pinned as `Optional[Sequence[str]]`
- **Context:** Post-G1 amendment prompted by review-02 finding F1. The plan
  originally pinned `def main(argv: Sequence[str] | None = None) -> int:`. The
  environment's only interpreter is `/usr/bin/python3` = 3.9.6 (no 3.10+ on PATH);
  PEP 604 `X | None` in a parameter annotation is evaluated at def time on 3.9 and
  raises `TypeError` at import — the pinned form was uninstantiable, not a style
  choice. Task 02's implementer shipped `Optional[Sequence[str]]` and logged the
  deviation; the reviewer verified semantic equivalence (`Optional[X] ==
  Union[X, None]`, identical parameter name/default/return type, no call-site
  effect) and endorsed amending the plan.
- **Choice:** Re-pin the signature as `def main(argv: Optional[Sequence[str]] =
  None) -> int:` and adopt a run-wide rule: no PEP 604 unions in evaluated
  annotations; PEP 585 builtin/stdlib subscriptions (`list[str]`,
  `re.Pattern[str]`) are 3.9-safe and stay.
- **Rejected:** (a) `from __future__ import annotations` — works at runtime, but
  AC10.2's AST one-liner would report an import named `annotations`, which is not
  an importable stdlib module, risking a strict AC10.2 failure (task 02 notes).
  (b) Requiring a 3.10+ interpreter — environment provisioning outside the run's
  surface, for zero semantic gain over the equivalent spelling.
- **Consequences:** Plan and shipped code (commit c494808) now agree; task 04's
  implementer must not copy the stale `X | None` form. No task scope, dependency,
  or behavior changes — annotations have no runtime call-boundary effect.

### ADR-9 (amendment, 2026-07-08): AC10.2's stdlib check on Python 3.9 — spec-origin classification with mandatory site-packages rejection
- **Context:** Post-G1 amendment prompted by review-04 (finding F1 and its
  deviation assessment). This is the **second independent surfacing** of the
  Python 3.9.6-only environment breaking run text (first: review-02 F1 → ADR-8) —
  this time in task text, not the plan's interface contract. Task 04's scope for
  AC10.2 read "assert each is in `sys.stdlib_module_names`", an attribute added in
  Python 3.10 and absent on 3.9.6 (`AttributeError`, confirmed by the implementer).
  The implementer substituted a 3.9-compatible helper — builtin names +
  `importlib.util.find_spec` origin classification against
  `sysconfig.get_paths()["stdlib"]` — and logged the deviation. Review-04 validated
  the *approach* as the right 3.9 equivalent but found the as-shipped version
  strictly weaker (F1, blocking): on this machine the interpreter's prefix
  `site-packages` is a **subdirectory** of the sysconfig stdlib directory
  (`.../Python3.framework/Versions/3.9/lib/python3.9/site-packages/`, where `pip`
  and `setuptools` resolve), so a bare stdlib-dir containment check classifies
  those third-party imports as stdlib — exactly the R10 violation class AC10.2
  exists to detect, and one `sys.stdlib_module_names` would have caught.
- **Requirement vs. mechanism:** the spec is not defective and is unchanged.
  AC10.2's wording — the AST one-liner "lists only modules present in the Python 3
  standard library (no third-party package imports)" — **is the requirement**;
  `sys.stdlib_module_names` was only ever the task-text *mechanism* for asserting
  it, and only that mechanism was version-specific.
- **Choice:** Sanction the following as the run's 3.9-compatible stdlib check. A
  module root name is stdlib iff **any** of:
  1. `name in sys.builtin_module_names`; or
  2. `importlib.util.find_spec(name)` yields a spec whose `origin` is
     `"built-in"` or `"frozen"`; or
  3. the spec's `origin` is a file path under `sysconfig.get_paths()["stdlib"]`
     **and** the resolved path contains no `site-packages` (or `dist-packages`)
     component — i.e. `"site-packages" in Path(origin).resolve().parts` (and
     likewise `dist-packages`) rejects the module *before* the containment check
     can accept it.
  The site-packages rejection in (3) is mandatory, not defensive garnish: without
  it the check is unsound on any layout where site-packages nests inside the
  stdlib directory, as it does here.
- **Rejected:** (a) `sys.stdlib_module_names` as written in the task — does not
  exist on 3.9.6, the environment's only interpreter (same rejection as ADR-8's
  "require 3.10+"). (b) Vendoring a hard-coded frozenset of 3.10's stdlib names
  into the test — a drifting, unverifiable copy of interpreter internals with no
  authority on the 3.9 interpreter actually running the code. (c) Stdlib-dir
  containment **without** the site-packages rejection (the as-shipped version) —
  review-04 F1: admits any third-party package installed in the prefix
  site-packages. (d) Excluding only the `sysconfig` `purelib`/`platlib` paths
  instead of matching path components — insufficient on this machine, where
  `purelib` (`/Library/Python/3.9/site-packages`) is a *different* directory from
  the framework's own site-packages where pip/setuptools live (review-04 F1).
- **Consequences:** Task 04's implementer is fixing F1 in
  `apps/wordfreq/test_cli.py` against this mechanism (round 2, in flight); the
  reviewer verifies the fixed helper against this ADR, not the stale task-text
  mechanism. Any future stdlib-membership assertion in this run uses this
  mechanism. Review-04 F2 (`ImportFrom` nodes with `level >= 1` escape root
  collection) remains minor/optional — a relative import cannot resolve to a
  third-party package in a top-level single-file script; asserting
  `node.level == 0` may be folded into the same fix but is not required by this
  ADR. No task scope, dependency, or deliverable-code changes; `wordfreq.py` is
  untouched.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 — CLI file input | 02-cli-shell, 04-cli-tests |
| R2 — word extraction rule | 01-core-logic, 03-unit-tests |
| R3 — case-insensitive counting | 01-core-logic, 03-unit-tests |
| R4 — ranking and top-N | 01-core-logic, 02-cli-shell, 03-unit-tests, 04-cli-tests |
| R5 — deterministic tie-breaking | 01-core-logic, 03-unit-tests, 04-cli-tests |
| R6 — output format | 01-core-logic (format_lines), 02-cli-shell (stdout wiring), 03-unit-tests, 04-cli-tests |
| R7 — error handling | 02-cli-shell, 04-cli-tests |
| R8 — empty/wordless input | 01-core-logic, 02-cli-shell, 03-unit-tests, 04-cli-tests |
| R9 — automated test coverage | 03-unit-tests, 04-cli-tests |
| R10 — single file, stdlib only | 01-core-logic, 02-cli-shell (both bound by it), 04-cli-tests (verifies AC10.1/AC10.2) |

## Risks

- **`import wordfreq` fails under pytest** if pytest's rootdir/`sys.path` insertion
  behaves unexpectedly (e.g., run from repo root instead of `apps/wordfreq/`).
  *Early signal:* task 03's first `pytest` run raises `ImportError`. *Mitigation:*
  AC9.1 specifies running from the deliverable's directory; if it still fails, task
  03 may add an empty `apps/wordfreq/conftest.py` (test infrastructure, excluded from
  AC10.1's single-file count — record the addition in the task's notes).
- **`pytest` is not installed** in the verification environment — the repo declares
  no dependencies, and R9 mandates pytest as a dev-time tool (it is not imported by
  `wordfreq.py`, so R10 is unaffected). *Early signal:* `pytest: command not found`
  on task 03's first run. *Mitigation:* escalate to Orchestrator as environment
  provisioning, not a code change.
- **Byte-exactness of AC6.1** can be broken by using `print()` (adds its own
  newlines) or by Windows-style line endings. *Early signal:* task 04's exact-bytes
  test fails while semantic tests pass. *Mitigation:* the interface contract mandates
  `sys.stdout.write(format_lines(...))` with `\n` embedded by `format_lines`.
- **Serialized critical path (01 → 02 → 04)** — if 01 slips, three tasks queue behind
  it. *Early signal:* 01 exceeding one focused session. *Mitigation:* 01 is
  deliberately the smallest task (three pure functions, one regex); 03 detaches from
  the critical path after 01 merges.
- **Tokenization edge cases outside the ACs** (typographic apostrophe U+2019, unicode
  digits) could trigger review debate. *Guardrail:* ADR-3 fixes the rule; behavior
  not pinned by an AC follows the regex as written — Reviewer findings against
  non-spec'd behavior should cite a requirement or be rebutted in task notes.
- **Python 3.9-only environment (twice-realized; assume further latent instances)** —
  the run's text has now twice specified 3.10+ constructs that fail on the 3.9.6
  interpreter: PEP 604 union annotations (`TypeError` at import; review-02 F1 →
  ADR-8) and `sys.stdlib_module_names` (`AttributeError`; review-04 → ADR-9).
  *Early signal:* `TypeError: unsupported operand type(s) for |` or
  `AttributeError` on a `sys`/stdlib attribute at first execution. *Mitigation:*
  ADR-8's rule (`Optional[...]`/`Union[...]` spellings only) and ADR-9's sanctioned
  stdlib-check mechanism; more generally, treat any construct or API not verified
  on 3.9 as suspect, and note that 3.9-compatible *substitutes* need equivalence
  scrutiny, not just runnability — review-04 F1 shows a substitute can execute
  cleanly yet be strictly weaker (site-packages nested under the sysconfig stdlib
  dir defeats naive path-containment checks).
