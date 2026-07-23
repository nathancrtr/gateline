# Technical Plan: FleetView staging surface — web sibling of `agentic new` / `agentic arm`

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer. Gate: G1.
     Designer candidates (runs/web-staging/design/{genesis-preview,two-voices}/) land
     with this plan; G1 approves the plan and selects one candidate in one decision
     (R9). ADR-7 defines how that selection binds tasks 04/05. -->

## Approach

The run-creation seam is already whole in core: `planRunScaffold` (pure planner,
`core/src/record/scaffold.ts`) plus `RunSource.stageRun` (the only branch-minting
path, `core/src/sources/source.ts` / `local-source.ts`) mint the genesis commit, and
`planDecision`'s `arm` case starts a staged run. This run adds **carriers, not
mechanism**: one new server route pair, one web form, and a corrected rendering of
the staged rest state. Confirmed against the tree: `server/src/app.ts` has no staging
route; `DecisionAction` already includes `'arm'` and `POST /api/decisions` passes it
through to `planDecision` unchanged — so the web Arm control (R5) needs zero new
server code.

Four moves, cut into six tasks:

1. **Hoist the section-completeness check into core** (R2). The CLI's private
   `missingBriefSections` (`cli/src/main.ts:370`) becomes
   `missingSections(content, required)` in `core/src/record/validate.ts`, reusing
   validate's own `normalize`; the CLI and the new server route both call it —
   the single-truth demand of AC2.2. The slug grammar gets the same treatment:
   `SLUG_PATTERN` exported as a regex-source string (the `ID_PATTERN` precedent),
   ending the CLI's duplicated `SLUG_RE` and feeding the web form as data.
2. **A staging route pair on the server** (R1, R4, R8). `GET /api/staging` serves
   the form's configuration — per-source identity, required brief sections from
   `source.templates.read('intent-brief.md')` with `BUILTIN_SECTIONS` fallback, and
   the slug pattern — all as data, keeping core out of the browser bundle.
   `POST /api/runs` validates sections, then calls `planRunScaffold` + `stageRun`
   and maps the existing `StageOutcome` union onto HTTP statuses. No git primitive
   is touched in the server (AC1.1).
3. **The staged rest state becomes its own readiness kind** (R6). `deriveReadiness`
   currently folds `paused_reason: staged` into the `paused` item, whose card offers
   "Resume run" — a guaranteed `DecisionError` (the Context defect). A new
   `'staged'` member of `InboxKind` makes the wrong affordance unrepresentable:
   the compiler forces `decide.tsx`, `chips.tsx`, and `itemHref` to branch, and the
   staged branch's only affordance is a confirm-stepped Arm issuing
   `POST /api/decisions {action:'arm'}` (R5). The orchestrator does not consume
   `InboxKind` (verified by grep), so the union extension ripples only into web.
4. **The form lives inside Portfolio** (R7). Entry button in the Portfolio header
   plus the empty state; the form is a child route `portfolio/new` under the
   existing router — the nav in `app.tsx` is untouched (AC7.1). The client
   assembles `intent-brief.md` from one textarea per required section (structure
   from the contract, words from the human — R2) and renders the four-way outcome
   taxonomy (fresh / replay / collision / no-identity) the ux memo's P6 and R8
   demand, with server wording displayed verbatim on refusal.

Both design candidates share this architecture; their delta is confined to the
form's presentational composition (ADR-7). Verification rides the existing
harnesses: vitest for core/server, `npm run typecheck`, and a new Playwright spec
that drives stage→render→arm end-to-end against a generated fixture repo — the web
package has no unit-test harness today and this run does not invent one.

**Environment (probed).** Node ≥ 24 (workspace `engines`; core runs TS source via
type stripping, no build step), vitest 3.2, Playwright 1.61 with `testDir: ./e2e`
and a fixed `baseURL` port 4399 owned by `smoke.spec.ts` (a second e2e file must
run its own server/port — see task 06 and Risks), Hono server, React 
web app built by Vite. All commands run from `frontend/`.

## Interface contracts

### Core additions (task 01)

```ts
// core/src/record/validate.ts
/** Required section headings absent from `content` (normalize-insensitive).
 *  The single section-completeness truth for CLI and server (AC2.2). */
export function missingSections(content: string, required: string[]): string[]

// core/src/record/scaffold.ts
/** Slug grammar as a regex source string (ID_PATTERN precedent) — SLUG_RE
 *  is built from it; carriers ship it to clients as data. */
export const SLUG_PATTERN: string // '^[a-z0-9][a-z0-9-]*$'
```

### Readiness (task 02)

```ts
// core/src/view-model/readiness.ts
export type InboxKind = 'gate' | 'escalation' | 'round-cap' | 'paused' | 'staged' | 'malformed'
// When state.phase === 'paused' && state.paused_reason === STAGED_REASON, emit
// (instead of today's 'paused' item):
// { kind: 'staged', gate: null, title: 'Run staged: awaiting arm',
//   detail: 'Arm to start the run — dispatch begins and the budget starts metering',
//   reviewable: true, problems: [], packet: ['state.yaml', 'intent-brief.md'],
//   escalationIndex: null, since: <lastTouched state.yaml> }
```

### Server routes (task 03)

```
GET /api/staging → 200
{ sources: [{ id: string,
              identity: { name: string, email: string } | null,   // source.identity()
              briefSections: string[],   // extractSections(template) ?? BUILTIN_SECTIONS['intent-brief.md']
              briefTemplate: string | null }],
  slugPattern: string }                  // core SLUG_PATTERN

POST /api/runs   body (stagedBy is never accepted from the client — AC4.2):
{ source?: string,            // required iff >1 source configured (AC1.3)
  slug: string, title: string, profile: 'patch'|'standard'|'full',
  briefMarkdown: string,      // client-assembled intent-brief.md (ADR-5)
  costLimitUsd: number | null,
  intake: { source: string|null, ref: string|null, url: string|null, clientKey: string|null } }

Responses (body always carries the outcome; the form branches on it, ADR-1):
  201 { outcome:'created', slug, branch, commit, pushFailed? }        // fresh success
  200 { outcome:'exists',  slug, branch }                             // benign replay (AC8.1)
  409 { outcome:'refused', reason:'slug-taken'|'conflict', message }  // AC8.2 / CAS race
  400 { outcome:'refused', reason:'no-identity', message }            // stageRun's message verbatim (AC4.1)
  422 { outcome:'refused', reason:'missing-sections', missing: string[], message }
      // message: `intent-brief.md is missing required section(s): <missing.join(', ')>` — displayed verbatim (AC2.2)
  400 { outcome:'refused', reason:'invalid-input', message }          // ScaffoldError text, missing body fields, unknown source
Route order: sections check → planRunScaffold → stageRun → cache.bump() on 'created'.
```

### Web API client (task 04)

```ts
// web/src/api.ts
export interface StagingSourceConfig { id: string; identity: { name: string; email: string } | null; briefSections: string[]; briefTemplate: string | null }
export interface StagingConfigResponse { sources: StagingSourceConfig[]; slugPattern: string }
export interface StageRequest { source?: string; slug: string; title: string; profile: Profile; briefMarkdown: string; costLimitUsd: number | null; intake: { source: string | null; ref: string | null; url: string | null; clientKey: string | null } }
export type StageOutcomeView =
  | { outcome: 'created'; slug: string; branch: string; commit: string; pushFailed?: string }
  | { outcome: 'exists'; slug: string; branch: string }
  | { outcome: 'refused'; reason: 'slug-taken' | 'conflict' | 'no-identity' | 'missing-sections' | 'invalid-input'; message: string; missing?: string[]; status: number }
api.stagingConfig(): Promise<StagingConfigResponse>
api.stage(req: StageRequest): Promise<StageOutcomeView>  // refusals resolve as values (the taxonomy is UI, P6); network/unknown errors throw ApiError
```

### Web rendering seams (tasks 04/05)

- Router: `{ path: 'portfolio/new', element: <NewRunPage /> }` added to the
  existing children in `main.tsx`; nav in `app.tsx` untouched (AC7.1).
- `PhaseChip` (`chips.tsx`): when `phase === 'paused' && pausedReason === 'staged'`,
  render the staged treatment — hollow ring marker (border, transparent center, no
  glow), label `staged`, accent tone; mid-flight paused unchanged. Form difference,
  not recolor (AC6.2; both candidates specify hollow/outline).
- `KindChip`: `kind === 'staged'` → outline pill labeled `STAGED`
  (`border-accent text-accent`, transparent fill, hollow marker).
- `DecidePanel` (`decide.tsx`): new `staged` branch — idle offers only
  `Arm run…` (primary); confirm step states consequences and submits
  `{ action: 'arm' }` via the existing `api.decide` mutation; pending label
  `Committing…`; errors ride the existing ApiError→Flash paths (409 keeps the
  conflict posture). The `paused` branch is unreachable for staged items by type.
- `itemHref` (`inbox.tsx`): `kind === 'staged'` → `?decide=staged`.

## Decisions (ADRs)

### ADR-1: Staging is `POST /api/runs` + `GET /api/staging`, with outcomes in the body
- **Choice:** One mutating route `POST /api/runs` (create-in-collection beside the
  existing `GET /api/runs`) calling `planRunScaffold` + `stageRun`, plus a read-only
  `GET /api/staging` for form configuration. Every response body carries the
  `outcome` discriminant; HTTP status is secondary routing.
- **Rejected:** Overloading `POST /api/decisions` with a `stage` action — 
  `planDecision` is a mutation of an *existing* state document (it takes a parsed
  `RunState`); staging births one. Forcing it through the decision grammar would
  fake a state read that doesn't exist and tangle `DecisionError` semantics with
  `StageOutcome`. Also rejected: outcome-as-status-only — the form must distinguish
  five outcomes (R8, ux P6), and 400-vs-409 alone can't carry `missing[]` or
  replay-vs-collision.
- **Consequences:** The server grows a second mutating route (see ADR-2). The web
  client resolves refusals as values, not exceptions, so the outcome taxonomy is
  rendered, never toasted generically (ux A5).

### ADR-2: The single-write-path rule becomes "every mutation rides its core seam"
- **Choice:** `app.ts`'s header comment ("POST /api/decisions is the only mutating
  route") is amended by task 03: two mutating routes, each a thin carrier over its
  sanctioned core seam — decisions over `planDecision`/`writeState`, staging over
  `planRunScaffold`/`stageRun`. No route composes `sources/git.ts` primitives
  (AC1.1's grep stays clean).
- **Rejected:** Preserving the letter of the old rule by tunneling staging through
  `/api/decisions` (see ADR-1), or having the server call git primitives directly —
  the latter is exactly the parallel branch-minting path R1 forbids.
- **Consequences:** The webhook precedent already framed the rule this way ("not a
  second write path — rides writeState"); the comment now says what the invariant
  actually is. Reviewers judge future routes by "which core seam carries this?".

### ADR-3: Section completeness hoisted to core, not re-derived and not `validateArtifact`
- **Choice:** Move the CLI's `missingBriefSections` into
  `core/record/validate.ts` as `missingSections(content, required)`, built on the
  module's own private `normalize` (deleting the CLI's deliberately-mirrored copy
  and its drift-warning comment); CLI and server both import it.
- **Rejected:** A server-local reimplementation — AC2.2 bans re-derivation by name,
  and the CLI file itself documents the drift hazard its mirror created. Also
  rejected: using `validateArtifact('intent-brief.md', …)` in the staging route —
  it is per-artifact-path keyed, re-reads the template inside every call, and
  reports template-fallback notes the route doesn't want; the staging flow already
  holds the resolved section list (it serves the same list to the form), so the
  narrow shared primitive is the honest unit. `validateArtifact` keeps using
  `extractSections` internally; behavior elsewhere is unchanged.
- **Consequences:** One function is the section truth for CLI, server, and (as
  transported data) the web form. The client-side pre-check may only disable
  submit; displayed refusal wording is the server's `message` verbatim (ux A8).

### ADR-4: Staged is a new `InboxKind`, not a flag on `paused`
- **Choice:** Extend the union with `'staged'` and emit it from `deriveReadiness`
  in place of the `paused` item when `paused_reason === STAGED_REASON`.
- **Rejected:** A `stagedRest: true` variant field on the existing `paused` kind
  (AC6.1 allows either) — a flag asks every consumer to remember to check it, and
  the live defect being fixed is precisely a consumer (DecidePanel's paused branch)
  not checking. A union member makes the compiler enforce the branch: `decide.tsx`
  cannot render Resume for staged because staged never enters the paused arm.
- **Consequences:** Web must handle the new kind in `KindChip`, `DecidePanel`,
  `itemHref` (task 05) — typecheck fails until it does, which is the point.
  Verified: the orchestrator has zero references to `InboxKind`/`deriveReadiness`,
  so nothing outside web is touched.

### ADR-5: The client assembles `intent-brief.md`; the server validates the markdown
- **Choice:** The form composes the full brief markdown
  (`# Intent Brief: <title>` + one `## <section>` per required heading with the
  operator's text) and POSTs `briefMarkdown`; the server runs `missingSections`
  on the received markdown.
- **Rejected:** A structured `{ sections: {...} }` wire format with server-side
  assembly — it would mint a second brief-assembly grammar next to the CLI's
  (whose wire form *is* full markdown via `planRunScaffold.briefMarkdown`), and
  the genesis-preview candidate needs client-side assembly anyway to feed its
  live `planRunScaffold` preview.
- **Consequences:** The server validates what it will actually commit (defense
  against a divergent client). An operator-mangled heading fails server-side with
  the named section — correct behavior, not a gap.

### ADR-6: Form configuration ships as data; core value-imports into the browser only for the preview, only from `@agentic/core/record`
- **Choice:** `GET /api/staging` transports sections, identity, and `slugPattern`
  as JSON (the `ID_PATTERN`/lexicon precedent: "the browser must not bundle the
  core runtime"). If G1 selects **genesis-preview**, its live record preview
  value-imports `planRunScaffold` from the `@agentic/core/record` subpath — probed
  browser-safe: the record layer imports only `yaml` + `zod` (no node builtins),
  and `core/test/layering.test.ts` enforces that ceiling permanently.
- **Rejected:** Unconditional value imports (bundle cost with zero benefit under
  two-voices); a per-keystroke server preview endpoint (chatty, and the whole
  point of the candidate's preview honesty is *the same pure function* both
  renders and commits); duplicating the planner in web (drift, ux A8's exact
  failure mode).
- **Consequences:** Under two-voices the browser bundle gains nothing. Under
  genesis-preview it gains `yaml`+`zod` via the record layer; `api.ts`'s
  "TYPE-ONLY imports" comment must be annotated with the record-subpath exception.
  Vite compiling workspace TS is an assumed-safe default — verified as the first
  act of task 04 if genesis-preview is selected (see Risks).

### ADR-7: Candidate selection binds only presentational composition, recorded at G1
- **Choice:** The architecture above is candidate-invariant (both candidates'
  build notes converge on these exact seams). The G1 approval note
  (`gates.G1.notes`, per the spec's recorded assumption) names the selected
  candidate; tasks 04 and 05 read it from `runs/web-staging/state.yaml` at
  execution time and follow that candidate's `design-candidate.md` +
  mockups under `runs/web-staging/design/<candidate>/` for visual composition.
  Cost delta if genesis-preview is selected: one preview panel component inside
  task 04's surface (ADR-6 rider) and a display-only genesis line in the run
  header inside task 05's surface. Nothing else moves.
- **Rejected:** Two task sets (duplicated planning for a one-file delta);
  pre-selecting a candidate in this plan (the selection is G1's decision by R9 —
  pre-empting it would collapse the two-artifact decorrelation the brief paid for).
- **Consequences:** Tasks 04/05 are executable from task+plan+spec plus the run's
  own committed artifacts (state.yaml and design/), which implementers on the run
  branch necessarily have. If G1 approves the plan but the notes name no
  candidate, tasks 04/05 stop and escalate rather than guess.

### ADR-8: E2E mints its runs through the real seam; the shared fixture is not touched
- **Choice:** The new Playwright spec (task 06) generates its own fixture repo and
  stages runs *through the UI under test*, then asserts on the resulting git facts
  (`git show run/<slug>:runs/<slug>/state.yaml`, commit subjects/authors — the
  `smoke.spec.ts` idiom). No staged run is added to `@agentic/fixtures`.
- **Rejected:** Adding a staged fixture run — it ripples count assertions through
  `server/test/app.test.ts` (`runs` = 12) and `e2e/smoke.spec.ts`, cross-cutting
  three task surfaces for zero added coverage: the staging flow itself creates the
  staged state the rendering tests need, and exercising creation is the better test.
- **Consequences:** Task 06's spec is self-contained (own repo, own server, own
  port — 4399 is taken by smoke.spec's server); server-level tests in task 03
  cover the API without any UI. Core readiness tests (task 02) use core's own
  `fixture.helper.ts`, unaffected.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 (web-reachable staging, one write path) | 03, 04, 06 |
| R2 (structure-only human brief, refusal) | 01, 03, 04, 06 |
| R3 (free-form intake only) | 03, 04 |
| R4 (attribution parity) | 03, 04, 06 |
| R5 (arm on the existing decision path) | 05, 06 |
| R6 (staged rest state distinct + correct) | 02, 05, 06 |
| R7 (existing vocabulary, no new page) | 04, 05 |
| R8 (idempotent, distinguishable outcomes) | 03, 04, 06 |
| R9 (design prototyping precedes plan) | Process requirement, discharged before this plan: AC9.1 is satisfied by the run's commit history (ux-research.md and both design/ candidates precede plan.md); AC9.2 lands with the G1 decision itself; AC9.3 is enforced as a negative constraint on every task — no task's `file_contact_surface` leaves `frontend/` (verified per task; the spec's grep target stays clean). |

Parallelism: **01, 02, 04 start immediately** (disjoint surfaces); 03 after 01;
05 after 02 (and parallel with 03/04 — surfaces disjoint); 06 after 03+04+05.

## Risks

- **Vite bundling of `@agentic/core/record` TS source (genesis-preview only).**
  Assumed-safe (Vite/esbuild compiles workspace TS), but unproven in this repo
  because web has never value-imported core. Early signal: task 04 runs
  `npm run build` immediately after adding the import, before building the form.
  Fallback (plan amendment): compute the preview server-side in `GET /api/staging`-style
  read route.
- **E2E port/worker interference.** `smoke.spec.ts` hardcodes port 4399 and the
  config `baseURL`; Playwright may run spec files in parallel workers. Task 06
  must use its own port + fixture repo and `test.use({ baseURL })`. Early signal:
  flaky cross-file failures in `npx playwright test` locally.
- **Spec grep-guards match innocent wording.** `complet(e|ion)` matches
  "autocomplete"/"completeness" in code or comments; new matches in
  `frontend/packages/{server,web}/src` fail AC2.3. Tasks 03/04/05 must run the
  spec's three grep commands before handoff and choose wording accordingly
  ("suggest", "filled", "all sections present").
- **Cache staleness after staging.** A freshly staged run must appear when the
  client navigates to its run page (ux REC12). `cache.bump()` on `created` plus
  the client's `invalidateQueries` covers it; early signal: e2e 404 on the
  post-stage navigation.
- **InboxKind extension breaking un-probed consumers.** Grep says only web consumes
  it, but `npm run typecheck` spans all packages and is the backstop; task 02's
  acceptance includes a full-workspace typecheck run.
- **Candidate note absent at G1** (ADR-7): tasks 04/05 escalate instead of
  guessing; the run pauses rather than shipping an unselected design.
