# Review Report: 01-dupefind-cli

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit ea19be8 (branch run/dupefind)

## Findings

### F1 — blocking — argparse auto-help leaves `-h`/`--help` as accepted flags, violating the no-flags CLI contract
- **Where:** `apps/dupefind/dupefind.py:105` (`ArgumentParser(prog="dupefind.py")` without `add_help=False`)
- **Failure scenario:** `python3 apps/dupefind/dupefind.py --help` (or `-h`, even alongside a valid dir) exits **0** and writes usage to **stdout** — the plan's CLI contract requires every flag-like argument to be rejected by argparse with usage on stderr and exit 2, and requires that nothing but rendered groups is ever written to stdout. Task 03 tests written to that contract text ("any flag-like argument") fail against this build.
- **Requirement:** plan.md CLI contract (no flags of any kind; flag-like → exit 2; stdout exclusivity); spec Out of scope "Any CLI flags whatsoever beyond the single required positional directory argument" (R1, R4 as amended at G0). Fix is one argument: `add_help=False` — argparse then rejects `--help` as unrecognized, exit 2, stderr.

### F2 — minor (PLAUSIBLE) — TOCTOU: regular file swapped for a FIFO between scan and hash blocks `open()` forever
- **Where:** `apps/dupefind/dupefind.py:52` (plain `open(path, "rb")` after the lstat at line 39)
- **Failure scenario:** entry passes `S_ISREG` in `scan_files`, is unlinked and replaced by a FIFO before `hash_file` opens it (its size bucket has ≥2 members) → `open()` blocks on the FIFO with no writer → the run hangs rather than skipping. PLAUSIBLE only: requires an adversarial mid-scan mutation; no AC covers a mutating tree.
- **Requirement:** none violated — ADR-6's consequences explicitly accept filesystem races, and ADR-3/task 01 pin `hash_file` as plain chunked `open`. Recorded for G2 because ADR-2's "nothing can block on a FIFO read" claim holds only for static trees; if the human wants this closed (e.g. `O_NONBLOCK` + regularity re-check), that is a plan change, not an implementer defect.

### F3 — minor (PLAUSIBLE) — TOCTOU: same-size files truncated to 0 between lstat and hash are reported as a duplicate group of (now-)empty files
- **Where:** `apps/dupefind/dupefind.py:72-74` (size-0 drop keyed to scan-time `st_size` only; never re-checked at hash time)
- **Failure scenario:** two files lstat at size N>0, both truncated to 0 before line 82 hashes them → both digest to SHA-256("") → reported as a group, i.e. empty files appear in output despite R4's "never reported". PLAUSIBLE only: static trees (all of AC4.x/AC5.x) cannot trigger it, and no user-accessible mechanism is involved — the R4 no-override guarantee itself is intact in code.
- **Requirement:** R4 prose under a mutating tree; behavior matches the plan verbatim (find_duplicate_groups drops size-0 *entries*), and ADR-6 accepts mid-scan mutation — so any tightening is a plan escalation, not a task-01 fix.

### F4 — minor — commit touches `runs/dupefind/state.yaml`, outside the task's declared file_contact_surface
- **Where:** `runs/dupefind/state.yaml` (ledger entry 4, spent total, task status dispatched→in-review)
- **Failure scenario:** none — the delta is orchestrator dispatch metering per the operating mode, not implementer product; gates untouched. Recorded because out-of-surface changes are automatic findings; G2 may dismiss with attribution to the orchestrator.
- **Requirement:** tasks/01-dupefind-cli.yaml `file_contact_surface` (apps/dupefind/dupefind.py only).

## Coverage

Checked against spec.md (R1–R7, R9; R8 is tasks 02/03) and plan.md interface contracts; static review only — per dispatch I executed nothing but git.

- **R1** — required positional, exit 0 on success path (`dupefind.py:106,118`) ✓; missing-arg → argparse exit 2 with usage on stderr (mechanism verified by reading, AC1.2) ✓. Flag handling is the F1 exception.
- **R2** — `os.walk(root, followlinks=False)` (line 35): directory symlinks never descended, cycles terminate (AC2.2) ✓; single `S_ISREG(os.lstat(...))` predicate (39–42) excludes file symlinks, broken symlinks, FIFOs, sockets, devices exactly as ADR-2 pins; static FIFOs are filtered before anything opens them (AC2.3) ✓; size taken from the same lstat, never a link target ✓.
- **R3 pipeline** — size-0 drop precedes partitioning (72–74); size partition (70–74); hashing gated on bucket len ≥ 2 (78–79) so unique sizes are provably never opened (ADR-3 acceptance check holds) ✓; same-size-different-content lands under distinct digest keys, never co-grouped (AC3.2) ✓; n-way groups stay whole (AC3.3) ✓. `by_digest` is shared across size buckets — cross-size merging requires a SHA-256 collision, which R3/ADR-3 declare out of bounds for findings ✓.
- **R4** — drop is unconditional; audited the whole module for override paths: no keyword parameter, no `os.environ`/`getenv`, no flag (argparse defines only the positional; `--include-empty` → unrecognized → exit 2), no code path from `main` that bypasses `find_duplicate_groups` ✓. No reintroduced override found. Residual race is F3, not a mechanism.
- **R5** — per-group `sorted()` then outer sort by `group[0]` (87–88), matches ADR-5 (unique keys, no tie-break needed) ✓; render formula character-identical to plan (97–99): `\n\n` join, single trailing `\n`, empty → `''` ✓; paths are `os.path.join(dirpath, name)` from the walk (37), never normalized/resolved ✓; output is input-order-independent, so AC5.2 byte-identity does not rest on readdir order ✓; groups of 1 (including after an OSError skip shrinks a pair) filtered by the ≥2 check (87), so singletons never print (AC5.3) ✓; stdout written only via `sys.stdout.write` (117), no `print()` ✓ (F1's `--help` is the sole other stdout writer).
- **R6** — empty/duplicate-free tree → `[]` → `''` → zero stdout bytes, return 0 ✓.
- **R7** — LBYL `os.path.isdir` before walking (110), per ADR-6 (EAFP trap avoided) ✓; both stderr message shapes match the plan byte-for-byte (112, 114), return 1, no traceback path ✓; broken-symlink root → `exists` false → "no such directory" ✓; symlink-to-dir root accepted and walked (plan "behavior not covered by any AC") ✓.
- **TOCTOU sweep (dispatch focus)** — file vanishes between walk listing and lstat: OSError → silent skip (40–41) ✓; vanishes or becomes unreadable between lstat and hash / mid-read: OSError from `open`/`read` → silent skip (83–84), `with` closes the handle ✓; unreadable subdirectories: `os.walk` default `onerror=None` skip ✓; root vanishing post-isdir → walk yields nothing, exit 0 (ADR-6 accepts) ✓. Unhandled residuals are F2/F3 only.
- **R9** — one non-test `.py` file; imports exactly the plan's expected set (argparse, hashlib, os, stat, sys, typing) ✓; PEP 585 subscriptions only, no PEP 604 anywhere (annotations at 22, 47, 61, 92, 102 inspected) ✓; module docstring states both the R3 rule and the R4 unconditional exclusion, per task scope ✓; `__main__` guard is the pinned `raise SystemExit(main())` ✓.
- **Not assessed:** runtime behavior (nothing executed); test files (tasks 02/03, not yet landed). Note for those tasks: `main()` propagates argparse's `SystemExit` for argument errors — that is the plan's pinned mechanism, but direct `main([...])` calls in tests must expect it.

## Boundary check

`apps/dupefind/dupefind.py` — inside the declared surface ✓. The same commit modifies `runs/dupefind/state.yaml` (ledger/status metering); attributed to the orchestrator, not the implementer's work product — recorded as F4 (minor) so the audit trail is explicit. No other files touched.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit ff0e6ac (delta ea19be8..ff0e6ac, branch run/dupefind)

## Finding resolutions

- **F1 — resolved.** `apps/dupefind/dupefind.py:105` now `ArgumentParser(prog="dupefind.py", add_help=False)`. Mutant check: with `add_help=False` the parser defines zero optionals, so `-h`/`--help`/any flag-like token hits argparse's error path — usage to **stderr**, exit **2**, zero stdout bytes — exactly the plan CLI contract's "any flag-like argument is rejected by argparse itself". `add_help=False` does not suppress error-time usage printing, so AC1.2 (missing argument → exit 2, usage on stderr) is unaffected, and the stdout-exclusivity guarantee now holds with no exceptions.
- **F2 — stands as written** (minor, PLAUSIBLE, plan-accepted race per ADR-6/ADR-3): line 52 untouched by the delta. Not gating.
- **F3 — stands as written** (minor, PLAUSIBLE, plan-accepted race; matches plan verbatim): lines 72–74 untouched. Not gating.
- **F4 — stands as written** (minor, attribution): this round's commit repeats the pattern — `runs/dupefind/state.yaml` metering only (ledger append, spent sum; gates untouched, ledger remains append-only). Orchestrator bookkeeping, dismissible at G2.

## Delta coverage

- `git log ea19be8..ff0e6ac -- apps/dupefind/` shows exactly one commit; `git diff ea19be8 ff0e6ac -- apps/dupefind/` is 1 insertion / 1 deletion — the single F1 line. No other code changed, so all round-1 clean findings (R1–R7, R9; TOCTOU sweep; no empty-file override path) carry forward without re-derivation.
- `runs/dupefind/state.yaml` delta inspected: cost sum 3.28→3.51, one ledger entry appended (implementer, round 2), G0–G3 gate entries byte-identical. No agent self-approval.
- Static review only; nothing executed but git, per dispatch. The implementer's claim of re-verified success/error paths is corroborated structurally (those paths are untouched by the diff), not by execution.

## Boundary check (round 2)

`apps/dupefind/dupefind.py` — inside the declared surface ✓. `runs/dupefind/state.yaml` — orchestrator metering, per F4 (unchanged position). No other files touched.
