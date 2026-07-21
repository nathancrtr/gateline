# Review Report: 04-status-components

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 972545603cfeda6dc6a3204f207d4bb702e46a96 on `run/fleetview-design` (sole commit touching `chips.tsx`; the working tree's stray staged revert of the file is rebase debris per `state.yaml` escalations and was excluded — all checks ran against the committed content)

## Findings

### F1 — major — chip recipes drop the mockups' `/1` line-height: `text-[11px]` compiles to font-size only, so KindChip/AgeBadge inherit preflight `line-height:1.5` and render ~5px taller than the recipe
- **Where:** `frontend/packages/web/src/components/chips.tsx:35,46,57` (committed file; also `:19` — PhaseChip `text-xs` pins 16px leading vs mockup `12px/1`)
- **Failure scenario:** render any inbox gate row → KindChip capsule measures ~24.5px (16.5px inherited line box + 6px padding + 2px border) and AgeBadge ~26.5px, vs the mockup's tight 19px/21px (`inbox.html:80` `.sig{font:600 11px/1…}`, `:88` `.age{font:11px/1…}`); verified in the built CSS: `.text-\[11px\]{font-size:11px}` (no line-height) under preflight `html{line-height:1.5}`. Because leading is inherited, chip height also drifts with whatever ambient line-height each consumer context has (`inbox.tsx:33,44`, `run.tsx:143,146`) — the recipe is not self-contained. Fix shape: pin leading on the changed elements (`leading-none` or equivalent) to match the mockups' `/1`.
- **Requirement:** task scope ("mono 600 ~11px" per the sig/age/phase recipes); plan §Approach (mockups are the authority) + C2 signal-chip/age recipes; acceptance test "chips/cells/meters match candidate-b mockup recipes"; R6/AC6.1.

### F2 — minor — solid urgent chips (ESC/CAP/BAD/PAUSE) drop the `.sig` base 1px border, so their vertical extent equals the routine gate chip and the mockup's "urgent = larger" size cue is lost
- **Where:** `frontend/packages/web/src/components/chips.tsx:46` (no border utility in the solid branch)
- **Failure scenario:** inbox showing a routine gate row above an ESC row → both capsules compute the same height (padding 8px + line box vs 6px padding + 2px border + line box); mockup gives every `.sig` a 1px border (`inbox.html:80` `border:1px solid transparent`, kept by the solid variants at `:85`), making urgent capsules 2px taller and 2px wider than routine. The diff retains only a 1px-per-side horizontal difference; weight (700) and solid fill still carry urgency, so minor.
- **Requirement:** task scope ("urgent solid chips heavier (700) and larger padding"); plan C2 / REC4 ("Size, fill, and weight carry urgency, never hue alone"); R6/AC6.1.

## Coverage

- **Freeze (C3):** all seven exports and their prop types byte-identical to the parent (diff is `className` strings plus the derived `bounced` const); glyphs `✓/✕/·` and every title unchanged (`waiting since`, GateCell decided/pending templates, BudgetMeter `$x of $y`); ValidationBadge untouched as scoped; `PHASE_TONE` map and unmetered/over/zero meter logic unchanged. Clean.
- **Bounced derivation:** `item.kind === 'gate' && !item.reviewable` with `reviewable: boolean` required on `InboxItem` (`core/src/readiness.ts:38`) — sound, no signature change, matches C3's note. Clean.
- **Mockup fidelity spot-check** (vs `inbox.html:80-89`, `portfolio.html:79-101`, `run-artifacts.html:71,88`): sig chip gap 6px / pad 3×9 / radius 999 / mono 600 11px / .04em / 6px LED `currentColor` + `0 0 6px` glow ✓; glow suppressed on solid chips only — the bounced gate keeps its LED glow, matching the mockup's suppression list exactly ✓; bounced = dashed bad + bad-soft + line-through, and the strike hits the label only (the LED span is an atomic inline-block, same mechanics as the mockup) ✓; PAUSE solid warn, ESC/CAP/BAD solid bad, on-solid text ✓; gate cell 30×22 / 3px radius / 2px glyph gap / 8px faint numeral / ok- and bad-soft washes / pending dashed-inset — all exact ✓; ledger gap 3px ✓; age chip pad 4×8 / 4px radius / inset + line border / urgent bad border+text+700 on unchanged inset bg — exact ✓; phase 7px dot / 7px gap / ink text / muted reason ✓ (diff adds the `bg-current` the mockup's `.phase .led` omits — correct per scope and C2, the dot is otherwise invisible); meter track 64×5 / 3px radius / inset + line border, accent fill + `0 0 6px var(--glow)`, over=bad and zero=faint both glowless, 4% zero stub, over numeral 700 — exact ✓. F1/F2 are the only recipe deviations found.
- **Token discipline:** every color utility resolves to C1 (`inset`, `on-solid`, softs, `line`, `faint`, `--glow`); arbitrary values are the two sanctioned static glow shadows plus px geometry; no hex, no non-C1 names. Clean.
- **Motion + shape greps (post-diff file):** `@keyframes`/`animation` → zero hits; `rounded-lg`/`rounded-md` → zero hits. Static shadows only. Clean.
- **Cascade-order hazard** (the review-03 F1 class): each element carries at most one background and one border-color utility per state branch — tone branches are mutually exclusive, no shared-base/conditional collision anywhere in the file. Clean.
- **Acceptance run against the committed content** (detached worktree at 9725456 with the workspace's `node_modules`, since the working tree carries unrelated staged debris): AC5.2 `npm run typecheck` ✓, `npm test` 127 passed / 1 skipped ✓. AC5.1 (`npx playwright test`) not re-run for this file: `chips.tsx` contains none of the e2e-asserted strings or DOM hooks in the C3 list, and the diff touches classes only. Neither suite can see F1/F2 (no computed-style assertions), which is why both were established against the built stylesheet and the mockup CSS instead.
- **Residual non-findings:** BudgetMeter value at `text-xs` (12px) vs mockup `.meter .val` 11px — pre-existing size, unpinned by the scope (same disposition as review-03's residuals); KindChip lacks `.sig`'s `white-space:nowrap` — labels are single tokens inside a flex row, wrap unreachable; GateCell's implicit line-height is harmless under its fixed `h-[22px]` + `items-center`; `no budget` branch untouched.

## Boundary check

Commit 9725456 touches exactly one file: `frontend/packages/web/src/components/chips.tsx` — inside the declared `file_contact_surface`. No `styles.css`, task, spec, or e2e edits. Clean.

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** e13b5f0892fa50ae38ec655739efc01b7b6afba7 on `run/fleetview-design` (restores the round-1 content that unrelated commit 9a69fde had clobbered — verified `git diff 972545603c^ e13b5f0^ -- chips.tsx` is empty and `git diff 9a69fde e13b5f0^ -- chips.tsx` is empty, so e13b5f0^ carried exactly the pre-round-1 blob — then applies the fixes; HEAD 1e242b9's `chips.tsx` is byte-identical to e13b5f0's)

### Finding resolutions

- **F1 — resolved.** `git diff 972545603c e13b5f0 -- chips.tsx` shows `leading-none` added at all four sites the finding named: PhaseChip outer span (`chips.tsx:19`), KindChip gate branch (`:35`), KindChip solid branch (`:46`), AgeBadge (`:57`). Mutant-kill verified against the rebuilt stylesheet, not just the source: `.leading-none{--tw-leading:1;line-height:1}` is emitted; `.text-\[11px\]{font-size:11px}` still carries no line-height, so KindChip/AgeBadge now take line-height 1 solely from the added utility (no inherited-leading dependence on `inbox.tsx`/`run.tsx` ambient contexts); PhaseChip's `text-xs` compiles to `line-height:var(--tw-leading,var(--text-xs--line-height))`, so `leading-none` overrides it via the variable, cascade-order-independent. Resulting boxes: gate chip 11+2·(3+1)=19px, age chip 11+2·(4+1)=21px — exactly `inbox.html:80` `.sig` and `:88` `.age`.
- **F2 — resolved.** `border border-transparent` added to the solid urgent branch (`chips.tsx:46`); `.border-transparent{border-color:#0000}` in the built CSS. Solid chip now 11+2·(4+1)=21px vs routine 19px and 2px wider (px‑[11px]+1px vs px‑[9px]+1px per side) — restores the mockup's border-on-every-variant size cue (`inbox.html:80,84-85`); transparent matches the base rule since the solid variants never set a border color.

### Round-2 coverage

- **Delta isolation:** the full `972545603c → e13b5f0` diff for `chips.tsx` is four hunks, all `className`-only — the F1/F2 fixes above and nothing else; no export, prop type, glyph, title, tone map, or logic moved. Round-1 coverage (freeze, bounced derivation, token discipline, cascade hazard, remaining fidelity items) therefore carries over intact; re-spot-checked the file at HEAD against the round-1 findings and found no new deviation.
- **No new regressions from the added utilities:** `leading-none` on the four spans tightens only their own line boxes (children inherit line-height 1; the LED dots are fixed-height blocks, unaffected); GateCell/ValidationBadge/BudgetMeter deliberately untouched, consistent with round 1's non-finding dispositions (fixed `h-[22px]` + `items-center`; residual `text-xs` meter value unpinned by scope).
- **Acceptance re-run at HEAD (fresh `npm install`, Node 26):** `npm run typecheck` ✓; `npm test` 127 passed / 1 skipped ✓ (AC5.2). Greps on `chips.tsx` at HEAD: `@keyframes`/`animation-` → zero, `rounded-lg`/`rounded-md` → zero. `vite build` succeeds; compiled-CSS assertions above made against that build. AC5.1 (playwright) again not re-run: the delta is className-only with no e2e-visible strings or hooks — same justification as round 1.
- **Boundary check:** e13b5f0 touches `frontend/packages/web/src/components/chips.tsx` (in surface) and `runs/fleetview-design/tasks/04-status-components.yaml` — the yaml change is a pure append to `notes:`, which `contracts/work-item.yaml` declares append-only during the run; not a boundary violation. No other files.

No new findings. Both round-1 findings genuinely resolved.
