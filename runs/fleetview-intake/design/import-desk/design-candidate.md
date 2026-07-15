# Design Candidate: import-desk

<!-- Contract: produced by one Designer; consumed by the G1 human (judging the
     direction) and by the Architect/Implementer (building it if chosen). Lives at
     runs/<slug>/design/<candidate>/design-candidate.md beside the mockups it
     indexes. All sections required. Mockups are self-contained single-file HTML
     (styles embedded, no external assets or build steps) — they must open from
     disk. BUDGET: the mockups carry the aesthetic argument; this file is the
     rationale and build spec. Target a five-minute read per candidate. -->

## Thesis

A two-pane "import desk." The left pane is a provenance rail — source-picker,
external ref capture, fetched-item summary; the right pane is the draft intent
brief under active human edit, its four contract sections always visibly
scaffolded. Provenance is the organizing idea, not a footnote: where this came
from, who is confirming it, and what commit will exist are legible at every
step, in every state. A single staging strip below both panes — never inside
either one — carries the point-of-no-return control, and arming (a later,
separate act) never shares that control's color or shape. Where sibling
candidate "single-thread" chases the v0 cockpit's one-column, top-to-bottom
feel, import-desk reads as a workbench: two things side by side, at all times,
because staging a run is fundamentally an act of reconciling an external
source against a human's own words about it — that reconciliation is the
screen's whole argument, and a single column would bury it.

## Mockups

- `entry-points.html` — the button-type "+ New" trigger on Inbox and Portfolio (Metrics shares the same sidebar). States: default. AC1.1, AC1.2.
- `import-desk.html` — the core two-pane screen. States: first paint/empty (2 required fields, well under the ≤6 budget), happy path (fetched item + drafted brief + staging preview), free-text secondary mode, structured field-level fallback (AC2.1). AC1.1, AC2.1, AC3.1, AC3.2, AC7.1, AC7.2, AC9.1, AC12.1, AC5.2.
- `no-drafting-model.html` — the degraded-drafting state (plan ADR-6): verbatim body lands in Problem, the other three sections start empty for the human to write. States: degraded draft, and a failed-submit example (empty Motivation, focus moved, field+fix named). AC12.2.
- `error-states.html` — staging responses that must read as distinct from a generic error (plan ADR-8): already-exists (informational/accent), conflict (caution/warn), and a genuine upstream failure (error/bad) shown side by side for contrast, plus a second failed-submit example (invalid slug characters). AC6.2, AC12.2.
- `inbox-portfolio-staged.html` — a staged-not-armed run inside the existing Inbox and Portfolio, no parallel "queue" view invented. States: default, freshly staged (highlighted).
- `run-detail-stage-arm.html` — the run detail page across the staged→armed transition, with the provenance block prominent and the raw `state.yaml`/`intent-brief.md` scaffold reproduced (plan IC-4, verbatim). States: staged (pre-arm CTA, confirm-arm expanded), armed.
- `cli-flagged-session.html` — `agentic new --yes` fully non-interactive, then `agentic new` replayed (exists), then `agentic arm` (IC-6). AC11.1, AC5.2.
- `cli-interactive-session.html` — `agentic new` with no flags: prompts, `$EDITOR` brief review, pre-filled budget prompt, preview before y/N confirm, then `agentic arm`. AC11.2, AC7.1, AC7.2.
- `cli-refusals.html` — exists (exit 0), conflict (exit 2), no-identity (exit 1) — three distinct outcomes, distinct copy and tone. AC6.2.

One running example threads every file: GitHub issue `acme/widgets#482` →
slug `search-pagination`, staged by Nathan Carter, budget $25 — so the same
scaffold text can be compared byte-for-byte across surfaces (AC5.2).

## Look-and-feel spec

**Type.** `--font-sans` for UI chrome, `--font-mono` for anything that is
evidence rather than prose (branch names, slugs, commit hashes, the raw
scaffold dump, source refs) — reusing FleetView's existing stack verbatim
(`-apple-system, ... sans-serif` / `ui-monospace, ... monospace`), not a
parallel type system. Scale: 16px page title (unused here — the desk has no
page title of its own, it's a screen state, not a route) / 14-15px section
heads / 13px body and field text / 12-12.5px metadata and helper text /
11-11.5px chips and micro-labels.

**Color tokens.** Reuses `frontend/packages/web/src/styles.css`'s tokens
exactly, both themes via `light-dark()`: `--color-ground/surface/raised/ink/
muted/faint/line` for structure, `--color-accent(-soft)` for the primary
action and informational states, `--color-ok(-soft)` for armed/success,
`--color-warn(-soft)` for the arm action and caution states (conflict), and
`--color-bad(-soft)` reserved for genuine failures only — never for
already-exists or conflict, which is the whole point of AC6.2. No new colors
invented; the candidate's entire distinguishing-states vocabulary (exists /
conflict / error) is built from tones the codebase already has meanings for.

**Spacing and density.** Left pane: 18-20px padding, single column, tight
field stacking (16px between fields) — a rail, not a form. Right pane: wider
padding (20-26px), each brief section separated by a 1px top rule (the same
idiom as `.prose-artifact h2`'s `border-b`), no per-section card. Staging
strip: a flush horizontal band, fields inline, generous 26px side padding —
reads as one ledger line, not a stack of inputs.

**Component shapes — deliberately varied by semantic weight (R13/AC13.1).**
This is the candidate's explicit answer to the generic-dashboard tell: three
different shape languages for three different kinds of thing.
- The provenance rail (pane-left) is flush and square — a border-right rule,
  no radius, background `--color-raised`. It's context, not a decision.
- The brief editor (pane-right) uses soft 6px radii on its individual inputs
  but no outer card frame or shadow at all — it's the same surface as the
  page, because editing the brief is the main activity, not a widget floating
  on top of one.
- The staging strip is completely flat (radius 0), separated by a dashed top
  rule — evokes a ticket stub / manifest line, distinct from both panes above
  it, because it is neither context nor editing: it's a summary about to be
  committed.
- The single "Stage run" button is the only fully-rounded (999px) pill
  anywhere on the screen — one shape, used exactly once, for the one
  point-of-no-return control (AC7.1/7.2). "Arm this run" is a small-radius
  (4px) warn-colored button on a *different* screen (run detail) — different
  shape, different color, different page, so staged-vs-armed is never
  mistakable as "the same button, later."
- No panel anywhere uses a shadow; separation is border + background-tone
  only. No numeric readout (budget) uses a gradient fill — the budget meter
  is a flat two-tone bar, same idiom as the existing `BudgetMeter` component.

**Motion.** Not sketched in static HTML; specified for build: mode-tab
switches and fetched-item arrival cross-fade (120ms); the staging strip's
Stage button has no loading spinner replacement — button label changes to
"Committing…" and disables, matching `decide.tsx`'s existing pattern exactly
(`{mutation.isPending ? 'Committing…' : ...}`).

## Research traceability

**Applied.**
- ux P1/P2 (delegate onto an existing tracker object; capture context at the
  point of delegation) → the Import tab is the primary mode; ref + source
  live in the same pane as the fetch action, no separate "create a task"
  detour.
- ux P3/REC3, tech REC6/P2 (free text primary, structured underneath) →
  three tabs, one path; `import-desk.html` states 3-4.
- ux P4/REC2 (persistent action, not a nav item; keyboard reach) →
  `entry-points.html`'s pill button + `n` shortcut, above the nav list.
- ux A5/REC3 (structured fallback must exist, discoverable) → "Fill in
  manually" tab, not buried behind free text (AC2.1).
- ux P5/REC4, tech P2 (flags for scripts, prompts for humans, same command)
  → `cli-flagged-session.html` / `cli-interactive-session.html` share one
  command surface.
- ux P6/A3, tech REC1/P8/A1 (preview before an irreversible action; two-phase
  create/confirm) → the staging strip's preview-then-Stage, and the
  staged→armed split on the run detail page.
- ux P8/REC7, tech REC3/P6/A3 (declarative, versioned source config; drivers
  behind a narrow interface) → the source-picker reads one registry entry,
  argued in Implementation notes.
- ux P9/P10/REC6 (draft is visibly distinct and reversible; explicit
  save/submit, never mixed with autosave) → the "Drafted from the issue
  body — edit before staging" pill, and no autosave anywhere in the desk;
  ADR-7 is reflected by the empty state noting nothing exists server-side
  yet.
- ux P11/P12/REC8, tech P3/P4/A7 (conflict re-presented not retried; identity
  refusal) → `error-states.html`'s conflict panel; `cli-refusals.html`'s
  no-identity refusal.
- ux A1/REC9 (avoid the generic-dashboard signature) → the deliberately
  varied panel shapes above; argued state-by-state in Look-and-feel spec.
- ux A6/A7/REC10 (real labels, focus-to-first-invalid-field) → every field in
  every mockup has a `<label for>`; `no-drafting-model.html` and
  `error-states.html` both demonstrate focus movement + named field+fix.
- tech P1/P9/REC4/A4/A6 (re-fetch, never trust a forwarded payload; human
  confirms before commit) → `import-desk.html`'s "Re-fetch" control; the
  drafted brief is explicitly editable, never auto-committed.
- tech P7/REC5 (scaffold is template rendering, not judgment) →
  `run-detail-stage-arm.html`'s scaffold dump is the same for every input
  shape; no model invocation is implied in producing it.
- tech P8/A1 (staged vs. armed are separate acts) → the whole
  `run-detail-stage-arm.html` screen exists to make this legible.

**Consciously avoided / deviated.**
- ux P1 taken loosely, not literally: P1's product (Copilot) has *no*
  parallel create surface at all — assigning the existing issue *is* the only
  gesture. This spec's G0 binding explicitly wants an import pipeline with a
  human-drafted-and-reviewed brief in between, which P1's source product does
  not have (assignment goes straight to agent work). Deviation argued: R9's
  human-confirms-before-commit requirement is incompatible with P1's
  zero-review model; the desk keeps P1's "delegate onto the object" framing
  but inserts the review step P1 doesn't have.
- ux P2 ("nothing staged in advance") is deliberately not followed at the
  letter — this run's G0 note explicitly resolves the P2-vs-REC5/REC6 tension
  in favor of a staged/armed split (spec R7's resolution, plan ADR-1/ADR-7).
  Noted already in spec.md; not re-litigated here.
- ux REC1 (mirrors P1/P2 as a single recommendation) is superseded by the
  spec's own R7 resolution for the same reason.
- tech REC7/P10 (Cloudflare Access service tokens for CLI/automation) is not
  designed here — it's an auth/deployment concern with no wireframe-visible
  surface; the CLI transcripts assume identity resolves via git config, per
  IC-6, and defer service-token ergonomics to task 03's seam reference.

## Ergonomics notes

**Focus order.** Left-to-right, top-to-bottom within each pane: Source →
Issue reference → Fetch → (fetched summary, read-only) in the left pane;
Problem → Motivation → Constraints → Out of scope in the right pane; then the
staging strip's Slug → Budget → Stage run. Tab order in the HTML matches this
reading order (no explicit `tabindex` overrides needed). On failed submit,
focus moves programmatically to the first invalid field (sketched in
`no-drafting-model.html` and `error-states.html`) and an `aria-live`/`role`
alert region names the field and the fix — implementation must wire this with
a real focus-management call (e.g. `ref.current.focus()`), not just a visual
outline.

**Contrast.** All text/background pairs use the existing token set, already
tuned for WCAG AA in both themes (inherited, not re-verified here — flagged
for the Architect to confirm empirically on the actual rendered
`light-dark()` values if this candidate is chosen).

**Keyboard reach.** `n` opens the desk from anywhere the sidebar renders
(entry-points.html); once inside, standard tab order covers every field; no
mouse-only interaction exists (mode tabs, Fetch, Stage, and Arm are all real
`<button>` elements).

**State coverage — handled:** empty/first-paint, loading is implied by the
"Re-fetch" affordance and covered narratively (not separately mocked — a
static loading frame for a sub-second fetch call adds a tenth file for
limited signal), happy path, secondary free-text mode, structured fallback,
no-drafting-model degradation, failed-submit (two examples), already-exists,
conflict, generic upstream error, staged-in-inbox/portfolio, staged vs. armed
on the run detail page, and three CLI transcript classes (flagged,
interactive, refusals).

**Deferred, and why:** a true in-flight "fetching…"/"drafting…" spinner frame
is not separately mocked — it's a transient, sub-second state whose visual
argument (a disabled Fetch button + a text change) doesn't carry enough
design information to earn its own file within this contract's concision
budget; the Implementation notes flag it as a trivial build item, not an
open design question. Mobile/narrow-viewport layout for the two-pane grid is
not sketched; the two-pane thesis assumes a desk-width surface (matching
FleetView's existing `max-md:hidden` sidebar posture, which already treats
narrow viewports as a secondary target).

## Implementation notes

- **New Inbox item kind.** `inbox-portfolio-staged.html` proposes extending
  `InboxItem`'s `kind` union with `'staged'` (a `STAGE` chip) rather than
  overloading `'gate'` — this is a real `frontend/packages/core` type change
  the Architect must decide on for the follow-on build; task 03's seam
  reference should carry it as an open item if not already resolved there.
- **Phase-tone map.** `PHASE_TONE` in `chips.tsx` needs a `staged` entry
  (this candidate uses the accent tone, matching "in progress toward a
  decision" rather than `warn`/`bad`); a one-line addition, not a redesign.
- **Arm confirmation friction.** The typed-slug confirm on "Arm this run"
  (web) and the CLI's "type the slug to confirm" are this candidate's own
  addition beyond the spec's minimum (spec only requires one confirm
  gesture) — proportional friction because arming is the actual
  budget-spending trigger. This is a recommendation, not a requirement; the
  Architect may accept a plain click if the extra step is judged unnecessary
  ceremony at G1.
- **Drafting cost ledger entry.** The "$0.02" cost badge next to "Drafted
  from the issue body" assumes the drafting call's cost is visible to the
  operator before staging, per ADR-6's note that drafting cost is carried
  into the staged run's opening ledger entry — task 03 should confirm the
  `/api/intake/draft` response shape actually returns `cost_usd` in time for
  this to render (IC-5 already lists it: `{ brief_markdown, cost_usd }`).
- **Risk: two-pane layout doesn't collapse gracefully below ~900px.** Not a
  blocker (desk-width is the target), but the follow-on build should decide
  whether narrow viewports get a stacked (top/bottom) fallback of the same
  two zones, or are simply out of scope like the existing sidebar's
  `max-md:hidden` treatment.
- **Risk: `$EDITOR` review UX in the CLI is asserted, not proven.** The
  transcript in `cli-interactive-session.html` assumes a synchronous
  spawn-editor-and-wait flow (like `git commit` with no `-m`); confirming
  this is buildable with Node's child_process and a real `$EDITOR` (vim,
  nano, VS Code's `code -w`) is a task 03 / follow-on concern, not resolved
  by this mockup.
- Nothing in this candidate requires a new route beyond IC-5's proposed
  surface (`GET /api/intake/sources`, `GET /api/intake/item`, `POST
  /api/intake/draft`, `POST /api/intake/runs`, plus the existing `POST
  /api/decisions` for arm) — no additional endpoint is implied by any
  mockup.
