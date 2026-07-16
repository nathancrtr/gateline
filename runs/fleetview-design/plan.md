# Technical Plan: FleetView look-and-feel rebuild — candidate A ("The Ledger")

<!-- Produced by Architect for G1. Consumed by Implementers, Reviewer.
     Spec: runs/fleetview-design/spec.md. Tasks: runs/fleetview-design/tasks/. -->

## Approach

The design phase delivered its floor: `ux-research.md` and three complete candidates
(`design/candidate-{a,b,c}/`, six mockups each). What remains is (1) a mechanical
evidence audit so the G1 human can check R2–R4 without re-reading everything, and
(2) the build of the winning candidate against R5/R6.

ADR-1 selects **candidate A — "The Ledger"** (the G1 human may override; see ADR-1
consequences). The build is a token-and-class-recipe swap inside
`frontend/packages/web` only: `styles.css` carries the new token contract, and the
shell, three shared components, and four pages restyle in place. No route, endpoint,
component signature, keyboard binding, or `api.ts` shape changes — that freeze is
what makes AC5.1–AC5.4 hold by construction and lets eight restyle tasks run in
parallel on disjoint files. The one behavioral addition anywhere is the portfolio
zero-runs render branch (R1, AC6.3).

The task topology is candidate-invariant: the same nine files change whichever
candidate wins, so a G1 override swaps only ADR-1, the token table, and each task's
mockup reference — not the task structure.

Runtime, probed in this checkout: `frontend/` is an npm workspace requiring Node ≥ 24
(`frontend/package.json` engines; the e2e server runs TypeScript source directly, so
this is a hard floor, not advisory). Verification commands run from `frontend/`:
`npm test` (vitest 3), `npm run typecheck` (tsc 5.8, two projects), `npx playwright
test` (playwright 1.61, config `frontend/playwright.config.ts`, suite manages its own
fixture server on port 4399). **`frontend/node_modules` does not exist in this
checkout** — `npm install` and `npx playwright install chromium` are prerequisites
for any verification and need network access (Risk 1). The Tailwind 4 `@theme` +
`light-dark()` token mechanism and inline-style `light-dark()` strings are both
already proven in this codebase (`styles.css:5-24`, `metrics.tsx:12-17`), so
candidate A's tokens introduce no unverified CSS mechanism.

## Interface contracts

### C1 — Token contract (produced by task 02; consumed by 03–11)

Tailwind `@theme` tokens in `frontend/packages/web/src/styles.css`, all
`light-dark(light, dark)`. Existing token *names* are kept (so class references in
not-yet-restyled files keep compiling mid-parallel); values change to candidate A's;
new names are marked ●.

| Token | Light | Dark |
|---|---|---|
| `--color-ground` | `#f6f3ea` | `#16140f` |
| `--color-surface` | `#fdfbf4` | `#1d1a14` |
| `--color-raised` | `#ece7d8` | `#262218` |
| `--color-ink` | `#211e16` | `#eae4d4` |
| `--color-muted` | `#575145` | `#a89f8a` |
| `--color-faint` | `#837c6a` | `#746c5a` |
| `--color-line` | `#ded7c4` | `#38321f` |
| ● `--color-rule` | `#211e16` | `#eae4d4` |
| `--color-accent` | `#1e4f8f` | `#92b4e3` |
| ● `--color-accent-deep` | `#153a6b` | `#6f97c9` |
| `--color-ok` | `#2f6b40` | `#86c28f` |
| `--color-warn` | `#8a5d0f` | `#d3a94e` |
| `--color-bad` | `#a03123` | `#e2836a` |
| ● `--color-on-solid` | `#fdfbf4` | `#16140f` |
| `--color-accent-soft` (wash) | `rgba(30,79,143,.07)` | `rgba(146,180,227,.10)` |
| `--color-ok-soft` (wash) | `rgba(47,107,64,.10)` | `rgba(134,194,143,.13)` |
| `--color-warn-soft` (wash) | `rgba(138,93,15,.10)` | `rgba(211,169,78,.14)` |
| `--color-bad-soft` (wash) | `rgba(160,49,35,.08)` | `rgba(226,131,106,.12)` |

Fonts: ● `--font-display: 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,
'Times New Roman',serif`; `--font-sans` and `--font-mono` unchanged.

Plain `:root` custom properties (values that can't be per-utility `light-dark()`),
same file:

```
--shadow-plate: 4px 4px 0 light-dark(rgba(33,30,22,.16), rgba(0,0,0,.55));
--burden-ramp-1: light-dark(#cfdcee, #33517c);
--burden-ramp-2: light-dark(#6f94c4, #6d94c6);
--burden-ramp-3: light-dark(#1e4f8f, #b3cbea);
--burden-unrecorded: light-dark(#d9d3c2, #3d3828);
```

Consumers use only names from this table (as Tailwind utilities `bg-ground`,
`font-display`, … or `var(--…)`). A task needing a token not listed here escalates
rather than editing `styles.css` (surface collision).

### C2 — Recipe contract (candidate A's grammar; mockups are the authority)

The per-task mockup file named in each task is the fidelity baseline (AC6.1). Shared
recipes, so eight parallel implementers converge:

- **Radius 0 everywhere** except exactly two `rounded-full` pills: `AgeBadge` and the
  nav count badge. No `rounded-lg`/`rounded-md` survives (REC5).
- **Section head**: 2px `--color-rule` top border + 10.5px uppercase tracked kicker
  (sans 600) + optional italic `font-display` gloss. Passive tables are **unboxed**:
  rule opens them, 1px `--color-line` hairlines divide rows, ground shows through.
- **Evidence plate**: 1px `--color-line` border on `--color-surface` (diff files,
  artifact body).
- **Decision plate** (the only raised object on any page): `--color-surface`, 1px
  line border, 3px left accent spine (`--color-bad` spine when bounced),
  `box-shadow: var(--shadow-plate)`.
- **Stamps** (KindChip family): square, mono 700 ~10.5px; routine gate = 1px accent
  outline + accent wash; bounced gate = 1px dashed bad + line-through; ESC/CAP/BAD =
  solid bad + `--color-on-solid`, PAUSE = solid warn — urgent stamps are larger and
  heavier, never hue-only (REC4).
- **Gate cells**: square ~36×22, mono; approved = solid ok border + ✓, declined =
  bad border + ✕, pending = dashed line border + gate number.
- **Buttons**: square; primary = solid accent with 3px `--color-accent-deep` bottom
  border (letterpress); danger = solid bad; quiet = 1px line outline. Inputs: square,
  1px line border on ground.
- **Type roles**: `font-display` for page/item/decision titles and empty-state ledes;
  sans for body/labels/controls; mono for slugs, paths, ids, ages, diffs, and table
  numerals (`tabular-nums`). Run slugs stay mono at display size.
- **Density rhythms** (REC3): reading (inbox rows ~14px padding, 68ch detail caps) ·
  scanning ledgers (8–10px rows at 12.5px) · evidence (12px/20px mono, zero vertical
  line padding).
- **Motion**: no `@keyframes`, no transform/scale/entrance anywhere. Only
  color/border/opacity transitions at 120ms ease-out. Loading states are static text.

### C3 — Freeze contract (binding on every task; this is what keeps AC5.x/AC6.x true)

- **Files never touched**: everything outside `frontend/packages/web/`; and within
  it: `src/api.ts`, `src/main.tsx`, `src/use-keys.ts`, `src/use-live.ts`,
  `src/components/markdown.tsx`, `index.html`, `package.json`, `tsconfig.json`,
  `vite.config.ts`, `../../e2e/smoke.spec.ts`.
- **Exported signatures frozen** (restyle bodies only): `App`; `PhaseChip`,
  `KindChip`, `AgeBadge`, `GateCell`, `GateLedger`, `ValidationBadge`, `BudgetMeter`
  (chips.tsx); `DecidePanel` (decide.tsx); `DiffView` (diff-view.tsx); `InboxPage`,
  `PageStatus`, `itemHref` (inbox.tsx); `PortfolioPage`, `MetricsPage`, `RunPage`.
  `PageStatus` is owned by task 06 and consumed unmodified by 07–09.
- **DOM hooks preserved**: `data-inbox-row`, `data-needs-card`, `data-decide-panel`,
  `data-decide="approve|decline|resolve|resume|approve-confirm|decline-confirm|resolve-confirm"`,
  `role="status"` on the decide flash, `aria-current` on the selected inbox row,
  `document.body.dataset.deciding`, a `<table>` element on portfolio.
- **User-visible strings preserved verbatim** (smoke.spec.ts and README assert on
  them): "Bounced — packet fails its contract; no approval is offered." (inbox), the
  decide idle bounce copy containing "no approval is offered", burden labels
  "Confirmation" / "Light correction" / "Heavy correction", placeholder prefix
  "Notes (optional)", flash text `committed <oid>`, headings "Gate decisions" and
  "Budget honesty". CSS `text-transform` is allowed (doesn't change DOM text);
  editing the strings is not.
- **Keyboard model unchanged**: `j/k/↵` (inbox), `a/x/1/2/3/esc`, `e` (run page),
  `esc` to inbox — all handler wiring stays as-is.

### C4 — Verification environment (all tasks)

From `frontend/`, Node ≥ 24: one-time `npm install && npx playwright install
chromium`; then `npm test`, `npm run typecheck`, `npx playwright test`.

## Decisions (ADRs)

### ADR-1: Build candidate A — "The Ledger" (single candidate, no hybrid)
- **Choice:** implement candidate A exactly as specified in
  `design/candidate-a/design-candidate.md`, with its six mockups as the AC6.1
  fidelity baseline.
- **Rejected:** *candidate B ("Signal Deck")* — the strongest alternative; its
  signature is motion (pulse/sweep/glow), which adds a reduced-motion fallback
  surface to review, needs per-theme glow tuning (its own doc concedes the bloom is
  subtle on light), and flips the app dark-native. A carries identity with zero
  animation, so the existing global reduced-motion rule and contrast checks stay
  trivial. *Candidate C ("Wayfinder")* — its display face falls back to plain sans on
  Linux, silently reintroducing the "no typographic identity" slop trait (A3) on one
  OS, and its fixed-color band/sticky-header caveats add edge cases A doesn't have.
  *A hybrid* — AC6.1 requires per-screen comparison against "the G1-selected
  candidate's mockups"; a synthesis has no mockup baseline, making fidelity review
  subjective, and the intent brief's distinct-thesis discipline (AC3.2) dies in the
  mix. A is also the best conceptual fit: a ledger of record matches the product's
  own voice (gate ledger, budget honesty, "the repo is the database").
- **Consequences:** approving this plan at G1 selects A. If the founder overrides
  with B or C (their right per the intent brief), this becomes a plan amendment:
  ADR-1, the C1 token table, and each task's mockup reference swap; the task
  topology, freeze contract, and requirement mapping stand unchanged.

### ADR-2: No self-hosted webfont; system stacks only
- **Choice:** achieve the serif identity entirely with A's system stack
  (`Iowan Old Style` → `Palatino Linotype` → `Georgia`…); accept cross-OS metric
  variance. Resolves the ux-research open question.
- **Rejected:** bundling an OFL serif woff2 (~120–200KB, self-hosted, no CDN) —
  buys pixel-consistent branding across OSes but adds an asset pipeline, license
  bookkeeping, and diff surface to a run whose guardrail (AC5.4) prizes a minimal
  footprint; the candidate itself ships with zero font payload.
- **Consequences:** headings render with different metrics per OS (macOS Iowan,
  Windows Palatino Linotype, Linux Georgia-or-serif). The AC6.1 fidelity review must
  compare on one named OS (mockups were authored against the same stacks). A future
  branding pass may revisit with its own ADR.

### ADR-3: Tokens extend `styles.css` `@theme`; no new shared token module
- **Choice:** all tokens (C1) live in `frontend/packages/web/src/styles.css` —
  utility-generating values in `@theme`, alpha-wash/ramp/shadow values as plain
  `:root` custom properties in the same file. Existing token names keep their names
  with new values; the burden ramp moves from inline strings in `metrics.tsx` to
  `--burden-*` properties.
- **Rejected:** the "single clearly named new shared token module" AC5.4 permits —
  it exists for a candidate that needs cross-package tokens; A doesn't (web is the
  only consumer), and a new module adds workspace wiring for zero benefit. Also
  rejected: keeping per-component inline `light-dark()` strings (the status quo for
  the ramp) — scatters the theme across files and defeats the one-place token audit.
- **Consequences:** task 02 is the single writer of `styles.css`; every other task
  consumes C1 read-only, which is what makes the parallel split safe.

### ADR-4: Shell becomes a masthead inside `app.tsx`; router untouched
- **Choice:** replace the left rail with A's masthead (wordmark, top nav, count
  stamp, motto) by restyling `App` in place; `main.tsx` routes, `NavLink` structure,
  and the inbox-count badge query are unchanged, and the desktop/mobile split
  converges into the one masthead.
- **Rejected:** keeping the left rail and only re-skinning it — cheaper, but the
  spatial identity is half of A's thesis (the anti-pattern class is explicitly not
  fixable by tokens alone, per the spec's Context), and the mockups the reviewer
  compares against (AC6.1) all show the masthead.
- **Consequences:** `app.tsx` is one task's whole surface; no other task touches the
  shell. Layout containers on pages (`max-w-*` wrappers) stay page-local.

### ADR-5: Restyle-in-place; no component extraction or file moves
- **Choice:** keep the existing file/module structure and idioms (Tailwind utility
  classes in JSX, co-located helpers like `PageStatus` in `inbox.tsx`); express the
  redesign as class-recipe changes plus the C2 recipes.
- **Rejected:** extracting a `components/ledger.tsx` recipe library or moving
  `PageStatus` to its own file — cleaner in the abstract, but it's a refactor the
  feature doesn't need, it breaks the disjoint-surface parallelization (every task
  would contact the new file), and the codebase's idiom is co-location.
- **Consequences:** some recipe repetition across files, accepted; task 11's
  coherence pass and the C2 contract bound the drift.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01 (inventory audit); 06, 07, 08, 09, 10 (the six screens as built; run-artifacts + run-history in 09) |
| R2 | 01 |
| R3 | 01 |
| R4 | 01 |
| R5 | 02, 03, 04, 05, 06, 07, 08, 09, 10 (freeze contract per task), 11 (full floor: AC5.1–AC5.4) |
| R6 | 02 (AC6.2), 07 (AC6.3 zero-runs branch), 09 (AC6.4 malformed/bounce rendering), 11 (AC6.1 fidelity evidence, AC6.4 manual 409 check) |

## Risks

1. **Unprovisioned verification environment.** No `frontend/node_modules` in this
   checkout; `npm install` + `npx playwright install chromium` need network. Early
   signal: the first implementer's `npm run typecheck` fails to resolve packages. If
   the execution sandbox has no network, all AC5.x verification blocks → escalate at
   that moment, don't ship unverified.
2. **Parallel recipe drift.** Eight implementers applying C2 independently may
   diverge on paddings/kickers. Early signal: reviewer sees two different "section
   head" treatments. Mitigation: C2 + per-task mockup as authority + task 11
   coherence pass (the only task allowed to touch any web source file).
3. **e2e string coupling.** `smoke.spec.ts` asserts on visible copy and hooks (C3
   list). Early signal: `npx playwright test` fails on a restyle-only task —
   treat as a C3 violation in that task, never as a reason to touch the spec file.
4. **Serif metric variance** (accepted, ADR-2). Early signal: fidelity review run on
   a non-macOS box disputes match; reviewer pins the comparison OS instead.
5. **`light-dark()` placement.** Alpha washes, ramp, and shadow values must stay in
   `styles.css` custom properties (Tailwind arbitrary-value utilities choke on
   nested `light-dark()`/rgba). Proven pattern exists (`metrics.tsx` inline styles);
   early signal: a build error or a wash that doesn't flip with the OS theme.
6. **G1 candidate override.** The founder may pick B or C at the gate. Cost is
   bounded by design (ADR-1 consequences): amend ADR-1 + C1 + mockup references;
   tasks and mapping stand.
