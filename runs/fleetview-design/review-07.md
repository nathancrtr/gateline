# Review Report: 07-portfolio-screen

<!-- Numbering note: dispatched as review-05, but concurrently-dispatched
     reviewers wrote review-05.md (task 03-shell-masthead) and review-06.md
     (task 04-status-components) between this review's dispatch and its write.
     Taking the next free number rather than overwriting sibling reports. -->

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** commit `107c0f8` on `run/fleetview-design`

## Findings

### F1 — blocking (repo integrity / process — NOT a defect in the reviewed diff) — branch HEAD no longer contains this task's implementation
- **Where:** commit `9a69fde` ("fleetview-design: review task 10-diff-view round 1") → `frontend/packages/web/src/pages/portfolio.tsx` (whole file)
- **Failure scenario:** `9a69fde`, whose message claims only a review of task 10 with "no findings", also reverted `portfolio.tsx`, `app.tsx`, and `components/chips.tsx` to their pre-restyle state and stripped the implementer notes from `tasks/03-shell-masthead.yaml` and `tasks/07-portfolio-screen.yaml`. Verified: `git diff 107c0f8 HEAD -- frontend/packages/web/src/pages/portfolio.tsx` is the exact inverse of this task's diff, and `git log --oneline -- frontend/packages/web/src/pages/portfolio.tsx` shows only `9a69fde` after `107c0f8`. Consequence: if G2 approves task 07 on the strength of this review and the branch merges as-is, the shipped portfolio is the old generic card with **no zero-runs branch** — the run's single behavioral requirement (R1, AC6.3, Assumption 4) is absent at HEAD, as are the task-03 shell restyle and part of the chips work. AC5.1/AC5.2/AC6.x cannot be considered held at HEAD for the affected tasks. `9a69fde` also violates the reviewer-role rule that reviewers never modify code, and its independent test claim ("127 passed") was produced against a tree missing other tasks' landed work.
- **Requirement:** R1/AC6.3 (zero-runs branch absent at HEAD); process invariant that review commits write only inside `runs/<slug>/`.
- **Disposition:** requires orchestrator/human intervention — restore the three reverted files and the two stripped notes blocks (e.g. revert `9a69fde`'s code and task-yaml hunks, keeping `review-04.md`), and re-examine review-04's approval, which was rendered against a tree carrying unrelated regressions. Cross-task damage; not fixable by an implementer round on task 07.

### F2 — minor, PLAUSIBLE — loading status line rendered outside the skeleton panel; mockup's loading demo keeps it inside
- **Where:** `frontend/packages/web/src/pages/portfolio.tsx:19` (at `107c0f8`; `<PageStatus>` after the panel's closing `</div>`)
- **Failure scenario:** cosmetic only — during load, "Reading repositories…" sits below the bordered panel rather than within it as in `candidate-b/portfolio.html`'s loading demo (`.status` inside `.demo`). The task's own scope wording ("3 skeleton rows … above the preserved PageStatus text") supports the implementation, so this is mockup-vs-task ambiguity at worst; the string and `PageStatus` usage are verbatim/unmodified per C3.
- **Requirement:** AC6.1 fidelity (marginal); resolvable in the task-11 coherence pass.

## Coverage

Checked clean at `107c0f8`, class-by-class against `design/candidate-b/portfolio.html` and plan C1/C2/C3 (not the implementer's notes):

- **R6 fidelity:** page head (mono 600 20px uppercase +0.14em h1, 14px pb / 22px mb, 1px line bottom border, right-aligned 12px muted meta — `.head`/`.head h1`) ✓; instrument panel (1px line, 5px radius, bg-surface, `overflow-x-auto` kept, 820px min-width, 13px table — `.panel`/`.grid`) ✓; thead (bg-inset, mono 600 10px uppercase +0.12em, muted, nowrap, per-column alignment matching the mockup's `.right` set incl. Budget left) ✓ — th vertical padding 10px vs mockup's 9px, below the noise floor; body cells 8×12px with 1px line dividers, last-row suppression, full-opacity `hover:bg-raised` ✓; run link accent 600 hover-underline + mono 11px faint source + 11.5px bad malformed line at 3px offset (`.runname`/`.src`/`.malf`) — exact ✓; numeric cells mono 12px `tabular-nums` right-aligned ✓ incl. `maxRounds >= 3` bad/600 (`.warncell`) ✓; needs pill an exact match of `.needs` (min-w 22px, 3×8px padding, `rounded-full`, mono 700 11px tabular, bg-accent / text-on-solid, static `shadow-[0_0_8px_var(--glow)]`, **no pulse** — C2's nav-count-only pulse respected) ✓; "N esc"/"BAD" mono 11px 600 bad (`.esc`), zero-count em-dash in faint (`.dash`) ✓.
- **R1 zero-runs branch (the run's one behavioral addition):** markup and copy match the mockup's zero-runs demo verbatim — `aria-hidden` decorative mono accent `[ ]` at 18px/+0.2em with 12px offset, "No runs found." sans 600 15px lede, muted 12px sub naming `runs/<slug>` in mono with identical sentence text; a static `runs.length === 0` conditional only — no filtering/sorting/interaction, no state, no new imports; `<table>` absent only in that branch and rendered in every populated case (C3 DOM hook preserved; smoke's `getByRole('table')` → 'done-merged' target intact).
- **Loading branch:** 3 hairline-divided flex rows of `.skel` blocks with the mockup's exact geometry (widths 130/110/150 · 60 · 120@22px · flex-1@14px, 16px gap, 10px vertical rhythm, last-divider suppression); `PageStatus` text "Reading repositories…" preserved verbatim (placement: see F2). Error branch untouched.
- **Token/motion discipline:** only C1 token names (`bg-inset`, `text-on-solid`, `var(--glow)`, line/surface/raised/faint/bad/accent) plus `.skel`; the post-commit file contains no `@keyframes`, no `animation-` property, and no new transition utilities — the task's grep AC holds.
- **C3 freeze:** `PortfolioPage` export signature unchanged; `PhaseChip`/`GateLedger`/`BudgetMeter` and `PageStatus` consumed as-is (`inbox.tsx` untouched); link targets, cell content, column set, `useQuery` wiring, key derivation, and needs/esc/dash ternary logic unchanged; conditional-logic additions limited to the two C3-sanctioned branches (zero-runs, skeletons inside the existing `isLoading`). AC6.3: no route added, no new `api.ts` endpoint called.
- **R5 (AC5.1/AC5.2):** not independently executed by this reviewer (static review against the commit; per role, git only — and per F1 the current tree no longer carries this diff, so a run here would exercise the wrong code). Implementer evidence assessed instead: typecheck clean; the 8 vitest failures are all in `packages/orchestrator` (which does not depend on `packages/web`), so this diff cannot cause them; playwright reported 5/5 on a serial rerun after building the SPA, including the portfolio table assertion. Credible but taken on trust — G2/verifier must re-run both suites on a restored, integrated tree (see F1 disposition).
- Not assessed: rendered visual output in a browser; light-theme contrast of the glow pill (owned by task 11's coherence pass).

## Boundary check

Code changes confined to `frontend/packages/web/src/pages/portfolio.tsx` — exactly the declared `file_contact_surface`. The commit also appends a round-1 implementer-notes block to `runs/fleetview-design/tasks/07-portfolio-screen.yaml`, the sanctioned report-back channel consistent with prior tasks in this run — not a boundary violation. Those notes were subsequently deleted by `9a69fde` (part of F1's damage to the audit trail). In bounds.

---

## Round 2 — 2026-07-21

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit `56e2483` (round-2 delta: task-yaml notes only, no code); resolution verified at branch HEAD `a4a6f36`

### Prior-finding resolution

- **F1 (blocking) — RESOLVED.** Repair commit `b447874` reverse-applied `9a69fde`'s damage: `git diff 107c0f8 HEAD -- frontend/packages/web/src/pages/portfolio.tsx` is empty (byte-identical to the reviewed round-1 diff), `app.tsx` likewise; `chips.tsx` differs from `107c0f8` only by task 04's own round-2 fixes (`leading-none`, `border-transparent` — task 04's contact surface, restored via `e13b5f0` per the repair commit's rationale, not residual damage). Both stripped notes blocks (tasks 03 and 07) restored. Review-04's re-examination is underway (`8ae8e7f`, review 04 round 2) — outside this task. The round-1 caveat that R5 evidence was taken on trust is now discharged: this reviewer independently ran the suites on the restored, integrated tree (see Coverage).
- **F2 (minor, PLAUSIBLE) — CLOSED, decline accepted.** Implementer declined with rationale in the round-2 notes; verified accurate against the artifacts: the mockup's `.status`-inside-`.demo` nesting sits in the `.states` showcase gallery (`portfolio.html:220-237` — `.demo` is a labeled documentation box, `portfolio.html:113-114`, not the page's panel; the zero-runs demo is wrapped the same way and nobody reads that wrapper as page chrome), the task scope's own wording ("3 skeleton rows … above the preserved PageStatus text") specifies siblings, and frozen `inbox.tsx:79-80` (C3 — not touchable by this task) already renders `PageStatus` as a sibling below its skeleton panel, so moving it would make the app's two loading states inconsistent. No spec/plan clause is violated; remains available to the task-11 coherence pass if G2 disagrees.

### New findings

None. The round-2 delta is a 49-line append-only notes block in `runs/fleetview-design/tasks/07-portfolio-screen.yaml`; no code changed (`56e2483` stat confirms). Round-1 coverage of the implementation itself stands unchanged since the file is blob-identical.

### Coverage (round 2)

- **Restoration integrity:** `portfolio.tsx` and `app.tsx` at HEAD byte-identical to `107c0f8`; task-yaml notes for tasks 03/07 present at HEAD ✓. (Process note, already remediated upstream of this review: `8ae8e7f` transiently clobbered the round-2 notes — same stale-worktree failure mode as `9a69fde` — and `0bd790d` restored them; notes verified present at `a4a6f36`, worktree clean.)
- **AC5.1/AC5.2 executed by this reviewer on the integrated tree** (not taken from implementer notes): `npm run typecheck` clean; `npm test` (vitest) 127 passed / 1 skipped, 0 failed — confirming round 1's orchestrator-package timeouts were transient contention; `npm run build -w @agentic/web` then `npx playwright test --workers=1` 5/5 passed, including "portfolio and metrics render" (table contains 'done-merged'). All match the implementer's round-2 claims.
- **Grep AC:** `grep -n '@keyframes\|animation-' portfolio.tsx` → no matches (exit 1) ✓.
- Not re-assessed: rendered visual output in a browser; light-theme glow contrast (task 11).

### Boundary check (round 2)

Round-2 commit `56e2483` touches only `runs/fleetview-design/tasks/07-portfolio-screen.yaml` (append-only notes — the sanctioned report-back channel). No code files touched. In bounds.
