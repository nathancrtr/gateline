# Review Report: 03-cli-wiring

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 539ec42 (branch run/local-only-mode)

## Findings

### F1 — minor — AC4.1's "nothing listens" probe cannot distinguish never-started from started-then-exited
- **Where:** `frontend/packages/cli/test/cli.test.ts:367-381`
- **Failure scenario:** mutant moves the conflict gate after `startServer` (or deletes `up`'s try/catch entirely): `startServer`'s own `loadSources({push, localOnly})` throws `LocalOnlyPushConflictError`, the unhandled rejection exits non-zero with the same message on stderr, and by the time the TCP probe runs the dead process's listener is closed — test passes while a server transiently started, violating AC4.1's "no engine or server started". The shipped code order is correct (loadSources at main.ts:781-793 precedes both dynamic imports at 805-806); only the test's discriminating power is short.
- **Requirement:** AC4.1

### F2 — minor — the sync generic-line suppression is implemented but no test kills its deletion
- **Where:** `frontend/packages/cli/src/main.ts:662-663,687-689` / `frontend/packages/cli/test/cli.test.ts:346-364`
- **Failure scenario:** mutant deletes the `anyConsidered`/`allLocalOnly` tracking so an all-local-only fleet prints both `local-only: nothing to sync` and the generic `nothing to sync — no undecided G2…` line; AC3.1/AC3.2 tests only assert `stdout` *contains* the literal line, never the generic line's absence, so the contradictory output the scope explicitly required suppressing survives.
- **Requirement:** task scope ("keep output non-contradictory"); AC3.1

### F3 — minor (PLAUSIBLE) — `resolveUpMode` emits a pushing marker with `enginePush: false` on one input row
- **Where:** `frontend/packages/cli/src/main.ts:710,719`
- **Failure scenario:** `resolveUpMode({pushExplicit: true, push: false, ...}, /*sourceLocalOnly*/ false)` returns `marker: 'pushing to origin (origin auto-detected)'` with `enginePush: false` — self-contradictory. Unreachable through `up` (CLI `--no-push` always resolves `localOnly: true` in `loadSources`, table rule 2), so PLAUSIBLE only for a future caller of the exported function; a defensive throw or comment would close it.
- **Requirement:** AC4.2 (marker must answer "will this run touch origin?")

## Coverage

I checked every requirement this task claims against the diff and found the implementation correct and integrated; the findings above are all test-robustness gaps, none in shipped behavior.

- R1/AC1.1–AC1.2 ✓ — mode read from the source's resolved `localOnly` only; `resolveUpMode` never re-derives precedence (verified against `resolveMode` in core config.ts); all five marker literals match the plan contract exactly and each has a unit test asserting the exact string plus `enginePush`.
- R2/AC2.2 arm site ✓ — `armRun` passes `{ localOnly }` to `ensureDraftPr` (main.ts:632); guard confirmed first-line in pr-ensure.ts:41; both pre-existing arm tests updated to the suppression note are a legitimate consequence of AC1.1 auto-detect reaching `armRun`, not fixture tampering.
- R3/AC3.1–AC3.2 ✓ — `planSyncForSource` with a factory (main.ts:669) means `GhCliProvider` is never constructed on the local-only path; `continue` precedes `any = true`, so `--live` can never reach `applySync`; both spawn tests pass and the `--live` case pins the run-branch tip.
- R4/AC4.1 ✓ — `up` resolves via `loadSources` before either dynamic import, catch prints and exits 1; `resolveSources` gains the same catch so a config-tier conflict fails every command; stderr assertion matches the core error text verbatim. The `resolveSources` catch path itself has no CLI-level test, but the task's test list did not require one and core tests cover the throw.
- AC4.2 ✓ — informal marker at the "engine watching" line replaced; the resolved pair (not raw flags) feeds both `startServer` and `startOrchestrator` per ADR-7, and I verified equivalence with the old `push: undefined` server behavior row-by-row against the mode table.
- Cross-task integration ✓ — task 04's `ServeOptions.localOnly`/`OrchestratorOptions.localOnly` names match the plan contract; the implementer's two boundary typecheck errors are gone at branch HEAD (`tsc --noEmit` exit 0).
- Verification ✓ — cli.test.ts 38/38 in isolation; divergence/sync/readiness 35/35 and pr-ensure/config/fetch-sync 26/26 in isolation (AC1.3/AC7.2 regression surfaces). A full concurrent `vitest run` showed 18–22 timeout failures at 30s/60s thresholds across unrelated orchestrator suites while three reviews ran suites in parallel; every implicated file passes in isolation, confirming the task-04 implementer's sandbox-contention diagnosis, not a regression.
- Defensive no-source exit in `up` ✓ — strictly earlier/clearer than the prior uncaught "no run sources" path; message is accurate for the repoOverrides path where the only skip cause is a non-repo dir.

## Boundary check

Inside the declared surface: code changes touch only `frontend/packages/cli/src/main.ts` and `frontend/packages/cli/test/cli.test.ts`. The third file in the commit, `runs/local-only-mode/tasks/03-cli-wiring.yaml`, is the implementer's notes block — pipeline bookkeeping, not a surface violation.
