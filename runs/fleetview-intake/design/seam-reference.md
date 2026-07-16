# Seam Reference: Upstream task intake — buildable specification

<!-- Produced by an Implementer (task 03) elaborating plan.md IC-1..IC-6 and
     ADR-2..ADR-8 against this checkout's actual source, per spec.md and
     tech-research.md. Consumer: the follow-on implementation run's Architect
     and Implementers. This document writes no code: every contracts/,
     registry/, and frontend/ change below is a *proposal*, quoted verbatim
     for the follow-on run to apply and verify. Every code reference (file,
     line, function) was read from this checkout at the time of writing;
     where plan.md's proposed signatures could not be found in source, or
     source contradicts a plan assumption, that is recorded explicitly in the
     "Discrepancies" note at the end of the relevant section, never silently
     resolved. -->

## 1. Contract deltas

### 1a. `contracts/state.yaml`

Three amendments, all additive (existing readers using `.passthrough()` /
tolerant parsing are unaffected until the follow-on also updates
`frontend/packages/core/src/schema.ts`'s `PHASES` — see §5).

**(i) Phase enum comment (line 19).** Today:

```yaml
phase: spec               # spec | plan | implement | integrate | release | done | paused
```

Proposed:

```yaml
phase: staged             # staged | spec | plan | implement | integrate | release | done | paused
```

`staged` is prepended, not appended: it is the birth state, before `spec`
(ADR-2). This is a comment-only change to the *template*; the enforced
vocabulary lives in `schema.ts`'s `PHASES` array (§5), which is the actual
follow-on edit.

**(ii) The `intake:` provenance block.** New top-level key, inserted after
`paused_reason` and before `budget:` (contracts/state.yaml currently runs
`run` → `branch` → `phase` → `paused_reason` → `budget:` at lines 17-22):

```yaml
intake:                   # R14: neutral, source-agnostic provenance for a
                          # staged run — the only home of the external
                          # reference this run started from. Present from the
                          # first (staging) commit; never edited after.
  source: null            # registry/task-sources.yaml driver id (e.g.
                          # "github"), or null for a free-form/utterance stage
  ref: null                # driver-scoped external ref (e.g. "acme/widgets#482"),
                          # or null for free-form
  url: null                # human-followable link to the upstream item, or null
  client_key: null         # idempotency key supplied by the staging client for
                          # free-form drafts (source/ref both null); null when
                          # source/ref are set — exactly one of {ref, client_key}
                          # identifies a staged run for replay purposes (§4)
  staged_by: null          # the confirming human's name (git identity), for a
                          # human-readable echo of the commit's own authorship —
                          # never a substitute for checking commit authorship
```

Justification: R10 requires staged/drafting state to live on the run branch,
survive a restart, and be readable via git alone — `intake:` is ordinary
committed YAML, so it inherits that for free (no new store). R14 requires the
external ref to be recorded in a *neutral* field so a future write-back
doesn't need re-architecture — `source`/`ref`/`url` are driver-opaque strings
(no tracker noun), matching R4's constraint that `contracts/*` never carry a
tracker's vocabulary (AC4.1).

**(iii) Commit-message grammar.** The header comment's grammar block (lines
10-16) gets two new entries, one per lifecycle act (both human-decision
grammar, since staging and arming are human acts per R7/R9, not bot
bookkeeping):

```
#       human decision grammar (reserved for humans):
#         state(<slug>): G2 approved by <name> [burden: light-correction]
#         state(<slug>): staged by <name> [source: github acme/widgets#482]
#         state(<slug>): staged by <name> [client-key: <key>]
#         state(<slug>): armed by <name>
```

The two `staged by` forms exist because `intake.source` is nullable (import
vs. free-form); the grammar documents both so a human reading `git log` can
tell which without opening the diff.

### 1b. `contracts/intent-brief.md`

The current file (verified in full) is:

```
# Intent Brief: <title>

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

## Problem
...
```

Proposed addition — a second, optional HTML comment, present only on briefs
that originated from an upstream item, placed directly under the existing
contract comment and before `## Problem`:

```
<!-- Provenance (present only when this brief was drafted from an upstream
     item): source github, ref acme/widgets#482, url
     https://github.com/acme/widgets/issues/482. Imported and confirmed by
     Jordan Alvarez on 2026-07-15. A verbatim import is not by itself a
     human-authored brief (R9) — this comment records that a named human
     reviewed and confirmed everything below before it was committed; the
     commit's own author identity (§8) is the authoritative provenance
     record, this comment is a human-readable echo of it. -->
```

Justification: this is an HTML comment, not a `##` heading, so it does not
change the four required sections `extractSections()` looks for
(`frontend/packages/core/src/validate.ts:18-28`, `BUILTIN_SECTIONS`
`intent-brief.md` entry at `validate.ts:34`) — a brief with this comment
validates identically to one without it. R14 is served because the ref is
now recorded in *two* committed places (this comment and `state.yaml`'s
`intake:` block) — deliberately redundant, since the brief is the
human-facing artifact and `state.yaml` is the machine-facing one; a
write-back implementation can read either. R10 is served the same way as
§1a(ii): it's ordinary committed markdown, no new store.

**Discrepancy note:** the plan (IC-4) only specifies the `intake:` block in
`state.yaml`; a header comment on `intent-brief.md` is this document's own
elaboration of task 03's requirement 1(b) ("a header provenance comment for
imported items"), since no such comment exists in the current
`contracts/intent-brief.md` to quote or amend. Follow-on Architect should
confirm this placement (informational comment, not a fifth required section)
before building.

## 2. `registry/task-sources.yaml`

No file exists at this path today (`ls registry/` shows only `models.yaml`) —
this section is a full proposal, in the posture `registry/models.yaml`
already establishes (a committed, versioned, illustrative-content registry
that core code resolves at runtime, never edits).

```yaml
# registry/task-sources.yaml — the authority for WHICH upstream trackers task
# intake can pull from, mirroring registry/models.yaml's posture (models.yaml:1-6:
# "Swapping vendors is an edit here, never in roles/ or contracts/" — read
# "task sources" for "vendor" and "frontend/packages/core/src/*.ts" for "roles/").
#
# Driver isolation rule (AC4.1): tracker-specific nouns — issue numbers,
# labels, assignees, milestones, project fields, anything a specific tracker's
# API calls its own — may appear ONLY inside the driver module this entry's
# `driver:` id names (frontend/packages/core/src/task-sources/<driver>.ts).
# They may never appear in contracts/*, in @agentic/core's top-level
# src/*.ts files, or in this registry file itself: `label` and `ref_format`
# below are the driver's *display* strings, chosen to be readable by an
# operator who has never seen the tracker, not fields the tracker's API uses.
#
# Add or swap a source (AC4.2), and nothing else:
#   1. Write a driver module implementing TaskSourceDriver (§3) at
#      frontend/packages/core/src/task-sources/<id>.ts.
#   2. Add one entry below naming it.
#   3. Re-export it from frontend/packages/core/src/index.ts (the barrel;
#      @agentic/core's package.json exports only "." → src/index.ts, so any
#      new module needs an `export * from './task-sources/<id>.ts'` line
#      there to be reachable at all — verified: index.ts today has 14 such
#      lines, one per module, none for task-sources/).
# No contracts/* edit, no @agentic/core top-level type edit, is required or
# permitted for step 1-3 (AC4.1's grep target, §10).

sources:
  github:
    driver: github               # driver module id -> task-sources/github.ts
    label: GitHub Issues          # display name (web source-picker, CLI --source help)
    ref_format: "owner/repo#N or issue URL"
    auth: GIT_TOKEN                # env var the driver reads for API auth at
                                    # fetch time; never stored in this file,
                                    # never stored in state.yaml or any
                                    # committed artifact — same posture as
                                    # docs/DEPLOY.md's GIT_TOKEN (config
                                    # reference table, DEPLOY.md:74)
```

**Discrepancy / naming note:** `frontend/packages/core/src/github.ts` already
exists — but it is the PR-approval sync provider (`RestPrProvider`, `github.ts:33-85`),
used by the webhook's `pull_request_review` handling
(`frontend/packages/server/src/webhook.ts:66-85`) to sync G2 approvals, a
completely different concern from importing a *task item* to seed a new run.
The task-source driver this registry entry names is a **new** module at
`frontend/packages/core/src/task-sources/github.ts`, not a reuse of the
existing `github.ts`. Plan.md's IC-2 note ("follow-on location:
`frontend/packages/core/src/task-sources/<id>.ts`, the posture of the
existing isolated `github.ts` PR-sync provider") already reads this way on
close inspection — cited as *posture* (isolated module, tracker nouns
confined to it), not as the same file — but the naming collision risk is
worth flagging explicitly so the follow-on Architect doesn't attempt to
extend the existing `github.ts` and leak PR-sync and task-import concerns
into one module.

## 3. Creation seam — IC-3 elaborated against real code

### 3.1 The neutral shapes (new — none of these exist in source today; verified via
`grep -rn "TaskItem\|TaskSourceDriver\|IntakeDraft\|planRunScaffold\|StageOutcome\|stageRun" frontend/ contracts/ registry/` → no matches)

```ts
// frontend/packages/core/src/task-sources/types.ts (new)
export interface TaskItem {
  source: string        // driver id from registry/task-sources.yaml
  ref: string            // driver-scoped external ref, e.g. "acme/widgets#482"
  url: string | null
  title: string
  body: string            // markdown, re-fetched from the source of record — never
                          // trusted from a forwarded payload (tech A4)
}

export interface TaskSourceDriver {
  readonly id: string
  parseRef(input: string): string | null   // operator input (URL/shorthand) -> ref, else null
  fetchItem(ref: string): Promise<TaskItem>
}
```

```ts
// frontend/packages/core/src/intake.ts (new)
export interface IntakeDraft {
  slug: string
  title: string
  brief_markdown: string
  source: { id: string; ref: string; url: string | null } | null   // null = free-form
  client_key: string | null
  budget_limit_usd: number | null
}

export function planRunScaffold(draft: IntakeDraft, defaults: IntakeDefaults):
  { branch: string; files: Record<string, string>; message: string }

export type StageOutcome =
  | { outcome: 'created';  ref: RunRef; commit: string }
  | { outcome: 'exists';   slug: string; branch: string }
  | { outcome: 'conflict'; message: string }
  | { outcome: 'refused';  reason: 'no-identity' | 'slug-taken' | 'invalid-draft'; message: string }
```

`stageRun` is a new method on `RunSource` (`frontend/packages/core/src/source.ts`),
beside `writeState` (`source.ts:63`):

```ts
export interface RunSource {
  // ...existing members (source.ts:41-63)...
  stageRun(plan: ReturnType<typeof planRunScaffold>, who: Identity): Promise<StageOutcome>
}
```

— implemented once, in `LocalGitSource` (`frontend/packages/core/src/local-source.ts`),
the only class implementing `RunSource` today (verified: `grep -rn "implements RunSource"`
finds only `local-source.ts:15`).

### 3.2 The create-only CAS mechanism, against the existing idiom

`git.ts`'s `updateRefCAS` (`git.ts:262-269`) already implements exactly the
primitive the plan names — "create-only CAS from the zero OID" — and
`local-source.ts` already uses it that way once, for a related but distinct
case: materializing a *remote-only* branch's first local ref
(`local-source.ts:205`, `updateRefCAS(branchRef, remoteTip, ZERO_OID)`, guarded
by the comment at `local-source.ts:22-27` explaining `ZERO_OID` as "the ref
doesn't exist yet locally"). `stageRun` reuses the identical call shape —
`updateRefCAS(refs/heads/run/<slug>, newCommitOid, ZERO_OID)` — but for a
branch that has never existed anywhere (local or remote): the CAS succeeds
only if no other writer won the race first, which is exactly ADR-8's "one
CAS winner, loser conflict."

**Building the genesis commit — a real gap in the existing plumbing helpers,
worth flagging precisely.** `git.ts`'s `writeTreeWithBlob` (`git.ts:229-244`)
takes a `baseCommit`, `read-tree`s it, replaces **one** blob, and
`write-tree`s the result — built for `writeState`'s single-file mutation. A
staging commit needs **two** new blobs (`intent-brief.md` and `state.yaml`
under `runs/<slug>/`) written against the *default branch's* tree (so the
new branch inherits `contracts/`, `docs/`, everything else in the repo,
consistent with `readDiff`'s assumption that a run branch's reviewable diff
is computed against the default branch with `runs/` excluded —
`local-source.ts:152-157`). `writeTreeWithBlob` can be called **twice in a
row**, using the first call's returned tree OID as the second call's
`baseCommit` argument — `git read-tree` accepts any tree-ish, not only a
commit, so this composes without a new git.ts primitive, but it is worth the
follow-on either documenting this composition explicitly or adding a small
`writeTreeWithBlobs(base, entries: {path, blobOid}[])` helper for clarity.
Concretely, the genesis sequence:

```
tip        = defaultBranch tip commit (git.ts:revParse via defaultBranch())
blob1      = git.hashObject(intent-brief.md content)
blob2      = git.hashObject(state.yaml content)
tree1      = git.writeTreeWithBlob(tip, "runs/<slug>/intent-brief.md", blob1)
tree2      = git.writeTreeWithBlob(tree1, "runs/<slug>/state.yaml", blob2)   // tree1 as base tree-ish
commit     = git.commitTree(tree2, tip, message, who)   // who: the CONFIRMING HUMAN's identity (§8), never options.identity
ok         = git.updateRefCAS(`refs/heads/run/<slug>`, commit, ZERO_OID)
```

`commitTree` (`git.ts:246-256`) already accepts an `identity` parameter used
exactly this way by `writeState`'s no-worktree path (`local-source.ts:257`) —
`stageRun` passes the confirming human's identity there, never
`this.options.identity` (the bot-pinning path, §8).

If `updateRefCAS` returns `false` (someone else's branch creation won the
race — including a different slug computed from the same title racing to the
same auto-suggested slug, or a literal double-submit), `stageRun` re-reads
`listRuns()` and re-derives the outcome from what's now there (§4) — never
retries blindly.

### 3.3 Exactly one branch-minting path (AC5.1) — the callers

`stageRun` on `RunSource`/`LocalGitSource` is the **only** place any blob,
tree, or commit for a new run branch is constructed. Every caller is
presentation over it:

1. **Web route** — the new `POST /api/intake/runs` handler in
   `frontend/packages/server/src/app.ts` (§6), which today has no analogous
   write besides `POST /api/decisions` (`app.ts:144-196`, itself calling
   `planDecision` + `source.writeState`, never touching git plumbing
   directly) — the new handler must follow the identical shape: validate the
   body, call `planRunScaffold` (pure), call `source.stageRun`, map the
   `StageOutcome` to an HTTP status (§6).
2. **CLI** — the new `agentic new` command in
   `frontend/packages/cli/src/main.ts` (§7), calling the same
   `@agentic/core` exports the way every existing command does (e.g. `decide()`
   at `main.ts:123-152` calling `planDecision`/`source.writeState` — no
   command in this file shells out to git itself; `grep -n "execFile\|spawn" frontend/packages/cli/src/main.ts`
   → no matches today, and must stay that way).
3. **Future triggers** — none exist today (the webhook's `onEvent` switch,
   `webhook.ts:89-99`, handles only `ping`/`push`/`pull_request_review`; there
   is no `issues`/`issue` case, and per R7/AC7.3 the follow-on must not add
   one that stages anything unattended, §4/§5). Any future event-driven
   *staging* (explicitly out of scope per spec.md's Assumptions) would still
   be required to call this same `stageRun` — the seam is the enforcement
   point, not a rule enforced separately per caller.

**Grep target for the follow-on's own verification (§10, AC5.1):**
`grep -rn "commitTree\|hash-object\|write-tree\|updateRefCAS" frontend/packages/server/src frontend/packages/cli/src`
must return **zero** matches — today it already returns zero (verified), and
the follow-on's job is to keep it that way; any hit outside
`frontend/packages/core/src/git.ts` and `local-source.ts` is a second,
independent scaffold-writing implementation and a boundary violation.

## 4. Idempotency and collision decision table (ADR-8)

**Identity.** For an imported draft: `(draft.source.id, draft.source.ref)`.
For a free-form draft: `draft.client_key` (required when `source` is null;
`stageRun` refuses `invalid-draft` if both `source` and `client_key` are
null — nothing to key replay-detection on).

**Existence scan.** Because there is no second control plane (ADR-7, tech
A5), replay/collision detection is a scan of `listRuns()` + `readState()`,
not an index. `listRuns()` (`local-source.ts:79-135`) already enumerates all
three cases the plan requires "existence checks" to cover:

- live local branches (`local-source.ts:87-91`),
- remote-only branches not yet fetched locally (`local-source.ts:92-97`),
- and runs merged into the default branch, branch deleted, found via
  `lsTreeDirs(defaultBranch, 'runs')` (`local-source.ts:112-123`) — the
  "historical merged runs" the task calls out by name. A branch that's an
  ancestor of the default branch is *also* reclassified to `kind: 'default'`
  even when the branch ref still exists (`local-source.ts:99-109`), so a
  merged-but-not-deleted branch is likewise covered.

`stageRun`'s outcome table:

| Case | Condition | Outcome | Detail |
|---|---|---|---|
| **Replay** | An existing run's `state.intake` matches the draft's identity exactly (same `(source,ref)` or same `client_key`) | `exists` | Names the existing `slug`/`branch` (AC6.1) — never mints a sibling, never a silent no-op |
| **Slug collision, different identity** | Draft's `slug` matches an existing run's `slug`, but that run's `intake` identity differs (or the existing run has no matching identity at all — e.g. a hand-authored run) | `refused: slug-taken` | Message names the existing run (slug + branch); never `<slug>-2` (ADR-8 rejects silent suffixing outright) |
| **Concurrent race** | Two `stageRun` calls observe no existing match, both attempt to mint the same branch name | One wins the `updateRefCAS`; the loser's CAS returns `false` | Loser re-reads `listRuns()`: if the winner's `intake` identity now matches the loser's draft → re-derive as `exists` (an honest replay that raced); otherwise → `conflict`, re-presented to the human, never silently retried (AC6.2) |
| **No identity** | `source.identity()` resolves to `null` (git `user.name`/`user.email` unset, same check `writeState` already performs at `local-source.ts:186-187`) | `refused: no-identity` | Checked **before** any git write is attempted — no partial state (AC8.2) |
| **Invalid draft** | Missing/empty `slug`, `brief_markdown`, or (both `source` and `client_key` null) | `refused: invalid-draft` | Structural validation in `planRunScaffold`, before any I/O |

**AC7.3 tie-in — why no unattended path stages anything.** Every entry point
into `stageRun` (§3.3) requires a resolved `Identity`. The orchestrator's own
write path never calls it: `derive.ts`'s `ROLES` constant
(`derive.ts:52`, `['analyst', 'architect', 'implementer', 'reviewer', 'verifier', 'ops']`)
has no intake-dispatching role, and the orchestrator's only identity is the
bot identity reserved for bookkeeping (`local-source.ts:24-27`'s
`options.identity`) — never plumbed into `stageRun`'s `who` parameter,
which must always be `source.identity()`'s *human* resolution (git config or
an interactive CLI/web session), matching §8's provenance rule. The
webhook's `onEvent` (`webhook.ts:87-101`) has no case that could reach
`stageRun` even indirectly (its two live cases, `push` and
`pull_request_review`, only call `syncFromRemote`/`applySync` — read-refresh
and G2-approval recording, neither of which touches branch creation). The
follow-on must not add an `issues`/`issue` case there that stages a run —
doing so would silently reopen the exact loophole tech A6 and R7's
Assumptions both name.

## 5. Staged lifecycle blast radius

Every `PHASES` (`frontend/packages/core/src/schema.ts:8`, currently
`['spec', 'plan', 'implement', 'integrate', 'release', 'done', 'paused']`)
consumer that needs a follow-on touch:

1. **`schema.ts` `PHASES`.** Prepend `'staged'`. Because `runStateSchema`
   parses `phase` with `z.enum(PHASES)` (`schema.ts:74`), a `state.yaml`
   carrying `phase: staged` **fails to parse at all** until this line lands —
   the follow-on's first, load-bearing edit. `parseRunState` treats a
   schema-parse failure as a malformed run (`schema.ts:106-113`), which
   would make every staged run appear as inbox kind `malformed` (§5.4 below)
   rather than invisible — worth the follow-on confirming this is the
   desired *pre-schema-update* transitional behavior for any staged run
   pushed against an older server (a genuine, if narrow, upgrade-ordering
   concern: servers must roll the schema change out before any client can
   stage a run, or a staged run pushed early will bounce as malformed until
   the server catches up).

2. **`schema.ts` `deriveResumePhase`** (`schema.ts:139-145`). Unaffected in
   the sense that it is never called for a staged run in the current call
   graph (it's invoked only from the `resume` `DecisionAction`, gated on
   `state.phase === 'paused'` — `actions.ts:137`) — **but** a real gap
   surfaces one level up:

3. **`actions.ts` `planDecision`'s `pause` case** (`actions.ts:123-135`)
   does **not** exclude `phase: staged` — it only refuses when
   `phase === 'paused'` or `phase === 'done'`. As written today, a staged
   run **could** be paused via the existing `pause` action (harmless on its
   own — a staged run dispatches nothing regardless), but **resuming** it
   would then call `deriveResumePhase`, which — seeing all four gates
   undecided — returns `'spec'` (`schema.ts:140`), silently **promoting a
   never-armed run past staging and into the phase that makes the
   orchestrator dispatch the Analyst** (`derive.ts`'s `producerPhase(obs,
   'G0')`, reached via the `case 'spec':` arm of `deriveAction`'s switch,
   `derive.ts:123-124`). This is exactly the "consumer with no obvious staged
   behavior" plan.md's Risks section warns the follow-on to escalate rather
   than route around (plan.md, "`staged` enum blast radius underestimated").
   **The follow-on must close this**: either refuse `pause` when
   `phase === 'staged'` (matching the `done` refusal's shape, simplest and
   recommended — a staged run has nothing running to pause), or special-case
   `deriveResumePhase` to return `'staged'` when no gate has been touched.
   This document does not resolve which; it names the gap precisely so the
   follow-on Architect makes the call deliberately.

4. **`actions.ts` `resume`'s target validation** (`actions.ts:139`,
   `if (!PHASES.includes(target) || target === 'paused') throw ...`). Once
   `'staged'` is added to `PHASES`, `--phase staged` becomes a *syntactically
   legal* `resumePhase` argument to the existing `resume` command
   (`frontend/packages/cli/src/main.ts:222-230`) unless explicitly excluded.
   The follow-on should add `|| target === 'staged'` alongside the existing
   `'paused'` exclusion — resuming into `staged` is nonsensical (arming, not
   resuming, is how a staged run leaves that phase).

5. **`frontend/packages/orchestrator/src/derive.ts` `deriveAction`**
   (`derive.ts:100-134`). `state.phase === 'done'`/`'paused'` are handled
   before the phase switch; a `staged` run falls through the `GATE_PHASES`
   loop (`derive.ts:115-120`) without matching (no `GATE_PHASES` entry lists
   `'staged'` — `schema.ts:131-136` only lists G0-G3's own phases), then
   reaches the `switch (state.phase)` (`derive.ts:122-132`), which has no
   `'staged'` case and falls to the final `return rest('D0', ...)`
   (`derive.ts:133`). **This is already a safe rest** — a staged run cannot
   be spuriously dispatched even with zero code changes here, which is a
   load-bearing fact for AC7.3 — but it is a *mislabeled* rest: `D0`'s
   documented meaning is "state.yaml malformed" (`derive.ts:9`), and logging
   a staged run under that rule would read as a false malformed-state alarm
   to a human watching tick output. The follow-on must add a genuine new
   row — this document proposes **D20** (the next free label; D0-D19 and DB
   are all already assigned, verified against `derive.ts:9-30`'s table and
   `derive.test.ts`'s per-row tests) —
   `case 'staged': return rest('D20', 'staged — awaiting a human arm (POST /api/decisions action=arm)')`,
   "the D2 shape" the plan asks for (i.e., a rest row with a one-line
   human-readable `why`, exactly like `D2`'s paused-rest at `derive.ts:104-105`).
   Both the module header's comment-table (`derive.ts:9-30`) and
   `docs/ORCHESTRATOR.md`'s prose mirror of it (`ORCHESTRATOR.md:119-129`)
   need the new row too.

6. **`frontend/packages/core/src/readiness.ts` `deriveReadiness`**
   (`readiness.ts:67-216`). This is the most consequential gap: a staged run
   is not `paused` (skips the paused block, `readiness.ts:144-160`), and
   `pendingGate` (`readiness.ts:60-65`) finds no gate whose `GATE_PHASES`
   list includes `'staged'`, so the function falls through to
   `return { items, validations }` at `readiness.ts:164` with **zero
   items** — meaning, unmodified, a staged run generates **no inbox entry at
   all**, even though a staged-but-not-armed run is exactly the state that
   needs a human to act (arm it, or abandon it). This directly undercuts the
   intake flow's usefulness once a "stage now, arm later" gap exists (the
   plan's CLI `--arm` flag and the "adjacent Stage & arm affordance" are both
   optional, so a bare-stage path is real). The follow-on must add a new
   `InboxKind` (this document proposes `'staged'`) and a block parallel to
   the existing paused block — same shape as `readiness.ts:144-160` — kind
   `'staged'`, title e.g. `` `Staged, not yet armed` ``, detail naming the
   `intake` source/ref when present, `packet: ['state.yaml']`,
   `reviewable: true`. Without this, `needsHuman` in `portfolio.ts`'s
   `RunSummary` (`portfolio.ts:28`, `90`, derived as `items.length`) also
   silently under-counts staged runs.

7. **Presentation (web).** `frontend/packages/web/src/components/chips.tsx`:
   `PHASE_TONE` (`chips.tsx:5-14`) has no `staged` entry — falls back to
   `'text-muted'` (`chips.tsx:17`, harmless but undifferentiated) — and
   `KindChip`'s label/tone maps (`chips.tsx:34-40`) have no entry for the new
   `'staged'` `InboxKind` from item 6 above — the label lookup
   (`chips.tsx:34`) would evaluate to `undefined` for an unhandled kind, and
   React renders an `undefined` child as nothing, so (verified against
   `chips.tsx:41-45`'s JSX) the badge would render **empty**, not the literal
   text "undefined" — still a real defect (a blank badge reads as broken, not
   as "staged"), just not the failure mode a naive reading of "renders
   `undefined`" suggests. Both need one new row each. No other
   file needs a `'staged'` case merely to avoid crashing — `PhaseChip`
   renders any string — but both are needed for a staged run to read as
   distinct from "unknown"/malformed to an operator scanning the portfolio
   (`frontend/packages/web/src/pages/portfolio.tsx:45`) or run page
   (`frontend/packages/web/src/pages/run.tsx:68`).

8. **Docs.** `docs/ORCHESTRATOR.md`'s D-table prose (§4.2, `ORCHESTRATOR.md:119-129`)
   needs the new staged-rest row (item 5); `docs/DEPLOY.md`'s configuration
   reference table (`DEPLOY.md:69-90`) needs the new `INTAKE_DEFAULT_BUDGET_USD`
   row (§6) in the same format as the existing `GITHUB_WEBHOOK_SECRET` row
   (`DEPLOY.md:83`), and a note that a drafting-model API key is required
   independent of `ORCH_ENABLED` (plan ADR-6's consequence) alongside the
   existing `ANTHROPIC_API_KEY` row (`DEPLOY.md:86`, currently gated
   `with ORCH_ENABLED=1` — the drafting capability needs its own row or an
   amendment to that one's "Required" condition).

### Arming, precisely

`'arm'` is a new `DecisionAction` (today: `'approve' | 'decline' |
'resolve-escalation' | 'pause' | 'resume'`, `actions.ts:19`) added to that
same union, handled by a new `case 'arm':` in `planDecision`'s switch
(`actions.ts:53-165`). Legality: `state.phase === 'staged'` only (mirroring
every other case's own precondition check, e.g. `resume`'s
`actions.ts:137`). Mutation: `phase → 'spec'` (the value `PHASE_AFTER_GATE`
would use for "the phase G0 review happens in" — note this is *not* routed
through `PHASE_AFTER_GATE` since arming isn't a gate approval; it's a direct
`doc.setIn(['phase'], 'spec')`, parallel to `approve`'s phase advance at
`actions.ts:76`). Message: `` `state(${slug}): armed by ${who.name}` ``
(§1a(iii)'s grammar). It flows through the **same** `writeState` CAS path
every other decision uses (`local-source.ts:185-269`) — same identity
refusal (`local-source.ts:186-187`), same `ref-moved`/409 re-present
(`local-source.ts:206, 210, 258-259`) — and the same server route,
`POST /api/decisions` (`app.ts:144-196`), simply accepting `'arm'` as a new
`action` value; no new mutating route (ADR-3).

## 6. HTTP route table (IC-5 elaborated)

All five new/changed routes sit in `frontend/packages/server/src/app.ts`,
following the existing route style exactly (`c.json({...}, status)`,
`findRun` helper at `app.ts:64-70` reused where a slug is addressed). None
bypass the deployment's access proxy: `docs/DEPLOY.md`'s security model
(`DEPLOY.md:17-33`) states plainly "FleetView has no authentication of its
own" and names the two mechanisms that provide it (no public port + tunnel,
Cloudflare Access in front) — that model covers **every** route the app
serves, new ones included, with zero code change required to inherit it. The
**one** documented bypass in this repo is the webhook path, and it is
narrowly scoped and self-authenticating (`DEPLOY.md:165-171`: a second
Access application scoped to `<hostname>/api/webhooks/*` only, because that
route verifies an HMAC signature itself, `webhook.ts:15-21`). None of the
five routes below are webhook-shaped (no signature, no unauthenticated
caller) — they must **not** be added to that bypass application; they rely
on the ordinary Access policy the way `/api/decisions` already does.

| Route | Method | Request | Response (success) | Status codes |
|---|---|---|---|---|
| `/api/intake/sources` | GET | — | `{ sources: [{id, label, ref_format}], defaults: { budget_limit_usd } }` read from `registry/task-sources.yaml` + `INTAKE_DEFAULT_BUDGET_USD` (env) or the contract template's illustrative fallback | 200 |
| `/api/intake/item` | GET | query `?source=&ref=` | `TaskItem` (§3.1), always re-fetched from the driver, never trusted from any client-supplied body (tech A4) | 200; 400 unknown `source` id (not in the registry); 404 driver reports the ref doesn't exist; 502 upstream fetch failed (network/auth) |
| `/api/intake/draft` | POST | `{ item: TaskItem }` or `{ utterance: string }` | `{ brief_markdown, cost_usd }` | 200; 400 neither `item` nor `utterance` given; **501** when no drafting model is configured — the client degrades to the verbatim `item.body` as the starting draft (ADR-6); for a bare `utterance` with no drafting model, the candidate's own design (tasks 01/02) decides the seeded content — this document does not resolve that, since it's a UI concern, not a seam concern |
| `/api/intake/runs` | POST | `IntakeDraft` (§3.1) | `StageOutcome` (§3.1/§4), plus `{ ref, branch }` echoed on `created`/`exists` for the client to navigate to the run | 201 `created`; 200 `exists`; 409 `conflict`; 400 `refused: invalid-draft`; 422 `refused: slug-taken` (a well-formed request rejected on business grounds — matching the existing 422 precedent at `app.ts:179` for a bounced gate packet); 400 `refused: no-identity` |
| `POST /api/decisions` (existing route, `app.ts:144`) | POST | existing body shape (`app.ts:145-155`) plus `action: 'arm'` as a legal `DecisionAction` value | existing response shape (`app.ts:191`) | Existing status mapping unchanged: `planDecision` throwing `DecisionError` (illegal from a non-`staged` phase) → 400 (`app.ts:193`); `writeState`'s `ref-moved` → 409 (`app.ts:187`) |

Budget default chain (AC3.2, IC-5): deployment env `INTAKE_DEFAULT_BUDGET_USD`
(new, `docs/DEPLOY.md` config table addition, §5 item 8) → else the
`contracts/state.yaml` template's illustrative `cost_limit_usd: 50`
(`state.yaml:23`) as the committed fallback. `/api/intake/sources`'s
`defaults.budget_limit_usd` is what the web candidate pre-fills (AC3.2); the
CLI's `--budget` flag (§7) overrides it the same way `planRunScaffold`'s
`IntakeDraft.budget_limit_usd` does when non-null.

## 7. CLI contract (IC-6 elaborated)

Both commands live in `frontend/packages/cli/src/main.ts`, using the same
`Command` builder (`commander`) every existing command uses
(`main.ts:75-230`), and the same `resolveSources()`/`findRun()` helpers
(`main.ts:35-63`) for repo resolution.

```
agentic new [input]           # input: source ref (URL/owner/repo#N) or free-text utterance
  --source <id>                # default: parsed from input if it matches a driver's
                                #   ref_format, else the sole registry entry when there
                                #   is exactly one (mirrors spec.md's "shown and
                                #   pre-selected even with one source" assumption)
  --slug <slug>  --title <t>  --budget <usd>
  --brief-file <path>           # pre-authored brief body; skips drafting entirely
  --key <client-key>            # idempotency key for a free-form (no --source) stage
  --no-draft                    # verbatim import (item.body as-is), no LLM step
  --yes                         # non-interactive confirm of the printed preview (AC11.1)
  --arm                         # also arm after staging, in the same invocation; never
                                #   the default (staging and arming stay two acts, R7)
agentic arm <slug> [--source <id>]
```

**Interactive fallback — the `promptBurden` precedent, applied.**
`promptBurden` (`main.ts:154-174`) is the exact shape to mirror: check
`process.stdin.isTTY` (`main.ts:160`); when true and a value wasn't given on
the flag, prompt via `readline/promises`' `createInterface`
(`main.ts:164-165`, already imported at `main.ts:4`); when false and no flag
was given, **refuse by name** rather than hang (`main.ts:161-163`'s exact
pattern: `console.error('--burden is required...'); process.exit(1)`).
`agentic new`'s non-interactive gate is `--yes`: piped/scripted (non-TTY)
without `--yes` refuses with a named error (`` `--yes is required when stdin
is not a terminal — nothing stages without an explicit confirm (R7)` ``,
exit 1), matching `promptBurden`'s own refusal shape one-for-one (AC11.1).
At an interactive terminal with `--yes` omitted, the command prompts for
exactly the fields the flags would have supplied — source, ref/utterance,
title, slug (pre-filled from title, editable), budget (pre-filled from the
default chain, §6) — then shows the same preview text below before asking
for confirmation (AC11.2, AC2.2's flag-parity requirement: every field the
web structured fallback exposes has a corresponding flag here).

**No existing `$EDITOR` precedent.** Verified: no reference to `EDITOR` or an
editor spawn exists anywhere under `frontend/` today (`grep -rn "EDITOR"
frontend/` → no matches). "Brief review via `$EDITOR`" (plan.md IC-6) is
therefore a wholly new CLI behavior, not an existing idiom to cite — the
follow-on is free to use the ordinary Node pattern (write the draft to a
temp file, spawn `process.env.EDITOR ?? 'vi'` synchronously, re-read on
exit), but should not describe it as reusing something that exists.

**Preview text**, printed before the confirm prompt in both modes (TTY and
`--yes`, so a scripted run's transcript still shows what happened):

```
source:  github acme/widgets#482 (https://github.com/acme/widgets/issues/482)
title:   Fix login redirect loop
slug:    fix-login-redirect
branch:  run/fix-login-redirect
budget:  $50 (default)
stage? [y/N]
```

**Exit codes**, mirroring `decide()` exactly (`main.ts:139-141`:
`result.reason === 'ref-moved' ? 2 : 1`):

- `0` — `created` or `exists` (idempotent replay is a **success**, not an
  error — Stripe's/Devin's idempotency-key precedent, tech P3, treats a
  replay's 200 the same way; this document extends the plan's exit-code
  silence on this point explicitly, flagged for the follow-on Architect to
  confirm rather than left implicit). `exists` prints the existing slug on
  its own distinguishable line (`` `already staged: <slug> (<branch>)` ``,
  AC6.1/6.2) rather than reusing the `created` success line verbatim.
- `1` — every `refused` reason (`no-identity`, `slug-taken`, `invalid-draft`)
  and the non-TTY-without-`--yes` refusal above.
- `2` — `conflict` (the race case), matching `ref-moved`'s existing exit
  code for "re-read and retry" (`main.ts:141`).

**Named no-identity refusal**, via the existing `identity()` path
(`source.identity()`, `source.ts:54`, implemented at `local-source.ts:177-183`
reading `git config user.name`/`user.email`) — **not** a new resolution
mechanism. `agentic new` calls the identical function `decide()` already
calls (`main.ts:126-130`) before attempting anything, and on `null` prints
the same-shaped message that path already uses
(`` `git user.name/user.email are unset — staged runs must be attributable to
a named human` ``, adapting `local-source.ts:187`'s exact wording to "staged
runs" from "decisions") and exits 1 — **before** any git object is written
(AC8.2's "not a partial write").

## 8. Provenance and identity mechanics

**The staging (and arming) commit is authored under the confirming human's
git identity, never the bot identity.** This is not a new mechanism to
build — it is the **absence** of one: `LocalGitSource`'s writes are authored
under `this.options.identity` **only when that option is set**
(`local-source.ts:28`'s option and its plumbing-path use at `local-source.ts:257`,
`commitTree(tree, tip, message, this.options.identity)`);
its own doc comment is explicit about why (`local-source.ts:22-27`:
"`options.identity` pins the author of every write from this source — the v1
orchestrator's bot identity... Human surfaces omit it and write as `git
config user.name/user.email`, so machine bookkeeping and human decisions stay
distinguishable at a glance"). `stageRun` must call `commitTree` **without**
passing `this.options.identity` — passing the `who: Identity` parameter
`stageRun` itself received (from `source.identity()`'s human-config
resolution, or the equivalent for a hosted `RunSource` reached via an
authenticated web session) instead. Contrast case, concretely: the hosted
deployment configures `LocalGitSource` with `options.identity` set to a bot
identity for *orchestrator* writes (`docs/DEPLOY.md`'s
`GIT_USER_NAME`/`GIT_USER_EMAIL` config, `DEPLOY.md:72-73`, is the *human's*
identity for the frontend's own decisions — the orchestrator's separate bot
identity is a v1-orchestrator-specific config not covered in this document's
scope, per `ORCHESTRATOR.md:142-146`'s "one per orchestrator install"). A
`stageRun` implementation that accidentally reused `options.identity` would
silently violate R9/AC9.2 exactly the way ADR-6's rejected alternative
("a bespoke model client hard-wired in the server") and tech A6 both warn
against — this is the single most important line to get right in the
follow-on's `stageRun` implementation, worth a dedicated unit test asserting
the commit author on a staged run never equals the configured bot identity
even when one is set.

**Drafting cost accounting (ADR-6).** The `/api/intake/draft` call (§6) is a
model invocation that costs money **before** any run exists to carry a
ledger. Two cases:

- **Staged.** The draft's cost (`cost_usd` in `/api/intake/draft`'s
  response) is threaded through the client (browser state / CLI process,
  same "nothing exists server-side before staging" rule as the draft text
  itself, ADR-7) and becomes the **opening ledger entry** of the newly
  staged run's `budget.ledger[]` — shaped like every other ledger entry
  (`state.yaml:27-34`'s comment: `{at, role, task, round, adapter, model,
  tokens_in, tokens_out, cost_usd}`), with `role: intake-draft` (a new,
  run-local role name, the same pattern this run's own `state.yaml` already
  uses for `tech-researcher` — `runs/fleetview-intake/state.yaml:26` — a
  role that isn't in `derive.ts`'s `ROLES` constant but is a legitimate
  ledger entry), `task: null`, `round: null`.
- **Abandoned.** A draft the operator never stages (closed tab, `Ctrl-C`)
  has no run to carry its cost — ADR-6 requires it be "logged host-side
  against the host-wide spend limit, not any run." This means the
  `/api/intake/draft` handler itself must account its own invocation's cost
  against `ORCH_SPEND_LIMIT_USD`'s host-wide tracking
  (`docs/DEPLOY.md:87`'s config row; the *mechanism* that currently sums
  "projected spend across active runs" is the orchestrator engine's
  `hostProjectedUsd`, `frontend/packages/orchestrator/src/engine.ts:108`) —
  **not** a run's ledger, since none exists yet. This document flags, but
  does not resolve, exactly how a stateless-between-requests HTTP handler
  accounts against a host-wide limit that today is computed only inside the
  orchestrator's own tick loop over existing runs' ledgers; the follow-on
  Architect must decide whether this needs a small append-only host-level
  log (still git — a file, not a database, to honor ADR-7/A5) or whether the
  drafting route simply isn't wired to `ORCH_SPEND_LIMIT_USD` at all and
  instead gets its own, separate ceiling. Named here as a real open question
  this task's scope does not adjudicate.

## 9. Worked examples

### 9a. Imported from a GitHub issue

`runs/fix-login-redirect/state.yaml` (first, staging commit — matches IC-4
verbatim, with the `intake:` block from §1a(ii) and the phase-enum comment
from §1a(i)):

```yaml
run: fix-login-redirect
branch: run/fix-login-redirect
phase: staged             # staged | spec | plan | implement | integrate | release | done | paused
paused_reason: null
intake:
  source: github
  ref: acme/widgets#482
  url: https://github.com/acme/widgets/issues/482
  client_key: null
  staged_by: Jordan Alvarez
budget:
  cost_limit_usd: 50
  cost_spent_usd: 0.02
  ledger:
    - {at: 2026-07-15T20:11:03Z, role: intake-draft, task: null, round: null,
       adapter: claude-code, model: anthropic/claude-sonnet-5, tokens_in: 2103,
       tokens_out: 512, cost_usd: 0.02}
gates:
  G0: {approved: false, by: null, at: null, notes: null}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}
tasks: []
escalations: []
```

**Discrepancy note:** `budget.cost_spent_usd: 0.02` and the non-empty
`ledger` entry above deviate from plan IC-4's literal skeleton
(`cost_spent_usd: 0, ledger: []`, `plan.md:174`), which the plan's Risks
section binds both candidate task files to "verbatim" (AC5.2). The deviation
is required by ADR-6 ("the draft's cost is carried into the staged run's
opening ledger entry at staging," `plan.md:307`) precisely because this
worked example's own premise is an imported item that *was* drafted through
the LLM step (contrast worked example 9b below, staged with `--no-draft`,
where IC-4's literal `cost_spent_usd: 0, ledger: []` applies exactly). IC-4's
skeleton comment does not distinguish a drafted stage from a `--no-draft`
one, so read at face value it and ADR-6 cannot both hold for this example;
this document follows ADR-6 — leaving the drafting-cost requirement unmet
would be the greater defect — rather than silently pick a side. Flagged here
for the G1/G2 human: either accept this as the intended reading of IC-4
(the skeleton is the shape, not a literal zero in every field), or amend
IC-4's comment to say so explicitly so the follow-on Architect isn't left
inferring it from two normative documents that appear to disagree.

`runs/fix-login-redirect/intent-brief.md` (same commit):

```markdown
# Intent Brief: Fix login redirect loop

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

<!-- Provenance (present only when this brief was drafted from an upstream
     item): source github, ref acme/widgets#482, url
     https://github.com/acme/widgets/issues/482. Imported and confirmed by
     Jordan Alvarez on 2026-07-15. A verbatim import is not by itself a
     human-authored brief (R9) — this comment records that a named human
     reviewed and confirmed everything below before it was committed; the
     commit's own author identity (§8) is the authoritative provenance
     record, this comment is a human-readable echo of it. -->

## Problem

Logging in from an expired session bounces the user back to /login in an
infinite redirect instead of showing the sign-in form. Reported by three
customers this week (acme/widgets#482).

## Motivation

Blocks re-authentication entirely for anyone whose session expired mid-visit
— a hard failure, not a rough edge. Fix before the next release cut.

## Constraints

None known.

## Out of scope

Session expiry duration itself is not being revisited, only the redirect
handling when it happens.
```

Commit message (§1a(iii)'s grammar): `state(fix-login-redirect): staged by Jordan Alvarez [source: github acme/widgets#482]`,
authored with `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL` = Jordan Alvarez's git
identity (§8) — never the deployment's bot/orchestrator identity.

### 9b. Free-form (client_key) staging

`runs/tune-search-ranking/state.yaml` (first commit; only the `intake:` block
and commit message differ from 9a):

```yaml
run: tune-search-ranking
branch: run/tune-search-ranking
phase: staged
paused_reason: null
intake:
  source: null
  ref: null
  url: null
  client_key: cli-2026-07-15T20:41:07Z-tune-search-ranking
  staged_by: Jordan Alvarez
budget:
  cost_limit_usd: 50
  cost_spent_usd: 0
  ledger: []
gates:
  G0: {approved: false, by: null, at: null, notes: null}
  G1: {approved: false, by: null, at: null, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}
tasks: []
escalations: []
```

(`cost_spent_usd: 0`/`ledger: []` here because this example used
`--no-draft` — no model invocation occurred before staging; §8's opening
ledger entry only exists when a draft call happened.)

`runs/tune-search-ranking/intent-brief.md` — no provenance comment (§1b is
present *only* for imports; a free-form stage has no upstream item to cite):

```markdown
# Intent Brief: Tune search ranking

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

## Problem

Search results for multi-word queries rank exact-phrase matches below
single-term matches with higher raw frequency; users report the "right"
result is rarely first.

## Motivation

Search is the primary navigation path for the catalog; ranking quality
directly affects conversion.

## Constraints

None known.

## Out of scope

Not touching the indexing pipeline, only the ranking function.
```

Commit message: `state(tune-search-ranking): staged by Jordan Alvarez [client-key: cli-2026-07-15T20:41:07Z-tune-search-ranking]`.

## 10. Follow-on verification notes

One named, executable check per implementation-grade AC:

- **AC4.1** — Two checks, not one, because `registry/task-sources.yaml`
  itself legitimately names the tracker in its display strings (§2's
  isolation rule constrains the registry's *schema keys* and everywhere
  outside the registry+driver module, not the registry's own human-readable
  values — a lexical grep of the registry file for these words is guaranteed
  to hit its own permitted `label: GitHub Issues` / `ref_format: "owner/
  repo#N or issue URL"` content and the isolation-rule comment's own prose,
  even when §2 is implemented exactly as proposed):
  1. `grep -rniE "issue|label|assignee|milestone" contracts/state.yaml contracts/intent-brief.md frontend/packages/core/src/*.ts`
     (top-level `core/src/*.ts` only — **not** recursing into
     `task-sources/`, which is the one permitted exception, and **not**
     including `registry/task-sources.yaml`, checked separately below) must
     return zero matches. **Known false-positive to exclude if the target is
     ever widened**: `contracts/docs-delta.md` already contains the word
     "issue" in its generic sense (drift-evidence citation, e.g.
     `docs-delta.md:8, 18, 28` — "gh issue close" as an *example* of
     evidence, unrelated to task-tracker nouns) — the target above
     deliberately does not include `docs-delta.md`; if the follow-on widens
     it to all of `contracts/`, it must special-case that file rather than
     treat the hit as a violation.
  2. `registry/task-sources.yaml` is checked structurally, not lexically:
     confirm every entry under `sources:` uses only the four generic schema
     keys this document defines (`driver`, `label`, `ref_format`, `auth`) —
     any additional tracker-API-shaped key (e.g. `issue_number`,
     `assignee_id`, `milestone_id`, `project_field`) is the actual violation
     the isolation rule prohibits at the registry layer. A `label`/
     `ref_format` *value* naming the tracker in prose (e.g. "GitHub Issues",
     "issue URL") is expected and compliant, not a hit to fix.
- **AC4.2** — Add-a-source scenario, matching §2's own three-step procedure
  exactly — **not** a registry-entry-only check: a registry entry with no
  driver module is not a smaller version of this test, it's a different,
  broken configuration (§2's step 1/2 mismatch — a source `/api/intake/
  sources` lists but whose driver can't resolve, hitting a `GET
  /api/intake/item?source=<id>` case §6's status table doesn't define). Write
  a minimal driver module implementing `TaskSourceDriver` at
  `frontend/packages/core/src/task-sources/<placeholder>.ts`, add its
  registry entry, and add the one `export * from './task-sources/
  <placeholder>.ts'` line to `index.ts` (§2's steps 1-3). Confirm
  `/api/intake/sources` lists it, `/api/intake/item?source=<placeholder>&ref=...`
  resolves through the new driver, and the CLI's `--source` help text
  reflects it — with **zero** other file touched (`git diff --stat` shows
  only the new driver module, the registry entry, and the single `index.ts`
  line — no `contracts/*` edit, no edit to any other `core/src/*.ts` file).
  Spec AC4.2's "a driver plus a registry entry" should be read together with
  this one-line, addition-only barrel export, not as excluding it: `index.ts`
  is a mechanical re-export, not a new type, interface, or logic added to
  core's surface, which is what §2:167-168's "no core edit… for step 1-3"
  is actually claiming — it is a real touch to a file under
  `frontend/packages/core/src/`, just not one that extends core's behavior or
  vocabulary, and this document's phrasing should not be read as denying
  that the barrel line is touched at all.
- **AC5.1** — `grep -rn "commitTree\|hash-object\|write-tree\|updateRefCAS" frontend/packages/server/src frontend/packages/cli/src`
  → zero matches (§3.3).
- **AC6.1** — Replay scenario: call `stageRun`/`agentic new`/`POST
  /api/intake/runs` twice with the same `(source, ref)` (or same
  `client_key`); assert one run branch exists and the second call's response
  is `exists` naming the first call's slug, never a second branch.
- **AC7.3** — `grep -n "'issues'\|case 'issue'" frontend/packages/server/src/webhook.ts`
  → zero matches (confirms no unattended webhook event reaches `stageRun`);
  additionally, `grep -n "stageRun" frontend/packages/orchestrator/src/*.ts`
  → zero matches (confirms the orchestrator itself never calls it).
- **AC8.1** — Restart-the-question scenario, since `docs/DEPLOY.md`'s model
  is proxy-in-front, not per-route: confirm the new routes are registered on
  the same `Hono` `app` instance as `/api/decisions` (`app.ts`'s single
  `createApp` export) and are **not** added to the webhook's Access-bypass
  application (`DEPLOY.md:165-171`) in the deploy runbook delta the
  follow-on writes.
- **AC8.2** — Named-refusal scenario: run `agentic new <ref>` with
  `git config --unset user.name` (or in an environment with no git identity
  configured) and confirm exit code 1, the "unset... must be attributable to
  a named human" message, and **zero** new git objects created
  (`git count-objects` before/after, or simply that no `runs/<slug>` blob
  exists on any ref).
- **AC9.2** — `git log -1 --format='%an <%ae>' run/<staged-slug>` on a
  freshly staged run must equal the confirming human's configured identity,
  **never** the deployment's `GIT_USER_NAME`/`GIT_USER_EMAIL` when those are
  deliberately set to a distinct bot account for orchestrator writes in the
  same test fixture — a fixture with both identities configured
  simultaneously is the discriminating test (§8).
- **AC10.1** — Restart scenario: stage a run, kill and restart the server
  process (or, for the CLI, simply run in a fresh process with no
  in-memory state), then read the staged run's `state.yaml` via `git show
  run/<slug>:runs/<slug>/state.yaml` directly (bypassing the app entirely) —
  it must be fully readable and valid with no server process running at all.
- **AC14.1** — `git show run/<slug>:runs/<slug>/state.yaml | yq '.intake'`
  on an imported run must show non-null `source`/`ref`/`url`; `git show
  run/<slug>:runs/<slug>/intent-brief.md` must carry the §1b provenance
  comment.

<!-- Discrepancy summary (all noted inline above, indexed here for a
     reviewer scanning for them): §1b (header-comment placement is this
     document's own elaboration, not literally in plan.md); §2 (the driver
     module is new, distinct from the existing github.ts PR-sync provider —
     naming-collision risk flagged); §3.2 (writeTreeWithBlob composes for a
     two-blob genesis commit via two calls; no new git.ts primitive is
     strictly required, but one would read more clearly); §5 items 3-4 (a
     real gap in actions.ts's pause/resume phase handling once `staged`
     joins PHASES, not mentioned in plan.md, found by tracing every call
     site); §5 item 1 (schema-rollout ordering: servers must adopt the
     PHASES change before any client stages a run); §7 (exit code for
     `exists`, and the $EDITOR precedent's actual absence, both resolved
     here rather than left silent); §8 (host-wide abandoned-draft cost
     accounting has no existing mechanism to hook into outside the
     orchestrator's own tick loop — flagged as unresolved, not decided); §9a
     (a drafted import's `cost_spent_usd`/`ledger` deviate from IC-4's
     literal zero-cost skeleton, as required by ADR-6 — the two plan clauses
     disagree for this case and this document follows ADR-6, flagged for the
     G1/G2 human rather than silently resolved). -->
