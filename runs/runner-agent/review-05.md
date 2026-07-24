# Review Report: 05-wiring

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit `7f39fc2` on `run/runner-agent`

## Findings

### F1 — major — `runner.enabled` hands the RemoteDispatcher to the Scheduler too, wedging every scheduled sweep
- **Where:** `frontend/packages/orchestrator/src/start.ts:137-143` (the `remote ?? …` dispatcher is placed in `common`, shared by Engine **and** `new Scheduler(common)` at :171)
- **Failure scenario:** `runner.enabled: true` plus any due schedule in `orchestrator.yaml` → the scheduler's launch (`schedule.ts:328`) dispatches `{ cwd, role, body, timeoutMs }` with no `slug`/`branch` → `RemoteDispatcher.dispatch` throws (`runner-dispatcher.ts:121-123`) → the sweep closes failed with its just-created `run/<role>-<date>` branch left unmerged → rule S1 ("open sweep branch → rest") rests every future sweep of that role until a human prunes the branch. Even if the scheduler carried `slug`/`branch`, `makeRunnerCallback` sources intents solely from `engine.inFlightDetail()` (`start.ts:38-44`), so a scheduler-parked promise would never surface to a workstation and would only die at `sweepTimeoutMs`.
- **Requirement:** task scope points 1/3 (wire the dispatcher into the orchestrator *assembly*, which includes the scheduler — start.ts's own comment at :131 says they share one dispatcher so sweeps meter through the same seam); R9's opt-in intent (enabling the option must not break an unrelated dispatch path).
- **Resolution direction:** keep the scheduler on the headless/routing dispatcher when `runner.enabled` (implementable inside the declared surface; sweep billing then stays on the API-key path, consistent with the brief's "peer, not a replacement"). If remote sweeps are actually intended, that needs scheduler-side `slug`/`branch` threading plus a pendingIntents source covering scheduler jobs — outside this task's surface — i.e. an escalation, not a quiet widening.

### F2 — minor — out-of-surface edits: `orchestrator/package.json` + `package-lock.json`
- **Where:** `frontend/packages/orchestrator/package.json:19`, `frontend/package-lock.json:4679`
- **Failure scenario:** none (boundary rule, not a behavior defect). devDependency-only, no cycle (`@agentic/server` does not depend on the orchestrator package), needed for the cross-package test import to resolve. Self-reported in the task notes with a claimed dispatch-prompt authorization; automatic finding regardless — the G2 human should ratify the surface deviation explicitly.
- **Requirement:** task `file_contact_surface`

### F3 — minor, PLAUSIBLE — arm-time `baseOid` capture was assigned to "task 05's wiring" and neither implemented nor tracked here
- **Where:** `frontend/packages/server/src/runner-api.ts:35-44` (doc comment: "that capture is task 05's wiring to add if the drift proves material"); review-03.md F5's resolution says the assignment was "recorded in the task notes for the planner", but `tasks/05-wiring.yaml` carries no such note and this round adds no capture.
- **Failure scenario (PLAUSIBLE):** engine commits the intent locally; before the push lands, the workstation polls and gets a poll-time tip OID its origin clone cannot fetch → checkout fails despite a healthy dispatch. Not constructed against a live path in this diff; flagged so the handoff doesn't silently evaporate — G2 should either declare poll-time best-effort acceptable for this run or assign the capture explicitly (decomposition-level, not an implementer defect).
- **Requirement:** plan ADR-2/ADR-7 ("base OID of the armed commit")

### F4 — minor — AC7.1's literal wording holds only across an engine restart, not in a live engine
- **Where:** `frontend/packages/orchestrator/test/wiring.test.ts:118-137` (live pending dispatch is *not* aged, by design) vs `:139-190` (aging proven only via a second engine)
- **Failure scenario:** in a continuously running engine, an intent no workstation ever claims is closed by `RemoteDispatcher`'s own `roleTimeoutMs` timer (`runner-dispatcher.ts:130-133`), not "within the configured `staleMs` window by the heartbeat" — `this.jobs` gating `sweepStale` (`engine.ts:333`) is exactly what the first R7 test proves. Consistent with task scope point 5's G1-approved reinterpretation and with how a hung local harness behaves today; listed so G2 reconciles the AC text rather than reading it as demonstrated literally.
- **Requirement:** spec AC7.1

## Coverage

I checked the wiring diff end to end against the task scope and spec R1/R7/R9, and apart from the scheduler defect above the engine-side wiring, server-side reuse, and new tests are clean.

- Scope point 1 (start.ts assembly) ✓ — option shape, `RemoteDispatcher` construction, `runnerCallback` on both the assemble return and the orchestrator handle; disabled path is byte-identical dispatcher selection to before
- Scope point 2 (server main.ts) ✓ — verified already wired by task 03 as the implementer claims: `runnerCallback` option (`main.ts:42`), `RUNNER_TOKEN` read (`:130`), both into `buildRunnerApi` and `createApp` (`:129-146`); this round's only edit is a re-export, non-breaking
- Key correlation ✓ — `makeRunnerCallback` projects `inFlightDetail()` (`slug|role|task|round`), matching the engine's `jobKey` and the dispatcher's `fullKey`; `jobMeta` is set before the parked promise exists, and the test's poll-retry helper covers the launch-async gap honestly (its comment misattributes the gap to checkout I/O — a `managesOwnWorkspace` launch skips checkouts; the real await is `frameworkRoots()`, `engine.ts:489` — harmless)
- AC9.1 ✓ — the diff only adds files; no existing test or engine/dispatch code modified (test-run counts are the implementer's report; per role constraints I executed nothing and verified by reading)
- AC9.2 ✓ — `launch()`'s call site untouched; selection is `OrchestratorOptions.runner` only
- Tests as product ✓ — mutation reasoning applied: an empty-`pendingIntents` mutant fails the poll, a resolve-without-settling mutant hangs `drain`, wrong metering fails the ledger `cost/tokens/adapter: 'runner'` asserts, the failure path pins one-retry-no-escalation, and the R7 pair kills both "age by time alone" and "never age" mutants
- Error paths ✓ — unclaimed report, unknown key, and claim-TTL behavior are task 03's tested territory; the harvest relay (`outcome.harvest` → `foldHarvestBranch`) is task 04's tested territory and is not re-proven here, which the scope does not require
- Observations (no finding): no production entrypoint (`agentic up`, `agentic-orchestrator watch`, hosted deploy) can yet enable the runner or hand the callback to `startServer` — consistent with the intent brief's "this run proves the mechanism," and the hosted two-process topology cannot carry an in-process callback at all (plan ADR-6 assumes one supervised unit); follow-on wiring, worth naming at G2. The second R7 test abandons a 24h timer and a forever-parked promise, relying on vitest worker teardown; `RemoteDispatcher` has no `abortAll`, so an operator drain with a parked remote dispatch waits for the shutdown ladder — task 02's approved design, noted only

## Boundary check

Four of six touched paths are inside the declared surface (`start.ts`, `main.ts`, `wiring.test.ts`, the task YAML's own notes; `runner-dispatcher.ts` is in-surface but untouched, which is fine). Two are outside: `orchestrator/package.json` and the `package-lock.json` delta — see F2.
