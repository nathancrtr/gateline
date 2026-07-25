# Review Report: 02-egress-guard-seams

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** f6271dd0b0002e4b7de1a628a486b792d941d144

## Findings

### F1 — minor — sync tests cannot discriminate `localOnly === true` from a presence/loose-truthiness check
- **Where:** `frontend/packages/core/test/sync.test.ts:68-90`
- **Failure scenario:** mutate `sync.ts:66` to `'localOnly' in source` (or `!= null`); a source carrying an explicit `localOnly: false` (a shape task 01's resolution can produce) is wrongly reported `'local-only'` and sync is suppressed, yet both new tests still pass — only the true-case and absent-case are pinned. Implementation as written is correct; this is a surviving mutant in the suite.
- **Requirement:** task scope's `=== true` clause (02-egress-guard-seams.yaml:20); AC2.3 discrimination

## Coverage

I checked the full diff against the task scope, plan decisions, and spec criteria, and everything except the one minor test gap above came back clean.

- Requirement coverage R2/R3, unit-seam halves of AC2.2 and AC2.3 ✓ (caller wiring is tasks 03/04 per ADR-3/ADR-4 consequences)
- Guard ordering in the PR-ensure path ✓ — the localOnly return is the function's first statement (`pr-ensure.ts:41`), before Git construction, origin lookup, and exec; behavior with the option absent is unchanged (the added line is a no-op)
- Mutation reasoning on the PR-ensure tests ✓ — the remoteless case's exact-note assertion kills a guard-moved-after-origin-check mutant; the leak-shape case (origin + pushed branch) kills any gh-invoking mutant via the zero-call exec spy; `toEqual` pins status and note verbatim
- planSyncForSource ✓ — returns `'local-only'` before `providerFactory` can run (`sync.ts:66-67`); otherwise delegates to planSync with `planSync`/`applySync` signatures untouched; export reaches the package root via the sources barrel
- Factory-never-invoked proof (AC2.3) ✓ — vi.fn factory asserted zero calls in the local-only case, exactly one in the delegate case, delegate result equality checked against a direct planSync call on a non-empty plan
- Tests run by me ✓ — targeted vitest run 12/12 passed; full `npm test` 373 passed, 1 skipped (matches the implementer's claim); `npm run typecheck` clean
- Error paths not re-assessed beyond the guard — the existing never-throw envelope of ensureDraftPr is untouched by the diff
- Concurrency not assessed (no concurrent access in scope)

## Boundary check

Clean. The diff touches exactly the four declared surface files plus the task YAML's own notes block (the implementer's status record, which the dispatch permits). `config.ts`, `local-source.ts`, and `divergence.test.ts` are untouched as the scope demands.
