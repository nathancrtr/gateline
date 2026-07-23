# Specification: FleetView staging surface — the web sibling of `agentic new` / `agentic arm`

## Context

The run-creation seam (`runs/creation-seam/`) landed on `main`: `planRunScaffold` +
`RunSource.stageRun` (`frontend/packages/core/src/{record/scaffold,sources/source}.ts`)
mint a run's genesis commit, `planDecision`'s `arm` case
(`frontend/packages/core/src/record/actions.ts`) starts a staged run, and both are
exercised today only by the `agentic new`/`agentic arm` CLI carriers
(`frontend/packages/cli/src/main.ts`). Confirmed against the checked-out tree:
`frontend/packages/server/src/app.ts` exposes no staging route, so the brief's claim
holds. One brief claim needs sharpening, not just confirming: a staged run (`phase:
paused`, `paused_reason: staged`) does *render* today — `deriveReadiness`
(`view-model/readiness.ts`) already emits a `paused` `InboxItem` for it, and
`DecidePanel` offers "Resume run" — but clicking that action calls `planDecision`
with `resume`, which explicitly refuses staged runs (`"run is staged, not paused
mid-flight — use \`agentic arm <slug>\`"`). The gap is a broken affordance, not an
absent one; R6 below treats it as a defect to fix, not new rendering to add.

## Requirements

### R1 — Web-reachable run staging
An operator can stage a new run (slug, title, profile, brief, budget, optional
client key) from the web surface, producing exactly the genesis commit
`stageRun` already produces for the CLI — no independent branch-minting logic.

**Acceptance criteria:**
- [ ] AC1.1 — A new server route accepts a staging request and calls
  `planRunScaffold` + `RunSource.stageRun`; grepping `frontend/packages/server/src/*.ts`
  for direct calls to `sources/git.ts` primitives (`writeTreeWithBlob`, `commitTree`,
  `updateRefCAS`) outside the existing `stageRun` implementation returns none.
- [ ] AC1.2 — Given a valid slug/title/profile/brief and a resolvable git identity,
  submitting the web form yields a `run/<slug>` branch whose `state.yaml` (and, for
  `profile: patch`, `tasks/01-<slug>.yaml`) round-trips through `parseRunState`/
  `validateArtifact` with zero errors, checked for all three profiles
  (`git show run/<slug>:runs/<slug>/state.yaml`).
- [ ] AC1.3 — With more than one source configured, the form requires picking one
  before staging; with exactly one, it proceeds without asking.

### R2 — Structure-only, human-authored brief
The web brief editor supplies only the `intent-brief.md` contract's required
section structure — it never drafts Problem/Motivation/Constraints/Out-of-scope
prose — and refuses to stage when a required section is left empty.

**Acceptance criteria:**
- [ ] AC2.1 — The staging form presents one input per required `intent-brief.md`
  section (from `source.templates.read('intent-brief.md')`, falling back to
  `BUILTIN_SECTIONS['intent-brief.md']`), pre-filled with no prose.
- [ ] AC2.2 — Submitting with any required section left blank refuses (no branch,
  no commit) and names the missing section(s), reusing the section-completeness
  check the CLI's `missingBriefSections`/`extractSections` already perform rather
  than a re-derived, potentially diverging check.
- [ ] AC2.3 — This run's diff contains no call to a model/completion API from the
  staging route or form (grep target:
  `grep -rniE "openai|anthropic|complet(e|ion)|generate.*brief" frontend/packages/{server,web}/src`
  returns no new matches).

### R3 — Free-form intake only
The staging surface captures only the operator's own typed pointer text; it
fetches from, renders, embeds, or writes to no external tracker.

**Acceptance criteria:**
- [ ] AC3.1 — The staging form's only intake-related inputs are free-text
  `source`/`ref`/`url` and an optional client key, all nullable — mirroring
  `RunScaffoldInput.intake` — none a dropdown, search box, or link-preview backed
  by an external API call.
- [ ] AC3.2 — This run's diff contains no issue-tracker client, OAuth flow, or
  "browse tickets" UI (grep target:
  `grep -rniE "octokit|jira|linear|tracker.*api" frontend/packages/{server,web}/src`
  returns no new matches).

### R4 — Attribution parity for staging
A staged run is attributable to a named human exactly as `agentic new` requires;
absent a resolvable identity the web surface refuses rather than guessing or
prompting for a typed name.

**Acceptance criteria:**
- [ ] AC4.1 — With the server's configured git identity unset, submitting the
  staging form refuses using the same `no-identity` message shape `stageRun`
  already returns, and creates no branch or commit.
- [ ] AC4.2 — The `stagedBy` value written into `state.yaml`'s `intake.staged_by`,
  and the commit author, both come from `source.identity()` — the staging form
  has no free-text "your name" field.

### R5 — Arm control on the existing decision path
Arming a staged run from the web rides the same `planDecision('arm')` write
`POST /api/decisions` already exposes; the web adds a control, not a new
mutation path.

**Acceptance criteria:**
- [ ] AC5.1 — A staged run's card offers an "Arm" action that issues
  `POST /api/decisions` with `{ action: 'arm' }` and no other new endpoint; the
  resulting commit message matches `state(<slug>): armed by <name>`.
- [ ] AC5.2 — Arming a run that is not in the staged rest state (already armed,
  or nonexistent) is refused with the existing `DecisionError` from
  `planDecision`'s `arm` case, surfaced to the operator as an error, not a
  silent no-op.

### R6 — Staged rest state renders distinctly and correctly
A staged run is visibly distinguishable from an ordinary mid-flight pause, and
its readiness item offers "Arm," never "Resume" (which the `arm`-only
precondition refuses).

**Acceptance criteria:**
- [ ] AC6.1 — A run with `paused_reason: staged` renders as a distinguishable
  readiness item (a new kind, or a distinguished variant of the existing
  `paused` kind) whose only affordance is "Arm" — driving it never issues
  `action: 'resume'` and so never triggers the `DecisionError` described in
  Context.
- [ ] AC6.2 — A staged run's phase chip, portfolio row, and run-detail header
  are visually distinguishable from a mid-flight-paused run's, reusing
  `chips.tsx`'s existing token set — no new component library.

### R7 — Existing visual vocabulary; no parallel queue app
Staged-run creation and the staged rest state render inside the existing
portfolio/run-detail/inbox surfaces; this run adds no new top-level page.

**Acceptance criteria:**
- [ ] AC7.1 — `frontend/packages/web/src/app.tsx`'s nav gains no new top-level
  route in this run's diff (still exactly Inbox/Portfolio/Metrics); the
  "new run" entry point is reachable from an existing page.
- [ ] AC7.2 — The staged run's portfolio row and run-detail card reuse existing
  components (`PhaseChip`, `GateLedger`, `BudgetMeter`, `DecidePanel`) rather
  than a bespoke rendering path parallel to them.

### R8 — Distinguishable, idempotent staging outcomes
A repeated submission of the same staging request (same slug, or same client
key) is idempotent, and its outcome is distinguishable from both a fresh
success and a genuine collision — never silently retried.

**Acceptance criteria:**
- [ ] AC8.1 — Resubmitting unchanged slug/client-key content after a successful
  stage reports "already staged," makes no second commit, and does not render
  as an error.
- [ ] AC8.2 — Submitting a slug already taken by a different (non-replay) run
  refuses visibly, naming the existing run/branch, and creates no branch.

### R9 — In-run design prototyping precedes the plan
Per the brief's Constraints, this run's own process includes a ux-researcher
memo and two decorrelated designer candidates landing before `plan.md`, with G1
approving the plan and selecting a candidate in one decision.

**Acceptance criteria:**
- [ ] AC9.1 — This run's artifact history shows a ux-researcher memo and two
  designer-candidate artifacts (e.g. under `runs/web-staging/design/`)
  committed before `plan.md`.
- [ ] AC9.2 — The G1 decision's notes (in `state.yaml`'s `gates.G1.notes` or the
  commit message) name which of the two candidates was selected.
- [ ] AC9.3 — No artifact in this run's diff proposes adding `designer` or
  `ux-researcher` to `roles/`, `contracts/`, the model registry, or the
  orchestrator's derivation table (grep target:
  `grep -rl "designer\|ux-researcher" roles/ contracts/ registry/` returns no
  new matches from this run).

## Assumptions

- **ASSUMPTION:** the brief doesn't name the new server route's path or verb →
  resolved as: this spec requires only that exactly one new route exists calling
  `stageRun`, not its concrete shape, because route naming is the Architect's
  call — the creation-seam spec left the analogous CLI-flag shape to its own
  Architect phase the same way.
- **ASSUMPTION:** "renders no staged rest state" (brief) undersells the actual
  defect — a staged run already renders, as a paused/resume card that errors on
  click → resolved as: R6 treats this as a correctness fix to existing
  `readiness.ts`/`decide.tsx` behavior, not net-new rendering, because both files
  already handle `phase: paused` today (Context).
- **ASSUMPTION:** whether the patch-profile task stub (`tasks/01-<slug>.yaml`)
  gets inline web-editable fields in this run → resolved as: no; the web form
  supplies only slug/title/profile/brief/budget/intake, matching
  `planRunScaffold`'s existing placeholder-stub behavior, because the brief's
  Constraints describe brief capture only, and editable task-stub fields would
  be scope creep toward tracker-like functionality the brief explicitly warns
  against.
- **ASSUMPTION:** how "G1 approves the plan and selects the candidate in one
  decision" gets recorded, since the brief names no new field → resolved as:
  the existing free-text `notes` field on an `approve` decision is sufficient,
  because no schema change is named anywhere in the brief.
- **ASSUMPTION:** identity resolution for a hosted, multi-operator deployment is
  out of scope for this run → resolved as: staging follows the same
  single-configured-git-identity model `/api/decisions` already uses, because
  the brief asks for no new identity/auth model and `docs/DEPLOY.md`'s hosted
  recipe already assumes one identity per deployment.

## Out of scope

- Any tracker fetch/import/write-back pipeline, task-source driver registry, or
  GitHub-issue-shaped intake (explicit in the brief; the creation-seam run's own
  Out of scope names the same boundary).
- The GitHub decision grammar (#119) and signing work (#123, #127).
- Changes to `roles/`, `contracts/`, the model registry, or the orchestrator's
  derivation table — the design roles are in-run prototypes only (R9).
- LLM-drafted brief content on any surface, and its cost accounting (ADR-6
  territory).
- Editing a patch-profile run's task-stub content inline in the web form.
- Rendering the full `intake:` metadata block (source/ref/url/client_key) in the
  run-detail view beyond what distinguishes the staged rest state — a richer
  intake panel is a future carrier's concern.
- Any new authentication/authorization model for who may stage or arm a run,
  beyond the existing single-configured-git-identity model.
- Multi-run batch staging, drafts/autosave, or editing an already-staged (not
  yet armed) run's brief before arming.
