# Review Report: 01-mdtoc-cli

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit b051df6 (branch run/mdtoc)

## Findings

None. No blocking, major, or minor defects identified against spec.md R1–R8,
R10 (R4 as amended, AC4.5) or plan.md's interface contracts / ADR-2 / ADR-3 /
ADR-4 (amended) / ADR-5 / ADR-6 / ADR-8.

## Coverage

Reviewed against spec.md and plan.md directly; the implementer's commit message
was context only. Static reasoning only (per dispatch, no commands beyond git
were run) — each behavior below was traced by hand through the regex, the fence
state machine, and both pure functions.

- **R2 heading rule (AC2.1–AC2.3)** ✓ — `HEADING_RE` is exactly ADR-2's
  `r"^(#{1,6})(?: (.*))?$"` (`mdtoc.py:19`); level = `len(group(1))`, text =
  `(group(2) or "").strip()` (`mdtoc.py:43-44`). Traced: `# Title`/`## Section
  A`/`### Sub A1` → `[(1,'Title'),(2,'Section A'),(3,'Sub A1')]`; `#1234` no
  match (no space/EOL after marker); `####### Seven` no match (backtracking
  cannot satisfy `$` past the 7th `#`). Bare `#`..`######` → text `''`
  (plan's no-AC behavior list). Regex is applied to the raw line, so an
  indented heading is not detected — per ADR-2's pinned consequence. Empty
  and whitespace-only lines match nothing.
- **R3 fence exclusion (AC3.1, AC3.2)** ✓ — two-state scanner
  (`mdtoc.py:31-51`) matches ADR-3 exactly. Open: `lstripped[:3]` equal to
  three backticks or three tildes, full run length recorded, info string
  ignored, `continue` so the opener line is never a heading. Close: stripped
  line non-empty, entirely the fence char, run ≥ opening length — so a
  ```` ```` ```` line closes a ``` fence, a shorter run does not, and a tilde
  line never closes a backtick fence (`lstrip(fence_char)` leaves it intact →
  `run_len != len(stripped)`). Close-line and inside-fence lines never reach
  `HEADING_RE`. Unclosed fence runs to EOF (state persists after the loop).
  `str.splitlines()` used, absorbing `\r\n`.
- **R4 slugify, as amended (AC4.1–AC4.5)** ✓ — predicate filter over
  `text.lower()` keeping `ch.isalpha() or ch.isdigit() or ch in " -_"`, then
  `replace(" ", "-")` (`mdtoc.py:61-63`) — character-for-character ADR-4's
  amended choice; underscores preserved (AC4.5: `Use snake_case Names` →
  `use-snake_case-names`; task's `foo_bar baz` → `foo_bar-baz`). Traced
  AC4.2 (apostrophe dropped, no boundary), AC4.3 (em dash dropped, double
  space → `--`), AC4.4 (backticks dropped). A tab is dropped, not kept —
  the exact defect ADR-4 rejected the `\w\s`-regex idiom over.
- **R5 duplicates (AC5.1)** ✓ — occurrence-count dict (`mdtoc.py:71-76`):
  first occurrence unsuffixed, k-th gets `-{k-1}`; `overview`, `overview-1`,
  `overview-2` in document order. No re-collision check, per ADR-5.
- **R6/R8 rendering (AC6.1, AC6.2, AC8.1, AC8.2)** ✓ — indent `'  ' *
  (level - 1)` from absolute level (`(3,'Deep Start')` alone → 4 spaces);
  line format `'<indent>- [<text>](#<anchor>)\n'` built via `str.format`
  with the text as an argument (braces in heading text cannot corrupt the
  template); empty iterable → `''`, zero characters. `extract_headings('')`
  → `[]`.
- **R1/R7 CLI shell (AC1.1–AC1.3, AC7.1–AC7.3)** ✓ — argparse with
  `prog="mdtoc.py"`, one required positional, missing argument handled by
  argparse itself (exit 2 to stderr); single EAFP handler `(OSError,
  UnicodeDecodeError)` around `open(path, encoding="utf-8")` covering
  missing path / directory / permission / bad UTF-8 → one-line
  `mdtoc.py: error: <reason>` on stderr, return 1 — no LBYL pre-checks, no
  traceback path for anticipated errors (ADR-6). Success writes exactly
  `sys.stdout.write(render_toc(extract_headings(text)))`, return 0; no
  `print()` anywhere; the file is only ever opened for reading — no write
  of any kind (AC1.3). `__main__` guard is the pinned
  `raise SystemExit(main())`.
- **R10 / ADR-8 environment constraints** ✓ — imports are `argparse`, `re`,
  `sys`, `typing` only (stdlib, AC10.2 sense); no PEP 604 union in any
  annotation — `Optional[Sequence[str]]` as pinned; PEP 585 subscriptions
  (`list[tuple[int, str]]`) are 3.9-safe; single non-test `.py` file under
  `apps/mdtoc/` (AC10.1). Module docstring states the R2 heading rule and
  the amended R4 anchor rule as the task scope requires; function docstrings
  match the plan's pinned signatures and semantics essentially verbatim.
- **Not assessed:** concurrency and performance (out of scope); acceptance
  commands were not executed (dispatch restricts execution to git — all 14
  function-level checks and the process-level smoke behaviors were traced
  statically and each checks out).

Minor observations, not findings: argparse's default `-h/--help` writes help
to stdout and exits 0 — the plan's "no flags" pins the tested interface, and
ADR-6 mandates reusing stdlib argparse's G3-proven behavior, so this is not a
deviation. The positional's metavar renders as `file` rather than `FILE` in
usage text; no AC or contract pins usage wording.

## Boundary check

Declared `file_contact_surface`: `apps/mdtoc/mdtoc.py` — the only code file
touched (new file). The diff also edits `runs/mdtoc/state.yaml` (ledger entry
appended, derived `cost_spent_usd`, task status `dispatched` → `in-review`);
that is the orchestrator's own bookkeeping artifact, not product code, and the
gates section is untouched — consistent with the wordfreq review-01 precedent
for pipeline bookkeeping. In bounds.
