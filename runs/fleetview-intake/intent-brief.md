# Intent Brief: Upstream task intake — frictionless run initiation for FleetView

<!-- Authored by Nathan Carter (dictated via cockpit session, 2026-07-15).
     Design-run brief: research spike → synthesized spec → design candidates. -->

## Problem

Initiating a new pipeline run (the G0 approach) is the one consistent pain point
in operating the framework. Under Orchestrator v0 it is trivial *only* because a
harness like Claude Code serves as a cockpit: the operator types "begin an agentic
implementation run of issue #99" and the cockpit does the rest. Under the hosted
v1 stack (FleetView + resident orchestrator) there is no initiation surface at
all: starting a run means hand-authoring `runs/<slug>/intent-brief.md` and
`state.yaml` on a fresh `run/<slug>` branch and pushing it — multi-step,
error-prone, and opaque to anyone but the framework's author. The server's
GitHub webhook intake (`frontend/packages/server/src/webhook.ts`) only refreshes
mirrors and syncs G2 PR reviews; it cannot mint a run. FleetView's web UI is a
read-only observer with gate decisions — it has no "queue new work" affordance.

## Motivation

To be a minimally viable SDLC agent-management framework — not the primary
product focus, but still table stakes — queueing new work must be as frictionless
as the v0 cockpit prompt, from both the UI and the CLI. Adopters are engineers
fluent with chatbot-style assistants; the intake surface is their first contact
with the framework's higher abstraction level, and friction here reads as
"this framework is harder than just chatting with a model." If we don't do this,
every run continues to require the maintainer's hand-rolled scaffold, and the
framework is not adoptable by anyone else.

This is a research-first effort, explicitly to avoid speculation: a UX Researcher
surveys what makes task-intake surfaces work for humans; an architect-style
researcher surveys what integration patterns are technically sound; the two are
synthesized into one set of standards and requirements for Designers to wireframe
and downstream agents to implement and test.

## Constraints

- **No vendor lock-in on task sources.** If GitHub Issues is the de facto only
  source in the first implementation, that is acceptable — but the architecture
  must treat task sources as pluggable, in the spirit of `registry/models.yaml`
  (principle P2's posture applied to upstream integrations). Requirements must
  not hard-wire a single tracker's concepts into contracts or core.
- **Do not over-specify.** Flexibility and agnosticism are structural to the
  design philosophy; the synthesized requirements should set standards and
  boundaries, not prescribe one implementation's every detail.
- **The v0 cockpit is the frictionlessness benchmark**: one natural-language
  utterance from intent to initiated run. The designed surface should approach
  that, not add ceremony to it.
- **Provenance invariants hold at intake.** The intent brief is human-authored
  and gate approvals are written only by the named human approver; no intake
  path may let an agent or an upstream system self-initiate an approved run.
- **UI and CLI are both first-class.** Queueing work must be ergonomic,
  accessible, intuitive, and attractive from FleetView's web UI and from the
  terminal.
- Framework invariants apply as usual: runtime neutrality, consumer-agnostic
  repo, rendered agents never hand-edited.

## Out of scope

- **The return path.** Status write-back to the upstream tracker, closing issues
  when runs land, and backlog synchronization are out of scope for this run's
  requirements and wireframes. Researchers may note bidirectional-sync patterns
  as context where they materially shape intake architecture, but nothing more.
- Changes to the core pipeline roles or gate semantics.
- Committing to a specific task-source vendor as a permanent dependency.
- Implementation itself — this run carries the surface through research,
  synthesized spec, and design candidates; build tasks come later on the
  standard pipeline path.
