# Technical Plan: FleetView look-and-feel rebuild — candidate B ("Signal Deck")

<!-- Produced by Architect for G1. v2 — redone after the G1 decline of 2026-07-15:
     the gate owner selected candidate B over the v1 plan's candidate A ("Your
     overall task division is OK, but I do not want candidate A. I select
     candidate B."). Task topology is retained; every ADR is re-derived for B.
     Consumed by Implementers, Reviewer. Spec: runs/fleetview-design/spec.md.
     Tasks: runs/fleetview-design/tasks/. -->

## Approach

The design phase delivered its floor: `ux-research.md` and three complete candidates
(`design/candidate-{a,b,c}/`, six mockups each). What remains is (1) a mechanical
evidence audit so the G1 human can check R2–R4 without re-reading everything, and
(2) the build of **candidate B — "Signal Deck"** (ADR-1; selection of record from
the 2026-07-15 gate decline) against R5/R6.

The build is a token-and-class-recipe swap inside `frontend/packages/web` only:
`styles.css` carries the new token contract, and the shell, three shared components,
and four pages restyle in place. No route, endpoint, component signature, keyboard
binding, or `api.ts` shape changes — that freeze is what makes AC5.1–AC5.4 hold by
construction and lets eight restyle tasks run in parallel on disjoint files. The one
behavioral addition anywhere is the portfolio zero-runs render branch (R1, AC6.3).
B adds one surface A did not have: a **motion signature** (a 2.4–2.8s glow pulse on
the pending-decision panel and the inbox count; a 1.5s signal-sweep loading shimmer)
that must fully yield to `prefers-reduced-motion`. That surface is contained by
construction: every `@keyframes` and motion class lives in `styles.css` (task 02,
ADR-6), consumers apply the named classes only, and task 11 carries an explicit
reduced-motion verification step. B is also dark-native: `light-dark()` order and
the OS-driven theme mechanism are unchanged, but dark is the identity theme — the
AC6.1 fidelity comparison runs primarily in dark, with light checked for contrast
and glow visibility (Risk 5).

The task topology is candidate-invariant and is retained from the v1 plan: the same
nine files change, the same dependency graph holds. Task ids keep their v1 slugs
(`02-ledger-foundations`, `03-shell-masthead`) so `depends_on` references and run
history stay stable across the redo; titles and scopes are candidate B's. Where B's
`design-candidate.md` prose and its mockups disagree (e.g. table numerals "working
sans" in prose vs `font-family: var(--mono)` in every mockup), **the mockups win** —
AC6.1 compares built screens against the mockups, not the prose.

Runtime, probed in this checkout: `frontend/` is an npm workspace requiring Node ≥ 24
(`frontend/package.json` engines; the e2e server runs TypeScript source directly, so
this is a hard floor, not advisory). Verification commands run from `frontend/`:
`npm test` (vitest 3), `npm run typecheck` (tsc 5.8, two projects), `npx playwright
test` (playwright 1.61, config `frontend/playwright.config.ts`, suite manages its own
fixture server on port 4399). **`frontend/node_modules` does not exist in this
checkout** — `npm install` and `npx playwright install chromium` are prerequisites
for any verification and need network access (Risk 1). Every CSS mechanism B needs
is already proven here: Tailwind 4 `@theme` + `light-dark()` (`styles.css:5-24`),
inline `light-dark()` strings (`metrics.tsx:12-17`), and a `prefers-reduced-motion`
media block (`styles.css:41-46`); `@keyframes` and layered `box-shadow` are plain
CSS. One gap task 02 owns: the current reduced-motion block only *shortens*
durations — B requires `animation: none` plus base styles that stay meaningful when
static (C1 motion primitives).

## Interface contracts

### C1 — Token contract (produced by task 02; consumed by 03–11)

Tailwind `@theme` tokens in `frontend/packages/web/src/styles.css`, all
`light-dark(light, dark)`. Existing token *names* are kept (so class references in
not-yet-restyled files keep compiling mid-parallel); values change to candidate B's;
new names are marked ●. Dark is the native theme.

| Token | Light | Dark |
|---|---|---|
| `--color-ground` | `#eef2f5` | `#0a0e11` |
| `--color-surface` | `#ffffff` | `#111820` |
| ● `--color-inset` | `#f3f6f8` | `#0d141a` |
| `--color-raised` | `#e4ebef` | `#18222b` |
| `--color-ink` | `#10202a` | `#dbe7ec` |
| `--color-muted` | `#4c5d67` | `#8ba1ac` |
| `--color-faint` | `#8598a2` | `#566771` |
| `--color-line` | `#d3dde3` | `#223039` |
| `--color-accent` | `#0b6f89` | `#45c8ec` |
| ● `--color-accent-deep` | `#075365` | `#8adcf5` |
| `--color-ok` | `#157a4a` | `#4ec98d` |
| `--color-warn` | `#8a6410` | `#e0b24e` |
| `--color-bad` | `#b23b28` | `#ff7f63` |
| ● `--color-on-solid` | `#ffffff` | `#06121a` |
| `--color-accent-soft` (wash) | `rgba(11,111,137,.12)` | `rgba(69,200,236,.14)` |
| `--color-ok-soft` (wash) | `rgba(21,122,74,.13)` | `rgba(78,201,141,.15)` |
| `--color-warn-soft` (wash) | `rgba(138,100,16,.13)` | `rgba(224,178,78,.15)` |
| `--color-bad-soft` (wash) | `rgba(178,59,40,.12)` | `rgba(255,127,99,.16)` |

Fonts: **unchanged** — `--font-sans` and `--font-mono` keep their current stacks.
B's display/readout voice is the existing `--font-mono` stack plus per-recipe
size/weight/tracking/uppercase (ADR-2); there is no `--font-display` token and no
`--color-rule` (both were candidate-A constructs).

Plain `:root` custom properties (values consumed inside shadows/gradients, not as
per-utility colors), same file:

```
--glow: light-dark(rgba(11,111,137,.30), rgba(69,200,236,.40));
--ramp-1: light-dark(#cfe8e2, #2a5c52);
--ramp-2: light-dark(#3f9e8c, #4a9c8a);
--ramp-3: light-dark(#0b6f61, #8fdccb);
--unrecorded: light-dark(#d9dedb, #3a423e);
```

(`run-artifacts.html` uses a `.44` dark alpha for the panel bloom vs `.40`
elsewhere; one token at `.40` is the contract — glow intensity is tuned only by
editing this token, never per-surface. Risk 5.)

**Motion primitives** (the only animation definitions allowed anywhere in the app;
task 02 writes them, everyone else applies the class names):

```
@keyframes pulse      { 0%,100% { box-shadow: 0 0 6px var(--glow) }
                        50%     { box-shadow: 0 0 15px var(--glow), 0 0 4px var(--glow) } }
@keyframes pulsepanel { 0%,100% { box-shadow: 0 0 0 1px var(--color-accent-soft), 0 0 14px var(--glow) }
                        50%     { box-shadow: 0 0 0 1px var(--color-accent-soft), 0 0 28px var(--glow) } }
@keyframes sweep      { 0%   { background-position: 180% 0 }
                        100% { background-position: -80% 0 } }

.pulse-glow  { animation: pulse 2.4s ease-in-out infinite }
.pulse-panel { box-shadow: 0 0 0 1px var(--color-accent-soft), 0 0 18px var(--glow);
               animation: pulsepanel 2.8s ease-in-out infinite }
.skel        { border-radius: 4px;
               background: linear-gradient(100deg, var(--color-inset) 30%,
                 var(--color-raised) 50%, var(--color-inset) 70%);
               background-size: 220% 100%;
               animation: sweep 1.5s linear infinite }
```

Reduced-motion contract: the media block becomes `animation: none !important` (plus
the existing near-zero `transition-duration`), and the base styles above are
designed to stay meaningful when static — `.pulse-panel` keeps its static glow
ring, `.skel` reads as a static inset block. State is never carried by animation
alone (the pending panel also has an accent rail, border, and gate chip).

Consumers use only names from this section (as Tailwind utilities `bg-ground`,
`bg-inset`, `text-on-solid`, … or `var(--…)`, or the three motion classes). A task
needing a token, keyframe, or motion class not listed here escalates rather than
editing `styles.css` (surface collision).

### C2 — Recipe contract (candidate B's grammar; mockups are the authority)

The per-task mockup file named in each task is the fidelity baseline (AC6.1). Shared
recipes, so eight parallel implementers converge:

- **Shape grammar**: capsule/instrument, not print — panels 3–6px radius; signal
  chips, buttons, and count/needs pills fully round (`rounded-full`); nav rows,
  age chips, packet tags, inputs 4–5px. Nothing square-by-doctrine, nothing
  `rounded-lg` (REC5: the one-card recipe dies by *variation*, not by radius 0).
- **Console spine (shell)**: the existing left rail restyled, not replaced (ADR-4) —
  surface bg, 1px line right border; brand as mono 600 uppercase-tracked wordmark +
  faint tagline; nav rows with a 6px LED dot (active: accent + glow shadow, row gets
  accent wash + accent text); inbox count as a fully-round solid-accent mono pill
  carrying `.pulse-glow` (one of the two sanctioned pulses); mono faint motto at the
  rail foot.
- **Page/section heads**: h1 mono 600 20px uppercase +0.14em tracking, closed by a
  1px `--color-line` bottom border (run slugs: mono 20px, lighter tracking, no
  uppercase); section h2 mono 600 13px uppercase tracked + sans muted lede capped
  ~74ch; kickers/column heads mono 600 10–10.5px uppercase +0.12–0.16em.
- **Instrument panel** (passive tables, queue, artifact body, diff files): flat 1px
  `--color-line` border on `--color-surface`, 5–6px radius, no glow, no shadow;
  table heads on `--color-inset`; row hover `--color-raised`. (B boxes its passive
  surfaces on flat panels — unlike A's unboxed rules.)
- **Signal panel** (the pending decision — the page's only live object): 1px accent
  border + 3px accent left rail, 6px radius, surface bg, `.pulse-panel` (static glow
  ring + 2.8s pulse). Bounced/not-reviewable: bad border + bad rail, **no glow, no
  pulse** (no motion class).
- **Signal chips** (KindChip family): fully-round capsule, mono 600 11px, leading
  6px LED dot (`currentColor` + static `0 0 6px currentColor` glow) **plus**
  glyph/text; routine gate = accent outline + accent wash; ESC/CAP/BAD = solid bad +
  `--color-on-solid`, PAUSE = solid warn — urgent chips heavier (700) and larger
  padding, LED glow suppressed on solid fills; bounced gate = dashed bad border +
  bad wash + line-through. Size, fill, and weight carry urgency, never hue alone
  (REC4).
- **Gate cells**: a segmented readout strip — ~30×22 cells, 3px radius, 3px gaps,
  mono 11px with a tiny faint gate numeral; approved = ok border/text on ok wash +
  ✓; declined = bad + ✕; pending = dashed line border, faint, `·`.
- **Age**: inset chip — mono tabular 11px on `--color-inset`, 1px line border, 4px
  radius; urgent = bad text/border + 700. (Not a pill — that was A.)
- **Phase**: borderless LED readout — 7px dot with static `currentColor` glow +
  sans 12px text; existing tone mapping keeps (accent spec/plan/release, warn
  implement/integrate, ok done, bad paused/unknown).
- **Buttons**: capsule (`rounded-full`); primary = solid accent + on-solid text +
  static `0 0 12px var(--glow)`; danger = solid bad, no glow; quiet = inset bg, 1px
  line border, muted text, hover accent border. Inputs/textarea: inset well, 1px
  line border, 5px radius.
- **Tabs**: mono 600 12px uppercase tracked buttons, 2px accent bottom border on
  the active tab.
- **Meters**: 3–4px-radius tracks on inset with 1px line border; accent fill with
  static glow; over-limit = bad (portfolio) / warn (metrics approval) fill without
  glow; unmetered/zero = faint fill.
- **Type roles**: mono readout voice for page titles, slugs, gate ids, kickers,
  column heads, tabs, key hints, ages, oids, refs, and table numerals
  (`tabular-nums`, 12px); sans working voice for body, item titles, decision prose,
  labels, hints, empty-state ledes; evidence mono for diff hunks, artifact code,
  paths.
- **Density rhythms** (REC3): scanning queue (inbox ~12px row padding, 78ch detail
  cap) · instrument grid (portfolio/metrics tables 8–10px cells at 12–13px) ·
  evidence (diff 12px/20px mono, zero vertical line padding). Reading measures:
  decision prose/artifact body 76ch.
- **Empty states**: centered — decorative mono accent glyph (per mockup: `— ·· —`,
  `[ ]`, `0 / 0`), sans 600 ~15px lede, muted 12px sub; no dashed box.
- **Loading**: the signal-sweep skeleton — 2–3 `.skel` blocks shaped per that
  screen's mockup, rendered by the page's own `isLoading` branch, with the existing
  loading text preserved verbatim beneath (via `PageStatus`). `PageStatus` itself
  stays a static centered status line (it also serves empty/error states, which
  never show skeletons).
- **Motion**: exactly three uses — `.pulse-panel` on the pending decision panel,
  `.pulse-glow` on the inbox nav count, `.skel` on loading skeletons — plus 140ms
  color/border transitions on hover/focus/selection. No transform, scale, entrance,
  or layout-shifting motion anywhere; no `animation`/`@keyframes` outside
  `styles.css`.

### C3 — Freeze contract (binding on every task; this is what keeps AC5.x/AC6.x true)

- **Files never touched**: everything outside `frontend/packages/web/`; and within
  it: `src/api.ts`, `src/main.tsx`, `src/use-keys.ts`, `src/use-live.ts`,
  `src/components/markdown.tsx`, `index.html`, `package.json`, `tsconfig.json`,
  `vite.config.ts`, `../../e2e/smoke.spec.ts`.
- **Exported signatures frozen** (restyle bodies only): `App`; `PhaseChip`,
  `KindChip`, `AgeBadge`, `GateCell`, `GateLedger`, `ValidationBadge`, `BudgetMeter`
  (chips.tsx); `DecidePanel` (decide.tsx); `DiffView` (diff-view.tsx); `InboxPage`,
  `PageStatus`, `itemHref` (inbox.tsx); `PortfolioPage`, `MetricsPage`, `RunPage`.
  `PageStatus` is owned by task 06 and consumed unmodified by 07–09. Note:
  `KindChip` already receives the whole `InboxItem`, so B's bounced-chip treatment
  reads `item.reviewable` without any signature change.
- **Render-only additions allowed**: the portfolio zero-runs branch (R1/AC6.3) and
  skeleton markup inside existing `isLoading` branches. No other conditional logic
  changes.
- **DOM hooks preserved**: `data-inbox-row`, `data-needs-card`, `data-decide-panel`,
  `data-decide="approve|decline|resolve|resume|approve-confirm|decline-confirm|resolve-confirm"`,
  `role="status"` on the decide flash, `aria-current` on the selected inbox row,
  `document.body.dataset.deciding`, a `<table>` element on portfolio.
- **User-visible strings preserved verbatim** (smoke.spec.ts and README assert on
  them): the inbox bounce line "Bounced — packet fails its contract; no approval
  offered." (`inbox.tsx:41`), the decide bounce copy containing "no approval is
  offered" (`decide.tsx:110`, asserted at `smoke.spec.ts:52`), burden labels
  "Confirmation" / "Light correction" / "Heavy correction", placeholder prefix
  "Notes (optional)", flash text `committed <oid>`, headings "Gate decisions" and
  "Budget honesty", every `PageStatus` message. CSS `text-transform` is allowed
  (doesn't change DOM text); editing the strings is not.
- **Keyboard model unchanged**: `j/k/↵` (inbox), `a/x/1/2/3/esc`, `e` (run page),
  `esc` to inbox — all handler wiring stays as-is.

### C4 — Verification environment (all tasks)

From `frontend/`, Node ≥ 24: one-time `npm install && npx playwright install
chromium`; then `npm test`, `npm run typecheck`, `npx playwright test`.

## Decisions (ADRs)

### ADR-1: Build candidate B — "Signal Deck" (selection of record; single candidate, no hybrid)
- **Choice:** implement candidate B exactly as specified in
  `design/candidate-b/design-candidate.md`, with its six mockups as the AC6.1
  fidelity baseline. This records the G1 gate owner's 2026-07-15 selection ("I
  select candidate B"), which supersedes the v1 plan's ADR-1 choice of A.
- **Rejected:** *candidate A ("The Ledger")* — the v1 plan's pick, on
  minimize-review-surface grounds (zero animation, light-native). Declined at the
  gate; selection authority is the human's, and B's costs are ownable rather than
  avoidable: the motion surface is contained to one file with an explicit
  reduced-motion contract (ADR-6, task 11 check), and the light-theme glow
  subtlety is bounded because glow never carries sole meaning (Risk 5).
  *Candidate C ("Wayfinder")* — its display face falls back to plain sans on Linux,
  silently reintroducing the "no typographic identity" slop trait (A3) on one OS,
  and its fixed-color band/sticky-header caveats add edge cases B doesn't have.
  *A hybrid* — AC6.1 requires per-screen comparison against "the G1-selected
  candidate's mockups"; a synthesis has no mockup baseline, and the distinct-thesis
  discipline (AC3.2) dies in the mix.
- **Consequences:** approving this plan at G1 selects B. The plan owns B's
  differing factors explicitly: dark-native fidelity review, mono display voice
  (ADR-2), rail-spine shell (ADR-4), capsule shape grammar (C2), and the motion /
  reduced-motion surface (ADR-6, Risks 4–5). A further override at the gate would
  amend ADR-1, C1, C2, and each task's mockup references; topology stands.

### ADR-2: Display voice from the existing system mono stack; no webfont, no new font token
- **Choice:** B's display/readout identity is the already-shipped `--font-mono`
  stack (`ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace`)
  differentiated by weight, size, tracking, and uppercase per C2. No font files, no
  new `@theme` font token. Resolves the ux-research open question (non-system
  typeface) at zero payload.
- **Rejected:** bundling a bespoke display mono (OFL woff2, self-hosted, no CDN) —
  pixel-consistent branding, but adds an asset pipeline, license bookkeeping, and
  diff surface AC5.4 prizes avoiding, and the candidate itself specifies system
  stacks. Also rejected: a `--font-display` alias token pointing at the mono stack —
  an indirection with no second binding; `font-mono` utilities already exist
  everywhere the display voice is needed.
- **Consequences:** display metrics vary slightly per OS (SF Mono/Menlo on macOS,
  Consolas on Windows, `ui-monospace`/fallback mono on Linux) — materially less
  variance than A's serif spread, and mono never falls back to sans, so the
  identity survives on every OS. The AC6.1 fidelity review still compares on one
  named OS. A future branding pass may revisit with its own ADR.

### ADR-3: Tokens and all motion CSS extend `styles.css`; no new shared token module
- **Choice:** all of C1 lives in `frontend/packages/web/src/styles.css` —
  utility-generating values in `@theme`, glow/ramp values as plain `:root` custom
  properties, the three keyframes and three motion classes in the same file.
  Existing token names keep their names with new values; the burden ramp moves from
  inline `light-dark()` strings in `metrics.tsx` to the `--ramp-*`/`--unrecorded`
  properties (B's naming, matching its mockups).
- **Rejected:** the "single clearly named new shared token module" AC5.4 permits —
  it exists for a candidate that needs cross-package tokens; B doesn't (web is the
  only consumer), and a new module adds workspace wiring for zero benefit. Also
  rejected: keeping per-component inline `light-dark()` strings (the status quo for
  the ramp) — scatters the theme across files and defeats the one-place token audit.
- **Consequences:** task 02 is the single writer of `styles.css`; every other task
  consumes C1 read-only, which is what makes the parallel split safe.

### ADR-4: The left rail stays and becomes the console spine; no masthead, router untouched
- **Choice:** restyle the existing `app.tsx` shell in place — sticky left rail on
  desktop, top bar on mobile, same `NavLink` structure, same inbox-count query —
  into B's console spine (C2). This re-derives the v1 plan's shell ADR: A's spatial
  thesis required replacing the rail with a masthead; B's does not — every
  candidate-b mockup shows the 200px left rail, and B's implementation notes name
  "restyling the existing left rail as the console spine" explicitly.
- **Rejected:** converting to a masthead anyway (reusing the v1 shell design) —
  it would contradict all six fidelity baselines (AC6.1), cost responsive rework
  (desktop/mobile convergence) the candidate doesn't ask for, and buy nothing: B's
  spatial identity lives in the rail-as-instrument treatment, panels, and density,
  not in a shell relayout.
- **Consequences:** `app.tsx` is one task's whole surface and the shell diff is
  small; the desktop/mobile split stays as-is. Layout containers on pages
  (`max-w-*` wrappers) stay page-local.

### ADR-5: Restyle-in-place; no component extraction or file moves
- **Choice:** keep the existing file/module structure and idioms (Tailwind utility
  classes in JSX, co-located helpers like `PageStatus` in `inbox.tsx`); express the
  redesign as class-recipe changes plus the C2 recipes. Re-checked against B: chips,
  panels, meters, tabs, and the signal panel are all expressible as class strings
  plus the C1 motion classes — nothing in B forces extraction.
- **Rejected:** extracting a `components/signal.tsx` recipe library or moving
  `PageStatus` to its own file — cleaner in the abstract, but it's a refactor the
  feature doesn't need, it breaks the disjoint-surface parallelization (every task
  would contact the new file), and the codebase's idiom is co-location.
- **Consequences:** some recipe repetition across files, accepted; task 11's
  coherence pass and the C2 contract bound the drift.

### ADR-6: Motion is centralized — three keyframes, three classes, one reduced-motion rule, all in `styles.css`
- **Choice:** the entire motion signature is defined once (C1 motion primitives) and
  consumed as class names (`.pulse-panel` in run.tsx, `.pulse-glow` in app.tsx,
  `.skel` in loading branches). The reduced-motion block upgrades from
  duration-shortening to `animation: none !important`, and every animated element's
  base style must stay meaningful when static (panel keeps rail + border + static
  glow ring; skeletons become static inset blocks; the count pill stays a solid
  accent pill). Pure CSS — no JS timers (per the candidate's own constraint).
- **Rejected:** per-file animation via Tailwind arbitrary values or component-local
  `@keyframes` — scatters the run's one new a11y-review surface across nine files,
  invites drift in period/easing, and makes the reduced-motion guarantee unverifiable
  by inspection. Rejected: keeping the existing `0.01ms` duration trick for
  animations — an infinite animation at 0.01ms is still a running animation (and a
  first-frame flicker), not the candidate's specified static fallback.
- **Consequences:** "no `animation`/`@keyframes` outside `styles.css`" is a
  greppable acceptance check on every restyle task; task 11 verifies the
  reduced-motion behavior end-to-end (emulated) and that the pending decision stays
  visually distinguished without motion. Glow intensity tunes only via the `--glow`
  token.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01 (inventory audit); 06, 07, 08, 09, 10 (the six screens as built; run-artifacts + run-history in 09) |
| R2 | 01 |
| R3 | 01 |
| R4 | 01 |
| R5 | 02 (tokens + motion/reduced-motion floor), 03, 04, 05, 06, 07, 08, 09, 10 (freeze contract per task), 11 (full floor: AC5.1–AC5.4 + reduced-motion check) |
| R6 | 02 (AC6.2), 07 (AC6.3 zero-runs branch), 09 (AC6.4 malformed/bounce rendering), 11 (AC6.1 fidelity evidence, AC6.4 manual 409 check) |

## Risks

1. **Unprovisioned verification environment.** No `frontend/node_modules` in this
   checkout; `npm install` + `npx playwright install chromium` need network. Early
   signal: the first implementer's `npm run typecheck` fails to resolve packages. If
   the execution sandbox has no network, all AC5.x verification blocks → escalate at
   that moment, don't ship unverified.
2. **Parallel recipe drift.** Eight implementers applying C2 independently may
   diverge on radii/paddings/LED sizes/tracking. Early signal: reviewer sees two
   different chip or panel treatments. Mitigation: C2 + per-task mockup as authority
   + task 11 coherence pass (the only task allowed to touch any web source file).
3. **e2e string coupling.** `smoke.spec.ts` asserts on visible copy and hooks (C3
   list). Early signal: `npx playwright test` fails on a restyle-only task —
   treat as a C3 violation in that task, never as a reason to touch the spec file.
4. **Motion / reduced-motion regression** (owned — B's signature, not a rejected
   cost). Failure modes: a pulse or sweep implemented outside the C1 primitives, or
   a fallback that loses the pending-decision emphasis. Mitigation: ADR-6
   centralization; per-task grep check (`animation`/`@keyframes` absent outside
   `styles.css`); task 11's explicit check that with `prefers-reduced-motion:
   reduce` emulated nothing animates and the signal panel still reads as the page's
   one live object (rail + ring + chip). Early signal: a grep hit in any page diff,
   or DevTools emulation shows movement.
5. **Glow subtlety on the light theme** (owned; B's own doc concedes the bloom is
   subtle on the bright-lab variant). Meaning never rides on glow alone (C1
   reduced-motion contract already forces non-glow carriers). Dark is the primary
   fidelity theme; task 11 checks light explicitly. If the pending panel doesn't
   separate at a glance in light, tune the `--glow` light alpha upward — one token,
   never per-surface shadows. Early signal: the light-theme pass in task 11's
   fidelity review.
6. **`light-dark()` placement.** Washes, `--glow`, and `--ramp-*` values must stay
   in `styles.css` custom properties (Tailwind arbitrary-value utilities choke on
   nested `light-dark()`/rgba). Proven pattern exists (`metrics.tsx` inline styles,
   existing `@theme` washes); early signal: a build error or a wash/glow that
   doesn't flip with the OS theme.
7. **Mono display metric variance** (accepted, ADR-2; smaller than A's serif risk).
   Early signal: fidelity review run on a non-macOS box disputes match; reviewer
   pins the comparison OS instead.
