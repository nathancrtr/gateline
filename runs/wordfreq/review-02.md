# Review Report: 02-cli-shell

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit c494808 (branch run/wordfreq)

## Findings

### F1 — minor — plan.md's "binding" interface contract pins annotation syntax that cannot execute in this environment; code correctly deviates, but the plan text is now stale
- **Where:** `apps/wordfreq/wordfreq.py:43` (deviating line) vs `runs/wordfreq/plan.md:65` (pinned `def main(argv: Sequence[str] | None = None) -> int:`)
- **Failure scenario:** Not a defect in the diff — the diff is the fix. The residual
  risk is downstream: plan.md declares its interface contracts "binding" and tells
  task 03/04 implementers to "write tests against exactly these signatures". An
  implementer who copies the pinned PEP 604 annotation verbatim into their own code
  (e.g., a typed test helper) gets `TypeError: unsupported operand type(s) for |:
  '_GenericAlias' and 'NoneType'` at import time — I reproduced this on the
  environment's only interpreter (`/usr/bin/python3`, 3.9.6; no 3.10+ on PATH).
  Recommend the Architect amend plan.md's pinned signature to
  `Optional[Sequence[str]]` (or record a py3.9 floor) so the plan and shipped code
  agree. Non-blocking for this task: the code as delivered is correct.
- **Requirement:** plan.md "Interface contracts" (module signature pin)

**Assessment of the logged deviation (requested by dispatch):** The deviation is
sound and semantically equivalent, and does not warrant an `escalate` verdict.
Verified independently:
- `/usr/bin/python3` is 3.9.6 and is the only python3 on PATH; `Sequence[str] | None`
  in a parameter annotation raises TypeError at def time on it (reproduced), so the
  pinned form is genuinely uninstantiable here, not a style preference.
- `typing.Optional[Sequence[str]] == typing.Union[Sequence[str], None]` is `True`
  (verified); PEP 604's `X | None` denotes exactly this union. Parameter name,
  default, and return type are unchanged, so every consumer pinned by the plan
  (tasks 03/04 call `main(argv)` / test behavior at the call boundary) is unaffected
  — annotations have no call-site or runtime behavioral effect beyond the def-time
  evaluation that was the problem.
- The rejected alternative (`from __future__ import annotations`) was rejected for a
  defensible reason: AC10.2's AST one-liner would print `annotations`
  (`ImportFrom.names[0].name`), which is not an importable stdlib module name, so a
  strict grading of AC10.2 could fail. The chosen fix avoids that ambiguity using an
  import the file already had.
- Why not escalate: the escalation rule targets plan defects the code would have to
  paper over or that poison downstream tasks. Here the plan's *semantic* contract is
  fully satisfied by an equivalent spelling; nothing upstream must change for this
  diff or tasks 03/04 to be correct. The only upstream action is the documentation
  amendment in F1, which G2 can route to the Architect without stopping the run.

## Coverage

Reviewed the full post-diff file (`git show c494808:apps/wordfreq/wordfreq.py`)
against spec.md and plan.md directly. Checked and found clean:

- **R1 (AC1.1, AC1.2)** — required positional `file` via argparse; missing arg
  produces argparse's own usage/error on stderr with exit 2 (SystemExit from
  `parse_args` propagates past `main()`, which matches the plan's CLI contract:
  "exit 2 argument errors, emitted by argparse itself"). ✓
- **R4 (AC4.1–4.3)** — `-n/--top`, `dest="n"`, `type=positive_int`, `default=10`
  exactly as pinned. `positive_int` raises `argparse.ArgumentTypeError` for n < 1
  (→ argparse error, exit 2); non-integer values raise ValueError from `int()`,
  which argparse also converts to an exit-2 usage error. n > distinct-word-count is
  handled by task 01's `[:n]` slice — no padding, no error. ✓
- **R6 (AC6.1)** — success path is byte-for-byte
  `sys.stdout.write(format_lines(top_words(tokenize(text), args.n)))`; no `print()`
  on stdout anywhere; nothing else ever written to stdout. ✓
- **R7 (AC7.1, AC7.2) / ADR-6** — single try/except around open-and-read catching
  `(OSError, UnicodeDecodeError)`; covers FileNotFoundError, IsADirectoryError,
  PermissionError (all OSError subclasses) and bad UTF-8 during `f.read()` (inside
  the try). Message is `wordfreq.py: error: {exc}` on stderr, return 1, no
  traceback. Single-line guarantee probed adversarially: `str(OSError)` renders the
  filename via `repr()`, so even a path containing a literal newline yields one
  stderr line (verified: `'[Errno 2] No such file or directory: \'a\\nb\''`);
  `str(UnicodeDecodeError)` is likewise single-line. No LBYL pre-checks, per ADR-6. ✓
- **R8 (AC8.1, AC8.2)** — wordless text → `tokenize` returns `[]` → `format_lines`
  returns `''` → `sys.stdout.write('')` writes zero bytes, return 0. ✓
- **R10 (AC10.1, AC10.2)** — no new files; new imports are argparse and sys plus
  names from the pre-existing typing import — all stdlib. The AC10.2 one-liner over
  the post-diff file prints `argparse, re, sys, Counter, Iterable`, all
  stdlib-importable names. (The checker's names[0]-only reading is a pre-existing
  quirk from task 01's `from collections import Counter`, not something this diff
  introduced or exploits.) ✓
- **Task 01 non-interference** — diff adds only imports and appended code; the
  bodies and signatures of `tokenize`, `top_words`, `format_lines`, and `WORD_RE`
  are untouched, as the task scope demands. ✓
- **Entry point** — `if __name__ == "__main__": raise SystemExit(main())` verbatim
  per the pinned contract; `prog="wordfreq.py"` set per ADR-2. ✓
- Not assessed: concurrency (none in scope); performance on large files (explicitly
  out of scope per spec); pytest suite execution (Verifier's lane — implementer
  reports 12 passed, not relied on for this verdict).

## Boundary check

Declared surface: `apps/wordfreq/wordfreq.py` — the only code file touched. ✓
The diff also edits `runs/wordfreq/tasks/02-cli-shell.yaml` (status → in-review,
deviation + test notes). That file is not in `file_contact_surface`, but updating
the task's own status/notes is a mandated Implementer output
(`roles/implementer.md`: outputs include "task notes"; instruction 4 requires
recording deviations there), so it is process artifact, not an out-of-bounds code
change. No other files touched. In bounds.
