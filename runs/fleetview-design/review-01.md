# Review Report: 02-ledger-foundations

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit fbc0fd2 on `run/fleetview-design`

## Findings

### F1 — minor (PLAUSIBLE) — prose-artifact table column heads keep the candidate-A-era sans treatment
- **Where:** `frontend/packages/web/src/styles.css:135-137`
- **Failure scenario:** an artifact containing a markdown table renders `th` as sans
  11px uppercase while every operating table (portfolio/metrics) will use C2's mono
  kicker voice — a visible voice split the AC6.1 fidelity pass may log as a
  deviation. PLAUSIBLE: neither C1/C2 nor the task scope names prose tables, the
  artbody mockup region contains none, and the carried-over rules are token-driven
  and palette-correct; ambiguity traces to the contract, not the diff. Non-blocking;
  worth a line in task 11's coherence pass.
- **Requirement:** plan C2 "Type roles" (column heads mono) vs. the reading-voice
  scope of this task — ambiguous which governs.

## Coverage

- **C1 @theme token table** — all 19 tokens checked value-by-value against plan.md:66-85
  (both light and dark legs, including the four rgba washes and the three new ●
  tokens `--color-inset`/`--color-accent-deep`/`--color-on-solid`): exact match ✓.
  No `--font-display`, no `--color-rule` (ADR-2 / C1:87-90) ✓; `--font-sans`/`--font-mono`
  stacks byte-identical to the pre-diff file ✓.
- **:root custom properties** — `--glow` (.30/.40 — the `.40` contract value, not the
  mockup's `.44`, per plan Risk 5 note), `--ramp-1..3`, `--unrecorded` all exact vs
  plan.md:96-100 ✓; placed as plain properties, not @theme tokens (Risk 6) ✓.
  `color-scheme: light dark` retained ✓; `:focus-visible` rule (accent 2px, offset
  2px, 2px radius) retained ✓; `body` stays bg-ground/text-ink/font-sans ✓.
- **Motion primitives** — `@keyframes pulse`/`pulsepanel`/`sweep` and
  `.pulse-glow`/`.pulse-panel`/`.skel` match plan.md:111-125 declaration-for-declaration
  (durations 2.4s/2.8s/1.5s, easings, the 18px static ring on `.pulse-panel`, `.skel`
  4px radius / 100deg inset-raised-inset gradient / 220% size) ✓. Grep of
  `frontend/packages/web/src/` confirms no `@keyframes` or `animation` outside
  styles.css (ADR-6) ✓.
- **Reduced motion (ADR-6)** — `animation: none !important` replaces the 0.01ms
  duration hack; near-zero `transition-duration` kept ✓. Static survivability holds:
  `.pulse-panel`'s glow ring is in the base declaration, not the keyframe; `.skel`
  keeps its inset gradient background (position 0 0 → reads as a static inset block) ✓.
- **.prose-artifact vs candidate-b artbody (run-artifacts.html:145-151) and
  design-candidate.md look-and-feel** — measure 76ch ✓; body 14px/1.6 sans ✓;
  h1 18px/600 ✓; h2 14px/600 + 1px line hairline ✓; inline code mono 12.5px on
  raised, 3px radius ✓; pre mono 12px/20px on inset, 4px radius ✓; no `rounded`/
  `rounded-lg` remains anywhere in the .prose-artifact recipes ✓ (the `rounded-lg`
  hits elsewhere in src/ belong to tasks 03-10, untouched here). Margin/padding
  deltas vs the mockup are ≤4px, within the spec's "~" tolerance. The un-specified
  h3 (13px/600, between h2 and body) is a sound judgment call, disclosed in notes.
- **Removal safety** — every pre-diff token name survives (values-only change);
  grep confirms no src/ consumer referenced `.pulse-glow`/`.pulse-panel`/`.skel`/
  `--ramp-*`/`--glow`/`--unrecorded`/`--color-inset`/`-accent-deep`/`-on-solid`
  before this diff (pure additions, no renames) ✓. `markdown.tsx:6` remains the sole
  `.prose-artifact` consumer, class name unchanged ✓.
- **AC5.2 / build ACs** — implementer-attested (typecheck, 127 tests, web build);
  not re-executed by this review (review tooling limited to git/read/grep). Nothing
  in the diff can affect TypeScript compilation; the one build-sensitive surface
  (new `bg-inset` utility from the @theme token) is a standard Tailwind 4 token
  derivation. AC6.2: package.json untouched by the diff ✓.
- **Not assessed:** rendered-browser visual output (no runtime in review scope);
  contrast ratios (spec assigns that to the candidate/verification stages, AC4.5).

## Boundary check

Diff touches `frontend/packages/web/src/styles.css` (the declared
file_contact_surface) plus `runs/fleetview-design/tasks/02-ledger-foundations.yaml`
notes — the latter is expected pipeline bookkeeping, not a boundary violation. No
C3 frozen file touched. Clean.
