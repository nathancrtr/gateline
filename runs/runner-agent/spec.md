# Specification: Runner agent (subscription-billed dispatch off the control-plane machine)

## Context

The dispatch seam (`frontend/packages/orchestrator/src/seam.ts`) has exactly one
`Dispatcher` implementation, `HeadlessDispatcher` (`seam.ts:47`), which `spawn()`s the
headless harness CLI as a same-machine child process, in a worktree checkout the
engine itself manages under the control plane's own `repoDir` (`workspace.ts`'s
`ensureRunCheckout`/`ensureTaskCheckout`). `DispatchRequest.cwd` (`seam.ts:9`) is
therefore a local filesystem path, not a portable identifier — the seam as it stands
has no way to tell a process on a different machine which branch to check out. This
is a real mismatch with the brief's framing ("exactly one new component"): closing it
needs the seam to convey run/branch identity, not only a path, which the requirements
below state as a need without dictating the interface change itself (the Architect's
call). TOPOLOGY.md §3.3 already names the target shape — poll, execute in a disposable
workspace, report back, no authority on the workstation — and ORCHESTRATOR.md §4.4's
commit-then-launch plus the engine's stale-dispatch aging (`engine.ts`'s `sweepStale`,
keyed off `this.jobs`/`staleMs`) is the reuse target the brief names for lease
semantics.

## Requirements

### R1 — A new `Dispatcher` peer to `HeadlessDispatcher`
A remote-execution `Dispatcher` implementation exists, satisfying the same
`Dispatcher` interface (`seam.ts`) `HeadlessDispatcher` satisfies today, without
modifying `HeadlessDispatcher`'s own spawn/child-process behavior.
**Acceptance criteria:**
- [ ] AC1.1 — A class implementing `Dispatcher` exists alongside `HeadlessDispatcher`; `HeadlessDispatcher`'s existing unit tests continue to pass unmodified.
- [ ] AC1.2 — `npm test` in `frontend/` includes passing unit tests for the new dispatcher's `dispatch()` success, failure, and timeout paths, run against a stubbed remote agent (no real network/workstation required).

### R2 — Seam conveys run identity, not only a local path
`dispatch()` (or its request shape, for the remote path) carries what a process on a
different machine needs to materialize its own workspace — run slug and branch at
minimum — rather than assuming a shared filesystem with the control plane.
**Acceptance criteria:**
- [ ] AC2.1 — The remote dispatcher never reads or requires `DispatchRequest.cwd` to resolve a filesystem path that only exists on the control-plane machine; a code review / grep shows no such assumption in the new dispatcher's implementation.
- [ ] AC2.2 — A dispatch through the remote path resolves, on the workstation side, to the correct run branch (and task branch, for isolated implementer dispatches) using only information the request carries plus the repository's remote URL.

### R3 — Workstation agent: poll, execute, report; no inbound port
A standalone, long-running process exists that authenticates to the control plane,
polls it for pending dispatch intents (no inbound connection is ever accepted on the
workstation), executes the adapter's headless command as declared by its manifest,
and reports the outcome and usage back.
**Acceptance criteria:**
- [ ] AC3.1 — Starting the agent process and inspecting its open sockets (e.g. `lsof -p <pid> -i`) shows outbound connections only — no listening port.
- [ ] AC3.2 — With a dispatch intent armed on the control plane for the registered workstation, the agent claims it within one polling interval, executes the manifest's `command`, and the control plane observes a `DispatchOutcome` (ok/error, cost, tokens) equivalent in shape to one produced by `HeadlessDispatcher`.

### R4 — Disposable workspace; no persistent clone (CI-runner semantics)
Each dispatch runs in a workspace checkout created fresh for that dispatch and
discarded once its closing commit has landed through the control plane; the agent
does not retain a persistent clone of run branches between dispatches.
**Acceptance criteria:**
- [ ] AC4.1 — After a dispatch completes, the workspace directory used for it no longer exists on the workstation's filesystem.
- [ ] AC4.2 — Across two consecutive dispatches (same or different run), the workstation shows two independently created workspaces — never one checkout left mounted/reused/updated in place between dispatches.

### R5 — Control plane remains the sole writer
The runner agent never writes `state.yaml`, `gates.*`, or any run-branch ref directly;
it reports outcome and usage, and the control plane's existing closing-bookkeeping
path (`engine.ts`'s `closeDispatch`) is what commits and meters, exactly as it does for
`HeadlessDispatcher` today.
**Acceptance criteria:**
- [ ] AC5.1 — A grep of the runner agent's source shows no call that writes to a run branch, `state.yaml`, or `gates.*`.
- [ ] AC5.2 — An end-to-end dispatch through the runner path produces a `budget.ledger[]` entry with the same fields populated (`cost_usd`, `tokens_in`, `tokens_out`, `at`) and the same commit-author identity (the control plane's bot identity) as a `HeadlessDispatcher` dispatch — never an identity or commit originating from the workstation.

### R6 — Service-token auth, mirroring the webhook-bypass shape
The poll/report surface is authenticated by a service token the route itself verifies
(config-gated existence — absent secret, route does not exist — matching
`buildWebhook`'s `secret` gate in `frontend/packages/server/src/webhook.ts`), so it can
sit behind the same identity-aware-proxy bypass pattern already documented for GitHub
webhooks (docs/DEPLOY.md's "Cloudflare Access bypass for the webhook path").
**Acceptance criteria:**
- [ ] AC6.1 — With no service token configured, the poll/report endpoint(s) do not exist (404 or unmounted) — mirrors `buildWebhook` returning `undefined` when `secret` is unset.
- [ ] AC6.2 — A request presenting an invalid or missing token is rejected regardless of network path; a request with a valid token succeeds. An automated test analogous to `frontend/packages/server/test/webhook.test.ts` covers both cases.

### R7 — Lease semantics reuse the engine's existing machinery, extended explicitly if needed
A dispatch intent never claimed by the workstation agent, or claimed and then
abandoned (agent dies mid-job), is recovered without a second queue/lease mechanism —
reusing the engine's open-ledger-entry + stale-aging path (`engine.ts`'s `sweepStale`,
`staleMs`) — or, if that path's liveness check (`this.jobs.has(key)`, which is
per-process memory) cannot correctly distinguish "engine restarted, remote job still
genuinely running" from "lost," the required extension (e.g., a claimed-at / lease
timestamp recorded in the ledger entry) is named and implemented as part of this run
rather than silently forked.
**Acceptance criteria:**
- [ ] AC7.1 — An intent that no workstation agent ever claims is aged out and marked failed within the configured `staleMs` window, by the existing heartbeat path, with no new parallel aging mechanism added.
- [ ] AC7.2 — Killing the workstation agent process mid-dispatch and restarting it converges (the ledger entry is either recovered by the still-running agent or aged out and retried) with no duplicate dispatch for the same ledger entry — verified by a test analogous in spirit to the orchestrator's existing crash-recovery drill (`test/hardening.test.ts`).

### R8 — Adapter- and role-generic execution
The workstation agent contains no role-specific or harness/vendor-specific branching;
it executes whatever the target adapter's `headless` manifest section
(`manifest.ts`'s `HeadlessManifest`) declares, the same contract `HeadlessDispatcher`
honors.
**Acceptance criteria:**
- [ ] AC8.1 — A grep of the runner agent's dispatch-execution code for role names (`analyst`, `implementer`, `reviewer`, …) or harness/vendor names returns nothing outside of manifest-driven data.
- [ ] AC8.2 — Pointing the same runner agent at a run using a different adapter (different `manifest.json`) changes what command it runs with zero code changes to the agent.

### R9 — Coexistence with the in-process API-key path
Enabling the runner-agent path is opt-in and does not alter or require removing
`HeadlessDispatcher`'s in-process, same-machine dispatch.
**Acceptance criteria:**
- [ ] AC9.1 — A hosted deployment with `ORCH_ENABLED=1` and no runner agent registered dispatches via `HeadlessDispatcher` exactly as before this run; the existing orchestrator test suite passes unmodified for that path.
- [ ] AC9.2 — Selecting the runner-agent path (vs. `HeadlessDispatcher`) is a configuration choice, not a code fork of the engine's dispatch call site.

### R10 — Proven end to end, once
One real dispatch round-trips through the full runner-agent path — control plane
arms an intent, the workstation agent claims it, executes a real (cheap) prompt
through a real headless harness login, and the control plane meters a real
`DispatchOutcome` — analogous to the existing opt-in `ORCH_LIVE_SMOKE=1` proof for
`HeadlessDispatcher` (`frontend/packages/orchestrator/test/live-smoke.test.ts`).
**Acceptance criteria:**
- [ ] AC10.1 — An opt-in live-smoke test (real spend, skipped by default) exists for the runner-agent path and, when run manually, reports `ok: true` with `costUsd`, `tokensIn`, `tokensOut` all populated and greater than zero — mirroring `live-smoke.test.ts`'s assertions.

## Assumptions

- **ASSUMPTION:** The brief does not say whether the workstation agent may execute more than one dispatch concurrently → resolved as: serial execution, at most one in-flight dispatch per agent, because the brief scopes this run to "one agent, one workstation" and the CI-runner analogy (TOPOLOGY.md §3.3) it invokes is a single-job-at-a-time runner by default; concurrency is a follow-on if evidence shows it's needed.
- **ASSUMPTION:** The brief says auth should "mirror" the webhook-bypass shape but the webhook route is a fire-and-forget HMAC-signed event notification, while the runner needs a request/response poll-and-report exchange → resolved as: the requirement (R6) is the *shape* (config-gated route existence; the route authenticates itself; safe to sit behind an Access-bypass policy) — not literally HMAC-over-body. The specific token mechanism (bearer token vs. signed request) is left to the Architect.
- **ASSUMPTION:** The brief does not address how the harness CLI comes to be logged in on the workstation (the subscription session itself) → resolved as: out of scope for this spec; the runner agent assumes a harness CLI already authenticated on the workstation, the same way `HeadlessDispatcher` assumes a login or API key is already present in its environment.
- **ASSUMPTION:** "Disposable workspace checkout" (brief) doesn't say whether it is cloned from `origin` or otherwise provisioned → resolved as: unspecified mechanism, but the requirement (R4) fixes the observable property (fresh per dispatch, discarded after) and leaves the provisioning method to the Architect.

## Out of scope

- Changing the billing/auth posture decision itself (API-key dispatch stays the
  same-machine default).
- A push/webhook transport for dispatch intents, or any inbound port on the
  workstation.
- Multi-agent / multi-workstation fan-out (more than one runner agent registered
  against the same control plane at once).
- Changes to `HeadlessDispatcher`'s own spawn/child-process behavior beyond sharing
  manifest-execution logic if convenient.
- A dedicated FleetView UI surface for runner-agent liveness/registration.
- Packaging/distribution of the agent as an installable artifact (npx package, binary
  release).
- Bootstrapping or documenting the harness CLI's subscription login on the
  workstation.
- Extending the engine's lease/liveness model beyond what R7 explicitly requires —
  no second, general-purpose job queue.
