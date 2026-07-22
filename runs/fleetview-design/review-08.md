# Review Report: 06-inbox-screen

<!-- Filed as review-08.md: the dispatch named review-05.md, but concurrent
     reviewers had already committed review-05 (03-shell-masthead), review-06
     (04-status-components), and review-07 (07-portfolio-screen); next free
     number used to preserve the audit trail. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** 773319829d8db3130eab66b66380aee7438b7986 (branch `run/fleetview-design`)

## Findings

### F1 — minor — hovering the selected row swaps its accent-soft wash for `bg-raised`, unlike the mockup
- **Where:** `frontend/packages/web/src/pages/inbox.tsx:27-28`
- **Failure scenario:** pointer hovers the keyboard-selected row → Tailwind's
  hover-variant layer overrides `bg-accent-soft`, so the selection wash flips to
  raised gray while hovered; in `candidate-b/inbox.html:67-70` `.item.sel` wins the
  cascade and stays accent-washed. Selection stays legible via the 3px accent rail
  and accent title, so no information is lost — a fidelity delta for the task-11
  AC6.1 record, not a blocker.
- **Requirement:** AC6.1 / plan C2 (mockups are the authority)

### F2 — minor — title/slug baseline gap is 8px (`gap-2`) vs the mockup's 4px `.tline` gap (PLAUSIBLE)
- **Where:** `frontend/packages/web/src/pages/inbox.tsx:34`
- **Failure scenario:** PLAUSIBLE — a strict AC6.1 side-by-side records a 4px
  spacing deviation on every row's title line; no functional or legibility
  consequence constructible. Task-11 coherence pass can normalize or accept.
- **Requirement:** AC6.1 / plan C2

## Coverage

Verification ran against the frozen commit in a detached worktree at `7733198`
(the live working tree carries unrelated uncommitted edits to `inbox.tsx` and task
yamls from concurrent tasks; nothing here was judged from the dirty tree).

- **R5 acceptance commands, run by me, all green:** `npm run typecheck` (both tsc
  projects) ✓; `npm test` — 127 passed / 1 skipped, including the orchestrator
  suites the implementer's notes reported as timing out (did not reproduce here;
  environmental, not a regression) ✓; `npm run build -w @agentic/web` +
  `npx playwright test` — 5/5 smoke tests pass unmodified, including the inbox
  oldest-first/"Bounced" assertions (AC5.1) ✓.
- **AC5.3:** the run-page keyboard smoke (`smoke.spec.ts:72-83`) passes; the inbox
  `j`/`k`/`↵` handlers, their `useMemo` deps, and the `useKeys` wiring are
  byte-identical to the parent commit (the diff touches only className strings and
  adds loading markup). No smoke test presses `j`/`k`/`↵` on the inbox and no
  interactive browser was available here — code inspection is the substitute;
  task 11's manual check remains the closing evidence.
- **C3 freeze:** `itemHref`, `InboxPage`, `PageStatus` signatures unchanged;
  `data-inbox-row`, `aria-current`, row link targets preserved; every user-visible
  string verbatim — the bounce line, "Reading repositories…", "Could not load the
  inbox:", "nothing waiting" / "N waiting · oldest first", "j/k move · ↵ open",
  "Inbox zero." and its sub-line. The skeleton markup is a render-only addition
  inside the existing `isLoading` branch (sanctioned); no other conditional logic
  changed. `PageStatus` renders no skeletons and stays the static centered line
  (13px, bad variant intact) — its restyle propagates to portfolio/metrics/run
  consumers as this task's sanctioned ownership.
- **Token/motion discipline (grep floor):** zero `@keyframes`/`animation` matches
  in `inbox.tsx`; motion enters only via `.skel` (3 uses, loading branch). Every
  color utility resolves to a C1 token (`accent-soft`, `raised`, `line`,
  `surface`, `faint`, `muted`, `bad`, `accent`); shapes per C2 (5px panel radius,
  `rounded-full` skeleton pill, no `rounded-lg`/`rounded-md` remaining).
  `transition-colors` without an explicit 140ms matches the convention in the
  already-approved 03/05/10 diffs.
- **Candidate-b fidelity (`design/candidate-b/inbox.html`):** readout head (mono
  600 20px/1 uppercase +0.14em, 1px line bottom border, 14px pad / 22px margin,
  sans-muted meta + mono-faint keys at 11px) ✓; single instrument panel with
  hairline-divided rows, 12/14px row padding, 3px transparent rail, hover raised,
  selection = accent-soft + accent rail + accent title ✓; type scale 13.5/11/12px
  and 78ch detail cap ✓; bounce line 600 bad ✓; empty state (accent glyph
  "— ·· —" at 18px/.2em, 15px 600 lede, muted sub, no dashed box) ✓; skeleton rows
  match the mockup's exact dimensions (44×22 pill, flexible 14px line, 36×16
  block, hairline-divided, status text beneath) ✓. Caveat for the AC6.1 record:
  the acceptance line's "LED signal chips" and the inset age chip live in
  `chips.tsx` — task 04-status-components' surface, still old-style at this commit
  (and under its own request-changes round, review-06.md) — the screen's full
  mockup match closes only when 04 lands; not attributable to this diff.
- Not assessed: reduced-motion end-to-end and light-theme glow (task 11's explicit
  checks); token color values/contrast (task 02, already reviewed in review-01).

## Boundary check

Inside the surface. The commit touches
`frontend/packages/web/src/pages/inbox.tsx` (the declared `file_contact_surface`)
plus an append to its own `runs/fleetview-design/tasks/06-inbox-screen.yaml`
`notes:` — the implementer's sanctioned reporting channel per prior rounds
(review-04 precedent). No other file in the `7733198` diff; `git show --stat`
confirms two files only.
