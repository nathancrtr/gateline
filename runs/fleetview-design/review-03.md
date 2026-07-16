# Review Report: 05-decide-panel

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 72125eabd5ea699e02606ab763246eade80c3577 on `run/fleetview-design` (matches branch HEAD for `decide.tsx`)

## Findings

### F1 — blocking — selected burden tile never shows the accent-soft wash: base `bg-inset` beats conditional `bg-accent-soft` in the compiled cascade
- **Where:** `frontend/packages/web/src/components/decide.tsx:138-139`
- **Failure scenario:** open approve mode, select any burden option → both `bg-inset` and `bg-accent-soft` are on the label; in the built stylesheet (verified: `vite build`, `@layer utilities`) `.bg-accent-soft` is emitted at byte 11379 and `.bg-inset` at 11986, equal specificity, later rule wins → the selected tile's background stays `--color-inset`, not the wash. Class-attribute order does not help. Fix shape: make the backgrounds mutually exclusive in the conditional (`bg-accent-soft` selected / `bg-inset` unselected), as the pre-diff code did with `bg-surface`.
- **Requirement:** task scope ("selected = accent border + accent-soft wash"); plan C2 (selection wash); mockup `run-artifacts.html:110` `.opt.on{background:var(--accent-soft)}`; R6/AC6.1.

### F2 — minor — quiet buttons ("Cancel", "Decline…") render at weight 400; mockup `.btn` is 600 for all capsules
- **Where:** `frontend/packages/web/src/components/decide.tsx:209-210` (no weight class in the quiet tone or the shared base)
- **Failure scenario:** any decide row shows a semibold primary capsule next to a regular-weight quiet capsule; mockup `run-artifacts.html:126` sets `font:600 13px` on every `.btn`. Pre-existing weight, but Button's restyle to the capsule set is this task's surface.
- **Requirement:** R6/AC6.1 fidelity (mockup is the authority per plan §Approach); plan C2 leaves quiet weight unpinned, so minor.

### F3 — minor — primary/danger capsules have no 1px border, so they sit 2px shorter than the bordered quiet capsule in the same `flex gap-2` row
- **Where:** `frontend/packages/web/src/components/decide.tsx:206-210`
- **Failure scenario:** approve mode → "Approve G1" (borderless, 7px+7px padding) next to "Cancel" (border adds 2px) → visibly mismatched capsule heights; mockup gives every `.btn` a 1px border (`border-color` accent/bad on primary/danger, `run-artifacts.html:126-129`).
- **Requirement:** R6/AC6.1 fidelity; plan C2 silent on the border, so minor.

## Coverage

- **String freeze (C3):** every diff hunk read against the pre-diff file — all 12 changed lines are `className` strings only; the bounced copy ("no approval is offered…"), burden labels/hints, legend text, "Notes (optional)" placeholder, decline/resolve placeholders, `committed <oid>` flash, CAS-409 conflict copy are byte-identical. Clean.
- **Behavior freeze (C3):** modes, `useMutation` logic, `dataset.deciding` effect, key handlers (a/x/1/2/3/esc), `data-decide-panel`, all seven `data-decide` values, `role="status"`, `sr-only` radio wiring — untouched (only the key-numeral span gained a conditional *class*). Clean.
- **Token discipline:** all colors are C1 tokens (`line`, `bad`, `muted`, `faint`, `accent`, `accent-soft`, `inset`, `on-solid`, `ok/warn/bad-soft`) plus `shadow-[0_0_12px_var(--glow)]` per C2's primary-button recipe; the dropped `border-line/70` and `border-accent/40` opacity modifiers now match the mockup's plain 1px line / accent-on-hover. No ad-hoc hex values. Clean.
- **Motion:** grep of post-diff `decide.tsx` for `keyframes|animation|pulse|skel|motion` → zero hits; static glow only. Clean (panel pulse correctly left to task 09).
- **Mockup fidelity spot-check** (`.decide` region, `run-artifacts.html:105-131,165-168`): wrapper 14px/14px + 1px line top border ✓; legend mono 600 10.5px uppercase 0.08em mb-9px ✓ exact (mockup wins over C2's 0.12–0.16em kicker range per plan); tile 5px radius, inset bg, 8×12px padding, hover full-accent border ✓; selected numeral → accent ✓; textarea inset well 5px radius 9×11px padding ✓; flash 5px radius, 600, ok/warn/bad washes ✓ exact; bounced copy 600 12.5px bad ✓ exact. Residual non-findings: tile/textarea body at `text-sm` (14px) vs mockup 13px (pre-existing, size unpinned by scope); selected key numeral inherits 600 where the mockup's `font` shorthand resets it to 400; no visible focus ring on the sr-only radio pre- or post-diff ("focus treatment kept" holds — nothing was removed).
- **Acceptance tests run** (env provisioned here: `npm install` + `npx playwright install chromium`): AC5.2 `npm run typecheck` ✓, `npm test` 127 passed/1 skipped ✓; AC5.1 `npx playwright test` 5/5 ✓ including both decide loops and the bounce assertion; AC5.3 keyboard model exercised by the `a → 1 → approve` e2e ✓. Note: the suites cannot see F1 — no test asserts computed background, which is why the surviving-mutant check above was done against the built CSS.

## Boundary check

Commit touches exactly one file: `frontend/packages/web/src/components/decide.tsx` — inside the declared `file_contact_surface`. No `styles.css`, spec, or e2e edits. Clean.

---

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** 3ce84bac00e1070e71affa846244156a043f7d15 against parent 72125ea on `run/fleetview-design`

### Prior findings

- **F1 (blocking) — resolved.** `decide.tsx:138-139`: `bg-inset` moved off the shared label base into the unselected branch; selected branch carries `bg-accent-soft` alone. The backgrounds are now mutually exclusive per state — the round-1 compiled-cascade argument cannot resurface because only one background utility is ever on the element, so the relative order of `.bg-accent-soft`/`.bg-inset` in the built stylesheet is irrelevant. Grep of the post-diff file confirms no other `bg-` utility on the label. Mirrors the pre-diff `bg-surface` pattern; the mutant (wash never renders) is dead.
- **F2 (minor) — resolved.** `decide.tsx:213`: `font-semibold` now sits on the shared `<button>` base and was removed from the primary/danger tone strings (no duplication). Quiet capsules ("Cancel", "Decline…") render at 600 alongside primary/danger, matching mockup `.btn{font:600 13px}`.
- **F3 (minor) — resolved.** `decide.tsx:206-213`: shared `border` (1px width) on the base plus per-tone color — `border-accent` (primary), `border-bad` (danger), `border-line` (quiet) — matching mockup `.btn{border:1px solid var(--line)}` with `.primary`/`.danger` border-color overrides. All three capsules in a `flex gap-2` row now carry the same 1px border; the 2px height mismatch is closed.

### New findings

None. Specifically checked for fix-induced regressions: quiet's old `border border-line` pair did not double up (`border` moved to the base, `border-line` stays in the tone branch — same computed result); primary/danger border color equals their fill (accent/bad) so no visible seam, per the mockup; the shared `border` width utility and per-tone `border-*` color utilities set different CSS properties, so no cascade-order hazard of the F1 kind exists in the new arrangement.

### Coverage (round 2)

- **Freeze re-check (C3):** the round-2 diff for `decide.tsx` is two hunks touching only `className` template strings; the `<button>` element gained multi-line formatting but no new props/handlers — `{...props}` spread, key handlers, `data-decide` hooks, and every user-visible string are byte-identical to 72125ea. Clean.
- **Motion re-check:** grep of post-diff `decide.tsx` for `keyframes|animation|motion|pulse|skel` → zero hits. Clean.
- **Token discipline of new classes:** `border-accent`, `border-bad`, `border-line`, `bg-inset`, `bg-accent-soft` — all C1 tokens, no ad-hoc values. Clean.
- **Acceptance re-run in this workspace** (fresh `npm install`, `npm run build`, `npx playwright install chromium`): `npm run typecheck` ✓; `npm test` 127 passed/1 skipped ✓; `npx playwright test` 5/5 ✓. The implementer's verification claims in the task notes are confirmed independently, not taken on trust.
- Round-1 mockup fidelity spot-check not repeated except the three areas this diff touches (burden-tile background, button weight, button border), per round-2 scope. Round-1 residual non-findings stand unchanged.

### Boundary check (round 2)

Commit 3ce84ba touches `frontend/packages/web/src/components/decide.tsx` (inside `file_contact_surface`) and `runs/fleetview-design/tasks/05-decide-panel.yaml` (the `notes:` field only — the implementer's round-response channel, standard run bookkeeping, not product-code contact). No other files. Clean.
