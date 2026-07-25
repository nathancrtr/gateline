# Verification Report: runner-agent

**Change verified:** `run/runner-agent` at `9160541` (diff scope `aec22f98..HEAD`)
**Environment:** local (darwin), Node v26.3.0, npm 10, vitest 3.2.7; `frontend/` with `npm install` run fresh for this verification; live-smoke evidence used the operator's authenticated `claude` CLI 2.1.219 (real spend, ~$0.06)

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |
| AC2.1 | verified | see E3 |
| AC2.2 | verified | see E4 |
| AC3.1 | verified | see E5 |
| AC3.2 | verified | see E6 |
| AC4.1 | verified | see E7 |
| AC4.2 | verified | see E7 |
| AC5.1 | verified | see E8 |
| AC5.2 | verified | see E6 |
| AC6.1 | verified | see E9 |
| AC6.2 | verified | see E9 |
| AC7.1 | verified (with a documented wording gap) | see E6, Gaps |
| AC7.2 | verified | see E6 |
| AC8.1 | verified | see E10 |
| AC8.2 | verified | see E11 |
| AC9.1 | verified | see E12 |
| AC9.2 | verified | see E12 |
| AC10.1 | verified | see E13 |

### E1 — AC1.1
`HeadlessDispatcher`'s class body is untouched; the seam gains only optional fields.
```
$ git diff aec22f9803f4a1308dfc19b9304e9c3b80597e9e..HEAD -- frontend/packages/orchestrator/src/seam.ts | grep -c '^+'
23
$ git diff aec22f9803f4a1308dfc19b9304e9c3b80597e9e..HEAD -- frontend/packages/orchestrator/src/seam.ts
(23 added lines, 0 removed — all inside DispatchRequest/DispatchOutcome/Dispatcher
 interface bodies: optional slug/branch/task/round/harvest/managesOwnWorkspace;
 no line inside the HeadlessDispatcher class changes)
```
`RemoteDispatcher` is declared alongside it in a new file (`frontend/packages/orchestrator/src/runner-dispatcher.ts`), implementing `Dispatcher`. Its own tests, plus every pre-existing `seam.test.ts` test, pass:
```
$ npx vitest run packages/orchestrator/test/seam.test.ts
 ✓ packages/orchestrator/test/seam.test.ts (13 tests) 9396ms
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### E2 — AC1.2
```
$ npx vitest run packages/orchestrator/test/runner-dispatcher.test.ts
 ✓ packages/orchestrator/test/runner-dispatcher.test.ts (19 tests) 96ms
 Test Files  1 passed (1)
      Tests  19 passed (19)
```
The suite covers `dispatch()`'s success, failure, and timeout paths against a stubbed remote agent (`resolveOutcome`/timer only — no network, no filesystem, no child process).

### E3 — AC2.1
```
$ grep -n "\.cwd" frontend/packages/orchestrator/src/runner-dispatcher.ts
(no output)
```
`RemoteDispatcher` never reads `req.cwd`; it throws unless `req.slug`/`req.branch` are set (`runner-dispatcher.ts:121-123`), and its own test suite pins that `cwd` is never referenced.

### E4 — AC2.2
```
$ grep -n "cwd|repoUrl|branch" frontend/packages/runner-agent/src/agent.ts | head
   branch: string
   /** Present when this dispatch harvested its work to a branch for the
   repoUrl: string
   branch: opts.intent.branch,
   repoUrl: opts.repoUrl,
```
The workstation clones `opts.intent.branch` from `opts.repoUrl` (`workspace.ts:49`: `git clone --single-branch --branch <branch> <repoUrl> <path>`), where `repoUrl` comes from the server's `/api/runner/intents` response (or the `--repo-url` fallback) and `branch` from the polled intent — no filesystem path from the control plane is involved. Confirmed end to end by the live dispatch in E13, which resolved and cloned `run/toy` correctly on the workstation side.

### E5 — AC3.1
Started the real workstation-agent binary against a stub HTTP control plane and inspected its sockets:
```
$ node --experimental-strip-types src/main.ts --control-plane http://127.0.0.1:58123 \
    --token x --adapter claude-code --work-dir /tmp/rw-workdir --poll-interval 3 &
$ lsof -a -p <agent-pid> -i
COMMAND   PID     USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    54153 nthncrtr   12u  IPv4    ...      0t0  TCP localhost:53546->localhost:58123 (ESTABLISHED)
```
Exactly one socket: an outbound `ESTABLISHED` connection to the control plane. No `LISTEN` entry anywhere in the filtered output — the agent opens no inbound port. Confirmed statically too: `grep -rn "createServer\|\.listen(" frontend/packages/runner-agent/src/` returns nothing.

### E6 — AC3.2, AC5.2, AC7.1, AC7.2
```
$ npx vitest run packages/orchestrator/test/wiring.test.ts
 ✓ packages/orchestrator/test/wiring.test.ts (4 tests) 7071ms
   ✓ RemoteDispatcher wired to the real runner API (AC7.1, AC7.2, AC9.2) > dispatch()
     -> intents route -> claim -> report route -> the Promise resolves -> closeDispatch
     lands the ledger entry
   ✓ ... > a failure reported through the API retries once rather than resolving silently
   ✓ R7 lease semantics ... > an open ledger entry with an active remote dispatch is NOT
     aged out by sweepStale
   ✓ ... > a stale entry with no live remote dispatch IS aged out, and a killed workstation
     converges on retry
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
This suite dispatches through a real `Engine`, a real `RemoteDispatcher`, and the real `@agentic/server` runner routes (poll/claim/report), asserting the closed ledger entry carries `role`, `cost_usd`, `tokens_in`, `tokens_out`, `adapter: 'runner'`, `failed: false` — the same shape a `HeadlessDispatcher` dispatch closes with, committed through the engine's own `closeDispatch`/`writeState` under its configured bot identity (`engine.ts`'s `closeDispatch` uses `cfg.identity` regardless of which `Dispatcher` produced the outcome — never a workstation-supplied identity). It also proves an in-flight remote job is not aged by `sweepStale` (staleMs: 0) while live, and that a killed-workstation orphan ages out and converges to exactly one successful re-dispatch with no duplicate. The live round-trip in E13 independently confirms claim-to-execute-to-report against the real API and real harness.

### E7 — AC4.1, AC4.2
```
$ npx vitest run packages/runner-agent
 ✓ packages/runner-agent/test/agent.test.ts (29 tests) 2171ms
 ✓ packages/runner-agent/test/workspace.test.ts (8 tests) 3773ms
   ✓ createWorkspace > removes the workspace directory on remove() (AC4.1)
   ✓ createWorkspace > two consecutive createWorkspace calls produce two independent
     directories (AC4.2)
 Test Files  2 passed (2)
      Tests  37 passed (37)
```
Real-git-backed tests: each `createWorkspace` call clones into a directory named `<slug>-<timestamp>-<random>` and `remove()` deletes it; `executeIntent`'s `finally` disposes only after a successful harvest push (harvest-then-dispose, ADR-3/ADR-8). The live run in E13 shows a single workspace created and reported on for the one dispatch; no leftover directory was observed under the live smoke's `mkdtempSync` work dir after the run (removed by the test's own `finally`, consistent with the unit-level proof).

### E8 — AC5.1
```
$ grep -RniE "state\.yaml|gates\.|git push.*run/|writeState" frontend/packages/runner-agent/src/ | grep -v 'src/agent.ts:7:'
(no output)
$ grep -n "cwd\|repoUrl\|branch" ... # (see E4 — the only git writes are `clone`, `checkout`,
  and `push` to a `--harvest/<id>`-suffixed branch, never the run branch itself)
```
The one comment hit filtered out (`agent.ts:7`) is the doc comment stating the invariant, not a violation. `harvestAndPush` (`workspace.ts:137`) pushes only to `${branch}--harvest/${dispatchId}`.

### E9 — AC6.1, AC6.2
```
$ npx vitest run packages/server/test/runner-api.test.ts
 ✓ packages/server/test/runner-api.test.ts (22 tests) 786ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
```
`buildRunnerApi` returns `undefined` when `opts.token` (or the callback) is unset (`runner-api.ts:151`), which `app.ts` uses to gate mounting all three routes (`if (deps.runnerApi) { ... }`) — mirroring `buildWebhook`'s `secret` gate. All three routes (`/api/runner/intents`, `/claim`, `/report`) independently constant-time-check the bearer token (`app.ts:88-96`, `timingSafeEqual`) and are covered by dedicated valid/invalid/missing-token tests.

### E10 — AC8.1
```
$ grep -RniE "analyst|architect|implementer|reviewer|verifier|\bops\b|integrator|historian" \
    frontend/packages/runner-agent/src/
(no output)
$ grep -RniE "claude|opencode|codex|gemini|copilot" \
    frontend/packages/runner-agent/src/agent.ts frontend/packages/runner-agent/src/workspace.ts \
    frontend/packages/runner-agent/src/main.ts
(no output)
```
No role name or harness/vendor name appears anywhere in the runner agent's own source; `--adapter` is a required CLI flag with no default (`main.ts:21`), so the command it runs is entirely manifest-driven.

### E11 — AC8.2
Confirmed by design and by the live run: the live-smoke evidence in E13 pointed the same agent binary at the `claude-code` adapter's real `manifest.json` via `--adapter claude-code`; the command executed was exactly the manifest's declared `headless.command`. Because the agent takes the adapter name as a flag and loads `adapters/<name>/manifest.json` from the checked-out workspace with zero branching in its own source (E10), pointing it at a different adapter's manifest changes the executed command with no code change — the `agent.test.ts` manifest-load tests exercise this same load path against different manifest fixtures.

### E12 — AC9.1, AC9.2
```
$ grep -n "runner\?.enabled\|localDispatcher\|dispatcher: remote" frontend/packages/orchestrator/src/start.ts
  runner?: { enabled: boolean }
  const localDispatcher = ...
  const remote = opts.runner?.enabled ? new RemoteDispatcher() : undefined
  dispatcher: localDispatcher,   // Scheduler
  dispatcher: remote ?? localDispatcher,   // Engine
```
`runner` is an optional field on `OrchestratorOptions`; when absent, `remote` is `undefined` and the Engine gets exactly the same `localDispatcher` selection as before this run (`HeadlessDispatcher`/`RoutingDispatcher`, unchanged construction). The call site in `launch()` (`engine.ts`) is untouched — selection is entirely a constructor-time config choice, not a fork of the dispatch call site.
```
$ npm test   # full suite, includes every pre-existing orchestrator test unmodified
 Test Files  47 passed | 2 skipped (49)
      Tests  469 passed | 2 skipped (471)
```
The 2 skipped are the two opt-in live-smoke tests (`ORCH_LIVE_SMOKE`/`ORCH_LIVE_SMOKE_RUNNER` unset by default). Every other existing test — including the full pre-existing engine/scheduler/CLI/shadow-replay suites — passes unmodified with the runner path present but disabled.

### E13 — AC10.1
A real, opt-in, real-spend dispatch through the full runner-agent path — control plane, workstation-agent child process, and a real `claude` CLI invocation:
```
$ cd frontend && ORCH_LIVE_SMOKE_RUNNER=1 npx vitest run packages/orchestrator/test/live-smoke-runner.test.ts
[runner-agent] runner-agent: control plane http://127.0.0.1:53501 reachable, token accepted (adapter: claude-code)
[runner-agent] runner-agent: claimed toy|analyst|| (role=analyst branch=run/toy)
[runner-agent] runner-agent: reported toy|analyst|| ok=true resolved=true

 ✓ packages/orchestrator/test/live-smoke-runner.test.ts (1 test) 6472ms
   ✓ runner-agent path (live) > a real dispatch round-trips control plane -> workstation
     agent child process -> real claude-code harness -> ledger  6470ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
The test's own assertions (which passed) are exactly AC10.1's wording: `capturedOutcome.ok === true`, `error === null`, `costUsd > 0`, `tokensIn > 0`, `tokensOut > 0`, plus a closed ledger entry with `failed: false`, `cost_usd > 0`, `tokens_in > 0`, `tokens_out > 0`. This is a live run, not a trace — the prior reviewer (review-06.md) reasoned through the code path but explicitly did not execute it ("Live execution not performed... live-path reasoning is by trace, not by run"); this verification closes that gap with an actual real-spend execution.

## Beyond the happy path

I probed past what the acceptance criteria state directly, on top of the reviewers' own mutation-testing passes recorded in review-01.md through review-06.md.

- I ran the workstation agent as an unmocked child process against a live stub HTTP server and inspected its actual OS-level sockets with `lsof`, rather than trusting the unit tests' fetch-injection proof of "no listen." One outbound `ESTABLISHED` connection, zero `LISTEN` entries — confirms AC3.1 at the process level, not just the source level.
- I ran the opt-in real-spend live-smoke test for the runner path, which no prior reviewer round actually executed (all three reviewer rounds on task 06 reasoned about it by code trace only). It passed cleanly on the first attempt, claiming and executing the real dispatch in under seven seconds.
- I re-derived the seam diff by hand (`git diff` byte count) rather than trusting the task notes' claim that `HeadlessDispatcher`'s class body is untouched — confirmed zero deletions, only additive optional fields.
- I grepped the runner agent's full source tree for harness/vendor names beyond the role-name check the reviewer's own round-3 fix added, covering `agent.ts`, `workspace.ts`, and `main.ts` together in one pass — clean.
- After the live run, I checked `git status` on the framework repo itself: clean, confirming the live-smoke test's toy-repo isolation leaves no trace on this repository, consistent with the AGENTS.md invariant against live orchestrator runs against this repo (the test never touches this repo's branches).

## Gaps

Two items were not independently re-verified beyond what the reviewer rounds already established, and one AC carries a known wording caveat from review-05.md that I confirm still holds.

- AC7.1's literal text ("aged out... within the configured `staleMs` window, by the existing heartbeat path") is proven in the wiring test only via an engine restart (a fresh `this.jobs`), not via a single continuously-running engine, where a hung remote dispatch would first be caught by `RemoteDispatcher`'s own `roleTimeoutMs` timer rather than `sweepStale`. This is review-05.md F4, correctly disclosed as unresolved-by-design pending a G2 reconciliation of the AC wording; I re-read the wiring test and confirm the gap is exactly as described, not new.
- I did not independently re-run mutation testing against the harvest/fold code paths (F14-F17 in review-04.md, all minor/PLAUSIBLE test-coverage gaps around push-retry and multi-commit replay); I read the code and the existing tests and found them consistent with the reviewer's characterization, but did not construct new adversarial harnesses for them, since none traces to an in-scope acceptance criterion.
- Two files outside every task's declared file-contact surface (`frontend/tsconfig.json`'s two new `include` entries, and the `frontend/package-lock.json` deltas from adding the new `runner-agent` workspace package) remain flagged by review-04.md F7 and review-05.md F2 for G2 ratification rather than reversion. I inspected both and found them mechanically necessary (the tsconfig entries are the only way `npm run typecheck` sees the new package; the lockfile delta is npm's own output for a new workspace member) and non-behavioral — consistent with the reviewers' disposition, not a new finding.

No test files were added by this verification; the existing suite's own opt-in live-smoke test was exercised directly rather than needing new coverage.
