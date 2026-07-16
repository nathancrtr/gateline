# Review Report: 09-run-screen

<!-- Filed as review-10.md: the dispatch expected review-08.md, but
     concurrently-dispatched reviewers claimed review-08 (06-inbox-screen,
     commit feb8ec4) and review-09 (08-metrics-screen) between this review's
     dispatch and its write; next free number used to preserve the audit
     trail. -->

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** commit `8ad4253` on `run/fleetview-design`

## Findings

### F1 — blocking (repo integrity / process — NOT a defect in the reviewed diff) — the git index and worktree currently carry an uncommitted revert of this task's (and two sibling tasks') landed restyles
- **Where:** staged index + worktree on `run/fleetview-design`: `frontend/packages/web/src/pages/run.tsx`, `inbox.tsx`, `metrics.tsx`; `runs/fleetview-design/tasks/06-inbox-screen.yaml`, `08-metrics-screen.yaml`, `09-run-screen.yaml` (notes blocks stripped, −115 lines)
- **Failure scenario:** verified blob-exact — the index blob for `run.tsx` (`8911ef4`) equals `8ad4253^`'s pre-restyle blob (HEAD holds `8ad4253`'s `4c796ea`); the index blobs for `inbox.tsx` and `metrics.tsx` equal `7733198^` and `658061d^` respectively (the pre-restyle parents of tasks 06 and 08); the three task-yaml stagings delete the implementer-notes audit trail. The worktree matches the index (no unstaged delta), so this is the second occurrence of review-07 F1's pattern (`9a69fde`), caught one step earlier — staged but not yet committed. Consequences if not resolved: (a) any commit made from this index — including a routine state/review commit by any agent — silently reverts three tasks' landed work under an unrelated commit message; (b) any AC5.1/AC5.2 verification run right now exercises the reverted worktree code, not HEAD, so its results are void for tasks 06/08/09.
- **Requirement:** R5/R6 held-at-HEAD (AC5.1–5.3, AC6.1, AC6.4 for tasks 06/08/09 all die if this lands); process invariant that no agent modifies code outside its task's contact surface.
- **Disposition:** requires orchestrator/human intervention — unstage and restore the six paths to HEAD (e.g. `git restore --staged --worktree <paths>`) before any further commit on this branch, and identify which agent process staged the revert (same actor pattern as `9a69fde`?). Not addressable by an implementer round on task 09; per this reviewer's role I have modified nothing and unstaged nothing.

### F2 — minor, PLAUSIBLE — capped tone applied to the status word makes a completed task read as failing; mockup tones only the round count
- **Where:** `frontend/packages/web/src/pages/run.tsx:190,194` (at `8ad4253`)
- **Failure scenario:** a task with `status: 'done'` and `review_rounds >= 3` (a real outcome: capped, then human-approved and finished) renders "done" in bad 700 instead of ok — reads as a failure state. The mockup (`run-artifacts.html` `.task .st.done` unconditional ok; only `.rounds.cap` bad 700) never tones the status word; the task scope's "status word toned (… capped = bad 700)" wording sanctions the implementation. Scope-vs-mockup ambiguity, cosmetic only; for the task-11 coherence pass or G2 to adjudicate, not an implementer bounce.
- **Requirement:** AC6.1 fidelity (marginal).

## Coverage

Checked clean at `8ad4253`, class-by-class against `design/candidate-b/run-artifacts.html` and `run-history.html` and plan C1/C2/C3 (not the implementer's notes):

- **R6 fidelity — run head:** mono 600 20px slug, +0.06em, no uppercase, 16px pb / 20px mb, 1px line bottom border, 14px gaps, right group at 16px gap with mono faint `source · ref` (`.runhead` exact; ref 12px vs mockup 11px — noise) ✓. PhaseChip/GateLedger/BudgetMeter consumed from chips.tsx as-is ✓.
- **Malformed-state banner:** bad-soft, 1px bad border, 5px radius, 13px/600 bad title, 12px muted detail, raw-yaml `pre` on bg-inset at 4px radius, mono 11.5px/1.5 (`.banner`/`.banner pre` exact) ✓; still rendered above the items, never reviewable ✓.
- **Signal panel (NeedsYouCard):** bg-surface, 1px accent border + 3px accent left rail (`border border-l-[3px] border-accent`), 6px radius, 16/18px padding, `.pulse-panel` carried by class name only — the C1-sanctioned panel pulse ✓. Bounced branch: bad border + bad rail via the same border classes, motion class omitted entirely, and the static `0 0 0 1px var(--color-bad-soft)` ring is the mockup's own `.signalpanel.bounced` box-shadow (zero blur — not a glow) ✓. Title sans 600 15px, detail muted 76ch cap, `waiting <age>` AgeBadge with the existing 3-day urgent threshold, packet tags mono 11px on bg-inset (1px line, 4px radius, hover accent text+border), packet filter and link targets unchanged, `DecidePanel` consumed unmodified with the same `primary` findIndex logic ✓. `data-needs-card` preserved ✓.
- **Sole-live-object AC:** `.pulse-panel` on the reviewable card is the file's only animated class; all other glows are static (`0 0 10px var(--glow)` on transition nodes per the mockup; chips' LED glows owned by task 04) ✓.
- **Task board:** 5px-radius chips, bg-surface, 1px line border, mono id, done=ok / wip=muted status tone, round count mono tabular faint with bad-700 at `>= 3` (mockup `.rounds.cap`; upgraded from the old 600 to the mockup's 700) ✓. Status-word capped tone: see F2. Chip text content unchanged.
- **Tabs:** mono 600 12px uppercase +0.06em, 10px/16px padding, `-mb-px`, 2px accent bottom border on active, 18px mb (`.tabs`/`.tab` exact), identical `setTab`/param logic ✓. Diff tab content untouched beyond its loading skeleton (task 10's surface respected).
- **ArtifactsTab rail:** 4px-radius mono 12px buttons, hover raised, selected accent-soft + accent 600, ValidationBadge consumed as-is, path/selection logic unchanged ✓. **ArtifactBody:** 1px line, 6px radius, 76ch cap, surface; failing-contract banner bad-soft + 1px bad border + 5px radius with the string verbatim ✓.
- **HistoryTab:** geometry is a near-exact transcription of `.log`/`.ev` — 2px line spine (`before:w-0.5 before:bg-line`, 6px inset top/bottom), 10px round nodes (bg-inset + 2px faint border) at left 2px, transition nodes accent-filled with static `0 0 10px var(--glow)` + mono 11px accent `→ phase` stamp; transition detection is the same expression as before (`Boolean(...)` hoist, no semantic change); when 11.5px mono tabular faint, subject 13px truncating, author 11.5px muted right, oid 11px mono faint; hairline dividers with last-row suppression ✓.
- **Loading branches:** `LoadingSkeleton` renders 3 `.skel` lines at the run-artifacts mockup's exact geometry (h 14px, w 70/90/60%) above `PageStatus`, inside the three existing `isLoading` branches only ("Reading run…", "Reading artifact…", "Computing diff…" verbatim); error/empty/merged branches stay bare `PageStatus` ✓ (run-history's loading demo uses 88/72/80% widths — one shared shape chosen; sub-noise).
- **Token/motion discipline (grep AC):** grep of the committed file: no `@keyframes`, no `animation` token at all; only C1 token names + `.pulse-panel`/`.skel`; the two arbitrary shadows use `var(--glow)`/`var(--color-bad-soft)` statically; `transition-colors` occurrences are pre-existing/hover-sanctioned (C2) ✓.
- **C3 freeze:** `RunPage` export signature unchanged; imports unchanged; `e`/`Escape` handlers, `useKeys` wiring, tab/param handling, query keys byte-identical; every user-visible string verbatim; conditional additions limited to skeleton markup in existing `isLoading` branches plus style-only ternaries. AC6.3: no route, no new endpoint. AC6.4: no change to reviewable/decide semantics (bounced card still renders DecidePanel's no-approval flow untouched).
- **R5 (AC5.1/AC5.2/AC5.3):** not independently executed (per role, git-only — and per F1 the current worktree carries the reverted code, so a run here would test the wrong tree). Implementer evidence assessed: typecheck clean; the 2 vitest failures are in `packages/orchestrator` (gpg-sandbox and dispatch-timeout), which does not depend on `packages/web`; the playwright flake was A/B-isolated by the implementer via stash/rerun reproducing identical failures with the unmodified file, with a credible root cause (concurrent worktrees racing on hardcoded PORT=4399 in the frozen `smoke.spec.ts`). Credible but on trust — G2/verifier must re-run AC5.1/5.2 serially on a restored tree (F1 disposition first). Keyboard model unchanged by inspection (AC5.3).
- Not assessed: rendered output in a browser; light-theme glow contrast (task 11's coherence pass).

## Boundary check

Code changes confined to `frontend/packages/web/src/pages/run.tsx` — exactly the declared `file_contact_surface`. `decide.tsx` and `chips.tsx` untouched by `8ad4253` (commit stat lists only `run.tsx` + the task yaml). The commit also appends a round-1 implementer-notes block to `runs/fleetview-design/tasks/09-run-screen.yaml` — the sanctioned report-back channel consistent with prior tasks; not a boundary violation. (That notes block is among the deletions currently staged — F1's damage.) In bounds.
