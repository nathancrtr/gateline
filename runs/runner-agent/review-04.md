# Review Report: 04-workstation-agent

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** e85f192..a3e6989 (a3e6989, run/runner-agent)

## Findings

### F1 — blocking (escalation driver) — the agent destroys the role's work product: unconditional workspace removal with no harvest, the exact defect the G1 decline named
- **Where:** `frontend/packages/runner-agent/src/agent.ts:288-290` (`finally { await ws.remove() }`), `src/workspace.ts:52`; vs plan.md:117-124 (worker sequence steps 4-5), ADR-3 ("disposal is gated on the harvest reaching origin, never on harness return"), ADR-4; `DispatchOutcome` (agent.ts:46-53) and runner-api.ts:49-56 both lack the plan's `harvest` field.
- **Failure scenario:** control plane arms a real analyst dispatch for run `toy` → agent clones `run/toy`, harness writes `runs/toy/spec.md` in the clone and exits ok with usage JSON → `executeIntent`'s finally removes the clone → report POSTs `{ok:true, cost, tokens}` only → engine meters, closes the ledger entry, and advances the run — the artifact exists nowhere, the spend is real, and nothing detects it (task 06's live smoke is a "pong" prompt that writes no files).
- **Requirement:** spec R4 ("discarded once its closing commit has landed through the control plane" — this diff discards before anything can land); plan ADR-3 + worker sequence steps 4-5; plan Approach ("Disposal is gated on that push").
- **Why escalate, not request-changes:** the fix spans surfaces no pending task owns — worker-side harvest commit/push (this package), `DispatchOutcome.harvest` (seam.ts), the report route's outcome shape (runner-api.ts), and the engine's `foldHarvestBranch`/`managesOwnWorkspace` branch (engine.ts, absent: `grep foldHarvestBranch frontend/packages` is empty). Task 04's own scope text codified the gap (scope step 5g's unconditional rm; its R5 restatement "never writes … any git ref" over-tightens spec R5, which forbids only run-branch/state/gates writes and whose plan explicitly grants harvest-branch push authority, ADR-3 Consequences). Review-02.md F6 requested this exact surface amendment before dispatching tasks 03/04; it never happened. The implementer executed the task as written — this is a decomposition defect for the Architect/G1 human, not an implementer round.

### F2 — minor — the R8 grep test omits `main.ts` from the harness/vendor-name check, the one file where a hardcoded adapter default would live
- **Where:** `frontend/packages/runner-agent/test/agent.test.ts:439` (loops `agent.ts`, `workspace.ts` only; the AC3.1/AC5.1 blocks at :404 and :417 do include `main.ts`)
- **Failure scenario:** surviving mutant — change `main.ts:21`'s `.requiredOption('--adapter <name>', …)` to `.option('--adapter <name>', …, 'claude-code')`; all 28 tests still pass while AC8.1's invariant ("a grep of the runner agent's dispatch-execution code … returns nothing") is broken, un-doing the deviation this round was praised for.
- **Requirement:** R8 / AC8.1.

### F3 — minor — a failed report POST discards a completed, paid outcome with no retry
- **Where:** `frontend/packages/runner-agent/src/agent.ts:353` (single `client.report` attempt inside the cycle try; catch at :356-361 only logs)
- **Failure scenario:** control plane restarts during the report POST → the throw abandons the outcome → claim TTL (runner-api.ts:187-193) expires, engine ages the entry out and re-dispatches → the same dispatch is executed and paid for twice. Convergence is the designed R7 recovery, but one bounded retry loop would spare the duplicate spend on a transient blip.
- **Requirement:** spec R7 tolerates this (converges), so minor — flagging the avoidable double spend.

### F4 — minor, PLAUSIBLE — the intent carries no adapter identity, so a control plane routing roles to different adapters is mis-executed under the workstation's single `--adapter`
- **Where:** `frontend/packages/runner-agent/src/agent.ts:33-43` (`PendingIntent` has no adapter field); seam.ts:46 (`adapterFor` exists precisely because routing dispatchers differ per role); task 05's scope contemplates a `RoutingDispatcher`.
- **Failure scenario:** engine routes reviewer to adapter B, implementer to adapter A; the agent runs both under whatever one `--adapter` names, and the ledger's adapter/model attribution is wrong. PLAUSIBLE — single-adapter deployments (the current reality) are unaffected; the intent shape is owned by tasks 02/03's surfaces, not this one. Fold into the F1 escalation's seam discussion.

### F5 — minor — `computeOutcome`/`runCommand`/`MAX_CAPTURE` are duplicated ports of seam.ts, not shared code, and will drift silently
- **Where:** `frontend/packages/runner-agent/src/agent.ts:132-135,143,152-189,197-246` vs `frontend/packages/orchestrator/src/seam.ts:93-167,177-229`
- **Failure scenario:** a future seam.ts fix (a fourth `usage_report` format, a changed error string) lands without touching this copy; the remote path's outcome quietly stops being "equivalent in shape to one produced by HeadlessDispatcher" (AC3.2) and no test cross-checks the two. Today's port is faithful — verified branch-by-branch, the only omission being the orchestrator-only `aborted` path, which is documented. The task scope ("import the utility functions") only mandated sharing the parsers, so this is a recorded risk, not a violation.

### F6 — minor, PLAUSIBLE — a crash mid-dispatch leaks the clone; no startup sweep of `--work-dir`
- **Where:** `frontend/packages/runner-agent/src/workspace.ts:41-53`, `src/agent.ts:267-291` (cleanup is in-process only)
- **Failure scenario:** kill -9 the agent mid-harness (AC7.2's own drill) → the clone under `--work-dir` survives forever; repeated crashes accumulate stale clones. AC4.1 is scoped to completed dispatches, so this is hygiene, not a breach — AC4.2's fresh-directory-per-dispatch still holds after restart.

### F7 — minor — two files outside the declared file-contact surface
- **Where:** `frontend/tsconfig.json:23-24`, `frontend/package-lock.json` (+15 lines)
- **Failure scenario:** none behavioral — automatic boundary findings per the review rules. Both were flagged by the implementer, not smuggled: the tsconfig entries are the only way `npm run typecheck` sees the new package at all, and the lockfile delta is mechanical npm output for a new workspace package. Recommend the G2 human ratify both rather than revert; neither collides with any other task's surface (checked 01-03, 05, 06).

## Coverage

I checked the whole diff against the spec and plan; the code is well built and honestly reported, but the workspace lifecycle contradicts the plan's central amendment, and that traces to the task decomposition rather than to this implementer.

- R3 / AC3.1 ✓ — no `createServer`/`listen`/`node:http` anywhere in the package; all traffic flows through outbound `fetch`; lifecycle test proves every network touch went through the injected fetch; grep test pins it.
- R5 / AC5.1 ✓ as written — no push, commit, ref write, or state/gates write in any source file; only `clone` and `checkout` reach git (though per plan ADR-3 the worker *should* be pushing harvest branches — see F1).
- R8 / AC8.1-8.2 ✓ behaviorally — command and parsing are wholly manifest-driven, zero branching on adapter identity; the required `--adapter` flag with no default is the right call and fails cleanly via commander when omitted; a wrong value fails at manifest load and is reported as a normal failed outcome (test-gap noted in F2).
- AC3.2 port fidelity ✓ — `buildCommand` matches seam.ts's substitution order exactly; `computeOutcome`'s three usage branches match line-for-line including null semantics and error precedence; timeout/group-kill semantics match `runHarness` (drift risk recorded in F5).
- AC4.1/AC4.2 mechanics ✓ — removal in `finally` covers command failure, manifest-load failure, and the empty-command path (all three tested); unique dirs via timestamp plus random suffix; real-git-clone tests including the tolerated bad-baseOid checkout.
- Client/server contract ✓ — routes, bearer header, and the `{intents, repoUrl}`/`{claimed}`/`{resolved}` envelopes match app.ts and runner-api.ts exactly, including the repoUrl-fallback rule.
- Security ✓ — no shell interpolation anywhere (array-argv spawn/execFile); prompt/body substitution cannot inject; token only ever in the Authorization header (its presence in argv is what the task scope itself specified); server side compares tokens constant-time.
- Tests as product ✓ overall — 28 tests; workspace tests use real throwaway git repos, the lifecycle test drives the real `runAgent`; the mocked layers (fetch, manifest load) are the ones the scope told it to mock. Concurrency not assessed (agent is serial by spec assumption).

## Boundary check

Six of eight touched files are inside the declared surface (the whole new package plus the task YAML notes append). Two are outside — `frontend/tsconfig.json` and `frontend/package-lock.json` — both implementer-flagged, both justified, recorded as F7 for G2 ratification. No contact with task 05's surface or any other pending task's files.
