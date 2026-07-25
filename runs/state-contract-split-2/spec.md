# Specification: Split the run-state contract into a generic core and an SDLC extension

## Context

One file today does two jobs at once. `contracts/state.yaml` mixes generic run
mechanics with a hard-coded SDLC shape, and two independent consumers have hit
that seam. A downstream non-SDLC integration could not describe its runs with
the contract and recorded a fork, the escape hatch the integration workflow
reserves for genuine exceptions rather than a first-hour necessity.

The gate frontend hit the same seam from the other side. Its run-state parser
(`runStateSchema` in `frontend/packages/core/src/record/schema.ts`)
independently requires a `branch` field, fixes `phase` to the seven-value SDLC
ladder, and fixes `gates` to exactly the keys G0–G3. Pointed at that same
non-SDLC host, every run renders as malformed. That makes state.yaml the one
artifact type where the frontend breaks its own rule that artifacts validate
against the target repo's contract templates, the R3 rule (`frontend/README.md`):
`validate.ts` treats state.yaml as presence-only and defers entirely to the
compiled schema, unlike `work-item.yaml`, whose required keys already come from
the target repo's own contract at read time.

Gate-specific view-model logic beyond parsing — which gate is pending, what a
gate's packet contains, the fleet gate-ledger dashboard — also assumes exactly
G0–G3 (`readiness.ts`, `portfolio.ts`). A state.yaml that fails the schema never
reaches that logic today, so this spec bounds the frontend fix to the parsing
boundary and leaves gate-decision behavior for non-SDLC hosts out of scope, matching
the intent brief's own exclusion of new decision affordances.

## Requirements

### R1 — Generic core state contract
Document the fields common to any host — run identity, gates as a host-declared
set rather than a fixed four, an append-only escalations log, and pause
state — independently of any SDLC-specific field.

**Acceptance criteria:**
- [ ] AC1.1 — `contracts/` contains a core state-contract document whose
  required fields are exactly: a run identity field, a gate collection keyed by
  host-declared names (not a fixed enum), an append-only `escalations` list, and
  a pause signal (flag and/or reason).
- [ ] AC1.2 — `grep -E 'G0|G1|G2|G3|run/<slug>|budget:' <core document>` returns
  no matches.

### R2 — SDLC extension reproduces today's contract in full
Document the branch: run/<slug> convention, the fixed G0–G3 gate set, the tasks
mirror, and the budget block as an extension layered on the core, so the core +
extension pair together specify exactly what today's single contract specifies
for an SDLC run.

**Acceptance criteria:**
- [ ] AC2.1 — An SDLC extension document (or clearly delimited section) declares
  the gate set as exactly `G0, G1, G2, G3`, the `branch: run/<slug>` convention,
  the `tasks` mirror, and the `budget` block.
- [ ] AC2.2 — A reviewer diffing the pre-split `contracts/state.yaml` against the
  union of the core document and the SDLC extension finds every field, writer
  rule, and provenance note from before the split still present after it (moved,
  never dropped).

### R3 — Existing runs stay valid with zero edits
Every run-state file already committed, and every `run/<slug>` branch's
state.yaml, continues to parse and validate as well-formed against the split
contract without modification.

**Acceptance criteria:**
- [ ] AC3.1 — `npx vitest run test/real-repo.test.ts` in `frontend/packages/core`
  passes unchanged, including the assertions that read `runs/wordfreq/state.yaml`'s
  gates, tasks, and phase.
- [ ] AC3.2 — `parseRunState` returns `error: null` for `runs/wordfreq/state.yaml`,
  `runs/mdtoc/state.yaml`, and `runs/dupefind/state.yaml`, byte-for-byte
  unmodified.
- [ ] AC3.3 — `git diff` shows zero changes to any existing `runs/<slug>/state.yaml`
  or any commit on an existing `run/<slug>` branch attributable to this work.

### R4 — Frontend reads gate and phase vocabulary from the target repo's own contract
The frontend's run-state parser stops requiring `branch`, a fixed `phase`
ladder, and exactly the keys G0–G3 as compiled-in constants, and instead
derives what a well-formed state.yaml must contain from the target repo's own
state contract (core, and its extension if declared) — the same R3 principle
already applied to `work-item.yaml`.

**Acceptance criteria:**
- [ ] AC4.1 — Given a fixture target repo whose `contracts/` declares only the
  core state contract with a gate set `{intake, publish}` and no `branch`
  requirement, and a `runs/<slug>/state.yaml` using that gate set, the
  frontend's read path (`parseRunState` or its successor) accepts the file
  without error.
- [ ] AC4.2 — For that same fixture repo, the frontend's rendered summary shows
  the declared phase and gate names, not `phase: unknown` and not synthesized
  empty `G0`–`G3` entries.
- [ ] AC4.3 — `validateArtifact('state.yaml', ...)` no longer unconditionally
  returns presence-only; it resolves required top-level structure from the
  target repo's own state contract, mirroring how it already resolves
  `work-item.yaml`'s required keys.

### R5 — SDLC hosts see unchanged decision behavior
For a run whose target repo declares the SDLC extension (today's default),
gate decisioning, phase derivation, and the fleet gate-ledger view produce
identical output to before the split.

**Acceptance criteria:**
- [ ] AC5.1 — `npm test` in `frontend/` passes with zero failing tests and zero
  test files requiring an updated expected value (`readiness.test.ts`,
  `profiles.test.ts`, `real-repo.test.ts` in particular).
- [ ] AC5.2 — `agentic status` against this repository (or its test-fixture
  equivalent) renders `runs/wordfreq` identically before and after the split:
  same phase, same four gate cells, same inbox absence.

### R6 — No non-SDLC content enters this repository
The split adds no host-specific vocabulary, example, role, or contract beyond
the generic core and the SDLC extension already in this repository's product
scope.

**Acceptance criteria:**
- [ ] AC6.1 — This change's diff touches only `contracts/`, `frontend/packages/core`
  (per R4), `docs/` (per R7), and `runs/state-contract-split-2/`; no new file
  under `roles/` or a business-domain-named path under `runs/`.
- [ ] AC6.2 — The core state-contract document names no gate, ticket system, or
  business vocabulary; every example in it stays within {run identity, gates,
  escalations, pause}.

### R7 — Framework docs stay consistent with the split
`docs/INTEGRATION.md`'s fork note (§4) and its frontend-read-check precondition
(§5), and `docs/DESIGN.md`'s artifact-contract table (§5), describe the split as
landed rather than pending, once it lands.

**Acceptance criteria:**
- [ ] AC7.1 — `grep -n "state-contract split" docs/INTEGRATION.md` no longer
  shows it described as a future/"active run" needing completion; the
  precondition note in §5 either is removed or points at this run as done.
- [ ] AC7.2 — `docs/DESIGN.md`'s `state.yaml` row (§5 contract table) reflects the
  core/extension split, or explicitly notes the SDLC extension as the row's
  scope.

## Assumptions

- **ASSUMPTION:** The brief says "Coordinate with PR #19 (the frontend schema
  lives there) … this brief does not presume which lands first," which could
  mean the frontend parsing fix (R4) belongs to a separate, later-coordinated
  change rather than this run → resolved as: R4 is in scope for this run,
  because `docs/INTEGRATION.md` §3 and §9 both describe eliminating the R3
  violation as part of "the state-contract split" (this run's own name), and
  leaving R4 out would resolve only the downstream fork (Problem 1) and not the
  frontend defect (Problem 2) that the brief spends equal weight motivating.
  G0 can strike R4 to defer it if the coordination should instead land as a
  separate PR.
- **ASSUMPTION:** The brief names `phase`, `profile`, and `intake` in neither
  its core list (run identity, gates, escalations, pause) nor its SDLC list
  (branch, G0–G3, tasks, budget) → resolved as: the specific seven-value phase
  ladder and the `patch`/`standard`/`full` profile vocabulary are SDLC
  extension content, since both encode the G0–G3 ceremony (DESIGN.md §4.1);
  `intake` stays in the core, since today's contract already documents it as
  "opaque to this contract — no tracker vocabulary."
- **ASSUMPTION:** The brief does not specify whether the core and SDLC
  extension are separate files or one file with a marked section → resolved as:
  left to the Architect's plan.md; this spec's acceptance criteria test
  observable field presence and parse behavior, not file layout, per the
  Analyst's remit to state what must be true and not how to build it.

## Out of scope

- Any non-SDLC role, contract, or example landing in this repository (R6
  guards against it; none is produced by this work).
- Frontend decision affordances (approve/decline UI) for gates outside G0–G3.
- Generalizing gate-specific view-model logic beyond the parse boundary —
  `readiness.ts`'s pending-gate/packet logic and `portfolio.ts`'s G0–G3 gate-ledger
  columns stay as they are; a non-SDLC host's custom gates parse cleanly (R4)
  but get no decision UI.
- Orchestrator dispatch-rule changes; dispatch stays G0–G3-shaped.
- Escalation visibility on schema-invalid runs — tracked separately as
  `runs/escalation-visibility-2/`, sequenced at G0 against this run.
- The tagged-release process `docs/INTEGRATION.md` §11 sequences behind this
  split.
- Any change to `contracts/work-item.yaml` or other artifact contracts' own
  extension mechanism (`docs/INTEGRATION.md` open question 1).
