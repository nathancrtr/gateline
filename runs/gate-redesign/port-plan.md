# Port Plan — Candidate A → Gate frontend (React/Tailwind v4)

A file-by-file implementation plan. The implementer executes sections in
order; each later section references tokens and classes defined earlier.

All file:line citations point at the current codebase
(`frontend/packages/web/`) unless prefixed `candidate-a/`.

---

## 0. Theme decision (read first)

The current codebase uses `light-dark()` for dual themes driven by OS
preference (`src/styles.css:7-24`). Candidate A commits to a **warm light
(paper)** palette only — the brief said "light or warm-dark" and Candidate A
chose light.

**Decision: replace the LIGHT theme with Candidate A's palette. Leave the
DARK theme values as-is (the existing cold-dark).** Rationale:

- Candidate A is a single-theme design; no warm-dark counterpart was
  specified. Inventing one now is scope creep.
- The dark theme continues to render coherently from the old tokens; it is
  simply not the redesigned surface. A future iteration owns the warm-dark
  translation.
- Every `light-dark(light, dark)` declaration keeps its shape — only the
  first argument changes. This is the smallest diff that lands Candidate A.

Consequence the implementer must accept: a user with OS dark mode sees the
old cold-dark UI, not Candidate A. That is intended for this port. Flag it
in the PR description.

New tokens that Candidate A introduces with no dark counterpart
(`--color-accent-tint`, `--color-reading-bg`, the status bg/line variants,
radius/shadow tokens, `--font-read`) are defined as **light-only plain
values** (no `light-dark()` wrapper). They are only consumed on the
redesigned light surface; the dark theme does not use them. If a dark-mode
user hits a page that references one, the value resolves to the literal
(e.g. `#f5e9e0`), which is acceptable for the interim.

---

## 1. Token mapping

### 1.1 `@theme` block replacement (`src/styles.css:6-28`)

Replace the entire `@theme { ... }` block with:

```css
@theme {
  /* Candidate A — warm light paper. Dark slot retains the prior cold-dark
     palette (interim; warm-dark is a future iteration). */
  --color-ground: light-dark(#faf7f1, #0a0e11);
  --color-surface: light-dark(#ffffff, #111820);
  --color-inset: light-dark(#f4efe6, #0d141a);   /* was --surface-2 */
  --color-raised: light-dark(#efe9de, #18222b);  /* was --surface-3 */
  --color-ink: light-dark(#24201c, #dbe7ec);
  --color-muted: light-dark(#7a726a, #8ba1ac);   /* was --ink-2 mapped to muted */
  --color-faint: light-dark(#756b61, #566771);
  --color-line: light-dark(#e7e0d3, #223039);
  --color-line-cool: light-dark(#d8d2c8, #223039);
  --color-accent: light-dark(#a04423, #45c8ec);
  --color-accent-deep: light-dark(#7a3318, #8adcf5); /* was --accent-ink */
  --color-accent-tint: #f5e9e0;        /* light-only; no dark counterpart yet */
  --color-reading-bg: #fdfbf6;         /* light-only; reading surface only */

  /* Status inks (used by chips/badges text). Light = Candidate A ink values. */
  --color-ok: light-dark(#256b3a, #4ec98d);
  --color-warn: light-dark(#8a5a12, #e0b24e);
  --color-bad: light-dark(#a02822, #ff7f63);
  --color-info: light-dark(#2f5d7a, #45c8ec);
  --color-on-solid: light-dark(#ffffff, #06121a);

  /* Status tinted-chip surfaces (Primer pattern). Light-only literals. */
  --color-ok-bg: #eaf3e6;   --color-ok-line: #cfe3c6;
  --color-bad-bg: #fbe9e6;  --color-bad-line: #f0cdc6;
  --color-warn-bg: #fbf1dd; --color-warn-line: #ecd9a8;
  --color-info-bg: #eaf0f5; --color-info-line: #cfe0ec;
  --color-pend-bg: #f0ede7; --color-pend-line: #d8d2c8;

  /* Soft variants kept for backward-compat with existing -soft consumers
     (e.g. bg-accent-soft, bg-bad-soft). Map to Candidate A tints. */
  --color-accent-soft: light-dark(rgba(160, 68, 35, .10), rgba(69, 200, 236, .14));
  --color-ok-soft: light-dark(rgba(37, 107, 58, .10), rgba(78, 201, 141, .15));
  --color-warn-soft: light-dark(rgba(138, 90, 18, .10), rgba(224, 178, 78, .15));
  --color-bad-soft: light-dark(rgba(160, 40, 34, .10), rgba(255, 127, 99, .16));

  /* Radius ladder (Candidate A). Exposes r-xs..r-xl as Tailwind utilities
     (rounded-xs etc.) and arbitrary values. */
  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  /* Fonts. Inter replaces the system-ui sans stack; JetBrains Mono stays;
     Newsreader added for the reading surface only. */
  --font-sans: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --font-read: "Newsreader", Georgia, "Times New Roman", serif;
}
```

Notes for the implementer:

- Tailwind v4 generates `--color-*` → `bg-*`/`text-*`/`border-*` utilities
  automatically. So `bg-inset`, `text-accent-ink` (via `--color-accent-deep`
  → `text-accent-deep`), `bg-accent-tint`, `bg-reading-bg`, `border-line-cool`
  all become available with no further config.
- The radius tokens generate `rounded-xs/sm/md/lg/xl`. The codebase currently
  uses literal `rounded-[5px]`, `rounded-[6px]`, `rounded-md` etc. Do **not**
  mass-rewrite existing utilities in this port; only new/edited surfaces use
  the ladder. (See §7 risk.)
- `--color-accent-deep` is kept as the token name (existing utilities
  `text-accent-deep` etc. still resolve). Candidate A's `--accent-ink` maps
  onto it. Where the plan says "accent-ink", use `accent-deep` in className.
- `--color-muted` now carries Candidate A's `--ink-2` role (#7a726a). The
  previous `--color-muted` (#4c5d67 light) was a darker secondary text; the
  new value is lighter. Verify contrast on small muted text — Candidate A
  deliberately darkened `--faint` to #756b61 to clear WCAG AA on the paper
  ground (see candidate-a/inbox.html:26 comment). Do not revert.

### 1.2 `:root` replacement (`src/styles.css:30-42`)

Replace with:

```css
:root {
  color-scheme: light dark;

  /* Layered shadows (Candidate A). Plain custom properties — they carry
     multi-layer shadow syntax that Tailwind arbitrary-value utilities
     choke on. Consumers reach these via var(--…), never inline. */
  --shadow-soft: 0 1px 2px rgba(36, 32, 28, 0.04);
  --shadow-lift: 0 0 0 1px rgba(231, 224, 211, 0.67), 0 1px 2px rgba(36, 32, 28, 0.04), 0 8px 22px -6px rgba(36, 32, 28, 0.10);

  /* Static accent ring (replaces the pulsing glow ring on NeedsYou cards).
     A plain 2px tinted ring — no animation. */
  --static-ring: 0 0 0 2px var(--color-accent-tint);

  /* Burden ramp + unrecorded — kept for metrics.tsx (NOT redesigned in this
     port). Values warmed to sit on paper ground; the ramp shape is
     preserved (lightness-monotonic, CVD-safe ordering is unchanged in
     hue-relative terms). Re-validate CVD ΔE if exact AA is required. */
  --ramp-1: light-dark(#e6c9a8, #2a5c52);
  --ramp-2: light-dark(#b88a4a, #4a9c8a);
  --ramp-3: light-dark(#7a3318, #8fdccb);
  --unrecorded: light-dark(#d9d3c7, #3a423e);

  /* Legacy glow kept as a no-op alias so any stray var(--glow) reference
     resolves without breaking. New code MUST NOT use --glow; use
     --static-ring or --shadow-lift instead. */
  --glow: light-dark(rgba(160, 68, 35, 0), rgba(69, 200, 236, 0));
}
```

Rationale: Candidate A removed pulsing/glow entirely. `--glow` is kept as a
zero-alpha alias because removing it would require auditing every
`shadow-[0_0_…_var(--glow)]` usage across the codebase; the alias makes
those usages render as no shadow (correct — Candidate A has no glow) without
a sweeping rewrite. The implementer should still remove `var(--glow)` from
each surface they touch in §3-§5; the alias is the safety net.

### 1.3 Google Fonts

Add to `index.html` `<head>` (after the favicon `<link>` at
`index.html:7`), matching candidate-a's three-family import (Newsreader is
only loaded on run-detail but the import is shared):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap" rel="stylesheet">
```

Do **not** use `@import` in `styles.css` — `@import 'tailwindcss'` must stay
first (`styles.css:1`), and a Google `@import` after it would be ignored by
PostCSS ordering rules. The `<link>` in `index.html` is the correct site.

---

## 2. Global styles changes (`src/styles.css`)

### 2.1 `body` (`styles.css:44-46`)

Change to:

```css
body {
  @apply bg-ground text-ink font-sans antialiased;
  font-size: 15px;
  line-height: 1.55;
  text-rendering: optimizeLegibility;
}
```

`font-sans` now resolves to Inter (via `--font-sans`). The explicit
font-size/leading match Candidate A's body (`candidate-a/inbox.html:55-58`).
Existing pages that set their own text sizes on headers/rows are unaffected.

### 2.2 `:focus-visible` (`styles.css:48-53`)

Keep as-is. The accent now resolves to terracotta, which is the intended
focus ring color.

### 2.3 Animations (`styles.css:55-96`)

Candidate A removed pulsing. Make these changes:

- **Delete** the `@keyframes pulse` and `@keyframes pulsepanel` blocks
  (`styles.css:59-66`).
- **Delete** `.pulse-glow` and `.pulse-panel` class definitions
  (`styles.css:72-78`).
- **Keep** `@keyframes sweep` (`styles.css:67-70`) — the skeleton shimmer
  still uses it.
- **Add** a `.static-ring` class (the NeedsYou replacement for
  `.pulse-panel`):

```css
/* Static accent ring — replaces the former .pulse-panel. A plain 2px tinted
   ring + soft lift shadow; no animation. Bounced items keep the bad-soft
   ring instead (see run.tsx NeedsYouCard). */
.static-ring {
  box-shadow: var(--static-ring), var(--shadow-lift);
}
```

- **Update `.skel`** (`styles.css:79-84`) to Candidate A's warm shimmer
  palette:

```css
.skel {
  border-radius: var(--radius-xs);
  background: linear-gradient(100deg, #efe9de 30%, #f6f1e7 50%, #efe9de 70%);
  background-size: 220% 100%;
  animation: sweep 1.6s ease-in-out infinite;
}
```

- **Keep** the `prefers-reduced-motion` block (`styles.css:91-96`) — it now
  also covers the (deleted) pulse classes trivially, and still stops `.skel`.

### 2.4 `.prose-artifact` → reading surface (`styles.css:98-156`)

This is the centerpiece. Candidate A's `.doc` (candidate-a/run-detail.html:167-197)
is a serif reading body with Inter sans headings, 76ch measure, 1.68 leading,
warm code tints. Replace the entire `.prose-artifact` block with a mapping
onto Candidate A's `.doc`:

```css
/* Rendered markdown (artifacts) — Candidate A reading surface.
   Newsreader serif body, Inter sans headings, 76ch measure, 1.68 leading,
   warm code tints. Serif is reserved for this surface only. */
.prose-artifact {
  font-family: var(--font-read);
  font-size: 16.5px;
  line-height: 1.68;
  color: var(--color-ink);
  max-width: 76ch;
}
.prose-artifact h1 {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 38px;
  line-height: 1.12;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  color: var(--color-ink);
}
.prose-artifact h2 {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 24px;
  letter-spacing: -0.01em;
  line-height: 1.2;
  margin: 42px 0 14px;
  color: var(--color-ink);
  border: none;
  padding: 0;
}
.prose-artifact h3 {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.005em;
  margin: 26px 0 10px;
  color: var(--color-ink);
}
.prose-artifact p { margin: 0 0 16px; }
.prose-artifact strong { font-weight: 600; color: var(--color-ink); }
.prose-artifact em { font-style: italic; }
.prose-artifact a {
  color: var(--color-accent-deep);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.prose-artifact ul, .prose-artifact ol {
  margin: 0 0 16px;
  padding-left: 1.4em;
}
.prose-artifact ul { list-style: disc; }
.prose-artifact ol { list-style: decimal; }
.prose-artifact li { margin: 0 0 6px; }
.prose-artifact li::marker { color: var(--color-faint); }
.prose-artifact code {
  font-family: var(--font-mono);
  font-size: 0.86em;
  background: #f1ece2;
  padding: 1px 5px;
  border-radius: var(--radius-xs);
  color: var(--color-accent-deep);
}
.prose-artifact pre {
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.55;
  background: #f3eee5;
  border: 1px solid var(--color-line);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin: 0 0 18px;
  overflow-x: auto;
  color: var(--color-ink);
}
.prose-artifact pre code {
  padding: 0;
  background: transparent;
  color: var(--color-ink);
  font-size: 13px;
}
.prose-artifact table {
  border-collapse: collapse;
  width: 100%;
  margin: 0 0 18px;
  font-size: 14px;
  font-family: var(--font-sans);
}
.prose-artifact th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-muted);
  border-bottom: 1px solid var(--color-line-cool);
}
.prose-artifact td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-line);
  color: var(--color-muted);
  vertical-align: top;
}
.prose-artifact blockquote {
  margin: 0 0 18px;
  padding: 6px 0 6px 18px;
  border-left: 3px solid var(--color-accent);
  color: var(--color-muted);
  font-style: italic;
  font-family: var(--font-read);
  font-size: 16.5px;
  line-height: 1.6;
}
.prose-artifact hr {
  border: none;
  border-top: 1px solid var(--color-line);
  margin: 30px 0;
}
.prose-artifact input[type='checkbox'] {
  accent-color: var(--color-accent);
  margin-right: 0.4rem;
}
.prose-artifact :is(h1, h2, h3, h4, h5, h6) {
  scroll-margin-top: 12px;
}
```

Behavioral changes the implementer must note:

- `h2` no longer has a bottom border. The old `border-b border-line` is gone
  (Candidate A uses whitespace, not rules, between sections). Any test that
  asserted on the border needs updating.
- Body font switches from sans to serif (Newsreader). This is the
  centerpiece change; the reading surface is now visually distinct from
  chrome.
- `td` color is now `--color-muted` (was `ink`-inherited). Candidate A dims
  table body text slightly.

### 2.5 `.lex-*` rules (`styles.css:158-226`)

Update colors to the new palette; structure stays. Specific changes:

- `.lex-ref` (`styles.css:162-167`): keep `text-accent` (now terracotta) —
  fine. No change.
- `.lex-ref-missing` (`styles.css:168-170`): keep `text-warn` — now
  Candidate A warn-ink. Fine.
- `.lex-card` (`styles.css:171-175`): the `box-shadow` literal at
  `styles.css:173` uses cold-dark rgba. Replace with:

```css
  box-shadow: var(--shadow-lift);
```

  (This also gives the card Candidate A's layered lift shadow, matching the
  rest of the redesign.)
- `.lex-card-qualifier` (`styles.css:184-186`): `text-warn` — fine.
- `.lex-card-def` (`styles.css:193-208`): uses `bg-inset` (now warm
  `#f4efe6`) — fine, no change.
- `.lex-card-jump` (`styles.css:209-211`): `text-accent` — fine.
- `.lex-cited` (`styles.css:215-220`): `bg-inset`, `border-line` — fine.

No structural changes to `.lex-*`.

### 2.6 New global classes

Add at the end of `styles.css`:

```css
/* Gate sigil — the two-posts-and-crossbar mark. Used in the sidebar
   wordmark, the inbox empty state, and the portfolio empty state. Color
   inherits from currentColor (set text-accent on the parent). */
.gate-sigil {
  display: inline-flex;
  color: var(--color-accent);
}

/* Blueprint grid — the New Run preview's signature surface. A faint 26px
   grid on the warm paper, multiply-blended so it reads as a page proof,
   not a debug log. Applied to the preview body only. */
.blueprint-grid {
  background-color: var(--color-surface);
  background-image:
    linear-gradient(rgba(231, 224, 211, 0.33) 1px, transparent 1px),
    linear-gradient(90deg, rgba(231, 224, 211, 0.33) 1px, transparent 1px);
  background-size: 100% 26px, 26px 26px;
  background-position: 0 0, 0 0;
}
```

The sigil SVG itself is inlined in `app.tsx` (see §3) rather than as a CSS
background, so it scales with `currentColor` and stays accessible
(`aria-hidden`).

---

## 3. Shared chrome changes (`src/app.tsx`)

### 3.1 The gate sigil + wordmark (`app.tsx:124-127` and `app.tsx:142`)

Replace the wordmark span at `app.tsx:125` with the sigil + Inter wordmark.
The sigil SVG is the one from candidate-a/inbox.html:252:

```jsx
<div className="px-2 py-1.5 flex items-center gap-2">
  <span className="gate-sigil" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22">
      <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  </span>
  <span className="font-sans text-[22px] font-semibold leading-none tracking-[-0.01em] text-ink">Gate</span>
  <p className="mt-1.5 text-[10.5px] leading-[1.35] text-faint">pipeline decisions</p>
</div>
```

Wait — the existing wordmark block (`app.tsx:124-127`) is a vertical stack
(wordmark over tagline). Candidate A's topbar is horizontal (sigil +
wordmark inline, tagline omitted). For the **sidebar**, keep the vertical
stack but swap the wordmark treatment: sigil above, then "Gate" in Inter
semibold, then the tagline. Concretely replace `app.tsx:124-127`:

```jsx
<div className="px-2 py-1.5">
  <span className="gate-sigil mb-1.5 block" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="20" height="20">
      <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  </span>
  <span className="font-sans text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">Gate</span>
  <p className="mt-1.5 text-[10.5px] leading-[1.35] text-faint">pipeline decisions</p>
</div>
```

Key change: `font-mono ... uppercase tracking-[0.16em]` →
`font-sans ... tracking-[-0.01em]`. The mono-uppercase wordmark is gone.

For the **mobile topbar** wordmark (`app.tsx:142`), apply the same swap:
sigil + "Gate" in Inter semibold, inline. Replace that span with:

```jsx
<span className="mr-2 flex items-center gap-1.5">
  <span className="gate-sigil" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="18" height="18">
      <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  </span>
  <span className="font-sans text-[15px] font-semibold leading-none tracking-[-0.01em] text-ink">Gate</span>
</span>
```

### 3.2 `NavItem` active state (`app.tsx:6-34`)

Candidate A's active nav state is `background: var(--accent-tint);
color: var(--accent-ink)` (candidate-a/inbox.html:80) — a tinted pill, not
a glowing dot. Changes:

- `app.tsx:13` — the active className: change `bg-accent-soft text-accent`
  to `bg-accent-tint text-accent-deep`. (Hover stays
  `hover:bg-raised hover:text-ink` — `bg-raised` is now `#efe9de`, a warm
  tint, matching candidate-a's `background:var(--surface-2)` hover.)
- `app.tsx:20-22` — the active dot: remove the `shadow-[0_0_8px_var(--glow)]`
  glow. Active dot becomes `bg-accent` (plain, no glow). Inactive dot stays
  `bg-faint`.
- `app.tsx:26-28` — the badge pill: remove `pulse-glow` class (deleted in
  §2.3). The pill becomes a static `bg-accent ... text-on-solid` pill. This
  matches Candidate A's "needs" pill (candidate-a/portfolio.html:152-158):
  solid accent, no glow.

### 3.3 Sidebar container (`app.tsx:123`)

Candidate A's topbar uses a warm gradient `linear-gradient(180deg,#fbf8f3, var(--ground))`. The sidebar is a vertical surface; give it the same warm
treatment. Change `app.tsx:123`:

- `bg-surface` → `bg-surface` (keep; surface is now `#ffffff`).
- Add a subtle top gradient via inline style or a utility. Simplest: keep
  `bg-surface` solid — Candidate A's sidebar in the prototypes is solid
  surface with a right border. The gradient is on the horizontal topbar
  only. **No change to the sidebar background.**
- `border-r border-line` — `--color-line` is now `#e7e0d3`. Fine.

### 3.4 Sidebar footer (`app.tsx:133-137`)

Change `font-mono text-[10px]` to `font-mono text-[10px] text-faint` —
already `text-faint`. The text content ("The repo is the database. / Every
view renders git.") stays. No structural change; the mono footer is
consistent with Candidate A's mono kickers (e.g.
candidate-a/inbox.html:88-91 `.kicker`).

### 3.5 `EngineOutageBanner` (`app.tsx:42-53`)

Update colors to the new palette. `app.tsx:47`:

- `border-bad/40 bg-bad/10` → `border-bad-line bg-bad-bg`. (Candidate A's
  banners use the tinted chip surfaces, not opacity overlays — see
  candidate-a/inbox.html:201-206 `.bounce`.)
- `text-ink` stays.
- `text-bad` (implicit via `text-ink`?) — the inner `<span
  className="font-semibold">` is fine.

Concretely replace `app.tsx:47`:

```jsx
<div className="mb-4 rounded-md border border-bad-line bg-bad-bg px-4 py-2.5 text-sm text-ink" role="alert">
```

### 3.6 `EngineDriftChip` (`app.tsx:67-114`)

- `app.tsx:84` — paused tone: `border-bad/40 bg-bad-soft text-bad` →
  `border-bad-line bg-bad-bg text-bad`. Non-paused: `border-line bg-surface
  text-ink` stays (line is now warm).
- `app.tsx:87` — the `●` dot: `text-bad` / `text-warn` stays; remove any
  glow (there is none here currently). Fine.

---

## 4. Chips changes (`src/components/chips.tsx`)

### 4.1 `PhaseChip` (`chips.tsx:5-38`)

Candidate A gives each phase its own tinted chip
(candidate-a/portfolio.html:100-112). Replace the `PHASE_TONE` map and the
component. The glowing dot (`shadow-[0_0_6px_currentColor]` at
`chips.tsx:33`) is removed — Candidate A uses a plain marker
(`.phase .mark` is `background:currentColor; opacity:.9`, no glow).

New `PHASE_TONE` (bg / ink / line per phase, from
candidate-a/portfolio.html:102-112):

```ts
const PHASE_TONE: Record<string, { chip: string; mark: string }> = {
  spec:       { chip: 'bg-[#f3eee5] text-[#6f5a3a] border-[#e2d6bd]', mark: 'bg-current' },
  plan:       { chip: 'bg-[#eef0f5] text-[#4a5170] border-[#d6dbe8]', mark: 'bg-current' },
  implement:  { chip: 'bg-accent-tint text-accent-deep border-[#e9d3c4]', mark: 'bg-current' },
  integrate:  { chip: 'bg-info-bg text-info border-info-line', mark: 'bg-current' },
  release:    { chip: 'bg-[#efe9f5] text-[#5a3a7a] border-[#dccfea]', mark: 'bg-current' },
  done:       { chip: 'bg-ok-bg text-ok border-ok-line', mark: 'border-[1.5px] border-current bg-transparent' },
  paused:     { chip: 'bg-warn-bg text-warn border-warn-line', mark: 'border-[1.5px] border-current bg-transparent rounded-[2px]' },
  staged:     { chip: 'bg-transparent text-[#6f5a3a] border-dashed border-[#c9bfa9]', mark: 'border-[1.5px] border-current bg-transparent' },
  unknown:    { chip: 'bg-bad-bg text-bad border-bad-line', mark: 'bg-current' },
}
```

Note: `spec`/`plan`/`release` use one-off hex tints that Candidate A did
not promote to named tokens. The implementer may either inline them (as
above, via arbitrary `bg-[#...]`) or add them as `@theme` tokens
(`--color-spec-bg` etc.). **Recommendation: inline them now** — adding
six more tokens for single-use chips is premature; promote later if a
second consumer appears.

Replace the `PhaseChip` body (`chips.tsx:16-38`):

```tsx
export function PhaseChip({ phase, pausedReason }: { phase: string; pausedReason?: string | null }) {
  // staged is a rest state — hollow ring marker, dashed chip, its own label.
  if (phase === 'paused' && pausedReason === 'staged') {
    const t = PHASE_TONE.staged
    return (
      <span className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-md border px-[10px] py-[4px] text-[12.5px] font-semibold leading-none ${t.chip}`}>
        <span className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full ${t.mark}`} />
        <span>staged</span>
      </span>
    )
  }
  const t = PHASE_TONE[phase] ?? PHASE_TONE.unknown
  return (
    <span className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-md border px-[10px] py-[4px] text-[12.5px] font-semibold leading-none ${t.chip}`}>
      <span className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full opacity-90 ${t.mark}`} />
      <span>{phase}</span>
      {pausedReason ? <span className="opacity-80">· {pausedReason}</span> : null}
    </span>
  )
}
```

Key deltas from current:

- Radius `rounded-full` (dot) stays; chip radius becomes `rounded-md` (8px,
  Candidate A `--r-md`).
- The `shadow-[0_0_6px_currentColor]` glow is gone.
- `pausedReason` suffix tone drops from `text-muted` to inline opacity —
  Candidate A keeps the suffix in the chip's own ink, slightly dimmed.

### 4.2 `KindChip` (`chips.tsx:40-75`)

Map to Candidate A's kind chips (candidate-a/inbox.html:145-165). The
current code's glowing dot (`chips.tsx:50`) is removed.

- **gate (reviewable)**: `border border-accent bg-accent-soft text-accent`
  → `border border-[#e9d3c4] bg-accent-tint text-accent-deep`. Remove the
  `shadow-[0_0_6px_currentColor]` dot at `chips.tsx:50` — replace with a
  plain `you-dot` (7px solid accent, no glow), matching
  candidate-a/inbox.html:210.
- **gate (bounced)**: `border-dashed border-bad bg-bad-soft text-bad
  line-through` → `border-dashed border-bad-line bg-bad-bg text-bad
  line-through`. (Same structure; just the new tinted-chip surfaces.)
- **staged**: `border border-accent bg-transparent ... text-accent` →
  `border-dashed border-[#c9bfa9] bg-transparent text-[#6f5a3a]`. Marker
  becomes hollow (`border border-current bg-transparent`). Label stays
  `STAGED` uppercase mono — Candidate A's staged chip
  (candidate-a/inbox.html:162 `.chip.staged`) uses lowercase, but the
  existing code's uppercase STAGED is a stronger form-difference signal
  (AC6.2, see chips.tsx:55-58 comment). **Keep uppercase** — this is a
  deliberate form distinction, not a color swap.
- **escalation**: `bg-bad text-on-solid` → `bg-info-bg text-info
  border-info-line` (Candidate A uses the info tint for escalations — see
  candidate-a/inbox.html:158 `.chip.info` and the escalation row at
  :333). Add a `⚑` glyph before the label. Change border from
  `border-transparent` to `border border-info-line`.
- **round-cap**: `bg-bad text-on-solid` → `bg-warn-bg text-warn
  border-warn-line`. Add `⟲3`-style glyph (the round count). Candidate A
  uses the warn tint for round-cap (candidate-a/inbox.html:351).
- **paused**: `bg-warn text-on-solid` → `bg-warn-bg text-warn
  border-warn-line`. Keep the `PAUSE` label.
- **malformed**: currently falls into the `bg-bad` branch. Candidate A
  gives malformed its own `⚠` glyph + bad chip
  (candidate-a/inbox.html:293). Add `malformed` to the label map
  (`chips.tsx:65`) with label `malformed` (not `BAD`), tone
  `bg-bad-bg text-bad border-bad-line`, glyph `⚠`.

Update the label map at `chips.tsx:65`:

```ts
const label = { escalation: 'escalation', 'round-cap': 'round-cap', paused: 'paused', malformed: 'malformed' }[item.kind]
```

(Yes — Candidate A spells these out, not as 3-4 letter caps. The existing
`ESC`/`CAP`/`PAUSE`/`BAD` abbreviations are a Signal-Deck density choice
that Candidate A reverses. This is a visible label change; flag in PR.)

### 4.3 `GateCell` (`chips.tsx:90-108`)

Candidate A's gate cells are larger (34×34 in portfolio, 38×38 in
run-detail) with a two-row `id` + `gl` layout
(candidate-a/portfolio.html:116-128, candidate-a/run-detail.html:71-77).
The current 22×30 single-row cell (`chips.tsx:101`) is replaced.

```tsx
export function GateCell({ id, cell }: { id: GateId; cell: RunSummary['gates'][GateId] }) {
  const glyph = cell.approved ? '✓' : cell.decided ? '✕' : '·'
  const tone = cell.approved
    ? 'bg-ok-bg text-ok border-ok-line'
    : cell.decided
      ? 'bg-bad-bg text-bad border-bad-line border-dashed line-through'
      : 'bg-pend-bg text-[#6b6259] border-pend-line border-dashed'
  const title = cell.decided ? `${id} ${cell.approved ? 'approved' : 'declined'} by ${cell.by}${cell.at ? ` · ${cell.at}` : ''}` : `${id} pending`
  return (
    <span
      className={`inline-flex h-[34px] w-[34px] flex-col items-center justify-center gap-0.5 rounded-sm border font-mono leading-none ${tone}`}
      title={title}
    >
      <span className="text-[9px] font-semibold tracking-[0.04em] opacity-80">{id}</span>
      <span className="text-[14px] font-semibold">{glyph}</span>
    </span>
  )
}
```

Deltas:

- Size 22×30 → 34×34 (portfolio) — matches candidate-a/portfolio.html:117.
  Run-detail uses 38×38 (candidate-a/run-detail.html:71); the shared
  `GateCell` uses 34px and the run-detail header can override via a
  wrapping className if the larger size is desired. **Recommendation: keep
  34px everywhere for component consistency; the 38px in run-detail is a
  prototype artifact.**
- `bg-inset` pending → `bg-pend-bg` (Candidate A's dedicated pending tint).
- declined gets `border-dashed line-through` (Candidate A
  candidate-a/portfolio.html:128 `.gate.bounced`).
- The `gap-0.5` between id and glyph replaces the inline `gap-0.5` at
  `chips.tsx:101`.

### 4.4 `GateLedger` (`chips.tsx:110-118`)

Only the gap changes: `gap-[3px]` → `gap-[5px]` (Candidate A
candidate-a/portfolio.html:115 `.gates { gap:5px }`). Otherwise follows
from `GateCell`.

### 4.5 `AgeBadge` (`chips.tsx:77-88`)

Candidate A's age badge (candidate-a/inbox.html:178-182) is mono, tabular,
with `urgent` (warn-ink, semibold) and `stale` (bad-ink, bold) variants, and
a clock glyph for urgent/stale. Update:

```tsx
export function AgeBadge({ label, urgent }: { label: string; urgent: boolean }) {
  return (
    <span
      className={`shrink-0 font-mono text-[13px] leading-none tabular-nums ${
        urgent ? 'font-semibold text-warn' : 'text-muted'
      }`}
      title="waiting since"
    >
      {urgent && <span className="mr-[2px]">⏱</span>}
      {label}
    </span>
  )
}
```

Deltas:

- Remove the `border bg-inset px-2 py-1 rounded-[4px]` chip frame —
  Candidate A's age is a bare mono number, not a chip
  (candidate-a/inbox.html:179).
- `urgent` maps to `text-warn` (warn-ink) + semibold + `⏱` glyph.
- The current code has only `urgent` (boolean). Candidate A also has
  `stale` (bad-ink, bold) for >7d. The `InboxRow` at `inbox.tsx:23` computes
  `urgent` at 3 days. **Add a `stale` threshold at 7 days** to match
  Candidate A (candidate-a/inbox.html:181 `.age.stale`). This is a small
  logic addition in `inbox.tsx` (see §5.1) — the `AgeBadge` prop signature
  gains `stale?: boolean`.

Updated signature:

```tsx
export function AgeBadge({ label, urgent, stale }: { label: string; urgent: boolean; stale?: boolean }) {
  if (stale) {
    return (
      <span className="shrink-0 font-mono text-[13px] font-bold leading-none tabular-nums text-bad" title="waiting since">
        <span className="mr-[2px]">⏱</span>{label}
      </span>
    )
  }
  return (
    <span className={`shrink-0 font-mono text-[13px] leading-none tabular-nums ${urgent ? 'font-semibold text-warn' : 'text-muted'}`} title="waiting since">
      {urgent && <span className="mr-[2px]">⏱</span>}{label}
    </span>
  )
}
```

### 4.6 `BudgetMeter` (`chips.tsx:129-147`)

Candidate A's budget meter (candidate-a/portfolio.html:137-144) is a thin
bar + mono label, with over-budget using `bad-ink` (a non-color signal via
the `· spent` suffix, not just red). Update:

```tsx
export function BudgetMeter({ limit, spent }: { limit: number | null; spent: number | null }) {
  if (limit === null) return <span className="text-xs text-faint italic">no budget</span>
  const used = spent ?? 0
  const over = used > limit
  const pct = Math.min(100, (used / limit) * 100)
  return (
    <span className="inline-flex flex-col items-end gap-[3px]" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-[5px] w-[90px] overflow-hidden rounded-full border border-line bg-raised">
        <span
          className={`block h-full rounded-full ${over ? 'bg-bad' : used === 0 ? 'bg-faint' : 'bg-accent'}`}
          style={{ width: `${used === 0 ? 4 : pct}%` }}
        />
      </span>
      <span className={`font-mono text-[11.5px] tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
        {used === 0 ? 'unmetered' : `$${used.toFixed(0)} / ${limit.toFixed(0)}${over ? ' · spent' : ''}`}
      </span>
    </span>
  )
}
```

Deltas:

- Remove `shadow-[0_0_6px_var(--glow)]` from the fill (`chips.tsx:138`) —
  no glow in Candidate A.
- Bar track `border-line bg-inset` → `border-line bg-raised` (Candidate A
  uses `--surface-3` = `--color-raised` for the track,
  candidate-a/portfolio.html:138).
- Over-budget label gains `· spent` suffix (non-color signal,
  candidate-a/portfolio.html:143).
- `no budget` text gains `italic` (Candidate A
  candidate-a/portfolio.html:144 `.lbl.unmet` is italic).
- Layout switches from inline `items-center gap-2` to vertical
  `flex-col items-end gap-[3px]` (bar above label) — matches
  candidate-a/portfolio.html:137-143.

### 4.7 `ValidationBadge` (`chips.tsx:120-127`)

Minimal change. `text-ok` / `text-bad` now resolve to Candidate A's
ok/bad inks. No structural change. The `✓`/`✕` glyphs stay.

---

## 5. Per-page changes

### 5.1 Inbox (`src/pages/inbox.tsx`)

**Header (`inbox.tsx:89-95`)**:

- `inbox.tsx:90` — `font-mono text-xl ... uppercase tracking-[0.14em]` →
  Candidate A's hero: `font-sans text-[54px] font-semibold leading-[1.04] tracking-[-0.02em]`. (Per candidate-a/inbox.html:93-96 `.head h1`.)
- **Add a kicker** above the h1 (candidate-a/inbox.html:88-91): a mono
  uppercase line "Pending human decisions · oldest first" in
  `text-accent-deep`. Insert before the `<header>`:
  `<div className="font-mono text-[12px] uppercase tracking-[0.14em] text-accent-deep mb-[10px]">Pending human decisions · oldest first</div>`
- **Add the count number** beside the h1 (candidate-a/inbox.html:98-104):
  `<span className="font-sans text-[54px] font-medium leading-none text-accent tabular-nums tracking-[-0.02em]">{items!.length}<sup className="ml-2 text-[13px] font-medium text-muted align-super">waiting</sup></span>`
- **Add a sub** (candidate-a/inbox.html:105-107): the paragraph "A
  reading-queue across every run…". Insert after the head.
- `inbox.tsx:93` — **remove the keyboard hint** `j/k move · ↵ open`. The
  keyboard handler stays functional (`useKeys` at `inbox.tsx:67`); only the
  visible caption is removed (brief: "keep functional, just remove visible
  hints").

**Rows (`inbox.tsx:21-49`)**:

Candidate A's row is a 5-column grid: `4px rail | 132px kindcol | 1fr body
| 92px meta | 120px age` (candidate-a/inbox.html:126-138). The current row
is a flex layout (`inbox.tsx:28`). Restructure `InboxRow`:

```tsx
function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  const stale = item.since !== null && now - item.since > 7 * 86_400
  const rail = railClassFor(item)  // see below
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        to={itemHref(item)}
        className={`grid items-stretch border-l-transparent transition-colors hover:bg-[#fbf9f4] ${
          selected ? 'bg-accent-tint' : 'bg-surface'
        }`}
        style={{ gridTemplateColumns: '4px 132px 1fr 92px 120px' }}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <span className={`w-[4px] self-stretch ${rail}`} aria-hidden="true" />
        <span className="flex flex-col items-center justify-center gap-[6px] pt-5">
          <KindChip item={item} />
        </span>
        <span className="flex min-w-0 flex-col gap-[6px] px-[22px] py-[18px]">
          <span className="flex flex-wrap items-baseline gap-[10px]">
            <span className="truncate text-[16px] font-semibold tracking-[-0.005em] text-ink">{item.title}</span>
            <span className="shrink-0 font-mono text-[12.5px] text-muted">{item.source}/{item.slug}</span>
          </span>
          <p className="max-w-[78ch] truncate text-[14.5px] text-muted">{item.detail}</p>
          {!item.reviewable && item.kind === 'gate' && (
            <p className="mt-1 rounded-sm border border-bad-line bg-bad-bg px-[10px] py-[7px] text-[13px] text-bad">
              <b className="font-semibold">Bounced</b> — packet fails its contract; no approval is offered.
            </p>
          )}
        </span>
        <span className="border-l border-line" />
        <span className="flex items-center justify-end border-l border-line pr-[22px]">
          <AgeBadge label={age} urgent={urgent} stale={stale} />
        </span>
      </Link>
    </li>
  )
}
```

The `railClassFor` helper maps kind → rail color (candidate-a/inbox.html:189-195):

```ts
function railClassFor(item: InboxItem): string {
  if (item.kind === 'gate' && !item.reviewable) return 'bg-bad bg-[repeating-linear-gradient(180deg,#a02822_0_4px,transparent_4px_8px)]'
  if (item.kind === 'gate') return 'bg-accent'
  if (item.kind === 'staged') return 'border-l-2 border-dashed border-[#c9bfa9]'
  if (item.kind === 'paused') return 'bg-warn'
  if (item.kind === 'escalation') return 'bg-info'
  if (item.kind === 'round-cap') return 'bg-[#946014]'
  if (item.kind === 'malformed') return 'bg-bad'
  return 'bg-faint'
}
```

Note: the bounced rail's repeating-linear-gradient is a Candidate A
signature (candidate-a/inbox.html:193). The arbitrary-value Tailwind
syntax `bg-[repeating-linear-gradient(...)]` works in v4 but is verbose;
if it causes parser issues, fall back to an inline `style={{ background:
'repeating-linear-gradient(...)' }}`. **Recommendation: inline style for
the bounced rail only** — it's the one case the gradient syntax is
non-trivial.

**Container (`inbox.tsx:103`)**: `rounded-[5px] border border-line
bg-surface` → `rounded-lg border border-line bg-surface overflow-hidden`
(Candidate A uses `--r-lg` = 12px, candidate-a/inbox.html:122-124).

**Empty state (`inbox.tsx:96-101`)**: replace with Candidate A's warm
"Inbox zero." (candidate-a/inbox.html:228-231, :434-441):

```tsx
<div className="px-10 py-20 text-center">
  <span className="gate-sigil mb-3.5 block text-accent opacity-85" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="44" height="44">
      <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
      <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  </span>
  <h2 className="font-sans text-[46px] font-semibold tracking-[-0.02em] text-ink">Inbox zero.</h2>
  <p className="mx-auto mt-2 max-w-[46ch] text-[15px] text-muted">Nothing is waiting on you. The agents are reading, writing, and reviewing on their own. Come back when a gate clears, or open the portfolio to look in on a run at your leisure.</p>
</div>
```

**Skeleton (`inbox.tsx:69-83`)**: update the skeleton row to the new 5-col
grid shape (rail + kindcol + body + meta + age). The `.skel` class now uses
the warm shimmer (§2.3). Keep three rows. Restructure to match the new row
grid; the `skel` spans fill the columns.

### 5.2 Portfolio (`src/pages/portfolio.tsx`)

**Header (`portfolio.tsx:39-49`)**:

- `portfolio.tsx:40` — `font-mono text-xl ... uppercase tracking-[0.14em]`
  → `font-sans text-[50px] font-semibold leading-[1.04] tracking-[-0.02em]`
  (candidate-a/portfolio.html:64).
- Add kicker "All runs · all sources" above (mono, accent-deep).
- Add the stat cluster to the right of the h1
  (candidate-a/portfolio.html:65-68): three `stat` blocks (runs / need you
  / spent this week). These need data — `runs.length` is available;
  `needsHuman` total and weekly spend are **not in the current API
  response**. **Decision: render the runs count only** (from `runs.length`);
  omit the "need you" and "spent this week" stats rather than wire new API
  fields. Flag as a follow-up. (Adding API fields is scope creep for a
  visual port.)
- `portfolio.tsx:42-48` — the "+ New run" CTA: change from the ghost
  outline button to Candidate A's `.btn-primary`
  (candidate-a/portfolio.html:50-57): `bg-accent text-white border-[#8a3a1e]
  rounded-sm shadow-[var(--shadow-soft)]`. Remove `shadow-[0_0_12px_var(--glow)]`.

**Table container (`portfolio.tsx:73`)**: Candidate A sits the table on
tinted ground, not a hard-bordered card (candidate-a/portfolio.html:72-78).
Change `overflow-x-auto rounded-[5px] border border-line bg-surface` →
`overflow-x-auto rounded-lg border border-line bg-inset p-[6px]`. (`bg-inset`
is now `#f4efe6` = Candidate A `--surface-2`.)

**Header cells (`portfolio.tsx:10`)**: the `TH` constant — change
`border-b border-line bg-inset ... font-mono text-[10px] ... uppercase
tracking-[0.12em] ... text-muted` to Candidate A's header
(candidate-a/portfolio.html:80-84): `text-left font-medium text-[11px]
tracking-[0.1em] uppercase text-muted border-b border-line px-3 py-3.5`.
Drop `bg-inset` (the table already sits on tinted ground; headers are
transparent). Keep mono? Candidate A's `th` is `font-weight:500` sans, not
mono (candidate-a/portfolio.html:81). **Change `font-mono` → `font-sans`
in `TH`.**

**Row hover (`portfolio.tsx:89`)**: `hover:bg-raised` →
`hover:bg-[#fbf8f3]` (Candidate A's hover, candidate-a/portfolio.html:89).

**Malformed row tint**: add `stale-row` treatment for malformed runs
(candidate-a/portfolio.html:90): if `run.malformed`, add `bg-[#fbf3ed]` to
the `<tr>`.

**Slug cell (`portfolio.tsx:90-94`)**: restructure to Candidate A's
`.slugcell` (candidate-a/portfolio.html:93-97): slug in mono semibold,
source below in mono muted, malformed note below in bad-ink mono with `✕`
prefix. The current cell already has these elements inline; just adjust
typography (slug `text-[13.5px] font-medium text-ink font-mono`, source
`text-[11.5px] text-muted font-mono`).

**Divergence pill (`portfolio.tsx:95-109`)**: map to Candidate A's `.div`
(candidate-a/portfolio.html:162-165): `ahead` → `bg-warn-bg text-warn
border-warn-line`, `diverged` → `bg-bad-bg text-bad border-bad-line`. Change
from `bg-bad-soft`/`bg-warn-soft` to the tinted-chip surfaces.

**Needs-human pill (`portfolio.tsx:127-137`)**: map to Candidate A's
`.needs` (candidate-a/portfolio.html:152-158): `bg-accent text-white
border-[#8a3a1e] rounded-full font-sans font-bold text-[12px]`. Remove
`shadow-[0_0_8px_var(--glow)]`. Zero state → `.needs.zero`
(candidate-a/portfolio.html:159): `bg-transparent text-faint border-dashed
border-line-cool font-medium`.

**Legend**: Candidate A has a legend below the header
(candidate-a/portfolio.html:217-223). **Add it** — it explains the gate
cell states. Render five swatches (approved/declined/pending/bounced/absent)
using the new status-bg tokens. This is new JSX; place it between the
`.sub` and the `.ledger` table.

**Empty state (`portfolio.tsx:50-71`)**: replace with Candidate A's
`.empty-sketch` (candidate-a/portfolio.html:171-177, :439-446): sigil +
"No runs staged yet." + paragraph + primary CTA. Remove the
`shadow-[0_0_12px_var(--glow)]` on the CTA.

### 5.3 New Run (`src/pages/new-run.tsx`)

This page has the most structural change. The `planRunScaffold` logic
(`new-run.tsx:130-150`), the mutation, the outcome flashes — all logic
stays. Only the JSX/className changes.

**Header (`new-run.tsx:202-211`)**:

- `new-run.tsx:203-208` — the "Portfolio /" breadcrumb in mono uppercase
  → Candidate A's crumb (candidate-a/run-detail.html:51-53): mono
  `text-[12.5px] text-muted`, slash separators in `text-faint`. Keep as a
  Link to /portfolio.
- `new-run.tsx:209` — `font-mono text-xl ... uppercase tracking-[0.14em]`
  → `font-sans text-[56px] font-semibold leading-[1.04] tracking-[-0.025em]`
  (candidate-a/new-run.html:51). Text: "Stage a run." (Candidate A's
  headline, candidate-a/new-run.html:249).
- Add kicker "Stage a run · the record assembles itself" (mono,
  accent-deep) above.
- Add the `.sub` paragraph (candidate-a/new-run.html:250) below the h1.

**Layout (`new-run.tsx:213`)**: the `flex flex-col-reverse gap-[22px]
lg:flex-row` → Candidate A's `grid grid-cols-[1fr_520px] gap-12`
(candidate-a/new-run.html:54). On mobile, collapse to single column.

**Form inputs**: every `rounded-[5px] border border-line bg-inset px-2.5
py-2` input/select/textarea → Candidate A's inset-well
(candidate-a/new-run.html:61-68): `rounded-sm border border-line-cool
bg-surface px-3 py-[10px] shadow-[inset_0_1px_2px_rgba(36,32,28,0.03)]`.
On focus: `border-accent shadow-[0_0_0_2px_var(--color-accent-tint)]`
(candidate-a/new-run.html:68). The implementer should add a shared
`.input-well` class in `styles.css` rather than repeat the long className
fourteen times — **add this to §2.6**:

```css
/* Form input well — Candidate A's inset treatment. */
.input-well {
  border: 1px solid var(--color-line-cool);
  background: var(--color-surface);
  border-radius: var(--radius-sm);
  box-shadow: inset 0 1px 2px rgba(36, 32, 28, 0.03);
  transition: border-color .14s, box-shadow .14s;
}
.input-well:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px var(--color-accent-tint);
}
.input-well.err {
  border-color: var(--color-bad);
  background: var(--color-bad-bg);
}
```

Then each input gets `className="input-well w-full px-3 py-[10px] text-sm"`
(+ `font-mono text-[13.5px]` for slug/budget). The error variant: add `err`
class. This collapses ~14 near-identical className strings.

**Labels (`new-run.tsx:322,345,358,380,417,468,473,485,498`)**: the
`font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]
text-muted` label → Candidate A's label (candidate-a/new-run.html:59):
`text-[13px] font-semibold text-[#4d4742] tracking-[0.01em]` (sans, not
mono). The mono-uppercase kicker pattern is reserved for section dividers,
not field labels.

**Profile buttons (`new-run.tsx:383-405`)**: restructure to Candidate A's
3-card grid (candidate-a/new-run.html:77-94). Each `.profile` card:
`rounded-md border border-line-cool bg-surface px-3.5 py-3 flex flex-col
gap-2 shadow-[inset_0_1px_2px_rgba(36,32,28,0.03)]`. Selected:
`bg-accent-tint border-accent shadow-[0_0_0_2px_var(--color-accent-tint),inset_0_0_0_1px_var(--color-accent)]`.
The gate chips inside (`new-run.tsx:395-402`) become `.pg` chips
(candidate-a/new-run.html:89-94): `font-mono text-[10.5px] font-semibold
px-1.5 py-0.5 rounded-xs border border-line-cool bg-inset text-muted`;
selected profile's gates: `bg-surface border-[#e9d3c4] text-accent-deep`.

**Intent brief sections (`new-run.tsx:435-460`)**: map to Candidate A's
`.brief-sec` (candidate-a/new-run.html:99-112). Each section is a
`rounded-md border border-line bg-surface overflow-hidden` card. Header:
`.hd` with `##` hash in accent mono, heading in Inter semibold `text-[18px]`,
filled/empty indicator (`.ind` — a 18px circle, `✓` on ok-bg or `·` on
pend-bg dashed), and `required` tag. The textarea is borderless, sitting
on `bg-surface`. Replace the current `rounded-[5px] border bg-surface`
+ `border-b border-line bg-inset` header with this structure.

**RecordPreview aside (`new-run.tsx:561-685`)** — the hero. Map to
Candidate A's `.preview` (candidate-a/new-run.html:127-207):

- Container `new-run.tsx:585-586`: `rounded-[6px] border border-line
  border-l-[3px] border-l-accent bg-surface p-4
  shadow-[0_0_0_1px_var(--color-accent-soft)]` → `rounded-xl border
  border-line bg-surface overflow-hidden shadow-[var(--shadow-lift)]`.
  Remove the left-accent-rail (Candidate A's preview is a full rounded-xl
  page-proof, not a rail card).
- `.ptop` header bar (candidate-a/new-run.html:136-143): `bg-inset
  border-b border-line px-5 py-3.5 flex items-center gap-2.5`. Left:
  mono `text-[11px] uppercase tracking-[0.12em] text-muted` "The record
  this stages". Right: live indicator `text-[12px] font-semibold text-ok`
  with an 8px `bg-ok` dot.
- `.pbody` (candidate-a/new-run.html:144-156): apply the `blueprint-grid`
  class (§2.6) + `relative px-7 py-7`. The `::before` fainter overlay from
  candidate-a/new-run.html:152-155 is achieved by the `blueprint-grid`
  class's rgba alpha; no extra pseudo needed.
- Branch line (candidate-a/new-run.html:158-160): mono `text-[12.5px]
  text-muted` with `⎇` in accent + `run/{slug}` in ink semibold.
- **Genesis commit chip** (candidate-a/new-run.html:162-181) — the hero
  element. Replace `new-run.tsx:600-618` with:
  - A `.genesis` card: `mt-5 rounded-lg bg-surface border border-line
    p-5 shadow-[var(--shadow-soft)]`.
  - `.ghd`: status dot (13px, `bg-accent` with `shadow-[0_0_0_4px_var(--color-accent-tint)]`
    when ready; hollow `bg-surface border-2 border-faint` when not) +
    "genesis · ready" tag (mono `text-[10.5px] uppercase tracking-[0.1em]
    text-accent-deep bg-accent-tint border border-[#e9d3c4] px-1.5 py-0.5
    rounded-xs`).
  - `.cmsg` — the commit message as an **Inter semibold headline**
    (candidate-a/new-run.html:168-174): `font-sans font-semibold text-[21px]
    leading-[1.3] tracking-[-0.012em] text-ink`. The `state(...):` brackets
    in accent. The client-key in mono `text-[12px] text-muted` on a second
    line. **This is the key visual change**: the commit message is no
    longer mono body text; it is the page's headline.
  - `.who-line`: author + email + "author & committer" pill.
- **File tree** (candidate-a/new-run.html:180-192): replace
  `new-run.tsx:620-655` with the `.files` structure. Each `.frow`:
  `flex items-center gap-2.5 py-2 border-b border-dashed border-line`,
  icon `▤` in muted, path in mono `text-[12.5px] text-ink`, `new` tag in
  `bg-accent-tint text-accent-deep border-[#e9d3c4] rounded-xs`. The
  section checklist (`.checklist`) under intent-brief.md stays, restyled
  to mono `text-[11.5px]` with `✓` in ok-ink for filled, `·` in faint for
  empty.
- **Collapsible state.yaml** (candidate-a/new-run.html:195-204): replace
  `new-run.tsx:658-667` with the `details.yaml` structure: `rounded-md
  border border-line bg-inset overflow-hidden`, summary with a `▸` twist
  that rotates 90° when open (use `[open]` + a CSS transform on a
  `<span>`), line count on the right. The `<pre>` inside: `bg-surface
  border-t border-line px-3.5 py-3 font-mono text-[12px] leading-[1.6]`.
  (Syntax highlighting via `.k`/`.s`/`.c` spans is a Candidate A prototype
  nicety; **skip it** — the current code renders plain `scaffold.files['state.yaml']`
  text. Adding a YAML tokenizer is scope creep.)
- **Closing line** (candidate-a/new-run.html:206-207): `new-run.tsx:677-681`
  → `mt-5 border-t border-dashed border-line pt-3.5 text-[12.5px] text-muted
  max-w-[42ch] leading-[1.55]`, with "Staging commits this record." in
  `text-[#4d4742] italic`.

**Submit button (`new-run.tsx:533-540`)**: `rounded-full border border-accent
bg-accent ... shadow-[0_0_12px_var(--glow)]` → Candidate A's `.btn-primary`
(candidate-a/new-run.html:121): `rounded-sm bg-accent text-white
border-[#8a3a1e] shadow-[var(--shadow-soft)] px-5 py-[11px] font-sans
font-semibold text-[14px]`. Remove the glow.

**Flash components (`new-run.tsx:687-703`)**: update the `cls` map to
Candidate A's tinted-chip surfaces:

```ts
const cls = {
  ok:   'bg-ok-bg text-ok border border-ok-line',
  info: 'bg-accent-tint text-accent-deep border border-[#e9d3c4]',
  bad:  'bg-bad-bg text-bad border border-bad-line',
  cfg:  'bg-bad-bg text-bad border border-dashed border-bad-line',
  warn: 'bg-warn-bg text-warn border border-warn-line',
}[tone]
```

Container `rounded-[5px]` → `rounded-md`. Add the border (Candidate A's
flashes are bordered, the current ones are borderless).

**Missing-sections error block (`new-run.tsx:299-318`)**: `border-2
border-bad bg-surface` → `border border-bad-line bg-bad-bg rounded-md`.
Keep the structure (alert role, focus ref, link list).

### 5.4 Run Detail (`src/pages/run.tsx`)

**Header (`run.tsx:85-124`)**:

- `run.tsx:86` — `font-mono text-xl font-semibold tracking-[0.06em]` →
  Candidate A's run title (candidate-a/run-detail.html:60): `font-sans
  text-[46px] font-semibold leading-[1.06] tracking-[-0.02em]`. Add the
  subtitle "— log rotator" in `text-[24px] text-muted` inline (Candidate A
  uses the run's title field; the current code only shows slug. **If the
  API does not return a title, keep slug-only** — do not invent data. Flag
  as follow-up.)
- Add kicker "implement phase · standard profile · needs you" (mono,
  accent-deep) above the h1 (candidate-a/run-detail.html:59). Derive from
  `summary.phase`, `summary.profile`, `items.length > 0`.
- `run.tsx:87-88` — PhaseChip + GateLedger stay (updated in §4). Wrap them
  in a `.badges` flex (candidate-a/run-detail.html:66).
- `run.tsx:89-109` — the right-side metadata (divergence, budget, ref) →
  move into a **metadata rail** aside (candidate-a/run-detail.html:242-253,
  the Raycast pattern). This is a structural change: the header becomes a
  `grid grid-cols-[1fr_300px] gap-10` (candidate-a/run-detail.html:58).
  The rail is a `rounded-md border border-line bg-surface px-3.5 py-1.5
  shadow-[var(--shadow-soft)]` card with `kv` rows: Phase, Profile, Gates,
  Tasks, Max rounds, Budget (mini bar), Divergence, Needs you, Updated.
  Most of this data is already in `summary`; the rail just re-presents it
  in a key-value list. **The budget mini-bar reuses `BudgetMeter`** (§4.6).
- `run.tsx:110-123` — the genesis line: keep, restyle to mono
  `text-[12.5px] text-muted` (candidate-a/run-detail.html:62-63). The
  `staged_by` in `text-[#4d4742] font-medium`.

**State error block (`run.tsx:126-134`)**: `border-bad bg-bad-soft` →
`border-bad-line bg-bad-bg rounded-md`. Keep structure.

**NeedsYouCard (`run.tsx:191-236`)** — the centerpiece stakes-varied card.
Candidate A replaces the `.pulse-panel` with a static accent-rail + tinted
ground + lifted shadow (candidate-a/run-detail.html:94-117).

Replace `run.tsx:194-198`:

```tsx
<section
  className={`relative grid overflow-hidden rounded-lg ${
    item.reviewable
      ? 'grid-cols-[4px_1fr] bg-accent-tint border border-[#e9d3c4] shadow-[var(--shadow-lift)]'
      : 'grid-cols-[4px_1fr] bg-bad-bg border border-bad-line'
  }`}
  data-needs-card
>
  <span className={`w-[4px] self-stretch ${item.reviewable ? 'bg-accent' : 'bg-bad'}`} aria-hidden="true" />
  <div className="px-7 py-[22px]">
    {/* ... inner content ... */}
  </div>
</section>
```

Key deltas:

- `.pulse-panel` → static. The reviewable card uses `bg-accent-tint` ground
  + `bg-accent` rail + `shadow-lift`. No animation.
- The bounced card uses `bg-bad-bg` + `bg-bad` rail, no shadow-lift (lower
  stakes).
- Inner content (`run.tsx:200-207`): the KindChip + title + AgeBadge row
  stays, but add Candidate A's `.tag` (candidate-a/run-detail.html:101):
  a "Needs you · G2" pill in mono uppercase accent-deep on white with
  `border-[#e9d3c4]`. The title becomes an `h2` in `font-sans text-[26px]
  font-semibold tracking-[-0.015em]` (candidate-a/run-detail.html:103).
- The `item.detail` paragraph (`run.tsx:207`): `text-sm text-muted` →
  `text-[14.5px] text-[#4d4742] leading-[1.55] max-w-[76ch]`.
- Problems list (`run.tsx:208-216`): `text-xs font-medium text-bad` →
  Candidate A's `.problems` (candidate-a/inbox.html:185-187): mono
  `text-[12px] text-bad` with `✕` prefix.
- Packet links (`run.tsx:217-231`): `rounded border border-line bg-inset
  ... text-muted hover:border-accent hover:text-accent` → `rounded-xs
  border border-line-cool bg-surface px-2 py-0.5 font-mono text-[11.5px]
  text-muted hover:border-accent hover:text-accent-deep`.
- `DecidePanel` (`run.tsx:233`): stays; its buttons update via §5.4 below
  and the shared `decide.tsx` changes (§7).

**TaskBoard (`run.tsx:238-257`)**: map to Candidate A's `.task`
(candidate-a/run-detail.html:122-130). Each task chip: `rounded-md border
border-line bg-surface px-3 py-2 flex items-center gap-2.5 text-[13px]
shadow-[var(--shadow-soft)]`. The status sub-chip: `review-approved` →
`bg-ok-bg text-ok border-ok-line rounded-xs px-2 py-0.5 text-[11.5px]
font-semibold`. The round count stays mono. Add a header line
`.tbhd` (candidate-a/run-detail.html:120): "Task board · N tasks · M
review-approved" in mono uppercase muted.

**Tabs (`run.tsx:152-164`)**: `font-mono text-xs font-semibold uppercase
tracking-[0.06em]` → Candidate A's `.tab` (candidate-a/run-detail.html:134-137):
`font-sans text-[13.5px] font-medium px-4 py-2.5 border-b-2
border-transparent -mb-px`. Active: `text-ink border-accent font-semibold`.
Inactive: `text-muted hover:text-ink`. Add the count `<span class="cnt">`
in mono `text-[11px] text-faint` (candidate-a/run-detail.html:137) —
requires the counts; **artifacts count is `detail.artifacts.length`**,
history count is `detail.history.length`, diff count is not in the API
response — **omit the diff count**, show "Diff" without a number.

**ArtifactsTab sidebar (`run.tsx:271-291`)**: map to `.artside`
(candidate-a/run-detail.html:142-152). The file list buttons: `rounded
px-2.5 py-1.5 font-mono text-xs` → `flex items-center gap-2.5 px-4.5 py-2.5
border-l-2 border-transparent font-mono text-[12.5px]`. Selected:
`bg-accent-tint border-l-accent text-accent-deep font-semibold`. Hover:
`bg-inset`. The ValidationBadge glyph stays. Add the `.slbl` header
"Artifacts · runs/{slug}/" in mono uppercase muted.

**ArtifactBody (`run.tsx:297-332`)** — the reading surface centerpiece.
The `<article>` wrapper (`run.tsx:313`): `max-w-[76ch] rounded-md border
border-line bg-surface px-6 py-5` → Candidate A's `.artifact`
(candidate-a/run-detail.html:155-161): `bg-reading-bg px-14 py-10
relative` (no border, no max-width on the article — the measure is on the
inner `.measure` div). Add an inner `<div className="mx-auto max-w-[76ch]">`
wrapper. Add the `.topline` (candidate-a/run-detail.html:162-165): a mono
path/lines/committed line above the doc, with the validation status on the
right (`✓ passes spec contract` in ok-ink, or the fail banner). The
Markdown content inside uses `.prose-artifact` (now the serif reading
surface, §2.4). **This is where §2.4 lands visually.**

The fail banner (`run.tsx:315-317`): `border-bad bg-bad-soft` →
`border-bad-line bg-bad-bg rounded-sm`.

**HistoryTab (`run.tsx:346-369`)**: the timeline. Update colors:
- `run.tsx:349` — `before:bg-line` stays (line is now warm).
- `run.tsx:356` — transition node: `before:border-accent before:bg-accent
  before:shadow-[0_0_10px_var(--glow)]` → `before:border-accent
  before:bg-accent` (remove glow). Non-transition: `before:border-faint
  before:bg-inset` stays.
- `run.tsx:361` — `text-accent` → `text-accent-deep` for the phase label.
- The rest (mono timestamps, author, oid) stays; colors resolve via tokens.

**LoadingSkeleton (`run.tsx:374-384`)**: `.skel` now uses warm shimmer
(§2.3). No structural change.

---

## 6. Implementation order

Execute in this order; each step references tokens/classes from prior steps.

1. **`index.html`** — add the Google Fonts `<link>` (§1.3). No other file
   depends on this, but fonts must be loadable before visual review.
2. **`src/styles.css`** — the full token + global rewrite (§1.1, §1.2,
   §2.1-2.6). This is the foundation; nothing else should be touched
   first. After this step, the app already renders in the warm palette
   (with broken chrome details — the pages still use old class names that
   now resolve to new tokens, which is mostly-correct).
3. **`src/components/chips.tsx`** — all chip updates (§4). Chips are
   consumed by every page; updating them before pages means page work is
   purely structural.
4. **`src/app.tsx`** — the shared chrome (§3). Sidebar, topbar, nav,
   banners. After this, navigation and the wordmark are Candidate A.
5. **`src/pages/inbox.tsx`** (§5.1) — simplest page; validates the row
   grid, rail, empty state, and the new header pattern.
6. **`src/pages/portfolio.tsx`** (§5.2) — table + legend + stat cluster.
7. **`src/pages/run.tsx`** (§5.4) — the reading surface lands here
   (`.prose-artifact` is already updated in step 2; this step wires the
   `.artifact` wrapper, metadata rail, NeedsYouCard, tabs).
8. **`src/pages/new-run.tsx`** (§5.3) — last, because it is the largest
   structural change and benefits from all prior patterns being settled
   (input-well, flash, chips, preview card).

After each step, run `npm run typecheck` and `npm run dev` to visually
verify. Do not batch all eight steps then review — the token step (2) in
particular can surface contrast/resolution issues that affect later
decisions.

---

## 7. Risks and gotchas

### 7.1 The `light-dark()` split (MAJOR, accepted)

Per §0, only the light theme is Candidate A. A user with OS dark mode sees
the old cold-dark UI. This is intended. **Verify** after step 2 that
toggling OS theme does not produce a broken half-warm/half-cold state —
the new light-only tokens (`--color-accent-tint`, `--color-reading-bg`,
the `--color-*-bg`/`-line` status tokens, `--font-read`, radius/shadow
tokens) resolve to their literal values in dark mode, which may look
wrong on the cold-dark ground. **Mitigation**: the redesigned pages
(inbox/portfolio/new-run/run) are the only consumers of these tokens, and
they are the pages being visually reviewed in light mode. The
non-redesigned pages (metrics) do not consume the new tokens. Acceptable
for this port; flag in PR.

### 7.2 `--glow` zero-alpha alias (MINOR)

`--glow` is aliased to zero alpha (§1.2) so stray `var(--glow)` references
render as no-shadow. The implementer should still remove each
`shadow-[0_0_…_var(--glow)]` usage in the surfaces they touch (§3.2, §4.6,
§5.2, §5.3, §5.4). **Audit after the port**: `grep -r 'var(--glow)' src/`
should return zero hits. If any remain, they are no-op but should be
cleaned up.

### 7.3 `@agentic/core/record` import in new-run.tsx (ESCALATE-if-touched)

`new-run.tsx:11` imports `planRunScaffold`, `ScaffoldError`,
`SLUG_PATTERN`, `RunScaffold` from `@agentic/core/record`. This is logic,
not styling. **Do not change it.** The port only touches the JSX that
renders the scaffold's output. If a styling change appears to require
changing the planner's output shape, escalate — that is upstream of this
port.

### 7.4 Keyboard handler (`use-keys.ts`) (MINOR)

`useKeys` (`inbox.tsx:67`, `run.tsx:59`, `decide.tsx:45`) stays functional.
Only the visible hints (`j/k move · ↵ open` at `inbox.tsx:93`) are
removed. Do not remove the handlers themselves.

### 7.5 `metrics.tsx` is NOT redesigned (MAJOR, accepted)

`metrics.tsx` shares tokens and chips but is not one of the four
redesigned screens. It will render with the new warm palette (tokens
changed) but keep its old layout (mono uppercase header, burden ramp
chart). **Verify** after step 2 that the burden ramp
(`--ramp-1/2/3`, `--unrecorded`) still renders coherently on the warm
ground — the ramp values were warmed in §1.2 but the CVD ΔE ordering was
not re-validated. If AA compliance is required, escalate for a CVD re-check
before merge.

### 7.6 `decide.tsx` shares the Flash + Button pattern (MINOR)

`decide.tsx` is not in the four-page list but its `Button` and `Flash`
(`decide.tsx:252-268`, `293-299`) share patterns with new-run's Flash and
submit button. **Update colors via tokens** (the `Button` primary tone at
`decide.tsx:258` uses `shadow-[0_0_12px_var(--glow)]` — remove the glow;
the `Flash` at `decide.tsx:294` uses `bg-ok-soft`/`bg-warn-soft`/`bg-bad-soft`
— swap to `bg-ok-bg`/`bg-warn-bg`/`bg-bad-bg` with borders). Keep
structure. This is a small, in-passing update; do it during step 4
(chrome) or step 8 (new-run), wherever the implementer first opens
`decide.tsx`.

### 7.7 `evidence.tsx` and `lexicon.tsx` (MINOR)

`evidence.tsx` and `lexicon.tsx` consume tokens (`bg-inset`, `border-line`,
`text-accent`, etc.) and the `.lex-*` classes (§2.5). **Minimal change**:
the `.lex-*` color updates in §2.5 propagate automatically. If
`evidence.tsx` has its own inline color classes, swap `*-soft` → `*-bg`
and remove any `var(--glow)`. Do not restructure.

### 7.8 Radius ladder vs existing `rounded-[5px]` (MINOR)

The new `--radius-xs..xl` tokens generate `rounded-xs..xl` utilities. The
codebase uses literal `rounded-[5px]`, `rounded-[6px]`, `rounded-md`
extensively. **Do not mass-rewrite** — only surfaces edited in §3-§5 adopt
the ladder. The result is a mix of `rounded-md` (Tailwind default 6px) and
`rounded-md` (Candidate A 8px via `--radius-md`). **Wait**: Tailwind v4's
`rounded-md` default is 6px; Candidate A's `--radius-md` is 8px. Defining
`--radius-md: 8px` in `@theme` **overrides** the default `rounded-md`
utility to 8px everywhere. This is a silent global change to every
`rounded-md` usage in the codebase, including non-redesigned pages.
**Mitigation**: either (a) accept the global 8px (Candidate A's intent —
the ladder is the new system), or (b) name the tokens differently
(`--radius-a/b/c/d/e`) to avoid colliding with Tailwind defaults.
**Recommendation: (a) accept it** — Candidate A's ladder is the new
standard, and 8px vs 6px is a 2px difference that will not break layout.
Flag in PR so reviewers know `rounded-md` now means 8px globally.

### 7.9 Inline arbitrary hex values (MINOR)

Several phase chips (§4.1) and the staged chip use inline `bg-[#f3eee5]`
etc. because Candidate A did not promote them to named tokens. This is
intentional (premature to add six single-use tokens). **Risk**: if a
future redesign wants to retheme these, they are hidden in className
strings. **Mitigation**: a follow-up can promote them to `@theme` tokens
once a second consumer appears. For now, the inline values are the
single source of truth and are documented in §4.1.

### 7.10 The `stale` age threshold is new logic (MINOR)

`AgeBadge` gains a `stale` prop (§4.5) and `InboxRow` computes it at 7
days (§5.1). The current code only has `urgent` at 3 days. This is a small
logic addition, not a styling change. **Verify** the 7-day threshold
matches product intent (Candidate A candidate-a/inbox.html:181 uses
`.age.stale` for the 7d malformed row). If the threshold should be
configurable, escalate — but for this port, hardcoding 7 days matches the
prototype.

### 7.11 Run-detail title subtitle may not exist in API (PLAUSIBLE)

§5.4 adds a "— log rotator" subtitle to the run header
(candidate-a/run-detail.html:61). The current API (`RunSummary`) may not
expose a title field separate from slug. **Check `api.ts`** before
implementing; if absent, render slug-only and flag the subtitle as a
follow-up. Do not invent data.

### 7.12 Portfolio stat cluster needs API fields not present (MAJOR, deferred)

§5.2's "need you" and "spent this week" stats
(candidate-a/portfolio.html:211-213) require data not in the current
`api.runs()` response. **Decision: render only the runs count** (from
`runs.length`). The other two stats are omitted. Flag as follow-up. Do
not add API fields in this port.

---

## 8. Self-critique round

I attacked the plan along five axes before returning it.

**Soundness — does the token split actually work?** The `light-dark()`
pattern requires `color-scheme: light dark` (kept at `styles.css:31`).
The new light-only tokens (`--color-accent-tint` etc.) are plain literals,
not `light-dark()` — they resolve the same in both modes. In dark mode,
a redesigned page would render warm-tinted chips on cold-dark ground,
which is wrong. **Survived but flagged**: §7.1 makes this an accepted
risk for the interim. The alternative (wrapping every new token in
`light-dark(warm, <something>)` with an invented dark value) is scope
creep the brief explicitly defers. Correct call.

**Detail correctness — the radius collision (§7.8).** This is the
load-bearing risk. Defining `--radius-md: 8px` in `@theme` overrides
Tailwind v4's default `rounded-md` (6px) globally, affecting
non-redesigned pages (metrics, decide, evidence, lexicon). I initially
missed this; the §7.8 note is the fix. The 2px delta is visually minor
but it is a silent global change. The plan now flags it explicitly and
offers the alternative naming. **Survived with the flag.**

**Evidence as product — does the plan cite the codebase?** Every claim
about current state cites `file:line`. Every claim about target state
cites `candidate-a/<file>:<line>`. The implementer can navigate both.
**Survived.**

**Scope and overreach — did I design beyond the brief?** Three places:
(a) the `stale` age threshold (§4.5/§7.10) is new logic, not pure
styling — but it is required to render Candidate A's `stale` age variant,
so it is in scope. (b) the portfolio stat cluster (§5.2/§7.12) — I
deferred the missing-data stats rather than invent them, which is the
conservative call. (c) the YAML syntax highlighting in the state.yaml
preview (§5.3) — I explicitly skipped it as scope creep. **Survived.**

**The strong form vs straw man — did I attack the real design?** The
real design is "warm light, serif reading surface, tinted chips, no
glow." I attacked: the theme split (does half-porting create a broken
state?), the radius collision (does the new ladder silently retheme
untouched pages?), the missing API fields (does the visual design assume
data that doesn't exist?), and the glow alias (does the zero-alpha hack
leave stray no-op shadows?). Each has a concrete failure mode and a
mitigation. **Survived.**

**What I did not attack (coverage statement):** I did not verify the
exact CVD ΔE of the warmed burden ramp (§7.5) — that requires a color
contrast tool and is flagged for escalation. I did not verify the
`api.ts` shape for a run title field (§7.11) — flagged for the
implementer to check. I did not exhaustively grep for every
`var(--glow)`/`bg-*-soft` usage outside the four pages (§7.2/§7.6) — the
plan names the known sites and recommends a post-port grep. These are
the three places a defect could hide; each is named, not concealed.
