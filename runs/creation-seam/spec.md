# Specification: Run-creation seam — `agentic new` / `agentic arm`

## Context

Today there is no programmatic path to create a run: `RunSource` (`frontend/packages/core/src/sources/source.ts`) only reads existing runs and mutates `state.yaml` on an already-existing branch (`writeState`); starting one means hand-authoring `intent-brief.md` and `state.yaml` on a fresh `run/<slug>` branch, exactly as this run's own `runs/creation-seam/` was staged. Two repo/brief mismatches bear on scope: (1) the brief's planning constraint "current main (run profiles #156 merged)" does not hold — `derive.ts`'s derivation rules stop at D20, `schema.ts`'s `PHASES`/`PAUSED_REASONS` carry no profile vocabulary, and `PROFILE_PHASES`/`D21` appear nowhere in the repo outside this run's own `intent-brief.md`/`state.yaml`; (2) the design of record it cites, `runs/fleetview-intake/design/seam-reference.md`, is not present in this checkout (no `runs/fleetview-intake/` directory exists at all), so the requirements below rely on the intent brief's paraphrase of it. This run's own hand-staged `runs/creation-seam/state.yaml` — a four-gate, `profile: standard` document explicitly noted as "pre-#156 parser compatibility" — is treated below as a golden fixture for what a scaffolded `state.yaml` must look like today.

## Requirements

### R1 — Single core creation seam
A pure scaffold-planning function plus a create-only CAS staging write live in core, beside `RunSource`; nothing else in the stack independently creates a run.

**Acceptance criteria:**
- [ ] AC1.1 — Core exposes one creation entry point (e.g. `stageRun`) beside `RunSource` in `frontend/packages/core/src/sources/`, split into a git/filesystem-free planning step (unit-testable on plain inputs) and a write step that fails closed — mirroring the existing create-from-nothing `updateRefCAS(branchRef, remoteTip, ZERO_OID)` pattern in `local-source.ts` — when the target `run/<slug>` branch already exists, rather than overwriting it.
- [ ] AC1.2 — This run's diff adds no run-creation HTTP route to `frontend/packages/server`.

### R2 — `agentic new` CLI
`agentic new` is a thin carrier over the R1 seam: flags-first, non-interactive by default, with an interactive TTY fallback for missing required content.

**Acceptance criteria:**
- [ ] AC2.1 — `agentic new --slug <slug> --title <t> --profile <patch|standard|full> ...` with all required content supplied via flags exits 0 with no prompts and produces the branch/commit described in R4.
- [ ] AC2.2 — Run with required content omitted and stdin a TTY, it prompts for the missing pieces (same fallback shape as `promptBurden` in `frontend/packages/cli/src/main.ts`).
- [ ] AC2.3 — Run the same with stdin non-TTY (e.g. redirected from `/dev/null`), it exits non-zero naming the missing flags and makes no commit.

### R3 — Human-authored or human-confirmed brief
The committed `intent-brief.md` is never machine-authored-as-human: `agentic new` supplies structure, never invented Problem/Motivation/Constraints prose.

**Acceptance criteria:**
- [ ] AC3.1 — In interactive mode, `agentic new` presents the drafted `intent-brief.md` for the human to edit and requires an explicit confirmation before it commits.
- [ ] AC3.2 — In non-interactive mode, brief content is accepted only from human-supplied input (flags and/or a file the operator authored); when required brief content is absent, `agentic new` refuses (per AC2.3) rather than generating placeholder prose.

### R4 — Profile-aware scaffold contents
`--profile patch|standard|full` selects what `agentic new` scaffolds; the resulting `state.yaml` is valid under the schema as it exists today (R1 mismatch in Context), not against unmerged #156 machinery.

**Acceptance criteria:**
- [ ] AC4.1 — `agentic new --profile standard <slug>` scaffolds a `state.yaml` structurally identical (same top-level keys, all four `gates.G0`–`G3` entries) to the hand-authored `runs/creation-seam/state.yaml`, differing only in run-identifying values, and parses cleanly via `frontend/packages/core/src/record/schema.ts`'s `parseRunState`.
- [ ] AC4.2 — `agentic new --profile patch <slug>` additionally scaffolds exactly one `tasks/01-<slug>.yaml` stub with the structural keys `contracts/work-item.yaml` requires populated (`id`, `title`, `status: pending`, empty/placeholder `scope`, `file_contact_surface`, `acceptance_tests`, `depends_on`, `notes`) for the human to fill in.
- [ ] AC4.3 — `agentic new --profile full <slug>` scaffolds the same four-gate shape as AC4.1 (parity, since profile-scoped gate ladders are #156 scope — see Context), differing from `standard` only in the recorded `profile` value.

### R5 — Staged rest state
A staged-but-unarmed run is a distinguishable rest state that nothing dispatches from, represented in today's actual `PHASES`/`PAUSED_REASONS` vocabulary (`schema.ts`) unless the Architect's ADR justifies otherwise.

**Acceptance criteria:**
- [ ] AC5.1 — An ADR in this run's plan artifacts records the phase/pause representation chosen for "staged," with rationale referencing the current `PHASES`/`PAUSED_REASONS` values (not the unmerged `PROFILE_PHASES`/`D21`).
- [ ] AC5.2 — A freshly staged run's `state.yaml` parses without error via the current (or ADR-amended) `runStateSchema`.
- [ ] AC5.3 — A new `derive.test.ts` case shows `tick --dry-run` (or the underlying derivation call) against a staged run derives a rest action, never a dispatch.

### R6 — `agentic arm` rides the existing decision write path
Staging and arming are separate human acts recorded in git; arming is not a parallel mutation path.

**Acceptance criteria:**
- [ ] AC6.1 — `agentic arm <slug>` produces exactly one commit on the run's branch via `RunSource.writeState`'s existing CAS path, attributed to the arming human's git identity, with no direct git plumbing that bypasses it.
- [ ] AC6.2 — Arming a run that is not in the staged rest state (already armed, or nonexistent) refuses with a named, non-zero-exit error and makes no commit.

### R7 — Authenticated intake
Staging refuses without a resolvable identity, exactly like the existing `decide()` refusal.

**Acceptance criteria:**
- [ ] AC7.1 — With git `user.name`/`user.email` unset, `agentic new` (and the underlying `stageRun` write) refuses using the same `no-identity` `WriteFailure` shape `writeState` already returns, and creates no branch or commit.

### R8 — Draft-PR ensure (closes #118)
The engine ensures a run's draft PR exists on first arm/dispatch, idempotently, regardless of how the run was created.

**Acceptance criteria:**
- [ ] AC8.1 — For a pushed run branch with no existing PR, the first `agentic arm` (or the v1 orchestrator's first dispatch of that run) opens a draft PR; a repeated call makes no second PR (idempotency test covering hand-made and CLI-made branches).
- [ ] AC8.2 — With no configured remote or no usable `gh`/token, the same call completes without error and logs a note recording the skip.
- [ ] AC8.3 — This run's PR/release notes record #118 as closed.

### R9 — No task-source vendor lock-in
This run hard-wires nothing GitHub-Issues-specific; the seam's input shape leaves room for a future pluggable driver registry.

**Acceptance criteria:**
- [ ] AC9.1 — This run's diff contains no GitHub Issues-specific identifiers (labels, issue-API types) outside comments marking a future extension point.
- [ ] AC9.2 — The R1 scaffold-planner's input is a plain, source-agnostic data shape (slug, title, profile, brief content, …), not a GitHub-issue-shaped object.

## Assumptions

- **ASSUMPTION:** The brief's constraint to plan against "current main (run profiles #156 merged)" does not match the repo (Context) → resolved as: this run scaffolds profile-appropriate contents against the schema as it exists *today*, storing `profile` as a passthrough field, and does not implement or depend on unmerged #156 derivation machinery; the Architect's ADR-2 redecision is made against the actual current `PHASES`/`PAUSED_REASONS` vocabulary, not against nonexistent `PROFILE_PHASES`/`D21` — because grounding a requirement in fictitious repo state would make it unbuildable and unverifiable, and the brief's own fallback text ("a paused-based staged rest state may be sufficient") already anticipates this outcome.
- **ASSUMPTION:** `runs/fleetview-intake/design/seam-reference.md` (the cited design of record) is absent from this checkout → resolved as: this spec treats the intent brief's inline paraphrase (its R4/R5/R7/R8/R9/R11, ADR-2/ADR-6 references) as the authoritative statement of that design's content, because it is the only available source; G0/Architect can correct any paraphrase drift they recall from the original.
- **ASSUMPTION:** "the single work-item stub the author fills in" for `--profile patch` is unspecified beyond that phrase → resolved as one `tasks/01-<slug>.yaml` matching `contracts/work-item.yaml`'s required keys, pre-filled with only slug/title/status, because that is the only existing task-artifact contract the scaffold can target.
- **ASSUMPTION:** "first arm/dispatch" (R8) doesn't name which component(s) must call the ensure logic → resolved as: both `agentic arm` and the v1 orchestrator's first dispatch call the same idempotent ensure-logic, because the brief requires it to cover "hand-made, CLI-made, and future GitHub-made runs," which only a check independent of creation path satisfies.
- **ASSUMPTION:** "no server route in this run" is read literally → resolved as zero new run-creation endpoints added to `frontend/packages/server`, because the brief withdraws the web capture surface and calls the CLI "the thin carrier."

## Out of scope

- Any web capture surface or FleetView rendering of staged runs / an arm control (brief: withdrawn, follow-on at most).
- The GitHub trigger carrier (`/queue`/label → staged run) and the pluggable task-source driver registry implementation (R9 only requires the seam be shaped to accept them later).
- The GitHub decision grammar (#119) and signing-related work (#123, #127) — arming must not foreclose them, but does not implement them.
- LLM drafting of briefs from tracker items (seam reference ADR-6); the verbatim/human-authored path (R3) is sufficient for this run.
- Write-back to upstream trackers.
- Implementing #156's run-profile derivation machinery (`PROFILE_PHASES`, `D21`, per-profile gate ladders in the orchestrator) — out of scope per the Assumptions above; this run only scaffolds profile-labeled, schema-valid `state.yaml` documents.
