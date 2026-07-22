# Review Report: 11-integration-verification

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 88f8d0f (branch run/fleetview-design)

## Findings

### F1 — minor — AC5.3/AC6.4 "manual" checks were scripted Playwright sessions, not hands-on-keyboard
- **Where:** `runs/fleetview-design/tasks/11-integration-verification.yaml:137-139, 194-199`
- **Failure scenario:** none constructible against behavior — the same key events and raw HTTP
  responses the spec's manual check would exercise were driven end-to-end in a real browser and
  captured (409 body matches `frontend/packages/core/src/local-source.ts:213` verbatim). Method
  substitution only, disclosed in the notes; the G2 human should explicitly accept it.
- **Requirement:** spec AC5.3, AC6.4 ("manual check")

### F2 — minor — pre-existing esc-while-deciding defect confirmed real; needs a follow-up outside this run
- **Where:** `frontend/packages/web/src/pages/run.tsx:45`, `frontend/packages/web/src/components/decide.tsx:46-53`
- **Failure scenario:** open decline mode on a run's primary card, type a reason, press `esc`
  intending idle → page-level handler navigates to `/`, draft lost. Verified pre-existing:
  `use-keys.ts` and both handlers have zero diff vs main; the race is structural (two window
  keydown listeners on one keypress, `dataset.deciding` synced only by a passive effect — the
  hazard exists whichever way React flushes between the listeners; the notes' "stale value"
  wording gets the direction backwards but the recorded browser observation stands). Correctly
  excluded from task 11 (C3 class-strings-only); route to a new task/issue, not this run.
- **Requirement:** none violated — AC5.3 asks only that the keyboard model be *unchanged*, which it is.

## Coverage

Every repo-checkable claim in the evidence was independently re-verified and found accurate:

- **AC5.4 ✓** — `git diff --stat main...HEAD -- frontend/` is exactly the 9 `file_contact_surface`
  files, 465(+)/266(−), matching the notes verbatim; `smoke.spec.ts`, `api.ts`, `use-keys.ts`,
  and everything under packages/core/server/cli/orchestrator have zero diff. No new token module.
- **AC6.2 ✓** — `web/package.json` declares `react ^19.1.0` / `tailwindcss ^4.1.0` / `vite ^7.0.0`.
- **AC6.3 ✓** — app.tsx diff contains no `<Route>`/`path=` change; `api.ts` frozen; the one
  addition is portfolio.tsx's `runs.length === 0` branch, present in the diff as claimed.
- **Motion floor (ADR-6/Risk 4) ✓** — re-ran both greps: `@keyframes` only in `styles.css:59-67`
  (pulse/pulsepanel/sweep exactly), `animation` only in `styles.css` incl. the reduced-motion
  `animation: none !important` (`styles.css:93`); consumers apply class names only
  (`app.tsx:26`, `run.tsx:145`, `.skel` in inbox/run). Claimed periods (2.4s/2.8s/1.5s) match
  `styles.css:73-83`.
- **AC6.4 mechanism ✓** — the 409 body quoted in the notes matches `local-source.ts:213`
  character-for-character; the CAS-window analysis matches `local-source.ts:157→212`; the cited
  `write-path.test.ts:44` exists as described. The notes' correction of the plan's loose repro
  wording is accurate (a pre-POST commit is read fresh, correctly, and never trips CAS) — the
  two-tab concurrent race satisfies the AC's actual wording ("branch moved underneath the open
  tab"); no spec defect, no escalation needed.
- **AC6.1 fidelity spot-checks ✓** — `GateCell` (`chips.tsx:78`) is exactly the mockup's
  `.cell` recipe (30×22px, 3px radius, mono 11px); signal panel (`run.tsx:144`) is `rounded-md`
  + accent left rail per C2; zero `rounded-lg/xl/2xl` in src (REC5); the one reported deviation
  (rail tagline, `app.tsx:46` vs `candidate-b/inbox.html:112`) is real and accurately scoped as
  copy, not recipe. All six candidate-b mockups exist. OS and both themes named in notes.
- **Task acceptance test 9 ✓** — notes contain command summaries, keyboard + 409 results,
  motion results in both modes, and six per-screen match/deviation lines.
- **Smoke suite shape ✓** — `smoke.spec.ts` has exactly the 5 tests the notes describe, titles
  matching, assertions untouched.

**Not independently re-executed:** the runtime results themselves (npm test 127/127, typecheck,
playwright 5/5, live browser sessions) — this checkout has no `node_modules`/`dist` and the
reviewer runs only git/read. Confidence in them rests on the above: every claim that could be
cross-checked statically, including exact strings, computed-style values, and animation periods
that could not be guessed without running, checked out with zero discrepancies.

## Boundary check

Clean. Commit 88f8d0f touches only `runs/fleetview-design/tasks/11-integration-verification.yaml`
(status + notes — the task's mandated evidence channel). No file under `file_contact_surface`
was edited, consistent with the coherence pass finding no drift; `git diff --stat main...HEAD --
frontend/` is byte-identical to its pre-task-11 state as claimed at the notes' close.
