# Gate Frontend Redesign — Shared Design Brief

> **Audience**: three frontier open models, each producing four standalone
> HTML files (`inbox.html`, `portfolio.html`, `new-run.html`,
> `run-detail.html`) that execute against this document. This brief is the
> primary context each candidate receives. It is precise enough that an
> implementer can produce beautiful HTML without guessing, and open enough
> that each model's aesthetic taste can diverge naturally.
>
> **Read this entire document before designing.** The "Reframe" section
> overrides assumptions you might form from the earlier sections; the
> "Preservation constraints" are non-negotiable even when they tension with
> the aesthetic direction.

---

## 1. Context & users

### What Gate is

Gate is the human-facing frontend for an **agent-driven SDLC framework** — a
pipeline of semi-autonomous software-development agents that pause at **phase
gates (G0–G3)** for a human to approve or decline. It is **not** fleet
management. It is not an ops console. It is the named-human-approver surface
for a small engineering team's agent pipeline.

The defining technical fact: **the repo is the only database.** Every view is
recomputed from git. There is no separate store, no event stream, no cache to
invalidate. A run's state lives at `runs/<slug>/state.yaml` on a branch
`run/<slug>`; its artifacts are committed markdown and YAML files in that
directory. Gate renders git.

### Who uses it

Engineers acting as the **named human approver** on their team's agent
pipeline. They are experienced with LLM coding assistants but using Gate to
supervise a *team* of agents rather than a single chat stream. They are
reviewing, judging, and authorizing — not driving a terminal.

### What they actually do

1. Land on the **Inbox** — every pending human decision across all runs,
   oldest-first. Decide what to open.
2. Open a **Run Detail** — read the artifact(s) the agent produced (a spec, a
   plan, a verification report, a diff), then approve or decline the gate the
   run is paused at.
3. Glance at the **Portfolio** to see all runs at once — which phase each is
   in, which gates are cleared, where budget stands.
4. Stage a **New Run** — author an intent brief, watch the `state.yaml` the
   server will commit assemble itself live, then stage it.

The dominant activity is **reading artifacts** — long-form markdown prose
(specs, plans, verification reports, decision rationale) and structured YAML
(`state.yaml`). The time spent reading dwarfs the time spent moving a mouse or
pressing a key. This is the central design input (see §2).

### The pipeline vocabulary (fixed — do not invent)

- **Phases**: `spec`, `plan`, `implement`, `integrate`, `release`, `done`,
  `paused`
- **Profiles** (which gates a run carries — fixed sets, not knobs):
  - `patch` → G1, G2
  - `standard` → G0, G1, G2
  - `full` → G0, G1, G2, G3
- **Gate states**: approved (`✓`), declined (`✕`), pending (`·`)
- **Inbox kinds**: `gate`, `escalation`, `round-cap`, `paused`, `staged`,
  `malformed`
- **Gate burdens** (the weight of a gate decision): `confirmation`,
  `light-correction`, `heavy-correction`

---

## 2. The reframe (the most important input)

> *"Keyboard navigable is a neat trick and a nice-to-have in the web UI, but
> think about how much text we're asking the engineers using this system to
> read: the time spent moving a mouse is utterly negligible in comparison.
> Emphasizing [keyboard navigation] in the design is a misunderstanding of how
> the user spends their time in the app. An environment that's cozy,
> comfortable, and clean invites a user to spend their time reading artifacts
> at their leisure."* — product owner

This single quotation is the spine of the redesign. It means four things,
each load-bearing:

1. **The design's primary job is to make reading comfortable.** The user
   spends their time reading artifacts (specs, verification reports, decision
   prose, diffs, `state.yaml`), not racing through keyboard triage. Typography
   quality, measure, leading, whitespace, and visual hierarchy for long-form
   reading are the centerpiece — **not** inbox triage speed. A candidate that
   optimizes the inbox for speed at the expense of the Run Detail reading
   surface has misunderstood the brief.

2. **Keyboard navigation must be functional but NOT prominent.** No visible
   keyboard shortcut hints (no `j/k move · ↵ open` captions, no `⌘K` pills,
   no kbd-element affordances). The keyboard model can work under the hood,
   but it must not be a design feature the UI advertises or rests its identity
   on. If you find yourself reaching for a "fast instrument" framing, stop.

3. **Cozy, comfortable, clean > dense, fast, instrument-panel.** The current
   design's thesis — *"a live instrument, not a document"* — is being
   partially superseded by *"a comfortable reading environment that happens to
   have workflow tools."* Breathing room matters. Warmth matters. The user
   should feel invited to **linger**, not pressured to act fast. Do not pack
   rows at 12px height. Do not build a terminal.

4. **We are moving away from the current direction.** The current design is
   the closest existing thing to "Direction A — quiet dark, keyboard-native,
   mono-readout instrument panel." The redesign moves toward **Direction C
   (editorial / brand-forward)**, borrowing **Direction B (status-chip
   functional)** techniques. See §3.

**The single sentence to internalize**: *Gate is a comfortable reading
environment that happens to have workflow tools — not a workflow tool that
happens to render text.*

---

## 3. Aesthetic direction

### Primary: Direction C — "Editorial / brand-forward"

Treat the content the way a well-designed magazine or book treats its
content: with respect, with hierarchy, with a point of view. Concretely:

- **Expressive type.** Italic serifs for hero headlines, or a custom variable
  font, or a well-chosen open sans with strong personality. Establish **≥2
  distinct type roles** that differ in more than size/weight (face, or at
  minimum a display cut vs. a text cut). The system-font stack alone is
  *not* enough to clear the anti-pattern floor (see A3). Use Google Fonts or
  a CDN font import — self-hosting is not required for the prototypes.
- **Large real numbers as hero elements.** A run's budget spent, a gate's
  decision count, the inbox's waiting number — these are real data and can be
  rendered as confident editorial numerals, not hidden in a 12px mono pill.
  (Stripe's italic-serif hero headlines + large real numbers is the exemplar
  for the New Run hero.)
- **A signature gradient or geometric motif.** A considered, restrained
  brand gesture — a gradient on one hero element, a blueprint-grid motif on
  one surface, a single recurring geometric mark. Not applied everywhere.
  One signature, used deliberately.
- **A mascot / voice for warmth.** Optional. A small recurring mark or voice
  that gives the product a personality — a named assistant, a sigil, a
  consistent turn of phrase in empty states. This is the warmth lever.
- **Considered hero / empty states.** Empty states are designed, not
  defaulted. "Inbox zero." is a moment of warmth, not a blank page.

**Exemplars to study**: Stripe (editorial confidence, italic serif heroes,
large numbers), PostHog (brand personality, mascot, expressive), Linear
Method (editorial product writing, considered type).

### Techniques to borrow from Direction B — "Dense light, status-chip functional"

These are the *techniques* (not the aesthetic wholesale). Direction B is
cooler and denser than where we're landing; we steal its discipline, not its
temperature:

- **Tinted status chips** — muted-tint background + emphasis-colored
  text/border, **never solid-filled badges**. This is GitHub Primer's
  signature pattern (e.g. `open` = `#dafbe1` bg / `#1a7f37` text). Apply to
  phase chips, gate cells, kind chips, status pills throughout.
- **Cool near-black text and borders, never pure.** `#1f2328` not `#000`;
  `#d1d9e0` not `#ccc`. One value swap that de-genericizes the whole palette.
- **Structured metadata rail** (Raycast pattern) — a key/value list docked at
  the bottom (or side) of a detail pane. Perfect for Run Detail's
  phases/gates/budget/genesis metadata.
- **Desaturated functional palette for status colors.** OK / warn / bad are
  muted, not saturated. The status colors should read as *information*, not
  *alarm*.
- **Layered "ring + soft drop" shadows.** A hairline ring plus a diffused
  drop, e.g. `0 0 0 1px #d1d9e040, 0 6px 12px -3px #25292e0a, 0 6px 18px 0
  #25292e1f`. Use sparingly to elevate the few surfaces that warrant it.

### The aesthetic bar

> **"Look like a real, beautiful, mature product UI — not an LLM artifact."**

The current design, while disciplined, reads as a generic admin dashboard. The
redesign must feel like a product with a team and a point of view. It should
look like something a human designer made, not something an LLM generated from
a prompt. The anti-patterns in §4 are the specific "slop traits" to defeat.

### Theme recommendation

**Light, or warm-dark, or both.** Direction C (editorial, cozy) suggests
light or warm-dark is more appropriate than cold dark. The current design is
cold-dark-native; we are moving away from that. If you offer a single theme,
prefer light or warm-dark. If you offer both, ensure WCAG AA in each and let
the candidate specify which is primary. **Cold near-black dark (`#0a0e11`
ground) is explicitly the aesthetic we are leaving.**

---

## 4. Anti-patterns to AVOID (the slop traits)

These five were identified by prior UX research as the specific things that
make a UI feel generic and LLM-generated. Each carries concrete guidance.

### A1 — One card recipe for every surface regardless of stakes

A passive table and a decision-critical panel must **not** share the same
wrapper treatment. Vary wrapper treatment deliberately by stakes: a flat
1px-line panel for passive display tables; a considered, elevated, accented
treatment for the one "needs you" decision card; a generous reading frame
for the artifact body. The *reuse itself* reads as templated, independent of
which specific radius or border value is chosen.

**Guidance**: Audit your wrappers. If your inbox list, your portfolio table,
your decision card, and your artifact body all share `border: 1px solid
var(--line); border-radius: 8px; background: var(--surface)`, you have failed
A1. Differentiate by stakes: passive → flat line; decision → accented rail +
elevation; reading → generous padding + measure cap, possibly no border at
all.

### A2 — Single default radius-and-border recipe app-wide

The "8px radius, 1px slate-200 border" generic-shadcn signature. Move away
from this. Use a **deliberate radius ladder** and **varied border treatments**.

**Guidance**: Adopt a radius ladder (Vercel Geist's 6/12/16 — inputs 6px,
cards 12px, fullscreen 16px — is a good starting point; radius escalates with
elevation). Vary border treatments: hairline rings, dashed for pending,
accented rails for decisions, no border for reading surfaces that sit on a
tinted ground. Do not apply one radius + one border to every surface.

### A3 — One font role for every text purpose / no typographic identity

Establish **≥2 distinct type roles** differing in more than size/weight. Use a
typeface with personality, not just the system stack. A single role scaled up
and down does not read as a typographic identity.

**Guidance**: Pick at least two faces (or two cuts of one variable font) with
genuinely different character — e.g. an italic serif (or a display sans with
personality) for hero headlines and section kickers, a clean text sans for
body and labels, and a mono for code/paths/ids. Define **named type roles**
(Vercel Geist pattern: `label-14`, `copy-13-mono`, `button-14`, `heading-24` —
each pre-combining size + line-height + tracking + weight) rather than ad-hoc
size utilities. Google Fonts / CDN imports are allowed for the prototypes.

### A4 — One spacing/density rhythm regardless of local information density

Let each screen's density follow its own information density. **Reading
surfaces get MORE space, not less.** The inbox can be comfortable; the
artifact view should be generous. The portfolio table can be tighter (it's a
scan surface), but still calm.

**Guidance**: Define at least three density rhythms: *scan* (inbox, portfolio
table — comfortable, not packed), *reading* (artifact body, decision prose —
generous, measure-capped), *evidence* (diffs, `state.yaml` — dense mono,
zero vertical padding). Do not reuse one spacing scale uniformly across all
four screens.

### A5 — Urgency/tone signaled by color swap alone, shape held constant

Keep pairing a **non-color signal** (glyph / shape / size / position /
fill-style) with color for status. Never simplify to color-only. This is
especially important for accessibility — color-vision-deficient users cannot
rely on hue alone.

**Guidance**: Every status chip carries a glyph (`✓` / `✕` / `·`), a shape
(filled vs. outline vs. dashed), a fill style (solid vs. tinted), a weight,
or a position difference *in addition to* its color. A `paused` chip differs
from a `done` chip in shape and fill, not just hue. Gate cells use `✓`/`✕`/`·`
glyphs. Bounced gates are dashed + struck-through, not just red.

---

## 5. Preservation constraints (non-negotiable workflow surfaces)

These are load-bearing for UX quality. The redesign must preserve them even as
aesthetics change. Violating any of these is a blocking failure.

1. **Inbox is the default landing screen** — pending human decisions across
   all runs, ranked oldest-first. Do not demote it. Do not make Portfolio the
   landing screen.

2. **The gate ledger (G0–G3)** — each gate shows approved (`✓`), declined
   (`✕`), or pending (`·`). This is the core information structure of the
   Portfolio and the Run Detail header. A run's profile determines which gates
   appear (patch = G1,G2; standard = G0,G1,G2; full = G0,G1,G2,G3); absent
   gates are not rendered, never auto-approved.

3. **Decision cards state**: what / why / what-changes / how-verified /
   how-to-undo, then affordances. Nothing else. The decision card is the one
   place a human takes a consequential action; its content is structured, not
   freeform.

4. **Status encoded in form, not just color** — glyphs, fill style (solid vs.
   outline), border style (solid vs. dashed), weight, position. Never
   color-only. CVD-safe by construction.

5. **Per-screen density rhythms** — but now reading surfaces get MORE space,
   not less. The inbox is comfortable; the artifact view is generous.

6. **Measure caps on reading surfaces** — ~76ch for artifact body and decision
   prose. This is a reading-comfort constraint, not a style preference.

7. **WCAG 2.1 AA contrast** in both themes (if the candidate offers both).

8. **The R3 bounce view** — malformed packets never render as reviewable. A
   bounced gate shows: *"Bounced — packet fails its contract; no approval is
   offered."* No approve/decline affordances on a bounced item.

9. **Phase vocabulary**: `spec`, `plan`, `implement`, `integrate`, `release`,
   `done`, `paused` — exactly these, no synonyms.

10. **Inbox kinds**: `gate`, `escalation`, `round-cap`, `paused`, `staged`,
    `malformed` — exactly these.

11. **Gate burdens**: `confirmation`, `light-correction`, `heavy-correction`
    — exactly these.

12. **Profiles**: `patch` (G1,G2), `standard` (G0,G1,G2), `full` (G0,G1,G2,G3)
    — fixed sets, not knobs.

---

## 6. What's DE-EMPHASIZED (the reframe, restated as constraints)

- **Keyboard navigation as a design feature** — keep functional under the
  hood, do not make it the identity. **No visible keyboard hints.** No `j/k`
  captions, no `⌘K` pills, no `<kbd>` affordances in the chrome.
- **"Instrument panel" aesthetic** — we are going editorial/comfortable, not
  terminal/dense. No mono-readout-everything. No mission-control framing.
- **Motion-as-signal** — less important in a cozy reading environment. Any
  motion should be subtle and respect `prefers-reduced-motion`. **No pulsing,
  no glowing signal chips as the primary visual device.** The current
  design's `pulse-panel` and `pulse-glow` on the pending decision are
  explicitly de-emphasized. A static accent rail is sufficient to mark the
  decision card.
- **Extreme density** — cozy needs breathing room. Don't pack rows at 12px.
- **Cold-dark-native identity** — the candidate may choose light, warm-dark,
  or both. Cold near-black (`#0a0e11` ground) is the aesthetic we are leaving.

---

## 7. Per-screen specs

Each screen below specifies: **purpose**, **states**, **data fields**, **design
notes**, and **editorial/cozy guidance** specific to that surface.

### 7.1 Inbox (`inbox.html`)

**Purpose.** The default landing screen. Every pending human decision across
all runs, oldest-first. A reading-queue — the user scans to decide what to
open, then clicks through to the Run Detail to actually read and decide.

**States.**
- **Populated** (6–8 items, covering all six kinds — at least one gate, one
  escalation, one round-cap, one paused, one staged, one malformed/bounced).
- **Empty** — "Inbox zero." A considered, warm empty state, not a blank page.
  Treat it as a designed moment.
- **Loading** — skeleton. Comfortable, not a spinner.

**Data fields per row.**
- `kind` — one of `gate | escalation | round-cap | paused | staged | malformed`
- `gate` — G0–G3, present only when `kind === 'gate'`
- `title` — the decision title
- `source` — the repo/source id
- `slug` — the run slug
- `detail` — a one-line summary of what's being asked
- `since` — epoch seconds → age ("3d", "5h", "12m")
- `reviewable` — boolean; when false and kind is gate, this is a **bounce**
  (R3): render *"Bounced — packet fails its contract; no approval is
  offered."* with no approve affordance
- `problems` — string[] (visible on malformed/bounced)
- `packet` — string[] of artifact paths the decision references

**Design notes.**
- This is a **reading-queue, not a speed-triage terminal.** Rows should be
  comfortable to scan — enough information to decide whether to click through,
  not so dense that the eye wants to leave.
- The **left-edge status indicator** (Sentry pattern — a 2px colored rail at
  the row's left edge) is a good fit: it carries the kind/status signal without
  adding a dense chip column. Pair it with the kind chip itself (form + color,
  per A5).
- Don't pack rows too tight. Comfortable row height, generous horizontal
  rhythm.
- The age badge can carry urgency (older = more urgent) but must pair a
  non-color signal (weight, glyph) with the hue, per A5.
- The header should not advertise keyboard shortcuts. The current
  `j/k move · ↵ open` caption is removed.

**Editorial/cozy guidance.**
- Give the inbox a real header — a considered title, a count, a sense of
  place. Not a mono uppercase readout.
- The empty state is a moment of voice. "Inbox zero." with a warm line of
  explanation is the floor; a candidate may do more (a small illustration, a
  signature mark, a quiet gradient).
- Rows can breathe. A 56–64px row height with comfortable internal padding is
  appropriate. The detail line should be measure-capped (~78ch) so it doesn't
  stretch across the full width on large screens.

### 7.2 Portfolio (`portfolio.html`)

**Purpose.** The overview screen. All runs × sources at a glance. The gate
ledger is the core visual — each run's progress through G0–G3.

**States.**
- **Populated** (8–10 runs across all phases and profiles).
- **Empty** — no runs found. A designed empty state with a path forward
  ("Stage the first run").

**Data fields per run.**
- `slug`, `source`
- `phase` (with optional `pausedReason`)
- `profile` (patch / standard / full)
- `gates` — Record<G0–G3, {approved, decided, by, at}>
- `tasks` — {total, done, maxRounds}
- `budget` — {limit, spent} (limit null = unmetered)
- `updatedAt` → age
- `needsHuman` — count
- `escalationsOpen` — count
- `aheadOfOrigin`, `behindOrigin` — divergence (render `↑N` for unpushed,
  `↑N↓N` for diverged)
- `malformed` — optional string (rendered as a bad-toned note under the slug)

**Columns.** slug (+ source), phase, gate ledger (G0–G3 cells showing
✓/✕/·), tasks (done/total), max rounds, budget meter (spent/limit), updated
age, needs-human count. "+ New run" CTA in the header.

**Design notes.**
- The gate ledger is the centerpiece. Each gate cell shows the gate number + a
  glyph (`✓`/`✕`/`·`) + a tinted status treatment. Pending gates are dashed
  outline; approved are tinted-ok; declined are tinted-bad. (Form + color,
  per A5.)
- **Tinted status chips** (GitHub Primer pattern) for the phase — muted-tint
  background + emphasis-colored text, never solid filled.
- The table should be **readable and calm, not a dense terminal grid.**
  Comfortable row height, generous column padding. This is a scan surface,
  tighter than the reading surfaces but still calm.
- The budget meter is a small inline element: a thin bar + a `$spent/$limit`
  mono label. Over-budget is tinted-bad (with a non-color signal — a filled
  bar past the limit, or a glyph).
- The needs-human count, when > 0, is the one element that can carry a touch
  of emphasis — but not a pulsing glow. A solid tinted-accent pill with the
  number is sufficient.
- Divergence (`↑N` / `↑N↓N`) is a small mono pill, warn/bad tinted.

**Editorial/cozy guidance.**
- The header can carry a real title and a count. The "+ New run" CTA is a
  considered primary button, not a mono outline link.
- The empty state is designed: a signature mark, a warm line, a clear CTA.
- The table can sit on a tinted ground (not a hard-bordered card) to feel less
  like a spreadsheet and more like a page.

### 7.3 New Run (`new-run.html`)

**Purpose.** Stage a new run. The user authors an intent brief, picks a
profile and budget, and watches the `state.yaml` the server will commit
assemble itself live in a right-hand preview. The preview is the hero.

**States.**
- **Partially filled** — the primary state for the prototype. The preview chip
  is visible and "live" (a status dot + commit message + author/committer line
  + file tree showing `runs/<slug>/state.yaml` [new] and
  `runs/<slug>/intent-brief.md` [new] + a collapsible full `state.yaml`
  content). Some brief sections filled, some empty.
- **Empty form** — fresh state, preview shows placeholder chrome.
- **Validation error** — e.g. invalid slug (slug must match
  `^[a-z0-9][a-z0-9-]*$`), shown inline at the field.
- **Submission success** — a flash confirming the run was staged (commit oid,
  branch), with a path to the run.

**Form fields.**
- **Source** selector (repo) — shown only if multiple sources configured; for
  the prototype, render as a single configured source or a select.
- **Title** — free text.
- **Slug** — auto-suggested from the title (lowercase, dashes); mono font;
  must match `^[a-z0-9][a-z0-9-]*$`; shows a live `→ run/<slug>` hint.
- **Profile** — three buttons (patch / standard / full), each showing its
  gates as chips (patch → G1·G2, standard → G0·G1·G2, full → G0·G1·G2·G3).
  Selecting one highlights it and updates the preview.
- **Budget** — USD number input; blank = unmetered.
- **Intent brief sections** — one textarea per section, in the contract's
  order: **Problem, Motivation, Constraints, Out of scope**. Each section
  shows a `## <heading>` chrome header, a "required section" label, and a
  filled/empty indicator (`✓` / `·`).
- **Provenance** — optional: source, ref, url (all free text, all optional).
- **Recorded as** — the server's git identity (name + email), displayed never
  asked.

**Right aside — the live `state.yaml` preview.**
- A header: "The record this stages · live preview".
- A "new branch" line: `run/<slug>`.
- The **genesis commit chip** — the hero element:
  - A status dot (filled-accent when ready, hollow when not).
  - The commit message, e.g. `state(my-run): staged by Nathan Carter
    [client-key: <uuid>]`.
  - An author/committer line: `Nathan Carter <nathan@example.com> — author &
    committer`.
- A file tree:
  - `runs/<slug>/state.yaml` `[new]`
  - `runs/<slug>/intent-brief.md` `[new]` — with a `N of M` sections-filled
    counter and a per-section checklist (`✓`/`·`).
  - (If profile is patch) `runs/<slug>/tasks/01-<slug>.yaml` `[new]` —
    placeholder stub.
- A collapsible `<details>` with the full `state.yaml` content (mono, line
  count in the summary).
- A closing note: "Staging commits this record. Nothing else happens. No
  agent dispatches, no budget meters — the run rests at `staged` until you
  arm it."

**Design notes.**
- The user specifically called out this screen: *"there are genuinely
  multiple valid ways of rendering/styling this form, especially the preview
  commit chip."* The preview is the hero. Make it feel like a considered,
  editorial preview — not a debug output, not a raw `<pre>`.
- The form should be comfortable to fill out, with generous spacing. This is
  an authoring surface; treat it like a writing tool, not a settings form.
- The slug field is mono; everything else is the text sans. The `→ run/<slug>`
  hint updates live.
- The profile buttons each show their gates — selecting one is a real choice
  with visible consequences (the preview's gates section changes).

**Editorial/cozy guidance.**
- This is the screen for an **italic-serif hero** (Stripe pattern). The "New
  run" title and/or the genesis commit message can carry editorial type.
- The preview aside is a **live document**, not a panel. Consider treating it
  like a page proof — a tinted ground, generous padding, the commit message
  as a confident headline, the file tree as a structured list.
- The form's section headers (`## Problem`, etc.) are an opportunity for
  typographic personality — they're the contract's chrome, rendered with
  respect.
- The "Stage run" button is a considered primary CTA. No glow pulse; a
  confident solid fill is enough.

### 7.4 Run Detail (`run-detail.html`)

**Purpose.** The reading screen. The most important screen for the reframe.
The user comes here to read the artifact(s) an agent produced and then
approve or decline the gate the run is paused at.

**States (for the prototype).**
- A run in `implement` phase with **G0✓ G1✓, G2 pending** (decision cards
  visible), **artifacts tab active** showing 2–3 markdown files.

**Layout.**
- **Header**: slug, phase chip, gate ledger, divergence (ahead/behind origin),
  budget meter, genesis line ("staged by Nathan Carter · <date> · from
  <provenance>").
- **"Needs you" decision cards** — one per pending item. Each card states:
  what / why / what-changes / how-verified / how-to-undo, then approve/decline
  affordances. Bounced items (R3) show the bounce message and no affordances.
- **Task board** — a list of tasks with status (`pending`, `in-progress`,
  `in-review`, `review-approved`, `done`) and review-round count.
- **Tabs**: artifacts / diff / history. For the prototype, render the
  artifacts tab active.
- **Artifacts tab**: a sidebar file list + a rendered markdown/yaml content
  pane. The content pane is the reading surface.

**Data fields.**
- `summary` — the RunSummary (slug, source, phase, pausedReason, profile,
  gates, tasks, budget, updatedAt, needsHuman, escalationsOpen,
  aheadOfOrigin, behindOrigin, ref)
- `items` — InboxItem[] (the pending decisions, rendered as NeedsYouCards)
- `state` — RunState (tasks, escalations, budget ledger)
- `artifacts` — string[] (file paths)
- `history` — HistoryEntry[] (oid, time, author, subject, phase)

**Design notes.**
- This is **the reading screen.** The artifact content pane should be a
  comfortable reading surface: good typography, **measure cap ~76ch**,
  generous whitespace, comfortable leading (1.6–1.7 for body). This is the
  centerpiece of the reframe.
- The metadata (gate ledger, budget, genesis) should be **calm and
  structured** — the Raycast metadata-rail pattern (a key/value list docked
  at the bottom or side of the header) is a good fit. Don't let metadata
  compete with the reading surface.
- The decision cards should be **visually distinct from passive content**
  (stakes-varied wrapper, per A1) but **not alarming.** A static accent rail
  + a tinted ground + a clear affordance is enough. **No pulsing glow.** The
  current design's `pulse-panel` is explicitly de-emphasized.
- The artifact sidebar is a quiet file list — mono paths, a validation glyph
  per file (`✓` valid / `✕` missing contract sections). The selected file is
  highlighted with a tinted treatment.
- The artifact body renders markdown with real typographic care: headings with
  hierarchy, body at 14–16px with 1.6+ leading, code in mono with a tinted
  background, blockquotes with a left rule, tables with quiet borders. This
  is the surface that proves the redesign reads as "a comfortable reading
  environment."
- A failing-contract artifact shows a banner: *"Fails its <contract> contract
  — missing: <sections>"*.

**Editorial/cozy guidance.**
- The artifact body is where the redesign earns its keep. Treat it like a
  page in a well-set book. Consider a serif body face for artifact prose (this
  is the one place a serif body is clearly justified — long-form reading).
  Alternatively, a carefully chosen text sans at 15–16px with generous
  leading. Either is valid; pick one and commit.
- The header can carry the slug as an editorial title (italic serif or display
  sans), with the phase chip and gate ledger as calm metadata.
- The decision card's "what / why / what-changes / how-verified / how-to-undo"
  structure is an opportunity for structured editorial typography — labeled
  paragraphs, not a dense bullet list.
- The genesis line is a quiet provenance stamp — mono, muted, but considered.
- Whitespace around the artifact body is generous. Don't edge it against the
  sidebar or the viewport.

---

## 8. Component vocabulary

The reusable parts, with design guidance for each. Candidates should define
these as CSS classes (or inline-styled elements) and use them consistently
across the four screens.

### Chips & status vocabulary

- **PhaseChip** — phase name + a non-color signal (glyph or shape) + a tinted
  background. `paused` differs from `done` in shape/fill, not just hue. The
  `staged` variant (a rest state, not an interruption) uses a hollow ring
  marker, not a filled dot.
- **KindChip** — the inbox kind. `gate` shows the gate id (G0–G3); `gate`
  bounced is dashed + struck-through; `staged` is an outline pill with a
  hollow marker; `escalation`/`round-cap`/`paused`/`malformed` are tinted
  pills with glyphs. Form + color throughout (A5).
- **GateCell** — one cell of the G0–G3 ledger. Gate number + glyph
  (`✓`/`✕`/`·`) + tinted treatment (ok/bad/dashed-pending). Title attribute
  carries the decision metadata ("G2 approved by operator · 2026-07-03").
- **GateLedger** — the strip of GateCells for a run's profile.
- **AgeBadge** — the waiting age. Urgent (older than 3 days) carries a
  non-color signal (weight, glyph) in addition to a warn/bad hue.
- **BudgetMeter** — a thin bar + a `$spent/$limit` mono label. Over-budget is
  tinted-bad with a non-color signal (filled bar past the limit, or a glyph).
  Unmetered (limit null) reads as "no budget" in faint text.
- **ValidationBadge** — `✓` (valid) / `✕` (missing contract sections) — glyph
  + color.

### Cards & panels

- **NeedsYouCard** — the decision-critical panel. **Stakes-varied wrapper**
  (per A1): an accent left-rail + a tinted ground + a considered elevation
  (layered ring + soft drop). **No pulsing glow.** Bounced items lose the rail
  and show the R3 bounce message with no affordances.
- **ArtifactBody** — the reading surface. **No hard border** (or a hairline
  at most); generous padding (24–32px); measure cap 76ch; comfortable
  leading. This is a page, not a card.
- **PassiveTable** (portfolio, task board) — flat 1px-line panel, no
  elevation. Calm, scannable.
- **Flash** (submission outcomes) — a tinted banner (ok / info / warn / bad /
  cfg tones), considered but not alarming.

### Tables

- **Portfolio table** — scan density (comfortable, not packed). Tinted status
  chips for phase. Gate ledger as the core column. Cool near-black text, cool
  borders (never pure). `tabular-nums` for numeric columns (not a mono swap —
  preserve the two-number-jobs distinction from the current design).
- **Task board** — a flex row of small task chips (id + status + review-round
  count). Capped rounds (≥3) carry a bad tone + a non-color signal.

### Forms

- **Inputs** — inset well, 1px line, the small end of the radius ladder (6px).
  Cool border, never pure. Focus ring is a 2px accent outline (visible
  everywhere).
- **Profile buttons** — three buttons, each showing its gates as chips.
  Selected = tinted-accent; unselected = inset with a hover border.
- **Section headers** (intent brief) — the contract's `## <heading>` chrome,
  rendered with typographic personality. A "required section" label and a
  filled/empty indicator.
- **Primary button** — considered, confident. Solid fill (accent for primary,
  bad for danger). No glow pulse. Capsule or the medium radius — pick one and
  be consistent.

### Preview (New Run)

- **RecordPreview** — the hero aside. A tinted ground, generous padding, the
  genesis commit chip as a confident headline, the file tree as a structured
  list, the collapsible `state.yaml` as a mono `<details>`. **Editorial
  preview, not a debug output.**
- **GenesisCommitChip** — status dot + commit message (the hero) + author/
  committer line. This is the element the product owner specifically called
  out as having multiple valid renderings. Make it considered.

### Metadata rail (Run Detail)

- **MetadataRail** — a structured key/value list (Raycast pattern) for the
  run header's metadata: phase, profile, gate ledger, budget, divergence,
  genesis. Docked at the bottom or side of the header. Calm, mono labels,
  quiet. Don't let it compete with the reading surface.

---

## 9. Mock data specification

The repo has a fixture generator (`frontend/fixtures/src/index.ts`) that
produces 12 deterministic runs. The data shapes below are derived from it and
from the TypeScript types in `frontend/packages/web/src/api.ts`. **Use
realistic mock data based on these shapes.** Do not invent fields or kinds
outside the fixed vocabularies.

### Type shapes

**InboxItem**:
```
{
  kind: 'gate' | 'escalation' | 'round-cap' | 'paused' | 'staged' | 'malformed',
  gate: 'G0' | 'G1' | 'G2' | 'G3' | null,  // present when kind === 'gate'
  title: string,
  source: string,         // repo/source id
  slug: string,
  detail: string,         // one-line summary
  since: number | null,    // epoch seconds → age
  reviewable: boolean,     // false on bounced gates (R3)
  problems: string[],      // visible on malformed/bounced
  packet: string[],        // artifact paths the decision references
  escalationIndex: number | null,  // when kind === 'escalation'
}
```

**RunSummary**:
```
{
  slug: string,
  source: string,
  phase: 'spec' | 'plan' | 'implement' | 'integrate' | 'release' | 'done' | 'paused',
  pausedReason: string | null,   // e.g. 'budget-exhausted', 'staged'
  profile: 'patch' | 'standard' | 'full',
  gates: Record<'G0'|'G1'|'G2'|'G3', {approved: boolean, decided: boolean, by: string|null, at: string|null}>,
  tasks: {total: number, done: number, maxRounds: number},
  budget: {limit: number|null, spent: number|null},   // limit null = unmetered
  updatedAt: number,      // epoch seconds
  needsHuman: number,
  escalationsOpen: number,
  aheadOfOrigin: number | null,
  behindOrigin: number | null,
  ref: string,            // git ref
  malformed?: string,     // optional malformed-state note
}
```

**RunDetailResponse**:
```
{
  summary: RunSummary,
  items: InboxItem[],      // the pending decisions → NeedsYouCards
  state: RunState | null,  // tasks, escalations, budget ledger
  stateError: string | null,
  stateRaw: string | null,
  validations: Record<string, {ok: boolean, missing: string[], contract: string}>,
  artifacts: string[],     // file paths
  history: HistoryEntry[],  // {oid, time, author, subject, phase}
  now: number,
}
```

**HistoryEntry**: `{oid: string, time: number, author: string, subject: string, phase: string|null}`

**StageRequest** (New Run form payload):
```
{
  source?: string,
  slug: string,
  title: string,
  profile: 'patch' | 'standard' | 'full',
  briefMarkdown: string,   // assembled: # Intent Brief: <title> + ## sections
  costLimitUsd: number | null,
  intake: {source: string|null, ref: string|null, url: string|null, clientKey: string|null},
}
```

### What to include in each prototype

**Inbox (`inbox.html`)** — 6–8 items covering all six kinds. At minimum:
- one `gate` (reviewable, e.g. G2 pending on `g2-pending`)
- one `gate` **bounced** (reviewable=false, with the R3 bounce message)
- one `escalation` (e.g. on `escalated` — "AC2.1 unverifiable: sample input
  referenced by the spec does not exist in the repo")
- one `round-cap` (on `round-cap` — three review rounds, all request-changes)
- one `paused` (on `paused-budget` — budget exhausted)
- one `staged` (on a freshly staged run — the rest state)
- one `malformed` (on `malformed-spec` or `bad-state`)
Order oldest-first. Use realistic ages (1d–7d). Render the populated state as
the primary view; include the empty ("Inbox zero.") and loading (skeleton)
states as sketches below or as a separate state (candidate's choice — but all
three states must be represented in the single file).

**Portfolio (`portfolio.html`)** — 8–10 runs across all phases and profiles.
Include:
- a `done`/merged run (all gates ✓)
- a `release`-phase run (G3 pending, `g3-pending`)
- an `implement`-phase run (G2 pending, `g2-pending`)
- a `plan`-phase run (G1 pending, `g1-pending`)
- a `spec`-phase run (G0 pending, `g0-pending`)
- a `paused` run (budget-exhausted, `paused-budget`)
- an `escalated` run (`escalated`)
- a `round-cap` run (`round-cap`)
- a `patch`-profile run (`patch-g1-pending` or `patch-g2-pending`)
- a `malformed` run (`malformed-spec` or `bad-state`)
Include the populated state as primary; the empty state as a sketch.

**New Run (`new-run.html`)** — a partially-filled form state with the preview
chip visible and "live". Concretely:
- source: `agentic-sandbox` (single configured source)
- title: "CSV importer" (filled)
- slug: `csv-importer` (auto-suggested, valid)
- profile: `standard` (selected, showing G0·G1·G2)
- budget: `25` (filled)
- intent brief sections: Problem filled, Motivation filled, Constraints
  empty, Out of scope empty (so the `N of M` counter reads `2 of 4`)
- provenance: source `linear-issue`, ref `ENG-421`, url empty
- recorded-as: `Nathan Carter <nathan@e14s.example>`
- the preview chip: status dot (filled-accent, ready), commit message
  `state(csv-importer): staged by Nathan Carter [client-key: <a uuid>]`,
  author/committer line, file tree with `state.yaml [new]` and
  `intent-brief.md [new]` (2 of 4), collapsible `state.yaml` content
Also include the empty-form state and a validation-error state (invalid slug,
e.g. `CSV Importer!` failing `^[a-z0-9][a-z0-9-]*$`) and a submission-success
flash — as sketches or as alternate states in the same file.

**Run Detail (`run-detail.html`)** — a run in `implement` phase with G0✓ G1✓,
G2 pending. Use `g2-pending` (slug `g2-pending`, "log rotator"):
- header: slug `g2-pending`, phase `implement`, gate ledger G0✓ G1✓ G2·,
  budget `$0/$25` or similar, genesis "staged by Nathan Carter · Jul 02 ·
  from linear-issue · ENG-421"
- one NeedsYouCard: G2 pending, "what: approve the implementation for
  release / why: AC1.1 and AC2.1 verified / what-changes: src/core.py +
  src/errors.py / how-verified: verification-report.md / how-to-undo: revert
  the run branch", with approve/decline affordances
- task board: `01-core` (review-approved, ⟲1), `02-errors` (review-approved,
  ⟲2)
- artifacts tab active, sidebar showing 2–3 files: `intent-brief.md`,
  `spec.md`, `plan.md` (and optionally `verification-report.md`), with
  validation glyphs
- the content pane rendering one of the markdown artifacts (e.g. `spec.md`)
  with full typographic care — headings, body, code blocks, a table, a
  blockquote, a list. This is the surface that proves the reading-comfort
  reframe.

### Realistic artifact content

For the Run Detail content pane, render a realistic `spec.md` with:
- a `# Specification: log rotator` H1
- a `## Context` section with 2–3 paragraphs of body
- a `## Requirements` section with two `### R1` / `### R2` subheadings, each
  with acceptance-criteria checkboxes (`- [ ] AC1.1 — ...`)
- an `## Assumptions` section with a bold `**ASSUMPTION:**` line
- an `## Out of scope` section
- a code block, a small table, and a blockquote somewhere in the body

This exercises the full typographic range the reading surface must handle.

---

## 10. Reference board (top stealable details)

Organized by relevance to this redesign. Steal deliberately; cite which you
used.

### High relevance — steal these

1. **Stripe — italic serif hero headlines + large real numbers as design
   elements.** Editorial confidence for the New Run hero and the genesis
   commit chip. The "Stage run" title and the commit message can carry an
   italic serif. Real numbers (budget, gate counts, inbox waiting count) can
   be confident editorial numerals, not 12px mono pills.

2. **GitHub Primer — tinted status chips.** Muted-tint background +
   emphasis-colored text/border, **never solid filled badges**. Apply to
   phase chips, gate cells, kind chips, status pills throughout. Example:
   `open` = `#dafbe1` bg / `#1a7f37` text.

3. **GitHub Primer — cool near-black + cool borders, never pure.** `#1f2328`
   not `#000`; `#d1d9e0` not `#ccc`. One value swap that de-genericizes the
   whole palette.

4. **GitHub Primer — layered "ring + soft drop" shadows.** A hairline ring
   plus a diffused drop, e.g. `0 0 0 1px #d1d9e040, 0 6px 12px -3px #25292e0a,
   0 6px 18px 0 #25292e1f`. Use sparingly to elevate the few surfaces that
   warrant it (the decision card, the preview aside).

5. **Raycast — Detail.Metadata rail.** A structured key/value list docked at
   the bottom (or side) of a detail pane. Perfect for Run Detail's
   phases/gates/budget/genesis metadata — keeps the header calm and the
   reading surface unobstructed.

6. **Vercel Geist — named type roles, not ad-hoc sizes.** Semantic roles
   like `label-14`, `copy-13-mono`, `button-14`, `heading-24` — each
   pre-combining size + line-height + tracking + weight. Define your roles
   once; use them consistently. (Satisfies A3.)

7. **Vercel Geist — 6/12/16 radius ladder.** Inputs 6px, cards 12px,
   fullscreen 16px — radius escalates with elevation. (Satisfies A2. Pick a
   ladder and commit; 6/12/16 is a starting point, not a mandate.)

8. **GitHub Primer — custom variable font + semibold titles + relaxed
   leading.** 1.625 for body, titles weight 600. A variable font with
   personality (or a well-chosen open serif/sans pair) is the A3 lever.

### Medium relevance — consider these

9. **Sentry — left-edge status indicator.** A 2px colored rail at a row's
   left edge carries the status signal without a dense chip column. Good fit
   for the Inbox.

10. **Sentry — tabbed triage states.** Tabs that mirror operator mental
    states. Maps to Gate's pending-decision kinds (gate / escalation /
    round-cap / paused / staged / malformed) — a candidate may group the
    inbox by kind via tabs, but the default view remains the flat
    oldest-first queue (preservation constraint #1).

11. **Vercel Geist — visible-guide grid as decorative motif.** A blueprint
    grid as a signature geometric motif on one surface (the New Run preview,
    or the Portfolio background). Restrained, one surface.

### Lower relevance — context only

12. **Linear — display face for headings against a text face for body.**
    Establishes two type roles (a display cut for identity-bearing headings, a
    text cut for reading) rather than one face serving every purpose. (The
    P4 finding from prior research; satisfies A3.)

13. **Datadog — grouped, variably-sized layout.** Partial-width groups,
    density varies by content type. (The P3 finding; satisfies A4 — but we
    are not building a dense dashboard, so apply the *principle* of
    density-by-content, not the dense aesthetic.)

---

## 11. Technical constraints

- **Desktop-only.** No mobile responsive needed. Design for a ~1280–1440px
  viewport. (The current app has a mobile top-nav fallback; the prototypes
  need not.)
- **Static HTML+CSS.** Each screen is a standalone `.html` file with inline
  `<style>`. No build step, no framework, no external CSS files.
- **Google Fonts / CDN font imports are OK.** `<link>` to Google Fonts or
  `@import url('https://fonts.googleapis.com/...')` is allowed for the
  prototypes. (The prior research flagged self-hosting as an implementation
  cost for the eventual build; that is out of scope for these prototypes.)
- **No JavaScript is required** for static prototypes — hover states via CSS
  only. **If interactivity is needed for the design to read** (e.g. tab
  switching on Run Detail, collapsible `state.yaml` on New Run), minimal
  inline JS is acceptable. Keep it tiny and self-contained.
- **Theme: light, warm-dark, or both — the candidate's choice.** Direction C
  (editorial, cozy) suggests light or warm-dark. **Specify the recommended
  theme in a comment at the top of each file.** Cold near-black dark is the
  aesthetic we are leaving.
- **WCAG 2.1 AA contrast** in whichever theme(s) you ship. Body text ≥ 4.5:1;
  large text ≥ 3:1; UI components ≥ 3:1. If you offer both themes, AA in
  both.
- **Respect `prefers-reduced-motion`.** Any motion (hover transitions, a
  subtle skeleton shimmer) must yield to `prefers-reduced-motion: reduce`.
  No pulsing, no glowing signal chips as a primary visual device (see §6).
- **No visible keyboard shortcut hints.** The keyboard model may work under
  the hood, but the UI must not advertise it (no `j/k` captions, no `⌘K`
  pills, no `<kbd>` affordances in the chrome).
- **Use realistic mock data** per §9. Do not invent fields, kinds, phases,
  profiles, or burdens outside the fixed vocabularies.
- **Measure caps on reading surfaces** — ~76ch for artifact body and decision
  prose. This is a reading-comfort constraint.
- **Status encoded in form, not just color** — every status chip carries a
  glyph, shape, fill-style, weight, or position difference in addition to its
  hue. CVD-safe by construction.

---

## 12. Open questions (do not block — design around)

These are ambiguities a candidate may resolve with a stated assumption rather
than escalate. State your assumption in a comment.

- **Single theme vs. both.** The brief permits light, warm-dark, or both. If
  you ship one, prefer light or warm-dark. If both, specify which is primary
  and ensure AA in each.
- **Serif body for artifact prose vs. text sans.** Both are valid for the Run
  Detail reading surface. Pick one and commit; state why.
- **Inbox grouping.** The default view is the flat oldest-first queue
  (preservation #1). A candidate may *additionally* offer kind-based tabs
  (Sentry pattern), but the flat queue remains the landing state. State
  whether you add tabs.
- **The genesis commit chip's exact rendering.** The product owner
  explicitly noted multiple valid renderings. Pick one and commit; this is
  the element that most rewards a point of view.
- **Mascot / voice.** Optional. If you introduce a recurring mark or voice,
  keep it restrained — one signature, used deliberately.

---

## 13. What "done" looks like

A candidate's four HTML files are done when:

1. Each screen renders its specified state(s) with realistic mock data per §9.
2. The reading surfaces (Run Detail artifact body, decision prose) are
   genuinely comfortable — measure-capped, generous leading, considered
   typography.
3. The aesthetic clears the anti-pattern floor (A1–A5): stakes-varied
   wrappers, a radius ladder, ≥2 type roles, per-screen density rhythms,
   form+color status.
4. The preservation constraints (#1–12) all hold — inbox is the landing
   screen, the gate ledger renders, decision cards carry their five-part
   structure, status is form+color, etc.
5. The de-emphasized items are gone — no visible keyboard hints, no pulsing
   glow, no cold-dark-native identity, no extreme density.
6. The whole reads as a product with a team and a point of view — not an LLM
   artifact.

The bar is not "matches the current design but prettier." The bar is "looks
like a real, beautiful, mature product UI that a human designer made for a
team that cares about reading."
