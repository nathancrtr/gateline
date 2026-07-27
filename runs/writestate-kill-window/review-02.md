# Review Report: 02-refusal-message

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit cd651a4 on `run/writestate-kill-window`

## Findings

### F1 — minor — Slug assertion cannot distinguish "named as the run" from a path substring
- **Where:** `frontend/packages/core/test/write-recovery.test.ts:203`
- **Failure scenario:** A mutant that drops the `run ${ref.slug} refused:` prefix (local-source.ts:362) but keeps both remedies still passes all four assertions, because `toContain(ref.slug)` is satisfied by `runs/g1-pending/state.yaml` alone — the plan's "named as the run (not only inside a path)" clause loses its only test.
- **Requirement:** plan "Interface contracts → Surviving refusal message", first bullet. Non-blocking: AC3.1's own wording ("includes the run's slug") is met, and the task scope prescribed exactly these component assertions.

### F2 — minor — Two-remedy requirement has no discriminating test
- **Where:** `frontend/packages/core/test/write-recovery.test.ts:206`
- **Failure scenario:** A mutant emitting only the discard remedy (or only the keep remedy) passes the `at least one full git -C ... -- .../state.yaml command` regex; the plan requires both a keep and a discard command in the message.
- **Requirement:** plan "Interface contracts → Surviving refusal message", third bullet. Non-blocking for the same reason as F1: the task scope itself specified "at least one".

### F3 — minor — Remedy commands are not copy-pasteable when the checkout path contains spaces (PLAUSIBLE)
- **Where:** `frontend/packages/core/src/sources/local-source.ts:363-364`
- **Failure scenario:** A checkout at a path with a space (e.g. `/Users/op/My Repos/...`) yields `git -C /Users/op/My Repos/... commit ...`, which a shell splits at the space — the pasted remedy errors instead of resolving the refusal (AC3.1's "copy-pasteable"). PLAUSIBLE: no fixture exercises such a path, and the plan's own contract writes the path unquoted; quoting is within the message's adjustable wording, no contract change needed.
- **Requirement:** AC3.1

## Coverage

I checked the rewritten refusal message and its new test against the spec, the plan's message contract, and the full frontend suite, and found everything clean apart from the three minor findings above.

- R3/AC3.1 message content ✓ — slug named as the run, checkout path, state-file path, and both literal remedies present (local-source.ts:362-364); the keep remedy matches the plan's exact `commit -m "state(<slug>): manual recovery" -- <statePath>` shape and the discard remedy the `checkout -- <statePath>` shape, both scoped with `git -C <worktree.path>`
- Remedy correctness ✓ — the relative `statePath` pathspec resolves under `git -C <worktree.path>` (worktree root = repo root for pathspec purposes), and `git commit -- <path>` commits worktree content without staging, so the keep remedy genuinely clears the refusal
- Reason string ✓ — `'dirty-worktree'` literal untouched (local-source.ts:360); the server's HTTP 423 mapping still keys off it (app.ts:450), and no other code or test matches on the old message text (write-path.test.ts:107 asserts reason only)
- New test validity ✓ — it provokes a genuinely unattributable refusal (hand edit with the intent ref proven absent, mirroring write-path.test.ts's dirty case) and asserts components, not a frozen sentence, per the task scope
- R5/AC5.1 ✓ — ran `npm test` (567 passed, 2 skipped, 0 failed — including every pre-existing write-path.test.ts case) and `npm run typecheck` (clean) in `frontend/` on Node v24.12.0
- Task 01 interaction ✓ — the refusal is the same fall-through the recovery predicate misses into; recovery-eligible dirt still self-heals (write-recovery.test.ts:56-105 unchanged and passing)
- Concurrency not assessed — no concurrent access in this task's scope

## Boundary check

Clean. `git diff cd651a4^..cd651a4 --name-only` shows exactly the two declared files — `frontend/packages/core/src/sources/local-source.ts` and `frontend/packages/core/test/write-recovery.test.ts` — and the local-source.ts hunk touches only the `message` field of the dirty-worktree refusal, as the scope's "touch nothing else in the file" demands.
