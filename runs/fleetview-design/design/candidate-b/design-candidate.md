# Design Candidate: candidate-b — "Signal Deck"

## Thesis

The gate console is a live instrument, not a document. It reads like a fleet
mission-control deck: a cool, near-black ground (dark-native, with a bright-lab
light theme), a monospaced display voice that treats the whole UI as a readout of
git, and status carried by luminous signal chips on inset instrument panels. The
one pending decision doesn't merely sit raised — it is the single element that is
*alive*, pulsing a soft signal glow, because the repo is a live database and a gate
is the one place the operator must act. Using it should feel like watching and
commanding a fleet, not signing a register.

## Mockups

- `inbox.html` — signal queue with the full kind vocabulary (G1 gate, ESC, CAP,
  bounced G2, PAUSE, malformed BAD, G0 gate) and a selected row carrying a live
  focus ring; sketches: inbox zero, loading (signal-sweep skeleton), error.
- `portfolio.html` — every-run × source instrument grid with a malformed-run row
  (unknown phase + BAD flag), a paused run (over-budget meter), needs/escalation
  signal badges, gate readouts; sketches: zero-runs (the new state), loading, error.
- `metrics.html` — gate table with approval meter (90% threshold tick +
  ⚠ over-triggering flag on G1), ordered burden-mix ramp + legend, review-rounds
  distribution, budget-honesty table incl. "⚠ never updated"; sketches:
  no-decisions, loading, error.
- `run-artifacts.html` — run head + gate readout, the live pulsing "needs you"
  SIGNAL panel with an OPEN approve flow (burden picker, option 2 selected +
  focused, notes), packet links, task board, artifact rail with validation marks,
  rendered spec.md; sketches: malformed run-state banner, bounced no-approval
  panel, committed / CAS-409 / error flashes, failing-contract artifact banner,
  empty, loading, error.
- `run-diff.html` — two-file evidence diff (modified + added) with add/del hunks,
  hunk headers, split gutters, per-file `+/−` stats; sketches: no-diff,
  run-is-merged, loading, error.
- `run-history.html` — instrument log with a signal spine, newest first; phase
  transitions light a spine node + a mono `→ phase` stamp; sketches: no-history,
  loading, error.

## Look-and-feel spec

**Type stack.** Two roles that differ in face, not just size (REC2), plus the
evidence role (REC6): *display/readout mono* `ui-monospace,'SF Mono',
SFMono-Regular,Menlo,Consolas,monospace` — the "readout" voice — for page titles,
run-slug headers, gate ids, section kickers, and tab labels; *working sans*
`-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif`
for body copy, decision prose, labels, hints, and empty-state ledes; *evidence
mono* (same mono family, distinct usage) for diff hunks, artifact bodies, file
paths, oids, and slugs. Ordinary numeric columns in tables use the **working sans
with `tabular-nums`**, not a mono swap — that keeps P2/REC6's two number jobs
distinct (see Research traceability).

**Scale.** 20/1 page/run titles (mono 600, +0.14em tracking, uppercase on page
titles); 15/1.3 decision title (sans 600); 13.5/1.3 inbox item title (sans 500);
14/1.6 body & artifact prose (sans); 13 table body (sans); 12/12px table numerals
(mono, `tabular-nums`); 12/20px diff code (mono); 11 age/id/ref (mono); 10.5
uppercase kickers & column heads (mono 600, +0.12–0.16em tracking).

**Color tokens** (all `light-dark()`, light / dark; dark is the native theme):
`--ground #eef2f5/#0a0e11` · `--surface #ffffff/#111820` · `--inset
#f3f6f8/#0d141a` · `--raised #e4ebef/#18222b` · `--ink #10202a/#dbe7ec` · `--muted
#4c5d67/#8ba1ac` · `--faint #8598a2/#566771` · `--line #d3dde3/#223039` · `--accent
(signal) #0b6f89/#45c8ec` · `--accent-deep #075365/#8adcf5` · `--accent-soft 12% /
14% alpha` · `--ok #157a4a/#4ec98d` · `--warn #8a6410/#e0b24e` · `--bad
#b23b28/#ff7f63` · `--on-solid #ffffff/#06121a` · `--glow accent @30% / @40%` (the
signal bloom). Burden ramp (sequential, lightness-monotonic, reuses the app's
validated hues): `--ramp-1 #cfe8e2/#2a5c52` → `--ramp-2 #3f9e8c/#4a9c8a` →
`--ramp-3 #0b6f61/#8fdccb`; unrecorded gray `#d9dedb/#3a423e` (not a ramp step).

**Spacing/density rule.** 2px signal grid; three named rhythms by reading purpose
(REC3): *scanning queue* (inbox) — comfortable 12px rows, 78ch detail cap;
*instrument grid* (portfolio, metrics, budget tables) — tight 8–10px cells at
12–13px; *evidence* (diff) — dense 20px mono lines, zero vertical cell padding.
Reading surfaces (decision prose, artifact body) cap measure at 76ch (P5).

**Motion policy** — *motion as functional signal* (the deliberate divergence from
sibling A's stillness). Three uses, all gated by `prefers-reduced-motion: reduce`
(which zeros them, matching the app's existing rule): (1) the pending-decision
SIGNAL panel and the inbox nav count carry a slow 2.4–2.8s ease-in-out glow pulse —
liveness marks the one thing needing action; (2) loading is a 1.5s linear
signal-sweep shimmer across skeleton rows; (3) hover/focus/selection transition
color+border over 140ms. Reduced-motion fallback: the panel keeps a static glow
ring, skeletons become static inset blocks, everything else snaps. No transform,
scale, or layout-shifting motion anywhere.

**Component shapes.** Radius 3–6px on panels, fully-round (999px) on signal chips,
buttons, and count/needs pills — a capsule/instrument language, deliberately unlike
A's square print. Stakes decide the wrapper (REC1): passive display tables and the
diff lie on a flat 1px-line panel, no glow; the pending-decision panel is the sole
*glowing* object — accent left-rail + outer `--glow` bloom + pulse (bad-rail, no
glow, no pulse when bounced). Signal chips: a leading luminous LED dot **plus**
glyph/text; routine gates outlined-accent, urgent kinds (ESC/CAP/BAD) solid-filled
+ heavier + larger, PAUSE solid-warn, bounced gates dashed + struck-through — size,
fill, and weight carry urgency, never hue alone (REC4). Gate cells: a segmented
readout strip — approved solid-ok `✓`, declined solid-bad `✕`, pending dashed with
the gate number. Buttons: capsule; primary solid-accent with a signal glow; danger
solid-bad; quiet 1px-line outline. Inputs: inset well, 1px line, 5px radius.

## Research traceability

Applied: **P1/REC4** — every status keeps a non-color signal: LED dot + glyph on
chips, glyph + fill + border-style on gate cells; urgency additionally shifts
size/fill/weight, never hue alone. **P2/REC6** — evidence (diff hunks, artifact
bodies, paths, oids, slugs) gets the full mono swap; ordinary numeric table columns
get `tabular-nums` on the working sans, keeping the two number jobs distinct.
**P3/REC3** — three named density rhythms (scanning queue / instrument grid /
evidence) replace the app's single app-wide scale; the portfolio/metrics grids run
tight, the diff runs dense, the inbox stays comfortable. **P4/REC2** — a mono
display/readout role against a sans working role — differs in face, not just
size/weight (A pairs serif+sans; B pairs mono+sans, so the two candidates are
distinguishable on this axis too). **P5** — measure caps extended past
`.prose-artifact` to decision prose (76ch), inbox detail (78ch), and metrics ledes
(74ch). **REC1** — wrapper treatment varies by stakes: flat line-panels for passive
tables and evidence, a glowing pulsing panel only for the pending decision.
**REC5** — the "8px radius, 1px neutral border, one card recipe" is eliminated;
panels vary in radius/rail/glow by stakes and chips go fully-round. Avoided
anti-patterns A1–A5 by these mechanisms.

Deviations: **none of REC1–REC6 is deviated from.** One judgment call worth naming:
REC2 asks for a heading role that differs from body in "more than size and weight" —
B satisfies it with a *mono* display face rather than a serif; mono is already
present in the app, so identity is achieved with zero new font payload and the
`file://` floor is met without any base64. The ux-research open question
(non-system typeface) is thus resolved by using the existing system stacks only;
no font self-hosting is required for this direction (contrast: A's serif also stays
in system stacks but risks x-height variance across OSes — B's mono display has the
same nominal risk but mono metrics are far more consistent across the SF
Mono/Menlo/Consolas fallbacks).

## Ergonomics notes

Focus: every interactive element takes the app's 2px accent `:focus-visible` ring
at 2px offset (shown live on the inbox selected row and the checked burden tile).
Focus order follows source order: rail nav (Inbox → Portfolio → Metrics) → page
head → decision panel (burden 1/2/3 → notes → Approve/Decline/Cancel) → task board
→ tabs → artifact rail → body. Keyboard model unchanged and printed where it lives
(`j/k move · ↵ open` in the inbox head; `a/x`, `1/2/3`, `esc` reachable in the
decide panel; `e` cycles artifacts).

Contrast (WCAG 2.1 AA, checked in both themes): ink ≥13:1; muted ≈6:1 light /
≈6.5:1 dark; accent-as-text ≈4.6:1 light on ground / ≈9:1 dark; on-solid over
accent/bad/ok ≥4.8:1; ok/warn/bad body ≥4.6:1; gate cells, chips, meters, LED dots
≥3:1 against their grounds (UI-component floor). The signal glow is decorative
only — never the sole carrier of state (the pulsing panel also has an accent rail,
a gate chip, and text). **Named gap:** `--faint` (≈3.2:1 light, ≈3.4:1 dark) misses
4.5:1 by design — it is restricted to duplicated metadata (diff gutter line
numbers, short oids beside titled log rows, the `source · ref` stamp) and never
carries sole meaning; promoting it to `--muted` would flatten the recede-hierarchy,
so it is deferred deliberately (same posture as sibling A's `--faint`).

States: all six screens sketch empty, loading, and error plus every R1 required
state — full inbox kind vocabulary + inbox-zero; malformed portfolio row +
zero-runs; metrics no-decisions; malformed run-state banner + open approve flow
with burden picker + bounced no-approval + task board + decide flashes
(committed/409/error); diff no-diff + merged; history no-history.

## Implementation notes

Fits the existing React 19 / Tailwind 4 / Vite stack as a token + class-recipe swap:
`styles.css` `@theme` gains the cool signal palette (`--glow`, ramp tokens) and the
mono-display role; `app.tsx` restyles the existing left rail as the console spine
(same three routes — no router change, no new endpoint); `chips.tsx`, `decide.tsx`,
`diff-view.tsx`, and the four pages restyle in place. All
`data-inbox-row`/`data-needs-card`/`data-decide`/`data-decide-panel` hooks, the
keyboard model, and `api.ts` shapes are untouched, so `smoke.spec.ts` holds; the
zero-runs portfolio branch is the one new render (spec R1/AC6.3).

Risks / ADR-worthy for the Architect: (1) **Motion is the signature** — the pulse
and sweep must be pure CSS keyframes (no JS timers) and must fully yield to
`prefers-reduced-motion`; a11y sign-off should confirm the reduced-motion fallback
still distinguishes the pending decision (it does, via rail + glow-ring + chip).
(2) **Glow via `box-shadow`** on the decision panel and LED dots — cheap, but on the
bright light theme the bloom is subtle; the accent rail + chip carry the signal so
glow can be tuned down without losing meaning. (3) The `--glow` and ramp tokens use
`light-dark()`/rgba, which need plain CSS custom properties in `styles.css` rather
than Tailwind utility classes (same constraint A flagged). (4) No custom font is
required, so unlike a serif/custom-display direction there is **no font
self-hosting cost** — if a future brand wants a bespoke mono display face, that
becomes an ADR (base64 `@font-face` in mockups, self-hosted woff2 in the build, no
CDN per the R4 floor); not needed for this candidate.
