# Review Report: 02-remote-dispatcher

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** commit e4684ef (4cf4689..e4684ef, run/runner-agent)

## Findings

### F1 — blocking (escalation driver) — FIFO `slug|role` linking can cross-wire parallel same-role dispatches; the scope's required key is unimplementable in-surface, which is a plan/decomposition defect
- **Where:** `frontend/packages/orchestrator/src/runner-dispatcher.ts:141-148` (dispatch enqueue), `:151-163` (FIFO link in pendingIntents); root cause `frontend/packages/orchestrator/src/seam.ts:8-18` (`DispatchRequest` has no `task`/`round`)
- **Failure scenario:** Two implementer intents A then B armed in one tick (ledger order A, B — engine.ts:463). Each `launch()` awaits `ensureTaskCheckout` before calling `dispatch()` (engine.ts:479-483); B's checkout completes first (git worktree/index-lock timing), so the queue order is B, A. The next poll links ledger entry A to B's call: the workstation receives A's key with B's prompt body, executes the wrong work, and `resolveOutcome` settles the wrong promise — B's cost and outcome close A's ledger entry, silently. The test at runner-dispatcher.test.ts:100-121 pins only the aligned-order case and cannot kill this mutant, because no in-surface implementation could: the disambiguating fields don't exist on the request at dispatch time. The correctness of this layer rests on two orderings no contract pins (engine dispatch-call order vs. ledger order; task 03's `openEntries` projection order).
- **Requirement:** task scope ("keyed by slug|role|task|round"); R7 (outcome must close the matching ledger entry); plan.md:185-186 names parallel-implementer runs as in-scope.
- **Why escalate, not request-changes:** the remedy the implementer correctly names — optional `task`/`round` on `DispatchRequest`, threaded in `launch()` exactly as task 01 threaded `slug`/`branch` — lives in seam.ts/engine.ts, which belong to no remaining task's surface (01 is closed; 03–06 don't list them). The Architect must either amend the task set with that seam extension or explicitly pin both ordering contracts for tasks 03/05. The implementer flagged this deviation themselves; the code is otherwise sound.

### F2 — major, PLAUSIBLE — RemoteDispatcher omits the plan's `managesOwnWorkspace` marker, so the engine's remote-path branching has no hook
- **Where:** `frontend/packages/orchestrator/src/runner-dispatcher.ts:117-124` (class declares only `adapter`); plan.md:51-64 (Dispatcher contract), plan.md:99-109 (launch() branches on it)
- **Failure scenario:** Task 05 wires `RemoteDispatcher` as `cfg.dispatcher` (AC9.2: config choice, same call site); `launch()` per the plan checks `managesOwnWorkspace`, finds it undefined, creates a local checkout and runs the local harvest for a dispatch whose work happened on another machine — nothing is harvested and the harvest branch never folds. PLAUSIBLE: depends on unwritten engine wiring; also decomposition fallout (seam.ts never gained the flag), fixable in task 05's surface, which owns this file.
- **Requirement:** plan Interface contracts (R1, R3, R4 mapping).

### F3 — minor — `PendingIntent` omits the base OID the plan's transport names
- **Where:** `frontend/packages/orchestrator/src/runner-dispatcher.ts:26-36`; plan.md:122 (intent carries "base OID"), plan.md:134 ("The base OID is what makes the harvest foldable")
- **Failure scenario:** The workstation cannot pin its checkout to the armed commit from the intent alone (ADR-2); if the run tip moves between arm and claim, it checks out the wrong base. Documented deferral — the server (task 03) has the repo and can augment the intent — but the augmentation obligation is recorded only in task notes, not in any consuming task's scope.
- **Requirement:** plan Transport (R2), ADR-2.

### F4 — minor — timeout error message rounds to whole minutes
- **Where:** `frontend/packages/orchestrator/src/runner-dispatcher.ts:145`
- **Failure scenario:** Any sub-30s `timeoutMs` (as in the tests) reports "timed out after 0min" in the ledger's error field — misleading in an incident review, never wrong in behavior.
- **Requirement:** none (quality).

## Coverage

I checked the full diff against the task scope, spec requirements R1, R5, and R7, and the plan's interface contracts, and everything except the four findings above came back clean, with the tests and typecheck run and passing on this checkout.

- R1/AC1.1: class implements `Dispatcher` alongside `HeadlessDispatcher`, which is untouched; seam.test.ts unmodified, 12/12 pass ✓
- AC1.2: success, failure (ok:false), and timeout paths each unit-tested against a stubbed remote agent, no network; 14/14 pass ✓
- R5: no filesystem, git, or child-process access anywhere in the new module — grep shows only a type import from seam.ts ✓
- R7 compatibility: timeout rejection lands in `launch()`'s existing catch (engine.ts:502-505) and flows to `closeDispatch`, so the entry closes through the existing path, no parallel aging mechanism added ✓
- AC2.1 (prerequisite for later tasks): `req.cwd` never read; asserted by test and confirmed by grep ✓
- Key format: `fullKey` matches engine.ts:649's private `jobKey` byte-for-byte ✓
- Mutation reasoning on the suite: double-resolve, late-report-after-timeout, unknown-key, re-link-on-second-poll, and intent-without-pending-call mutants all killed ✓; the one surviving mutant is the reordered-link case, which is F1's defect, not a test defect
- State hygiene: `retire()` clears the timer and removes the call from both indexes on every settle path (resolve, timeout) — no leak across the linked/unlinked states ✓
- Full orchestrator package run independently: 148 passed, 1 skipped (opt-in live smoke), 0 failed; `npm run typecheck` clean — implementer's verification claims reproduced ✓
- Concurrency of the dispatcher's own maps: single-threaded event-loop access only, no await between read and write in any method ✓

## Boundary check

Code changes touch exactly the two declared surface files (`src/runner-dispatcher.ts`, `test/runner-dispatcher.test.ts`), both new. The third changed file, `runs/runner-agent/tasks/02-remote-dispatcher.yaml`, is the implementer's append-only notes entry — the contract's report-back channel, not a breach. seam.ts, engine.ts, and schedule.ts are unmodified in range, matching the notes' claims.

## Escalation summary (for the Architect / G2)

Task 02's scope requires keying the pending map by `slug|role|task|round`, but `DispatchRequest` carries neither `task` nor `round` — task 01 threaded only R2's minimum, and no remaining task owns seam.ts/engine.ts. The implementer's FIFO workaround is the best in-surface option and is well-tested for the aligned case, but it makes correctness under parallel same-role dispatches depend on unpinned ordering in the engine and in task 03's unwritten projection (F1), and the plan's `managesOwnWorkspace`/harvest seam contract is likewise homeless (F2). Recommended resolution: a small seam amendment (optional `task`/`round` on `DispatchRequest`, populated in `launch()`; the `managesOwnWorkspace` flag while there), then this dispatcher keys directly at dispatch time and the FIFO layer is retired — the implementer proposed exactly this in the task notes.

---

# Round 2 (of 3)

**Verdict:** escalate
**Round:** 2 of 3
**Diff reviewed:** 7e4b819..6260f0a (run/runner-agent); code range unchanged at 4cf4689..e4684ef

## Delta since round 1

Empty of reviewable work. Every commit in 7e4b819..HEAD (8e651c6, 4872eab, 8559893, a739e17, 6260f0a) touches only `runs/runner-agent/state.yaml`; `git diff --stat e4684ef..HEAD -- frontend/ runs/runner-agent/plan.md runs/runner-agent/spec.md runs/runner-agent/tasks/` is empty. No implementer round ran between round 1 and this dispatch.

## Prior findings — resolution status

- **F1 (blocking) — NOT RESOLVED.** `runner-dispatcher.ts` is byte-identical to e4684ef; the FIFO `slug|role` link at :141-163 stands and the round-1 failure scenario reproduces unchanged. Escalation #3's resolution (state.yaml: "the architect must update the plan to include `seam.ts/engine.ts` in the file surface") names the correct remedy, but no plan amendment, task-surface change, or seam change has landed — the prerequisite for any in-surface fix still does not exist.
- **F2 (major, PLAUSIBLE) — NOT RESOLVED.** Class still declares only `adapter` (`runner-dispatcher.ts:117-124`); no `managesOwnWorkspace` marker, and the pending seam amendment is the natural landing place for it — flagged so the architect's amendment covers it in one pass.
- **F3 (minor) — NOT RESOLVED.** `PendingIntent` (:26-36) still omits a base-OID field; the augmentation obligation is still recorded only in task 02's notes, not in task 03/04/05's scope.
- **F4 (minor) — NOT RESOLVED.** Timeout message at :145 still rounds to whole minutes.

## Findings (new this round)

### F5 — major (process) — round 2 was dispatched with the escalation prerequisite unmet, consuming a review round on a zero-delta diff
- **Where:** `runs/runner-agent/state.yaml` escalations[2] (resolution) vs. commits a739e17/6260f0a; no commit amends `runs/runner-agent/plan.md` or any task's `file_contact_surface`
- **Failure scenario:** rounds are capped at 3; this round can only restate round 1. If the sequence repeats (resume → re-review without the architect's plan amendment and an implementer round landing first), the cap is exhausted with F1 never fixable, forcing a G2 decision on a known-defective correlation layer.
- **Requirement:** escalation #3 resolution (state.yaml); review-round cap (DESIGN.md gate/round model).

## Coverage

I re-verified the entire delta since round 1 and the current tree state of both surface files, and found no new code to assess — the round reduces to confirming that nothing changed and that each prior finding still stands, which I did with git evidence rather than re-execution.

- Delta audit 7e4b819..HEAD: state.yaml only, all five commits ✓
- Surface files vs. e4684ef: byte-identical (`git diff` empty) ✓
- Plan/spec/task files vs. e4684ef: unchanged — escalation prerequisite not landed ✓
- F1–F4 re-checked against current tree at the round-1 file:line anchors: all reproduce ✓
- Tests/typecheck: not re-run — `node_modules` missing in this checkout; round-1 results (26/26, 148 passed package-wide, typecheck clean) carry over exactly because the tree is identical ✓
- Round-1 coverage claims: no reason to revisit; no new code ✓

## Boundary check

No code changed in range, so no surface to breach. The state.yaml edits are the orchestrator's and the human approver's own bookkeeping (its co-writer contract), not task-02 work. This report append is the only file this round modifies.

## Escalation summary (round 2, for the Architect / G2)

Round 1's escalation was resolved with the right directive — amend the plan/task surface so `seam.ts`/`engine.ts` (optional `task`/`round` on `DispatchRequest`, plus the `managesOwnWorkspace` flag) belong to some task — but the directive has not been executed: no plan amendment or implementer round landed before this review was dispatched. There is nothing new to review and F1 remains unfixable in-surface. Requested sequence before round 3: (1) architect lands the plan/task-surface amendment covering seam.ts/engine.ts per escalation #3, folding F2 (and ideally F3's intent-augmentation obligation) into it; (2) an implementer round lands the keyed-at-dispatch fix and retires the FIFO layer, plus the F4 message fix; (3) then dispatch round 3 against that real delta. One review round remains — please do not spend it on another empty diff.

---

# Round 3 (of 3)

**Verdict:** approve
**Round:** 3 of 3
**Diff reviewed:** 8f5bf93..2a143d2 (run/runner-agent): 820c21e (ADR-7 plan amendment, G1 human) + 2a143d2 (implementation). The dispatch prompt's "820c308" is a typo for 820c21e; no such revision exists.

## Prior findings — resolution status

- **F1 (blocking) — RESOLVED.** `dispatch()` keys the pending map by `slug|role|task|round` at dispatch time (`runner-dispatcher.ts:124,135`) from the new `DispatchRequest.task`/`round` fields (`seam.ts:23-24`), threaded by `launch()` from the same intent that derives the ledger entry and the engine's private `jobKey` (`engine.ts:490-491` vs `:414-415,:469`) — key coherence holds by construction. `pendingIntents` is a direct map lookup (`runner-dispatcher.ts:142-144`); the FIFO `queues`/`linked`/`groupKey`/`retire` layer is deleted entirely. The round-1 failure scenario is pinned: the new out-of-order test (runner-dispatcher.test.ts:108-132) dispatches 02-b before 01-a, projects the ledger in the opposite order, and resolves in a third order — the FIFO mutant assigns 01-a's entry the body "task two" and fails it. Mutant killed.
- **F2 (major, PLAUSIBLE) — RESOLVED as re-scoped by ADR-7.** `Dispatcher.managesOwnWorkspace?` declared per the plan's Interface contracts (`seam.ts:40-44`); `RemoteDispatcher` sets it `true` (`runner-dispatcher.ts:112`), tested (runner-dispatcher.test.ts:219-223). ADR-7's choice sentence scopes this task to declaring the marker; the engine-side consumption is not this task's scope — but see F6.
- **F3 (minor) — RESOLVED as re-scoped by ADR-7.** `PendingIntent.baseOid?` carried and doc-committed to server-side augmentation (`runner-dispatcher.ts:37-41`); a test pins that the dispatcher never sets it (runner-dispatcher.test.ts:225-232); the augmentation obligation now lives in task 03's scope text (tasks/03-runner-api.yaml:30-33), no longer only in task 02's notes.
- **F4 (minor) — RESOLVED.** `formatDuration` (`runner-dispatcher.ts:86-90`) replaces the whole-minute rounding at the timeout message (`:132`); test pins "timed out after 20ms" (runner-dispatcher.test.ts:189-194).
- **F5 (major, process) — RESOLVED.** This round reviewed a real delta: the escalation-#3 plan amendment (820c21e) landed before the implementer round (2a143d2), in the sequence round 2 requested.

## Findings (new this round)

### F6 — major, PLAUSIBLE — the plan's remaining engine-side remote contracts have no owning task surface once task 02 closes
- **Where:** plan.md Interface contracts (`DispatchOutcome.harvest`, `harvest.ts`'s `harvestPathspecs`, `workspace.ts`'s `foldHarvestBranch`, `launch()` branching on `managesOwnWorkspace`) vs. the surfaces of tasks 03 (server files only), 04 (`packages/runner-agent/` only), 05 (`start.ts`, `runner-dispatcher.ts`, server `main.ts`), 06 (one test file). `grep managesOwnWorkspace engine.ts` is empty; `DispatchOutcome` has no `harvest` field.
- **Failure scenario:** task 05 wires `RemoteDispatcher`; `launch()` (engine.ts:478-481) still unconditionally creates a local checkout and runs the local fold/harvest for a dispatch executed on another machine — the harvest branch the worker pushes (tasks 03/04) is never folded, so R4/R5's mapping to tasks 02/03/04 cannot be satisfied inside those tasks' declared surfaces. PLAUSIBLE: bites at task 03/04/05 implementation time, not in this diff; the exact decomposition-gap shape that forced escalation #3, visible now rather than at round cap.
- **Requirement:** plan Interface contracts (engine `launch()` branching, `foldHarvestBranch`); requirement→task mapping rows R3/R4. Addressed to the Architect/G1 human: a surface amendment (engine.ts/workspace.ts/harvest.ts into 03, 04, or a new task) before dispatching task 03 or 04 — not an implementer round on this task.

### F7 — minor, PLAUSIBLE — a duplicate-key `dispatch()` silently orphans the first pending call
- **Where:** `runner-dispatcher.ts:135` (unguarded `calls.set`), `:131` (the first call's timer then deletes whichever call now holds the key)
- **Failure scenario:** two `dispatch()` calls with identical `slug|role|task|round` while the first is pending → the second overwrites the map entry; the first's timer later deletes the second's entry, so a legitimate workstation report for the second returns `false` from `resolveOutcome` and the second only ever times out. Not constructible through the engine today — commit-then-launch plus the `jobKey`-keyed job tracking dedupes upstream, and the engine is `dispatch()`'s only caller — hence PLAUSIBLE. A one-line guard (reject on duplicate key) would close it for whatever task 05 wires.

## Coverage

I verified every prior finding against the actual round-3 code, re-reviewed the full delta against the spec and the ADR-7-amended plan, and ran the tests and typecheck on this checkout; everything outside F6 and F7 came back clean.

- F1 fix mechanics: dispatch-time keying, direct lookup, FIFO layer fully deleted ✓
- Key coherence: request fields, ledger entry, and engine `jobKey` all derive from one intent ✓
- Mutation reasoning on the new tests: order-shuffled correlation, round-dropped-key, engine-not-threading, marker-absent, baseOid-set, 0min-message mutants all killed ✓; sole survivor is `formatDuration`'s untested seconds branch — message-only, trivial
- R1/AC1.1: `HeadlessDispatcher` untouched (seam.ts delta is optional fields + doc comments); prior 12 seam tests unchanged in substance, one new test appended under the ADR-7-widened surface ✓
- AC1.2: success/failure/timeout paths still stub-tested, no network ✓
- R5/AC2.1: still no fs, git, or child-process access in the dispatcher; `req.cwd` never read ✓
- R7: timeout rejection still lands in `launch()`'s catch and flows to `closeDispatch`; no parallel aging added ✓
- State hygiene: single `calls` map; both settle paths clear timer and entry ✓
- Tests: target suites 32/32; full orchestrator package 154 passed, 1 skipped (opt-in live smoke), 0 failed; `npm run typecheck` clean ✓
- Plan amendment (820c21e) faithfully records escalation #3: ADR-7, header note, task 02 surface widening, task 03 baseOid obligation ✓

## Boundary check

Implementation commit 2a143d2 touches exactly five code files, all inside the ADR-7-widened surface (`seam.ts`, `engine.ts`, `runner-dispatcher.ts`, both test files), plus task 02's append-only notes — the contract's report-back channel. The engine.ts delta is minimally scoped: two threaded fields in `launch()`, nothing else. Amendment commit 820c21e (plan.md, tasks/02 surface, tasks/03 scope) is the G1 human's own escalation-resolution edit, not implementer work. Remaining commits in range are orchestrator/human state.yaml bookkeeping. No breach.

## Note for G2

Approving on this task's own merits: all four round-1 findings are genuinely resolved, the fix removes the defect class rather than testing around it, and the suite now discriminates the reordering failure that drove escalation #3. F6 is a plan-decomposition gap affecting not-yet-dispatched tasks — it needs an Architect surface amendment before task 03/04 dispatch, and approving task 02 does not foreclose that.
