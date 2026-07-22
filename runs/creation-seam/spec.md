# Specification: Run-creation seam — `agentic new` / `agentic arm`

## Context

This is a G0-decline rework. The prior spec's two claimed repo/brief mismatches
are both resolved, not open concerns.

**Profiles are merged.** The prior spec's checkout was stale: current `main`'s
tip is #156, and the profile machinery — `PROFILES`, `PROFILE_GATES`,
`PROFILE_PHASES`, derivation rule D21 — is real, in
`frontend/packages/orchestrator/src/derive.ts` and
`frontend/packages/core/src/record/{schema,actions}.ts` (verified against the
current-main copies at `/tmp/creation-seam-refs/{derive,schema,actions}-main.ts`;
this run's own working tree still carries the pre-#156 versions of exactly
those three files — do not cite the in-tree copies for them). This run's own
hand-staged `runs/creation-seam/state.yaml` — four gates, with a "pre-#156
parser compatibility" comment — is now the **legacy** shape; R4 re-grounds the
scaffold against the real, merged `runStateSchema`.

**The design of record is available.** `runs/fleetview-intake/design/seam-reference.md`
(extracted at `/tmp/creation-seam-refs/seam-reference.md`, from commit
`dd08f3dd`) is the authoritative source below, superseding the intent brief's
paraphrase wherever they diverge (noted inline). Its own file:line citations
target a flat `core/src/*.ts` layout (`schema.ts`, `source.ts`,
`local-source.ts`, `git.ts`, `validate.ts` directly under `src/`) that predates
this checkout's actual layering into `record/`, `sources/`, and `view-model/`
subdirectories (`frontend/packages/core/src/index.ts`'s three-layer barrel).
Requirements below cite the current paths; the design of record's module
*boundaries*, not its literal paths, are what carry over.

**Cross-referencing the two resources changes two of the design of record's
own claims.** (a) Its proposed derivation label for a new "staged" rest row,
`D20`, is no longer free — merged #156 already assigned `D20` (task failed
twice) and `D21` (profile invariant). (b) Its assumption that an unhandled
`staged` phase "falls through safely" to a rest action no longer holds: D21
now escalates+pauses any phase absent from the run's `PROFILE_PHASES` — checked
*before* `deriveAction`'s phase switch is ever reached. A bare new `staged`
`PHASES` value would need `PROFILE_PHASES` extended for every profile, or every
staged run opens on an immediate profile-invariant escalation; reusing
`paused` needs no such extension, since `'paused'` is already in every
profile's phase list. Both findings bear on R5.

`docs/DESIGN.md` in this working tree carries no visible §4.1 profiles
section and no current-main copy of it was extracted for this rework;
profile semantics below are grounded directly in the merged
`schema.ts`/`derive.ts` source and its own doc comments, which are
authoritative over unavailable doc prose.

## Requirements

### R1 — Single core creation seam
A pure scaffold-planning function plus a create-only CAS staging write live in
`@agentic/core` beside `RunSource`; nothing else in the stack independently
mints a run branch.

**Acceptance criteria:**
- [ ] AC1.1 — Core exposes a pure planner (design of record's `planRunScaffold`: slug/title/profile/brief/intake fields → branch/tree/message, no git or filesystem I/O) and a `stageRun` method on `RunSource`/`LocalGitSource` (`frontend/packages/core/src/sources/{source,local-source}.ts`) that builds a two-blob genesis commit (`intent-brief.md` + `state.yaml` under `runs/<slug>/`, against the default branch's tree — composing `sources/git.ts`'s existing `writeTreeWithBlob` twice, as the design of record's §3.2 verifies works with no new git primitive) and lands it via `updateRefCAS(refs/heads/run/<slug>, commit, ZERO_OID)` — the same create-only idiom `local-source.ts` already uses at its remote-materialization call site.
- [ ] AC1.2 — Calling `stageRun` (or `agentic new`) with a target `run/<slug>` branch that already exists refuses and writes nothing — fails closed, never overwrites.
- [ ] AC1.3 — Calling it twice with the same staging identity (same slug, or same free-form client key) is idempotent: exactly one branch exists, and the second call's outcome is distinguishable from the first (design of record ADR-8's replay case) rather than erroring unrecognizably or silently no-opping.
- [ ] AC1.4 — This run's diff adds no run-creation HTTP route to `frontend/packages/server` (the design of record's §6 route table, `/api/intake/*`, is out of scope here — see Out of scope).

### R2 — `agentic new` CLI
`agentic new` is a thin carrier over the R1 seam: flags-first, non-interactive
by default, with an interactive TTY fallback for missing required content.

**Acceptance criteria:**
- [ ] AC2.1 — `agentic new --slug <slug> --title <t> --profile <patch|standard|full> ...` with all required content supplied via flags exits 0 with no prompts and produces the branch/commit described in R4.
- [ ] AC2.2 — Run with required content omitted and stdin a TTY, it prompts for the missing pieces (same fallback shape as `promptBurden` in `frontend/packages/cli/src/main.ts`: `process.stdin.isTTY` gate, `readline/promises`).
- [ ] AC2.3 — Run the same with stdin non-TTY (e.g. redirected from `/dev/null`), it exits non-zero naming the missing flags and makes no commit — matching `promptBurden`'s own refusal shape one-for-one.

### R3 — Human-authored or human-confirmed brief
The committed `intent-brief.md` is never machine-authored-as-human:
`agentic new` supplies structure, never invented Problem/Motivation/Constraints
prose (design of record R9).

**Acceptance criteria:**
- [ ] AC3.1 — In interactive mode, `agentic new` presents the drafted `intent-brief.md` for the human to edit and requires an explicit confirmation before it commits.
- [ ] AC3.2 — In non-interactive mode, brief content is accepted only from human-supplied input (flags and/or a file the operator authored); when required brief content is absent, `agentic new` refuses (per AC2.3) rather than generating placeholder prose. A verbatim import is not by itself sufficient (design of record: "a verbatim import is not by itself a human-authored brief") — this run's only in-scope intake path is free-form (no upstream driver, R9 below), so this principle governs the flag/file path, not an import path.

### R4 — Profile-aware scaffold contents, against the real merged schema
`--profile patch|standard|full` selects what `agentic new` scaffolds; the
emitted `state.yaml` parses under current main's `runStateSchema`
(`frontend/packages/core/src/record/schema.ts`) for that profile, including
its phase — not the legacy always-four-gate shape this run's own hand-staged
`state.yaml` used pre-#156.

**Acceptance criteria:**
- [ ] AC4.1 — `agentic new --profile standard <slug>` scaffolds `gates:` containing exactly `PROFILE_GATES.standard` (G0, G1, G2 — no G3 entry), and parses cleanly via `parseRunState`.
- [ ] AC4.2 — `agentic new --profile patch <slug>` scaffolds `gates:` containing exactly `PROFILE_GATES.patch` (G1, G2 only); its initial phase is `plan`, not `spec` — `PROFILE_PHASES.patch` excludes `spec` entirely (no analyst/architect role in `patch`) — and it additionally scaffolds exactly one `tasks/01-<slug>.yaml` populated per `contracts/work-item.yaml`'s required keys (`id`, `title`, `status: pending`, placeholder `scope`/`file_contact_surface`/`acceptance_tests`/`depends_on`/`notes`) for the human to fill in. This task file is not cosmetic: merged `derive.ts`'s `planPhase` escalates (D21) a `patch` run carrying zero task files.
- [ ] AC4.3 — `agentic new --profile full <slug>` scaffolds `gates:` containing all four (`PROFILE_GATES.full`), differing from `standard` in that shape plus the recorded `profile` value.
- [ ] AC4.4 — A fixture test per profile (`patch`, `standard`, `full`) shows the scaffolded `state.yaml` round-trips through `parseRunState` with zero validation errors.

### R5 — Staged rest state, chosen against the real derivation table
A staged-but-unarmed run is a distinguishable rest state that nothing
dispatches from. The representation is chosen and justified against the
*merged* phase/profile/derivation vocabulary — not the design of record's
now-superseded assumptions (Context).

**Acceptance criteria:**
- [ ] AC5.1 — An ADR in this run's plan artifacts records the chosen representation (e.g. a new `staged` `PHASES` value, or reuse of `paused` with a new `PAUSED_REASONS` entry) and explicitly addresses: (a) that D20 and D21 are already assigned in merged `derive.ts`, so any new phase-based rest row needs an unused label; (b) that D21 escalates+pauses — not rests — any phase absent from `PROFILE_PHASES[profile]`, checked before the phase switch, so a bare new phase value needs `PROFILE_PHASES` extended per profile, while reusing `paused` needs no such extension.
- [ ] AC5.2 — A freshly staged run's `state.yaml` parses without error via the current (or ADR-amended) `runStateSchema`, for every profile.
- [ ] AC5.3 — A new `derive.test.ts` case shows the derivation call against a staged run derives a `rest` action — never `dispatch`, and never an unintended `escalate` — for every profile.

### R6 — `agentic arm` rides the existing decision write path
Staging and arming are separate human acts recorded in git; arming is not a
parallel mutation path.

**Acceptance criteria:**
- [ ] AC6.1 — `agentic arm <slug>` produces exactly one commit on the run's branch via `RunSource.writeState`'s existing CAS path (whether by reusing the existing `resume` `DecisionAction` — `deriveResumePhase` already computes the correct post-arm phase from an all-undecided gate ledger — or a new `arm` `DecisionAction` alongside it is the Architect's call), attributed to the arming human's git identity, with no direct git plumbing that bypasses `writeState`.
- [ ] AC6.2 — Arming a run that is not in the staged rest state (already armed, or nonexistent) refuses with a named, non-zero-exit error and makes no commit — mirroring an existing `planDecision` precondition-check shape (e.g. `resume`'s `phase !== 'paused'` refusal).

### R7 — Authenticated intake
Staging refuses without a resolvable identity, exactly like the existing
`writeState` refusal.

**Acceptance criteria:**
- [ ] AC7.1 — With git `user.name`/`user.email` unset, `agentic new` (and the underlying `stageRun` write) refuses using the same `no-identity` `WriteFailure` shape `writeState` already returns (`sources/source.ts`'s `WriteFailure` union; `local-source.ts`'s existing message: `"git user.name/user.email are unset — decisions must be attributable to a named human"`, adapted for staging), checked before any git write is attempted, and creates no branch or commit.

### R8 — Draft-PR ensure (closes #118)
The engine ensures a run's draft PR exists on first arm/dispatch, idempotently,
regardless of how the run was created.

**Acceptance criteria:**
- [ ] AC8.1 — For a pushed run branch with no existing PR, the first `agentic arm` (or the v1 orchestrator's first dispatch of that run) opens a draft PR; a repeated call makes no second PR (idempotency test covering hand-made and CLI-made branches).
- [ ] AC8.2 — With no configured remote or no usable `gh`/token, the same call completes without error and logs a note recording the skip.
- [ ] AC8.3 — This run's PR/release notes record #118 as closed.

### R9 — No task-source vendor lock-in
This run hard-wires nothing GitHub-Issues-specific; the seam's input shape
leaves room for a future pluggable driver registry, per the design of record's
own neutral shapes (§3.1: `TaskItem`, `TaskSourceDriver`, `IntakeDraft`) —
adopted as the reference shape, not a literal contract this run must implement
verbatim, since no driver module ships in this run (Out of scope).

**Acceptance criteria:**
- [ ] AC9.1 — This run's diff contains no GitHub Issues-specific identifiers (labels, issue-API types) outside comments marking a future extension point.
- [ ] AC9.2 — The R1 scaffold-planner's input is a plain, source-agnostic data shape (slug, title, profile, brief content, and a nullable intake identity — source id/ref/url/client-key, all null for this run's only in-scope path, free-form), not a GitHub-issue-shaped object. Grep target: `grep -rniE "issue|label|assignee|milestone" frontend/packages/core/src/record/*.ts frontend/packages/core/src/sources/*.ts` (top-level only, not recursing into any future `task-sources/` module) returns no new matches beyond the two pre-existing zod `ZodError.issues` false positives in `record/schema.ts` — confirm exactly two before trusting this check post-implementation.

### R10 — Staged state is git-only, no new store
A staged run's full state is readable via git alone, independent of any
server process — no new store, session, or in-memory-only state (design of
record R10).

**Acceptance criteria:**
- [ ] AC10.1 — After `agentic new` stages a run, `git show run/<slug>:runs/<slug>/state.yaml` and `...intent-brief.md`, run in a fresh process with no server running, are fully readable and valid.

## Assumptions

- **ASSUMPTION:** `docs/DESIGN.md` in this working tree shows no §4.1 profiles section, and no current-main copy of it was extracted for this rework → resolved as: profile semantics above are grounded directly in the merged `schema.ts`/`derive.ts` source and its own doc comments, because code merged on current main is verifiable today, while re-deriving requirements from an un-extracted doc copy would repeat the prior spec's own staleness error.
- **ASSUMPTION:** the design of record's file:line citations (`schema.ts`, `source.ts`, `local-source.ts`, `git.ts`, `validate.ts`, `readiness.ts`, `portfolio.ts` directly under `core/src/`) target a flatter layout than this checkout's `record/`+`sources/`+`view-model/` split → resolved as: requirements cite the current paths; a new `task-sources/`-style layer, if built later, sits beside those three, per `index.ts`'s per-layer barrel pattern — the design of record's module boundaries, not its literal paths, are load-bearing.
- **ASSUMPTION:** the design of record's proposed derivation label "D20" for a staged rest row collides with merged #156's real D20/D21 → resolved as: R5's ADR must pick an unused label if a new phase-based row is needed at all; this spec does not pre-decide whether one is needed (see R5).
- **ASSUMPTION:** the design of record's ADR-2 (staged as a bare new `PHASES` value) predates the merged D21 profile-invariant check, which escalates any phase absent from `PROFILE_PHASES` before ever reaching the rest fallback the design of record relied on → resolved as: R5 requires the ADR to address this interaction explicitly rather than carry the design of record's now-inaccurate "falls through safely" claim forward unexamined.
- **ASSUMPTION:** "the single work-item stub the author fills in" for `--profile patch` is unspecified beyond that phrase, and is now load-bearing because merged `planPhase` D21-escalates a patch run with no task files → resolved as one `tasks/01-<slug>.yaml` matching `contracts/work-item.yaml`'s required keys, pre-filled with only slug/title/`status: pending`, because that is the only existing task-artifact contract and the minimum that avoids an immediate D21 escalation on a freshly staged patch run.
- **ASSUMPTION:** "first arm/dispatch" (R8) doesn't name which component(s) must call the ensure logic → resolved as: both `agentic arm` and the v1 orchestrator's first dispatch call the same idempotent ensure logic, because the brief requires it to cover "hand-made, CLI-made, and future GitHub-made runs," which only a check independent of creation path satisfies.
- **ASSUMPTION:** "no server route in this run" is read literally → resolved as zero new run-creation endpoints added to `frontend/packages/server`, because the brief withdraws the web capture surface and calls the CLI "the thin carrier"; the design of record's §6 route table is a future carrier's blueprint, not this run's scope.
- **ASSUMPTION:** the design of record's `TaskItem`/`TaskSourceDriver`/`IntakeDraft` shapes (§3.1) are a proposal from a design-of-record predating this run's own Architect phase → resolved as: this spec treats them as the reference shape R9's planner input should approximate, not a literal contract this run must implement verbatim, since no driver module ships; the Architect may adjust field names as long as the isolation rule (no tracker nouns as schema keys outside a future driver module) holds.

## Out of scope

- Any web capture surface or FleetView rendering of staged runs / an arm control (brief: withdrawn, follow-on at most) — including rendering a staged/armed distinction in `chips.tsx`/`portfolio.tsx` even if R5's ADR introduces a new phase or inbox kind conceptually.
- The design of record's full HTTP route table (§6: `/api/intake/sources|item|draft|runs`) — no server route ships in this run (R1 AC1.4); those routes are a future carrier's blueprint.
- The GitHub trigger carrier (`/queue`/label → staged run) and the pluggable task-source driver registry implementation, including `registry/task-sources.yaml` and any `frontend/packages/core/src/task-sources/<driver>.ts` module (R9 only requires the seam be shaped to accept them later).
- The GitHub decision grammar (#119) and signing-related work (#123, #127) — arming must not foreclose them, but does not implement them.
- LLM drafting of briefs from tracker items (design of record ADR-6) and its cost-accounting mechanics (§8); the verbatim/human-authored path (R3) is sufficient for this run.
- Write-back to upstream trackers.
- Extending `PROFILE_PHASES`, `PAUSED_REASONS`, or the derivation table beyond what R5's ADR strictly requires for the staged rest state itself — no speculative rows for hypothetical future lifecycle states.
