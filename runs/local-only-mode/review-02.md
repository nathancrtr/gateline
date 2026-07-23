# Review Report: 01-core-mode-resolution

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** b007bc99e8cbf6eb71ec39dd93ba51e8b0b0ac39

## Findings

### F1 — blocking — AC1.2 test cannot detect a push under local-only: its origin fixture is reachable, so `pushFailed` is undefined whether push was suppressed or succeeded
- **Where:** `frontend/packages/core/test/config.test.ts:76-115` (`addOrigin` builds a local bare clone; the AC1.2 case asserts only `pushFailed` absence)
- **Failure scenario:** mutant deleting rule 3's `if (localOnly) push = false` (config.ts:117) **and** the constructor's push-off force (local-source.ts:64) — i.e. local-only no longer suppresses push at all — pushes the decision to the reachable bare origin, push succeeds, `pushFailed` stays undefined, test passes. Verified empirically: with that mutant applied, all 28 tests in config.test.ts, fetch-sync.test.ts, and divergence.test.ts still pass. The claimed model (task notes: "real-but-unreachable origin", "divergence.test.ts's observation pattern") is wrong on both counts — divergence.test.ts discriminates via origin-tip comparison (`divergence.test.ts:99-102`), not `pushFailed` absence. Fix: assert `originTip(bare, ref.branch)` unchanged after the decision, per the existing pattern.
- **Requirement:** AC1.2 (task scope: "explicit opts.localOnly on an origin repo gives push=false"); foundation of AC2.1

### F2 — major — config-tier push default (unset `push`, origin exists → `push=false`) is unpinned now that the zod default is gone
- **Where:** `frontend/packages/core/src/view-model/config.ts:119` (rule 3's `cliTier ? await originExists() : false` branch)
- **Failure scenario:** mutant `else push = await originExists()` (dropping the config-tier `false` default) makes a config entry with an origin and no `push:` key silently push decision writes — verified empirically: all 28 tests in the three suites pass with this mutant. Before this diff, `.default(false)` in the schema pinned that behavior structurally; the diff moved it into new logic without a discriminating test. Add a config-entry case with an origin and no `push` key asserting origin tip unchanged.
- **Requirement:** AC1.3 ("existing defaults" — plan table rule 3, normative)

### F3 — minor — ADR-2 poller test's `pushFailed` assertion is non-discriminating against its own reachable origin
- **Where:** `frontend/packages/core/test/config.test.ts:129-131`
- **Failure scenario:** same reachable-bare mechanism as F1 — the assertion holds whether the explicit `push: false` ceiling is honored or a push succeeds; only the `localOnly === false` assertion (the actual ADR-2 point) discriminates. Either drop the vacuous assertion or make it an origin-tip check.
- **Requirement:** ADR-2 (plan config-tier corollary)

## Coverage

The mode-resolution logic itself is faithful to the plan's normative table and both ADRs; the defects found are all on the test side, where the push-suppression half of the diff is provably unpinned.

- Table rules 1-3 against `resolveMode` (config.ts:97-119): all branches match the plan, including the CLI-only ADR-1 rule and the ADR-2 config-tier corollary ✓
- Conflict error: named, message cites both settings and the source, thrown at both tiers, star-export path intact (view-model/index.ts untouched, verified) ✓
- `LocalGitSource`: `localOnly` getter, constructor push-off force, `syncFromRemote` guard before any git call; direct construction without the option unchanged ✓
- AC2.4 spy test kills the guard-removal mutant (removing the guard makes `git.run` fire against the clone fixture) ✓
- AC1.1 trigger unchanged (`pushWhenOriginExists` probe reused via `memoizedOriginExists`; one cached read per source) ✓
- AC1.3 CLI-tier case is discriminating (nonexistent origin → `pushFailed` defined proves push attempted) ✓
- Both AC4.1 tiers, config auto-detect, ADR-1 implication, and the `fetch_interval` warning covered ✓
- Repo-overrides, config-entry, and fallback paths all route through `resolveMode` and pass `localOnly` to every constructed source ✓
- Both suites plus divergence.test.ts run green on the unmutated diff (28/28); pr-ensure.ts, sync.ts, divergence.test.ts untouched as scoped ✓
- R8: the commit touches no `roles/` or `contracts/` paths ✓
- Concurrency not assessed (no concurrent access in scope)

## Boundary check

Diff touches exactly the four declared surface files plus the task file itself (implementer notes — customary, acknowledged by dispatch). No scope creep; the forbidden files (pr-ensure.ts, sync.ts, divergence.test.ts) are untouched. Clean.
