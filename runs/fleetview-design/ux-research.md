# UX Research: FleetView gate-frontend look-and-feel redesign

## Scope

The surveyed surface is `frontend/packages/web` (React 19/Tailwind 4/Vite): the four
page components named in the brief — inbox (`pages/inbox.tsx`), run detail
(`pages/run.tsx`, `components/decide.tsx`, `components/diff-view.tsx`, split at build
time into the `run-artifacts`/`run-diff`/`run-history` tab screens per spec.md R1),
portfolio (`pages/portfolio.tsx`), and metrics (`pages/metrics.tsx`) — plus the shared
chip/badge/meter components (`components/chips.tsx`) and token layer
(`src/styles.css`) that back all six screens. External survey covers
operator/ops-console and evidence-review products in the same category (a single
expert reviewing dense state and making a decision): a project/issue tracker
(Linear), a code-hosting design system (GitHub Primer), two observability/monitoring
dashboards (Datadog, Honeycomb), and two written teardowns of generic
AI-generated/default-shadcn interface output, used to name the anti-pattern floor.

## Patterns

### P1 — Status carried by glyph or shape, not color alone
`GateCell` renders `✓`/`✕`/`·` plus a color tone; `ValidationBadge` renders `✓`/`✕`;
`ApprovalMeter` adds a text label ("⚠ over-triggering?") rather than relying on the
warn hue alone. The file's own header comment names this as deliberate: "status is
encoded in form, not just color." Source: `components/chips.tsx:1-2,62-75,87-94`;
`pages/metrics.tsx:126-130`. External corroboration: Honeycomb — "Semantic colors can
help users visually locate an error badge without reading every row in a
table" — https://www.honeycomb.io/blog/design-as-infrastructure — names the same
mechanism (color plus a scannable non-color signal) as what makes dense tables
usable without forcing a row-by-row read.

### P2 — Two distinct numeric-alignment mechanisms, not one
The app already separates two different jobs: a full monospace font-swap for
evidence/code content (diff hunks, artifact bodies, ids, oids), and a `tabular-nums`
utility (same font, fixed-width digits) for aligning ordinary numeric columns in
tables. Source: `components/diff-view.tsx:7-17,44-68` (font-mono throughout, evidence
content); `pages/portfolio.tsx:50,53,59`, `components/chips.tsx:106`,
`pages/metrics.tsx:83,94,125` (`tabular-nums` on ordinary counts/percentages/currency,
no font change). External corroboration: "If you're using a monospace font purely to
stop digits from jittering, you almost certainly want
`font-variant-numeric: tabular-nums` instead... a proportional font with tabular
numerals is more readable and looks more polished" —
https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn.

### P3 — Grouped, variably-sized layout communicates hierarchy in dense dashboards
Datadog's dashboard layout groups related widgets and supports "partial width
groups, which enables you to place groups of different sizes next to each other,"
with a "high density mode" that repositions halves side-by-side on wide screens
rather than stacking everything uniformly. Source:
https://www.datadoghq.com/blog/datadog-dashboards/. This is an external pattern, not
one the current codebase follows — every dense surface here (gate table, budget
table, portfolio table) is instead one full-width card of identical size regardless
of content (see A1/A3 below).

### P4 — Typeface role differentiated from body text for headings/identity
Linear's redesign notes: "we started using Inter Display to add more expression to
our headings while maintaining their readability and kept using regular Inter for the
rest of the text elements" —
https://linear.app/now/how-we-redesigned-the-linear-ui — establishing two type roles
(a display face for identity-bearing headings, a text face for reading) rather than
one face serving every purpose. The same post also ties density to hierarchy: "we've
adjusted the sidebar, tabs, headers, and panels to reduce visual noise, maintain
visual alignment, and increase the hierarchy and density of navigation elements."

### P5 — Capped measure on long-form reading surfaces
GitHub Primer's typography guidance recommends keeping body copy to "around 80
characters or fewer for optimal readability," citing W3C guidance, and keeps content
"left-aligned and ragged right" by default —
https://primer.style/foundations/typography. The app already follows this on its one
prose surface: `.prose-artifact` caps measure at `max-w-[74ch]`. Source:
`src/styles.css:51`. No other reading surface in scope (inbox detail text, metrics
captions, decide-panel copy) currently applies a measure cap — they inherit whatever
width their flex/grid container gives them.

## Anti-patterns

### A1 — One card recipe for every surface regardless of stakes
*(uniform treatment of every surface)* — `rounded-lg border border-line bg-surface`
(or its `border-dashed` empty-state variant) wraps the diff file section, the gate
table, the budget table, the artifact body, the inbox empty state, *and* the run
page's decision-critical "needs you" panel — the one place a human is about to take
an action with consequences. Detect: pull the container class string for a passive
display table and for an action panel on the same page; if they match, the
anti-pattern is present. Source: `pages/portfolio.tsx:20`, `pages/metrics.tsx:68,192`,
`components/diff-view.tsx:27`, `pages/inbox.tsx:82`, `pages/run.tsx:139,244`.

### A2 — Single default radius-and-border recipe app-wide
*(default component styling)* — nearly every rounded element in the app is
`rounded-lg` or `rounded-md` (Tailwind's 8px/6px defaults) paired with a 1px
`border-line`, with no size or weight variation by surface importance; the `Button`
component's three tones (primary/danger/neutral) share one identical shape
(`rounded-md px-3.5 py-1.5 text-sm`) and differ only by background/text color.
Detect: grep for `rounded-lg`/`rounded-md` co-occurring with `border border-line`
across component files; near-universal co-occurrence with zero shape variation is the
tell. Source: `pages/portfolio.tsx:20`, `components/chips.tsx:19,30,42,68`,
`components/decide.tsx:138-140,200-211`. External naming of the same recipe: "Eight
pixel radius on everything... A Card with a one pixel border at slate 200" —
https://freedesignmd.com/blog/shadcn-looks-generic.

### A3 — One font role for every text purpose
*(no typographic identity)* — `--font-sans`, a system-font stack
(`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif`),
is the only non-mono role in the app; page titles, section headers, body copy, and
labels all use it, differentiated only by ad hoc `text-lg`/`font-semibold` size and
weight utilities, never by a distinct face or role. Four separate page headers use
the identical class string `text-lg font-semibold tracking-tight`. Detect: compare
the `font-*` class on an H1 against the `font-*` class on body copy on the same page
— if they're the same token, only size/weight differ. Source:
`src/styles.css:22-23`; `pages/inbox.tsx:75`, `pages/portfolio.tsx:17`,
`pages/metrics.tsx:42`, `pages/run.tsx:67`. External naming: "Inter or Roboto font
(never anything with personality)" —
https://superdesign.dev/blog/why-ai-design-looks-generic. Contrast with P4 (Linear
pairs a display face for headings against its body face specifically to avoid this).

### A4 — One spacing/density rhythm regardless of local information density
*(uniform treatment of every surface, no spatial identity)* — the same header
pattern (`mb-5`/`mb-6 flex items-baseline justify-between`), the same row padding
(`px-4 py-3`/`px-3 py-2.5`), and the same gap scale (`gap-3`/`gap-2`) recur across a
sparse single-column inbox, a dense multi-column metrics table, and a code diff; no
screen adopts a tighter or looser rhythm suited to its own density. Detect: diff the
spacing utility values used for a table row, a list row, and a diff line across
screens — near-identical values regardless of local density is the tell. Source:
`pages/inbox.tsx:74,87`, `pages/portfolio.tsx:16,37`, `pages/metrics.tsx:41,64`,
`components/diff-view.tsx:6,57-58` (table cells at `px-2`/`px-3` with no page-level
density adjustment). Contrast with P3 (Datadog varies layout density by screen size
and content type rather than one rhythm everywhere).

### A5 — Urgency/tone signaled by color swap alone, shape held constant
*(default component styling, no spatial identity)* — `PhaseChip`, `KindChip`,
`AgeBadge`, and the `Button` tones all render at one fixed size regardless of
whether the state is routine ("plan" phase, a neutral button) or urgent (bounced,
malformed, round-cap, a danger action) — only the background/text color token
changes; size, weight, and position stay fixed. Detect: compare markup for a routine
vs. an urgent instance of the same component; if only the color class differs, the
anti-pattern is present. Source: `components/chips.tsx:5-14` (`PHASE_TONE` is a
color-only lookup table), `:27-46`, `:48-59`; `components/decide.tsx:205-209`
(`Button`'s `tone` branch changes only `bg-*`/`text-*`).

## Recommendations

- **REC1** (from A1, A2): Whatever shape/border/radius treatment a candidate
  proposes, vary it deliberately by surface stakes — a decision-critical panel and a
  routine display table should not default to the same wrapper recipe. The *reuse*
  itself is what reads as templated, independent of which specific radius or border
  value is chosen.
- **REC2** (from A3, P4): Establish at least two distinct type roles — one for
  headings/identity, one for body/labels — that differ in more than size and weight;
  a single role scaled up and down does not read as a typographic identity.
- **REC3** (from A4, P3): Let each screen's spacing/density rhythm follow its own
  information density (a sparse single-column inbox vs. a dense multi-column metrics
  table vs. a diff) rather than reusing one spacing scale uniformly across all six
  screens.
- **REC4** (from A5, P1): Where status or urgency must be scannable at a glance
  (chips, badges, meters, buttons), keep pairing a non-color signal — glyph, shape,
  size, or position — with color; don't simplify to color-only differentiation for a
  cleaner look, and don't lose the existing glyph-plus-color mechanism in the
  process.
- **REC5** (from A2): Treat the "8px radius, 1px neutral border, one card recipe"
  combination as a floor to move away from, not a safe default to preserve — it is
  the specific recipe named as the generic-AI/default-shadcn signature in the
  anti-pattern sources.
- **REC6** (from P2): Preserve the existing split between a full monospace font-swap
  for evidence/code content (diffs, artifact bodies, ids) and `tabular-nums`-only
  alignment for routine numeric columns — don't collapse the two into one
  convention; they serve different reading purposes.

## Open questions

- AC4.1 (spec.md) bans any network request in mockup HTML — no `http://`,
  `https://`, `<script src=`, or `@import url(`. If a candidate wants a typographic
  identity built on a non-system typeface (REC2), that face must ship as a
  base64-embedded `@font-face` in the mockup or the candidate must achieve role
  differentiation within the existing system-font stacks (`--font-sans`,
  `--font-mono`) alone. Worth confirming at G1 whether the eventual build (R5/R6,
  same stack) is expected to self-host any such font (no external font CDN) — that's
  an implementation cost the Architect should account for if a candidate with a
  custom typeface wins, and it isn't stated in the brief or spec today.
