# Intent Brief: Runner agent

## Problem

The dispatch seam (`frontend/packages/orchestrator/src/seam.ts`) has exactly one
`Dispatcher` implementation, `HeadlessDispatcher`, which spawns the harness CLI as a
child process of the orchestrator itself. That forces the orchestrator onto whatever
machine holds the subscription-billed harness login — because API-key billing is a
choice the operator can make, but a `claude`/`copilot` CLI login session is tied to a
specific logged-in machine. #100/#103/#104 (all closed) removed every other reason
the orchestrator had for running off the control-plane machine and hardened it
against the split-brain failure modes that split topology produced (stale
derivations, silent push rejection). The one legitimate reason left — billing — has
no answer yet: subscription-billed dispatch still requires *some* process to run on
the operator's own machine, and today that means the whole orchestrator, with its
own clone, its own fetch loop, and its own state authority.

## Motivation

This is the last open piece of epic #107 (topology consolidation) and the epic's
exit criterion depends on it: "no deployment topology exists in which two processes
hold writable clones of the same run branches." Closing #106 is what lets the
control plane run as a single hosted authority *and* still dispatch through
subscription billing — without reintroducing the second state authority that caused
the 2026-07-15/16 incidents (#96, #97, #100, #103, #104). If we don't do this, the
operator is stuck choosing between API-key billing (working today, but costlier at
volume) or reopening the split-topology hazard the rest of the epic just closed.

## Constraints

- Exactly one new component: a thin workstation agent implementing the existing
  `Dispatcher` interface (`seam.ts`). It is a peer to `HeadlessDispatcher`, not a
  replacement — API-key dispatch keeps running in-process on the control plane;
  this only covers the subscription-billed path.
- CI-runner semantics, not a second control plane (TOPOLOGY.md §3.3): the agent
  executes in a **disposable workspace checkout** per dispatch. The checkout holds
  no authority and is discarded once the closing commit is pushed back through the
  control plane's write path. The agent must not materialize or retain a persistent
  clone of run branches — that is exactly the pattern #104 removed.
- Transport starts low-tech and stays that way for this run: the agent **polls** the
  control plane for dispatch intents; no inbound port is opened on the workstation.
  Designing a push/webhook transport is out of scope (see below).
- All state writing and metering stays on the control plane (the single-metering-
  point property of the seam, ORCHESTRATOR.md §6). The agent reports outcome +
  usage; it never writes `gates.*`, `state.yaml`, or any run branch directly.
- Auth between agent and control plane needs a service-token path. The deployment
  already sits behind an identity-aware proxy (docs/DEPLOY.md); the existing
  webhook-bypass shape is the precedent to mirror, not a new auth model to invent.
- Dispatch queueing and lease semantics (agent dies mid-job, or never claims a
  dispatch) reuse the engine's existing open-ledger-entry + stale-aging machinery
  (`frontend/packages/orchestrator/src/engine.ts`, `shutdown.ts`) rather than
  inventing a queue. If that machinery needs extending to model a remote lease
  instead of a local process, say so explicitly — do not silently fork a second
  mechanism.
- Adapter-generic by construction (P2): the agent must not special-case a role or
  harness. It executes whatever headless command the manifest declares, the same
  contract `HeadlessDispatcher` honors today.
- No vendor or model name in `roles/` or `contracts/` (P2, unaffected by this run,
  restated because the agent's manifest-driven design touches the same seam).
- Sequenced after #104/#103/#100 — all closed on `main`; plan against current `main`.

## Out of scope

- Changing the billing/auth posture decision itself (#100 already settled that
  API-key dispatch is the blessed same-machine default; this run only adds the
  subscription-billed alternative back without the split-brain cost).
- A push/webhook transport for dispatch intents, or any inbound port on the
  workstation — polling is sufficient for this run; revisit only if polling proves
  materially insufficient in practice.
- Multi-agent / multi-workstation fan-out (more than one runner agent registered
  against the same control plane at once). One agent, one workstation, for this run.
- Changes to `HeadlessDispatcher` itself beyond what's needed to share the manifest-
  execution logic; the in-process API-key path is not being touched.
- FleetView UI for runner-agent liveness/registration (TOPOLOGY.md §3.4's liveness
  banner covers engine liveness broadly; a dedicated runner-agent status surface is
  a follow-on if this run's evidence shows it's needed).
- Packaging/distribution of the agent as an installable artifact (npx package,
  binary release) — this run proves the mechanism; distribution polish is follow-on.
