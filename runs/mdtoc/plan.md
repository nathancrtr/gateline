# Technical Plan: Markdown Table-of-Contents Generator (mdtoc)

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     BUDGET: reference spec requirements by number, never re-quote them. -->

## Approach

Greenfield deliverable at `apps/mdtoc/`, following the `apps/<slug>/` convention
established by wordfreq (its ADR-1, now repo convention). Three files:

```
apps/mdtoc/
  mdtoc.py          # the entire tool — the single source file mandated by R10
  test_core.py      # unit tests importing mdtoc's pure functions (R9)
  test_cli.py       # end-to-end tests invoking the script via subprocess (R9)
```

`mdtoc.py` is internally layered into **pure core functions** — `extract_headings`
(one line-scanner pass with a fence state machine, R2+R3), `slugify` (R4), and
`render_toc` (R5+R6) — and a **CLI shell** (`main()` — argparse, UTF-8 file read,
error handling, exit codes; R1, R7, R8). The split lives inside one file (R10) and
makes R9 trivially satisfiable: `test_core.py` imports the functions, `test_cli.py`
exercises the process boundary.

Data flow: `main()` parses args → reads the file as UTF-8 → `extract_headings()`
yields `(level, text)` pairs in document order → `render_toc()` slugs, disambiguates
duplicates, and renders the indented bullet list → `main()` writes the result to
stdout and returns an exit code. All anticipated failures (missing path, directory,
undecodable bytes) are caught in `main()` and reported as one-line stderr messages
with exit 1 (R7); headingless input is success with zero stdout bytes (R8). The tool
never opens anything for writing (R1/AC1.3).

Work is cut into three tasks with **fully disjoint file-contact surfaces** (ADR-7):
01 the whole tool, then 02 (unit tests) and 03 (CLI tests) in parallel.

## Interface contracts

Binding. Tasks 02 and 03 write tests against exactly these signatures and behaviors.

### Module: `apps/mdtoc/mdtoc.py`

```python
HEADING_RE: re.Pattern[str]  # re.compile(r"^(#{1,6})(?: (.*))?$")   (ADR-2)

def extract_headings(text: str) -> list[tuple[int, str]]:
    """(level, text) per ATX heading in `text`, in document order (R2).
    Heading text is the remainder after the marker, .strip()ped; a bare
    marker line ('#'..'######') yields text ''. Lines inside fenced code
    blocks are never headings (R3, fence rules in ADR-3). Splits lines via
    str.splitlines(). Returns [] when no headings (R8)."""

def slugify(text: str) -> str:
    """Base GitHub anchor for one heading's text (R4): lowercase, drop every
    char that is not a Unicode letter, digit, space, or hyphen, then map each
    space to a hyphen (mechanism in ADR-4). No duplicate handling here."""

def render_toc(headings: Iterable[tuple[int, str]]) -> str:
    """The full TOC: one '<indent>- [<text>](#<anchor>)\\n' line per heading,
    indent = '  ' * (level - 1) from the absolute level (R6, AC6.2). Anchors
    are slugify(text) with duplicates suffixed -1, -2, ... in document order
    (R5, ADR-5). Returns '' for an empty iterable — zero characters (R8)."""

def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the exit code; never raises for anticipated errors (R7)."""

if __name__ == "__main__":
    raise SystemExit(main())
```

> **Environment constraint (inherited, ADR-8):** the execution environment's only
> interpreter is `/usr/bin/python3` = Python **3.9.6**. No PEP 604 unions in any
> evaluated annotation (`X | None` raises `TypeError` at def time on 3.9) — use
> `Optional[...]`/`Union[...]` from `typing`. PEP 585 subscriptions (`list[str]`,
> `tuple[int, str]`, `re.Pattern[str]`) are 3.9-safe and stay as written.

### CLI contract (what `test_cli.py` builds against)

- Invocation: `python3 apps/mdtoc/mdtoc.py FILE` (name per ADR-1). `FILE` is the
  single required positional argument (R1); there are no flags.
- Exit codes: `0` success, including headingless and empty input (R8); `2` argument
  errors, emitted by argparse itself (AC1.2); `1` file errors — path missing, path
  is a directory, permission denied, invalid UTF-8 (R7).
- File errors are caught as `(OSError, UnicodeDecodeError)` in `main()`; the message
  is one human-readable line on stderr of the form `mdtoc.py: error: <reason>` —
  never a traceback (R7). `argparse` gets `prog="mdtoc.py"` so usage text is stable
  regardless of invocation path.
- File is read with `open(path, encoding="utf-8")`. The tool performs no writes of
  any kind — no output file, no temp file, no in-place edit (AC1.3).
- Success output: exactly `render_toc(extract_headings(text))` written via
  `sys.stdout.write` — byte-exact per AC6.1, zero bytes when there are no headings
  (AC8.1/AC8.2). Nothing else is ever written to stdout.

### Test-layout contract

- Both test files live in `apps/mdtoc/`; `pytest` is run from that directory
  (AC9.1). Tests import the module as `import mdtoc` (pytest's rootdir insertion
  puts the test file's directory on `sys.path`; no `__init__.py` files).
  `test_cli.py` locates the script as `pathlib.Path(__file__).parent / "mdtoc.py"`
  and runs it with `subprocess.run([sys.executable, str(script), ...],
  capture_output=True)`.
- Test-name contract for AC9.2 — `test_core.py` must contain individually named
  tests whose names include these substrings: `heading` (R2, incl. rejection of
  `#1234` and 7-`#` lines), `fence` (R3, both fence dialects), `slug` (R4, incl.
  the em-dash/apostrophe/backtick cases), `duplicate` (R5), `empty` (R8).

### Behavior not covered by any AC (defined here so it can't drift)

- A heading with empty text (`##` alone) is included: link text `''`, base anchor
  `''` — no special-casing.
- Heading text is the literal source remainder (spec assumptions 3–4): inline
  markers (backticks, `*`, links) pass through into the link text unchanged.
- An unclosed fence extends to end of file (ADR-3); indented code blocks are not
  fences (spec out-of-scope).

## Decisions (ADRs)

### ADR-1: Keep the spec's illustrative name `mdtoc.py`
- **Choice:** Adopt the placeholder file name from the acceptance criteria as final
  (spec assumption 7 delegates the choice here).
- **Rejected:** Any rename — every AC command line is written against `mdtoc.py`;
  keeping it lets the Verifier run AC1.x, AC7.x, AC10.2, AC10.3 verbatim
  (path-prefixed with `apps/mdtoc/`). Renaming buys nothing and costs traceability.
  (Same reasoning as wordfreq ADR-2, which held up through G3.)
- **Consequences:** `prog="mdtoc.py"` in argparse; tests hardcode the name.

### ADR-2: Heading detection is one anchored regex implementing exactly the spec's rule
- **Choice:** `HEADING_RE = re.compile(r"^(#{1,6})(?: (.*))?$")`, applied per line
  outside fences. Level = `len(group(1))`; text = `(group(2) or "").strip()`.
- **Rejected:** (a) Full CommonMark ATX fidelity (up to 3 leading spaces, tab after
  marker, closing `#` sequences) — R2 pins the narrower rule "1–6 `#` then a space
  or end of line", the spec's Context confirms the target docs contain nothing
  fancier, and extra tolerance is unrequested behavior a Reviewer can't trace to a
  requirement. (b) A third-party Markdown parser — barred outright by R10.
- **Consequences:** `#1234` and `####### Seven` fail the regex (AC2.2/AC2.3) with
  no separate rejection logic. An indented `# heading` (1+ leading spaces) is not
  detected — per R2 as written. The regex is the single place the heading rule
  lives.

### ADR-3: Fences via a two-state line scanner with pinned open/close rules
- **Choice:** `extract_headings` scans lines once, tracking `(fence_char,
  fence_len)` state. **Open** (when outside a fence): the line's `lstrip()`ed text
  begins with a run of ≥3 backticks or ≥3 tildes; record the char and run length
  (any trailing info string is ignored). **Close** (when inside): the line's
  stripped text is a run of ≥ `fence_len` of the same char and nothing else.
  Unclosed fence → everything to EOF is inside it. Heading matching is skipped
  while inside a fence; fence lines themselves are never headings.
- **Rejected:** (a) Exact CommonMark fence semantics (≤3-space indent limit,
  backtick-free info-string rule, paragraph-interruption rules) — R3 names only
  "three or more backticks or tildes, and the matching closing fence"; the extra
  rules have no AC and no occurrence in the target docs. (b) Stripping fenced
  regions with a single multiline regex before scanning — fails on unclosed fences
  and mis-pairs backtick openers with tilde closers unless the regex grows
  backreferences; the state machine is more legible per review.
- **Consequences:** AC3.1/AC3.2 hold; a ` ```` ` line closes a ` ``` ` fence; a
  tilde line never closes a backtick fence. Deviations from full CommonMark are
  deliberate and cite R3 — Reviewer findings proposing more fence dialect support
  must cite a requirement.

### ADR-4: `slugify` is a per-character filter on `str` predicates, not a `\w`-class regex
- **Choice:** Over `text.lower()`, keep exactly the characters where
  `ch.isalpha() or ch.isdigit() or ch in " -"`, then replace each `" "` with
  `"-"`. Python's `isalpha`/`isdigit` are the Unicode letter/digit tests R4 names.
- **Rejected:** (a) `re.sub(r"[^\w\s-]", "", ...)` — the common idiom, but wrong on
  two spec-relevant details: `\w` keeps underscores (R4 says drop them) and `\s`
  keeps tabs (R4 replaces only *spaces*; a kept tab would leak into the anchor).
  (b) Reproducing GitHub's private implementation quirks (e.g., GitHub actually
  preserves underscores) — R4 is the binding definition, verified against a real
  `docs/ORCHESTRATOR.md` heading in AC4.3; where GitHub's unpublished behavior and
  R4 diverge, R4 wins.
- **Consequences:** AC4.1–AC4.4 follow mechanically (the em dash in AC4.3 is
  dropped, leaving two spaces → `--`). A heading containing `_` slugs without it —
  documented divergence from live GitHub, per spec.

### ADR-5: Duplicate anchors via an occurrence-count dict, no re-collision check
- **Choice:** `render_toc` keeps `dict[str, int]` of base-slug occurrences; the
  first occurrence emits the base, the k-th (k≥2) emits `f"{base}-{k-1}"` (R5).
- **Rejected:** Re-checking that a generated `base-N` doesn't itself collide with a
  later heading's natural base slug (GitHub's actual edge behavior here is
  undocumented and inconsistent) — R5/AC5.1 pin exactly the simple counter scheme;
  handling the pathological case is unrequested complexity with no AC to verify it.
- **Consequences:** AC5.1 exact. A document containing both `## Overview-1` and two
  `## Overview` headings could produce two `#overview-1` anchors — out of scope by
  construction, noted so a Reviewer finding cites this ADR instead of relitigating.

### ADR-6: CLI shell reuses wordfreq's G3-proven pattern (argparse; one EAFP handler)
- **Choice:** Stdlib `argparse` (missing argument → its own usage-to-stderr, exit
  2, satisfying AC1.2); one try/except `(OSError, UnicodeDecodeError)` around
  open-and-read in `main()` → `mdtoc.py: error: <reason>` on stderr, return 1. No
  LBYL pre-checks.
- **Rejected:** (a) Hand-rolled `sys.argv` handling — re-implements tested stdlib
  behavior. (b) Pre-flight `os.path` checks — racy and redundant:
  `FileNotFoundError`, `IsADirectoryError`, `PermissionError` are all `OSError`
  subclasses, so one handler covers AC7.1/AC7.2, and `UnicodeDecodeError` covers
  AC7.3.
- **Consequences:** Argument errors exit 2, file errors exit 1 — both "non-zero"
  per the ACs. Core functions stay pure and exception-free; no traceback can reach
  the user for anticipated failures (R7).

### ADR-7: Three tasks, fully disjoint file-contact surfaces
- **Choice:** 01 builds all of `mdtoc.py` (core + shell); 02 (`test_core.py`) and
  03 (`test_cli.py`) both depend on 01 and run in parallel with each other. Every
  task owns exactly one file; no surface overlaps.
- **Rejected:** wordfreq's four-task cut (its ADR-7), where core and CLI-shell
  tasks shared one file serialized by `depends_on` — this run's dispatch bars
  overlapping surfaces outright, and `mdtoc.py` is small enough (one regex, a
  ~20-line scanner, two short pure functions, an argparse `main`) that splitting
  it buys no wall-clock time while adding a merge-order hazard. Fully parallel
  impl+tests with no `depends_on` was also rejected: each test task's acceptance
  is "pytest passes", unverifiable by its Implementer before the code exists.
- **Consequences:** One serialization point (01), then maximum parallelism. Task
  01 is the largest single task; its interface is fully pinned above, so 02/03
  Implementers need no coordination with it beyond the merge.

### ADR-8: Environment constraints inherited from the wordfreq run's verified findings
- **Context:** This plan was produced without shell access to probe the
  environment. The wordfreq run (same repo, same machine, completed G3) verified by
  execution — with command output recorded in its plan ADR-8/ADR-9 and task 04
  notes — that: `/usr/bin/python3` is Python **3.9.6** and the only interpreter;
  pytest 8.4.2 is installed and runs; PEP 604 unions in evaluated annotations raise
  `TypeError` on it; `sys.stdlib_module_names` does not exist on it; and this
  machine's prefix `site-packages` nests *inside* the sysconfig stdlib directory,
  defeating naive path-containment stdlib checks.
- **Choice:** Bind this run to those findings: (a) no PEP 604 in evaluated
  annotations, `typing.Optional`/`Union` spellings only; PEP 585 subscriptions
  allowed. (b) AC10.2's stdlib membership check uses wordfreq ADR-9's sanctioned
  mechanism verbatim: a root module name is stdlib iff it's in
  `sys.builtin_module_names`, or its `importlib.util.find_spec` origin is
  `"built-in"`/`"frozen"`, or its origin is a file under
  `sysconfig.get_paths()["stdlib"]` **whose resolved path contains no
  `site-packages` or `dist-packages` component** (the rejection is mandatory —
  wordfreq review-04 F1 showed the check is unsound without it); also assert
  `node.level == 0` on every `ImportFrom` and that the collected root set is
  non-empty. (c) AC10.3 is satisfied by `subprocess.run([sys.executable, "-m",
  "py_compile", script])` — `sys.executable` *is* 3.9.6 here — plus an
  interpreter-independent AST scan asserting no `ast.BinOp` occurs inside any
  annotation expression (arg annotations, `returns`, `AnnAssign.annotation`),
  which keeps the test meaningful if a future environment runs it on 3.10+.
- **Rejected:** (a) Treating the environment as unknown and leaving mechanisms to
  Implementers — that exact gap cost wordfreq two review rounds (its ADR-8/ADR-9);
  the findings are recorded, executed evidence from this machine. (b) Requiring a
  3.10+ interpreter — environment provisioning outside the run's surface, for zero
  semantic gain. (c) A hard-coded stdlib name list — a drifting copy of
  interpreter internals (wordfreq ADR-9 rejection (b)).
- **Consequences:** All pinned signatures above use `Optional[...]`. Task 03's
  AC10.2/AC10.3 test text references this ADR's mechanisms, not
  `sys.stdlib_module_names`. If the environment has drifted since wordfreq
  (risk below), task 01's first execution surfaces it immediately.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 — CLI input, stdout-only | 01-mdtoc-cli, 03-cli-tests |
| R2 — ATX heading detection | 01-mdtoc-cli, 02-unit-tests |
| R3 — fenced-block exclusion | 01-mdtoc-cli, 02-unit-tests |
| R4 — GitHub anchor generation | 01-mdtoc-cli, 02-unit-tests |
| R5 — duplicate disambiguation | 01-mdtoc-cli, 02-unit-tests |
| R6 — nested list output | 01-mdtoc-cli, 02-unit-tests, 03-cli-tests (byte-exact e2e) |
| R7 — invalid input handling | 01-mdtoc-cli, 03-cli-tests |
| R8 — headingless is success | 01-mdtoc-cli, 02-unit-tests, 03-cli-tests |
| R9 — automated test coverage | 02-unit-tests, 03-cli-tests |
| R10 — single 3.9 stdlib file | 01-mdtoc-cli (bound by it), 03-cli-tests (verifies AC10.1–10.3) |

## Risks

- **Environment drift since the wordfreq run** — ADR-8's constraints are inherited
  evidence, not re-probed in this dispatch. *Early signal:* task 01's first
  `python3 -c "import mdtoc"` or task 02's first `pytest` fails on
  interpreter/tooling grounds. *Mitigation:* escalate as environment provisioning;
  do not silently swap mechanisms — a substitute needs equivalence scrutiny
  (wordfreq review-04 F1 precedent).
- **`import mdtoc` fails under pytest** if run from the wrong directory. *Early
  signal:* `ImportError` on task 02's first run. *Mitigation:* AC9.1 mandates
  running from `apps/mdtoc/`; if it still fails, task 02 may add an empty
  `apps/mdtoc/conftest.py` (test infrastructure, outside AC10.1's single-file
  count — record in task notes).
- **Byte-exactness of AC6.1/AC8.x** broken by `print()` (its own newline) or
  platform line endings. *Early signal:* task 03's exact-bytes test fails while
  semantic tests pass. *Mitigation:* the CLI contract mandates
  `sys.stdout.write(render_toc(...))` with `\n` embedded by `render_toc`, and
  `splitlines()` on input absorbs `\r\n`.
- **Slug/fence edge cases outside the ACs** (e.g., `isdigit` on superscripts,
  info-string quirks, `Overview-1` collisions) triggering review debate.
  *Guardrail:* ADR-3/ADR-4/ADR-5 fix the rules; behavior not pinned by an AC
  follows them as written — findings against non-spec'd behavior must cite a
  requirement or be rebutted in task notes.
- **Serialized start (01 → {02, 03})** — if 01 slips, both test tasks queue.
  *Early signal:* 01 exceeding one focused session. *Mitigation:* 01's every
  interface and mechanism is pinned above; it is transcription plus a small
  scanner, not design work.
