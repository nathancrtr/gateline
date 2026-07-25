# Review Report: 06-live-smoke

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** `bff6acf` on `run/runner-agent`

## Findings

### F1 — minor — SIGKILL on the agent child orphans a still-running harness process group on failure paths
- **Where:** `frontend/packages/orchestrator/test/live-smoke-runner.test.ts:186`
- **Failure scenario:** harness hangs → `RemoteDispatcher` rejects at 240s → `drain()` settles, assertions fail → `finally` SIGKILLs only the agent process, but the harness was spawned `detached` into its own group (`frontend/packages/runner-agent/src/agent.ts:163`) and its killer timer dies with the agent — an orphaned, metered `claude` invocation runs on while `rmSync(workDir)` deletes its cwd underneath it. Bounded (opt-in manual test, cheap prompt); acceptable to fix in a later touch of this file.
- **Requirement:** none (test hygiene)

### F2 — minor — the advertised `baseOid` is never pushed to origin, so the pin checkout always fails silently and the smoke never exercises the armed-commit path
- **Where:** `frontend/packages/orchestrator/test/live-smoke-runner.test.ts:130` (Engine constructed without `push: true`)
- **Failure scenario:** the arming commit lands only in the local `repoDir`; `listIntents` advertises its OID; the workstation's clone from the bare origin lacks it, so the checkout at `frontend/packages/runner-agent/src/workspace.ts:50` fails and is tolerated, leaving the workspace one commit behind the pin. Benign today, but if the best-effort pin ever becomes strict (the capture-at-arm fix review-03.md F5 anticipates) this smoke flips red for a reason unrelated to what it proves. Adding `push: true` to the Engine config makes the pin resolvable and stays inside this file's surface.
- **Requirement:** R10 (fidelity of the live path, not its acceptance criterion)

## Coverage

The change was checked end to end against the requirement it claims, against the analogous existing smoke test, and against every seam it rides, and apart from the two minor findings above it came back clean.

- AC10.1 ✓ — asserts `ok: true`, `error: null`, `costUsd`/`tokensIn`/`tokensOut` > 0 on the reported outcome, mirroring the HeadlessDispatcher smoke's assertions, plus the closed ledger entry (`failed`, `cost_usd`, `tokens_in`, `tokens_out` — field names verified against the ledger parser)
- Skip gating ✓ — `describe.skipIf` on `ORCH_LIVE_SMOKE_RUNNER=1`, same pattern as the existing smoke; no top-level side effects when skipped
- Seam wiring ✓ — traced the full live path by hand: tick arms → `RemoteDispatcher` parks keyed promise → decorated production callback → runner API routes (bearer auth, intents/claim/report shapes match the agent client) → clone/manifest/execute/report → `closeDispatch`; every shape and key format lines up
- Manifest mutation ✓ — `headless.dispatch_prompt` is the real JSON key; a literal prompt with no `{role}`/`{body}` placeholders leaves `buildCommand` nothing to substitute, so the harness receives exactly the neutral prompt; the mutation lives only in the throwaway toy repo and cannot leak into other tests
- Races and timeouts ✓ — server listens before the child spawns; the in-flight assertions cannot be outrun by a real harness; the dispatcher's 240s timer settles `drain()` under the 300s test timeout
- HTTP listener adapter ✓ — body/no-body method split, header folding, status/body relay all correct for the three JSON routes it serves
- Validation ✓ — typecheck clean; full suite 47 files / 469 tests passed with this file and the existing smoke skipped by default (re-run here, matching the implementer's claim)
- Implementer deviations ✓ — engine-driven arming, the local `node:http` adapter (dependency constraint is real: `@hono/node-server` is not declared), and the no-harvest consequence of the neutral prompt are all sound within the one-file surface; the harvest/fold leg going unexercised is disclosed in the task notes and not required by AC10.1
- Live execution not performed (real spend, per dispatch instructions) — live-path reasoning is by trace, not by run

## Boundary check

Inside surface. The commit touches only `frontend/packages/orchestrator/test/live-smoke-runner.test.ts` (the declared surface) and the task file's own `status`/`notes` bookkeeping, which does not count against it. The `addOrigin` helper was duplicated locally instead of edited into the shared helper — the correct call under this surface.
