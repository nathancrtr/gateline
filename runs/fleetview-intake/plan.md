# Technical Plan: Upstream task intake — frictionless run initiation for FleetView

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. Accompanied by tasks/*.yaml. -->

## Approach

This is a design run. Per the spec's Out of scope and the intent brief, this run's
deliverables are (a) Designer wireframe candidates per `contracts/design-candidate.md`
and (b) a buildable seam reference that makes the follow-on implementation run
plannable without re-architecture. No task in this run edits `frontend/`, `contracts/`,
or `registry/` — those edits are the follow-on run's work. The split of the spec's
acceptance criteria is therefore explicit:

- **Discharged this run (candidate-level):** AC1.1–1.2, AC2.1–2.2 (as designed command
  surface), AC3.1–3.2, AC5.2, AC6.2, AC7.1–7.2, AC9.1, AC11.1–11.2 (as designed
  behavior), AC12.1–12.2, AC13.1 — judged on the candidates and the seam reference.
- **Designed this run, discharged in the follow-on build:** AC4.1–4.2, AC5.1, AC6.1,
  AC7.3, AC8.1–8.2, AC9.2, AC10.1, AC14.1 — each must have a named, verifiable
  mechanism in the seam reference (task 03) so the follow-on run inherits tests, not
  open questions.

**G0 bindings honored as decisions** (from `state.yaml` `gates.G0.notes`): the primary
pipeline is *import a tracker item → LLM-drafted intent brief → human review/edit →
confirm* (a bare free-text box that compiles a brief from a typed fragment is
explicitly not the centered design; free text remains a secondary capture feeding the
same draft→review→confirm path). The source-picker is shown even with one source live,
defaulted. Budget is an optional field with an inherited, pre-filled default. Runs are
initialized **staged** and explicitly armed by a human — run-creation is treated as a
human gate-grade act. The web entry affordance is a button-type "new" trigger, not a
fourth peer nav item. One G0 note references an external artifact URL that is not
fetchable from this environment; per dispatch instruction, planning proceeds on the
written guidance alone.

**The flow, end to end (both surfaces):**

1. *Capture* — operator activates the "new" trigger (web) or `agentic new <input>`
   (CLI). Input is a source ref (issue URL / `owner/repo#N` shorthand) or free text;
   source-picker visible and pre-selected.
2. *Fetch + draft* — the source driver re-fetches the item from the source of record
   (never trusts a forwarded payload); an LLM drafting step renders it into the
   four-section `contracts/intent-brief.md` shape. Drafting is an optional capability:
   when no drafting model is configured, the verbatim item body lands in the editor as
   the draft (structural degradation, not an error).
3. *Review/edit* — the human edits the draft brief in place (web editor / `$EDITOR` in
   the CLI). Nothing exists server-side yet; the draft lives in the client.
4. *Stage* — a preview (source ref, slug, branch name, budget) is visible ahead of one
   explicit confirm control. Confirm commits the full scaffold (`intent-brief.md` +
   `state.yaml` with `phase: staged`) as the first commit on `run/<slug>`, authored
   under the confirming human's git identity. Idempotent; collisions refuse and name
   the existing run.
5. *Arm* — a second explicit human act (web action / `agentic arm`, or `--arm` /
   an adjacent "Stage & arm" affordance that still counts as a distinct gesture from
   capture) transitions `staged → spec` through the existing decision write path. Only
   an armed run is dispatchable.

**Sequencing note for the orchestrating human.** `contracts/design-candidate.md` and
the registry's P6 note assume candidates land pre-G1 in a feature run; in *this* run
the candidates are the deliverable itself, so the standard pipeline applies: G1 judges
this plan (the ADRs below are the direction decisions), the implement phase produces
the candidates and seam reference, and G2 judges the candidates as the run's
implementation. Designer dispatches are v0 human-orchestrated (the v1 reconciler's
D-table does not dispatch design roles); tasks 01/02 need hand-dispatch under the
designer binding, task 03 can flow as a normal implementer dispatch. Per the registry's
taste-decorrelation note, dispatch 01 and 02 on different model families if alternates
are pinned.

**Environment probe.** This run's tasks produce markdown and self-contained
single-file HTML (open-from-disk per the design-candidate contract) — no toolchain is
exercised, so no runtime constraint binds task execution. All signatures below that
reference existing code (`RunRef`, `Identity`, `WriteResult`, `updateRefCAS` create-
only semantics via the zero OID, `runStateSchema`'s `.passthrough()` tolerance of new
top-level keys, the `promptBurden` TTY idiom, `POST /api/decisions` as the sole
mutating route) were read from source at plan time on this checkout. The follow-on
build environment is Node ≥ 24 / `npm test` in `frontend/` — recorded here so the
follow-on architect inherits it.

## Interface contracts

These are normative for tasks 01–03: candidates render against them, and the seam
reference elaborates them with worked examples. They are *proposed* code contracts for
the follow-on run — its architect confirms them against the codebase at build time.

### IC-1: Neutral task item (the only shape core/contracts ever see — R4)

```ts
interface TaskItem {
  source: string        // driver id from registry/task-sources.yaml
  ref: string           // driver-scoped external ref, e.g. "acme/widgets#482"
  url: string | null
  title: string
  body: string          // markdown, re-fetched from the source of record
}
```

### IC-2: Task-source driver + registry (R4)

```ts
interface TaskSourceDriver {
  readonly id: string
  /** Parse operator input (URL or shorthand) into a driver-scoped ref, else null. */
  parseRef(input: string): string | null
  fetchItem(ref: string): Promise<TaskItem>
}
```

Tracker nouns (issue number, labels, assignee) live only inside the driver module
(follow-on location: `frontend/packages/core/src/task-sources/<id>.ts`, the posture of
the existing isolated `github.ts` PR-sync provider). Registry file
`registry/task-sources.yaml` (same committed-and-versioned posture as `models.yaml`):

```yaml
sources:
  github:
    driver: github                # driver module id
    label: GitHub Issues
    ref_format: "owner/repo#N or issue URL"
    auth: GIT_TOKEN               # env credential the driver reads; never stored
```

Adding/swapping a source = one driver module + one registry entry (AC4.2).

### IC-3: Creation seam (R5, R6)

Mirrors the codebase's `planDecision`/`writeState` plan-execute idiom:

```ts
interface IntakeDraft {
  slug: string                       // human-confirmed; refused on collision
  title: string
  brief_markdown: string             // full four-section intent-brief body, human-confirmed
  source: { id: string; ref: string; url: string | null } | null  // null = free-form
  client_key: string | null          // idempotency key for free-form drafts
  budget_limit_usd: number | null    // null → inherited default
}

// core, pure: renders the scaffold from contract templates — no model invocation
function planRunScaffold(draft: IntakeDraft, defaults: IntakeDefaults):
  { branch: string; files: Record<string, string>; message: string }

// the ONE branch-minting write path (AC5.1), on RunSource beside writeState:
// create-only CAS (updateRefCAS from the zero OID) — a raced create loses loudly
stageRun(plan: ScaffoldPlan, who: Identity): Promise<StageOutcome>

type StageOutcome =
  | { outcome: 'created';  ref: RunRef; commit: string }
  | { outcome: 'exists';   slug: string; branch: string }   // same identity replayed (AC6.1)
  | { outcome: 'conflict'; message: string }                 // ref raced; re-present (AC6.2)
  | { outcome: 'refused';  reason: 'no-identity' | 'slug-taken' | 'invalid-draft'; message: string }
```

Idempotency identity: `(source.id, source.ref)` for imports, `client_key` for
free-form. Existence checks cover live branches, remote branches, *and* merged
historical runs on the default branch (`listRuns` already enumerates all three).
Collision with a different identity → `refused: slug-taken`, naming the existing run;
never `-2` suffixing.

### IC-4: Staged lifecycle in state.yaml (R7, R10, R14)

`phase: staged` is a new first value in the `contracts/state.yaml` phase enum
(ADR-2). The scaffold skeleton both surfaces must produce identically (AC5.2):

```yaml
run: <slug>
branch: run/<slug>
phase: staged
paused_reason: null
intake:                       # R14: neutral provenance block, canonical home of the external ref
  source: github              # null for free-form
  ref: acme/widgets#482
  url: https://github.com/acme/widgets/issues/482
  client_key: null
  staged_by: <human name>
budget: { cost_limit_usd: <default-or-override>, cost_spent_usd: 0, ledger: [] }
gates: { G0/G1/G2/G3 all undecided }
tasks: []
escalations: []
```

The staging commit is authored by the confirming human (AC9.2), message grammar in the
human-verb family: `state(<slug>): staged by <name> [source: github acme/widgets#482]`.
Arming is a new `DecisionAction` `'arm'` in `planDecision` (legal only from
`phase: staged`; mutation `phase → spec`; message `state(<slug>): armed by <name>`),
flowing through the existing single decision write path — same identity refusal, same
CAS re-present. There is no server-side pending store: before the staging commit the
draft exists only in the client; after it, everything is readable from the run branch
(AC10.1).

### IC-5: HTTP routes (design-normative for candidates; built follow-on)

All behind the deployment's access proxy per `docs/DEPLOY.md` — no new auth machinery,
no Access bypass beyond the existing webhook path (AC8.1).

| Route | Semantics |
|---|---|
| `GET /api/intake/sources` | `{ sources: [{id,label,ref_format}], defaults: {budget_limit_usd} }` from the registry |
| `GET /api/intake/item?source=&ref=` | re-fetched `TaskItem`; 404 unknown ref, 502 upstream failure |
| `POST /api/intake/draft` | `{item}` or `{utterance}` → `{ brief_markdown, cost_usd }`; 501 when no drafting model is configured (degrade to verbatim) |
| `POST /api/intake/runs` | `IntakeDraft` → `StageOutcome`: 201 created, 200 exists, 409 conflict, 400/422 refused |
| `POST /api/decisions` (existing) | `action: 'arm'` — arming reuses the sole mutating route |

Budget default chain: deployment env (e.g. `INTAKE_DEFAULT_BUDGET_USD`) → committed
fallback (the state contract template's illustrative value). Always pre-filled in the
UI, one interaction to override (AC3.2).

### IC-6: CLI command surface (R1, R2, R11)

```
agentic new [input]          # input: source ref (URL/shorthand) or free-text utterance
  --source <id>              # default: inferred from input, else the sole registry entry
  --slug <slug>  --title <t>  --budget <usd>
  --brief-file <path>        # pre-authored brief body; skips drafting
  --key <client-key>         # idempotency for free-form
  --no-draft                 # verbatim import, no LLM step
  --yes                      # non-interactive confirm of the printed preview (AC11.1)
  --arm                      # also arm after staging; never the default
agentic arm <slug> [--source <id>]
```

Interactive fallback follows the `promptBurden` precedent: prompts only when flags are
omitted and stdin is a TTY; brief review via `$EDITOR`; preview (slug, branch, source
ref, budget) printed before the confirm in both modes. Non-TTY without `--yes` →
named refusal. Identity from git config via the existing `identity()` path; unset →
named error, no partial write (AC8.2). Exit codes mirror `decide()`: 0 ok, 1 refused,
2 conflict; `exists` prints the existing slug distinctly (AC6.1/6.2).

## Decisions (ADRs)

### ADR-1: Two full-surface design candidates + one buildable seam reference
- **Choice:** Tasks are two Designer candidates that each cover web *and* CLI (mockups
  + terminal transcripts in one coherent story), plus one seam-reference artifact
  elaborating IC-1…IC-6 into a buildable spec. No implementation tasks in this run.
- **Rejected:** Separate CLI-only candidate task — it triples the designer spend
  against a $30 ceiling (≈$22 headroom remains) and splits AC5.2 ("identical skeleton
  across surfaces") across authors, inviting drift. Also rejected: emitting follow-on
  implementation tasks now — the spec's Out of scope forbids it, and the chosen
  candidate must exist before build tasks are real.
- **Consequences:** Each candidate must carry both surfaces; the follow-on run
  re-plans implementation from the chosen candidate + seam reference.

### ADR-2: `staged` is a new phase enum value in contracts/state.yaml
- **Choice:** Extend the phase vocabulary: `staged | spec | plan | … | paused`, with
  `staged` the birth state and arming = `staged → spec`.
- **Rejected:** Reusing `phase: paused` with a new reason — `paused` semantically means
  "was authorized, stopped"; `deriveResumePhase` and the resume action (which re-opens
  declined gates) would need special-casing, and the inbox would show never-armed runs
  as interrupted ones. Also rejected: a draft ref namespace (`draft/<slug>`) — it
  invents a second branch vocabulary, breaks `listRuns`/`run/<slug>` invariants, and
  arming-by-rename severs history continuity.
- **Consequences:** Follow-on must amend `contracts/state.yaml`, `schema.ts` `PHASES`,
  and audit every `PHASES` consumer — notably the orchestrator D-table needs one new
  rest rule ("phase staged → rest; arming is a human decision", the D2 shape) and the
  readiness/inbox tables need a staged presentation. Task 03 enumerates the full blast
  radius. `docs/ORCHESTRATOR.md` already names enum amendment as the correct channel.

### ADR-3: Arming rides the existing decision write path
- **Choice:** `'arm'` becomes a `DecisionAction` in `planDecision`, executed via
  `writeState` — the single mutating route on the server, the same `decide()` shape in
  the CLI.
- **Rejected:** A dedicated `/api/intake/arm` route or a server-side armed flag — a
  second mutating route erodes the "R2: one write path" rule the codebase already
  enforces, and a server flag violates R10 (state lives in git). G0 confirmed arming
  is gate-grade: it inherits the decision path's identity refusal, CAS re-present, and
  audit grammar for free.
- **Consequences:** Arming appears in the decisions history like any human act; the
  gate frontend's decision UI grows one action rather than one subsystem.

### ADR-4: Creation seam is a plan/execute pair in core; scaffolding is template rendering
- **Choice:** `planRunScaffold` (pure) + `RunSource.stageRun` (create-only CAS from the
  zero OID), in `@agentic/core` beside `RunSource` — UI, CLI, and any future trigger
  all call it (IC-3). Scaffold content is mechanical rendering from `contracts/*`
  templates; no model invocation is needed to mint a valid staged run.
- **Rejected:** Scaffold logic in the server route or CLI — this repo already rejected
  duplicate-implementation drift for readiness rules (tech A8), and AC5.1's grep test
  makes the single seam a hard requirement. Also rejected: a separate intake
  package/service — a second control plane beside git (tech A5).
- **Consequences:** The follow-on implements exactly one branch-minting function;
  everything else is presentation over it. `LocalGitSource` gains the method; hosted
  sources inherit the contract.

### ADR-5: Task sources = committed registry + driver modules behind IC-1/IC-2
- **Choice:** `registry/task-sources.yaml` enumerates sources (the `models.yaml`
  posture); drivers are isolated modules; core and contracts carry only the neutral
  `TaskItem`/`intake:` fields. GitHub Issues is the first driver; nothing else is
  required to make a second possible.
- **Rejected:** Sources in `~/.config/agentic/config.yaml` — per-operator, unversioned,
  invisible to the team and to CI; the registry posture is the repo's stated pattern
  for pluggable bindings. Also rejected: GitHub types in core/contracts — violates R4
  and the intent brief's no-lock-in constraint outright.
- **Consequences:** The source-picker, `/api/intake/sources`, and CLI `--source` all
  read one committed file; drivers own auth-credential names and ref grammar.

### ADR-6: Issue-import → LLM → brief is the centered pipeline; drafting is a registry-bound, degradable capability
- **Choice:** Per G0, candidates center the import pipeline. The LLM drafting step is
  bound through the registry (a drafting-role entry resolved via `models.yaml`
  profiles — no vendor name in contracts), invoked server-side at explicit human
  request, and **degrades structurally**: with no drafting model configured, the
  verbatim fetched body becomes the editable draft. Free text is a secondary capture
  mode that feeds the same draft→review→stage path, never a zero-review compile-and-run.
- **Rejected:** Centering the bare free-text box (G0: the case least likely to be
  supported). Rejected: a bespoke model client hard-wired in the server — violates P2's
  posture; the registry/adapter seam is the existing channel for "which model does
  this work." Rejected: making drafting mandatory — hosted read-only deployments
  (`ORCH_ENABLED=0`, no API key) must still be able to stage runs.
- **Consequences:** Hosted deployments wanting drafting need model auth even with the
  orchestrator off (a `docs/DEPLOY.md` delta, noted for follow-on). Drafting cost
  accounting: the draft's cost is carried into the staged run's opening ledger entry
  at staging; abandoned drafts are logged host-side against the host-wide spend limit,
  not any run — task 03 specifies this.

### ADR-7: Staging is the first commit; nothing exists server-side before it
- **Choice:** "Staged" begins at the atomic scaffold commit. The pre-stage draft
  (fetched item, LLM draft, human edits) lives in the client (browser form state /
  CLI process). No pending-request store of any kind.
- **Rejected:** A committed draft-autosave branch per keystroke/edit — it turns every
  abandoned form into repo litter, needs GC machinery, and buys nothing R10 demands:
  AC10.1 requires *staged* runs to survive restart, and they do — they're commits. An
  in-memory pending store is exactly the second control plane tech A5 forbids.
- **Consequences:** A server restart mid-edit loses an unsubmitted form (an accepted,
  ordinary web-form property — candidates should still design the failed-submit /
  retry states); everything after the confirm gesture is git-durable.

### ADR-8: Collision policy — refuse and name, never suffix; replay returns the existing run
- **Choice:** Same idempotency identity replayed → `exists`, identifying the existing
  slug/branch. Same slug, different identity → `refused: slug-taken`, naming the
  existing run (including merged historical runs). Concurrent create race → one winner
  via create-only CAS; loser gets `conflict`, re-presented to the human. Slug is
  auto-suggested from title/ref, human-editable before confirm.
- **Rejected:** Silent `-2` suffixing — tech A7 names it the anti-pattern: it converts
  operator mistakes and webhook replays into duplicate spending runs. Silent no-op
  also rejected: AC6.1 requires the response to identify the existing run.
- **Consequences:** Candidates must design the distinguishable already-exists and
  conflict states (AC6.2) on both surfaces; the seam reference carries the decision
  table.

## Requirement → task mapping

| Requirement | Task(s) | Notes |
|-------------|---------|-------|
| R1  | 01, 02, 03 | candidates: entry affordance + capture; 03: CLI positional-arg contract |
| R2  | 01, 02, 03 | AC2.1 candidates; AC2.2 flag parity in 03 (IC-6) |
| R3  | 01, 02 | field count + pre-filled budget per IC-5 default chain |
| R4  | 03; 01, 02 | 03: driver/registry design (AC4.1/4.2); candidates: source-picker |
| R5  | 03; 01, 02 | 03: single seam (AC5.1); candidates: identical skeleton render (AC5.2) |
| R6  | 03; 01, 02 | 03: idempotency table (AC6.1); candidates: exists/conflict states (AC6.2) |
| R7  | 01, 02, 03 | candidates: preview + confirm gestures (AC7.1/7.2); 03: staged lifecycle + no-unattended-staging (AC7.3) |
| R8  | 03 | auth mapping to DEPLOY.md proxy + CLI identity refusal |
| R9  | 01, 02; 03 | candidates: review/edit step (AC9.1); 03: human-identity commit mechanics (AC9.2) |
| R10 | 03 | staged state on the run branch; no pending store (ADR-7) |
| R11 | 01, 02, 03 | candidates: interaction design incl. transcripts; 03: command contract |
| R12 | 01, 02 | labels + failed-submit focus behavior |
| R13 | 01, 02 | anti-generic-dashboard mandate |
| R14 | 03; 01, 02 | 03: `intake:` block (AC14.1); candidates: ref visible in preview |

## Risks

- **Budget headroom.** ~$22.6 remains against the $30 cap; the three tasks estimate
  ≈$20 (2 × designer $6, implementer $8), leaving no room for reviewer dispatches at
  $4/round. Mitigation: the G2 human reviews candidates 01/02 directly (aesthetic
  judgment concentrates at the gate anyway); reserve automated review for 03 only if
  headroom allows. Early signal: ledger sum after the first designer lands.
- **`staged` enum blast radius underestimated.** `PHASES` feeds `schema.ts`,
  `deriveResumePhase`, the readiness/inbox tables, and the orchestrator D-table; a
  missed consumer in the follow-on shows up as staged runs vanishing from or
  misrendering in the inbox. Early signal: task 03's consumer enumeration turns up a
  consumer with no obvious staged behavior — escalate to the plan, not around it.
- **Candidate divergence on the shared skeleton (AC5.2).** Two designers working in
  parallel could render different `state.yaml`/brief skeletons. Mitigation: IC-4 is
  the canonical skeleton and both task files bind to it verbatim; deviation requires a
  note per the design-candidate contract.
- **Drafting-capability assumptions.** Candidates that assume the LLM draft always
  exists will design an unbuildable happy path for keyless deployments. Mitigation:
  ADR-6's degradation is a named acceptance test in both candidate tasks (a
  "no drafting model" state must be sketched).
- **Gate-role mapping for design runs.** The design-candidate contract's "G1 human"
  language vs this run's G2-judges-candidates sequencing (Approach) could confuse the
  v1 reconciler or a future reader. Mitigation: sequencing is stated here, tasks flow
  as ordinary post-G1 work items, and the same human sits at both gates in this
  deployment. If the reconciler misbehaves on designer tasks, hand-dispatch (v0 mode)
  per the registry's P6 note.
- **External North Star artifact unavailable.** The G0 note's referenced document
  could not be fetched; the staged/armed decision proceeded on the note's own text
  ("runs initialized paused, explicitly kicked off"). If the artifact later contradicts
  this, it routes back as a G1 amendment, not a rework of the candidates.
