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

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit `62041db` on `run/runner-agent`

### Prior findings

- **F1 (major) — resolved.** Verified in the committed `start.ts`: the shared config `common` now carries `localDispatcher` (`:158`), only the Engine's own literal overrides it with `remote ?? localDispatcher` (`:170`), and `common` is consumed by exactly two sites — the Engine spread and `new Scheduler(common)` (`:177`) — so the round-1 mutant (a due sweep under `runner.enabled` throwing at the dispatcher's slug/branch guard and resting the role via S1) is dead by construction. The new site comment's factual claims all check against the code (`schedule.ts:328` dispatches without `slug`/`branch`; `runner-dispatcher.ts:121-123` throws on that; `makeRunnerCallback` reads only `engine.inFlightDetail()`). Disabled path: `remote` is `undefined`, engine gets `localDispatcher` — selection identical to round 1's disabled path.
- **F2 (minor) — adequately deferred, stays open for G2.** devDependency + lockfile delta kept and untouched this round; the rebuttal's convention claim verified by grep (no file in the tree imports a sibling package's `src/*.ts` by relative path — every cross-package edge is a `package.json` dep). Disposition matches round 1's ask exactly: G2 ratifies or rejects the surface deviation explicitly. One audit note: the task notes' paraphrase ("the review … left fixing-vs-rebutting to implementer judgment", "low-risk") overstates round 1's wording — F2 was an automatic boundary finding — but the substance of the rebuttal is sound.
- **F3 (minor, PLAUSIBLE) — appropriately deferred.** Verified the implementer's surface claim: the capture would land in `seam.ts`'s `DispatchRequest` and `engine.ts`'s `launch()`, both outside the declared surface; the task scope indeed never names the baseOid handoff review-03.md F5 pointed at task 05. Explicitly flagged in the task notes for G2 assignment (round 3, new task, or accept poll-time best-effort) — consistent with round 1's "decomposition-level, not an implementer defect".
- **F4 (minor) — adequately rebutted.** The implementer concurs with the round-1 reading and records it for G2 to reconcile AC7.1's wording against what the R7 test pair actually demonstrates; no code change is the right change (engine aging is out of surface and scope point 3 pins the call site). Nothing further to verify.

### Findings

### F5 — minor — the F1 fix has no discriminating test; a dispatcher-re-share mutant survives the full suite
- **Where:** `frontend/packages/orchestrator/src/start.ts:158-177` vs `frontend/packages/orchestrator/test/wiring.test.ts:63-67` (all four wiring tests construct `Engine` + `RemoteDispatcher` directly; grep confirms nothing under `test/` calls `assembleOrchestrator` at all)
- **Failure scenario:** a future edit moves `dispatcher: remote ?? localDispatcher` back into `common` → every orchestrator/server test still passes → F1's wedged-sweeps defect ships again undetected. Mitigations are real: today's exposure is nil (no production entrypoint can enable the runner — `main.ts:77`'s `assembleOrchestrator` call passes no `runner` option), the implementer's scaffolding rationale is verified accurate (`assembleOrchestrator` unconditionally loads a headless manifest the toy-repo fixture lacks), and the site comment records the invariant. Non-blocking; the natural home for a regression test is the follow-on entrypoint wiring already named at G2 (round 1 observations).
- **Requirement:** R9 / AC9.1 regression safety (tests-as-product)

### Coverage

I re-verified each round-1 finding against the committed round-2 diff and checked the restructured assembly and comment fixes end to end; everything is clean except the untested-fix gap recorded as F5.

- F1 fix ✓ — `common`'s two consumers traced through the full `start.ts` at `62041db`; no other reader of the dispatcher selection exists in the file
- New comments ✓ — every file:line claim in the round-2 comments verified against the commit tree: `engine.ts:489` is exactly the `frameworkRoots()` await, and a `managesOwnWorkspace` launch takes the `null`-checkout branch with no earlier await, so the corrected `pollIntents` comment is now accurate
- wiring.test.ts delta ✓ — comment-only (12 lines inside one block comment); test behavior byte-identical to the round-1 code already reviewed
- Task YAML ✓ — append-only; round-1 notes preserved intact (missing trailing newline, cosmetic)
- Disabled path ✓ — `runner` unset yields the same dispatcher object selection as pre-task code; schedule tests unaffected by construction
- Test execution — implementer-reported (226 pass / 1 pre-existing skip, tsc clean); per role constraints I executed nothing and verified by reading
- Note for G2: the working tree at review time carries an uncommitted staged reversion of this exact commit's three files; out of scope per dispatch (HEAD already contains the fix), named here so it is not mistaken for the submission

### Boundary check

Round 2 touches `start.ts` and `wiring.test.ts` (both in the declared surface) plus the task YAML's own notes (conventional). No new out-of-surface contact; round 1's two out-of-surface files (`orchestrator/package.json`, `package-lock.json`) are untouched this round — F2's G2 ratification stands as the open disposition.
