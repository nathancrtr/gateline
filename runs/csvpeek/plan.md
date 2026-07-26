# Technical Plan: CSV Peek CLI

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     BUDGET: reference spec requirements by number, never re-quote them. -->

> **AMENDED 2026-07-26 (post-G1).** ADR-10 (end of Decisions) supersedes ADR-2
> in full and voids ADR-3's premise: `python3` and `pytest` **are present and
> verified** on this host — provisioning is not a precondition and never was
> one here. ADR-10 also retires the withdrawn M2 motivation, confirms the
> four-task cut stands for this run (with the disjoint-surface alternative
> recorded for future runs), and records a pre-existing repo-root pytest
> collection condition for the Verifier. Read ADR-10 before relying on the
> Approach section's "Binding environment finding" paragraph or the first two
> Risks bullets — those are superseded. Nothing else in this plan changed.

## Approach

Greenfield deliverable at `apps/csvpeek/`, following the `apps/<slug>/` convention
established by wordfreq (and reused by mdtoc and dupefind). Three files:

```
apps/csvpeek/
  csvpeek.py        # the entire CLI — the single source file mandated by R12
  test_core.py      # unit tests importing csvpeek's pure functions (R11)
  test_cli.py       # end-to-end tests invoking the script via subprocess (R11)
```

`csvpeek.py` is internally layered into **pure core functions** (delimiter
detection, parsing, per-column profiling, report formatting — no I/O, no `sys`)
and a **CLI shell** (`main()` — argparse, file reading, error handling, exit
codes). The split lives inside one file, satisfying R12 while making R11's
"verifiable independent of shell invocation" trivially true.

Data flow: `main()` parses args → reads the file as UTF-8 → `parse_csv()` sniffs
the delimiter (R4) and splits the text into header + data rows (R2, R3) →
`format_report()` composes `column_values()` (ragged normalization, R8),
`infer_type()` (R5), `count_missing()` (R6), and `top_values()` (R7) into one
deterministic plain-text report → `main()` writes it to stdout and returns an
exit code. All anticipated failures (missing path, directory, unreadable, bad
UTF-8) are caught in `main()` and reported as one stderr line with exit 1 (R9);
empty and header-only files are success paths (R10).

**Binding environment finding (ADR-2):** the machine this run executes on is
built from `deploy/Dockerfile` (`node:24-slim` + git) and has **no Python
interpreter and no pytest** — confirmed by direct inspection of `/usr/bin`,
`/bin`, `/usr/local/bin`, and the absence of `/usr/lib/python3*`. Every
acceptance criterion that runs `python3` or `pytest` is unexecutable here until
the environment is provisioned. Provisioning is an ops/human action outside this
run's write surface; implementation tasks must not be dispatched before it lands.

Work is cut into four tasks: core functions (01), CLI shell (02, same file, so
it depends on 01), unit tests (03, parallel with 02), CLI/e2e tests (04, after
02, parallel with 03). Rationale in ADR-9.

## Interface contracts

Binding. Implementers of tasks 03 and 04 write tests against exactly these
signatures and behaviors; do not invent others. All annotations use 3.9-safe
spellings (ADR-3): `Optional[...]`/`Union[...]` from `typing`, never `X | None`;
PEP 585 subscriptions (`list[str]`, `tuple[str, int]`) are fine.

### Module: `apps/csvpeek/csvpeek.py`

```python
"""Module docstring: what csvpeek reports (rows, columns, per-column type,
missing count, common values) and the blank rule: a field is blank iff it is
exactly '' after CSV parsing (spec Assumptions)."""

TOP_N: int  # = 5 — the bound on reported common values per column (AC7.2)

def detect_delimiter(text: str) -> str:
    """Delimiter of the CSV in `text`, via csv.Sniffer().sniff(text).delimiter
    over the whole text. Returns ',' when text is empty or Sniffer raises
    csv.Error (R4 + spec fallback assumption). Never raises."""

def parse_csv(text: str) -> tuple[list[str], list[list[str]]]:
    """(header, data_rows). Records come from csv.reader over
    io.StringIO(text, newline='') with delimiter=detect_delimiter(text).
    The first record is the header; all remaining records are data rows,
    kept exactly as csv.reader yields them (ragged rows NOT normalized
    here — that is column_values' job). '' -> ([], []) (R2, R3, R8, R10)."""

def column_values(header: list[str], rows: list[list[str]]) -> list[list[str]]:
    """One list per header column, aligned to the rows: result[i][r] is row
    r's field for column i, or '' when row r has fewer fields (R8 + spec
    ragged assumption); fields beyond len(header) are ignored.
    len(result) == len(header); each inner list has len(rows) entries."""

def infer_type(values: list[str]) -> str:
    """'integer' | 'float' | 'string', judged over the non-blank values only
    (blank == '' exactly; AC6.2). 'integer' iff every non-blank value parses
    via int(); 'float' iff every non-blank value parses via float() and at
    least one does not parse via int(); otherwise 'string'. A column with no
    non-blank values is 'string' (ADR-5; supports AC10.2)."""

def count_missing(values: list[str]) -> int:
    """Number of entries exactly equal to '' (R6)."""

def top_values(values: list[str], n: int = TOP_N) -> list[tuple[str, int]]:
    """At most `n` (value, count) pairs over the non-blank values, ordered by
    count descending then value ascending (lexicographic on the string, even
    for numeric-looking values) (R7 + spec tie-break assumption). [] when
    there are no non-blank values."""

def format_report(header: list[str], rows: list[list[str]]) -> str:
    """The full plain-text report in the exact format below, composing
    column_values/infer_type/count_missing/top_values (R2–R7, R10)."""

def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the process exit code; never raises for anticipated errors (R9)."""

if __name__ == "__main__":
    raise SystemExit(main())
```

### Report format (exact — what byte-exact tests assert)

```
Rows: <len(rows)>
Columns: <len(header)>

Column: <name>
  Type: <integer|float|string>
  Missing: <count>
  Common: <v1> (<c1>), <v2> (<c2>)[, ...]
```

- The two summary lines always appear, in that order (AC10.1: a 0-byte file
  produces exactly `Rows: 0\nColumns: 0\n` and nothing else).
- One block per header column, in header order (AC3.1), each preceded by one
  blank line. Column names are printed verbatim.
- `Common:` lists `top_values()` output in its order; when it is empty
  (no non-blank values), the line is exactly `  Common: (none)`.
- Every line ends with `\n`; no trailing blank line after the last block.
- Values are printed verbatim — no quoting or escaping (human-readable report
  per the spec's output assumption, not a machine format).

### CLI contract (what `test_cli.py` builds against)

- Invocation: `python3 csvpeek.py FILE` (path-prefixed from repo root:
  `python3 apps/csvpeek/csvpeek.py FILE`). `FILE` is the only argument — no
  flags of any kind (spec Assumptions / Out of scope).
- argparse with `prog="csvpeek.py"` so usage text is stable regardless of
  invocation path. Missing argument → argparse's own usage/error on stderr,
  exit 2 (AC1.2).
- Exit codes: `0` success, including empty and header-only inputs (R10);
  `2` argument errors (argparse's convention); `1` file errors — path missing,
  path is a directory, permission denied, or invalid UTF-8 (R9, ADR-7).
- File read: `open(path, encoding="utf-8", newline="")` — `newline=""` per the
  csv module docs so quoted embedded newlines survive intact; one try/except
  catching `(OSError, UnicodeDecodeError)`; on failure print exactly one line
  `csvpeek.py: error: <reason>` to stderr — never a traceback — and return 1
  (AC9.1, AC9.2).
- Success output: exactly `format_report(*parse_csv(text))` written via
  `sys.stdout.write` (not `print` — byte-exact tests). Nothing else is ever
  written to stdout.

### Test-layout contract

- Both test files live in `apps/csvpeek/` beside `csvpeek.py`; `pytest` run
  from that directory (AC11.1) discovers both. Tests import the module as
  `import csvpeek` (no `__init__.py` files). `test_cli.py` locates the script
  as `pathlib.Path(__file__).parent / "csvpeek.py"` and runs it with
  `subprocess.run([sys.executable, str(script), ...], capture_output=True)`.
- Test-name contract for AC11.2 — collected test names must include these
  substrings: `row_count` (R2), `columns` (R3), `delimiter` (R4), `type` (R5),
  `missing` (R6), `common` (R7) in `test_core.py`; `error` (R9) in
  `test_cli.py`. Collection from `apps/csvpeek/` spans both files.

## Decisions (ADRs)

### ADR-1: Deliverable at `apps/csvpeek/`, three files, pure-core/CLI-shell split
- **Choice:** Follow the layout proven by wordfreq (its ADR-1) verbatim:
  `apps/csvpeek/{csvpeek.py, test_core.py, test_cli.py}`; pure functions and
  `main()` layered inside the one source file.
- **Rejected:** (a) Code under `runs/csvpeek/` — run dirs hold process
  artifacts, not product. (b) A single test file — forfeits the 03/04 task
  parallelism that two disjoint test files buy.
- **Consequences:** `pytest` for AC11.1 runs from `apps/csvpeek/`; AC12.1's
  one-source-file count excludes `test_*.py` (per the AC's own carve-out).

### ADR-2: The execution environment has no Python — provision before dispatch, never design around it
- **Choice:** Treat provisioning of `python3` (any version ≥ 3.9) and `pytest`
  as a **blocking precondition** for dispatching task 01. Verified by direct
  filesystem inspection: this machine is built from `deploy/Dockerfile`
  (`node:24-slim` + git + curl + claude CLI); there is no `python3` in
  `/usr/bin`, `/bin`, or `/usr/local/bin`, no `/usr/lib/python3*`, and no
  pytest. Recommended remedy (ops/human action, outside this run's write
  surface): add `python3 python3-pytest` to the Dockerfile's `apt-get install`
  line and redeploy, or `apt-get install` them on the running machine. The
  first implementer to run verifies `python3 --version` and
  `python3 -m pytest --version` before writing code, and escalates on failure.
- **Rejected:** (a) Porting the tool or its checks to Node (which is present) —
  violates R12 and the brief's constraints outright. (b) Planning around it
  with unverified mechanisms and hoping — wordfreq's ADR-8/ADR-9 history shows
  every environment assumption baked into run text unverified costs a full
  review round downstream. (c) Amending `deploy/Dockerfile` inside this run —
  outside `runs/csvpeek/` + `apps/csvpeek/`, and framework surface belongs to
  the maintainer, not a run.
- **Consequences:** The G1 human must arrange provisioning (or confirm it
  happened) as part of approving this plan. Implementers who hit
  `python3: command not found` or `pytest: command not found` stop and
  escalate as environment provisioning — never work around (no Node rewrites,
  no "skipped" acceptance tests).

### ADR-3: Version-conservative Python until the interpreter version is confirmed in-run
- **Choice:** Because the interpreter does not exist yet (ADR-2), its version
  cannot be confirmed now. All pinned code uses 3.9-safe spellings: `Optional[
  ...]`/`Union[...]`, never PEP 604 `X | None` in evaluated annotations; PEP
  585 subscriptions are fine. The AC12.2-style stdlib check in `test_cli.py`
  uses `sys.stdlib_module_names` when present (3.10+), else falls back to the
  mechanism wordfreq's ADR-9 sanctioned: a module root is stdlib iff it is in
  `sys.builtin_module_names`, or its `importlib.util.find_spec` origin is
  `"built-in"`/`"frozen"`, or its origin is a path under
  `sysconfig.get_paths()["stdlib"]` **and** the resolved path contains no
  `site-packages`/`dist-packages` component (the rejection is mandatory — see
  wordfreq review-04 F1). Task 01's implementer records `python3 --version` in
  task notes as environment evidence.
- **Rejected:** (a) Assuming the Debian-packaged interpreter will be 3.11+ —
  probably true for `node:24-slim`'s base, but unverifiable today, and
  unverified pins are exactly what cost wordfreq two review rounds.
  (b) 3.9-only mechanisms unconditionally — forfeits the simpler, stronger
  3.10+ API when it is present.
- **Consequences:** Slightly more verbose annotations and one dual-path test
  helper. If task 01 confirms ≥ 3.10, later tasks still follow these pins
  unless the plan is amended.

### ADR-4: Parse with `csv.reader` over `StringIO`; Sniffer on the whole text with comma fallback; ragged normalization isolated in `column_values`
- **Choice:** `detect_delimiter` = `csv.Sniffer().sniff(text)` over the entire
  file text, `','` on `csv.Error` or empty input (R4 + spec assumption).
  `parse_csv` = `csv.reader(io.StringIO(text, newline=''), delimiter=...)`;
  first record is the header (spec header assumption). Ragged handling (pad
  short rows with `''`, ignore extras) lives only in `column_values`.
- **Rejected:** (a) `csv.DictReader` — buries the ragged policy in
  `restkey`/`restval`, and collapses duplicate header names into one key;
  list-based parsing preserves order and duplicates naturally. (b) Splitting
  lines and `str.split(delimiter)` — breaks quoted fields and quoted embedded
  newlines that the csv module handles for free. (c) Sniffing only a bounded
  prefix — adds a knob with no requirement behind it; large-file performance
  is out of scope per the spec.
- **Consequences:** Row count counts CSV *records*, so a quoted field
  containing a newline counts once (correct, not line-count). Duplicate header
  names yield separate column blocks. On files where Sniffer guesses a
  delimiter the ACs don't cover, behavior follows Sniffer as-is — the spec
  puts anything beyond stock `csv.Sniffer` out of scope.

### ADR-5: Type inference = `int()`/`float()` parseability over non-blank values; empty column → `string`
- **Choice:** A value is integer-parseable iff `int(value)` succeeds,
  float-parseable iff `float(value)` succeeds; `infer_type` applies the
  all-non-blank rule from the interface contract. A column with no non-blank
  values reports `string`, the fallback category.
- **Rejected:** (a) A hand-rolled literal regex — stricter, but invents a
  literal grammar the spec never defines; AC5.x's own language is
  "integer-/float-parseable", which is precisely `int()`/`float()`.
  (b) A fourth `unknown` type for empty columns — the spec's Assumptions fix
  exactly three categories.
- **Consequences:** `" 3 "`, `"+3"`, `"1_000"` classify as integer; `"nan"`,
  `"inf"`, `"1e3"` classify as float — accepted, they *are* parseable. Blanks
  never influence type (AC6.2). Behavior not pinned by an AC follows these
  rules as written; Reviewer findings against it should cite a requirement.

### ADR-6: Rank common values with `Counter` + explicit `sorted` key, not `most_common()`
- **Choice:** `top_values` builds a `Counter` over non-blank values, then
  `sorted(counter.items(), key=lambda p: (-p[1], p[0]))[:n]`.
- **Rejected:** `Counter.most_common(n)` — its tie order is insertion order,
  not the spec-mandated ascending-value tie-break (same rejection as wordfreq
  ADR-4). A heap was likewise considered and rejected as an optimization with
  no requirement behind it.
- **Consequences:** Deterministic, byte-identical reports across runs. Ties
  order lexicographically on the string value even when values look numeric
  (`'10'` sorts before `'2'`) — consistent with the spec's "ascending
  alphabetically".

### ADR-7: Errors caught in `main()` as `(OSError, UnicodeDecodeError)` → stderr + exit 1; input read as UTF-8
- **Choice:** One try/except around open-and-read; on failure print
  `csvpeek.py: error: <reason>` (one line, stderr), return 1. Files are read
  with `encoding="utf-8", newline=""`. No LBYL pre-checks.
- **Rejected:** (a) Pre-flight `os.path` checks — racy (TOCTOU) and redundant:
  `FileNotFoundError`, `IsADirectoryError`, `PermissionError` are all
  `OSError` subclasses, so one handler covers AC9.1/AC9.2. (b) Reading with
  `errors="replace"` or latin-1 to never fail on encoding — a profiling tool
  that silently mangles the very values it reports is worse than one that
  fails clearly; the spec is silent on encoding, so this plan resolves it as
  UTF-8-or-error (flagged here for the G1 human).
- **Consequences:** A directory path exits 1 with a readable message (AC9.2);
  a non-UTF-8 file exits 1 the same way. Core functions stay exception-free.

### ADR-8: One pinned, exact plain-text report format
- **Choice:** The exact format in "Report format" above — two summary lines
  plus one four-line block per column.
- **Rejected:** (a) An aligned/tabular layout — prettier, but width depends on
  data, making byte-exact tests brittle for no requirement. (b) Echoing the
  detected delimiter — not required by R2–R7; noise in the contract surface.
- **Consequences:** `test_cli.py` can assert full stdout byte-exactly; any
  format change is a plan amendment, not an implementer choice.

### ADR-9: Four tasks: core → {CLI shell, unit tests} → CLI tests
- **Choice:** 01 core functions, 02 CLI shell (same file, `depends_on` 01),
  03 unit tests (parallel with 02), 04 CLI/e2e tests (after 02, parallel
  with 03). Identical topology to wordfreq's ADR-7, which executed cleanly.
- **Rejected:** (a) One monolithic task — forfeits parallelism and makes
  review a single large sitting. (b) Fully parallel impl+tests from the
  interface contract alone — each test task's acceptance is "pytest passes",
  unverifiable before the code under test exists.
- **Consequences:** Tasks 01 and 02 intentionally share
  `apps/csvpeek/csvpeek.py`, serialized via `depends_on`; no other surfaces
  overlap. Two test files exist solely so 03 and 04 never collide.

### ADR-10 (amendment, 2026-07-26): Environment finding corrected; interpreter pin re-grounded; motivation and task cut re-based after the G1 decline note
- **Context:** Post-G1 amendment. Three things changed after this plan was
  written. (1) The environment finding in ADR-2 is **false on the host this
  run actually executes on**: it described a different execution environment
  (a `node:24-slim` container). Verified on this host today (macOS 26.3,
  arm64): `python3` on PATH is Homebrew `/opt/homebrew/bin/python3`, Python
  3.14.6, with pytest 9.1.1 available via `python3 -m pytest`; a second
  interpreter `/usr/bin/python3` is Python 3.9.6 **without** pytest; the
  sibling suites pass per-directory (`apps/wordfreq` 27, `apps/mdtoc` 36,
  `apps/dupefind` 38). Corroborated in-run: task 01's implementation is
  committed and its acceptance tests executed and passed on this machine.
  (2) The gate owner's G1 decline note retired the M2 toy-run motivation, and
  it is settled — later runs (mdtoc, dupefind) already exercised
  orchestrator-driven G0–G3 dispatch. (3) G1 was subsequently approved on
  this plan and implementation began, which bounds what this amendment may
  change.
- **Choice:**
  1. **Supersede ADR-2 entirely.** No provisioning precondition exists or is
     needed; no gate decision hinges on arranging Python. The Approach
     section's "Binding environment finding" paragraph and the first two
     Risks bullets are superseded by this ADR. The Reviewer of task 01 must
     not treat "environment unprovisioned" as a live plan premise — the code
     under review demonstrably ran here.
  2. **Keep ADR-3's 3.9-safe pins, on new grounds.** ADR-3's premise ("the
     interpreter does not exist yet, so its version cannot be confirmed") is
     void; the pin is now a *verified* choice, not a hedge. The plan targets:
     code that runs under both verified interpreters — `/usr/bin/python3`
     (3.9.6) and PATH `python3` (3.14.6) — with tests executed by whichever
     `python3` is on PATH (today: 3.14.6, the only one with pytest);
     `test_cli.py` invokes the script via `sys.executable`, so tests and CLI
     always use the same interpreter. All ADR-3 spelling rules and the
     dual-path stdlib check stand unchanged; task 01's committed code already
     complies, as do `apps/mdtoc` and `apps/dupefind` (their ADR-8).
  3. **Re-base the motivation.** csvpeek stands on its own merits: a small,
     genuinely useful stdlib CLI in the established `apps/<slug>/` family,
     built to the G0-approved spec. No remaining decision in this plan rests
     on the M2 rationale; where prior text leaned on it (part of ADR-9's
     framing), this ADR is the corrected basis.
  4. **The four-task cut stands as-is for this run.** ADR-9's topology (01
     and 02 sharing `csvpeek.py`, serialized by `depends_on`) was partly
     justified by the now-withdrawn rationale, and the repo has since
     converged on a better cut — three tasks with fully disjoint file-contact
     surfaces (mdtoc ADR-7, dupefind ADR-7, now convention). It is retained
     here **for timing, not on merit**: task 01 is committed and in review,
     tasks 02–04 are seeded in `state.yaml`, and re-cutting mid-implementation
     would cost more than the topology is worth. Future runs should inherit
     the three-task disjoint-surface convention, not this run's shape.
  5. **Known pre-existing condition (for the Verifier):** `python3 -m pytest
     apps` from the repo root fails at collection because `apps/*/test_core.py`
     and `apps/*/test_cli.py` share basenames with no `__init__.py`.
     Per-directory runs all pass, which is why `CLAUDE.md` documents
     per-directory invocation and why AC11.1 runs pytest from the
     deliverable's directory. `apps/csvpeek/` uses the same file names and so
     extends this condition; that is the established convention, **not new
     breakage**. Verification command: `cd apps/csvpeek && python3 -m pytest`.
- **Rejected:**
  - *Re-cutting to the three-task disjoint-surface topology now* — right on
    merit, wrong in time: it would orphan a committed, in-review task and the
    seeded task list in `state.yaml` for zero product benefit. Rejected for
    timing only; recorded so the next run inherits the better convention.
  - *Relaxing to 3.14-era spellings (PEP 604 unions, unconditional
    `sys.stdlib_module_names`)* since PATH `python3` is 3.14.6 — it would
    fork the remaining tasks' style from the already-committed task 01 core
    and from the sibling apps, and would break under `/usr/bin/python3`
    (3.9.6), a real interpreter users on this host plausibly invoke.
  - *Renaming csvpeek's test files to unique basenames* to make repo-root
    collection work — diverges from all three sibling apps to fix a condition
    the repo has already accepted and documented; a repo-wide fix (e.g.
    `__init__.py` files or a root pytest config) is framework surface,
    outside this run's write scope.
- **Consequences:** Tasks 02–04 proceed with no environment precondition and
  unchanged interface contracts, spelling rules, and task files. The 3.9-safe
  pin is binding and verified; ADR-3's dual-path stdlib check will take its
  `sys.stdlib_module_names` branch under the PATH interpreter. The Verifier
  runs pytest per-directory and does not report repo-root collection failure
  as a csvpeek defect. The gate human acknowledges this amendment at the next
  gate (G2); items to weigh are listed in the amendment header note.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 — CLI file input | 02-cli-shell, 04-cli-tests |
| R2 — row count | 01-core-logic, 03-unit-tests, 04-cli-tests |
| R3 — column identification | 01-core-logic, 03-unit-tests, 04-cli-tests |
| R4 — delimiter detection | 01-core-logic, 03-unit-tests, 04-cli-tests |
| R5 — type inference | 01-core-logic, 03-unit-tests, 04-cli-tests (exact-report test) |
| R6 — missing-value counting | 01-core-logic, 03-unit-tests, 04-cli-tests (exact-report test) |
| R7 — common-value reporting | 01-core-logic, 03-unit-tests, 04-cli-tests (exact-report test) |
| R8 — ragged-row tolerance | 01-core-logic, 03-unit-tests, 04-cli-tests |
| R9 — error handling | 02-cli-shell, 04-cli-tests |
| R10 — empty/header-only files | 01-core-logic (semantics), 02-cli-shell (exit codes), 03-unit-tests, 04-cli-tests |
| R11 — automated test coverage | 03-unit-tests, 04-cli-tests |
| R12 — single file, stdlib only | 01-core-logic, 02-cli-shell (both bound), 04-cli-tests (verifies AC12.1/AC12.2) |

## Risks

- **Environment unprovisioned at dispatch (headline risk; see ADR-2).** No
  `python3` or `pytest` exists on this machine today; every acceptance test in
  every task is unexecutable until that changes. *Early signal:*
  `python3: command not found` on task 01's mandated pre-check. *Mitigation:*
  ADR-2 — G1 approval includes arranging provisioning; implementers escalate,
  never improvise.
- **Interpreter version unknown until provisioned** — a latent 3.10+-only
  construct could slip in (wordfreq hit this twice). *Early signal:*
  `TypeError`/`AttributeError` at first execution. *Mitigation:* ADR-3's
  3.9-safe pins and dual-path stdlib check; task 01 records the actual version.
- **`csv.Sniffer` misdetection** on inputs outside AC4.1/AC4.2 (e.g., data
  rows dense with a rival punctuation character). *Early signal:* a surprising
  column count in a review fixture. *Guardrail:* the spec scopes sniffing to
  stock `csv.Sniffer`; behavior beyond the two AC'd cases follows Sniffer
  as-is, and findings against it must cite a requirement.
- **`import csvpeek` fails under pytest** if rootdir/`sys.path` insertion
  misbehaves. *Early signal:* task 03's first `pytest` run raises
  `ImportError`. *Mitigation:* AC11.1 runs from `apps/csvpeek/`; if it still
  fails, task 03 may add an empty `apps/csvpeek/conftest.py` (test
  infrastructure, outside AC12.1's count — record in task notes).
  (Pre-authorized; the same risk in wordfreq never materialized.)
- **Byte-exactness broken by `print()`** (adds its own newlines). *Early
  signal:* task 04's exact-report test fails while semantic tests pass.
  *Mitigation:* the CLI contract mandates `sys.stdout.write(format_report(...))`
  with all `\n` embedded by `format_report`.
- **Serialized critical path (01 → 02 → 04)** — if 01 slips, two tasks queue
  behind it. *Early signal:* 01 exceeding one focused session. *Mitigation:*
  01 is pure functions with no I/O; 03 detaches from the critical path once
  01 merges.
