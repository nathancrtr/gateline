# Design Candidate: candidate-c — "Wayfinder"

## Thesis

The gate console is public signage for a busy system — a terminal you walk into,
read from across the room, and act on without ambiguity. Bright achromatic ground,
one dark ink signage band with a constant violet keyline, a geometric-grotesque
display voice in bold uppercase kickers, and status carried by solid color-block
tags and left edge-bands (hatching for anything voided). Where A signs a register
and B commands a deck, C follows the signs: nothing decorates, everything directs.

## Mockups

- `inbox.html` — decision queue with the full kind vocabulary (G0/G1 gates,
  bounced-hatched G2, ESC, CAP, PAUSE, BAD) and a selected row with live focus
  ring; sketches: inbox zero, loading (static skeleton + crawling progress
  stripe), error.
- `portfolio.html` — departures-board table (ink header row, per-row status
  edge-bands) with malformed-run row, paused/over-budget run, needs and
  escalation blocks, gate strips; sketches: zero-runs (the new state), loading,
  error.
- `metrics.html` — gate table with approval meters (90% threshold tick, solid
  "⚠ OVER-TRIGGERING?" flag on G0), ordered burden-mix ramp + legend,
  review-rounds distribution, budget honesty incl. "⚠ never updated"; sketches:
  no-decisions, loading, error.
- `run-artifacts.html` — run head with gate strip + budget meter; the NEEDS YOU
  block (the page's sole ink-block-headed surface) with an OPEN approve flow
  (burden picker, option 2 selected + focused, notes), packet links, task board,
  artifact rail with ✓/✕ validation marks, rendered ux-research.md; sketches:
  malformed run-state banner with raw yaml, bounced no-approval block (hatched
  head), committed / CAS-409 / error flashes, failing-contract artifact banner,
  no-artifacts, loading, error.
- `run-diff.html` — two-file evidence diff (modified + added) with hunk headers,
  split gutters, per-file +/− stats on ink file headers; sketches: no-diff,
  run-is-merged, loading, error.
- `run-history.html` — route-line timeline of state.yaml commits, newest first;
  phase transitions are square "interchange" stops with a solid `→ phase` tag;
  sketches: no-history, loading, error.

## Look-and-feel spec

**Type stack.** Three roles: *display grotesque*
`'Avenir Next','Avenir',Futura,'Century Gothic','Segoe UI',system-ui,sans-serif`
(600–800) for page signs, item titles, section heads, tags, buttons, and all
uppercase kickers; *working sans* (existing `--font-sans` stack) for body,
detail text, and hints; *evidence mono* (existing `--font-mono`) for slugs,
paths, ids, oids, ages, diffs, and all tabular figures. Run slugs stay mono even
at 21px — identifiers are evidence, not display copy.

**Scale.** 26/1.05 page sign (display 800, −0.01em), 21/1 run slug (mono 700),
15/1.2 decision title (display 700), 14.5/1.3 item titles (display 600), 14/1.5
body, 13.5 decision copy, 12.5 secondary, 12/20px diff code (mono), 11–12 table
numerals (mono, `tabular-nums`), 10–11.5 uppercase kickers/column heads/buttons
(display 700, +0.10–0.16em tracking).

**Color tokens** (all `light-dark()`, light / dark): `--ground #f1f1f3/#161619`
· `--surface #ffffff/#1e1e22` · `--raised #e6e6ea/#2a2a31` · `--ink
#1b1b20/#ebebee` · `--muted #565660/#a3a3ad` · `--faint #8f8f99/#6d6d77` ·
`--line #d7d7dc/#34343b` · `--band #1b1b20/#0f0f12` with fixed `--band-ink
#f2f2f4` and `--band-muted #9a9aa4` (the signage band is dark in both themes —
it *is* the brand) · `--strip #6d63e8` fixed in both themes (keyline, active-tab
underline, count block, interchange stops) · `--accent #4f46c8/#a7a1f2` ·
`--ok #1e7a46/#5fc98c` · `--warn #8a6206/#d8ab4b` · `--bad #b23227/#f2836f` ·
`--on-solid #ffffff/#111114` · soft washes at 10–15% alpha · burden ramp
(violet, lightness-monotonic both themes) `#d9d6f6→#8c85e0→#4f46c8` light,
`#3a3670→#7d76d6→#c9c5f8` dark, unrecorded gray `#d4d4d8/#3f3f46`. No shadows
and no glow anywhere — block contrast is the only elevation.

**Spacing/density rule.** 8px block grid; three rhythms by reading purpose:
*queue* (inbox, needs-you copy) 13–14px row padding, 70–74ch measure caps;
*board* (portfolio, metrics, budget) tight 9–10px cells at 12–13px with ink
header rows; *evidence* (diff) 20px mono lines, zero vertical cell padding.
Section heads open with a 2px ink rule + uppercase kicker, not a boxed card.

**Component shapes.** Radius 2px everywhere (signage plate corners) — no pills,
no rounded capsules, no square-plus-hard-shadow. Stakes decide the wrapper:
passive tables sit on a plain 1px-line plate under an ink header row; the
pending-decision block is the page's only ink-block-headed surface, with a 6px
accent edge-band (bad band + diagonal-hatched head when bounced). Kind tags:
routine gates accent-soft block with a 3px inset band; urgent kinds (ESC, CAP,
BAD) solid bad, larger and heavier; PAUSE solid warn; bounced gates hatched +
outlined + struck — fill, size, and hatching carry urgency, never hue alone.
Gate cells: a joined four-cell strip (shared borders); approved solid ok ✓,
declined solid bad ✕, pending gray gate number + dot. Buttons: uppercase display
blocks — primary solid accent, danger solid bad, quiet 2px-line outline. Inputs:
1px line on surface, 2px radius. Rows carry left edge-bands colored by state.

**Motion policy.** Signs don't move; progress does. Exactly one animated
element: the loading progress stripe (diagonal stripes crawling at 1s linear);
skeleton blocks are static. Hover/focus/selection transition color/background
over 100ms linear; no entrance, transform, scale, pulse, or shimmer anywhere.
`prefers-reduced-motion: reduce` freezes the stripe and zeroes transitions.

## Research traceability

Applied: **P1/REC4** — every status keeps a non-color signal, and this candidate
adds two more: solid-vs-soft fill and diagonal hatching (voided/bounced), plus
glyphs (✓/✕/·/⚠) and size shifts on urgent tags — never hue alone. **P2/REC6** —
full mono swap reserved for evidence (diff, paths, oids, slugs, ledger figures);
ordinary numeric columns use `tabular-nums` at table size. **P3/REC3** — three
named rhythms (queue / board / evidence) replace the app's single spacing scale.
**P4/REC2** — a geometric-grotesque display role against the humanist working
sans; differs in face, not just size/weight (A pairs serif+sans, B mono+sans, C
geometric+humanist — three distinguishable axes). **P5** — measure caps extended
past `.prose-artifact` to needs-you copy (70ch), inbox detail (74ch), and
metrics glosses (66ch). **REC1** — wrapper varies by stakes: rules + flat plates
for passive tables, ink file-headers for evidence, and one ink-block-headed
edge-banded surface for the pending decision. **REC5** — the 8px-radius/1px
neutral-border card recipe is gone: 2px radius, ink header rows, edge-bands, no
uniform card. Anti-patterns A1–A5 avoided by these mechanisms.

Deviations: none of REC1–REC6 is deviated from. The ux-research open question
(non-system typeface) is resolved inside system stacks: Avenir Next (macOS) /
Century Gothic (Windows, commonly present) / Segoe UI fallback — zero base64
payload, `file://` floor met. The fallback chain is the weakest link of the
three candidates on Linux (falls to plain sans), argued acceptable because the
identity also lives in the band/keyline/blocks; see Implementation notes.

## Ergonomics notes

Focus: every interactive element takes the 2px accent `:focus-visible` ring at
2px offset (shown live on the inbox selected row and the checked burden tile).
Focus order follows source order: signage band nav (Inbox → Portfolio →
Metrics) → page sign → queue rows / needs-you block (burden 1/2/3 → notes →
Approve/Cancel) → task board → section tabs → artifact rail → body. Keyboard
model unchanged and printed where it lives (`j/k move · ↵ open` on the inbox
sign; `a approve · x decline · 1/2/3 burden · esc` on the needs-you head; `e
cycles artifacts` beside the section tabs).

Contrast (WCAG 2.1 AA, both themes): ink ≈15:1; muted ≈6.5:1; accent-as-text
≈6.2:1 light / ≈7.8:1 dark; on-solid over accent ≈7:1, over bad ≈6:1, over ok
≈5.4:1, over warn ≈5.5:1 (dark theme solids carry near-black text at ≥7:1);
band-ink over band ≈15:1, band-muted ≈5.8:1; white on `--strip` ≈4.6:1; gate
cells, tags, meters, edge-bands ≥3:1 against their grounds (UI-component
floor). **Named gap:** `--faint` (≈3.3:1) misses 4.5:1 by design — restricted to
duplicated metadata (diff gutter numbers, short oids beside titled stops,
`source · ref` stamps, key hints) that never carries sole meaning; promoting it
to `--muted` flattens the recede-hierarchy, deferred deliberately (same posture
as both siblings). Hatched and solid tags remain distinguishable in forced-color
and grayscale rendering because fill pattern, not hue, is the carrier.

States: all six screens sketch empty, loading, and error plus every R1 required
state — full inbox kind vocabulary + inbox zero; malformed portfolio row +
zero-runs; metrics no-decisions; malformed run-state banner + open approve flow
with burden picker + bounced no-approval + task board + decide flashes
(committed/409/error) + failing-contract artifact; diff no-diff + merged;
history no-history.

## Implementation notes

Fits React 19 / Tailwind 4 / Vite as a token + class-recipe swap: `styles.css`
`@theme` gains the achromatic palette, `--font-display`, `--strip`, and ramp
tokens; `app.tsx` moves the shell from left rail to the top signage band + 3px
keyline — same three routes and NavLink structure, no router change (the mobile
top-nav variant already exists, so this converges the two shells rather than
adding one). `chips.tsx` (tags, gate strip, meters), `decide.tsx` (tiles,
uppercase block buttons), `diff-view.tsx` (ink file headers), and the four pages
restyle in place. All `data-inbox-row`/`data-needs-card`/`data-decide`/
`data-decide-panel` hooks, the keyboard model, and `api.ts` shapes are
untouched, so `smoke.spec.ts` holds; the portfolio zero-runs branch is the one
new render (spec R1/AC6.3).

Risks / ADR-worthy: (1) **Display-face variance** — Avenir Next/Century Gothic
differ in width and the Linux fallback loses the geometric voice; if the
Architect wants one face everywhere, self-hosting an OFL geometric grotesque
(~100–180KB woff2, no CDN per the R4 floor — base64 `@font-face` in mockups,
self-hosted file in the build) is the production cost to decide before build.
(2) **Fixed-color band/strip** — `--band-ink`/`--strip` intentionally do not
flip with the theme; they must live as plain CSS custom properties in
`styles.css` (with the rgba washes), not per-utility `light-dark()` values —
same constraint both siblings flagged. (3) **Hatching** is
`repeating-linear-gradient` — cheap, but confirm it survives `print` and
forced-colors mode with the 1px outline as the fallback signal (it does; the
outline + strike carry the state). (4) Dark thead ink rows on long tables:
keep `position: sticky` off in v1 to avoid `light-dark()` + sticky paint bugs
in older WebKit — plain header rows are the mockup behavior.
