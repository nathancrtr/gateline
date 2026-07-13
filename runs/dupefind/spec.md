# Specification: Duplicate-File Finder (dupefind)

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion. -->

## Context
This is the third full v0 pipeline run; `apps/` currently holds two precedents
(`apps/wordfreq/`, `apps/mdtoc/`), each a single `.py` file plus separate `test_*.py`
files under `apps/<slug>/` — this run's brief follows the same layout convention
(`single file under apps/dupefind/`). The repo has no existing duplicate-detection
code to reconcile against; this is greenfield work. Unlike the two prior briefs, this
one specifies part of the detection *method* itself ("by file size then SHA-256 of
contents") rather than leaving it fully open — that is treated below as a given
constraint, not an Analyst-invented design choice. No brief/repo mismatches were
found.

## Requirements

### R1 — CLI directory input
The tool must run as a Python 3 script invoked from the shell, taking a required
positional argument: the path to a directory to scan.
**Acceptance criteria:**
- [ ] AC1.1 — Running `python3 dupefind.py path/to/existing-dir` (existing, readable directory) exits with status code 0.
- [ ] AC1.2 — Running `python3 dupefind.py` with no directory argument exits with a non-zero status code and prints a usage/error message to stderr.

### R2 — Recursive traversal scope
The tool must scan the given directory and all of its subdirectories, at any depth,
for regular files. Symlinks (to files or to directories) and non-regular filesystem
entries (e.g. FIFOs, sockets, device files) are not followed or read; they are
skipped without error, including when a directory symlink would otherwise create a
traversal cycle.
**Acceptance criteria:**
- [ ] AC2.1 — Given a root directory containing two byte-identical files nested at different depths in different subdirectories (e.g. `root/a/x.txt` and `root/b/c/y.txt`), both are reported in the same duplicate group.
- [ ] AC2.2 — Given a symlink (file or directory) inside the tree that resolves to content which would otherwise duplicate another file, the symlink's path never appears in any reported group, and the run completes without error even when the symlink points back at an ancestor directory (cycle).
- [ ] AC2.3 — Given a FIFO created inside the tree (`os.mkfifo`), the tool completes without error or hanging, and the FIFO's path never appears in the output.

### R3 — Duplicate detection correctness
Two files are duplicates of each other only if their contents are exactly
byte-identical. Per the brief's constraint, this is determined by first comparing
file size, then comparing the SHA-256 digest of file contents; files that share a
size but not a digest are never reported together, and by construction the tool
produces no false-positive groupings.
**Acceptance criteria:**
- [ ] AC3.1 — Given two files with identical content, they are reported in the same duplicate group.
- [ ] AC3.2 — Given two files of identical size but different content (hence different SHA-256 digests), they are not reported as duplicates of each other.
- [ ] AC3.3 — Given three or more files sharing identical content, all of them appear together in a single group (not split into separate pairs).

### R4 — Empty-file handling
Files of size 0 bytes are excluded from duplicate detection by default (per the
brief); they must not be reported as a duplicate group even though they are
trivially byte-identical to one another. An opt-in mechanism exists to include them.
**Acceptance criteria:**
- [ ] AC4.1 — Given two or more 0-byte files in the tree, the default invocation does not report them as a duplicate group.
- [ ] AC4.2 — Given the same fixture, running with the include-empty override (illustrated as `--include-empty`) reports the 0-byte files as a duplicate group.

### R5 — Output format and determinism
Output is one duplicate group per set of byte-identical files with two or more
members; sets of exactly one unique file are never printed. Within a group, member
paths are listed one per line in ascending alphabetical order. Groups are separated
by a single blank line and are themselves ordered by ascending alphabetical order of
each group's first (already-sorted) path. Paths are printed as constructed by
joining the given root argument with each file's location relative to it (no
resolution to an absolute or real path). Running the tool twice against an unchanged
directory tree produces byte-identical stdout both times.
**Acceptance criteria:**
- [ ] AC5.1 — Given a root with two duplicate groups (`a.txt`/`b.txt` identical; `c/d.txt`/`e.txt` identical) and one unique file `f.txt`, stdout is exactly the two groups, each listing its members sorted, separated by one blank line, ordered by first member path, with `f.txt` absent from the output.
- [ ] AC5.2 — Running the tool twice, unmodified, against the same directory tree produces byte-identical stdout on both runs.
- [ ] AC5.3 — A file with unique content (no other file in the tree matches it) never appears in the output.

### R6 — No-duplicates case is not an error
A valid, readable directory tree that contains no duplicate files (including an
empty directory) is a success case, not an error.
**Acceptance criteria:**
- [ ] AC6.1 — Running the tool against a directory tree with files but no duplicate content exits with status code 0 and produces no stdout output.
- [ ] AC6.2 — Running the tool against an empty directory (no files at all) exits with status code 0 and produces no stdout output.

### R7 — Error handling for invalid root argument
The tool must fail clearly rather than crash with an unhandled traceback when the
given path does not exist or is not a directory.
**Acceptance criteria:**
- [ ] AC7.1 — Running `python3 dupefind.py does-not-exist-dir` exits with a non-zero status code and prints a human-readable error message to stderr (not a raw Python traceback).
- [ ] AC7.2 — Running `python3 dupefind.py <path-to-an-existing-regular-file>` (not a directory) exits with a non-zero status code and prints a human-readable error message to stderr.

### R8 — Automated test coverage
The tool's core logic (traversal/symlink handling, size+hash detection, empty-file
handling, grouping/ordering, no-duplicates case) must be verifiable independent of
manual shell invocation.
**Acceptance criteria:**
- [ ] AC8.1 — Running `pytest` from the deliverable's directory exits with status code 0.
- [ ] AC8.2 — `pytest --collect-only` lists distinct, individually named test cases exercising each of: recursive traversal with symlinks/non-regular files skipped (R2), size-then-hash detection correctness including the same-size-different-content case (R3), empty-file exclusion and its override (R4), output grouping/ordering/reproducibility (R5), and the no-duplicates case (R6).

### R9 — Implementation constraints
The delivered tool must be a single Python 3 source file, compatible with Python
3.9, using only the Python 3 standard library, located under `apps/dupefind/`.
**Acceptance criteria:**
- [ ] AC9.1 — The delivered CLI logic is contained in exactly one `.py` file under `apps/dupefind/` (test files are excluded from this count).
- [ ] AC9.2 — `python3 -c "import ast,sys; [print(n.names[0].name) for n in ast.walk(ast.parse(open(sys.argv[1]).read())) if isinstance(n,(ast.Import,ast.ImportFrom))]" apps/dupefind/<file>.py` lists only modules present in the Python 3 standard library (no third-party package imports).
- [ ] AC9.3 — The file parses without error under Python 3.9 (`python3.9 -m py_compile apps/dupefind/<file>.py` exits 0, or equivalent AST-level check if 3.9 is unavailable in the execution environment) — no PEP 604 (`X | Y`) union-type syntax or other 3.10+-only constructs.

## Assumptions
- **ASSUMPTION:** The brief doesn't specify the CLI invocation shape → resolved as: a single required positional argument, the root directory path (see R1), mirroring the one-required-positional-argument shape used by both prior runs (`wordfreq.py <file>`, `mdtoc.py <file>`), because that is this codebase's only established CLI convention and the brief gives no reason to deviate.
- **ASSUMPTION:** "empty files excluded by default" (brief, Constraints) implies but does not name an override → resolved as: an opt-in flag (illustrated as `--include-empty`) exists to include 0-byte files (see R4), because "by default" is a conditional phrase that only makes sense if a non-default mode exists; the flag's exact name is an Architect-level detail, not a mandated requirement. **G0 may veto this reading** in favor of "0-byte files are unconditionally excluded, no override" if that is the intended, simpler behavior.
- **ASSUMPTION:** The brief doesn't specify output formatting (separators, per-group ordering, path form) → resolved as: blank-line-separated groups, one sorted path per line within a group, groups ordered by their first sorted member path, paths printed as root-joined-with-relative-location rather than resolved to absolute/real paths (see R5), because this is the minimal, unambiguous, deterministic scheme consistent with the brief's literal "one group per duplicate set, paths sorted."
- **ASSUMPTION:** The brief's exclusion of "cross-filesystem deduplication semantics" doesn't say whether hardlinks (multiple paths, same inode, trivially identical content) get special treatment → resolved as: no inode-awareness; hardlinked paths are compared and grouped by content like any other files, with no special-case exclusion or annotation, because the brief scopes out filesystem-identity semantics as a non-goal rather than asking for hardlink-aware exclusion.
- **ASSUMPTION:** The brief's "following symlinks" out-of-scope note doesn't say whether encountering a symlink is a silent skip or an error condition → resolved as: silent skip, no error (see R2), grounded in the Python standard library's documented default (`os.walk(..., followlinks=False)` does not descend into symlinked directories) — this is verified against the Python 3 stdlib documentation, not merely inferred, but the extension to file symlinks (also skipped, not read) is this Analyst's choice for consistency, since the brief only names symlink-*following* as out of scope, not symlinked-file handling generally.
- **ASSUMPTION:** The brief doesn't address non-regular files (FIFOs, sockets, device files) encountered during the scan → resolved as: skipped silently, same treatment as symlinks, only regular files are hashed and compared (see R2), because "duplicate files" implies ordinary file content and the brief gives no reason to define behavior for special filesystem entries.
- **ASSUMPTION:** The brief doesn't say whether the root argument itself must be an existing directory (as opposed to accepting a file path) → resolved as: the root must exist and be a directory; a file path or non-existent path is an error (see R7), because "duplicate files under a directory tree" presupposes a directory root.

## Out of scope
- Deleting, moving, hardlinking, or otherwise modifying any duplicate file found (explicitly excluded by the brief; report only).
- Following symlinks of any kind during traversal (explicitly excluded by the brief; see R2).
- Perceptual/fuzzy matching (e.g. visually similar images, near-duplicate text) — only byte-exact content equality (explicitly excluded by the brief; see R3).
- An interactive mode (e.g. prompting the user to choose which duplicate to keep) (explicitly excluded by the brief).
- Cross-filesystem deduplication semantics, including any hardlink-aware exclusion or filesystem-identity logic (explicitly excluded by the brief; see Assumptions).
- Packaging, `setup.py`/`pyproject.toml` entry points, or PyPI distribution (explicitly excluded by the brief).
- A persistent CLI installed on `PATH`; invocation is via `python3 <file>.py <dir>` only.
- Output formats other than the plain grouped-path text defined in R5 (e.g. JSON, CSV).
- Configurable hash algorithm, chunked/streaming performance tuning, or parallelism — not requested by the brief.
- Glob/pattern-based include/exclude filters, minimum/maximum file size filters (beyond the default empty-file exclusion in R4), or a scan-depth limit — not requested by the brief.
- Reading input from stdin; only a directory-path argument is accepted.
