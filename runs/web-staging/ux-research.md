<!-- Contract: produced by ux-researcher (in-run prototype role, hand-dispatched v0 style);
     consumed by the two designer candidates and the G1 human. IDs (P*, REC*, A*) are
     stable and load-bearing: designer candidates must cite them in their traceability
     sections. Spec AC references are to runs/web-staging/spec.md. -->

# UX Research Memo: staging and arming runs from the FleetView web surface

## Principles

**P1 — The authority defines the form's structure; the human supplies only values.** GitHub's "Run
workflow" form is not free-form: "Only workflow files that use the `workflow_dispatch` event
trigger" get the button, and the workflow file dictates which inputs appear, their types, and
defaults — the operator fills in values inside a shape they cannot edit (docs.github.com,
manually-run-a-workflow). The intent-brief editor should work the same way: the contract template
(`source.templates.read('intent-brief.md')`) is the authority that emits one input per required
section, and the operator authors prose inside that fixed structure. Structure from config, words
from the human — the exact split AC2.1 requires.

**P2 — In two-phase lifecycles, creation is cheap and activation carries the weight.** LaunchDarkly
creates every flag in the Off state — "When you create a new flag, it is turned **Off** by default"
— and turning it on is a separate act framed as consequential, the kill-switch control
(launchdarkly.com/docs, flags/toggle). GitHub draft PRs "cannot be merged, and code owners are not
automatically requested to review them" until the separate "Ready for review" act (docs.github.com,
about-pull-requests). HCP Terraform pauses every planned run until a permitted human clicks "Confirm
& Apply" or discards it (developer.hashicorp.com, run/manage). Staging mints a record and spends
nothing; arming starts metered dispatch. The two controls must read at visibly different weights.

**P3 — A rest state is a first-class state, not a broken variant of a neighboring one.** Terraform's
needs-confirmation run is its own status with its own buttons, not an errored apply; a draft PR is
labeled draft with merging disabled, not a PR whose merge button throws. FleetView today violates
this: a staged run renders as a `paused` inbox item whose "Resume run" button
(`components/decide.tsx`, `item.kind === 'paused'`) calls `planDecision('resume')`, which refuses
staged runs — a click-to-error affordance the spec's Context names as the defect R6 fixes. The
staged state needs its own kind or variant whose only affordance is Arm.

**P4 — Refusal names the field, moves focus, and keeps summary and inline wording identical.** The
GOV.UK error summary — the most heavily user-tested refusal pattern in production government
services — appears on every validation error at the top of the main container, keyboard focus moves
to it, each entry links to the offending field, and "the error messages in the error summary are
worded the same as those which appear next to the inputs with errors" (design-system.service.gov.uk,
error-summary). FleetView's existing refusal voice is already specific, not generic: "Bounced — fix
the artifacts (or the contract) and the card returns; no approval is offered for a malformed packet"
(`decide.tsx`). A staging refusal must name the missing section(s) by their contract headings, per
AC2.2.

**P5 — Prevent client-side what the client can know; refuse server-side what only the server knows —
and never let the two checks diverge.** `DecidePanel` disables submission until required inputs
exist (`disabled={!burden ...}`, `disabled={!notes.trim() ...}` in `decide.tsx`) rather than letting
the user submit into an error. Empty brief sections are client-knowable and can be prevented the
same way; identity resolution, slug collision, and replay detection are server-only and can only be
refusals. AC2.2 makes the server's `missingBriefSections`/`extractSections` the single truth — any
client-side mirror is a convenience, and the displayed refusal text must come from the server
verbatim.

**P6 — Replay of the same request is information, never an error; same key with different content
is.** Stripe's idempotency layer saves the first result and "subsequent requests with the same key
return the same result," while reuse with different parameters "errors ... to prevent accidental
misuse" (docs.stripe.com, idempotent_requests). That gives three distinguishable outcomes — fresh
success, benign replay, genuine collision — exactly the AC8.1/AC8.2 split. FleetView already renders
a third outcome class between success and error: the 409 CAS conflict gets its own `conflict` tone
and a re-present-don't-retry posture ("The run moved while you were deciding — re-read and decide
again," `decide.tsx` `Flash`).

**P7 — Attribution is displayed, never typed; provenance is the operator's own pointer text, never a
fetched object.** FleetView renders authorship only from the commit record (`HistoryTab` in
`pages/run.tsx` shows `h.author` from git; `GateCell` tooltips show "approved by <name>" from
`state.yaml`), and `stageRun` sources `stagedBy` from `source.identity()` (AC4.2). Products that
browse trackers (issue pickers, URL unfurls) exist as contrast, not as a model: the brief's
constraint is that `source`/`ref`/`url` stay human-typed strings mirroring
`RunScaffoldInput.intake`, with no external call behind any input (AC3.1). The surface may show what
will be recorded; it may never ask who you are.

**P8 — Status is encoded in form, not just color.** `components/chips.tsx` opens with this rule as a
comment, and practices it: a bounced gate chip is not merely red but `border-dashed ...
line-through`; a pending `GateCell` is dashed with a `·` glyph while a decided one is solid with
`✓`/`✕`. A staged run's chip and card must therefore differ from mid-flight-paused in shape or glyph
or label — not tone alone — which is also what AC6.2's "visually distinguishable ... reusing
`chips.tsx`'s existing token set" demands.

**P9 — The creation entry point lives inside the surface that lists the created things.** GitHub
places "Run workflow" above the list of that workflow's runs, not in global navigation
(docs.github.com, manually-run-a-workflow). FleetView's nav is fixed at Inbox/Portfolio/Metrics
(`app.tsx`), AC7.1 forbids adding to it, and the Portfolio page is the runs list — including an
empty state whose copy ("Start one with the orchestrator, or point Gate at a repo that has runs,"
`pages/portfolio.tsx`) already gestures at run creation and predates any way to do it from the web.

**P10 — Success reports the durable fact, in the record's own terms.** `DecidePanel`'s success flash
names the commit: "`${result.summary} — committed ${result.commit?.slice(0, 10)}`" (`decide.tsx`),
and the sidebar motto is "The repo is the database. Every view renders git." (`app.tsx`).
Terraform's run page likewise anchors on the commit and a timeline of recorded events
(developer.hashicorp.com, run/manage). A successful stage should therefore name `run/<slug>` and the
genesis commit oid — the durable artifacts AC1.2 verifies — not a generic "Run created!"

## Recommendations

**REC1 — Put the "New run" entry point on the Portfolio page: a button in the page header and a
second affordance in the empty state.** No new top-level route; the form opens as a portfolio
sub-route or panel. Update the empty-state copy to point at it. [P9; AC7.1]

**REC2 — Build the brief editor as one labeled multiline input per required section, headings
rendered as fixed chrome fetched from the template, every input initially empty.** Placeholder text
may describe what a section is for (mirroring `NotesField`'s instructive placeholders in
`decide.tsx`) because placeholders are never submitted; prefilled prose is forbidden. [P1, P7;
AC2.1, AC2.3]

**REC3 — Auto-suggest the slug from the title, keep it editable until submit, and label it
permanent.** LaunchDarkly does exactly this for flag keys: "A suggested key auto-populates from the
name you enter, but you can customize it," and "After you save the flag key, you cannot modify it"
(launchdarkly.com/docs, flags/new). Show the derived `run/<slug>` ref beside the field so the
operator sees the durable name they are minting. [P7, P10; AC1.2, AC8.2]

**REC4 — Keep staging and arming as two controls that never collapse into one.** The staging submit
speaks in the record voice ("Stage run — creates the branch; nothing dispatches"); Arm is a separate
act on the staged run's card, styled with the app's consequential idiom (primary accent `Button`, an
explicit confirm step like `DecidePanel`'s approve mode). No "stage and arm" checkbox or combined
button. [P2; AC5.1, R1, R5]

**REC5 — Give the staged rest state its own readiness rendering: a distinguishable kind chip (form
difference per P8, e.g. a distinct label/outline treatment rather than a recolor) and a
`DecidePanel` branch whose only affordance is "Arm run".** The card copy should say what arming does
(starts dispatch, begins spending budget) the way the approve-and-hold checkbox explains itself in
`decide.tsx`. Driving this card must never issue `action: 'resume'`. [P2, P3, P8; AC5.1, AC6.1,
AC6.2]

**REC6 — On refusal, render an error summary at the top of the form, move focus to it, link each
entry to its field, and repeat identical wording inline at the field.** Missing sections are named
by contract heading, with the server's `missingBriefSections` output displayed verbatim as the
single source of wording; a client-side mirror of the same check may disable the submit but never
substitutes its own message text. [P4, P5; AC2.2]

**REC7 — Render four distinguishable submission outcomes, extending the existing Flash triad
(`ok`/`conflict`/`error` in `decide.tsx`) with an informational replay tone:** (a) fresh success —
ok tone, names `run/<slug>` and the genesis commit, links to the run page; (b) already-staged replay
— informational, explicitly not red, "already staged," links to the existing run and offers Arm; (c)
slug collision with different content — refusal naming the existing run/branch it collides with,
with a link; (d) no resolvable identity — refusal carrying `stageRun`'s `no-identity` message shape,
presented as deployment configuration to fix, not as a form-field error, since no field can cure it.
[P4, P6; AC4.1, AC8.1, AC8.2]

**REC8 — Generate the optional client key per form session, client-side, invisible by default.**
This mirrors Stripe's client-generated idempotency key: a resubmit after a dropped connection
replays safely to "already staged," while an edited resubmission under a taken slug is a collision
refusal, not a silent overwrite or retry. [P6; AC8.1, AC8.2, AC3.1]

**REC9 — Show attribution read-only near the submit control ("will be recorded as staged by
<identity>") if the identity is already available to the client; never render a name input.** If
identity is only resolvable at submit time, the refusal path in REC7(d) covers it — but under no
design does a typed-name field appear. [P7; AC4.1, AC4.2]

**REC10 — Present `source`/`ref`/`url` as three plain optional text inputs captioned as the
operator's own pointer text.** No dropdown, no autocomplete against an external system, no link
preview or unfurl, no reachability validation — a URL here is a string the human vouches for, not an
object the system fetched. With multiple sources configured, the repository picker (AC1.3) is the
one legitimate dropdown, and it selects among FleetView's own configured sources, not external
systems. [P1, P7; AC1.3, AC3.1, AC3.2]

**REC11 — Surface arm-time refusals verbatim from `planDecision`'s `DecisionError`, using the error
tone; a concurrent-move conflict keeps the existing 409 conflict posture (re-present, never
auto-retry).** An arm attempt on a run that is no longer staged must say why in the core's own
words, matching how `decide.tsx` already pipes `ApiError` messages into `Flash`. [P4, P6; AC5.2]

**REC12 — On staging success, land the operator on the run detail page, where the staged card (REC5)
presents Arm as the next decision.** This makes the two-phase lifecycle legible as a sequence —
record first, then a separate decision to start — the same way Terraform's run page holds a planned
run at "Confirm & Apply" until a human acts. [P2, P10; R5, R6]

## Anti-patterns

**A1 — Rendering staged as paused-with-Resume.** This is the live defect: the resume affordance on a
staged run is a guaranteed `DecisionError` (spec Context). Never reuse the `paused` card unchanged;
build the staged variant of REC5. [violates P3; AC6.1]

**A2 — Tracker-client creep.** An issue picker, a "browse tickets" panel, a URL preview card, an
import button — each turns typed provenance into fetched objects and puts the surface on the road to
being a tracker client, which the brief rules out of bounds. Products that do this
(Jira/Linear-integrated PR forms) are contrast cases, not models. Use REC10's plain inputs.
[violates P7; AC3.1, AC3.2]

**A3 — Prose assistance of any kind.** No LLM drafting, no "generate from template" that emits
sentences, no prefilled sample paragraphs an operator could submit unedited. Structure yes, words
no; instructive placeholder text is acceptable only because placeholders are never submitted.
[violates P1; AC2.1, AC2.3]

**A4 — A typed "your name" field, or any client-supplied attribution.** Attribution comes from
`source.identity()` or the act is refused. A name field would make the record lie politely.
[violates P7; AC4.1, AC4.2]

**A5 — Generic or silent failure.** A bare "Something went wrong" toast, an auto-retry loop, or
rendering the already-staged replay in the error tone all collapse the outcome taxonomy the spec
makes first-class. Every refusal names its cause and its fix path; every replay reads as
information. [violates P4, P6; AC2.2, AC8.1]

**A6 — Collapsing stage-and-arm into one act.** A single "Create and start" button, or arming as a
default-checked option on the form, destroys the weight difference between minting a record and
starting metered dispatch that the whole seam is built around. [violates P2; R5]

**A7 — A new top-level surface.** No "Queue" nav item, no standalone creation app, no parallel
rendering path for staged runs beside `PhaseChip`/`GateLedger`/`DecidePanel`. The staged state lives
inside portfolio, inbox, and run detail. [violates P9; AC7.1, AC7.2]

**A8 — Re-deriving validation as client authority.** A client-side section-completeness check that
owns the refusal wording will drift from `missingBriefSections` and eventually refuse what the
server accepts, or accept what the server refuses. The client may pre-check to disable submit; the
server's answer is the one displayed. [violates P5; AC2.2]

## Sources

Product documentation read (via WebFetch, 2026-07-22):

- GitHub Docs — "Manually running a workflow" (`workflow_dispatch` form: button placement above the
  run list, config-defined inputs/defaults/types):
  docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow
- HCP Terraform — "Managing runs" (plan → Confirm & Apply, needs-confirmation as first-class paused
  state, discard, permission-gated confirmation):
  developer.hashicorp.com/terraform/cloud-docs/run/manage
- GOV.UK Design System — "Error summary" (summary placement, focus movement, error-to-field links,
  identical wording in summary and inline): design-system.service.gov.uk/components/error-summary/
- Stripe API Reference — "Idempotent requests" (replay returns the saved result; same key +
  different params errors; client-generated keys): docs.stripe.com/api/idempotent_requests
- LaunchDarkly Docs — "Create flags" (key auto-suggested from name, editable then immutable) and
  "Turn flags on and off" (created Off by default; toggle as separate, kill-switch-framed act):
  launchdarkly.com/docs/home/flags/new, launchdarkly.com/docs/home/flags/toggle
- GitHub Docs — "About pull requests" (draft PRs: merge blocked and reviews not requested until the
  separate "Ready for review" act):
  docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests

FleetView code read (all under `frontend/packages/web/src/`):

- `styles.css` — Signal Deck token vocabulary, motion rules (ADR-6: only the three defined
  keyframes), `.pulse-panel`, prose/lexicon voices
- `components/chips.tsx` — fixed status vocabulary; "status is encoded in form, not just color";
  `PhaseChip` pausedReason suffix; `KindChip` kind set (gate/ESC/CAP/PAUSE/BAD)
- `components/decide.tsx` — mode machine, required-input disabling, Flash `ok`/`conflict`/`error`
  triad, 409 re-present posture, the staged-run Resume defect, approve-and-hold self-explaining
  checkbox
- `pages/portfolio.tsx` — runs table idiom, empty-state copy gesturing at run creation
- `pages/inbox.tsx` — inbox row anatomy, `itemHref` decide-param routing, bounced-gate refusal copy
- `pages/run.tsx` — run header (PhaseChip + GateLedger + BudgetMeter), `NeedsYouCard`, `HistoryTab`
  commit-author rendering
- `app.tsx` — nav fixed at Inbox/Portfolio/Metrics; "The repo is the database" motto; outage/drift
  banner idiom
- `api.ts` — `DecisionRequest` shape, `ApiError` with status, `PROFILE_GATES` mirror

Run artifacts read: `runs/web-staging/intent-brief.md`, `runs/web-staging/spec.md` (R1–R9, AC
numbering cited throughout).
