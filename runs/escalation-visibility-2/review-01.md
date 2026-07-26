# Review Report: 01-core-recovery

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 8488a80 (branch run/escalation-visibility-2; sibling commit f254d66 excluded as task 02's)

## Findings

### F1 — blocking — the new tests cannot discriminate whole-list recovery from per-entry salvage, the exact alternative ADR-2 rejects
- **Where:** `frontend/packages/core/test/escalation-recovery.test.ts:59-91` (both AC1.3 cases use a single-entry array)
- **Failure scenario:** mutant verified surviving — replace the whole-list `z.array(escalationSchema).safeParse` in `schema.ts:186-188` with per-entry salvage (keep valid entries, drop bad ones, omit the key only when none survive); all 9 new tests still pass, yet a state.yaml with `escalations: [one valid open entry, one malformed entry]` reports `escalationsOpen: 1` instead of recovering nothing — the silent alarm-count misreport R1 forbids ("never repairs or drops individual entries").
- **Requirement:** R1 / AC1.3; plan ADR-2. Fix is one fixture edit: give an AC1.3 case a well-formed sibling entry alongside the malformed one and keep asserting `'bestEffortEscalations' in result === false`.

### F2 — major — recovered items' `since` is unbound by any test, and the plan designates that assertion as its early-warning signal
- **Where:** `frontend/packages/core/test/escalation-recovery.test.ts:236-258` (readiness assertions omit `since`); `frontend/packages/core/src/view-model/readiness.ts:100`
- **Failure scenario:** mutant verified surviving — hardcode `since: null` at readiness.ts:100; all 9 tests pass. A recovered item with null `since` sinks to the end of `buildPortfolio`'s oldest-first inbox (`portfolio.ts:136` sorts null as Infinity), and the plan's "Zod transform reuse" risk names "AC1.1's `since` assertion returning null in task 01's tests" as its early signal — that signal does not exist. The task scope also pins `since` as "matching the valid path's expressions".
- **Requirement:** plan "Interface contracts" (view-model, task 01) and Risks; task scope item 3. Fix: assert the expected epoch seconds for the two open recovered items (the fixture's `at(1)`/`at(2)` make them computable), or an equivalent parser-level `since` check via deriveReadiness in AC1.1's shape.

### F3 — minor — the `from_role` fallback and `problems: []` on recovered items are unasserted
- **Where:** `frontend/packages/core/test/escalation-recovery.test.ts:243-256`; `frontend/packages/core/src/view-model/readiness.ts:98,102`
- **Failure scenario:** PLAUSIBLE — dropping `?? 'unknown role'` yields the title "Escalation from null" for an entry whose optional `from_role` is absent (escalationSchema permits it), and `problems: [error]` would add a spurious BOUNCED suffix downstream; every test entry has `from_role` set and `toMatchObject` skips `problems`, so both mutants survive. Cheap to fold into F1/F2's test edits; not gating on its own.

## Coverage

The implementation matches the plan's interface contracts exactly and all required commands pass; the gaps found are in what the new tests bind, not in the shipped behavior.

- R1 recovery gating ✓ — schema-failure branch only; YAML-failure branch and error composition untouched (schema.ts:184-189); guard rejects null/non-object roots and absent keys; a present-but-null `escalations` key recovers nothing per ADR-2.
- AC1.2 ✓ — the bad-state literal is copied verbatim from the fixtures generator (index.ts:611) and the deep-equal pins the byte-for-byte result with no recovery key.
- Plan parity ✓ — title/detail/since/packet/escalationIndex expressions on recovered items are character-identical to the valid path (readiness.ts:91-105 vs 122-137); `InboxItem`/`InboxKind` unchanged; `needsHuman` stays `items.length`.
- R2 counting ✓ — open-only filter bound by the N=2-open + 1-resolved fixture (an include-resolved mutant would return 3 and fail); absent-field default 0 preserved for existing malformed runs.
- R3 ordering ✓ — malformed item first, then recovered items in list order with `reviewable: false` and `escalationIndex: null`, all asserted.
- Verification ✓ — `npx vitest run packages/core` 183/183, full suite 403 passed / 1 skipped, `npm run typecheck` clean; the implementer's revert-the-source claim is consistent with which tests bind.
- Mutation checks run: per-entry salvage (survives — F1), `since: null` (survives — F2), include-resolved filter (killed by construction), plus reasoning over title/detail/packet mutants (killed) and fallback/problems mutants (survive — F3).
- Not assessed: server/web/CLI surfacing of recovered items (tasks 03–05) beyond confirming the full suite stays green with the new items flowing through.

## Boundary check

Clean. The commit touches exactly the four declared surface files plus the task file's own `notes:`/status block (the standard implementer report channel). `readiness.test.ts` is untouched and the shared `@agentic/fixtures` generator gains no run in this commit — the `esc-recovered` generator run on the branch belongs to task 02's commit f254d66, outside this review's scope.
