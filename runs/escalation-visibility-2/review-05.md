# Review Report: 05-cli-inbox

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** 07e856d on run/escalation-visibility-2

## Findings

### F1 — minor — a mutant appending the suffix to every non-reviewable item (not just escalations) survives the suite
- **Where:** `frontend/packages/cli/test/cli.test.ts:97-99`
- **Failure scenario:** change `main.ts:133` to `!item.reviewable ? … : ''` (drop the kind check); malformed lines gain ` — <schema error>` and bounced gate lines gain ` — Packet malformed — bounced, not reviewable`, breaking the scope's byte-identical claim for those kinds — yet the full CLI suite passes (verified: 30/30 green under this mutant in a scratch worktree), because the malformed-line assertion checks presence only, despite its comment saying "unchanged". One added assertion pinning the malformed line's tail (e.g. `toMatch(/Malformed run state$/)`) kills it.
- **Requirement:** task scope ("byte-identical … malformed, gates"); AC3.1 itself unaffected.

## Coverage

The change does what the task claims, the new test genuinely discriminates, and I found nothing blocking.

- AC3.1 ✓ — recovered lines carry from_role in the title and reason after ` — ` (`main.ts:133-134`); asserted against both fixture roles with exact reason text.
- Byte-identity for other kinds ✓ in the committed code — the suffix condition is only satisfiable by the recovered path: valid-run escalations are always `reviewable: true` (`readiness.ts:133`), and every other non-reviewable item has kind `gate` or `malformed`. Test pinning of that invariant is partial (F1).
- Reviewable-escalation invariant ✓ — `not.toContain(' — ')` on the `escalated` line; safe because that fixture's `at` is non-null (`fixtures/src/index.ts:519`), so the em-dash age placeholder cannot leak into the line.
- Non-vacuity ✓ — ran the new test against pre-task `main.ts` (caaf105 blob) in a scratch worktree: it fails exactly on the missing reason suffix (`cli.test.ts:94`).
- Fixture dependence ✓ — reason strings, roles, and `now − 1*DAY` timestamps match the shared generator exactly (`fixtures/src/index.ts:648-650`); ordering guard holds since the 7-day `escalated` run leads.
- Out of scope ✓ — no new flags, columns, or formats; `agentic status` untouched, matching plan ADR-3.
- Tests observed, not assumed ✓ — `npx vitest run packages/cli`: 33 passed (2 files). Full `npx vitest run`: 412 passed, 1 skipped (45 files passed, 1 skipped). Real output tails:

```
 Test Files  2 passed (2)
      Tests  33 passed (33)
```
```
 Test Files  45 passed | 1 skipped (46)
      Tests  412 passed | 1 skipped (413)
```

## Boundary check

Clean. The commit touches exactly the two declared surface files, `frontend/packages/cli/src/main.ts` and `frontend/packages/cli/test/cli.test.ts` (`git show 07e856d --stat`), and nothing else.
