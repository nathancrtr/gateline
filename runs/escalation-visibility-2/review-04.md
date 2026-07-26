# Review Report: 04-web-readonly

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** cfe4aa0 on run/escalation-visibility-2

## Findings

### F1 — minor — e2e never asserts the read-only paragraph renders, so a mutant deleting it survives
- **Where:** `frontend/e2e/smoke.spec.ts:55-64`
- **Failure scenario:** a regression empties the new `!item.reviewable` escalation branch in `decide.tsx:135-137` (cards render with no explanation and no control); the new test still passes — it checks only resolve-control absence and card content, never the "Read-only — recovered from malformed run state" text. One added `toBeVisible()`/`toHaveCount(2)` on that text would kill the mutant.
- **Requirement:** task scope item 1 (the static paragraph is required content); AC4.1 itself is unaffected.

## Coverage

I traced every path that can offer or reach escalation resolution in the committed web code and cross-checked the new end-to-end tests against the shared fixture; everything below was checked against the commit under review, not the diverged working tree.

- R4 / AC4.1 gating ✓ — keyboard 'a' handler (decide.tsx:33) and the idle Resolve branch (decide.tsx:129) both require `reviewable`; `setMode('resolve')` exists nowhere else; mode initializes idle with no effect or URL param setting it.
- Defense in depth ✓ — the resolve submit is a no-op for null `escalationIndex` (decide.tsx:100), recovered items carry null index and `reviewable: false` (readiness.ts:91-105), and the run page's primary flag can only land on a reviewable item (run.tsx:144), so even the keyboard mutant has no reachable trigger.
- Read-only branch ✓ — verified against committed source: static paragraph only, exact task-specified text, bounced-gate styling, no button, no `data-decide` attribute; DecidePanel's sole consumer is the run page (run.tsx:233).
- R3 run-detail half ✓ — the esc-recovered test pins the malformed banner, exactly two escalation cards, each role's title and its fixture-matching reason text, and the resolved third entry's exclusion; the zero-count resolve assertion follows positive content assertions, so it cannot pass on a blank page.
- Notes deviation judged sound ✓ — the page renders three cards (malformed bounce plus two escalations), so the task's "two escalation cards" is correctly asserted by title-filtered count; a literal total-card count of 2 would have been wrong, and the filter approach discriminates the count, title-format, role, reason, and resolved-filter mutants.
- Regression guard ✓ — the schema-valid escalated run has exactly one open escalation in the fixture, and its count-1 resolve assertion kills the over-broad mutant that hides Resolve everywhere.
- Implementer's verification claims (typecheck, 403 vitest tests, 15 Playwright tests passing locally) are unverified by me — the working tree diverges from the commit and re-running was out of bounds; frontend-ci remains the independent check.

## Boundary check

Clean. cfe4aa0 touches exactly the declared surface — `frontend/packages/web/src/components/decide.tsx` and `frontend/e2e/smoke.spec.ts` — plus the task file's own `notes:` block, which the workflow expects. itemHref, KindChip, run.tsx, and api.ts are untouched, as the task's scope requires.
