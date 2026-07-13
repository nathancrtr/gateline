# Review Report: 02-unit-tests

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 72b597a (branch run/dupefind; `apps/dupefind/test_core.py` only — `test_cli.py` is task 03, not reviewed here)

## Findings

### F1 — blocking — the "unique-size files never opened" probe cannot detect a hash-before-size-partition pipeline; the mutant survives all 16 tests
- **Where:** `apps/dupefind/test_core.py:212-224` (`test_find_duplicate_groups_unique_size_files_never_opened`)
- **Failure scenario:** Mutant: delete `if len(paths) < 2: continue` from `find_duplicate_groups` (dupefind.py:82-83), i.e. hash every non-empty file unconditionally — the method R3 forbids. The nonexistent-path probe then calls `hash_file("/does/not/exist/one")`, whose `FileNotFoundError` is swallowed by the same function's mandated `except OSError: continue` (ADR-6, dupefind.py:86-88), yielding `[]` — the test passes. Every real-tree fixture also passes (extra hashes form singleton digest groups filtered by `>= 2`). The commit message's "never-opened proof" claim is false: ADR-6's skip policy defeats an exception-based probe by design. Fix shape: `monkeypatch.setattr(dupefind, "hash_file", <recorder/fail>)` over a real tree of unique-size files and assert zero calls — `AssertionError`/`pytest.fail` is not `OSError`, so it propagates.
- **Requirement:** R3 (size-then-hash is the pinned method); plan ADR-3 consequence; task scope "size-then-hash detection".

### F2 — blocking — no fixture discriminates full-path sort from basename sort; both wrong-sort-key mutants survive all 16 tests
- **Where:** `apps/dupefind/test_core.py:227-267` (order test; all group fixtures generally)
- **Failure scenario:** Mutants: `sorted(paths, key=os.path.basename)` at dupefind.py:90 and/or `groups.sort(key=lambda g: os.path.basename(g[0]))` at dupefind.py:91. Every duplicate set in the suite is either same-directory (order test, AC2.2, AC3.x, AC4.1 fixtures) or has basename order agreeing with full-path order (AC2.1: `a/x.txt`/`b/c/y.txt` → `x.txt`/`y.txt`). Killer fixture: identical files `root/b/a.txt` and `root/a/z.txt` — correct output `[root/a/z.txt, root/b/a.txt]`, mutant emits the reverse; extend analogously for the group-list key. The suite kills first-vs-last-member and descending sorts (good) but not this wrong key.
- **Requirement:** R5 / AC5.1 (member paths in ascending order — of the *path* string, ADR-5); dispatch adversarial focus "wrong sort key".

### F3 — major — empty-exclusion boundary tested only at 0; an off-by-one threshold mutant survives
- **Where:** `apps/dupefind/test_core.py:100-146` (the `empty` tests; fixture contents suite-wide)
- **Failure scenario:** Mutant: `if size == 0` → `if size <= 1` at dupefind.py:76. No fixture in the file contains a 1-byte file (smallest duplicate content is 5 bytes), so all 16 tests pass while the mutant silently drops legitimate 1-byte duplicates (two files each containing `"x"` → correct: one group; mutant: no output). Killer: a 1-byte duplicate pair asserted present in a group, adjacent to the 0-byte exclusion assertions.
- **Requirement:** R3+R4 boundary (exclusion is size 0 exactly; 1-byte identical files are duplicates per R3).

### F4 — major — R5's "paths as constructed from the given root, never resolved" clause has no discriminating test; a `realpath` mutant survives
- **Where:** `apps/dupefind/test_core.py` (all scan_files fixtures)
- **Failure scenario:** Mutant: `path = os.path.realpath(os.path.join(dirpath, name))` at dupefind.py:38. pytest's `tmp_path` is already fully resolved on this darwin host (`/private/var/...`), so every path comparison in the suite is identical under the mutant — all 16 pass, while any root spelled through a symlink (accepted per plan "Behavior not covered": a symlink-to-directory root) prints resolved paths, violating R5. Killer: `os.symlink(real_root, link_root)`; call `scan_files(str(link_root))`; expect `link_root`-joined paths (built with `os.path.join` from that root string, per the test-layout contract).
- **Requirement:** R5 (no resolution to absolute/real path); plan interface contract for `scan_files`.

### F5 — minor — no dotfile fixture; a skip-hidden-files mutant survives
- **Where:** `apps/dupefind/test_core.py` (all traversal fixtures)
- **Failure scenario:** Mutant: `if name.startswith("."): continue` inside the scan loop (dupefind.py:35) — a behavior many real dedup tools have, so a plausible drift. Two identical `root/.h1`/`root/.h2` files: correct output groups them; mutant returns nothing; all 16 tests pass. One hidden-file duplicate pair in any existing fixture kills it.
- **Requirement:** R2 (all regular files at any depth; hidden files are not an exclusion).

## Coverage

- **Task scope bullets:** every required-coverage bullet has a matching passing-by-construction test — AC2.1, AC2.2 (file symlink + ancestor-cycle dir symlink, group assertions on real files only), AC2.3 (asserts on `scan_files` only, per the no-hang rule), ADR-4 boundary (0-byte present in scan output with size 0; absent from groups — both layers tested independently), AC3.1–3.3, AC4.1/4.2 (incl. `render_groups(...) == ""`), AC5.1/AC5.3 with shuffled-input re-check (ADR-5), exact render formula both cases, AC6.1/6.2. Checked clean.
- **Test-name contract (AC8.2):** `symlink`, `fifo`, `same_size`, `empty`, `order`, `no_duplicates` all present as distinct test-name substrings. Clean.
- **Mutants confirmed killed by trace:** `os.stat` instead of `os.lstat` (file-symlink assertion), `followlinks=True` (cycle test's exact group equality — looped duplicate paths would break it), size-only grouping (`same_size`), descending internal sort and last-member group-list key (order fixture's aaa/zzz vs bbb/ccc construction — good discriminating design), digest-group threshold `>2` (AC3.1) and size-partition threshold `<3` (AC3.1), 0-byte inclusion (AC4 tests), ADR-4 placement swap (scan-includes-empty test), render separator/trailing-newline/empty-input variants (exact-string tests), swapped tuple order, non-recursive walk (AC2.1 depths), added `include_empty` kwarg (the `inspect.signature` check pins params to `["files"]`).
- **Constraints:** stdlib-only imports (`inspect`, `os`), no annotations (3.9-safe), no `__init__.py`, no modification of `dupefind.py`, no `.resolve()`/`realpath` in expectation-building, no duplication of task 03's process-level tests (no subprocess/exit-code/stderr assertions). Clean.
- **Not assessed:** whether the suite actually exits 0 on this host (reviewer runs nothing; traced all assertions against the approved implementation and found none that would fail); an environment-variable empty-file override mutant is unkillable at unit level without knowing the variable name — CLI-level "no mechanism" enforcement is task 03's AC4.2 surface.

## Boundary check

Declared surface is `apps/dupefind/test_core.py` only; the diff also touches `runs/dupefind/state.yaml` (ledger entry 8, task 02 → in-review, spent total). That is orchestrator bookkeeping identical in kind to every prior task commit on this branch (e.g. ea19be8, ff0e6ac) and contains no gate-approval writes — not charged as a finding. No other files touched; `dupefind.py` untouched as mandated.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** 808bfbf (delta over 72b597a; `apps/dupefind/test_core.py`, 16 → 21 tests)

## Resolution of round-1 findings

- **F1 (blocking) — RESOLVED.** `test_core.py:242-274`: the nonexistent-path probe is replaced by a monkeypatch recorder over a real unique-size tree (1/2/3-byte files, uniqueness sanity-asserted). Traced: `find_duplicate_groups` resolves `hash_file` via the module global, so `monkeypatch.setattr(dupefind, "hash_file", ...)` intercepts it; the recorder raises `AssertionError`, which `except OSError` (dupefind.py:86-88) cannot swallow — under the guard-deletion mutant the first singleton size class now fails the test. Belt-and-braces `assert calls == []` also kills a hypothetical broad-except mutant. Correct implementation never calls the recorder → passes.
- **F2 (blocking) — RESOLVED, both sort sites.** `test_core.py:317-333`: `root/b/a.txt` vs `root/a/z.txt` identical — path order `[a/z, b/a]`, basename order the reverse; the member-level `key=os.path.basename` mutant now fails. `test_core.py:335-358`: groups under `aaaa/` (basenames `zzz*`) vs `zzzz/` (basenames `aaa*`) — full-path first-member order `[low, high]`, basename-of-first-member order the reverse; the group-list-key mutant now fails. Within-group basenames agree with path order (same directory), so the two sites are correctly isolated from each other.
- **F3 (major) — RESOLVED.** `test_core.py:170-184`: 1-byte duplicate pair (`getsize == 1` sanity-asserted) must form a group; the `size <= 1` off-by-one mutant now fails while all 0-byte exclusion tests still pass.
- **F4 (major) — RESOLVED.** `test_core.py:361-382`: scan through an explicit symlinked root (`link_root → real_root`); expected path built by `os.path.join` from the link-root string, and the resolved-target spelling asserted absent. Traced: `os.walk(link_root)` lists through the symlink (followlinks only governs sub-entries), yields link-root-spelled paths under the correct implementation; the `realpath` mutant emits `real_root`-spelled paths → both assertions fail it. Test-layout contract respected (no `.resolve()`/`realpath` in expectation-building — `realpath` appears only in a comment and the *negative* expectation constructed via join).
- **F5 (minor) — RESOLVED.** `test_core.py:97-114`: hidden duplicate pair `.h1`/`.h2` scanned and grouped; the skip-dotfiles mutant now fails.

## Delta coverage

- **AC8.2 name contract survived:** `symlink` (2 tests), `fifo`, `same_size`, `empty` (4), `order`, `no_duplicates` (2) all still present as distinct test-name substrings; all 16 round-1 tests intact and unmodified except the F1 rewrite, which keeps its original name.
- **New tests checked for self-consistency against the approved implementation:** all five pass by trace (unique sizes in the F1 fixture; distinct content/sizes per group in the F2 fixtures with ≥2 members per size class; lstat through a followed intermediate symlink still `S_ISREG` for the F4 file). No new imports; `monkeypatch`/`tmp_path` are pytest fixtures (stdlib + pytest constraint holds); no annotations (3.9-safe); no `__init__.py`; `dupefind.py` untouched; still no process-level duplication of task 03.
- **No new surviving mutants identified in the delta:** the added fixtures are assertion-tightening only; they introduce no behavior the round-1 analysis did not already cover.

## Boundary check (round 2)

`apps/dupefind/test_core.py` plus `runs/dupefind/state.yaml` (ledger entry 12, spent total — metering only, no task-status or gate writes). Within surface; bookkeeping excepted per round 1.
