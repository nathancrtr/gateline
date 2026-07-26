# Verification Report: state-contract-split-2

**Change verified:** `run/state-contract-split-2` at `c06d9e7`, diff range
`70947d88bd2c678008273f322267536c8c6ec621..HEAD`
**Environment:** local sandbox checkout, macOS/Darwin, Node v24.12.0, npm 11.6.2,
Python 3 (system); `npm install` run once in `frontend/` for this session.

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |
| AC2.1 | verified | see E3 |
| AC2.2 | verified | see E4 |
| AC3.1 | verified | see E5 |
| AC3.2 | verified | see E6 |
| AC3.3 | verified | see E7 |
| AC4.1 | verified | see E8 |
| AC4.2 | verified | see E9 |
| AC4.3 | verified | see E10 |
| AC5.1 | verified | see E11 |
| AC5.2 | verified | see E12 |
| AC6.1 | verified | see E13 |
| AC6.2 | verified | see E14 |
| AC7.1 | verified | see E15 |
| AC7.2 | verified | see E16 |

### E1 — AC1.1
`contracts/state-core.yaml` was read in full. Its required top-level fields are
exactly `run` (identity), `gates` (a mapping keyed by an example gate name,
documented as host-declared, no fixed enum), `escalations` (documented
append-only, `{at, from_role, reason, resolved}`), and `paused_reason` (the
pause signal, null = running). `intake` is present but commented out
(optional), matching the spec's assumption resolution.
```
$ node -e "const {parse}=require('yaml'); const fs=require('fs');
  console.log(Object.keys(parse(fs.readFileSync('contracts/state-core.yaml','utf8'))))"
[ 'run', 'paused_reason', 'gates', 'escalations' ]
```

### E2 — AC1.2
```
$ grep -E 'G0|G1|G2|G3|run/<slug>|budget:' contracts/state-core.yaml; echo "EXIT:$?"
EXIT:1
```

### E3 — AC2.1
`contracts/state.yaml` (rewritten in place as the SDLC extension) declares the
gate set `G0, G1, G2, G3`, the `branch: run/<slug>` convention (`branch:
run/example-slug`), a `tasks:` mirror with its status vocabulary, and the
`budget:` block with the ledger rules — all present verbatim in the file at
HEAD (read directly).

### E4 — AC2.2
Diffed the pre-split file against the rewritten extension: the only content
changes are an expanded header declaring the extension relationship, and
commenting out the `profile:` block (text preserved verbatim, matching the
already-commented `intake:` convention). No field, writer rule, or provenance
note was dropped — everything either stayed in the extension or was restated
in gate-name-free form in the new core document (E1).
```
$ git show 70947d88bd2c678008273f322267536c8c6ec621:contracts/state.yaml > /tmp/pre-split-state.yaml
$ diff /tmp/pre-split-state.yaml contracts/state.yaml
1,2c1,12
< # Contract: maintained by Orchestrator ...
---
> # Contract: the SDLC extension of contracts/state-core.yaml ...
24,29c34,39
< profile: full             # patch | standard | full ...
---
> # profile: full            # patch | standard | full ...
```
(header expansion and comment-out are the only two hunks; both non-destructive.)

### E5 — AC3.1
```
$ cd frontend && npx vitest run packages/core/test/real-repo.test.ts
 ✓ packages/core/test/real-repo.test.ts (4 tests) 2551ms
   ✓ this repository (wordfreq) > discovers the merged wordfreq run from the default branch
   ✓ this repository (wordfreq) > summarizes it as done with all gates approved and nothing pending
   ✓ this repository (wordfreq) > extracts gate decision records from state.yaml history
   ✓ this repository (wordfreq) > validates the real spec.md against the repo's own contracts
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
Unchanged from the pre-split checkout (also run on a temporary worktree of the
merge-base commit — same result).

### E6 — AC3.2
`frontend/packages/core/test/state-contract.test.ts` includes a sweep
(`validateArtifact(state.yaml) resolves required keys ... > sweep: every
runs/*/state.yaml in this repository validates ok against the repo template`)
that calls `parseRunState` on every `runs/<slug>/state.yaml` in the repo,
including `runs/wordfreq/state.yaml`, `runs/mdtoc/state.yaml`, and
`runs/dupefind/state.yaml`, and asserts `error === null` for each, byte-for-byte
unmodified (no fixture copy — read from disk).
```
$ cd frontend && npx vitest run packages/core/test/state-contract.test.ts
 ✓ packages/core/test/state-contract.test.ts (20 tests) 57ms
 Test Files  1 passed (1)
      Tests  20 passed (20)
```

### E7 — AC3.3
```
$ git diff --stat 70947d88bd2c678008273f322267536c8c6ec621..HEAD -- runs/wordfreq/state.yaml runs/mdtoc/state.yaml runs/dupefind/state.yaml
(no output)
$ git log --oneline 70947d88bd2c678008273f322267536c8c6ec621..HEAD -- runs/wordfreq/state.yaml runs/mdtoc/state.yaml runs/dupefind/state.yaml
(no output)
$ git branch -a | grep '^  run/'
  run/csvpeek
  run/historian-2026-07-25
  run/writestate-kill-window
```
None of those `run/<slug>` branches or any existing `runs/<slug>/state.yaml`
is touched by this diff.

### E8 — AC4.1
`frontend/packages/core/test/generic-host.test.ts` builds a real temporary git
repo whose `contracts/state.yaml` is the fixture from plan.md (`gates:
{intake, publish}`, no `branch`) and a `runs/demo/state.yaml` using that gate
set, then reads it through the production `LocalGitSource.readState` (not a
unit-level stub):
```
$ cd frontend && npx vitest run packages/core/test/generic-host.test.ts
 ✓ packages/core/test/generic-host.test.ts (7 tests) 2151ms
   ✓ generic host (core-only state contract, no SDLC markers) > readState: parses without error, generic non-null (AC4.1)
```
Also independently confirmed the classification rule with the plan's own
fixture template via `deriveStateContract`, matching `{kind: 'generic',
gateIds: ['intake','publish'], requiredKeys: [...], branchRequired: false}`.

### E9 — AC4.2
Same fixture repo, read through `summarizeRun`:
```
   ✓ generic host (core-only state contract, no SDLC markers) > summarizeRun: phase intake, malformed null, gate keys exactly [intake, publish] (AC4.2)
```
`summary.phase === 'intake'`, `summary.malformed === null`,
`Object.keys(summary.gates) === ['intake', 'publish']` — no synthesized
`G0`–`G3` entries. A companion "kill fixture" test in the same file further
confirms gate cells follow contract-declared order (not file order) and that a
declared-but-file-absent gate still renders as an undecided cell, not a crash.

### E10 — AC4.3
Read `frontend/packages/core/src/record/validate.ts` directly: the
`state.yaml` branch of `validateArtifact` no longer returns presence-only. It
resolves `required` from `Object.keys(parse(await templates.read('state.yaml')))`,
falling back to `state-core.yaml`, falling back to `BUILTIN_STATE_KEYS`,
mirroring the `work-item.yaml` branch immediately above it line-for-line.
Exercised end to end against the fixture repo's own templates:
```
   ✓ generic host (core-only state contract, no SDLC markers) > validateArtifact('state.yaml', ...) resolves against the fixture source's own templates: ok true (AC4.3)
```
and against stub templates whose keys differ from the built-in list
(`state-contract.test.ts`, "resolves required keys from a stub template whose
keys differ from BUILTIN_STATE_KEYS" and the state-core.yaml fallback case),
both passing.

### E11 — AC5.1
```
$ cd frontend && npm test
 Test Files  45 passed | 1 skipped (46)
      Tests  421 passed | 1 skipped (422)
```
The one skip is `packages/orchestrator/test/live-smoke.test.ts`, which is
`.skip`-marked independent of this change (it requires live provider
credentials). Ran the three named files individually as an extra check:
```
$ cd frontend && npx vitest run packages/core/test/readiness.test.ts packages/core/test/profiles.test.ts packages/core/test/real-repo.test.ts
 Test Files  3 passed (3)
      Tests  32 passed (32)
```
No expected value in any of these three files needed an update for this
change (confirmed by reading `git diff` for the test directory: neither file
appears in the diff).

### E12 — AC5.2
Ran `agentic status --repo <this repo>` from this checkout (post-split) and,
separately, from a `git worktree` checked out at the merge-base commit
(pre-split, with its own `npm install`), both pointed at the same run records:
```
post-split: run-state-contract-split-2/wordfreq  done  ✓ ✓ ✓ ✓  4/4  17d
pre-split:  run-state-contract-split-2/wordfreq  done  ✓ ✓ ✓ ✓  4/4  17d
```
Identical phase, four gate glyphs, task count, and age; wordfreq did not
appear in `agentic inbox`'s count of items needing a human in either run
(the wordfreq row carries no "needs" count in the status table in either
case). Worktree was removed after the check (`git worktree remove
/tmp/pre-split-worktree --force`).

### E13 — AC6.1
```
$ git diff --name-only 70947d88bd2c678008273f322267536c8c6ec621..HEAD | grep -v '^runs/state-contract-split-2/'
contracts/state-core.yaml
contracts/state.yaml
docs/DESIGN.md
docs/INTEGRATION.md
frontend/packages/core/src/record/index.ts
frontend/packages/core/src/record/schema.ts
frontend/packages/core/src/record/state-contract.ts
frontend/packages/core/src/record/validate.ts
frontend/packages/core/src/sources/local-source.ts
frontend/packages/core/src/view-model/portfolio.ts
frontend/packages/core/src/view-model/readiness.ts
frontend/packages/core/test/generic-host.test.ts
frontend/packages/core/test/state-contract.test.ts
```
All under `contracts/`, `frontend/packages/core`, or `docs/`. No file under
`roles/` and no business-domain-named path under `runs/` outside this run's
own directory.

### E14 — AC6.2
```
$ grep -niE 'ticket|jira|github issue|slack|jenkins|kubernetes' contracts/state-core.yaml
(no output)
```
Every example in the core document (E1) stays within run identity, gates,
escalations, and pause — no gate name, ticket system, or other business
vocabulary appears.

### E15 — AC7.1
```
$ grep -n "state-contract split" docs/INTEGRATION.md
135:state-contract split (§11's sequencing note): the split has landed
371:  toolchain it doesn't ship. The state-contract split (`runs/state-contract-split-2/`)
465:...(`frontend/README.md`; state-contract split landed, `runs/state-contract-split-2/`)...
498:Sequencing note: the state-contract split (§4) has landed
```
Every mention says "has landed"; none describes it as future or "active run
needing completion." §5's frontend-read-check precondition (line 371-374)
explicitly states the pass criterion now covers both SDLC-shaped and
generic-core hosts.

### E16 — AC7.2
```
$ grep -n "the SDLC extension of" docs/DESIGN.md
201:| `state.yaml` | Orchestrator → everyone | phase, task statuses, gate approvals, budgets — the SDLC extension of the generic core (`contracts/state-core.yaml`: run identity, gates, escalations, pause) |
```
The `state.yaml` row in DESIGN.md §5's contract table names the split and
scopes the row explicitly to the SDLC extension.

## Beyond the happy path

I pushed the parse boundary past the fixtures the task notes already covered,
to see whether the classifier and the generic schema hold up under adversarial
templates and files, not just the clean example in the plan.

- Fed `deriveStateContract` a template carrying `branch` but not `budget`/
  `tasks` (an SDLC host that only partially resembles the fixed shape): it
  classified as `generic` with `branchRequired: true`, not `sdlc` — confirming
  ADR-2's "all three markers, not just one" rule rather than a single-marker
  shortcut (`state-contract.test.ts`, "a template carrying branch but not
  budget/tasks classifies as generic").
- Fed it unparseable YAML and a YAML array (`- a\n- b`) as the state template:
  both fell back to the built-in `sdlc` contract rather than crashing or
  silently deriving an empty generic descriptor.
- Built a full temporary git repo (`generic-host.test.ts`'s "kill fixture")
  whose run file lists gates out of contract order, omits a declared gate,
  carries a non-null `paused_reason`, and has one resolved and one open
  escalation. `summarizeRun` still emitted gate cells in contract-declared
  order, gave the omitted gate an undecided cell rather than throwing, and
  counted exactly one open escalation.
- Ran the whole frontend suite (`npm test`, 421 tests) rather than only the
  three suites the plan calls out by name, and typechecked the whole
  workspace (`npm run typecheck`) to catch any package outside
  `frontend/packages/core` that the widened `GateLedgerMap` type might have
  broken (plan's own stated risk); both were clean.
- Compared `agentic status` output for `wordfreq` between a worktree pinned at
  the pre-split commit and this checkout, rather than trusting the unit tests'
  assertions about `summarizeRun` alone — an end-to-end CLI invocation.

## Gaps

None. All sixteen acceptance criteria in `runs/state-contract-split-2/spec.md`
were independently exercised against the real code paths (compiled
`parseRunState`/`deriveStateContract`/`validateArtifact`, `LocalGitSource`
over real temporary git repos, and the `agentic` CLI itself) rather than taken
from the review reports' claims, and all verified. `python3
scripts/render-agents.py --check`, `pytest scripts/test_integrate.py` (9
passed), and `pytest apps/wordfreq apps/mdtoc apps/dupefind` (run per-app, all
passed) were also run as adjacent regression checks outside this spec's
criteria; none is required by an AC but all are clean. `python3
scripts/integrate.py validate` against this repository itself reports "no
lock ... run init first" — expected, since this repository is the framework
source, not a downstream host with a `.agentic/framework-lock.json`; it is not
evidence for or against any AC here.
