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

---

# Round 2

**Verdict:** request-changes
**Round:** 2 of 3
**Diff reviewed:** 04442f7..af372de (af372de only, run/runner-agent). The dispatched range (`a3e6989..af372de`) also carries task 05 round 1's commit `7f39fc2` — a different task's completed work under its own parallel review — so I narrowed to this task's single round-2 commit rather than flag task 05's files as boundary violations. All round-2 work is in `af372de`.

## Round-1 findings status

- **F1 — NOT genuinely resolved.** The harvest-then-dispose mechanism now exists and is correct for *uncommitted* harness output, but the mutant survives for the case the dispatch prompt itself instructs: agents that commit their own work still have it silently destroyed. See F8 — this is the same failure scenario (paid dispatch, artifact nowhere, nothing detects it) through a different door.
- **F2 — unresolved.** The R8 harness/vendor grep still loops only `agent.ts`/`workspace.ts` (`test/agent.test.ts:560`); `main.ts` remains unchecked. Carried forward.
- **F3 — open** (report POST has no retry; unchanged this round). The plan-step-5 push-retry sibling is new F11.
- **F4 — open, PLAUSIBLE.** `seam.ts` was in this round's widened surface but the intent still carries no adapter identity; unchanged, still minor.
- **F5 — open.** The seam.ts ports remain duplicated, unchanged; drift risk stands.
- **F6 — open,** and slightly enlarged: a failed harvest push now *deliberately* retains the workspace (correct per ADR-3) but nothing ever reclaims retained or crash-leaked clones.
- **F7 — stands for G2 ratification.** Neither `frontend/tsconfig.json` nor the round-1 `package-lock.json` delta was touched this round; the widened surface (ADR-8) does not retro-cover them.

## Findings

### F8 — blocking — harvest only captures *uncommitted* changes with `base` resolved *after* the harness ran, but the dispatch prompt orders every role to commit its own work — committed work is silently destroyed, resurrecting F1 for the instructed-behavior case
- **Where:** `frontend/packages/runner-agent/src/workspace.ts:84` (`base` = HEAD post-harness) and `:87` (staged-empty → `pushed: false`); `frontend/packages/runner-agent/src/agent.ts:332-333` (removes workspace, returns no harvest); `frontend/packages/orchestrator/src/prompts.ts:14-15` (`COMMIT_LINE`, appended to every role's body, which `engine.ts` sends identically to remote dispatches).
- **Failure scenario:** real analyst dispatch for run `toy` → the prompt says "When your work is complete, commit it on the current branch" → the agent writes and commits `runs/toy/spec.md` in the clone, exits ok with usage JSON → `harvestAndPush`: `base` = the agent's own commit, `git add` stages nothing, `staged` empty → `pushed: false` → workspace removed → outcome `ok: true` with no `harvest` → engine meters, closes, advances; the artifact exists nowhere. Partial variant: agent commits some files, leaves others dirty → the fold's `rebase --onto <runTip> <base>` (`orchestrator/src/workspace.ts:185`) replays only the post-`base` harvest commit, silently dropping the agent's committed work from the run branch.
- **Requirement:** spec R4; plan worker sequence steps 1 and 4-5 (`base` = *the pinned dispatch commit the engine armed*, resolved at checkout — the implementation resolves it after the harness instead); ADR-3/ADR-4.
- **Surviving mutant:** all three new harvest tests (`test/agent.test.ts:276,309,323`) use `sh` harnesses that write files *without committing* — no test dispatches a harness that commits, so the suite cannot discriminate. Fix is in-surface: capture `base` immediately after `createWorkspace` (before the harness), commit any uncommitted leftovers, push whenever `HEAD != base`, and add a committing-harness test plus a moved-tip fold test covering the `base..HEAD` multi-commit replay.

### F9 — major — `foldHarvestBranch` deletes the origin harvest branch in `finally`, on conflict and CAS-exhaustion paths too, destroying the only surviving copy of paid work
- **Where:** `frontend/packages/orchestrator/src/workspace.ts:202-206` (`push origin --delete` unconditional; the local branch and `fetchRef` are also deleted, leaving the commits unreachable).
- **Failure scenario:** worker pushes harvest, push accepted → worker disposes its workspace (`agent.ts:332`) → fold hits a rebase conflict (overlapping surfaces, the exact escalation ADR-4 anticipates) or loses CAS 3× → `finally` deletes the origin harvest branch → the escalated human has nothing to inspect or recover; the role's paid work is gone and must be re-dispatched at full cost.
- **Requirement:** plan ADR-4 ("folds it into the run branch … *then* deletes the harvest branch ref" — delete is sequenced after a successful fold); ADR-3's consequence that work in git is "never lost". Fix: delete the origin ref only on `ok: true`.

### F10 — minor — a narrow-pathspec role that produced no matching file makes `git add` exit 128, reported as a harvest-push failure with the workspace retained, instead of the designed `pushed: false` path
- **Where:** `frontend/packages/runner-agent/src/workspace.ts:85`; error surfaces at `agent.ts:329`. Verified: `git add -A -- <unmatched path>` is `fatal: pathspec … did not match any files` (exit 128).
- **Failure scenario:** analyst harness exits 0 but never creates `spec.md` → `git add -A -- runs/toy/spec.md` throws → outcome `ok: false, "harvest push failed: …"`, workspace retained → engine ages/re-dispatches → each repeat leaks another retained clone. The no-changes test (`agent.test.ts:309`) only covers the `'.'` pathspec, which cannot hit this.

### F11 — minor — plan step 5's "retain the workspace and retry" is implemented as retain-and-give-up: one push attempt, then immediate failure report
- **Where:** `frontend/packages/runner-agent/src/agent.ts:318-330` (single `harvest(...)` attempt; the catch reports and returns).
- **Failure scenario:** transient network blip during the push → failed outcome → the engine re-dispatches and pays twice while the completed work sits in the retained workspace. Converges (like round-1 F3), so minor — but it is a stated deviation from the plan's worker sequence, and the task notes do not flag it.

### F12 — minor — every artifact this round cites "plan.md ADR-8", but the plan contains no ADR-8: the Decisions section still ends at ADR-7
- **Where:** `runs/runner-agent/plan.md:22-39` (amendment header comment names ADR-8; no `### ADR-8` entry follows ADR-7 at plan.md:185); cited by `tasks/04-workstation-agent.yaml:47` and the `af372de` commit message.
- **Failure scenario:** a consumer told to review "against ADR-8" (as this dispatch was) greps the Decisions section and finds nothing — the surface-widening decision exists only as a header comment, unlike ADR-7 which got a full entry for the identical situation.

### F13 — minor, PLAUSIBLE — the task notes' two verification claims contradict each other: round 1 claims 445 passing frontend tests, round 2 claims 259 while *adding* ~14 tests
- **Where:** `runs/runner-agent/tasks/04-workstation-agent.yaml:145-147` ("445 passed, 1 skipped") vs `:218-220` ("259 passed, 1 skipped … all packages").
- **Failure scenario:** at most one count is right; if 259 is accurate, ~186 tests disappeared between a3e6989 and af372de and "no existing test regressed" is unsubstantiated. Not verified here (this review runs git only, per role); the G2 human should re-run `npm test` in `frontend/` before trusting either number.

## Coverage

I checked the whole round-2 commit against the spec and plan; the fold and engine plumbing are solid and well-tested, but the harvest step itself defends against the wrong case — it preserves uncommitted output while the dispatch prompt makes committed output the norm, so the round-1 defect survives for real dispatches.

- F1 fix mechanics, uncommitted case ✓ — clone → harness → add/commit/push → dispose ordering is correct; disposal is gated on the push; a failed push retains the workspace and preserves the paid usage figures in the failure outcome (all three proven against real git repos).
- `foldHarvestBranch` happy path ✓ — fetch, worktree rebase, CAS with 3-attempt retry, local worktree/branch/ref cleanup, origin-branch deletion after a successful fold, all real-git tested; conflict path aborts cleanly and marks `conflict: true` (but see F9 for what `finally` then does, and F8 for the untested moved-tip/multi-commit replay).
- Engine branching ✓ — `managesOwnWorkspace` skips both local checkout forms, passes a placeholder cwd the remote dispatcher never reads, folds under the per-run lock, pushes on success, escalates `fatal` on conflict; the local `HeadlessDispatcher` path (isolation logic, checkout release) is structurally untouched, and the integration test proves ledger metering with the bot identity end to end (AC5.2 shape).
- Harvest relay chain ✓ — the `harvest` field survives verbatim from the worker's report POST through the server mirror (runner-api.ts), `resolveOutcome`'s `call.resolve(outcome)`, to the engine; no field-by-field reconstruction drops it.
- R5 discipline ✓ — the worker's one push targets only a caller-supplied branch that `agent.ts` provably suffixes `--harvest/`; the run branch is never pushed from the workstation; the split grep tests pin both halves, and the harvest branch name cannot collide with the run branch ref.
- `harvestPathspecs` ✓ — mapping matches the plan for analyst/architect/reviewer/ops; the verifier deviation (`.` instead of `verification-report.md`) is flagged inline with a defensible rationale, and the plan's false premise (an existing private consumer) is corrected in the amendment; role-name branching lives in the orchestrator package, keeping the agent's own source grep-clean (AC8.1 still passes).
- Requirement coverage this round — R4 mechanism present but defeated in the prompted case (F8); R5 ✓; R3/R8 unaffected and re-verified via the updated grep tests. Concurrency of parallel folds not assessed beyond the CAS retry (serial worker by spec assumption).

## Boundary check

Everything `af372de` touches is inside the ADR-8-widened surface (orchestrator seam/harvest/workspace/engine/index/manifest + tests, runner-agent src + tests, runner-api.ts) or the run record (task YAML notes; the plan.md amendment was authored by the G1 human under the escalation resolution, which is that file's legitimate writer). Task 05's surface is untouched by this commit. Round-1 F7's two out-of-surface files were not touched this round and still await G2 ratification.

---

# Round 3

**Verdict:** approve
**Round:** 3 of 3
**Diff reviewed:** `6cb9f16` (the round-3 fix; run/runner-agent). `476413c` also inspected — task-YAML notes only, no production change, its claims verified below rather than trusted.

## Round-1/2 findings status

- **F8 — genuinely resolved.** `base` is now captured immediately after `createWorkspace`, before the harness runs (`agent.ts:304`), and `harvestAndPush` takes it as a parameter, sweeping uncommitted leftovers and pushing whenever `HEAD != base` (`workspace.ts:89-144`). The round-2 surviving mutant is dead: a committing harness is exercised twice against real git — end-to-end through `executeIntent` with no harvest/getHead overrides (`test/agent.test.ts:306`, asserts the committed file is on the origin harvest branch) and at the `harvestAndPush` unit level (`test/workspace.test.ts:140`). The fold's `rebase --onto <runTip> <base>` replays the full `base..HEAD` range correctly by construction; the residual multi-commit test gap is F16.
- **F9 — genuinely resolved.** The origin `push --delete` moved out of `finally` to fire only on `result.ok` (`orchestrator/src/workspace.ts:217`); the conflict test now asserts the origin harvest branch survives a failed fold (`harvest-fold.test.ts:101-104`). The CAS-exhaustion path is not separately tested but exits through the same `result.ok === false` guard — same code path, checked clean. Residual durability window is F17.
- **F10 — genuinely resolved.** One `git add -A -- <pathspec>` per pathspec, each failure caught independently (`workspace.ts:103-109`); the mixed matched/unmatched test (`test/workspace.test.ts:118`) proves the matched file survives an unmatched sibling and reaches origin. The catch is broader than the exit-128 case it targets — residual is F15.
- **F11 — resolved in code, unverified by test.** The one-bounded-retry loop exists (`workspace.ts:134-143`) and is safe to re-enter (re-pushing the same `head` OID to the same fresh, timestamp-unique branch is a no-op if attempt 1 actually landed; a divergent ref would be rejected, correctly throwing). But no test forces a first-push failure — see F14.
- **F2 — genuinely resolved.** `main.ts` is now in the R8 harness/vendor grep loop (`test/agent.test.ts:593`, also :540 and :553); the suite passing proves `main.ts` currently greps clean.
- **F12 — genuinely resolved.** A real `### ADR-8` entry now exists in the Decisions section (`plan.md:190-193`) with Choice/Rejected/Consequences in the house style, and it accurately records both round-2 corrections.
- **F13 — resolved, independently confirmed.** This review ran the suite itself (round 2's ask): `npm test` in `frontend/` → **469 passed, 1 skipped, 0 failures, 47 files passed + 1 skipped** — exactly the count `6cb9f16` and `476413c` report. `npm run typecheck` clean. The task notes' explanation (445 vs 259 were full-suite vs three-package subsets) is consistent with those numbers.
- **F3, F4, F5, F6 — still open, untouched by this round,** all minor and pre-existing; the task notes' "Not changed" list records them accurately. F6's family gains a documented sibling (ADR-8 Consequences names the abandoned-harvest-branch hygiene gap) but no mechanism.
- **F7 — stands for G2 ratification.** Neither `frontend/tsconfig.json` nor the round-1 `package-lock.json` delta was touched this round.

## Findings

### F14 — minor — the F11 push retry has zero test coverage: the code is present but the suite cannot tell it exists
- **Where:** `frontend/packages/runner-agent/src/workspace.ts:134-143`; no test in `test/workspace.test.ts` or `test/agent.test.ts` injects a first-push failure (grep for retry/attempt in the package's tests is empty).
- **Failure scenario:** surviving mutant — delete the retry loop and restore the single `git push`; all 469 tests still pass. The behavior round-2 F11 asked for is unpinned and can regress silently.

### F15 — minor, PLAUSIBLE — the per-pathspec `git add` catch swallows *every* failure, not just the unmatched-pathspec exit 128 it targets
- **Where:** `frontend/packages/runner-agent/src/workspace.ts:106-108`.
- **Failure scenario:** a crashed harness git process leaves `.git/index.lock` → every `git add` fails with "index.lock exists", all swallowed as "matched nothing" → `staged` empty → if the harness committed nothing, `head === base` → `pushed: false` → workspace removed with the role's uncommitted output still in it — the F1/F8 silent-loss outcome through a third door. PLAUSIBLE: requires a harness that dies mid-git yet exits 0 with valid usage JSON. Distinguishing exit 128 pathspec errors from other failures would close it.

### F16 — minor — no test covers a harness that both commits AND leaves uncommitted harvest-scoped files, and no fold test replays a multi-commit `base..HEAD` range
- **Where:** `test/workspace.test.ts:118-172` (each test is commit-only or uncommitted-only), `test/agent.test.ts:306` (commit-only), `harvest-fold.test.ts:37-51` (`pushHarvest` always builds a single-commit harvest).
- **Failure scenario:** surviving mutant — change `harvestAndPush` to skip the sweep when `HEAD` already moved past `base` (i.e. harvest only the harness's own commits): the uncommitted-only tests still pass (HEAD hasn't moved when they run the sweep), the committing-harness tests still pass (nothing uncommitted to lose), yet a real harness that commits its report and leaves a fixup dirty loses the fixup silently. The production code handles the mixed case correctly today (verified by reading the sequence: sweep-commit → `head != base` → push); the suite just can't defend it.

### F17 — minor, PLAUSIBLE — the origin harvest branch is deleted after the fold lands *locally* but before the run branch reaches origin
- **Where:** `orchestrator/src/workspace.ts:217` (delete on `result.ok`, immediately after the local CAS) vs `engine.ts:517` (`pushBranch` runs after `foldHarvestBranch` returns; on push failure, `engine.ts:650-660` keeps commits local and just logs).
- **Failure scenario:** fold CASes the local run ref → origin harvest branch deleted → `pushBranch` fails (or the host dies before it runs) → the folded work's only copy is the control plane's local `repoDir` until a later accepted push. Not silent loss — the local blessed checkout is persistent and the next accepted push carries it — but durability now hinges on that one filesystem where round 2's design kept an origin-side copy until the fold was on origin. Fix, if wanted: delete the origin harvest branch after a successful `pushBranch`, or leave it for the existing hygiene sweep gap (ADR-8 Consequences) to own.

## Coverage

I checked the whole of `6cb9f16` against the spec, plan (including the new ADR-8), and both prior rounds; the two real bugs are genuinely fixed with real-git tests, and everything new I could attack yields only minor test-gap or hygiene findings.

- F8 fix mechanics ✓ — capture ordering verified in source (`getHead` after `createWorkspace`/baseOid checkout, before the try that runs the harness); the detached-HEAD case from a pinned `baseOid` checkout is safe (rev-parse, commit-on-detached, and `head:refs/heads/<branch>` push all work detached); `pushed: false` short-circuit is correct for the truly-unchanged case; the `HarvestResult.base` relayed to the fold equals the pre-harness pin.
- Retry idempotence ✓ — the retried push targets a fresh unique branch name with the same OID, so a phantom first-attempt success is a no-op and a divergent ref correctly throws rather than force-pushing.
- Fold restructure ✓ — behavior inside the IIFE is byte-equivalent to round 2's loop (same CAS retry bounds, same conflict abort/message, same worktree/local-branch/fetchRef cleanup in `finally`); only the origin-delete moved, and it stays best-effort (`.catch`) so a delete failure can't fail a landed fold.
- Test integrity ✓ — the committing-harness `executeIntent` test uses the real `createWorkspace`/`harvestAndPush`/`getHead` (only the manifest is stubbed, per the task scope); the updated mocks now assert `base` threads through the seam (`agent.test.ts:179-183`); no assertions were weakened anywhere in the diff.
- Independent verification ✓ — full suite and typecheck run by this review, not taken from the notes: 469 passed / 1 skipped / 0 failures, typecheck clean, matching both round-3 commits' claims.
- `476413c` ✓ — touches only the task YAML; its narrative matches what the code actually shows.

## Boundary check

Everything `6cb9f16` touches is inside the ADR-8-widened surface (orchestrator `workspace.ts` + its fold test, runner-agent src + tests) or the run record (`plan.md`'s ADR-8 entry — written by the G1 human under the escalation resolution, that file's legitimate author; task YAML notes). `476413c` touches the task YAML only. Task 05's and 06's surfaces are untouched. F7's two out-of-surface files remain the only outstanding boundary items, unchanged since round 1.
