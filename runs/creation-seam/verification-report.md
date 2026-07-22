# Verification Report: creation-seam

**Change verified:** `run/creation-seam` @ 3319749 (diff base `1733b41` = merge-base
with `origin/main`; task-01's own merge baseline is `4835e60`, "content
byte-identical to origin/main" per its round-1 review)
**Environment:** local, macOS/Darwin, Node v26.3.0, `npm test` (vitest 3.2.7) in
`frontend/`; `gh` not authenticated (exercises the real degraded path for R8,
not a stub)

All acceptance criteria were exercised directly through the real CLI binary
(`node packages/cli/src/main.ts --repo <scratch-repo> ...`) against
hand-built scratch git repos — not only by reading or re-running the
implementer's own test suite — plus targeted reads of the CAS/decision code
paths that produced the observed output.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | E1 |
| AC1.2 | verified | E2 |
| AC1.3 | verified | E3 |
| AC1.4 | verified | E4 |
| AC2.1 | verified | E1 |
| AC2.2 | verified | E5 |
| AC2.3 | verified | E6 |
| AC3.1 | verified | E5 |
| AC3.2 | verified | E1, E6 |
| AC4.1 | verified | E1 |
| AC4.2 | verified | E7 |
| AC4.3 | verified | E7 |
| AC4.4 | verified | E8 |
| AC5.1 | verified | E9 |
| AC5.2 | verified | E8 |
| AC5.3 | verified | E10 |
| AC6.1 | verified | E11 |
| AC6.2 | verified | E12 |
| AC7.1 | verified | E13 |
| AC8.1 | verified | E14 |
| AC8.2 | verified | E11 |
| AC8.3 | verified | E15 |
| AC9.1 | verified | E16 |
| AC9.2 | verified | E16 (see note) |
| AC10.1 | verified | E1 |

Full workspace suite as a baseline (not itself the acceptance evidence, but
confirms no regressions): `npm test` in `frontend/` → **308 passed, 1 skipped**
(the skipped test is `live-smoke`, gated on live credentials by design),
across 37 of 38 test files; `npm run typecheck` → clean, no output.

### E1 — AC1.1 / AC2.1 / AC4.1 / AC10.1 (flags-complete stage, standard profile)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new \
    --slug verify-standard --title "My Verify Run" --profile standard \
    --brief-file /tmp/verify-creation-seam/brief-standard.md
staged verify-standard → run/verify-standard (de0d37af36)
$ echo exit=$?
exit=0
```
Then, in a fresh shell with no server running:
```
$ git -C /tmp/verify-creation-seam/scratch show run/verify-standard:runs/verify-standard/state.yaml
run: verify-standard
branch: run/verify-standard
phase: paused             # staged — not yet armed; `agentic arm verify-standard` starts the run
paused_reason: staged
profile: standard        # patch | standard | full
intake:
  source: null
  ref: null
  url: null
  client_key: null
  staged_by: "Verifier Test"
budget: {cost_limit_usd: 50, cost_spent_usd: 0, ledger: []}
gates:                    # exactly PROFILE_GATES[standard] — no others
  G0: { approved: false, by: null, at: null, notes: null }
  G1: { approved: false, by: null, at: null, notes: null }
  G2: { approved: false, by: null, at: null, notes: null }
tasks: []
escalations: []
$ git -C /tmp/verify-creation-seam/scratch show run/verify-standard:runs/verify-standard/intent-brief.md
# Intent Brief: My Verify Run
## Problem
Manual verification is slow.
...(operator-authored content verbatim, no invented prose)
$ git -C /tmp/verify-creation-seam/scratch log --oneline run/verify-standard
de0d37a state(verify-standard): staged by Verifier Test
2d2161b seed
$ git -C /tmp/verify-creation-seam/scratch show main:runs
fatal: path 'runs' does not exist in 'main'
```
`gates:` is exactly G0/G1/G2 (AC4.1); no server route touched the default
branch's tree (default branch has no `runs/` at all, confirming the genesis
commit landed only on the new ref); brief content is verbatim from the
operator-authored `--brief-file` (AC3.2). Genesis commit composes two blobs
(`state.yaml` + `intent-brief.md`) as required by AC1.1, confirmed by reading
`LocalGitSource.stageRun` (`frontend/packages/core/src/sources/local-source.ts:358-403`):
it loops `writeTreeWithBlob` once per `scaffold.files` entry, seeded from the
default branch tip, then `commitTree(..., who)` and
`updateRefCAS(refs/heads/run/<slug>, commit, ZERO_OID)` — the create-only idiom.

### E2 — AC1.2 (collision with a non-staged same-slug run)
```
$ git -C /tmp/verify-creation-seam/scratch checkout -b run/verify-collide main
# ...seeded runs/verify-collide/state.yaml by hand with phase: spec (an "active" run)...
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new \
    --slug verify-collide --title Collide --profile standard \
    --brief-file /tmp/verify-creation-seam/brief-standard.md
refused (slug-taken): run/verify-collide already exists (phase: spec) — not a staged replay
$ echo exit=$?
exit=1
$ git -C /tmp/verify-creation-seam/scratch log --oneline run/verify-collide
a0699aa seed active run
2d2161b seed
```
Branch tip unchanged (still `a0699aa`, the hand-seeded commit) — refuses and
writes nothing, fails closed.

### E3 — AC1.3 (idempotent replay)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new \
    --slug verify-standard --title "My Verify Run" --profile standard \
    --brief-file /tmp/verify-creation-seam/brief-standard.md
already staged: verify-standard (run/verify-standard)
$ echo exit=$?
exit=0
$ git -C /tmp/verify-creation-seam/scratch log --oneline run/verify-standard
de0d37a state(verify-standard): staged by Verifier Test   # same single commit as E1, no second commit
2d2161b seed
```
Outcome (`already staged...`, exit 0) is distinguishable from both the first
call's `staged ... →` line (exit 0, different text) and the E2 collision
(`refused`, exit 1) — the three-way distinction ADR-4 requires. Core-level
replay/collision/CAS-loss edge cases (same client key under a different slug;
null client key twice; CAS loser re-derivation; concurrent-ref conflict) are
additionally covered green in `frontend/packages/core/test/stage-run.test.ts`
(10/10 passed, re-run at E-baseline above).

### E4 — AC1.4 (no run-creation server route)
```
$ git diff 1733b41..HEAD --stat -- frontend/packages/server
 frontend/packages/server/test/app.test.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
$ git diff 1733b41..HEAD -- frontend/packages/server/test/app.test.ts
-    expect(body.runs).toHaveLength(10)
+    expect(body.runs).toHaveLength(12)
```
The only server-package change in the whole diff is a fixture-count
adjustment in an existing read-route test (the fixture generator now seeds
more runs); no new route, file, or handler was added under
`frontend/packages/server`.

### E5 — AC2.2 / AC3.1 (interactive TTY fallback: prompt, edit, confirm)
The interactive flow is factored into `runInteractiveNew`/`draftBriefMarkdown`
(exported from `frontend/packages/cli/src/main.ts`), independently exercised
against a stubbed `InteractiveNewIO` (no real TTY/`$EDITOR` needed) in
`frontend/packages/cli/test/cli.test.ts`'s second `describe` block:
```
$ npx vitest run packages/cli/test/cli.test.ts -t "runInteractiveNew"
 ✓ runInteractiveNew prompts for missing slug/title, edits, and stages on confirm (AC2.2/AC3.1)
 ✓ runInteractiveNew re-prompts on an invalid slug instead of accepting it for the editor session (F4)
 ✓ runInteractiveNew offers a re-edit when required sections are missing, never padding them
 ✓ runInteractiveNew returns null (refuses) when the human declines to stage
```
Read the implementation (`main.ts:339-383`): missing slug/title trigger
`io.prompt`; the brief is seeded via `draftBriefMarkdown` (title substituted
into the template's H1 only — structure, never invented Problem/Motivation/
Constraints prose) or a supplied `--brief-file`, passed through `io.editFile`
(the `$EDITOR`/`$VISUAL`/`vi` round trip in the real, non-test IO), validated
for required sections (re-edit offered on failure, never padded), then an
explicit `stage? [y/N]` confirm gates the return value the caller commits
from — declining returns `null` and `stageNewRun` refuses with exit 1
(`not staged`), never committing.

### E6 — AC2.3 (non-TTY, missing flags)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new --profile standard < /dev/null
missing required content: --slug, --title, --brief-file — stdin is not a terminal, so nothing can be prompted
$ echo exit=$?
exit=1
$ git -C /tmp/verify-creation-seam/scratch branch -a
* main
  run/verify-collide
  run/verify-standard
```
No new branch — matches `promptBurden`'s refusal shape one-for-one, as the
plan requires.

### E7 — AC4.2 / AC4.3 (patch and full profiles)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new \
    --slug verify-patch --title "Patch Run" --profile patch --brief-file .../brief-standard.md
staged verify-patch → run/verify-patch (171cbc1be2)
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch new \
    --slug verify-full --title "Full Run" --profile full --brief-file .../brief-standard.md
staged verify-full → run/verify-full (a029b01843)
```
`git show run/verify-patch:runs/verify-patch/state.yaml` → `gates:` exactly
`{G1, G2}`; `git show run/verify-patch:runs/verify-patch/tasks/01-verify-patch.yaml`
exists, carries `id`, `title`, `requirements: []`, placeholder `scope`,
`file_contact_surface: []`, `acceptance_tests: []`, `depends_on: []`,
`status: pending`, `notes: ""` (every `contracts/work-item.yaml` key).
`git show run/verify-full:runs/verify-full/state.yaml` → `gates:` exactly
`{G0, G1, G2, G3}`.
Patch's "initial phase is plan, not spec" (AC4.2) is the *post-arm* phase per
ADR-1's own consequences (scaffolded phase is uniformly `paused`) — confirmed
live at E11 (arming `verify-patch` lands at `phase: plan`).

### E8 — AC4.4 / AC5.2 (per-profile fixture round-trip through `parseRunState`)
`frontend/packages/core/test/scaffold.test.ts` parametrizes exactly this over
`['patch', 'standard', 'full']`:
```
$ npx vitest run packages/core/test/scaffold.test.ts
 ✓ patch: emitted state.yaml round-trips through parseRunState with zero errors
 ✓ patch: gates contain exactly PROFILE_GATES[patch] keys in the raw YAML
 ✓ standard: emitted state.yaml round-trips through parseRunState with zero errors
 ✓ standard: gates contain exactly PROFILE_GATES[standard] keys in the raw YAML
 ✓ full: emitted state.yaml round-trips through parseRunState with zero errors
 ✓ full: gates contain exactly PROFILE_GATES[full] keys in the raw YAML
 ✓ patch additionally emits a work-item stub carrying every contract key
 Test Files  1 passed (1)   Tests  ... passed
```

### E9 — AC5.1 (ADR)
`runs/creation-seam/plan.md`'s ADR-1 ("Staged rest state = `phase: paused` +
`paused_reason: staged`") explicitly addresses both required points: (a) "D20
(task failed twice) and D21 (profile invariant) are already assigned in
merged `derive.ts` ... this choice consumes no label at all"; (b) "a bare new
phase value would be escalated by D21 for every profile unless
`PROFILE_PHASES` were extended ×3; `paused` needs nothing." Read directly in
`runs/creation-seam/plan.md:226-249`.

### E10 — AC5.3 (derive test, staged rests for every profile, never dispatch/escalate)
```
$ npx vitest run packages/orchestrator/test/derive.test.ts -t "D2 — a freshly staged run"
 ✓ D2 — a freshly staged run (plan.md scaffold: paused/staged, all profile gates undecided, no tasks) rests for every profile (AC5.3)
```
Read `frontend/packages/orchestrator/test/derive.test.ts:90-98`: loops
`for (const profile of PROFILES)`, asserts `a.kind !== 'dispatch'`,
`a.kind !== 'escalate'`, and `a` matches `{ kind: 'rest', rule: 'D2' }` —
exactly AC5.3's three-way requirement, for all three profiles in one test.

### E11 — AC6.1 / AC8.2 (arm produces one CAS commit per profile; PR-ensure degrades cleanly)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch arm verify-standard
Arm verify-standard into phase "spec"
→ 147a7f5e1d state(verify-standard): armed by Verifier Test
no remote.origin.url configured — nothing to open a PR against
$ echo exit=$?
exit=0
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch arm verify-patch
Arm verify-patch into phase "plan"
→ 40551f5cac state(verify-patch): armed by Verifier Test
no remote.origin.url configured — nothing to open a PR against
$ echo exit=$?
exit=0
$ git -C /tmp/verify-creation-seam/scratch log --oneline run/verify-standard
147a7f5 state(verify-standard): armed by Verifier Test
de0d37a state(verify-standard): staged by Verifier Test
2d2161b seed
$ git -C /tmp/verify-creation-seam/scratch log -1 --format='%an <%ae>' run/verify-standard
Verifier Test <verifier@example.test>
```
Exactly one new commit per arm, attributed to the arming human's own git
identity (not a bot identity), landed via the same `writeState`/`planAndWrite`
CAS path every other decision uses (confirmed by reading
`frontend/packages/cli/src/main.ts`'s `armRun` — it calls `planAndWrite(source,
ref, who, { action: 'arm' })`, the identical function `approve`/`decline`/
`resume` call). `standard` arms to `phase: spec`; `patch` arms to
`phase: plan` (via `deriveResumePhase`) — matching AC4.2's "post-arm phase"
reading. No configured remote → `ensureDraftPr` returns `skipped` with a
logged note and the command still exits 0 (AC8.2), never treated as a
failure.

### E12 — AC6.2 (arm refusals)
```
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch arm verify-standard   # already armed
run is not staged (phase: spec)
$ echo exit=$?
exit=1
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/scratch arm nonexistent-run-xyz
run "nonexistent-run-xyz" not found
$ echo exit=$?
exit=1
```
Both a re-arm attempt and a nonexistent slug refuse with a named,
non-zero-exit error and (confirmed via the unchanged branch log in E11's
follow-up checks) make no commit.

### E13 — AC7.1 (identity refusal, staging)
```
$ git init -q -b main /tmp/verify-creation-seam/noident   # no local user.name/user.email set
$ node packages/cli/src/main.ts --repo /tmp/verify-creation-seam/noident new \
    --slug should-not-stage --title T --profile standard --brief-file .../brief-standard.md
git user.name/user.email are unset — staged runs must be attributable to a named human
$ echo exit=$?
exit=1
$ git -C /tmp/verify-creation-seam/noident branch -a
* main
$ git -C /tmp/verify-creation-seam/noident log --oneline --all
2a5fefc seed
```
No branch or commit created; refusal message adapted one-for-one from
`writeState`'s existing `no-identity` shape, exactly as R7 requires, and
occurs before the interactive/flags-complete branch is even reached (F3 in
review round 1 confirmed the identity check is hoisted above the
prompt/edit/confirm session).

### E14 — AC8.1 (idempotent draft-PR ensure, hand-made and CLI-made branches)
Unit half (`frontend/packages/core/test/pr-ensure.test.ts`, all via an
injected `exec` — never a real `gh`):
```
$ npx vitest run packages/core/test/pr-ensure.test.ts
 ✓ creates a draft PR when gh pr list finds none
 ✓ reports exists and never calls create when a PR is already listed (AC8.1 idempotency, unit half)
 ✓ skips with a note when no remote is configured
 ✓ skips with a note when the branch has not been pushed to origin
 ✓ skips with a note when gh itself fails (missing binary, unauthed, network)
```
Engine half (`frontend/packages/orchestrator/test/engine.test.ts`):
```
 ✓ ensures a draft PR at most once per slug per process; a skipped ensure
   never affects the tick outcome (#118, AC8.1 engine half, AC8.2)
```
CLI half, added by this verification (new test, committed
`3319749`, test-only) to close the explicit "hand-made ... branch" wording at
the CLI layer — a run staged with a hand-written genesis commit (no
`stageRun` call at all) arms identically to a CLI-staged run:
```
$ npx vitest run packages/cli/test/cli.test.ts -t "hand-authored"
 ✓ agentic CLI > arm starts a hand-authored staged run exactly like a CLI-staged one (AC8.1: idempotent ensure regardless of creation path)
 Test Files  1 passed (1)   Tests  1 passed | 23 skipped (24)
```
Also confirmed live in this session (before writing the test) against the
scratch repo: a manually-committed `run/hand-made` branch (state.yaml/
intent-brief.md hand-authored, no `agentic new`) armed via `agentic arm
hand-made` and produced the identical `Arm hand-made into phase "spec"` /
`armed by Verifier Test` / `no remote.origin.url configured` output as the
CLI-staged runs.

### E15 — AC8.3 (#118 closed)
```
$ grep -n 118 runs/creation-seam/release-notes.md
42:Closes #118
```

### E16 — AC9.1 / AC9.2 (no GitHub-Issues-specific identifiers)
```
$ grep -rniE "issue|label|assignee|milestone" frontend/packages/core/src/record/*.ts frontend/packages/core/src/sources/*.ts
frontend/packages/core/src/record/schema.ts:136:  ctx.addIssue({ code: z.ZodIssueCode.custom, ... })
frontend/packages/core/src/record/schema.ts:171:  const issues = result.error.issues
frontend/packages/core/src/record/schema.ts:175:  ... `state.yaml does not match the contract: ${issues}` ...
```
Isolating exactly this run's own authored diff (task 01's merge baseline
`4835e60`, whose reviewer confirmed content byte-identical to `origin/main`,
against `HEAD`):
```
$ git diff 4835e60..HEAD -- frontend/packages/core/src/record/*.ts frontend/packages/core/src/sources/*.ts \
    | grep -nE '^\+' | grep -iE "issue|label|assignee|milestone"
(no output)
$ git show 4835e60:frontend/packages/core/src/record/schema.ts | grep -niE "issue|label|assignee|milestone"
131:  ctx.addIssue(...)
166:  const issues = result.error.issues
170:  ... ${issues}` ...
```
All three matches were already present in the merged-main baseline before any
of this run's own tasks (02–07) touched the file; this run's own diff
introduces zero new matches. **Note (spec discrepancy, not an implementation
defect):** AC9.2's text says to "confirm exactly two" pre-existing matches;
the actual pre-existing baseline is **three** lines (the `ctx.addIssue` zod
call plus the two `ZodError.issues` lines the spec named), because merged
`#156` added a second unrelated zod `addIssue` call to the same file that the
analyst's grep at spec-writing time evidently missed. The requirement's
intent — no *new* tracker-vendor vocabulary from this run's own work — holds;
the criterion's own baseline count is off by one.

## Beyond the happy path

- Verified AC1.2's refusal is fail-closed by hand-seeding a colliding branch
  with `phase: spec` (an "active", non-staged run) rather than relying only
  on the implementer's fixture states.
- Verified identity refusal (AC7.1) against a repo with **no** local
  `user.name`/`user.email` at all (not merely env-scrubbed), confirming the
  CLI's own `source.identity()` resolution fails the same way a genuinely
  unconfigured operator machine would.
- Verified the "regardless of creation path" claim (R8) end-to-end by
  hand-authoring a full genesis commit outside any `stageRun`/`agentic new`
  call and arming it — this is the strongest form of the AC8.1 hand-made
  claim, not just a unit-level stub.
- Confirmed the default branch's own tree is untouched by staging (`git show
  main:runs` → "path 'runs' does not exist in 'main'") — the genesis commit
  only ever lands on the new `run/<slug>` ref, never mutating the tree it
  was built from.
- Cross-checked AC9.1/AC9.2 against two different diff bases (the stated
  merge-base `1733b41`, and the task-01 post-merge baseline `4835e60`) to
  separate "inherited from the #156 merge" from "authored by this run" —
  surfacing the baseline-count discrepancy noted in E16.

## Gaps

- AC8.1's "the v1 orchestrator's first dispatch" half and the memoization
  behavior were verified only by re-running the implementer's existing
  `engine.test.ts` case (green) plus a code read of the call site
  (`frontend/packages/orchestrator/src/engine.ts:441-448`); I did not drive a
  live orchestrator tick against a real dispatch to observe this independently
  (per this repo's own AGENTS.md invariant against running a live orchestrator
  tick/watch as a test). This is consistent with the existing dry-run/fixture
  test discipline used everywhere else in this codebase's own test suite, not
  a shortcut specific to this verification.
- No infrastructure gap prevented verifying any criterion; nothing is marked
  `unverifiable`.
- One test added by this verification, committed test-only:
  `frontend/packages/cli/test/cli.test.ts` — "arm starts a hand-authored
  staged run exactly like a CLI-staged one (AC8.1...)" (commit `3319749`).
