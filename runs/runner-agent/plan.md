# Technical Plan: The runner agent — remote dispatch that preserves its work

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     AMENDMENT (G1-redo, 2026-07-23): the prior plan was declined at G1. The
     decline concerned one decision — "Disposable workspace via shallow clone +
     checkout + rm" — which would delete the agent's produced files before the
     control plane can commit them, defeating the runner's purpose. This redo
     supersedes that decision (see ADR-3) and leaves every other section
     redesigned only as far as that correction requires. The file-contact
     surfaces are unchanged by the redesign, so the task breakdown stands.
     REQUIREMENT SOURCING: the G0 spec was not present in this working tree, so
     R1–R6 below are reconstructed from the design of record (docs/TOPOLOGY.md
     §3.3) plus the decline. The G1 human should reconcile these numbers
     against the actual approved spec.
     AMENDMENT (escalation #3, 2026-07-23): review-02.md F1 found task 02's
     required correlation key (`slug|role|task|round`) unimplementable in its
     declared surface — a decomposition defect. ADR-7 supersedes the FIFO
     linking approach and widens task 02's surface to the seam files task 01
     owned. Recorded by the G1 human per the escalation's resolution; every
     other section stands.
     AMENDMENT (review-04.md F1, 2026-07-24): task 04's round 1 implemented
     the workstation agent's clone/spawn/parse loop faithfully, but its
     unconditional `finally { await ws.remove() }` deletes the agent's
     produced files before the control plane can ever see them — the exact
     defect ADR-3 exists to prevent. The fix (harvest-then-dispose per the
     Interface contracts' `harvestPathspecs`/`foldHarvestBranch`/`launch()`
     branching, all already specified above) spans `seam.ts` (the `harvest`
     field on `DispatchOutcome`, not yet added despite the interface contract
     naming it), `harvest.ts` (new — `harvestPathspecs` had no existing
     private consumer to extract, contrary to this plan's Interface contracts
     section; written fresh), `workspace.ts` (`foldHarvestBranch`),
     `engine.ts` (`launch()`'s `managesOwnWorkspace` branch), and
     `runner-api.ts` (the outcome mirror's `harvest` field) — none of which
     task 04 or 05 declared. ADR-8 widens task 04's surface to cover them, the
     same widening pattern ADR-7 used for task 02. Recorded by the G1 human
     (direct implementation, this escalation) per review-04.md F1's own
     resolution guidance ("a decomposition defect for the Architect/G1 human,
     not an implementer round"); every other section stands. -->

## Approach
The runner is a remote dispatcher whose harness runs on a workstation and whose work product must reach the control plane before it can be committed. It reuses the existing dispatch seam and harvest discipline rather than inventing a remote protocol. The one redesign this redo forces is the workspace lifecycle.

The runner has two halves. A relay dispatcher lives in the engine process and turns a dispatch call into a server handoff plus an awaited outcome. A worker runs on the workstation: it polls the control plane for an intent, checks out the run branch at the pinned base commit, runs the adapter's headless command in it, then harvests the produced files and reports back.

The declined idea is right about disposability and wrong about ordering. In the local model the engine already rescues a role's uncommitted files from the checkout before force-removing it, then commits the closing bookkeeping. The remote model cannot reuse that exact path because the engine cannot stage a working tree on another machine. So the worker harvests where the tree lives: it commits the role's own pathspecs to a harvest branch and pushes that branch to origin.

Disposal is gated on that push. The workspace is removed only after the harvest commit reaches origin, never on harness return. The control plane stays the sole writer of the run branch: it fetches the harvest branch and folds it with the existing rebase-plus-compare-and-swap discipline. A fold conflict means overlapping file-contact surfaces, which is a plan defect.

Three things do not change:
- The seam remains the single metering point.
- The runner stays adapter-generic.
- Git remains the only store, so a lost workspace costs a re-checkout, never state.

## Interface contracts

### `seam.ts` — `DispatchOutcome` gains a harvest handoff (R4, R5)

```ts
export interface DispatchOutcome {
  ok: boolean
  costUsd: number | null
  tokensIn: number | null
  tokensOut: number | null
  error: string | null
  fatal?: boolean
  /** Present when the dispatcher harvested the agent's work to a branch the
   *  engine folds (the remote worker). Null for the local headless
   *  dispatcher, which leaves working-tree changes for the engine's own
   *  harvest() to commit. */
  harvest?: { branch: string; base: string } | null
}
```

### `seam.ts` — `Dispatcher` gains a workspace-management flag (R1, R3)

```ts
export interface Dispatcher {
  readonly adapter: string
  /** True when this dispatcher creates its own workspace and harvests its own
   *  work (the remote worker). The engine then creates no local checkout and,
   *  on outcome.harvest, folds the branch instead of running its local
   *  harvest(). HeadlessDispatcher leaves this unset (local). */
  readonly managesOwnWorkspace?: boolean
  adapterFor?(role: string): string
  dispatch(req: DispatchRequest): Promise<DispatchOutcome>
  abortAll?(): number
}
```

### `harvest.ts` (new, shared) — the role-scoped harvest rule (R4)

```ts
/** A role's own outputs under the run dir — the harvest scope, never a
 *  peer's mid-flight file. Shared by the engine's local harvest and the
 *  remote worker's harvest-then-dispose, so the rule has one home. */
export function harvestPathspecs(
  runsRoot: string, slug: string, role: string, task: string | null,
): string[]
```

The mapping is the one `engine.ts` already encodes privately: analyst →
`spec.md`, architect → `plan.md` + `tasks/`, reviewer → `review-*.md`,
verifier → `verification-report.md`, ops → `release-plan.md`. Moving it to a
shared module is the only refactor this run needs. It has today a single
private consumer, so no exhaustive switch breaks.

### `workspace.ts` — `foldHarvestBranch` reuses the fold discipline (R4, R5)

```ts
export interface FoldResult { ok: boolean; conflict: boolean; message: string }

/** Fold a worker-pushed harvest branch into the run branch as the sole writer:
 *  fetch the harvest branch, rebase it onto the current run tip, CAS the run
 *  branch ref, then delete the harvest branch ref. A rebase conflict means
 *  overlapping file-contact surfaces — a plan defect — and escalates. Mirrors
 *  foldTaskBranch's shape and runs under the engine's per-run write lock. */
export async function foldHarvestBranch(
  repoDir: string, runBranch: string, harvest: { branch: string; base: string },
): Promise<FoldResult>
```

### `engine.ts` — `launch()` branches on workspace ownership (R3, R4, R5)

For a dispatcher with `managesOwnWorkspace` set, `launch()`:
- skips `ensureRunCheckout`/`ensureTaskCheckout` (the worker owns its checkout).
- calls `dispatch()` and, on `outcome.harvest`, calls `foldHarvestBranch` under the run write lock in place of the local `harvest()`.
- pushes the folded run branch (the existing `pushBranch`).
- then runs `closeDispatch` (ledger, metering) exactly as today.

The local `harvest()` path is unchanged for the headless dispatcher. Remote
dispatches are naturally isolated: each gets its own workspace, so the shared-
checkout hazard that motivated per-task worktrees does not arise.

### Worker harvest-then-dispose sequence (R3, R4, R6) — steps, not bodies

1. Resolve `base` = the pinned dispatch commit (the run tip the engine armed).
2. Check out a workspace at `base` (a shallow clone or a worktree of the worker's own clone, holding no authority).
3. Run the adapter's headless command (the manifest's `command`/`dispatchPrompt`, exactly as `HeadlessDispatcher.dispatch` builds them) under the role timeout.
4. On `ok`, harvest: `git add -A -- <harvestPathspecs(...)>`, then a bot-identity commit on a harvest branch `run/<slug>--harvest/<dispatch-id>` off `base`, message `state(<slug>): harvested <role> artifacts`.
5. Push the harvest branch to origin. Only on an accepted push, dispose the workspace. On a rejected push, retain the workspace and retry — the work is in git locally and is never lost.
6. POST `{ ok, costUsd, tokensIn, tokensOut, error, harvest }` to the control plane, which folds and meters.

### Transport (R2) — new server routes, path/auth confirmed at task 01

- `GET /api/runner/intent` → the next armed dispatch intent (role, slug, body, base OID, role timeout), or 204.
- `POST /api/runner/outcome` → `{ slug, role, task, round, outcome }`. The engine matches it to the open ledger entry, folds `outcome.harvest`, and runs `closeDispatch`.
- The workstation opens no inbound port. The worker polls, and the relay dispatcher's `dispatch()` hands the intent to an in-process queue the server serves, returning a promise that resolves on the worker's outcome POST.

## Decisions (ADRs)

### ADR-1: The runner is a remote `Dispatcher` — a relay hands off, a worker executes (R1, R2)
- **Choice:** A relay `Dispatcher` in the engine process turns `dispatch()` into a server handoff plus an awaited outcome, and a worker process on the workstation polls for the intent, executes the harness, and posts the outcome. This keeps the seam as the engine's only dispatch call, so metering and the duplicate-dispatch guard stay where they are.
- **Rejected:** A bespoke runner protocol outside the seam — it would fork the single metering point and the commit-then-launch guard, the two properties the seam exists to hold.
- **Consequences:** The engine gains one new `Dispatcher` implementation and the server gains one intent/outcome route pair. The relay's `dispatch()` is long-lived (it resolves when the worker reports), so the engine's existing per-run in-flight tracking covers it without a new concept.

### ADR-2: The workspace is a checkout at the pinned base commit — a shallow clone suffices (R3)
- **Choice:** The worker checks out the run branch at the exact commit the engine armed (the base OID carried in the intent). A shallow clone is fine because the workspace is not a state replica and holds no authority. The base OID is what makes the harvest foldable.
- **Rejected:** A full clone on every dispatch — slower and larger than a role's output needs, with no functional gain once the base OID is recorded.
- **Consequences:** The fold's correctness rests on the base OID matching an ancestor of the run tip. If the tip has moved, the fold rebases. That is handled by ADR-4, not by the checkout.

### ADR-3 (amendment — supersedes the declined "Disposable workspace via shallow clone + checkout + rm"): Harvest-then-dispose, gated on origin (R4, R6)
- **Choice:** The worker harvests the role's own pathspecs into a commit on its own machine and pushes a harvest branch, and only then disposes the workspace. Disposal is gated on the harvest reaching origin, never on the harness returning. This is the remote mirror of the engine's existing local rule, which commits a role's uncommitted files before force-removing its checkout.
- **Rejected:**
  - The declined "shallow clone + checkout + rm" with the rm on harness return — it deletes the produced files before the control plane can ever see them, which is the exact defect the decline named.
  - Returning a diff patch in the outcome for the engine to apply — it loses on binary files, renames, and mode changes, couples the transport to patch size, and fails (forcing a re-dispatch) on a moved tip instead of three-way merging.
  - Having the worker push the run branch directly — it breaks the one-writer-per-branch rule and would race the control plane's own writes, needing ref surgery on a non-fast-forward.
- **Consequences:** The worker needs push authority scoped to harvest branches (never the run branch). The control plane remains the sole writer of the run branch, because only its fold moves that ref. A dispatch whose harvest push fails keeps its workspace until the push succeeds or the control plane ages the entry out.

### ADR-4: The control plane folds the harvest branch as the sole run-branch writer (R4, R5)
- **Choice:** The engine fetches the harvest branch and folds it into the run branch with the existing rebase-plus-compare-and-swap discipline, then deletes the harvest branch ref. A rebase conflict is treated as a plan defect (overlapping file-contact surfaces) and escalates, exactly as the per-task fold already does.
- **Rejected:** Applying the worker's patch directly — same fragility as in ADR-3, and it gives up the three-way merge a rebase provides against a moved tip.
- **Consequences:** The fold reuses `foldTaskBranch`'s shape, so one new function carries the whole mechanism. A moved tip is reconciled by rebase rather than by discarding work. Only a genuine surface overlap fails, and that is an Architect guarantee, not a runtime surprise.

### ADR-5: Metering stays in the seam — the runner reports, the engine meters (R5)
- **Choice:** The worker reports the usage its harness emits (parsed by the manifest's `usage` spec, exactly as `HeadlessDispatcher` parses it), and the engine meters it through the same ledger path as every local dispatch. The runner holds no state and no run-branch authority.
- **Rejected:** Metering in the worker — it would split the single metering point the seam is and drift from the ledger the engine already keeps.
- **Consequences:** A worker whose harness reports no usage is metered at the registry's static estimate, the same fallback the local dispatcher uses. The runner never writes `state.yaml` or the run branch.

### ADR-6: Binding environment constraints (R3, R6, cross-cutting)
- **Choice:** The worker is a Node process on a workstation under an operator subscription, polling a control plane that ships as one supervised unit with the engine. It is verified by unit tests (the harvest-then-dispose ordering, the fold's compare-and-swap, disposal-gated-on-push, conflict-as-plan-defect) and by a shadow replay of a finished run — never by a live poll against this repository.
- **Rejected:** Live integration against this repo — the AGENTS.md invariant forbids running a live orchestrator poll here, because it dispatches real, metered agents onto live branches.
- **Consequences:** The transport and fold are stubbed in tests. The only end-to-end evidence is a shadow replay. The worker's toolchain is Node ≥ 24 running the TypeScript sources directly, matching the engine.

### ADR-7 (amendment — escalation #3, 2026-07-23): Dispatch correlation is keyed at dispatch time — `DispatchRequest` carries optional `task` and `round` (R1, R5)
- **Choice:** Extend `DispatchRequest` with optional `task` and `round`, threaded through the engine's `launch()` exactly as task 01 threaded `slug`/`branch`. The relay dispatcher keys its pending map and `pendingIntents()` directly from the request at dispatch time and retires its FIFO `slug|role` linking layer. While the seam is open, the relay also declares the `managesOwnWorkspace` marker from the Interface contracts so the engine's remote-path branching has its hook (review-02.md F2), and task 03's intents response carries the base OID of the armed commit (ADR-2's pin), augmented server-side where the repo lives (review-02.md F3).
- **Rejected:** Pinning the engine's dispatch-call order and the server's projection order as contracts so FIFO linking stays sound — two orderings no test can economically hold, and review-02.md F1 shows the cross-wiring failure under parallel same-role dispatches.
- **Consequences:** Task 02's file-contact surface widens to include `seam.ts`, `engine.ts`, and `test/seam.test.ts` — the same files task 01 owned. No pending task's surface overlaps the widened set, and task 05 (which shares `runner-dispatcher.ts`) is already serialized behind 02 via `depends_on`. Correctness under parallel same-role dispatches no longer rests on unpinned ordering. Widened under the G1 human's authority (docs/WALKTHROUGH.md) per escalation #3's resolution.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 (remote dispatcher, adapter-generic) | 01, 02 |
| R2 (polls the control plane, no inbound port) | 01, 02 |
| R3 (disposable workspace checkout, no authority) | 02, 03 |
| R4 (work preserved for commit, control plane sole writer) | 02, 03, 04 |
| R5 (outcome+usage through the seam, metered by the engine) | 01, 03, 04 |
| R6 (disposable after harvest, git the only store) | 02, 03, 04 |

Tasks accompany this plan per `contracts/work-item.yaml`. The redesign is
ADR-scoped: the runner still touches the seam, a new worker module, the
engine's fold path, and a shared harvest module — the same surfaces the
prior task breakdown named — so the breakdown is unchanged.

## Risks
- **The worker's push credentials may not cover origin.** The operator
  subscription that justifies the runner may be read-only at the framework
  repo. Early signal: the first real harvest push is rejected. Response: fall
  back to the patch-in-outcome transport (ADR-3's rejected alternative) or
  scope a credential to harvest-branch push only.
- **A moved run tip between dispatch and harvest forces a fold rebase.** A
  real file-surface overlap surfaces as a conflict, which is a plan defect.
  Early signal: a fold conflict on a parallel-implementer run. Response: the
  Architect guarantees disjoint surfaces, the standing rule.
- **The server route and auth shape for the runner is new.** Pinning it here
  risks a mismatch with the server's middleware. Early signal: a typecheck or
  route test failure in task 01. Response: confirm against the server's
  existing `/api/*` route conventions before implementing.
- **No live test against this repo.** A live runner poll is forbidden here.
  Early signal: a test that shells out to a real poll. Response: keep the
  transport stubbed and prove end-to-end with a shadow replay only.
- **Requirement numbers are reconstructed, not read from the G0 spec.** If
  the approved spec numbers R1–R6 differently, the mapping table is wrong.
  Early signal: the G1 human's reconciliation. Response: renumber on
  confirmation before any implementer reads this plan.
