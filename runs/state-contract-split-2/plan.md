# Technical Plan: Split the run-state contract into a generic core and an SDLC extension

## Approach

The split lands as one new generic contract document beside today's file, plus a
contract-aware parse boundary in the frontend core, leaving every SDLC surface
byte-identical.

Contracts:

- `contracts/state-core.yaml` (new) documents the generic core per R1: run
  identity, gates keyed by host-declared names, append-only escalations, and the
  pause reason — with writer/provenance rules restated in gate-name-free form.
- `contracts/state.yaml` is rewritten in place as the SDLC extension (R2). It
  stays a complete example instance — branch convention, phase ladder, G0–G3,
  tasks mirror, budget — so the file every consumer already reads remains
  self-contained. Optional keys are commented out (`profile:` joins `intake:`),
  because the frontend will derive required keys from the concrete keys (ADR-5).

Frontend parse boundary (R4): a resolver reads the target repo's own state
contract and classifies it. A template carrying the SDLC markers (`branch`,
`budget`, `tasks`) selects today's compiled schema unchanged; a core-only
template yields a generic descriptor (host gate names, optional branch, free
phase vocabulary). `parseRunState` gains an optional descriptor argument
defaulting to SDLC, so every existing caller and test is untouched (R3, R5).
Generic parses land in a new `generic` field on the parse result; the `RunState`
type does not change, which is what lets the orchestrator, cli, web, and server
packages — all outside this run's permitted diff (AC6.1) — compile unchanged
(ADR-3).

Read path: `LocalGitSource` resolves the descriptor once per source and passes
it to `readState`/`stateHistory`. `summarizeRun` renders generic runs with their
declared phase and gate names (AC4.2); `deriveReadiness` yields zero inbox items
for them — parse-clean, no decision UI, per the spec's out-of-scope.
`validateArtifact`'s state.yaml branch resolves required top-level keys from the
repo's own template, mirroring the work-item mechanism (AC4.3).

Two follow-ups are deliberately left outside this diff and flagged for the G1
decision in ADR-6: the copy-manifest entry for the new core document, and
one-line gate-glyph hardening in cli/web for non-SDLC hosts.

Docs (R7): INTEGRATION.md's fork note and read-check precondition, and
DESIGN.md's contract table, flip from pending to landed.

## Interface contracts

### New module: `frontend/packages/core/src/record/state-contract.ts`

```ts
export type StateContract =
  | { kind: 'sdlc' }
  | {
      kind: 'generic'
      /** Host-declared gate names, template order. */
      gateIds: string[]
      /** Top-level keys of the host's template — validateArtifact's required set. */
      requiredKeys: string[]
      branchRequired: boolean
    }

export const SDLC_STATE_CONTRACT: StateContract // Object.freeze({ kind: 'sdlc' })

/** Pure classification of template text (null = file absent). */
export function deriveStateContract(
  stateTemplate: string | null,
  coreTemplate: string | null,
): StateContract

/** Reads contracts/state.yaml, then contracts/state-core.yaml, via the repo's templates. */
export async function resolveStateContract(templates: ContractTemplates): Promise<StateContract>
```

Classification rule (normative for implementers and tests):

| Target repo's `contracts/state.yaml` template | Result |
|---|---|
| Parses to an object with all of top-level `branch`, `budget`, `tasks` | `sdlc` (compiled schema, exactly today) |
| Parses to an object lacking any of those three markers | `generic` derived from it: `gateIds = Object.keys(template.gates ?? {})`, `requiredKeys = Object.keys(template)`, `branchRequired = 'branch' in template` |
| Absent → fall back to `contracts/state-core.yaml`, same derivation | `generic` (core keys) |
| Both absent, or unparseable YAML | `sdlc` (built-in fallback — bare fixture repos keep today's behavior) |

### `record/schema.ts` deltas

```ts
export interface GenericRunState {
  run: string
  phase: string | null          // host-declared label, no vocabulary check
  paused_reason: string | null  // non-null = paused (the core pause signal)
  gates: Record<string, GateEntry>
  /** Declared gate ids (contract order) first, then undeclared ids present in the file. */
  gateOrder: string[]
  escalations: Escalation[]
}

export interface StateParseResult {
  state: RunState | null
  error: string | null
  /** Set (non-null) only when parsed under a generic contract. Optional for compat. */
  generic?: GenericRunState | null
}

export function parseRunState(
  text: string,
  contract: StateContract = SDLC_STATE_CONTRACT,
): StateParseResult
```

Generic schema semantics: `run` required string; `branch` required only when
`branchRequired`; `phase`/`paused_reason` optional scalars normalized to
`string | null`; `gates` a required mapping validated per-entry with the
existing `gateEntrySchema` (absent entries are undecided, never approved);
`escalations` optional, defaults `[]`; unknown keys pass through. Errors use the
same `"state.yaml does not match the contract: …"` formatting as today.

### `record/validate.ts` deltas (AC4.3)

```ts
export const BUILTIN_STATE_KEYS = [
  'run', 'branch', 'phase', 'paused_reason', 'budget', 'gates', 'tasks', 'escalations',
]
```

The `state.yaml` branch stops returning presence-only: required top-level keys =
`Object.keys` of the repo's `contracts/state.yaml` template, falling back to
`contracts/state-core.yaml`, then to `BUILTIN_STATE_KEYS` with the existing
"no contracts/ in repo" note — the exact `work-item.yaml` mechanism. All seven
existing `runs/*/state.yaml` files carry exactly these eight keys (audited), so
nothing regresses.

### `sources/local-source.ts` deltas

`LocalGitSource` memoizes `resolveStateContract(this.templates)` for the life of
the source (same caching stance as `frameworkRoots`) and passes it to
`parseRunState` in `readState` and `stateHistory`. No `RunSource` interface
change: the new result field rides the existing `StateParseResult` return type.

### `view-model` deltas

```ts
// portfolio.ts — widened key set; GateId access stays statically defined so
// cli/web typecheck unchanged:
export type GateLedgerMap = Record<GateId, GateLedgerCell> & Record<string, GateLedgerCell | undefined>
export interface RunSummary { /* unchanged fields */ gates: GateLedgerMap }
```

- `summarizeRun`, generic branch (`state === null && generic` non-null):
  `phase: generic.phase ?? '—'`, `pausedReason: generic.paused_reason`,
  `malformed: null`, `profile: 'full'` (typed filler; see ADR-6 consequence),
  `gates`: one cell per `gateOrder` entry under its declared name — no
  synthesized G0–G3 (AC4.2), `tasks` zeros, `escalationsOpen` from
  `generic.escalations`, `budget` nulls.
- SDLC branch: unchanged, cells for exactly G0–G3 as today (R5).
- `readiness.ts`: when `state` is null but `generic` is non-null, return
  `{ items: [], validations }` — a well-formed generic run is not malformed and
  gets no decision cards. All other paths unchanged.

### Fixture contract for the AC4.1/AC4.2 test (task 03)

```yaml
# fixture repo: contracts/state.yaml  (core instance — no SDLC markers)
run: example
phase: intake
paused_reason: null
gates:
  intake: {approved: false, by: null, at: null, notes: null}
  publish: {approved: false, by: null, at: null, notes: null}
escalations: []
```

Expected: classification `generic`, `gateIds ['intake','publish']`,
`requiredKeys` the five keys above, `branchRequired false`; a run state using
those gates parses with `error: null`, summarizes with `phase 'intake'` and gate
keys exactly `['intake','publish']`, and validates ok.

### Exports

`state-contract.ts` types/functions, `GenericRunState`, and
`BUILTIN_STATE_KEYS` are re-exported through `record/index.ts` and
`src/index.ts` alongside their existing siblings.

## Decisions (ADRs)

### ADR-1: The core becomes a new file; today's file becomes the SDLC extension and stays a complete template

- **Choice:** Add `contracts/state-core.yaml` as the generic core document;
  rewrite `contracts/state.yaml` in place as the SDLC extension, keeping it a
  complete, self-contained example instance that declares itself an extension of
  the core and carries every field, writer rule, and provenance note it carries
  today (generic rules may be restated in the core; nothing is dropped — AC2.2).
- **Rejected:** A disjoint split, where today's file would keep only the four
  SDLC additions. It fails the consumers that read one file: the copy manifest
  ships the state contract as a single entry, hosts copy one template, and the
  frontend's template reader fetches one name — a half-template would break all
  three for zero benefit. Also rejected: one file with a marked core section,
  because the core acceptance check greps a whole file (AC1.2) and a shared file
  can never pass it.
- **Consequences:** The generic writer rules exist in two places, core and
  extension, which is a documented drift risk mitigated by cross-reference
  comments. The shipped SDLC set stays self-contained even before the core
  document joins the copy manifest (ADR-6). The core document must avoid the
  literal strings the grep forbids, including the gate names and the budget key.

### ADR-2: The frontend detects the SDLC extension by its three marker keys

- **Choice:** Classify a repo's state contract as SDLC exactly when its
  `contracts/state.yaml` template has top-level `branch`, `budget`, and `tasks`;
  otherwise derive a generic descriptor from the template's own keys; fall back
  to compiled SDLC when no template exists or it fails to parse.
- **Rejected:** An explicit machine-readable marker key such as an extends
  declaration inside the template. The templates are example instances, and a
  metadata key would leak into the derived required-key set and into every
  host's copied file; the three marker fields already are the extension, so
  detecting them adds no new grammar. Also rejected: detecting on the gate names
  being exactly the four SDLC ids — a host that legitimately adds a fifth gate
  would silently flip to generic parsing and lose profile strictness.
- **Consequences:** An SDLC host that renames its gates while keeping branch,
  budget, and tasks still gets the compiled G0–G3 schema and bounces — the
  motivation's "rename a gate" case stays unfixed here, bounded to the parse
  boundary exactly as the spec directs. Bare test repos with no contracts tree
  keep today's behavior, which is what holds AC3.1 and AC5.1 green without test
  edits.

### ADR-3: Generic parses travel in a new result field; the SDLC state type is untouched

- **Choice:** `parseRunState` takes an optional `StateContract` defaulting to
  SDLC; generic successes populate a new optional `generic` field on
  `StateParseResult` while `state` stays null; `RunState` keeps its exact shape,
  including the phase enum and the total G0–G3 gates record.
- **Rejected:** Widening the run-state type so one type covers both shapes —
  phase as free string, gates as a plain string-keyed record. The workspace
  compiles with unchecked-index-access strictness, so that widening breaks the
  orchestrator's derivation tables and the cli/web gate access at typecheck
  time, and every one of those packages is outside this run's permitted diff
  (AC6.1). The two-channel result confines the change to the core package.
- **Consequences:** Downstream code that only understands SDLC (orchestrator,
  sync, actions) sees `state: null` for generic runs and safely skips them,
  which matches the out-of-scope rule that dispatch stays G0–G3-shaped. Every
  existing call site compiles and behaves byte-identically, satisfying R3/R5
  without touching the named test files.

### ADR-4: Generic runs summarize with declared gate names and produce no inbox items

- **Choice:** Widen `RunSummary.gates` to an intersection type keyed by both the
  four SDLC ids and arbitrary strings; populate it from the gates actually in
  the state (SDLC: exactly G0–G3 as today; generic: the declared names, declared
  order). `deriveReadiness` returns zero items for a well-formed generic run.
- **Rejected:** Padding generic summaries with undecided SDLC gate cells so
  existing display layers can always index them. The acceptance criterion
  forbids synthesized empty G0–G3 entries outright (AC4.2), and the padding
  would make a non-SDLC run indistinguishable from a four-gate run in every
  ledger consumer — the exact confusion this split removes.
- **Consequences:** The core view-model and the HTTP API render generic hosts
  correctly, but the cli and web gate-glyph cells still iterate the SDLC profile
  gates and will hit a missing entry when pointed at a purely non-SDLC host —
  a one-line optional-chaining fix in each, deferred by ADR-6 because those
  packages are outside the allowed diff. SDLC rendering is provably unchanged,
  which is what AC5.2 measures.

### ADR-5: Required state keys come from the template's concrete keys; optional means commented out

- **Choice:** `validateArtifact('state.yaml', …)` requires the top-level keys
  the repo's template actually declares, so the rewritten SDLC template must
  carry exactly the eight keys every historical run has, with `profile:` moved
  to a commented-out line beside the already-commented `intake:` block.
- **Rejected:** A hardcoded per-shape required-key list compiled into the
  frontend. That recreates the compiled-schema boundary this run exists to
  remove — a host that forks its state contract would validate against our keys
  instead of its own, violating the frontend's own template-first rule the spec
  invokes by name (R4).
- **Consequences:** Optionality has one visible convention — commented keys are
  optional, concrete keys are required — that contract authors must now respect.
  All seven existing run states were audited against the eight-key set, so no
  historical run regresses; a future template edit that adds a concrete key
  silently makes it required, which reviewers of contract changes must watch.

### ADR-6: Two follow-ups are deferred because the spec's diff allowlist excludes their files

- **Choice:** Do not touch `scripts/copy-manifest.json` (so the new core
  document is not yet offered to host repos) and do not harden the cli/web
  gate-glyph cells, in both cases because AC6.1 restricts this change to
  `contracts/`, `frontend/packages/core`, `docs/`, and the run directory.
  Record both as named follow-ups for the release-tagging work INTEGRATION.md
  §11 already sequences behind this split.
- **Rejected:** Breaching the allowlist to satisfy the repo invariant that new
  portable files join the copy manifest. The invariant matters at release time,
  no release exists yet, and the shipped SDLC set is self-contained by ADR-1 —
  while an out-of-allowlist diff is an objective acceptance failure this run
  would bounce on. The G1 approver can instead widen AC6.1 by amendment if they
  prefer both fixes to land here.
- **Consequences:** Until the follow-up lands, a release taken from this tree
  would not offer the core document to hosts, and pointing the cli or web UI at
  a purely non-SDLC host can still throw in the gate column even though every
  core read path is correct. Both are visible, named debts for the G1 human to
  accept or override — not silent gaps.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-contracts-split |
| R2 | 01-contracts-split |
| R3 | 02-state-contract-resolution, 03-generic-read-path |
| R4 | 02-state-contract-resolution, 03-generic-read-path |
| R5 | 03-generic-read-path |
| R6 | 01-contracts-split (AC6.2); AC6.1 enforced by every task's file surface |
| R7 | 04-docs-landed |

## Risks

- **A hidden consumer of the parse result's shape.** The plan asserts adding an
  optional field to the parse result breaks no package outside core. Early
  signal: `npm run typecheck` in `frontend/` on task 02's first commit; if any
  out-of-core package fails, stop and re-plan rather than edit it (AC6.1).
- **The template-key audit misses a state file.** Required-key validation
  (ADR-5) was audited against all seven `runs/*/state.yaml` on this branch, but
  a run merged mid-flight could differ. Early signal: task 02 adds a sweep test
  that validates every `runs/*/state.yaml` in this repo and fails loudly.
- **AC1.2's grep is unforgiving.** One stray `G1` or `budget:` in a comment
  fails the core document. Early signal: task 01's acceptance run of the exact
  grep from the spec; authors should run it before committing.
- **PR #19 coordination.** The run-state schema this plan modifies is the one
  the brief associates with PR #19; if that PR moves `schema.ts` before this
  merges, task 02/03 rebase against it. Early signal: merge conflict on
  `frontend/packages/core` at integration time — resolve by re-running the
  unchanged-behavior suites (AC3.1, AC5.1).
- **Runtime environment.** The frontend suite needs Node ≥ 24 and a one-time
  `npm install` in `frontend/`; this plan was authored in a sandbox without a
  shell, so no command above has been executed here. Binding instruction:
  task 02 starts by running `npm test` in `frontend/` and confirming it is green
  before any edit, so regressions are attributable.
- **Deferred debts land as surprises** (ADR-6). Mitigation: both are named in
  the plan and must be named again in the run's docs-delta/release notes; the
  G1 approver explicitly accepts or amends.
