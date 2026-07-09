# Specification: Word Frequency CLI

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion. -->

## Context
This repo currently contains only the agent-pipeline scaffolding (`roles/`, `contracts/`,
`runs/`) — there is no existing application code, so the wordfreq CLI described in the
intent brief is greenfield, net-new work within this run's scope; there is nothing to
reconcile it against. The repo has no `requirements.txt`, `pyproject.toml`, linter
config, or CI, which is consistent with the brief's "Python 3, stdlib only" constraint
(no dependency-management tooling exists to conflict with it) but also means there is no
established file-layout convention to ground the deliverable's location in — that
placement decision is left to the Architect. No mismatches were found between the brief
and observed repo state; the brief's constraints are directly actionable as written.

## Requirements

### R1 — CLI file input
The tool must run as a Python 3 script invoked from the shell, taking a required
positional argument: the path to a text file to analyze.
**Acceptance criteria:**
- [ ] AC1.1 — Running `python3 wordfreq.py path/to/existing.txt` (existing, readable file) exits with status code 0.
- [ ] AC1.2 — Running `python3 wordfreq.py` with no file argument exits with a non-zero status code and prints a usage/error message to stderr.

### R2 — Word extraction rule
The tool must define, consistently and unambiguously, which substrings of the input
count as a "word" for counting purposes.
**Acceptance criteria:**
- [ ] AC2.1 — Given input `"Hello, hello! World."`, the word `hello` is counted twice and `world` once (surrounding punctuation is not part of the word).
- [ ] AC2.2 — Given input `"don't stop"`, the token `don't` is counted as a single word (the internal apostrophe is preserved; it is not split into `don` and `t`).
- [ ] AC2.3 — Given input `"co-located items"`, `co` and `located` are counted as two separate words (a hyphen acts as a delimiter, not part of a word).

### R3 — Case-insensitive counting
Words that differ only by letter case must be aggregated as the same word.
**Acceptance criteria:**
- [ ] AC3.1 — Given input `"The the THE"`, the tool reports exactly one entry, `the`, with count 3 (reported in lowercase).

### R4 — Frequency ranking and top-N selection
Results must be ordered by descending frequency, and the tool must report only the N
most frequent distinct words, where N is configurable and has a default when not
specified.
**Acceptance criteria:**
- [ ] AC4.1 — Running `python3 wordfreq.py sample.txt` (no N flag) against a file with more than 10 distinct words outputs exactly 10 lines.
- [ ] AC4.2 — Running `python3 wordfreq.py sample.txt -n 3` outputs exactly 3 lines, listing the 3 most frequent words in descending count order.
- [ ] AC4.3 — Running `python3 wordfreq.py sample.txt -n 100` against a file with only 5 distinct words outputs exactly 5 lines (no padding, no error).

### R5 — Deterministic tie-breaking
When two or more words share the same frequency count, their relative order must be
deterministic and reproducible across runs.
**Acceptance criteria:**
- [ ] AC5.1 — Given input `"zebra apple zebra apple"` with `-n 2`, the output lists `apple` before `zebra` (alphabetical order used to break the tie at count 2), and running the command twice against the same input produces byte-identical output.

### R6 — Output format
Each result must be printed as a single, consistently formatted line containing the
word and its count, in ranked order.
**Acceptance criteria:**
- [ ] AC6.1 — Given input `"cat cat dog"`, stdout is exactly `cat\t2\ndog\t1\n` (tab-separated word and count, one pair per line, most frequent first, no header row).

### R7 — Error handling for invalid input
The tool must fail clearly rather than crash with an unhandled traceback when the given
path does not exist or cannot be read as a file.
**Acceptance criteria:**
- [ ] AC7.1 — Running `python3 wordfreq.py does-not-exist.txt` exits with a non-zero status code and prints a human-readable error message to stderr (not a raw Python traceback).
- [ ] AC7.2 — Running `python3 wordfreq.py <path-to-a-directory>` exits with a non-zero status code and prints a human-readable error message to stderr.

### R8 — Empty / wordless input handling
A valid, readable file that yields zero extractable words is not an error condition.
**Acceptance criteria:**
- [ ] AC8.1 — Running the tool against an empty (0-byte) file exits with status code 0 and produces no stdout output.
- [ ] AC8.2 — Running the tool against a file containing only punctuation/whitespace (e.g., `"... !!! ,,,"`) exits with status code 0 and produces no stdout output.

### R9 — Automated test coverage
The tool's core logic (tokenization, counting, ranking, tie-breaking) must be
verifiable independent of manual shell invocation.
**Acceptance criteria:**
- [ ] AC9.1 — Running `pytest` from the deliverable's directory exits with status code 0.
- [ ] AC9.2 — `pytest --collect-only` lists distinct, individually named test cases exercising each of: the tokenization rule (R2), case folding (R3), top-N ranking (R4), tie-breaking (R5), and empty-input handling (R8).

### R10 — Implementation constraints
The delivered tool must be a single Python 3 source file using only the Python 3
standard library, per the brief's explicit constraints.
**Acceptance criteria:**
- [ ] AC10.1 — The delivered CLI logic is contained in exactly one `.py` file (test files are excluded from this count).
- [ ] AC10.2 — `python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" wordfreq.py` lists only modules present in the Python 3 standard library (no third-party package imports).

## Assumptions
- **ASSUMPTION:** The brief does not define what counts as a "word" → resolved as: a maximal run of alphanumeric characters, optionally containing a single internal apostrophe (e.g., `don't`), compared case-insensitively; hyphens and all other punctuation/whitespace act as delimiters (see R2) because this is the smallest, unambiguous rule that handles common English contractions/possessives without drifting into stemming or stop-word filtering, both of which the brief marks out of scope.
- **ASSUMPTION:** The brief does not state a default or configurable "how many words to show" → resolved as: a default of the top 10 most frequent words, overridable via a CLI flag (illustrated as `-n`/`--top` in the acceptance criteria) because "most common words" implies a bounded top-N view, and some default is required for the tool to be usable with zero flags as the brief's "quick way to see" framing implies.
- **ASSUMPTION:** The brief does not specify output formatting → resolved as: tab-separated `word<TAB>count` lines, one per word, most-frequent-first, no header row (see R6), because this is minimal, unambiguous, and trivially greppable/pipeable from the shell, matching the brief's shell-tool framing.
- **ASSUMPTION:** The brief does not specify tie-breaking behavior for equal counts → resolved as: alphabetical ascending order by word (see R5), because ties are otherwise nondeterministic (dependent on hash/insertion order), which would make output non-reproducible and untestable.
- **ASSUMPTION:** The brief does not address empty or wordless input → resolved as: treated as a success case (exit 0, no output rows), not an error (see R8), because an empty result set is a valid answer to "what are the most common words," not a failure of the tool.
- **ASSUMPTION:** The brief does not specify text encoding handling → resolved as: input is read as UTF-8; a file that fails to decode as UTF-8 is treated as a read error under R7 (non-zero exit, stderr message) rather than attempting silent fallback encodings, because UTF-8 is the de facto default for "a text file" and silent fallback risks corrupting word counts without the user knowing.
- **ASSUMPTION:** The brief says "a text file" (singular) and separately excludes "multi-file input," but does not say whether stdin piping (e.g., `cat f.txt | wordfreq.py`) must also be supported → resolved as: out of scope for this run; only a file-path argument is required (see R1), because the brief's examples and constraints consistently frame the input as a file on disk, and adding stdin support is additional interface surface not requested.
- **ASSUMPTION:** The brief does not name the entry-point file or CLI flags → resolved as: acceptance criteria above use `wordfreq.py` and `-n`/`--top` as illustrative placeholders only (matching the run slug), not mandated names; the Architect may choose the actual file/flag names as long as the underlying behaviors (single file per R10, configurable top-N per R4) are met, because naming is an implementation detail, not a requirement.

## Out of scope
- Stemming or lemmatization of words (explicitly excluded by the brief).
- Stop-word filtering/lists (explicitly excluded by the brief).
- Multi-file input or directory scanning (explicitly excluded by the brief).
- Packaging, `setup.py`/`pyproject.toml` entry points, or PyPI distribution (explicitly excluded by the brief).
- Reading input from stdin or any source other than a file-path argument.
- Output formats other than the plain tab-separated text defined in R6 (e.g., JSON, CSV, colored/rich terminal output).
- A case-sensitive mode or any other configurable counting behavior beyond top-N selection.
- Writing results to a file; the tool only needs to print to stdout.
- Non-English-specific tokenization concerns (e.g., CJK word segmentation, locale-aware collation).
- Performance/streaming optimization for very large (e.g., multi-gigabyte) input files.
- A persistent CLI installed on `PATH`; invocation is via `python3 <file>.py ...` only.
