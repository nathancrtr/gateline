# Technical Plan: Duplicate-File Finder (dupefind)

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     BUDGET: reference spec requirements by number, never re-quote them. -->

## Approach

Greenfield deliverable at `apps/dupefind/`, following the `apps/<slug>/` layout the
spec's Context names as the repo convention. Three files:

```
apps/dupefind/
  dupefind.py       # the entire tool — the single source file mandated by R9
  test_core.py      # unit tests importing dupefind's functions (R8)
  test_cli.py       # end-to-end tests invoking the script via subprocess (R8)
```

`dupefind.py` is internally layered into **core functions** — `scan_files`
(traversal + regular-file filter, R2), `hash_file` (R3), `find_duplicate_groups`
(size-then-hash detection, R3+R4, grouping/ordering R5), `render_groups` (R5+R6) —
and a **CLI shell** (`main()` — argparse, root validation, exit codes; R1, R7). The
split lives inside one file (R9) and makes R8 trivially satisfiable: `test_core.py`
imports the functions, `test_cli.py` exercises the process boundary. Same layering
that held through G3 in both prior runs.

Data flow: `main()` parses args → validates the root is a directory (ADR-6) →
`scan_files()` lists `(path, size)` for every regular, non-symlink file →
`find_duplicate_groups()` drops 0-byte entries, partitions by size, hashes only
shared sizes, groups by digest, sorts → `render_groups()` renders the blank-line-
separated groups → `main()` writes the result to stdout via `sys.stdout.write` and
returns 0. Invalid root → one stderr line, exit 1 (R7); no duplicates → exit 0 with
zero stdout bytes (R6).

Work is cut into three tasks with **fully disjoint file-contact surfaces** (ADR-7):
01 the whole tool, then 02 (unit tests) and 03 (CLI tests) in parallel.

## Interface contracts

Binding. Tasks 02 and 03 write tests against exactly these signatures and behaviors.

### Module: `apps/dupefind/dupefind.py`

```python
CHUNK_SIZE: int  # 65536 — fixed, not configurable (ADR-3)

def scan_files(root: str) -> list[tuple[str, int]]:
    """Every regular, non-symlink file under `root` at any depth, as
    (path, size_bytes) pairs. Traversal is os.walk(root, followlinks=False)
    (ADR-2): directory symlinks are never descended, which also breaks
    cycles (AC2.2). An entry from `filenames` is included iff
    stat.S_ISREG(os.lstat(path).st_mode) — this single check excludes file
    symlinks (S_ISLNK), broken symlinks, FIFOs, sockets, and device files
    (R2); an OSError from lstat skips the entry silently (ADR-6). `path` is
    os.path.join(dirpath, name) exactly as produced from os.walk(root) —
    never normalized, resolved, or made absolute (R5). 0-byte files ARE
    included here; their exclusion is detection policy (ADR-4). Result
    order is unspecified — callers must not rely on it (ADR-5)."""

def hash_file(path: str) -> str:
    """Hex SHA-256 digest of the file's contents, read in binary
    CHUNK_SIZE chunks (R3, ADR-3). Raises OSError on unreadable paths;
    caller policy in ADR-6."""

def find_duplicate_groups(files: Iterable[tuple[str, int]]) -> list[list[str]]:
    """Duplicate groups per R3/R4/R5. Drops every size-0 entry
    unconditionally, before any hashing (R4). Partitions the rest by size;
    files with a unique size are never hashed or reported (R3
    size-then-hash). Hashes each remaining file; groups by digest; keeps
    only groups with >= 2 members (R5). A file whose read raises OSError
    is skipped silently (ADR-6). Each group is sorted ascending by plain
    str comparison, and the group list is sorted by each group's first
    (already-sorted) path (ADR-5). No duplicates -> []."""

def render_groups(groups: list[list[str]]) -> str:
    """'\\n\\n'.join('\\n'.join(g) for g in groups) + '\\n' when `groups` is
    non-empty; '' (zero characters) when it is empty (R5, R6). One path
    per line, one blank line between groups, single trailing newline after
    the last group, no trailing blank line."""

def main(argv: Optional[Sequence[str]] = None) -> int:
    """Full CLI. argv excludes the program name (None -> sys.argv[1:]).
    Returns the exit code; never raises for anticipated errors (R7)."""

if __name__ == "__main__":
    raise SystemExit(main())
```

> **Environment constraint (inherited, ADR-8):** the execution environment's only
> interpreter is `/usr/bin/python3` = Python **3.9.6**. No PEP 604 unions in any
> evaluated annotation — use `Optional[...]`/`Union[...]` from `typing`. PEP 585
> subscriptions (`list[tuple[str, int]]`, etc.) are 3.9-safe and stay as written.

Expected imports: `argparse`, `hashlib`, `os`, `stat`, `sys` (+ `typing`) — stdlib
only (R9).

### CLI contract (what `test_cli.py` builds against)

- Invocation: `python3 apps/dupefind/dupefind.py DIR` (name per ADR-1). `DIR` is
  the single required positional argument; there are **no flags of any kind** (R1,
  R4 as amended at G0). Any flag-like argument (e.g. `--include-empty`) is rejected
  by argparse itself: usage to stderr, exit 2.
- Exit codes: `0` success, including no duplicates and an empty directory (R6);
  `2` argument errors, emitted by argparse (AC1.2, unknown flags); `1` root errors —
  path does not exist or is not a directory (R7).
- Root validation is an explicit `os.path.isdir(root)` check before walking
  (ADR-6 — LBYL is load-bearing here, see the ADR): if it fails, one line on stderr
  — `dupefind.py: error: no such directory: <root>` when `os.path.exists(root)` is
  false, else `dupefind.py: error: not a directory: <root>` — never a traceback
  (AC7.1/AC7.2), return 1. `argparse` gets `prog="dupefind.py"` so usage text is
  stable regardless of invocation path.
- Success output: exactly
  `sys.stdout.write(render_groups(find_duplicate_groups(scan_files(root))))` —
  byte-exact per AC5.1/AC5.2, zero bytes when there are no groups (AC4.2, AC6.1,
  AC6.2). Never `print()`. Nothing else is ever written to stdout.

### Test-layout contract

- Both test files live in `apps/dupefind/`; `pytest` is run from that directory
  (AC8.1). Tests import the module as `import dupefind` (no `__init__.py` files).
  `test_cli.py` locates the script as `pathlib.Path(__file__).parent /
  "dupefind.py"` and runs it with `subprocess.run([sys.executable, str(script),
  ...], capture_output=True, timeout=30)` — the timeout is mandatory so a FIFO
  regression fails instead of hanging pytest (AC2.3; risk below).
- Fixture trees are built under pytest's `tmp_path`; symlinks via `os.symlink`,
  FIFOs via `os.mkfifo` (present on this darwin environment, ADR-8). Expected
  output paths must be constructed with `os.path.join` from the exact root string
  passed to the tool — never `resolve()`/`realpath()` (the tool doesn't resolve,
  and on macOS `/tmp`-family paths resolve differently than they are spelled).
- Test-name contract for AC8.2 — `test_core.py` must contain individually named
  tests whose names include these substrings: `symlink` and `fifo` (R2),
  `same_size` (R3, the same-size-different-content case), `empty` (R4), `order`
  (R5 grouping/ordering), `no_duplicates` (R6). `test_cli.py` must contain a test
  whose name includes `reproduc` (AC5.2 double-run byte-identity).

### Behavior not covered by any AC (defined here so it can't drift)

- A root that is itself a **symlink to a directory** is accepted
  (`os.path.isdir` follows links); R2's skip rule governs entries *inside* the
  tree only.
- **Hardlinked** paths are ordinary files: compared and grouped by content, no
  inode-awareness (spec assumption 4).
- SHA-256 digest equality **is** content equality — no byte-compare confirmation
  pass; R3 pins the method itself ("by construction").
- Unreadable *subdirectories* during the walk are skipped silently (`os.walk`
  default `onerror=None`); an OSError while lstat-ing or reading a *file* skips
  that file (ADR-6). Neither is an error condition — R7 scopes errors to the root
  argument only.
- "Ascending alphabetical" (R5) = plain Python `str` comparison (codepoint
  order), not locale-aware collation (ADR-5).

## Decisions (ADRs)

### ADR-1: Keep the spec's illustrative name `dupefind.py`
- **Choice:** Adopt the file name used throughout the spec's AC command lines
  as final.
- **Rejected:** Any rename — AC1.1, AC1.2, AC7.1, AC9.2 are written against
  `dupefind.py`; keeping it lets the Verifier run them verbatim (path-prefixed
  with `apps/dupefind/`). Same reasoning as wordfreq ADR-2 and mdtoc ADR-1, both
  of which held through G3.
- **Consequences:** `prog="dupefind.py"` in argparse; tests hardcode the name.

### ADR-2: Traversal via `os.walk(root, followlinks=False)` + one `lstat`/`S_ISREG` filter
- **Choice:** `scan_files` walks with `os.walk(root, followlinks=False)` and
  admits an entry iff `stat.S_ISREG(os.lstat(path).st_mode)`. One predicate
  covers every R2 exclusion: file symlinks and broken symlinks are `S_ISLNK`,
  FIFOs/sockets/devices are their own modes — none is `S_ISREG`. Directory
  symlinks land in `dirnames` and are simply not descended (`followlinks=False`),
  which is also what makes ancestor-pointing cycles terminate (AC2.2).
- **Rejected:** (a) Hand-rolled `os.scandir` recursion — reimplements `os.walk`
  (which is built on scandir) to gain nothing; cycle-safety and non-descent come
  free from `followlinks=False`. (b) `pathlib.Path.rglob("**/*")` — on Python
  3.9, `**` *does* recurse into symlinked directories with no way to disable it
  (the opt-out only arrived in 3.13), so a cycle symlink loops forever —
  disqualified by AC2.2 on this interpreter.
- **Consequences:** The `lstat` result also supplies `st_size`, so the size used
  for partitioning is the size of the path entry itself, never of a link target.
  FIFOs are filtered before anything ever opens them — nothing can block on a
  FIFO read (AC2.3).

### ADR-3: Size partition first; hash only shared sizes; fixed 64 KiB chunked reads
- **Choice:** `find_duplicate_groups` partitions by size and computes SHA-256
  only for files whose size is shared by ≥2 candidates (R3's mandated
  size-then-hash order); digest equality is the duplicate criterion.
  `hash_file` reads in fixed `CHUNK_SIZE = 65536` binary chunks.
- **Rejected:** (a) Hashing every file unconditionally — violates the method R3
  pins ("first comparing file size") and does maximal I/O for zero semantic
  difference. (b) A byte-by-byte confirmation pass after digest match — R3
  declares digest equality sufficient by construction; extra machinery with no
  requirement. (c) Whole-file `read()` — one large file exhausts memory for no
  gain; a *fixed* chunk size is not the "chunked/streaming performance tuning"
  the spec scopes out (that exclusion bars *configurable* tuning knobs, and
  CHUNK_SIZE is a constant, not an option).
- **Consequences:** Unique-size files are provably never opened (a task-01
  acceptance check exploits this: nonexistent paths with distinct sizes must
  produce `[]` without raising). Digest collisions are accepted as impossible
  per R3 — findings proposing byte-compare must cite a requirement.

### ADR-4: 0-byte exclusion lives in `find_duplicate_groups`, not in `scan_files`
- **Choice:** `scan_files` reports every regular file including empty ones
  (pure traversal semantics, R2); `find_duplicate_groups` drops size-0 entries
  as its first step, before any size partitioning or hashing (detection policy,
  R4). The exclusion is unconditional — no parameter, no flag, no environment
  variable anywhere in the module (R4 as amended by the G0 veto).
- **Rejected:** (a) Filtering in `scan_files` — conflates traversal semantics
  with detection policy; R2's and R4's unit tests would no longer be
  independent, and a future traversal change could silently re-admit empty
  files. (b) An `include_empty=False` keyword "for testability" — that is
  exactly the override mechanism the G0 veto struck; AC4.2 requires that no
  mechanism exists.
- **Consequences:** Empty files are never hashed. Task 02 tests R2 via
  `scan_files` (0-byte files present in its output) and R4 via
  `find_duplicate_groups` (absent from groups) without fixture interference.

### ADR-5: Determinism by full sort at the grouping boundary; pinned render formula
- **Choice:** Traversal order is explicitly unspecified; `find_duplicate_groups`
  makes output order fully input-order-independent by sorting each group with
  plain `sorted()` (codepoint order = R5's "ascending alphabetical") and then
  sorting the group list by first member. `render_groups` is the exact formula
  in the interface contract: newline-joined paths, `\n\n` between groups, one
  trailing `\n`, empty input → empty string.
- **Rejected:** (a) Relying on `os.walk`'s directory order for determinism —
  readdir order is filesystem-dependent and unspecified; AC5.2's byte-identity
  guarantee must not rest on it. (b) Locale-aware collation
  (`locale.strxfrm`) — output would vary across environments, violating the
  spirit of AC5.2 and adding an import for behavior no AC requests. (c) A
  trailing blank line after the last group — AC5.1 says stdout is "exactly" the
  groups; the single trailing newline terminates the last path line and nothing
  more.
- **Consequences:** Two runs over an unchanged tree are byte-identical
  regardless of readdir order (AC5.2). Group-first-path sort keys are unique by
  construction (a path appears in at most one group), so no tie-break rule is
  needed.

### ADR-6: LBYL root validation — because `os.walk` swallows bad roots; OSError-skip policy for entries
- **Choice:** `main()` explicitly checks `os.path.isdir(root)` and fails with
  exit 1 before walking (message shapes in the CLI contract). During the scan,
  a per-entry OSError (lstat or read race, permission) skips that entry
  silently; unreadable subdirectories are skipped by `os.walk`'s default
  `onerror=None`.
- **Rejected:** (a) The EAFP pattern from wordfreq/mdtoc ADR-6 — it does not
  transfer: `os.walk` on a nonexistent or non-directory path raises nothing by
  default, it silently yields no entries, so an EAFP-only `main()` would exit 0
  on `does-not-exist-dir` and fail AC7.1/AC7.2 outright. The prior runs' EAFP
  worked because `open()` raises; `os.walk` doesn't. (b) Aborting the whole run
  (exit 1) on a mid-scan OSError — R7 scopes error handling to the root
  argument; aborting would also break AC1.1's exit-0 guarantee on readable
  trees that mutate mid-scan, and silent-skip matches R2's "skipped without
  error" treatment of other unscannable entries.
- **Consequences:** The isdir check races with the filesystem in principle;
  if the root vanishes mid-walk, `os.walk` yields nothing and the tool exits 0
  — acceptable, no AC covers it. Reviewer findings proposing EAFP here must
  address the `os.walk` silent-failure trap this ADR documents.

### ADR-7: Three tasks, fully disjoint file-contact surfaces (inherits mdtoc ADR-7)
- **Choice:** 01 builds all of `dupefind.py` (core + shell); 02
  (`test_core.py`) and 03 (`test_cli.py`) both depend on 01 and run in parallel
  with each other. Every task owns exactly one file; no surface overlaps.
- **Rejected:** (a) Splitting core and CLI shell into separate tasks sharing
  `dupefind.py` — the dispatch bars overlapping surfaces, and the file is small
  (four short functions plus an argparse `main`); wordfreq's shared-file cut
  added a merge-order hazard for no wall-clock gain, which is why mdtoc ADR-7
  replaced it and held through G3. (b) Fully parallel impl+tests with no
  `depends_on` — each test task's acceptance is "pytest passes", unverifiable
  by its Implementer before the code exists.
- **Consequences:** One serialization point (01), then maximum parallelism.
  Task 01's every interface and mechanism is pinned above, so 02/03
  Implementers need no coordination with it beyond the merge.

### ADR-8: Environment constraints inherited from the wordfreq/mdtoc runs' verified findings
- **Context:** The dispatch sanctions inheriting both prior runs'
  executed-and-recorded findings rather than re-probing: `/usr/bin/python3` is
  Python **3.9.6** and the only interpreter; pytest runs; PEP 604 unions in
  evaluated annotations raise `TypeError` there; `sys.stdlib_module_names` is
  absent; this machine's `site-packages` nests *inside* the sysconfig stdlib
  directory, defeating naive path-containment stdlib checks. The environment is
  darwin, so `os.mkfifo` (AC2.3) and `os.symlink` (AC2.2) are available.
- **Choice:** Bind this run to those findings: (a) no PEP 604 in evaluated
  annotations, `typing.Optional`/`Union` spellings only; PEP 585 subscriptions
  allowed. (b) AC9.2's stdlib membership check uses the sanctioned mechanism
  verbatim: a root module name is stdlib iff it's in
  `sys.builtin_module_names`, or its `importlib.util.find_spec` origin is
  `"built-in"`/`"frozen"`, or its origin is a file under
  `sysconfig.get_paths()["stdlib"]` **whose resolved path contains no
  `site-packages` or `dist-packages` component** (the rejection is mandatory —
  wordfreq review-04 F1 showed the check is unsound without it); also assert
  `node.level == 0` on every `ImportFrom` and that the collected root set is
  non-empty. (c) AC9.3 is satisfied by `subprocess.run([sys.executable, "-m",
  "py_compile", script])` — `sys.executable` *is* 3.9.6 here — plus an
  interpreter-independent AST scan asserting no `ast.BinOp` occurs inside any
  annotation expression (arg annotations, `returns`, `AnnAssign.annotation`).
- **Rejected:** (a) Re-probing the environment this dispatch — the findings
  are executed evidence from this machine, twice verified; re-probing spends
  budget to reconfirm them. (b) Treating the environment as unknown and
  leaving mechanisms to Implementers — that gap cost wordfreq two review
  rounds. (c) A hard-coded stdlib name list — a drifting copy of interpreter
  internals (wordfreq ADR-9 rejection (b)).
- **Consequences:** All pinned signatures above use `Optional[...]`. Task 03's
  AC9.2/AC9.3 test text references this ADR's mechanisms, never
  `sys.stdlib_module_names`. If the environment has drifted (risk below), task
  01's first execution surfaces it immediately.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 — CLI directory input | 01-dupefind-cli, 03-cli-tests |
| R2 — recursive traversal, symlinks/non-regular skipped | 01-dupefind-cli, 02-unit-tests, 03-cli-tests (AC2.3 process-level) |
| R3 — size-then-SHA-256 detection | 01-dupefind-cli, 02-unit-tests |
| R4 — unconditional empty-file exclusion | 01-dupefind-cli, 02-unit-tests, 03-cli-tests (AC4.2 incl. flag rejection) |
| R5 — output format and determinism | 01-dupefind-cli, 02-unit-tests, 03-cli-tests (byte-exact e2e, double-run) |
| R6 — no-duplicates success case | 01-dupefind-cli, 02-unit-tests, 03-cli-tests |
| R7 — invalid root handling | 01-dupefind-cli, 03-cli-tests |
| R8 — automated test coverage | 02-unit-tests, 03-cli-tests |
| R9 — single 3.9 stdlib file | 01-dupefind-cli (bound by it), 03-cli-tests (verifies AC9.1–9.3) |

## Risks

- **Environment drift since the prior runs** — ADR-8's constraints are inherited
  evidence, not re-probed in this dispatch. *Early signal:* task 01's first
  `python3 -c "import dupefind"` or task 02's first `pytest` fails on
  interpreter/tooling grounds. *Mitigation:* escalate as environment
  provisioning; never silently swap mechanisms (wordfreq review-04 F1 precedent).
- **FIFO-induced hang instead of failure** — if a filter regression lets a FIFO
  reach `hash_file`, `open()` blocks forever, and a hung test is worse than a red
  one. *Early signal:* the `subprocess.run(..., timeout=30)` in test_cli raises
  `TimeoutExpired`. *Mitigation:* the timeout is mandated by the test-layout
  contract; task 02's `fifo` test asserts on `scan_files` output only (listing
  never opens entries, so the unit test cannot hang).
- **`os.walk` silent-failure trap on a bad root** — plain EAFP exits 0 on a
  nonexistent root, failing AC7.1/AC7.2 in a way that looks like success.
  *Early signal:* task 03's AC7 tests. *Mitigation:* ADR-6 mandates the explicit
  `isdir` check; the ADR documents the trap so review doesn't "simplify" it away.
- **Byte-exactness of AC5.x/AC4.2/AC6.x broken by `print()` or extra separators**
  (trailing blank line, missing final newline). *Early signal:* task 03's
  exact-bytes tests fail while semantic tests pass. *Mitigation:* the CLI
  contract mandates `sys.stdout.write` and ADR-5 pins the render formula
  character-for-character.
- **macOS path-resolution mismatch in tests** — comparing tool output against
  `tmp_path.resolve()`-derived strings fails because the tool never resolves
  (R5) while macOS tmp dirs are symlinked (`/tmp` → `/private/tmp`). *Early
  signal:* path-comparison assertions failing only on group members. *Mitigation:*
  test-layout contract mandates building expectations by `os.path.join` from the
  exact root string passed to the tool.
- **Serialized start (01 → {02, 03})** — if 01 slips, both test tasks queue.
  *Early signal:* 01 exceeding one focused session. *Mitigation:* 01 is
  transcription of pinned mechanisms (a walk-and-filter, a hash loop, a
  sort-and-join, an argparse `main`), not design work.
