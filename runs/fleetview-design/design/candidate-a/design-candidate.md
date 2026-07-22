# Design Candidate: candidate-a — "The Ledger"

## Thesis

The gate console is a ledger of record, not a dashboard. It borrows the grammar of
financial print — warm paper ground, ruled tables instead of boxed cards, a serif
display voice over a sans working voice, square corners, near-zero motion — so that
routine surfaces recede into quiet typography and the one object that carries
consequence (a pending decision) is the only thing on the page that is physically
raised. Using it should feel like signing a register: deliberate, legible, final.

## Mockups

- `inbox.html` — reading-list queue with the full kind vocabulary (gate, bounced
  gate, escalation, round-cap, paused, malformed) and a selected row with live
  focus ring; sketches: inbox zero, loading, error.
- `portfolio.html` — every-run ledger table with malformed-run row, paused run,
  needs/escalation stamps; sketches: zero-runs (the new state), loading, error.
- `metrics.html` — gate table with approval meter (90% tick + over-triggering
  flag), ordered burden-mix ramp + legend, rounds distribution, budget honesty
  incl. "never updated"; sketches: no-decisions, loading, error.
- `run-artifacts.html` — run head with gate cells, needs-you decision plate with
  an OPEN approve flow (burden picker, selected tile focused, notes), packet
  links, task board, artifact rail with validation marks, rendered spec.md;
  sketches: malformed run-state banner, bounced no-approval card, committed /
  CAS-409 / error flashes, failing-contract artifact, empty, loading, error.
- `run-diff.html` — two-file diff with add/del hunks, gutters, per-file stats;
  sketches: no-diff, run-is-merged, loading, error.
- `run-history.html` — ruled register, newest first, phase transitions marked by
  a 2px accent rule + printed `→ phase` stamp; sketches: no-history, loading,
  error.

## Look-and-feel spec

**Type stack.** Three roles (not one scaled): *display serif* `'Iowan Old
Style','Palatino Linotype',Palatino,Georgia,'Times New Roman',serif` for page
titles, item titles, section glosses, and empty-state ledes; *working sans*
`-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif`
for body, labels, and controls; *evidence mono* (existing `--font-mono` stack) for
slugs, paths, ids, diffs, ages, and all tabular figures. Run slugs stay mono even
at display size (24px) — identifiers are evidence.

**Scale.** 30/1.1 page title (serif 600), 24/1.1 run slug (mono 600), 17/1.3
decision title (serif 600), 15/1.35 inbox title (serif 600), 14/1.55 body,
12.5 secondary, 11.5 table numerals (mono, `tabular-nums`), 10.5 uppercase
kickers/labels (sans 600, +0.09–0.14em tracking), 12/1.7 diff code. Ruled section
heads: 2px ink rule + small-caps kicker + italic serif gloss.

**Color tokens** (all `light-dark()`, light / dark):
`--ground #f6f3ea/#16140f` · `--surface #fdfbf4/#1d1a14` · `--raised
#ece7d8/#262218` · `--ink #211e16/#eae4d4` · `--muted #575145/#a89f8a` ·
`--faint #837c6a/#746c5a` · `--line #ded7c4/#38321f` · `--rule = ink` ·
`--accent #1e4f8f/#92b4e3` (ledger blue) · `--accent-deep #153a6b/#6f97c9` ·
`--ok #2f6b40/#86c28f` · `--warn #8a5d0f/#d3a94e` · `--bad #a03123/#e2836a` ·
`--on-solid #fdfbf4/#16140f` · washes at 7–14% alpha of accent/ok/warn/bad ·
burden ramp `#cfdcee→#6f94c4→#1e4f8f` light, `#33517c→#6d94c6→#b3cbea` dark
(lightness-monotonic in both), unrecorded gray `#d9d3c2/#3d3828` · hard shadow
`rgba(33,30,22,.16)/rgba(0,0,0,.55)`.

**Spacing/density rule.** 4px base grid; each screen sets its own rhythm by
reading purpose: *reading* surfaces (inbox, artifact prose) 14px row padding,
68–72ch measure caps; *scanning* ledgers (portfolio, metrics, budget, register)
8–10px rows at 12.5px text; *evidence* (diff) 12px/20px mono with zero vertical
line padding. Passive tables are never boxed — a 2px ink rule opens them,
hairlines divide them, the ground shows through.

**Component shapes.** Radius 0 everywhere except two "inked stamp" pills (age,
nav count). Stakes decide the wrapper: passive content lies flat (rules only, or
a 1px-border plate for evidence); the pending-decision card is the sole raised
object — surface plate, 3px accent spine (bad spine when bounced), 4px 4px 0 hard
shadow. Kind stamps: routine gates outlined accent tint; urgent kinds (ESC, CAP,
BAD, PAUSE) solid-filled, heavier, larger — weight and fill carry urgency, not
hue alone; bounced gates dashed-border + struck-through. Gate cells: approved
solid ok border ✓, declined bad ✕, pending dashed empty. Buttons: square; primary
solid accent with a 3px `--accent-deep` bottom edge (letterpress); danger solid
bad; quiet 1px outline. Inputs: square, 1px line border on ground.

**Motion policy.** Print does not animate: no entrance, movement, scale, or
skeleton animation anywhere. Only color/border/opacity transitions at 120ms
ease-out on hover/focus/selection; loading is static text ("Reading
repositories…"); `prefers-reduced-motion` zeroes even those.

## Research traceability

Applied: **P1/REC4** — glyph+color kept everywhere and extended: urgency now also
changes fill, weight, and border shape (solid stamps, dashed pending cells,
struck bounced stamps), never hue alone. **P2/REC6** — mono font-swap reserved
for evidence (diff, paths, ids, slugs); ordinary numeric columns use
`tabular-nums` at text size. **P3/REC3** — three named density rhythms
(reading/scanning/evidence) replace the single app-wide scale. **P4/REC2** —
serif display role against sans working role; differs in face, not just
size/weight. **P5** — measure caps extended beyond `.prose-artifact` to inbox
detail (68ch), metrics captions (66ch), and decision copy (68ch). **REC1** —
wrapper treatment varies by stakes: flat rules for passive tables, bordered plate
for evidence, raised spined plate only for decisions. **REC5** — the
8px-radius/1px-neutral-border card recipe is eliminated (radius 0, rules over
boxes). Avoided anti-patterns A1–A5 by the mechanisms above.

Deviations: none of REC1–REC6 is deviated from. The ux-research open question on
non-system typefaces is resolved by achieving the serif identity entirely within
system stacks — no embedded font, so the file:// floor is met with zero base64
payload (metric variance across OSes is accepted; see Implementation notes).

## Ergonomics notes

Focus: every interactive element takes a 2px accent `:focus-visible` ring, 2px
offset (shown live on the inbox selected row and the checked burden tile). Focus
order follows source order: masthead nav → page header → rows/decision card →
task board → tabs → artifact rail → body. Keyboard model unchanged and printed on
the surfaces that own it (`j/k/↵` in the inbox header, `a/x/1/2/3/esc` in the
decide panel).

Contrast (WCAG 2.1 AA, checked in both themes): ink ≥14:1, muted ≈6.5:1, accent
≈7.4:1 light / ≈8:1 dark, bad ≈7:1, warn ≈4.6:1 light (always paired with the ⚠
glyph), on-solid over accent/bad/warn ≥4.6:1; meters/gate cells/stamps ≥3:1
against their grounds. Named gap: `--faint` (≈3.4:1) misses 4.5:1 by design — it
is restricted to metadata duplicated elsewhere (gutter line numbers, oids beside
titled rows, hints beside labels) and never carries sole meaning; promoting it to
`--muted` costs the recede-hierarchy, deferred deliberately.

States: all six screens sketch empty, loading, and error plus every R1 required
state (full inbox kind vocabulary + zero; malformed portfolio row + zero-runs;
metrics no-decisions; malformed banner, open decide with burden picker, bounced
no-approval, task board; diff no-diff + merged; history empty).

## Implementation notes

Fits the existing React 19/Tailwind 4/Vite stack as a token + class-recipe swap:
`styles.css` `@theme` gains the paper/serif tokens (`--font-display`, ramp and
wash colors); `app.tsx` shell changes from left rail to masthead (same three
routes, no router change); `chips.tsx`, `decide.tsx`, `diff-view.tsx`, and the
four pages restyle in place. All `data-inbox-row`/`data-needs-card`/`data-decide`
hooks, the keyboard model, and `api.ts` are untouched, so `smoke.spec.ts` holds.

Risks/ADR-worthy: (1) system-serif metric variance — Iowan Old Style (macOS),
Palatino Linotype (Windows), Georgia (Linux fallback) differ in x-height; if the
Architect wants pixel-identical branding across OSes, self-hosting one OFL serif
(~120–200KB woff2, no CDN per the R4 floor) is the cost — decide before build.
(2) `light-dark()` inside rgba washes needs Tailwind 4 arbitrary-value syntax or
plain CSS custom properties — keep them in `styles.css`, not utility classes.
(3) The zero-runs portfolio state is the one new render branch (spec R1/AC6.3).
(4) Hard offset shadows print differently on dark ground — token provided, keep
the plate border so the decision card still separates at low display contrast.
