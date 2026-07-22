# Review Report: 08-metrics-screen

<!-- Filed as review-09.md: the dispatch named review-05.md, but concurrent
     reviewers had already committed review-05 (03-shell-masthead), review-06
     (04-status-components), review-07 (07-portfolio-screen), and review-08
     (06-inbox-screen); next free number used to preserve the audit trail. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** 658061de62916fa1e5e0de3be6d9b88d3979b040 (branch `run/fleetview-design`)

## Findings

### F1 — minor — budget table keeps `min-w-[420px]` and its theads lack `whitespace-nowrap`, diverging from the mockup's shared `.grid` recipe
- **Where:** `frontend/packages/web/src/pages/metrics.tsx:221,224-227`
- **Failure scenario:** viewport ~500–700px wide → budget column heads
  ("Recorded spend") wrap to two lines instead of forcing horizontal scroll;
  candidate `.grid` (`metrics.html:75-76`) sets `min-width:660px` +
  `white-space:nowrap` on both tables. AC6.1's per-screen fidelity record
  would log a deviation here.
- **Requirement:** C2 (mockups are the authority); task 08 scope "instrument
  density" table recipe

### F2 — minor — legend strip omits the mockup's `margin-top:12px`, tightening the table→legend gap to ~10px vs the mockup's ~22px
- **Where:** `frontend/packages/web/src/pages/metrics.tsx:115`
- **Failure scenario:** populated gate table rendered → `.blegend`
  (`metrics.html:93`) carries both `margin-top:12px` and `padding:10px 12px`;
  the built strip has only the padding, so the legend hugs the last row —
  a recordable AC6.1 delta, no functional effect.
- **Requirement:** C2; task 08 scope (legend inside the panel)

## Coverage

- **Requirement coverage (R1 metrics row, R5/AC5.1–AC5.2)** ✓ — populated gate
  table + burden bar + rounds + budget honesty and the "no decisions yet"
  state are all restyled; loading gains the sanctioned skeleton branch, error
  path untouched. AC5.1/AC5.2 verified by running the commands myself (below).
- **AC5.1/AC5.2, run myself at the exact commit** ✓ — the working tree carries
  an unrelated partial revert of `metrics.tsx`/`inbox.tsx` (rebase debris, cf.
  review-06's note), so I tested in a detached git worktree at 658061d
  (node_modules linked from this checkout, Node 26): `npm run typecheck` clean
  (both projects); `npm test` **127 passed, 1 skipped, 0 failed** (18 files,
  95.8s; the skip is the env-gated live-smoke suite, pre-existing) — no
  orchestrator timeouts in my run, so the implementer's claimed transient
  failures are environmental and in `packages/orchestrator`, outside this diff
  anyway; `npm run build -w @agentic/web` then `npx playwright test` **5/5
  green**, including `portfolio and metrics render` (asserts "Gate decisions" /
  "Budget honesty" visible verbatim). The dist-build prerequisite the notes
  describe reproduced and is unrelated to this edit.
- **Grep floor, run myself on the committed file** ✓ — `light-dark(`,
  `@keyframes`, `animation`, `transition`, `rounded-lg`: zero hits in
  658061d:`metrics.tsx`. Motion enters only via `.skel` (loading branch); the
  glow shadows are static `box-shadow`s per C2's meter recipe.
- **Burden ramp token swap** ✓ — local `BURDEN_RAMP`/`UNRECORDED`
  `light-dark()` constants deleted; `BURDEN_RAMP_VAR`/`UNRECORDED_VAR` read
  `var(--ramp-1..3)`/`var(--unrecorded)` (`metrics.tsx:13-18`), all defined in
  `styles.css:37-41` at this commit (task 02 landed), matching C1 exactly.
  Legend and bar consume the same constants; aria-label/title logic unchanged.
- **C3 frozen behavior, verified mechanically** ✓ — diffed 658061d~1 vs
  658061d with all `className` attributes stripped and whitespace normalized:
  the only residual deltas are the constant rename/value swap (directed by the
  scope), the skeleton markup inside the existing `isLoading` branch
  (sanctioned render-only addition), the decorative "0 / 0" glyph span, and
  JSX line-reflow whose leading/trailing whitespace React trims (th
  "Decisions"/"Median latency", the `{r.source}/{r.slug}` cell, the budget
  lede) — DOM text byte-identical. `formatLatency`, rounds bucketing
  (`metrics.tsx:179-187`), `BurdenBar` filtering/flexGrow, the `Math.round`
  percentage, empty/null branches, and every user-facing string (both h2s,
  both PageStatus messages, legend, flag, and metering copy) are unchanged.
  `PageStatus` consumed unmodified from `./inbox.tsx`; no import changes.
- **Candidate fidelity vs `design/candidate-b/metrics.html`, class-by-class** ✓
  (beyond F1/F2) — head: mono 600 20px uppercase 0.14em over 1px line border,
  14px pad, meta 12px muted right-aligned max-w 340px (`:52-55` vs
  `.head:65-67`); h2 mono 600 13px uppercase 0.1em mb 5px + lede 12px muted
  74ch mb 12px (`:76-79` vs `h2/.lede:70-71`); panels 1px line / 5px radius /
  `bg-surface` with `bg-inset` theads, mono 600 10px 0.12em heads at 9/12px
  padding, td 10/12px, last-row border drop (`:80-114` vs `.panel/.grid:73-78`);
  gate ids mono 600 12px, numerals mono 12px tabular right (`:98-99,110` vs
  `.gate/.num:79-80`); ApprovalMeter 140×8 inset track, 1px line border, 4px
  radius, accent fill + static `0 0 6px var(--glow)`, warn fill sheds the
  glow, 2px faint tick at 90% with title kept (`:137-142` vs
  `.track/.fill/.tick:84-87`); warn flag fully-round capsule, 1px warn border,
  warn-soft wash, 600 11px, 4/8px padding, glyph+text kept (`:146-151` vs
  `.flag:89`); burden bar 16×180px, 2px gaps, 4px radius (`:166` vs `.bbar:91`);
  legend swatches 11px / 3px radius at 11.5px text inside the panel
  (`:115-126` vs `.blegend:93-95`); rounds 440px column, 8px row gap, 64px/26px
  mono tabular labels/counts, inset bordered 16px tracks, accent+glow fill,
  cap bucket `bg-bad` without glow (`:192-204` vs `.rounds/.rrow:97-103`);
  metering ok/warn now weight 600 matching `.metering:105-106`; empty state
  centered, 34px pad, mono accent 18px 0.2em glyph, 15px 600 lede, muted sub,
  no box (`:58-62` vs `.empty:115-118`); loading three `.skel` blocks
  14px/60% + 2×36px/100% at 10px gap above the verbatim PageStatus (`:36-45`
  vs `metrics.html:234-239`). Recorded sub-px deviations, no finding:
  `.ameter` gap 8px vs 9px (`:136`); head `items-baseline` vs mockup
  `flex-end` (`:52`, pre-existing); h2 inherits line-height vs mockup `/1`;
  page container `gap-8` (32px) vs the mockup's 24px head margin
  (pre-existing container); table base `text-sm` vs `.grid` 13px (every
  visible cell overrides to 12px).
- **Token discipline** ✓ — classes: `line, inset, surface, accent, ok, warn,
  warn-soft, bad, muted, faint` plus `var(--glow)`/`var(--ramp-*)`/
  `var(--unrecorded)` — all C1; no `bg-raised` remains in the file; radii
  3/4/5px + `rounded-full` capsule, all inside C2 bands.
- Not assessed: browser-rendered visual pass in both themes (AC6.1 is task
  11's fidelity record); keyboard model (AC5.3 — no handler in this file);
  the implementer's load-average anecdotes (unverifiable, superseded by my
  clean run).

## Boundary check

Inside the surface. The commit touches exactly two files:
`frontend/packages/web/src/pages/metrics.tsx` (the declared
`file_contact_surface`) and an append to
`runs/fleetview-design/tasks/08-metrics-screen.yaml` `notes:` — the
implementer's sanctioned output channel. The working tree's current
modifications to `inbox.tsx`/`metrics.tsx` postdate this commit and are not
part of the reviewed diff.
