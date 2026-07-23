# Verification Report: web-staging

**Change verified:** `run/web-staging` @ `f3f487f` (all six tasks review-approved;
includes two verifier-added server tests filling AC4.1/AC1.3 gaps, committed to
this branch)
**Environment:** local (darwin), Node v26.3.0, npm 11.16.0; `frontend/` workspace
after `npm install`; vitest 3.2.7, Playwright (chromium)

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E2 |
| AC1.3 | verified | E3 |
| AC2.1 | verified | E4 |
| AC2.2 | verified | E5 |
| AC2.3 | verified | E6 |
| AC3.1 | verified | E7 |
| AC3.2 | verified | E8 |
| AC4.1 | verified | E9 |
| AC4.2 | verified | E10 |
| AC5.1 | verified | E11 |
| AC5.2 | verified | E12 |
| AC6.1 | verified | E13 |
| AC6.2 | verified | E14 |
| AC7.1 | verified | E15 |
| AC7.2 | verified | E16 |
| AC8.1 | verified | E17 |
| AC8.2 | verified | E18 |
| AC9.1 | verified | E19 |
| AC9.2 | verified | E20 |
| AC9.3 | verified | E21 |

### E1 — AC1.1
```
$ grep -rn "writeTreeWithBlob\|commitTree\|updateRefCAS" frontend/packages/server/src/*.ts
(no output, exit 1)
```
The only mutating routes (`POST /api/decisions`, `POST /api/runs`) call `planDecision`/
`writeState` and `planRunScaffold`/`stageRun` respectively — confirmed by reading
`app.ts`; no git plumbing primitive is referenced in the server package.

### E2 — AC1.2
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > stages a patch-profile run end to end (AC1.2)
 ✓ the staging route pair (R1/R4/R8) > stages a standard-profile run end to end (AC1.2)
 ✓ the staging route pair (R1/R4/R8) > stages a full-profile run end to end (AC1.2)
 Test Files  1 passed (1)   Tests  26 passed (26)
```
Each test reads the resulting `run/<slug>:runs/<slug>/state.yaml` via `git show`
and round-trips it through `parseRunState` with zero errors; the patch case also
validates `tasks/01-<slug>.yaml` via `validateArtifact`, ok:true. E2E slice:
```
$ npm run build && npx playwright test
 ✓ e2e/staging.spec.ts:86:1 › entry + stage: Portfolio → New run → fill the brief → land on the run detail page (AC1.2, AC4.2, AC7.1)
 13 passed (34.6s)
```

### E3 — AC1.3
Verifier-added test (not present in the implementer's own suite) exercising the
server route with two sources configured:
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ POST /api/runs with more than one source configured (AC1.3) > refuses to guess which source when none is named
 ✓ POST /api/runs with more than one source configured (AC1.3) > proceeds without asking once a source is named
```
The negative case asserts `400 {outcome:'refused', reason:'invalid-input', message: 'source is required when more than one source is configured'}`
and no branch created; the positive case (naming `fixture-2`) asserts `201 created`.
Client half confirmed by reading `new-run.tsx:320`: `{sources.length > 1 && (...)}` —
the picker renders only when more than one source is configured.

### E4 — AC2.1
Read `frontend/packages/web/src/pages/new-run.tsx:435-460`: one `<textarea>` per
`sectionEntries` (from `GET /api/staging`'s `briefSections`), `value={sections[heading] ?? ''}`
(empty by default) with an instructive `placeholder` ("Your ... text, in your own
words. Placeholders are never submitted.") — no prefilled prose. E2E:
```
✓ e2e/staging.spec.ts:120:1 › submit stays disabled while a required section is left empty (AC2.1/AC2.2 prevention)
```

### E5 — AC2.2
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > refuses staging with a missing brief section — no branch is created (AC2.2)
```
Response body: `{outcome:'refused', reason:'missing-sections', missing:['Constraints']}`,
`message: 'intent-brief.md is missing required section(s): Constraints'`; asserts
`branchExists('run/<slug>')` is false. Single-truth check confirmed in code: the
server imports `missingSections` from `@agentic/core`
(`frontend/packages/server/src/app.ts`), and the CLI now imports the same function
— no independent re-derivation:
```
$ grep -n "function missingBriefSections\|function normalizeSection\|const SLUG_RE = " frontend/packages/cli/src/main.ts
368:const SLUG_RE = new RegExp(SLUG_PATTERN)   # built from the imported SLUG_PATTERN, not a literal
```
CLI's own suite is unmodified and green: `npx vitest run packages/cli` — 31 tests
passed (includes `new accepts a brief whose H2 differs from the template only in
punctuation/whitespace, matching core validate.ts's normalize (F6)`).

### E6 — AC2.3
```
$ grep -rniE "openai|anthropic|complet(e|ion)|generate.*brief" frontend/packages/server/src frontend/packages/web/src
(no output, exit 1)
```

### E7 — AC3.1
Read `frontend/packages/web/src/pages/new-run.tsx:471-509`: three `<input type="text">`
fields (Source/Ref/URL), each free-text with no dropdown/search/preview; `clientKey`
generated client-side via `crypto.randomUUID()` (not a form field). Server contract
(`StageRequest.intake`) mirrors `RunScaffoldInput.intake` exactly — all four fields
nullable.

### E8 — AC3.2
```
$ grep -rniE "octokit|jira|linear|tracker.*api" frontend/packages/server/src frontend/packages/web/src
frontend/packages/web/src/styles.css:81:  background: linear-gradient(...)
frontend/packages/web/src/styles.css:83:  animation: sweep 1.5s linear infinite;
```
Both matches are the literal word "linear" in pre-existing CSS, confirmed untouched
by this run's diff:
```
$ git diff main...run/web-staging -- frontend/packages/web/src/styles.css
(no output)
$ git show main:frontend/packages/web/src/styles.css | grep -n "linear-gradient\|animation: sweep"
81:  background: linear-gradient(...)
83:  animation: sweep 1.5s linear infinite;
```
Present on `main` already — zero new matches introduced by this run.

### E9 — AC4.1
Verifier-added test (gap in the implementer's suite — no route-level no-identity
test existed for `POST /api/runs`):
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > refuses staging with the no-identity message
   stageRun already returns, and creates no branch (AC4.1)
```
Unsets `user.name`/`user.email` on the fixture repo (mirroring
`core/test/stage-run.test.ts`'s technique), submits `POST /api/runs`, asserts
`400 {outcome:'refused', reason:'no-identity'}`, `message` contains "attributable
to a named human" (stageRun's own wording verbatim), and no `run/<slug>` branch
exists.

### E10 — AC4.2
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > attributes the commit author and
   intake.staged_by to the source identity, never the body (AC4.2)
```
Asserts commit author `'Fixture Operator <operator@example.test>'` and
`state.yaml` contains `staged_by: "Fixture Operator"` — both sourced from
`source.identity()`, never a request-body field (confirmed in `app.ts`: `who =
await source.identity()`). Read `new-run.tsx`: attribution is rendered read-only
from `config.sources[...].identity`; no free-text name input exists.

### E11 — AC5.1
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > arms a staged run over the existing decision path (R5)
```
`POST /api/decisions {source:'fixture', slug, action:'arm'}` → `200`; resulting
commit subject `state(<slug>): armed by Fixture Operator`. No new endpoint: `arm`
rides the pre-existing `POST /api/decisions` route (confirmed no new route added
for arming, `git diff --stat` shows only `GET /api/staging` + `POST /api/runs` as
new server routes). E2E: `✓ e2e/staging.spec.ts:149:1 › arm commits "armed by" and
clears the staged treatment (AC5.1)`.

### E12 — AC5.2
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > refuses arm on a non-staged run with
   planDecision's DecisionError message (AC5.2)
```
`POST /api/decisions` on `g0-pending` (not staged) → `400`, `body.error` matches
`/not staged/`. Web surface: read `decide.tsx` — errors ride the existing
ApiError→Flash path (no silent no-op); confirmed by code, and the e2e task notes
document the client-side no-op-risk was checked by hand (the concurrent-arm e2e
probe was dropped as flaky per ADR-8/task 06's own documented diagnosis, but the
underlying refusal is covered here at the API layer).

### E13 — AC6.1
```
$ npx vitest run packages/core/test/readiness.test.ts --reporter=verbose
 ✓ readiness derivation ... (16 tests)
```
Core test confirms a run with `paused_reason: staged` yields exactly one item of
`kind: 'staged'` (never `'paused'`) with no gate item. Read `decide.tsx:114-143`:
`item.kind === 'paused'` (submits `'resume'`) and `item.kind === 'staged'` (submits
only `'arm'`) are disjoint branches of a discriminated union — no code path can
reach `submitResume` for a staged item. E2E:
```
✓ e2e/staging.spec.ts:131:1 › a staged run renders distinctly and offers only Arm, never Resume (AC6.1/AC6.2)
```
asserting exactly one `[data-decide="arm"]` and zero `[data-decide="resume"]`.

### E14 — AC6.2
Read `frontend/packages/web/src/components/chips.tsx:17-61`: `PhaseChip` renders a
hollow-ring/no-glow/accent-tone treatment (form difference, not recolor) when
`phase==='paused' && pausedReason==='staged'`; `KindChip` renders an outline
`STAGED` pill (`border-accent`, transparent fill) distinct from the solid `PAUSE`
pill — both reuse the existing token set (no new component library, confirmed:
`chips.tsx` is the only file touched for chip rendering). E2E (same run as E13)
asserts the portfolio row and run header show `staged`, not `paused`.

### E15 — AC7.1
```
$ git diff main...run/web-staging -- frontend/packages/web/src/app.tsx
(no output)
```
`app.tsx` (the nav) has zero diff in this run. E2E:
```
✓ e2e/staging.spec.ts:86:1 › entry + stage: Portfolio → New run → ... (asserts nav
  is exactly Inbox/Portfolio/Metrics before following "+ New run")
```

### E16 — AC7.2
```
$ grep -n "PhaseChip|GateLedger|BudgetMeter|DecidePanel" frontend/packages/web/src/pages/run.tsx frontend/packages/web/src/pages/portfolio.tsx
portfolio.tsx:5:import { BudgetMeter, GateLedger, PhaseChip } from '../components/chips.tsx'
portfolio.tsx:113/116/123: <PhaseChip .../> <GateLedger .../> <BudgetMeter .../>
run.tsx:15:import { AgeBadge, BudgetMeter, GateLedger, KindChip, PhaseChip, ValidationBadge } from '../components/chips.tsx'
run.tsx:16:import { DecidePanel } from '../components/decide.tsx'
run.tsx:87/88/105/233: <PhaseChip .../> <GateLedger .../> <BudgetMeter .../> <DecidePanel .../>
```
The staged run's portfolio row and run-detail header render through these same
shared components; no bespoke rendering path was added in the pages for the
staged treatment.

### E17 — AC8.1
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > replaying the same slug+clientKey makes no second commit (AC8.1)
```
Second identical POST → `200 {outcome:'exists', ...}`, branch tip oid unchanged.
E2E: `✓ e2e/staging.spec.ts:167:1 › replaying the same client key reports "already
staged", no second commit (AC8.1)` — asserts `role=status` (informational, not
`role=alert`).

### E18 — AC8.2
```
$ npx vitest run packages/server/test/app.test.ts --reporter=verbose
 ✓ the staging route pair (R1/R4/R8) > refuses a slug already taken by a
   different, non-staged run, naming its branch (AC8.2)
```
`slug: 'g0-pending'` → `409 {outcome:'refused', reason:'slug-taken'}`,
`message` contains `'run/g0-pending'`. E2E: `✓ e2e/staging.spec.ts:198:1 ›
staging a taken slug refuses, naming the existing run, no branch mutation
(AC8.2)` — asserts `role=alert`.

### E19 — AC9.1
```
$ git log --reverse --format="%H %ci %s" -- runs/web-staging/plan.md runs/web-staging/design/ runs/web-staging/ux-research.md
dcc0f5e ... web-staging: ux research memo ...
b404ea1 ... web-staging: design candidate two-voices ...
0b40340 ... web-staging: design candidate genesis-preview ...
baf7065 ... web-staging: plan and task breakdown
```
ux-researcher memo and both designer candidates land before `plan.md`, in that
commit order.

### E20 — AC9.2
```
$ grep -n -A8 "^  G1:" runs/web-staging/state.yaml
  G1:
    { approved: true, by: Nathan Carter, at: ..., notes: I select the `genesis-preview` design., burden: confirmation }
```
G1's notes name the selected candidate (`genesis-preview`), which task 04/05's own
notes confirm they read and built to.

### E21 — AC9.3
```
$ grep -rl "designer\|ux-researcher" roles/ contracts/ registry/
(no output)
$ grep -rn "designer\|ux-researcher" frontend/packages/orchestrator/src/*.ts
(no output)
```

## Beyond the happy path

- Ran the entire workspace suite twice (`npm test`), not just the touched
  packages: 40 files, 369 tests passed, 1 pre-existing skip (`live-smoke.test.ts`),
  0 failed both times — confirming the `InboxKind` union extension (task 02) did
  not silently break an unprobed consumer (the plan's own named risk), and that
  the CLI's byte-identical-behavior claim (task 01) holds under its own untouched
  suite.
- Ran `npm run build` (tsc + vite) clean, and the full `npx playwright test` suite
  (both `smoke.spec.ts` and `staging.spec.ts`) three effective runs (one aborted by
  my own process-management error mid-run — see Gaps — then two clean full passes,
  13/13 both times) confirming no port/fixture cross-talk between the two spec
  files under the default 2-worker config.
- Probed the two acceptance criteria (AC4.1, AC1.3) whose behavior was only
  exercised indirectly by code reading or a lower-layer (core) test in the
  implementers' own suites, not by a test actually driving the server route under
  test — wrote and committed targeted tests for both (see Gaps).
- Confirmed AC3.2's two grep hits are a false-positive match on the literal word
  "linear" in pre-existing CSS (`linear-gradient`, `animation: linear`), present on
  `main` before this run and untouched by this run's diff — not a new match.
- Checked the negative case for AC1.3 explicitly refuses rather than silently
  defaulting to the first configured source (my added test asserts the exact
  `invalid-input` refusal body and that no branch is created), rather than trusting
  the "no ambiguity" claim from code reading alone.

## Gaps

- **AC4.1** and **AC1.3** had no route-level (server or e2e) test in the
  implementers' handoff — AC4.1's no-identity refusal was only tested at the core
  `LocalGitSource.stageRun` layer, and AC1.3's multi-source branch was never
  exercised at all (the fixture app in `app.test.ts` and the e2e fixture both
  configure exactly one source). I wrote and committed two tests
  (`frontend/packages/server/test/app.test.ts`) closing both gaps; both pass.
- The optional two-page concurrent-arm probe (AC5.2's e2e slice) was dropped by
  task 06 as genuinely unstable (documented root cause: `refetchOnWindowFocus`
  removes the needs-card before the second arm's error can be asserted). AC5.2 is
  still verified at the API layer (E12) and by code reading of the client's error
  path; the concurrent-arm *e2e* slice specifically remains unverified — this
  traces to a documented, defensible implementation tradeoff, not a defect.
- One command during this verification (`npx playwright test`) was aborted by my
  own duplicate-process error (a stray background job from an earlier malformed
  command collided with a subsequent clean run on the same fixed ports); it is not
  a product defect — the two clean full runs that followed (13/13 passed each) are
  the evidence cited above.
