# Specification: Markdown Table-of-Contents Generator (mdtoc)

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion. -->

## Context
This repo's long design docs (`docs/DESIGN.md`, `docs/ORCHESTRATOR.md`, `docs/FRONTEND.md`)
use only ATX headings (`#`…`######`), no Setext headings, and no closed-ATX style
(trailing `#` sequences) — the brief's constraints match observed content. `apps/`
already contains one precedent (`apps/wordfreq/`: a single `.py` file plus separate
`test_*.py` files under `apps/<slug>/`), which this run's brief explicitly follows
(`single file under apps/mdtoc/`). None of the three named docs currently contain a
fenced code block with a line starting `#` inside it, so the code-fence-exclusion
requirement (R3) has no naturally occurring regression case in-repo today; the
Verifier will need a constructed fixture. No brief/repo mismatches were found.

## Requirements

### R1 — CLI file input and stdout-only output
The tool must run as a Python 3 script invoked from the shell, taking a required
positional argument: the path to a Markdown file. It must never modify the input
file or write any file; the generated TOC is the only output, on stdout.
**Acceptance criteria:**
- [ ] AC1.1 — Running `python3 mdtoc.py path/to/existing.md` (existing, readable file) exits with status code 0 and prints the TOC to stdout.
- [ ] AC1.2 — Running `python3 mdtoc.py` with no file argument exits with a non-zero status code and prints a usage/error message to stderr.
- [ ] AC1.3 — Running the tool against `docs/DESIGN.md` leaves the file's on-disk bytes unchanged (`git diff --exit-code docs/DESIGN.md` after the run is empty) and creates no new file.

### R2 — ATX heading detection
The tool must recognize ATX headings, levels 1–6, per the CommonMark rule that the
line starts with 1–6 `#` characters followed by a space (or end of line), and must
not misidentify non-heading lines that merely start with `#`.
**Acceptance criteria:**
- [ ] AC2.1 — Given a document with `# Title`, `## Section A`, `### Sub A1`, all three are detected as headings at levels 1, 2, 3 respectively, in document order.
- [ ] AC2.2 — Given the line `#1234` (no space after `#`), it is not detected as a heading.
- [ ] AC2.3 — Given the line `####### Seven` (7 `#` characters), it is not detected as a heading.

### R3 — Fenced code blocks are excluded
Lines that look like ATX headings but occur inside a fenced code block (delimited by
a line of three or more backticks or three or more tildes, and the matching closing
fence) must not be treated as headings.
**Acceptance criteria:**
- [ ] AC3.1 — Given a document containing a fenced block ` ```\n# not a heading\nregular text\n``` ` followed by a real `## Real Heading`, the TOC lists only `Real Heading`.
- [ ] AC3.2 — The same fixture using tilde fences (`~~~`) in place of backticks produces the same result (the `#`-prefixed line inside the fence is excluded).

### R4 — GitHub-flavored anchor generation
Each heading's link target must be an anchor computed the way GitHub computes
auto-generated heading anchors: lowercase the heading text, remove every character
that is not a Unicode letter, digit, space, or hyphen, then replace each space with a
hyphen.
**Acceptance criteria:**
- [ ] AC4.1 — Heading `## Hello World` produces anchor `hello-world`.
- [ ] AC4.2 — Heading `## Don't Repeat Yourself` produces anchor `dont-repeat-yourself` (apostrophe removed, not treated as a word boundary).
- [ ] AC4.3 — Heading `### 1. What v1 changes — and what it must not` (taken from `docs/ORCHESTRATOR.md`) produces anchor `1-what-v1-changes--and-what-it-must-not` (the em dash is removed, leaving the double space around it to collapse to a double hyphen).
- [ ] AC4.4 — Heading `` ## Code `example` `` produces anchor `code-example` (backticks removed).

### R5 — Duplicate anchor disambiguation
When two or more headings in the same document produce the same base anchor, the
second and later occurrences must be disambiguated so every anchor in the TOC is
unique, matching GitHub's `-1`, `-2`, … suffix scheme.
**Acceptance criteria:**
- [ ] AC5.1 — Given three headings all reading `## Overview` (at any levels), the TOC links them to `#overview`, `#overview-1`, and `#overview-2` respectively, in document order.

### R6 — Nested list output reflecting heading hierarchy
The TOC must be a Markdown bullet list, one item per heading in document order, each
item reading `[<heading text>](#<anchor>)`, indented by 2 spaces per heading level
below level 1 (so a level-1 heading is unindented, a level-3 heading is indented 4
spaces), independent of what levels precede it in the document.
**Acceptance criteria:**
- [ ] AC6.1 — Given `# Title` / `## Section A` / `### Sub A1` / `## Section B`, stdout is exactly:
  ```
  - [Title](#title)
    - [Section A](#section-a)
      - [Sub A1](#sub-a1)
    - [Section B](#section-b)
  ```
- [ ] AC6.2 — Given a document whose first heading is `### Deep Start` (jumping straight to level 3 with no level-1/2 headings present), that item is indented 4 spaces (indentation is derived from the absolute heading level, not renumbered relative to the shallowest heading seen).

### R7 — Invalid input handling
The tool must fail clearly, not crash with an unhandled traceback, when the given
path does not exist, is not a file, or cannot be decoded as UTF-8 text.
**Acceptance criteria:**
- [ ] AC7.1 — Running `python3 mdtoc.py does-not-exist.md` exits with a non-zero status code and prints a human-readable error message to stderr (not a raw Python traceback).
- [ ] AC7.2 — Running `python3 mdtoc.py <path-to-a-directory>` exits with a non-zero status code and prints a human-readable error message to stderr.
- [ ] AC7.3 — Running the tool against a file containing invalid UTF-8 bytes exits with a non-zero status code and prints a human-readable error message to stderr.

### R8 — Headingless input is not an error
A valid, readable Markdown file that contains no ATX headings is not an error
condition.
**Acceptance criteria:**
- [ ] AC8.1 — Running the tool against a file with body text but zero ATX headings exits with status code 0 and produces no stdout output.
- [ ] AC8.2 — Running the tool against an empty (0-byte) file exits with status code 0 and produces no stdout output.

### R9 — Automated test coverage
The tool's core logic (heading detection, code-fence exclusion, anchor slugging,
duplicate disambiguation, nesting) must be verifiable independent of manual shell
invocation.
**Acceptance criteria:**
- [ ] AC9.1 — Running `pytest` from the deliverable's directory exits with status code 0.
- [ ] AC9.2 — `pytest --collect-only` lists distinct, individually named test cases exercising each of: ATX detection incl. non-heading `#` lines (R2), fenced-code-block exclusion (R3), anchor slug generation incl. the em-dash/apostrophe/backtick cases (R4), duplicate-anchor disambiguation (R5), and headingless input (R8).

### R10 — Implementation constraints
The delivered tool must be a single Python 3 source file, compatible with Python
3.9, using only the Python 3 standard library, located under `apps/mdtoc/`.
**Acceptance criteria:**
- [ ] AC10.1 — The delivered CLI logic is contained in exactly one `.py` file under `apps/mdtoc/` (test files are excluded from this count).
- [ ] AC10.2 — `python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" apps/mdtoc/<file>.py` lists only modules present in the Python 3 standard library (no third-party package imports).
- [ ] AC10.3 — The file parses without error under Python 3.9 (`python3.9 -m py_compile apps/mdtoc/<file>.py` exits 0, or equivalent AST-level check if 3.9 is unavailable in the execution environment) — no PEP 604 (`X | Y`) union-type syntax or other 3.10+-only constructs.

## Assumptions
- **ASSUMPTION:** The brief doesn't say whether the document's own level-1 title heading belongs in the TOC → resolved as: every ATX heading found, levels 1–6 including level 1, is included with no special-casing of a "document title" (see R2, R6), because the brief says "ATX headings (# … ######) only" without carving out level 1, and inventing a title-skip rule is unrequested behavior a human reviewer should approve explicitly, not one Analyst should assume.
- **ASSUMPTION:** The brief doesn't specify the anchor-slugging algorithm → resolved as GitHub's documented scheme — lowercase, strip everything but Unicode letters/digits/spaces/hyphens, spaces become hyphens, duplicates get `-1`/`-2`/… suffixes (see R4, R5) — because the brief explicitly asks for "GitHub's auto-generated heading anchors," and this is GitHub's actual algorithm, grounded in real headings from `docs/ORCHESTRATOR.md` (AC4.3).
- **ASSUMPTION:** The brief doesn't say whether the TOC link text should reflect the heading's literal source characters or a markdown-rendered/plain-text version of it → resolved as: link text is the heading's literal trailing text after the `#` markers and surrounding whitespace are stripped, with no further transformation (inline emphasis markers, code-span backticks, etc. are left as-is in the link text) — because rendering inline Markdown to plain text is unrequested parsing depth the brief doesn't ask for, and GitHub's own TOC-adjacent rendering shows the heading as authored.
- **ASSUMPTION:** The brief doesn't address headings containing inline links or images (e.g. `## See [details](url)`), where GitHub's rendered-text-based anchor would differ from a literal-source-based one → resolved as: out of scope. The anchor algorithm (R4) operates on the heading's literal source text; a heading containing an inline link or image may not produce a byte-for-byte GitHub-matching anchor, because none of this run's target documents (DESIGN.md, ORCHESTRATOR.md, FRONTEND.md) contain such headings, and handling it correctly requires a markdown inline parser the brief doesn't request.
- **ASSUMPTION:** The brief doesn't define TOC indentation → resolved as 2 spaces per level below level 1, computed from each heading's absolute level rather than renumbered relative to the shallowest level present in the document (see R6, AC6.2), because it's the smallest deterministic rule and matches common Markdown TOC-generator convention.
- **ASSUMPTION:** The brief's "ignoring `#` lines inside fenced code blocks is in scope" names fenced code blocks specifically → resolved as: only fenced code blocks (``` or ~~~ delimited, per CommonMark) are excluded; indented (4-space) code blocks are not specially handled (see R3), because the brief calls out fences by name and none of the three target docs use indented code blocks.
- **ASSUMPTION:** The brief doesn't name the entry-point file → resolved as: acceptance criteria above use `mdtoc.py` as an illustrative placeholder (matching the run slug), not a mandated name; the Architect may choose the actual file name as long as R10's constraints are met, because naming is an implementation detail, not a requirement.

## Out of scope
- Setext (underline-style, `===`/`---`) headings (explicitly excluded by the brief).
- Writing the TOC back into the source file, in place or otherwise; stdout is the only output (explicitly excluded by the brief; see R1).
- Multi-file input or directory scanning (explicitly excluded by the brief).
- Packaging, `setup.py`/`pyproject.toml` entry points, or PyPI distribution (explicitly excluded by the brief).
- Non-GitHub anchor dialects (e.g. GitLab's, Jekyll/kramdown's, pandoc's) — GitHub's scheme only (explicitly excluded by the brief).
- Full inline-Markdown rendering of heading text (links, images, HTML tags) for anchor or link-text purposes beyond the literal-source handling in R4 (see Assumptions).
- Indented (4-space) code block exclusion — only fenced code blocks are handled (see R3, Assumptions).
- A persistent CLI installed on `PATH`; invocation is via `python3 <file>.py <path>` only.
- Reading input from stdin; only a file-path argument is accepted (mirrors R1's single required positional argument; the brief gives no reason to add stdin support).
- Configurable TOC depth (e.g. a `--max-level` flag) or excluding specific headings — not requested by the brief; all detected headings, all levels, are included.
