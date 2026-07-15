# Specification: CSV Peek

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion. -->

## Context
`apps/` already holds three prior single-file, stdlib-only CLIs with the same shape
this brief asks for (`wordfreq`, `mdtoc`, `dupefind`): one `.py` file, `argparse`,
non-zero exit + stderr message (never a traceback) on bad input, and `pytest` tests
alongside it. There is no existing `apps/csvpeek/` — this is greenfield within that
established convention, not a conflict with it. The brief's constraints (stdlib only,
single file, file-path argument, pytest) are directly actionable as written; no
brief/repo mismatch was found. The brief names four things a "peek" must surface —
row count, columns, per-column data type, and common values per column — none of
which are defined further in the brief; each is made concrete below and in
Assumptions.

## Requirements

### R1 — CLI file input
The tool must run as a Python 3 script invoked from the shell, taking a required
positional argument: the path to a CSV file to inspect.
**Acceptance criteria:**
- [ ] AC1.1 — Running `python3 csvpeek.py path/to/existing.csv` (an existing, readable CSV file) exits with status code 0.
- [ ] AC1.2 — Running `python3 csvpeek.py` with no file argument exits with a non-zero status code and prints a usage/error message to stderr.

### R2 — Row count
The tool must report how many data rows the file contains, not counting the header
row (see the header ASSUMPTION below).
**Acceptance criteria:**
- [ ] AC2.1 — Given a CSV with one header line and 5 data rows, the output reports the row count as 5 (the header row is excluded from that count).
- [ ] AC2.2 — Given a CSV with a header line and 0 data rows, the output reports the row count as 0 and exits 0 (not an error; see R10).

### R3 — Column identification
The tool must report the set and left-to-right order of columns, named from the
header row.
**Acceptance criteria:**
- [ ] AC3.1 — Given header `name,age,city`, the output lists the three columns `name`, `age`, `city`, in that order.

### R4 — Delimiter detection
The tool must not assume comma is always the delimiter; it must use `csv.Sniffer`
(per the brief's explicit allowance) to detect the delimiter actually in use.
**Acceptance criteria:**
- [ ] AC4.1 — Given a semicolon-delimited file with header `name;age;city` and matching data rows, the output identifies 3 columns (`name`, `age`, `city`), not one column containing literal semicolons.
- [ ] AC4.2 — Given a standard comma-delimited file, the output identifies the correct comma-delimited columns (baseline case still works).

### R5 — Per-column type inference
For each column, the tool must report an inferred data type describing the values
it holds.
**Acceptance criteria:**
- [ ] AC5.1 — A column whose every non-blank value is a base-10 integer literal (e.g. `1`, `2`, `-3`) is reported with type `integer`.
- [ ] AC5.2 — A column with values `1.5`, `2`, `3` (at least one non-integer numeric value, the rest integer-parseable) is reported with type `float`.
- [ ] AC5.3 — A column containing any value that is neither integer- nor float-parseable (e.g. `a`, `b`, `c`, or the mixed set `1`, `a`, `3`) is reported with type `string`.

### R6 — Missing-value counting
For each column, the tool must report how many rows have a blank value in that
column.
**Acceptance criteria:**
- [ ] AC6.1 — A column with values `1`, ``, `3` (one empty field) reports a missing/blank count of 1 for that column.
- [ ] AC6.2 — That same column (`1`, ``, `3`) is still reported with type `integer` per R5 — the blank value does not, by itself, force the column's type down to `string`.

### R7 — Common-value reporting
For each column, the tool must report which values occur most often, per the
brief's "what the common values look like."
**Acceptance criteria:**
- [ ] AC7.1 — A column with 10 occurrences of `x`, 5 of `y`, 1 of `z` reports `x` as its most frequent value (count 10), ranked ahead of `y` and `z`.
- [ ] AC7.2 — A column with more than 5 distinct values lists at most 5 of them in the output (bounded top-N, not a full value histogram).

### R8 — Ragged-row tolerance
A CSV where some data row has a different number of fields than the header must
not crash the tool.
**Acceptance criteria:**
- [ ] AC8.1 — Given a header with 3 columns and one data row with only 2 fields, the tool exits 0 without a traceback, and that row is included in the row count reported under R2.

### R9 — Error handling for invalid input
The tool must fail clearly, not crash, when the given path does not exist or is
not a readable file.
**Acceptance criteria:**
- [ ] AC9.1 — Running `python3 csvpeek.py does-not-exist.csv` exits with a non-zero status code and prints a human-readable error message to stderr (not a raw Python traceback).
- [ ] AC9.2 — Running `python3 csvpeek.py <path-to-a-directory>` exits with a non-zero status code and prints a human-readable error message to stderr.

### R10 — Empty and header-only file handling
An empty file, and a file containing only a header with no data rows, are valid
inputs, not error conditions.
**Acceptance criteria:**
- [ ] AC10.1 — Running against a 0-byte file exits with status code 0 and reports 0 rows and 0 columns.
- [ ] AC10.2 — Running against a file containing only a header line (no data rows) exits with status code 0, lists the header's columns by name, reports 0 data rows, and does not raise/traceback attempting type inference on a column with no values.

### R11 — Automated test coverage
The tool's core logic (row/column parsing, delimiter detection, type inference,
missing-value counting, common-value ranking) must be verifiable independent of
manual shell invocation.
**Acceptance criteria:**
- [ ] AC11.1 — Running `pytest` from the deliverable's directory exits with status code 0.
- [ ] AC11.2 — `pytest --collect-only` lists distinct, individually named test cases exercising each of: row counting (R2), column identification (R3), delimiter detection (R4), type inference (R5), missing-value counting (R6), common-value ranking (R7), and error handling (R9).

### R12 — Implementation constraints
The delivered tool must be a single Python 3 source file using only the standard
library, per the brief's explicit constraints.
**Acceptance criteria:**
- [ ] AC12.1 — The delivered CLI logic is contained in exactly one `.py` file (test files excluded from this count).
- [ ] AC12.2 — `python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" csvpeek.py` lists only modules present in the Python 3 standard library.

## Assumptions
- **ASSUMPTION:** The brief does not say whether input files have a header row → resolved as: the first row is always treated as a header of column names; headerless CSVs are out of scope (see R3) because header-detection heuristics (`csv.Sniffer.has_header`) are unreliable, and the brief's "what the columns are" implies named columns already exist to report.
- **ASSUMPTION:** The brief does not mention any flags beyond the file path → resolved as: the only CLI argument is the file path — no flags for a custom delimiter, top-N override, or output format — because the brief calls for a small M2 toy run ("a handful of work items") and names no flag.
- **ASSUMPTION:** The brief does not enumerate data "types" → resolved as: type inference reports one of exactly three categories — `integer`, `float`, `string` (fallback) — with no date/datetime or boolean detection (see R5), because date-format detection is inherently ambiguous (locale, field order) and drifts toward the "real data profiling" the brief excludes.
- **ASSUMPTION:** "What the common values look like" is not defined → resolved as: per column, report the up to 5 most frequent distinct non-blank values with their counts, ranked by descending count then ascending alphabetically on ties (see R7); blanks are counted separately as missing (R6), not ranked as a "value") because a bounded top-N list answers the brief's framing without becoming a histogram (explicitly out of scope).
- **ASSUMPTION:** "Blank"/missing is not defined → resolved as: a field counts as blank only if it is exactly the empty string after CSV parsing (no whitespace-only handling), because whitespace-trimming rules are themselves a profiling policy choice the brief does not ask for.
- **ASSUMPTION:** The brief allows `csv.Sniffer` for delimiter detection but doesn't say what happens if it fails → resolved as: fall back to comma as the default delimiter when `csv.Sniffer` cannot determine one, rather than erroring, because a quick-peek tool should degrade to the common case rather than block on an edge case.
- **ASSUMPTION:** The brief doesn't address rows with the wrong field count → resolved as: ragged rows are still parsed and counted, with missing trailing fields treated as blank and extra fields beyond the header ignored for column reporting (see R8), because CSVs found in the wild are frequently ragged, and refusing to peek at them would defeat the tool's purpose.
- **ASSUMPTION:** The brief doesn't specify an output medium or format → resolved as: a single human-readable plain-text report to stdout per invocation (no JSON/machine-readable mode, no file output), analogous to shell tools like `ls -l`/`file`, because that matches the brief's "quick way to see... from the shell" framing; exact layout/wording is left to the Architect provided the content required by R2–R7 is present.
- **ASSUMPTION:** The brief doesn't address a completely empty (0-byte) file → resolved as: treated as valid, non-error input (0 rows, 0 columns; see R10), consistent with wordfreq's precedent that "nothing here" is a legitimate answer, not a failure.

## Out of scope
- Real data-profiling output: histograms, correlations, quantiles, or plotting (per the brief).
- Delimiter sniffing beyond what `csv.Sniffer` provides out of the box (per the brief).
- Excel or JSON input (per the brief).
- Large-file streaming/performance optimization (per the brief).
- Packaging or PyPI distribution (per the brief).
- Date/datetime and boolean type detection (see Assumptions) — type inference is limited to integer/float/string.
- Headerless-CSV support and CLI flags of any kind (custom delimiter, top-N override, output-format switch) — file path is the only argument.
- Reading input from stdin (per the brief).
- JSON or other machine-readable output modes; stdout is plain text only.
