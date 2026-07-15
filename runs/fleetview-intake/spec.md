# Specification: Upstream task intake — frictionless run initiation for FleetView

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier,
     and — for this design run — by Designer agents producing wireframe
     candidates. Gate: G0. -->

## Context

FleetView's web UI has no "queue new work" affordance (three-item nav, no create
action) and its CLI has no create command; the only existing write paths are gate
decisions (`decide()`) and the read-only GitHub webhook, which never mints a run
(ux Scope, confirmed by grep). Starting a run today means hand-authoring
`runs/<slug>/intent-brief.md` and `state.yaml` and pushing `run/<slug>` by hand —
the gap the brief describes is real, not partially built. Two research reports
(`ux-research.md`, `tech-research.md`) surveyed comparable products and this
repo's own seams; this spec synthesizes both into one set of requirements for
Designer wireframe candidates and, later, implementers. Per the brief: initiation
only (no write-back), task sources pluggable (no tracker hard-wired into
core/contracts), the v0 cockpit's one-utterance flow is the frictionlessness
benchmark, and provenance invariants (human-authored intent, human-only gate
writes, no self-initiating agents) hold at intake.

## Requirements

### R1 — Free text is the primary, fastest entry point
A free-text utterance (matching the v0 cockpit benchmark) is the fastest way to
start queuing work, from both web and CLI. (ux REC3/P3, tech REC6/P2 — both
reports independently converge on this.)
**Acceptance criteria:**
- [ ] AC1.1 (MUST) — A mockup/implementation reaches a free-text entry control in
  ≤2 interactions from any FleetView web surface; the CLI accepts an utterance as
  a single positional argument with no other required flags.
- [ ] AC1.2 (SHOULD) — The entry point is not a fourth peer item with equal
  visual weight in the existing Inbox/Portfolio/Metrics nav; prefer a persistent
  action or shortcut (ux P4, flagged open question — Designer's call, not a G0
  decision).

### R2 — A structured, field-level fallback exists alongside free text
Run creation is a repeatable, well-known shape (source ref, title, constraints)
even when the trigger is prose; free text must not be the *only* way in. (ux
REC3/A5; CLI parity via REC4/P5.)
**Acceptance criteria:**
- [ ] AC2.1 (MUST) — The web candidate shows a discoverable path to fill the
  same underlying fields individually, without going through free text.
- [ ] AC2.2 (MUST) — The CLI create command accepts flags equivalent to every
  field the structured web fallback exposes, for fully non-interactive use.

### R3 — First-paint fields are minimal; budget is defaulted, not blank
On first paint, no more than ~5-6 required-looking fields are visible without
scrolling or expanding a section (ux REC2/A2). This tensions with tech REC6,
which lists a budget ceiling among the "minimal optional bindings" at intake —
**resolved**: budget is not a required blank field on first paint, but appears
pre-filled with an inherited default, editable in exactly one interaction.
**Acceptance criteria:**
- [ ] AC3.1 (MUST) — Count of required-looking, un-collapsed fields on first
  paint ≤ 6.
- [ ] AC3.2 (MUST) — The budget/cost-ceiling control shows a pre-filled default
  value and requires one interaction (not typing from blank) to override.

### R4 — Task sources are pluggable drivers behind one narrow interface
Core and contracts carry only neutral fields (source id, external ref, title,
body, url); no tracker's nouns (issue number, label, assignee) are hard-wired
into `contracts/*` or `@agentic/core`. Sources are enumerated in a committed,
versioned registry, the same posture as `registry/models.yaml`. (tech REC3/A3/P6;
ux REC7/P8 — both reports converge on "declarative config over bespoke code," at
different layers: tech for the core seam, ux for any UI-facing schema.)
**Acceptance criteria:**
- [ ] AC4.1 (MUST) — `contracts/*` and `frontend/packages/core/src/*` contain no
  tracker-specific field names outside an isolated driver module.
- [ ] AC4.2 (MUST) — A source is added or swapped by adding a driver plus a
  registry entry, never editing a contract or core type.

### R5 — Exactly one creation seam, shared by UI, CLI, and every source driver
Run-branch creation is implemented once, in core, alongside `RunSource`
(`frontend/packages/core/src/source.ts`, which today has no creation capability).
UI, CLI, and any future event-driven trigger all call it. (tech REC5/A8 — this
repo already rejected duplicate-implementation drift for readiness rules;
applies identically here.)
**Acceptance criteria:**
- [ ] AC5.1 (MUST) — Exactly one code path writes a new run branch; grep finds
  no second, independent scaffold-writing implementation in a server route
  handler or the CLI.
- [ ] AC5.2 (MUST) — The web and CLI wireframe candidates produce an identical
  `intent-brief.md`/`state.yaml` skeleton shape for equivalent input.

### R6 — Creation is idempotent and concurrency-safe
Replaying a creation request (same upstream item, or a client-supplied key for
free-form requests) returns the existing run, never a sibling; a conflicting or
concurrent write is re-presented to the human, never silently retried or
swallowed. (tech REC2/A7/P3/P4; ux REC8/A4/P11 — convergent: this repo's
existing gate-decision conflict discipline, `decide()`'s stale-write refusal, is
the standard to reuse, not a weaker bespoke version for this one surface.)
**Acceptance criteria:**
- [ ] AC6.1 (MUST) — Invoking creation twice with the same source ref (or the
  same client key) yields one run branch; the second call's response identifies
  the existing slug rather than minting `<slug>-2` or a silent no-op.
- [ ] AC6.2 (MUST) — The wireframe candidates define a distinguishable
  "already exists / changed" state for the operator, not a generic error.

### R7 — Intake has a staged state distinct from armed, with an explicit human confirm act
Creating a run's scaffold (staged: exists, valid, nothing spending yet) and
authorizing dispatch (armed) are separate acts; the transition is a human act
recorded in git, never a server-side flag. A preview (source ref, derived slug,
branch name) is shown before that confirm act. (tech REC1/P8; ux REC5/REC6/P9/P10
— strong convergence: both reports independently landed on a two-phase
create/confirm lifecycle from different source material.) This tensions with ux
REC1/P2 ("capture context and trigger in the same gesture, nothing staged in
advance") — **resolved**: the confirm act may be the same single UI control as
the context-capture action (e.g., one "Queue this run" button), provided the
preview content is visible before that control is activated; what must not
happen is going from empty input straight to a dispatching run with zero
confirm gestures.
**Acceptance criteria:**
- [ ] AC7.1 (MUST) — The wireframe shows a preview (source ref, slug, branch
  name) before the point of no return, whether as a separate step or inline
  ahead of a single confirm control.
- [ ] AC7.2 (MUST) — No path in the candidate or implementation goes from first
  keystroke/click to a dispatching, budget-spending run with zero confirm
  gestures.
- [ ] AC7.3 (MUST) — No run branch is created by an unattended event (e.g., a
  bare webhook delivery) without a human-initiated action in the same flow; see
  Assumptions.

### R8 — Every intake path is authenticated
No route or command mints a run without a resolvable identity or the
deployment's access control. (tech REC7/A2/P10/P11; ux P12 — convergent: the
repo already refuses this shape for its webhook and its `decide()` write path.)
**Acceptance criteria:**
- [ ] AC8.1 (MUST) — The web creation route is reachable only through the
  deployment's existing access proxy (per `docs/DEPLOY.md`); no bypass path
  exists in the candidate.
- [ ] AC8.2 (MUST) — The CLI/automation path refuses to write without a
  resolvable identity (git config or an equivalent service-token credential),
  surfacing a named error, not a partial write.

### R9 — The committed brief is human-confirmed, never machine-authored-as-human
Content pre-filled from an upstream item or a translated utterance is a draft
only; a named human reviews and confirms it before it becomes the committed
`intent-brief.md`, and the confirming commit carries that human's identity —
never the orchestrator's bot identity. (tech REC4/A6/P1/P9; ux P12 — the
brief's provenance constraint applies directly here.)
**Acceptance criteria:**
- [ ] AC9.1 (MUST) — The wireframe shows an explicit review/edit step between
  "fetched or translated draft" and "confirmed brief" — no straight
  fetch-and-commit path.
- [ ] AC9.2 (MUST) — In the implementation, the commit that creates
  `intent-brief.md` on a run branch is authored under the confirming human's
  identity, never the bot identity reserved for bookkeeping.

### R10 — Intake state lives in git; no second control plane
Staged/drafting state is persisted on the run branch and survives a server
restart; there is no in-memory or database-only pending-request store. (tech A5
— "state.yaml is the entire control plane" applies to pre-arming state too.)
**Acceptance criteria:**
- [ ] AC10.1 (MUST) — A server restart between staging and arming does not lose
  or corrupt a staged run; the staged state is readable directly from the run
  branch via git, independent of the server process.

### R11 — CLI create supports flags-first non-interactive use, with interactive fallback
Following this codebase's own `promptBurden` precedent and `gh issue create`'s
model, the create command is fully scriptable via flags and only prompts when
flags are omitted and stdin is a TTY. (ux REC4/P5/P13.)
**Acceptance criteria:**
- [ ] AC11.1 (MUST) — A fully-flagged invocation (including a non-interactive
  confirm flag) completes with zero prompts when piped or scripted.
- [ ] AC11.2 (MUST) — The same command with no flags, run at an interactive
  terminal, prompts for the same fields the flags would have supplied.

### R12 — Baseline accessibility on any field-level surface
Every field has a real associated label, not a placeholder standing in for one;
a failed submit moves focus to the first invalid field with a message naming
the field and the fix. (ux REC10/A6/A7 — WCAG 3.3.1/3.3.2/3.3.3.)
**Acceptance criteria:**
- [ ] AC12.1 (MUST) — No intake field in the candidate relies on a placeholder
  with no paired visible label.
- [ ] AC12.2 (MUST) — The candidate's failed-submit interaction specifies
  moving focus to the first invalid field and a message naming both the field
  and the fix.

### R13 — Visual design avoids the generic-generated-dashboard signature
No uniform card radius/shadow irrespective of content, no gradient-filled
numeric readouts. (ux REC9/A1 — escaping this look is this run's stated
purpose.)
**Acceptance criteria:**
- [ ] AC13.1 (SHOULD) — Panel styling in the candidate varies by semantic
  weight rather than a single uniform token set; no numeric/metric readout uses
  a gradient fill. Deviation requires argued rationale in the candidate's notes.

### R14 — The external source reference is recorded for future write-back
Even though status write-back is out of scope for this run, a run created from
an upstream item records that item's source id and external ref/url in a
neutral field, so the return path doesn't require re-architecture later. (tech
REC3, write-back note; brief Out of scope.)
**Acceptance criteria:**
- [ ] AC14.1 (SHOULD) — A run created from an upstream item carries a
  source-agnostic id/url field in its committed artifacts (brief header or
  `state.yaml`).

## Assumptions

- **ASSUMPTION:** Whether the staged-vs-armed lifecycle (R7) is represented as a
  new `contracts/state.yaml` phase enum value, a reused `paused` reason, or a
  draft namespace off `run/*` refs → left to the Architect (a contract-enum
  choice is a "how," not a "what"); default direction is to prefer extending the
  existing phase/reason vocabulary over inventing new state machinery, because
  `docs/ORCHESTRATOR.md` already treats enum amendments as the correct channel
  for new rest states. G0 approver should confirm this default direction is
  acceptable to leave open at spec time (tech open Q2, tech REC1).
- **ASSUMPTION:** Slug authority and collision policy → the human confirms (and
  may edit) an auto-suggested slug derived from the title/utterance; on
  collision with an existing or historical run, creation is refused with a
  distinguishable "already exists" state (per R6), never silently suffixed
  (`-2`) — because A7 (tech) names silent-suffix collision handling as the
  anti-pattern to avoid (tech open Q4).
- **ASSUMPTION:** Utterance-to-brief translation mechanism (whether an LLM step
  runs inside the intake flow, or the free-text path stays a lighter
  guided-form experience) → left unresolved here on purpose: R9 already
  requires a human review/confirm step regardless of mechanism, so this is an
  Architect/Designer implementation choice, not a spec-level requirement (ux
  open Q1).
- **ASSUMPTION:** Source-selector visibility with exactly one source live →
  shown and defaulted/pre-selected even with a single option, to keep
  pluggability visible, because a single defaulted control costs ~0 extra
  operator effort and does not push first-paint field count (R3) past its
  budget. G0 approver may override to hide the selector until a second source
  exists (ux open Q2).
- **ASSUMPTION:** Whether run-minting requires the same identity ceremony as a
  gate decision → minting a run (staged or armed) requires a resolvable human
  identity (R8, R9) but does not write a G0 gate entry; G0 remains the later,
  distinct approval of the *spec* this Analyst produces from the confirmed
  brief (`docs/DESIGN.md`: "G0 — Spec: is this what we actually want built?"),
  not of the act of queuing work. Conflating the two would have G0 approve the
  brief itself, which the contract does not currently define (ux open Q4).
- **ASSUMPTION:** Whether staging may be triggered by an unattended upstream
  event (e.g., a webhook or tracker label with no human present) → assumed no
  for this run's requirements (R7.AC7.3); every staged run traces to a
  human-initiated action (an authenticated web session or an identified CLI
  invocation), because the brief's provenance invariant and tech A6's
  self-initiation-loophole warning both push toward the conservative default.
  Event-driven *staging* (never arming) may be revisited as explicit future
  work; G0 approver may override (tech open Q3).
- **ASSUMPTION:** What counts as "human-authored" when intent originates from
  an upstream item → verbatim import of an issue body is not by itself
  sufficient; a named operator (who may be the issue's author, but must take
  the explicit confirming action inside FleetView or the CLI) must review and
  confirm before the brief is committed, per R9 — because the brief's
  provenance constraint explicitly names agent/upstream self-initiation as the
  failure mode to close (tech open Q1).
- Nav placement for the create affordance (web UI) is a Designer decision, not
  a G0 decision — the ux report flags it for awareness (P4, R1.AC1.2) but does
  not treat it as an ambiguity needing sign-off here.

## Out of scope

- Status write-back to the upstream tracker, closing issues on run completion,
  and backlog synchronization (per brief; R14 only records a reference field,
  it does not implement any return path).
- Changes to core pipeline roles or gate semantics beyond what R7/R9 require at
  intake.
- Committing to a specific task-source vendor as a permanent dependency;
  building a second (e.g. Jira/Linear) driver is not required by this spec —
  the registry/driver interface (R4) must merely make one possible without a
  contract change.
- Unattended/event-triggered staging (see Assumptions) — every staged run
  requires a human-initiated action in this spec's scope.
- Implementation itself: this run's output is the spec and Designer wireframe
  candidates; building the creation seam, drivers, and UI/CLI surfaces is
  follow-on work on the standard pipeline path.
