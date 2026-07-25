# Specification: Escalation visibility survives schema-invalid run state

## Context

The Gate frontend loses escalation visibility at exactly the moment a run's
state is too broken to trust. The run-state parser, `parseRunState` in
`frontend/packages/core/src/record/schema.ts`, treats a whole state.yaml as
one pass-or-fail unit. Escalations are read only after the complete document
validates, so a schema violation in an unrelated field — an out-of-enum
phase, a missing key — makes escalations disappear along with everything
else. The portfolio view-model then hardcodes `escalationsOpen: 0` for any
run whose state failed to parse, and the readiness view-model reports a
single generic "malformed run" item with no escalation detail at all.

One repo fact narrows the fix's safe shape. The web UI's `DecidePanel`
(`frontend/packages/web/src/components/decide.tsx`) already renders a
working "Resolve…" button for any inbox item of kind `escalation`, without
checking whether that item is reviewable. Reusing that item kind unmodified
for a schema-invalid run's recovered escalations would reopen exactly the
control the brief's constraints forbid.

## Requirements

### R1 — Best-effort escalation recovery survives an unrelated schema failure
When a run's state.yaml parses as YAML but fails contract schema validation
for a reason unrelated to escalations, and every entry in its `escalations`
list independently satisfies the same per-entry validation ordinary parsing
already applies, the parser recovers that escalations list instead of
discarding it with the rest of the document. Recovery never invents, repairs,
or guesses at a field; it only reads what is already well-formed.

**Acceptance criteria:**
- [ ] AC1.1 — A fixture run whose state.yaml has one unrelated schema
  violation (e.g. an out-of-enum `phase` value) and a fully well-formed
  `escalations` array parses to a non-null best-effort escalations list, while
  `state` stays `null` and `error` still carries the original schema-violation
  message.
- [ ] AC1.2 — A fixture whose YAML does not parse at all (the existing
  `bad-state` fixture in `frontend/fixtures/src/index.ts`) produces no
  best-effort escalations list — behavior for that case is byte-for-byte
  unchanged from before this work.
- [ ] AC1.3 — A fixture whose `escalations` array itself has a malformed
  entry (e.g. `resolved` is a string, or `reason` is missing) produces no
  best-effort escalations list, even though the rest of the document would
  otherwise be recoverable.
- [ ] AC1.4 — The same fixture from AC1.1, extended with an additional
  unrelated schema violation in `tasks` or `gates`, still recovers only
  `escalations` — no task or gate data is reconstructed; `state` stays `null`.

### R2 — escalationsOpen reflects the recovered count on every surface that reports it today
A schema-invalid run whose escalations are well-formed reports its true
open-escalation count instead of zero everywhere `escalationsOpen` is
currently exposed.

**Acceptance criteria:**
- [ ] AC2.1 — For the AC1.1 fixture with exactly N unresolved
  (`resolved: false`) well-formed escalations, `GET /api/runs`'s matching
  entry in `runs[]` has `escalationsOpen === N`.
- [ ] AC2.2 — The same run's `GET /api/runs/:src/:slug` response has
  `summary.escalationsOpen === N`.
- [ ] AC2.3 — `buildPortfolio()`'s returned `RunSummary` for that run —
  the function `agentic status` and `agentic inbox` both call — has
  `escalationsOpen === N`, exercised by a `frontend/packages/core` test
  independent of the server layer.

### R3 — Recovered escalations are visible as content, not just a count
Alongside the existing malformed-run bounce, the CLI inbox and the run-detail
page show each recovered open escalation's role and reason, so a human is not
left with a bare number and no way to act on it.

**Acceptance criteria:**
- [ ] AC3.1 — For the AC1.1 fixture, `agentic inbox` output includes one
  line per open recovered escalation, naming its `from_role` and `reason`, in
  addition to the existing malformed-run-state line.
- [ ] AC3.2 — The same run's `GET /api/runs/:src/:slug` payload exposes a
  `from_role`/`reason`/`at` entry for each open recovered escalation.

### R4 — A schema-invalid run gains no new control
This work is read-only: a schema-invalid run still offers no way to approve a
gate, decline a gate, or resolve an escalation, matching the frontend's
existing malformed-packet rule (`frontend/README.md`'s R3) applied to run
state rather than artifact packets. No new store or write path is added.

**Acceptance criteria:**
- [ ] AC4.1 — For the AC1.1 fixture, no recovered-escalation item renders a
  "Resolve…" control in the web UI: a `DecidePanel` given a recovered
  escalation from a schema-invalid run does not show the button that exists
  today for `item.kind === 'escalation'` regardless of `reviewable`.
- [ ] AC4.2 — `POST /api/decisions` with `action: resolve-escalation` (and
  separately with `action: approve` or `decline`) against the AC1.1 fixture's
  slug still returns the existing malformed-state refusal (currently 409),
  unchanged by this work.
- [ ] AC4.3 — The change adds no new persisted store, cache table, or write
  path: recovered escalations are computed fresh from state.yaml on each
  read, the same as every other derived view (`frontend/README.md`'s R1).

## Assumptions

- **ASSUMPTION:** The brief names `at`, `from_role`, `reason`, `resolved` as
  what "well-formed" means for a recovered escalation entry, without saying
  whether that is stricter than today's per-entry rules → resolved as reusing
  exactly the per-field validation `escalationSchema` in
  `frontend/packages/core/src/record/schema.ts` already applies (reason and
  resolved required and typed; at and from_role optional) because a second,
  divergent ruleset for the same entry shape would make well-formedness
  depend on which code path evaluated it — a form of the guessing the brief
  forbids.
- **ASSUMPTION:** The brief lists "CLI status" among the affected surfaces,
  but `agentic status`'s table has no column that prints `escalationsOpen`
  today — only a "needs" count derived from readiness items → resolved as
  recovered escalations counting toward that readiness-item total the same
  way ordinary unresolved escalations already do, because that is the only
  existing signal on that surface capable of carrying this information, and
  adding a new column is out of scope.
- **ASSUMPTION:** "Preview" in the brief is not defined precisely → resolved
  as showing every open recovered escalation's `from_role` and `reason` (no
  truncation or ranking), matching the detail level the existing
  `escalation`-kind inbox item shows for a schema-valid run, because
  truncating to "the" important one would itself require guessing which
  escalation matters most.
- **ASSUMPTION:** The brief does not say whether resolved (`resolved: true`)
  entries in a recovered list should count or display → resolved as filtering
  to unresolved entries only, mirroring exactly how the schema-valid path
  already filters for `escalationsOpen` and the inbox, because the brief's
  concern is specifically the open, unresolved alarm.

## Out of scope

- Changing `contracts/state.yaml` or `runStateSchema`'s validation rules for
  any field other than reading `escalations` best-effort.
- General partial-schema tolerance for `phase`, `gates`, `tasks`, or `budget`
  — a violation in any of those still yields the full malformed-run bounce.
- The core/extension split of the state contract (`runs/state-contract-split-2/`).
- Resolving escalations, or taking any other write action, against a
  schema-invalid run from any frontend surface.
- Diagnosing or fixing the causes of schema-invalid state (unexpected phase
  values, missing fields, host-local divergence) — this work only makes an
  existing alarm visible through the failure, not the failure itself.
- Adding new CLI flags, output formats, or table columns beyond what R2/R3
  require to surface the recovered count and preview through existing
  surfaces.
