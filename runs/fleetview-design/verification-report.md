# Verification Report: fleetview-design (full run, G0→G3 scope)

**Change verified:** branch `run/fleetview-design` @ `7bfd0f1` (merge-base with
`main`: `fb22431`) — ux-research, three design candidates, and the candidate-B
("Signal Deck") implementation across 11 tasks.
**Environment:** local, macOS (Darwin 25.5.0), Node v26.3.0, npm 11.16.0,
Chromium via Playwright 1.61.1 (freshly installed for this verification —
`frontend/node_modules` and `dist/` did not exist in this checkout beforehand).
All commands below were run by the Verifier directly, not copied from task
notes; a separate fixture repo (`node fixtures/src/main.ts /tmp/gate-fixture-verify/repo`)
and a standalone server (`node packages/server/src/main.ts --repo ... --port 4501`,
independent of the e2e suite's own fixture/port) were used for every live-browser
check so that findings are not just a re-run of the implementer's own harness.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E2 |
| AC2.1 | verified | E3 |
| AC2.2 | verified | E4 |
| AC2.3 | verified | E5 |
| AC2.4 | verified (with interpretive note) | E6 |
| AC2.5 | verified | E7 |
| AC3.1 | verified | E8 |
| AC3.2 | **failed** | E9 |
| AC4.1 | verified | E10 |
| AC4.2 | verified | E11 |
| AC4.3 | **failed** | E12 |
| AC4.4 | verified | E13 |
| AC4.5 | verified | E14 |
| AC4.6 | verified | E15 |
| AC5.1 | verified | E16 |
| AC5.2 | verified | E17 |
| AC5.3 | verified | E18 |
| AC5.4 | verified | E19 |
| AC6.1 | verified | E20 |
| AC6.2 | verified | E21 |
| AC6.3 | verified | E22 |
| AC6.4 | verified | E23 |

## Evidence

### E1 — AC1.1
```
$ sed -n '3,17p' runs/fleetview-design/ux-research.md
```
Scope names all four brief pages (inbox, run detail, portfolio, metrics) plus
shared components/token layer (`components/chips.tsx`, `src/styles.css`) as the
surveyed surface. Read directly — matches.

### E2 — AC1.2
```
$ ls runs/fleetview-design/design/candidate-{a,b,c}
```
Each of the three directories contains exactly `design-candidate.md` +
`inbox.html`, `metrics.html`, `portfolio.html`, `run-artifacts.html`,
`run-diff.html`, `run-history.html`. Each candidate's Mockups section indexes
all six by filename (spot-checked: `candidate-b/design-candidate.md:14-37`).

### E3 — AC2.1
`ux-research.md` has all five `contracts/ux-research.md`-required sections
(Scope, Patterns, Anti-patterns, Recommendations, Open questions) at lines 3,
18, 74, 138, 166.

### E4 — AC2.2
```
$ grep -noE 'https?://[^ )]*' runs/fleetview-design/ux-research.md
27:https://www.honeycomb.io/blog/design-as-infrastructure
42:https://dev.to/alanwest/tabular-numbers-in-css-font-variant-numeric-vs-monospace-hacks-25cn.
49:https://www.datadoghq.com/blog/datadog-dashboards/.
58:https://linear.app/now/how-we-redesigned-the-linear-ui
68:https://primer.style/foundations/typography.
97:https://freedesignmd.com/blog/shadcn-looks-generic.
111:https://superdesign.dev/blog/why-ai-design-looks-generic.
```
7 distinct external products/categories (issue tracker, design system,
2 observability dashboards, 2 AI-slop teardowns) — well over the ≥3 floor.
(Lines 168-169 are pattern-literal quotes in Open questions, not citations.)

### E5 — AC2.3
Read `ux-research.md:74-136` directly: 5 anti-patterns (A1-A5), each trait-tagged
in prose — A1 "(uniform treatment of every surface)", A2 "(default component
styling)", A3 "(no typographic identity)", A4 "(uniform treatment of every
surface, no spatial identity)", A5 "(default component styling, no spatial
identity)". All four `intent-brief.md:10-12` slop traits are covered by at
least one entry (three of the four are covered twice; "no typographic
identity" only once, on A3 — sufficient, since the AC's floor is coverage, not
double-coverage).

### E6 — AC2.4 (verified, with an interpretive note the reviewer chain also flagged)
```
$ grep -n '^- \*\*REC' runs/fleetview-design/ux-research.md
140:- **REC1** (from A1, A2): ...
145:- **REC2** (from A3, P4): ...
148:- **REC3** (from A4, P3): ...
152:- **REC4** (from A5, P1): ...
157:- **REC5** (from A2): ...
161:- **REC6** (from P2): ...
```
Every P1-P5 and A1-A5 entry carries its own `Source:`/inline URL or file:line
(re-read directly, all present). REC1-REC6 carry **no independent URL or
file:line of their own** — only a `(from P_, A_)` trace, per
`contracts/ux-research.md:33`'s own template. AC2.4's literal text ("every
P/A/REC entry cites a source") is arguably not satisfied by REC entries taken
in isolation; task `01-g1-evidence-audit`'s round-2 note (and its reviewer,
independently) landed on the same reading and resolved it as PASS on the basis
that a REC's trace to an already-cited P/A number satisfies the intent, since
the contract defines RECs as tracing constructs rather than independent
findings. I did not find a stronger basis to overturn that reading, but flag
it here as a genuine interpretive call, not a clean pass — distinct from
AC4.3 (E12), which has no such ambiguity.

### E7 — AC2.5
Scanned all six RECs (`ux-research.md:140-164`) for a named color value,
font-family, or "should look like X" phrase — none found; every entry states a
constraint/caution only (e.g. REC5: "treat ... as a floor to move away from,
not a safe default to preserve").

### E8 — AC3.1
```
$ ls runs/fleetview-design/design/*/design-candidate.md
runs/fleetview-design/design/candidate-a/design-candidate.md
runs/fleetview-design/design/candidate-b/design-candidate.md
runs/fleetview-design/design/candidate-c/design-candidate.md
```
Exactly three files. Each has all six `contracts/design-candidate.md`-required
sections (Thesis, Mockups, Look-and-feel spec, Research traceability,
Ergonomics notes, Implementation notes) — spot-checked at
candidate-b/design-candidate.md:3,14,39,98,129,156.

### E9 — AC3.2 — FAILED (record gap, not an implementation defect)
```
$ git show fdcdbdb -- runs/fleetview-design/state.yaml | grep -A6 'G1:'
+  G1:
+    {
+      approved: true,
+      by: Nathan Carter,
+      at: 2026-07-16T02:54:00.164Z,
+      notes: null,
+      burden: confirmation
+    }
```
The state.yaml G1 entry that actually advanced the run to `implement` carries
`notes: null` — no record that each candidate's thesis reads as distinguishable
from its siblings' at a glance. The only prior G1 note (superseded declined
entry, `git show 1d3babe`) reads: *"Your overall task division is OK, but I do
not want candidate A. I select candidate B."* — a real comparative judgment
between candidates, but it states a preference, not the distinguishability
observation AC3.2 asks to be recorded. `runs/fleetview-design/review-01.md`
(task `01-g1-evidence-audit`, round 2) explicitly and correctly left AC3.2
unassessed as "the G1 human's own check." I checked every artifact under
`runs/fleetview-design/` for an alternate location of this note (no separate
gate-notes file exists) and found none. **This traces to the gate/spec
process, not to any producer's work** — the three candidates *are* textually
distinguishable at a glance (theses: "ledger of record" vs. "live instrument"
... candidate-c's thesis even contrasts itself against A and B by name), so
the underlying judgment was almost certainly made; it just was never written
down in the one place the spec requires it. Escalating to the human for a
retroactive note or an explicit waiver before G2/G3, rather than treating it
as a task to redo.

### E10 — AC4.1
```
$ grep -rlEi 'http://|https://|<script src=|@import url\(' runs/fleetview-design/design/*/*.html
(no output, exit 1)
```
Zero hits across all 18 mockup `.html` files.

### E11 — AC4.2
Live-rendered spot checks (fresh fixture repo, independent server on :4501):
- run-diff "run is merged" empty (done-merged run): renders "Run is merged —
  its change lives in the default branch history now."
- run-diff "no diff" empty (g0-pending run): renders "No diff — the run branch
  matches the default branch."
- run-history "no state history" empty: `grep -n "No state history" pages/run.tsx` → present (line 278).
- metrics "no decisions yet": `pages/metrics.tsx:102` → `no decisions`.
- inbox zero: `pages/inbox.tsx:98` → "Inbox zero."
- portfolio zero-runs: exercised live against a bare fixture with zero runs/
  entries — see E22.
All required-states cells from the R1 table are present per screen (also
confirmed in the mockups directly, e.g. `candidate-b/inbox.html`'s "STATES:
POPULATED (ALL KINDS) / ZERO / LOADING / ERROR" strip and required-states
panel).

### E12 — AC4.3 — FAILED (candidate-b, the selected candidate)
```
$ grep -inE 'lorem|ipsum|foo|bar' runs/fleetview-design/design/*/*.html
runs/fleetview-design/design/candidate-b/inbox.html:57:.railfoot{...}
runs/fleetview-design/design/candidate-b/inbox.html:118:    <div class="railfoot">...
runs/fleetview-design/design/candidate-b/metrics.html:61:.railfoot{...}
runs/fleetview-design/design/candidate-b/metrics.html:91:.bbar{...}
runs/fleetview-design/design/candidate-b/metrics.html:92:.bbar span{...}
runs/fleetview-design/design/candidate-b/metrics.html:133:    <div class="railfoot">...
runs/fleetview-design/design/candidate-b/metrics.html:157,164,171,178: class="bbar"...
runs/fleetview-design/design/candidate-b/portfolio.html:56,135: railfoot
runs/fleetview-design/design/candidate-b/run-artifacts.html:60,183: railfoot
runs/fleetview-design/design/candidate-b/run-diff.html:54,109: railfoot
runs/fleetview-design/design/candidate-b/run-history.html:52,104: railfoot
```
18 case-insensitive substring hits, all in candidate-b (the G1-selected,
built candidate), all traced to the `.railfoot` (rail-foot motto) and `.bbar`
(burden-bar) CSS class names — not lorem-ipsum filler content. A whole-word
`\bfoo\b|\bbar\b` reading returns zero hits. Spec AC4.3's text is a flat,
case-insensitive substring ban ("no ... foo, or bar ... anywhere in the mockup
HTML"), with no whole-word carve-out written into it, so a literal application
fails. This exact defect and both readings were already surfaced and recorded
by task `01-g1-evidence-audit` (round 2, routed to the G1 human as a FAIL
requiring an explicit waiver) — I independently re-ran the grep myself rather
than trust that note, and it reproduces exactly (18 hits, same file:lines).
`state.yaml`'s G1 entry (E9) has `notes: null`, so — as with AC3.2 — no
waiver was recorded when G1 was approved. **Escalating**: this is a spec-vs-
content mismatch already flagged once and correctly not silently waived by
any producer; it needs the human's explicit sign-off (retroactively, or before
G2/G3) rather than a code fix, since the built app does not consume these
mockup class names verbatim (unrelated Tailwind utility classes are used in
`frontend/packages/web/src`).

### E13 — AC4.4
```
$ grep -rliE '\bTBD\b|\bTODO\b|\bXXX\b' runs/fleetview-design/design/*/design-candidate.md
(no output, exit 1)
```
Zero placeholder hits across all three `design-candidate.md` files. Each names
a type stack, both-theme color tokens (`light-dark()` pairs), a spacing rule,
a motion policy, and component shapes (spot-checked in candidate-b at
lines 41-50, 58-67, 69-73, 75-83, 85-96).

### E14 — AC4.5
`candidate-b/design-candidate.md:139-148` states WCAG 2.1 AA contrast ratios in
both themes (ink ≥13:1, muted ~6-6.5:1, accent-as-text ~4.6:1 light/~9:1 dark,
on-solid ≥4.8:1, gate cells/chips/meters/LEDs ≥3:1) and names a deliberate,
argued deferred gap (`--faint` ~3.2-3.4:1, restricted to non-sole-meaning
metadata). Focus order is stated explicitly (same section). Candidates A and C
carry equivalent sections (spot-checked at their own line ranges).

### E15 — AC4.6
`candidate-b/design-candidate.md`'s Research traceability section cites ≥1 P
and ≥1 A/REC and states its one deviation-or-lack-thereof in one line
(confirmed present; candidates A/C likewise per task 01's audit, independently
spot-checked for candidate-b).

### E16 — AC5.1
```
$ cd frontend && npx playwright test
Running 5 tests using 1 worker
  ✓  1 e2e/smoke.spec.ts:39:1 › inbox ranks oldest first and flags bounced packets (3.6s)
  ✓  2 e2e/smoke.spec.ts:47:1 › bounce view renders problems and offers no approval (R3) (1.5s)
  ✓  3 e2e/smoke.spec.ts:55:1 › the pointer decision loop: approve G0 with burden → correct commit (2.1s)
  ✓  4 e2e/smoke.spec.ts:72:1 › the keyboard loop: a → 1 → approve on the primary card (2.5s)
  ✓  5 e2e/smoke.spec.ts:85:1 › portfolio and metrics render (6.4s)
  5 passed (20.2s)
$ git diff main...HEAD -- frontend/e2e/smoke.spec.ts | wc -l
0
```
Assertions unmodified (empty diff), all 5 pass. `data-inbox-row`,
`data-needs-card`, `data-decide="..."` hooks and the R3 bounce assertion hold
by construction (they're what the suite exercises).

### E17 — AC5.2
```
$ cd frontend && npm test
 Test Files  17 passed | 1 skipped (18)
      Tests  127 passed | 1 skipped (128)
$ npm run typecheck
> tsc -p tsconfig.json && tsc -p packages/web/tsconfig.json
(zero output, exit 0)
```

### E18 — AC5.3
Automated (E16, test 4) plus my own independent scripted-browser sessions
against a fresh fixture (not the e2e suite's fixture):
- Inbox `j`/`k`/`↵`: default selection is row 0; first `j` → row 1
  (`aria-current`), second `j` → row 2, `k` → back to row 1, `↵` navigates to
  `/runs/repo/<selected-slug>`. Reproduced live.
- Run page: `e` cycles `?artifact=` (`null` → `intent-brief.md`); `a` opens the
  approve burden picker (`[data-decide="approve-confirm"]` count 1); `1`
  enables the confirm button; `x` opens decline mode
  (`[data-decide="decline-confirm"]` count 1); page-level `esc` (idle, no
  decision open) navigates to `/`.
- `use-keys.ts` has zero diff vs. `main` (`git diff main...HEAD -- frontend/packages/web/src/use-keys.ts` → empty) — the keyboard model is unchanged by construction, not just by observation.

**Beyond the happy path:** confirmed independently (own session, own fixture)
the pre-existing defect task 11/review-11 recorded: pressing `esc` while a
decision mode is open (e.g. decline mode with a draft) does not return to idle
— it falls through to the page-level handler and navigates to `/`, losing the
draft. Reproduced deterministically. `use-keys.ts`, `decide.tsx`, and `run.tsx`
key-handler logic all show zero diff vs. `main`, so this is pre-existing, not
a task-11/round regression, and AC5.3 asks only that the model be *unchanged*
— it is. Recorded here again as a real defect worth a follow-up issue, not a
task-11 or run regression.

### E19 — AC5.4
```
$ git diff --stat main...HEAD -- frontend/
 9 files changed, 465 insertions(+), 266 deletions(-)
 (app.tsx, chips.tsx, decide.tsx, diff-view.tsx, inbox.tsx, metrics.tsx,
  portfolio.tsx, run.tsx, styles.css)
$ git diff --stat main...HEAD -- frontend/packages/core frontend/packages/server frontend/packages/cli frontend/packages/orchestrator
(no output)
$ git diff main...HEAD -- frontend/packages/web/package.json | wc -l
0
```
Exactly the 9 files in `frontend/packages/web/src`; no new shared token module;
no other package touched.

### E20 — AC6.1
Independently rendered (own fixture/server, own Playwright scripts) and
screenshotted the built app in dark mode against `candidate-b/*.html` for
inbox, portfolio, and the run-artifacts pending-decision panel: rail spine
with LED nav dots + pulsing accent count pill, gate-cell ledger (30×22px, 3px
radius, mono numeral + glyph — byte-for-byte matching CSS recipe:
`chips.tsx:78` `h-[22px] w-[30px] ... rounded-[3px]` vs.
`candidate-b/portfolio.html:89` `.cell{width:30px;height:22px;...border-radius:3px}`),
phase LED + budget meter track, and the signal panel (`rounded-md`, 1px accent
border + 3px accent left rail, `.pulse-panel`, visible glow) all present and
matching. Zero `rounded-lg`/`rounded-xl`/`rounded-2xl` anywhere in `src`
(REC5). One deviation confirmed (copy, not recipe, consistent with task 11's
own finding): the rail tagline reads "pipeline decisions" (one line) vs. the
mockup's two-line "fleet console · pipeline decisions" — a content diff, not a
class-recipe drift, and out of any restyle task's remaining scope to touch.
Motion floor (grep, reproduced): `@keyframes` and `animation` appear only in
`styles.css` (pulse/pulsepanel/sweep + the reduced-motion override); zero
hits in any `.tsx` file.
```
$ page.emulateMedia({ reducedMotion: 'reduce' }) then getAnimations() on
  .pulse-glow / .pulse-panel / .skel → 0 running animations each; static
  fallbacks confirmed live: pill stays solid-filled, panel's boxShadow still
  resolves to the static glow-ring value, skeleton keeps its gradient as a
  static block.
```

### E21 — AC6.2
```
$ grep -E '"react"|"tailwindcss"|"vite"' frontend/packages/web/package.json
    "react": "^19.1.0",
    "tailwindcss": "^4.1.0",
    "vite": "^7.0.0"
```

### E22 — AC6.3
```
$ git diff main...HEAD -- frontend/packages/web/src/app.tsx
```
Diff is class-string/JSX-structure only inside `NavItem`/`App` — no `<Route>`
added, no path change. `api.ts` has zero diff. Live-rendered the portfolio
zero-runs branch against a bare repo with no `runs/` at all: renders the
mockup's `[ ]` accent glyph, "No runs found." lede, and
`runs/<slug>`-directory sub-copy — the one behavioral addition, confirmed both
in the diff and live.

### E23 — AC6.4
Two independent live checks against a fresh fixture repo/server, not shared
with the e2e suite:
1. **R3 backstop**, browser session: navigated to a bounced/malformed gate
   item (`/runs/repo/malformed-spec?decide=G0`) — card contains "missing
   required sections" and "no approval is offered"; `[data-decide="approve"]`
   count is 0.
2. **Genuine CAS race** (two browser contexts, same `g3-pending` G3 gate,
   both driven to "confirm" then both `approve-confirm` clicks fired
   concurrently via `Promise.all`):
```
tab A: 409 {"error":"run/g3-pending moved while deciding — re-read and re-present"}
tab B: 200 {"ok":true,"commit":"33c9e0eb...","summary":"Approve G3 and move g3-pending to phase \"done\""}
UI (tab A): role="status" → "The run moved while you were deciding — re-read and decide again. (run/g3-pending moved while deciding — re-read and re-present)"
$ git log --oneline -3 run/g3-pending   # after the race
33c9e0e state(g3-pending): G3 approved by Fixture Operator [burden: confirmation]
75fb938 state(g3-pending): artifacts
2880716 state(done-merged): run complete
```
Single clean commit on top of the pre-race tip — no corruption, no double
commit, the losing write is fully discarded and the human sees the designed
re-present copy rather than a silent failure. This independently reproduces
(with a different fixture repo and a real two-tab race, not scripted single-
tab timing) the mechanism task 11's notes described.

## Beyond the happy path

- Probed the esc-while-deciding interaction directly (E18) rather than take
  task 11's characterization on faith — reproduced the same defect, confirmed
  it pre-exists this run via an empty diff on the handler files.
- Ran the CAS-409 check as a genuine concurrent two-tab race against a fixture
  repo/server I stood up independently, rather than re-running the
  implementer's own session, and captured raw HTTP responses via
  `page.waitForResponse` rather than only the rendered UI.
- Exercised zero-runs, no-diff, run-is-merged, no-state-history, no-decisions,
  and inbox-zero empty states live against fixture runs chosen for exact
  state coverage, rather than only reading the conditional-render code.
- Independently re-ran every grep-based structural check (motion floor,
  `rounded-lg` absence, `lorem/ipsum/foo/bar`, `TBD/TODO/XXX`, URL-citation
  count) myself rather than trusting the recorded task/review numbers, and
  found them accurate except where noted in E9/E12/E6.

## Gaps

- **AC3.2 and AC4.3 fail under a literal reading of the spec** (E9, E12). Both
  were correctly surfaced by the pipeline's own producers/reviewers before I
  started (task `01-g1-evidence-audit` round 2 for AC4.3; review-01.md's
  "not assessed, G1 human's own check" note for AC3.2) — neither is a new
  finding, and neither has a code fix available (AC3.2 is a missing gate note;
  AC4.3 is dead CSS class names in a non-shipped mockup file, in the
  non-consumed candidate-a/c mockups' case not even applicable, only
  candidate-b). Both currently have `state.yaml`'s G1 entry recorded with
  `notes: null` — i.e., no documented waiver exists for either, even though
  G1 was approved. **Escalating both to the human**, since a failure that
  traces to gate documentation/spec wording rather than to a producer's or
  implementer's work is exactly the kind of thing that needs a human decision
  (retroactive gate note, explicit waiver, or spec correction) rather than
  another round of the same task.
- AC2.4 (E6) is verified but rests on an interpretation (RECs satisfy "cites a
  source" by tracing to already-cited P/A findings, per the contract's own
  REC template) that a stricter reading could contest; flagged for
  completeness, not withheld as a failure, since two independent prior passes
  (implementer's round-2 correction, reviewer's re-derivation) already reached
  the same reading and I found no stronger basis to overturn it.
- Everything else in R1-R6 was verified by running the actual system (own
  fixture repo, own server process, own Playwright scripts, own screenshots)
  rather than by re-reading task notes; no criterion outside AC3.2/AC4.3 was
  left as "trust the implementer."
