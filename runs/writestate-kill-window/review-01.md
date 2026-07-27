# Review Report: 01-intent-ref-recovery

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 6e6d9d0 (branch `run/writestate-kill-window`)

## Findings

### F1 — minor — AC1.2's test cannot kill an ADR-2 mutant because the recovering write repeats the abandoned write's exact decision
- **Where:** `frontend/packages/core/test/write-recovery.test.ts:80` (asserted at `:99-101`)
- **Failure scenario:** a mutant recovery that commits the intent's recorded content instead of discarding and applying the current call's mutation passes all four tests — `planned1` and `planned2` are identical decisions, so the commit message (`actions.ts:111` omits `notes`), the file bytes, and the commit count (`baseline + 2`) all come out the same either way. Making `planned2` a different decision (different action or burden) would discriminate for free. Minor, not blocking: the spec's third assumption explicitly permits either finish or discard for R1, only plan ADR-2 pins discard, and the shipped implementation does discard.
- **Requirement:** plan ADR-2 (AC1.2's literal no-duplicate/no-orphan criterion *is* discriminated by the count check)

## Coverage

Everything in the task's scope checks out against the plan's pinned contracts, and I re-ran the relevant suites to confirm the implementer's claimed results.

- Requirement coverage R1, R2, R4, R5 ✓ — each mapped AC has a live assertion or an unmodified pre-existing test
- Intent-record lifecycle vs plan "Interface contracts" ✓ — ref name, `hashObject → writeTreeWithBlob → commitTree` with parent `tip` and `options.identity`, force-set before `writeFile`, best-effort swallowed delete after the worktree commit (`local-source.ts:365-390`); ordering verified by reading, since ADR-4's kill patch can only intercept the `commit` step
- Recovery predicate ✓ — all three conditions present and conservative: exact ` M <statePath>` single-line match refuses staged/mixed/typechange dirt (ADR-3); `revParse`'s `^{commit}` peel plus the try/caught `rev-parse <oid>^1` make a missing, non-commit, or parentless intent ref refuse rather than throw; byte comparison via `show(<intent>, <statePath>)`
- Kill-window edge cases traced clean ✓ — kill before `writeFile` (clean checkout, stale ref force-overwritten next write), kill after commit but before ref delete (parent no longer tip, so the stale ref can never validate foreign dirt), fast-forward-then-recover (ff moves tip, parent check refuses)
- Mutation reasoning on the new tests ✓ except F1 — dropped byte check (test 2), dropped ref-existence check (test 3), dropped parent check (test 4), leaked intent ref and extra/orphaned branch commit (test 1) all die
- Untouched paths ✓ — plumbing (no-checkout) write, CAS, `WriteFailure` union, `writeState` signature, push handling, and the refusal message text (task 02's surface) are byte-identical in the diff
- Test evidence ✓ — `write-recovery.test.ts` 4/4 pass; `write-path.test.ts` 19/19 pass unmodified (AC2.1, AC4.1, AC5.1); `npm run typecheck` clean; one `beforeEach` fixture timeout when both suites ran in parallel reproduced as environmental (passes alone in 20s against a 30s hook budget), not a code failure
- Concurrency not assessed — the co-writer race is acknowledged in the plan's Risks as out of this task's proof obligations

## Boundary check

Substantive changes stay inside the declared surface: `frontend/packages/core/src/sources/local-source.ts` and `frontend/packages/core/test/write-recovery.test.ts`. The third file in the commit, `runs/writestate-kill-window/tasks/01-intent-ref-recovery.yaml`, is the implementer's notes append the pipeline expects — no scope, surface, or status field altered. `write-path.test.ts` untouched (last commit 76c787c predates the run). No new git.ts primitives; `rev-parse <oid>^1` runs through the existing `run` escape hatch, keeping `git.ts` outside the diff.
