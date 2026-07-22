# Technical Plan: Run-creation seam — `agentic new` / `agentic arm`

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml. -->

## Approach

Everything hangs off one representational decision (ADR-1): a staged run is
`phase: paused` with `paused_reason: staged`. That makes the staged rest state
free — merged `derive.ts` rule D2 rests every paused run *before* the D21
profile-invariant check runs, and `'paused'` is already in every profile's
`PROFILE_PHASES` — so R5 needs no new phase, no new derivation row, and no
`PROFILE_PHASES` extension. Arming (ADR-2) becomes a new `arm` `DecisionAction`
whose target phase is `deriveResumePhase(state)`, which an all-undecided gate
ledger already resolves correctly per profile (`spec` for standard/full via G0,
`plan` for patch via G1).

Creation is split pure/impure along the package's existing layering: a pure
planner `planRunScaffold` in `record/` (new `record/scaffold.ts`) turns a
source-agnostic input into branch name + file contents + commit message; a new
`stageRun` method on `RunSource`/`LocalGitSource` builds the genesis commit
against the default branch's tree by composing the existing `writeTreeWithBlob`
once per blob (`git read-tree` accepts a tree-ish, so the previous call's tree
OID is the next call's base — no new `git.ts` primitive), commits it via
`commitTree(..., who)` under the staging human's identity, and lands it with
`updateRefCAS(refs/heads/run/<slug>, commit, ZERO_OID)` — the same create-only
idiom `writeState`'s remote-materialization path already uses.

`agentic new` and `agentic arm` are thin `commander` commands in
`cli/src/main.ts` following `decide()`'s exact shape (resolve source → identity
→ plan → single write path → exit codes), with `promptBurden`'s TTY-gate as the
interactive fallback. The draft-PR ensure (R8, #118) is one best-effort,
never-throwing core function over the `gh` CLI (the `GhCliProvider` idiom),
called from `agentic arm` and from the engine's dispatch execution (memoized
per slug). No server route, no web rendering, no task-source driver ships.

One binding environment constraint (ADR-6): this run branch's working tree
carries pre-#156 copies of `record/schema.ts`, `record/actions.ts`, and
`orchestrator/src/derive.ts` (verified: in-tree `schema.ts` has no `PROFILES`).
Task 01 merges current `main` into the run branch before any code task starts;
all interface citations below are to the merged-main versions.

Runtime facts the tasks bind to: Node ≥ 24 runs the TS sources directly in
strip-only mode (no parameter properties — `git.ts` documents this), tests are
vitest via `npm test` in `frontend/`, CLI tests spawn `node .../main.ts`.

## Interface contracts

### `record/scaffold.ts` (new; record layer — imports `schema.ts` only)

```ts
export interface RunScaffoldInput {
  slug: string                     // /^[a-z0-9][a-z0-9-]*$/ — branch- and path-safe
  title: string
  profile: Profile                 // 'patch' | 'standard' | 'full'
  briefMarkdown: string            // full intent-brief.md content, human-authored/confirmed (R3)
  costLimitUsd: number | null      // null = omit ceiling (hosted RB then refuses dispatch)
  intake: { source: string | null; ref: string | null; url: string | null; clientKey: string | null }
  stagedBy: string                 // human name echo; commit authorship stays authoritative
}
export interface RunScaffold {
  slug: string
  branch: string                   // `run/${slug}`
  files: Record<string, string>    // run-dir-relative path -> content
  message: string                  // commit message (grammar below)
  clientKey: string | null         // for stageRun replay detection
}
export class ScaffoldError extends Error {}          // invalid slug/empty brief/empty title
export function planRunScaffold(input: RunScaffoldInput): RunScaffold
/** The `intake:` block of a parsed state (passthrough key), or null. */
export function readIntake(state: RunState): { source: string | null; ref: string | null; url: string | null; client_key: string | null; staged_by: string | null } | null
```

`files` always contains `state.yaml` and `intent-brief.md`; for
`profile: patch` also `tasks/01-<slug>.yaml`. Emitted `state.yaml` shape
(load-bearing — AC4.1–4.4, AC5.2 fixture-test it per profile through
`parseRunState`):

```yaml
run: <slug>
branch: run/<slug>
phase: paused             # staged — not yet armed; `agentic arm <slug>` starts the run
paused_reason: staged
profile: <profile>        # patch | standard | full
intake:                   # source-agnostic staging provenance (R9); free-form path: nulls + client_key
  source: null
  ref: null
  url: null
  client_key: <key-or-null>
  staged_by: <name>
budget:
  cost_limit_usd: <n>     # default 50 (contracts/state.yaml's illustrative value) unless overridden
  cost_spent_usd: 0
  ledger: []
gates:                    # exactly PROFILE_GATES[<profile>] — no others
  G1: { approved: false, by: null, at: null, notes: null }
  G2: { approved: false, by: null, at: null, notes: null }
tasks: []
escalations: []
```

The patch task stub carries **every** top-level key of
`contracts/work-item.yaml` (validate.ts derives required keys from the
template, so `requirements` is required too, beyond AC4.2's parenthetical
list): `id: 01-<slug>`, `title: <title>`, `requirements: []`, placeholder
`scope`, `file_contact_surface: []`, `acceptance_tests: []`, `depends_on: []`,
`status: pending`, `notes: ""`.

Commit-message grammar (human decision grammar; documented in
`contracts/state.yaml` by task 07):

```
state(<slug>): staged by <name>
state(<slug>): staged by <name> [client-key: <key>]
state(<slug>): armed by <name>
```

### `record/schema.ts` + `record/actions.ts` deltas

```ts
export const PAUSED_REASONS = ['budget-exhausted', 'round-cap', 'escalation', 'gate-declined', 'staged'] as const
export const STAGED_REASON = 'staged'   // exported; string comparisons never inline the literal twice

export type DecisionAction = 'approve' | 'decline' | 'resolve-escalation' | 'pause' | 'resume' | 'arm'
// planDecision, new `case 'arm':`
//   precondition: state.phase === 'paused' && state.paused_reason === STAGED_REASON,
//     else DecisionError naming what the run actually is (AC6.2)
//   target = deriveResumePhase(state)      // all-undecided ledger: standard/full -> 'spec', patch -> 'plan'
//   mutate: phase -> target, paused_reason -> null
//   message: `state(${slug}): armed by ${who.name}`
// `resume` case adds: paused_reason === STAGED_REASON -> DecisionError('run is staged, not paused mid-flight — use `agentic arm <slug>`')
// `pause` case adds: input.pauseReason === STAGED_REASON -> DecisionError (staging is a birth state, not a pause reason)
```

### `sources/source.ts` + `sources/local-source.ts` deltas

```ts
export type StageRefusal = 'no-identity' | 'slug-taken' | 'conflict'
export type StageOutcome =
  | { outcome: 'created'; slug: string; branch: string; commit: string; pushFailed?: string }
  | { outcome: 'exists'; slug: string; branch: string }        // idempotent replay (AC1.3) — a success
  | { outcome: 'refused'; reason: StageRefusal; message: string }
export interface RunSource {
  // ...existing members...
  stageRun(scaffold: RunScaffold, who: Identity): Promise<StageOutcome>
}
```

`LocalGitSource.stageRun` sequence (the only branch-minting path, R1):

1. Identity precondition first, before any git write: `who` (and
   `this.identity()`) must resolve; else
   `refused: no-identity`, message adapted from `writeState`'s:
   `"git user.name/user.email are unset — staged runs must be attributable to a named human"` (AC7.1).
2. Existence scan via `listRuns()` + `readState` + `readIntake` (covers local,
   remote-only, and merged-into-default runs), decision table in ADR-4.
3. Genesis commit: `tip = revParse(defaultBranch)`; for each entry of
   `scaffold.files`, `hashObject` then `writeTreeWithBlob(prevTreeIsh, `<runsRoot>/<slug>/<path>`, blob)`
   seeded with `tip`; `commit = commitTree(tree, tip, scaffold.message, who)` —
   `who` explicitly, **never** `this.options.identity` (a bot-pinned source
   must still stage as the human; dedicated test).
4. `updateRefCAS('refs/heads/run/<slug>', commit, ZERO_OID)`; on `false`,
   re-run step 2 and re-derive (`exists` if the winner matches the staging
   identity, else `refused: conflict`) — never a blind retry.
5. Push when `options.push`, reporting `pushFailed` like `writeState`.

Note `<runsRoot>` comes from `frameworkRoots()`, same as `runDir()`.

### `sources/pr-ensure.ts` (new) + engine/CLI call sites (R8)

```ts
export interface EnsurePrResult { status: 'created' | 'exists' | 'skipped'; note: string }
/** Best-effort, never throws: no origin, branch not on origin, gh missing/unauthed, or any gh failure -> 'skipped' with the reason in `note` (AC8.2). */
export function ensureDraftPr(dir: string, branch: string, slug: string, opts?: { exec?: ExecLike }): Promise<EnsurePrResult>
```

Steps: `configGet('remote.origin.url')` null → skipped; no
`refs/remotes/origin/<branch>` → skipped ("branch not pushed"); `gh pr list
--head <branch> --state all --limit 1 --json number` (the `GhCliProvider`
invocation idiom, injectable `exec` for tests) → any PR → `exists`; else `gh pr
create --draft --head <branch> --base <defaultBranch> --title "run/<slug>"
--body <one line pointing at runs/<slug>/>` → `created`. One new barrel line in
`sources/index.ts`.

Call sites: `agentic arm` after a successful write (using the source's `dir`,
as the `sync` command already does); `Engine.execute`'s `dispatch` case after
the intent commit is accepted, memoized in a per-process `Set<string>` keyed by
slug (idempotent anyway; the memo just avoids a `gh` round-trip per tick).
`grep stageRun frontend/packages/orchestrator/src` stays empty — the engine
ensures PRs, it never stages runs.

### CLI (`cli/src/main.ts`)

```
agentic new
  --slug <slug> --title <t>                      # required content
  --profile <patch|standard|full>                # default: standard
  --brief-file <path>                            # required content when non-interactive (R3/AC3.2)
  --budget <usd>                                 # default 50
  --key <client-key>                             # optional idempotency key
  --source <id>                                  # when several sources are configured
agentic arm <slug> [--source <id>]
```

- All required content via flags → no prompts, stage, exit 0 (AC2.1).
- Missing content + stdin TTY → `readline/promises` prompts for slug/title;
  brief drafted from the repo's `contracts/intent-brief.md` template (title
  substituted, structure only — never invented prose, R3), written to a temp
  file and opened in `$EDITOR`/`$VISUAL` (fallback `vi`; a new behavior, no
  repo precedent — see design of record §7), re-read, then a printed preview
  and an explicit `stage? [y/N]` confirm before any commit (AC3.1).
- Missing content + stdin non-TTY → exit 1 naming the missing flags, no
  commit — `promptBurden`'s refusal shape one-for-one (AC2.3).
- Brief validation in both modes: required H2s from
  `source.templates.read('intent-brief.md')` via `extractSections` (fallback
  `BUILTIN_SECTIONS`); a brief missing sections is refused (interactive:
  offer re-edit), never padded with generated prose.
- Exit codes mirror `decide()`: `created`/`exists` → 0 (`exists` prints
  `already staged: <slug> (<branch>)` on its own line); `refused` → 1;
  `conflict` → 2 (the `ref-moved` idiom).
- `arm` = `decide()` flow with `{ action: 'arm' }`, then `ensureDraftPr`,
  printing its note.

## Decisions (ADRs)

### ADR-1: Staged rest state = `phase: paused` + `paused_reason: staged` (R5, AC5.1)
- **Choice:** Reuse `paused`. Merged `deriveAction` returns D2 rest for
  `phase === 'paused'` *before* the D21 profile-invariant check is reached, and
  `'paused'` is in every profile's `PROFILE_PHASES` — so no derivation-table
  row, no new rule label, and no per-profile `PROFILE_PHASES` extension is
  needed. Addresses AC5.1(a) directly: D20 (task failed twice) and D21
  (profile invariant) are already assigned in merged `derive.ts`, and this
  choice consumes no label at all. Addresses AC5.1(b): a bare new phase value
  would be escalated by D21 for every profile unless `PROFILE_PHASES` were
  extended ×3; `paused` needs nothing.
- **Rejected:** A new `staged` `PHASES` value (the design of record's ADR-2,
  written pre-#156) — costs `PHASES` + `PROFILE_PHASES`×3 + a new derivation
  label (D22) + guards in `planDecision`'s pause/resume + a readiness/inbox
  gap, and creates an upgrade-ordering hazard: any deployed stack with the
  older `z.enum(PHASES)` bounces `phase: staged` as malformed. The design of
  record's "falls through safely" claim for a bare phase is no longer true
  under merged D21.
- **Consequences:** Staged runs render as `paused (staged)` in existing
  surfaces — acceptable; rendering a staged/armed distinction is explicitly
  out of scope. AC4.2's "initial phase is plan" for patch is honored as the
  *post-arm* phase (via `deriveResumePhase`), not the scaffolded phase; the
  scaffolded phase is uniformly `paused`. `PAUSED_REASONS` gains one entry
  (in-tree grep: the constant currently has zero consumers, so no exhaustive
  switch breaks).

### ADR-2: `arm` is a new `DecisionAction`; `resume` refuses staged runs (R6)
- **Choice:** New `case 'arm'` in `planDecision`, legal only from the staged
  rest state, target phase = `deriveResumePhase(state)` (already computes
  spec/spec/plan for full/standard/patch from an all-undecided ledger), commit
  message `state(<slug>): armed by <name>`. `resume` gains a refusal when
  `paused_reason === 'staged'`; `pause` refuses `--reason staged`.
- **Rejected:** Reusing `resume` verbatim — the audit grammar would not record
  arming as a distinct human act, `resume`'s gate-declined re-open logic and
  free `--phase` override would apply to never-armed runs, and AC6.2's "not in
  the staged rest state" refusal would have no home.
- **Consequences:** One new grammar line reserved for humans (task 07 documents
  it); `POST /api/decisions` untouched (no server change this run — a future
  carrier just passes the new action value through `planDecision`).

### ADR-3: Pure planner in `record/`, `stageRun` in `LocalGitSource`, composed `writeTreeWithBlob` (R1)
- **Choice:** `planRunScaffold` is pure text-out in the record layer (imports
  `schema.ts` only, honoring the layering test); `stageRun` is the single
  impure branch-minting path, building the multi-blob genesis tree by calling
  `writeTreeWithBlob` once per file with the previous call's tree OID as the
  next base (`read-tree` accepts any tree-ish — the design of record §3.2
  verified this composes), then create-only CAS from `ZERO_OID`.
- **Rejected:** A new `writeTreeWithBlobs(base, entries[])` git primitive —
  clearer but touches `git.ts` for no functional gain; the loop lives in one
  place (`stageRun`) with a comment. Also rejected: scaffolding via a worktree
  checkout — the plumbing path needs no checkout and inherits `writeState`'s
  no-checkout guarantees (R10 for free).
- **Consequences:** `RunSource` grows one required method; `LocalGitSource` is
  today the only `implements RunSource` (verify at implementation; a second
  implementer failing typecheck is the early signal). The scaffolded state is
  emitted as a template string (comments included) and fixture-tested through
  `parseRunState` per profile rather than built via a YAML `Document`.

### ADR-4: Idempotency/collision decision table (AC1.2, AC1.3)
- **Choice:** `stageRun` scans `listRuns()` before writing:
  1. Any existing run whose `intake.client_key` equals the scaffold's non-null
     `clientKey` → `exists` naming that run (replay, regardless of slug).
  2. Slug already present: if that run is in the staged rest state **and**
     (`clientKey` is null or matches its `intake.client_key`) → `exists`
     (replay); otherwise → `refused: slug-taken` naming the existing
     slug/branch — an active or historical run is never claimed as a replay,
     and nothing ever mints `<slug>-2`.
  3. CAS loser: re-scan, re-derive `exists` vs `refused: conflict`; never
     silently retried.
- **Rejected:** Treating every same-slug call as a replay — `agentic new
  --slug wordfreq` against a finished historical run would then report
  "already staged" for a run that was never this staging identity's; the
  staged-rest check keeps replay honest. Also rejected: suffixing slugs.
- **Consequences:** The second call's outcome is distinguishable (`exists`,
  exit 0, its own output line) from both the first (`created`) and a genuine
  collision (`refused`, exit 1) — AC1.3's three-way distinction.

### ADR-5: Draft-PR ensure = one `gh`-CLI core function, called from arm + engine, never fatal (R8)
- **Choice:** `ensureDraftPr` in `sources/pr-ensure.ts` (list-then-create over
  `gh`, injectable exec for tests), returning
  `created | exists | skipped` + note, never throwing. Called by `agentic arm`
  and by the engine after each accepted dispatch intent (memoized per slug per
  process) — the same idempotent logic regardless of how the branch was made,
  which is what closes #118 for hand-made, CLI-made, and future runs alike.
- **Rejected:** REST (`RestPrProvider`-style) creation — needs a token this
  run has no config surface for; `gh` reuses the operator's auth exactly as
  `GhCliProvider` already does. Rejected: ensure-on-stage — a staged branch is
  often unpushed and has no reviewable diff yet; first arm/dispatch is the
  earliest moment a PR means something.
- **Consequences:** Tests must stub the exec seam (CI has no authed `gh`);
  AC8.2's degraded path is the `skipped` status plus a logged note; AC8.3 is
  satisfied by task 07's release note recording "Closes #118".

### ADR-6: Task 01 merges current `main` into the run branch before any code task (binding environment constraint)
- **Choice:** The first task is a mechanical `git merge origin/main` (this
  branch's non-`runs/` tree is untouched relative to main, so the merge should
  carry no content conflicts), verified by `PROFILES` appearing in in-tree
  `record/schema.ts` and `npm test` passing. Every other task depends on it,
  directly or transitively.
- **Rejected:** Implementing against the extracted `/tmp/creation-seam-refs/*`
  copies without merging — the tree would not compile against the plan's
  interfaces, and `/tmp` is not durable across implementer environments.
- **Consequences:** All plan citations refer to merged-main content. If the
  merge conflicts outside `runs/`, or `origin/main` has moved past #156 in a
  way that contradicts an interface above, the implementer escalates instead
  of resolving by hand — that would be new information the plan didn't see.

### ADR-7: Non-interactive brief content only via `--brief-file`; interactive drafting is template + `$EDITOR` (R3)
- **Choice:** The CLI never generates Problem/Motivation/Constraints prose. A
  non-interactive stage requires an operator-authored `--brief-file`; the
  interactive path seeds the editor with the repo's contract template (title
  substituted — structure, not content) and requires an explicit confirm.
  Section-completeness is validated via the existing `extractSections`
  machinery; missing sections refuse rather than pad.
- **Rejected:** Per-section flags (`--problem`, `--motivation`, …) — more flag
  surface for the same human-authorship guarantee, and multi-line prose in
  flags is hostile; a file the operator wrote is the honest unit. LLM drafting
  is out of scope by spec.
- **Consequences:** AC3.2's "verbatim import is not by itself sufficient"
  principle binds the flag/file path: the CLI records the staging human as
  commit author, which is the confirmation act for a file they authored.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 (AC1.1–1.4) | 02, 03 (AC1.4 by construction: no server-package task exists; verifier greps the diff) |
| R2 (AC2.1–2.3) | 05 |
| R3 (AC3.1–3.2) | 05 |
| R4 (AC4.1–4.4) | 02 (planner + per-profile fixtures), 05 (`--profile` carrier) |
| R5 (AC5.1–5.3) | 02 (representation per ADR-1/AC5.2), 06 (AC5.3 derive tests); AC5.1 is ADR-1 itself |
| R6 (AC6.1–6.2) | 02 (`arm` action), 05 (`agentic arm`) |
| R7 (AC7.1) | 03 (stageRun refusal), 05 (CLI pre-check) |
| R8 (AC8.1–8.3) | 04 (ensure fn), 05 (arm call site), 06 (engine call site), 07 (release note, #118) |
| R9 (AC9.1–9.2) | 02 (neutral planner input), 03 (neutral intake block); verifier runs the AC9.2 grep |
| R10 (AC10.1) | 03 (plumbing-only genesis; `git show` test) |

## Risks

- **The run branch merge (task 01) conflicts or `origin/main` moved past
  #156.** Early signal: any conflict outside `runs/`, or `PROFILES` /
  `deriveResumePhase` / `planDecision` shapes differing from this plan's
  citations. Response: escalate from task 01; do not hand-resolve framework
  code in a merge commit.
- **A second `RunSource` implementer exists somewhere this plan didn't see**
  (demo/server code) — adding a required `stageRun` breaks its typecheck.
  Early signal: `npm run typecheck` in task 03. Response: implement it there
  too if trivial, else escalate.
- **`PAUSED_REASONS` gains a consumer between plan and implement** (an
  exhaustive switch on `PausedReason`). Early signal: typecheck in task 02.
- **`gh` behavior in CI/test environments** — tests must never shell out to
  real `gh`; the injectable exec seam in `ensureDraftPr` is mandatory, and the
  engine call site must tolerate `skipped` silently. Early signal: task 04/06
  tests hanging or failing only in CI.
- **Interactive-path testability** — `$EDITOR` spawning is hard to drive from
  `cli.test.ts`. Mitigation: factor the prompt/edit/confirm flow into exported
  helpers (the `runUpgrade` precedent) unit-testable without a TTY; the
  spawned-process tests cover the non-TTY refusals (AC2.3) and flags-complete
  path (AC2.1).
- **Grep hygiene (AC9.1/AC9.2)** — new code in `record/*.ts` and
  `sources/*.ts` must not use the words issue/label/assignee/milestone even in
  comments (write "tracker item"/"upstream ref"). The verifier confirms the
  only matches remain `record/schema.ts`'s two zod `ZodError.issues` lines
  (count them before trusting the check).
