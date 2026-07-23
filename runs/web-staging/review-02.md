# Review Report: 02-core-staged-readiness

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 10af385 (run/web-staging)

## Findings

### F1 — major — Task acceptance test 3 ("npm run typecheck passes") is unsatisfiable at this commit; not implementer-actionable
- **Where:** `frontend/packages/web/src/components/chips.tsx:42` (task 05's
  surface) vs `runs/web-staging/tasks/02-core-staged-readiness.yaml`
  acceptance_tests[2] and its scope note's KindChip claim.
- **Failure scenario:** `cd frontend && npm run typecheck` at 10af385 →
  error at chips.tsx:42, where KindChip indexes a four-key label object by
  `item.kind`, which now includes `'staged'` (line 28's early return narrows
  away only `'gate'`). Confirmed statically; every other `InboxKind` consumer
  (decide.tsx:112–135, inbox.tsx:13–15, run.tsx, cli main.ts:128,
  portfolio.ts — which uses `RunRef['kind']`, not `InboxKind`; server
  app.ts:257) narrows by equality and stays green — the implementer's
  "only chips.tsx" claim holds.
- **Requirement:** task acceptance_tests[2]. The failure is plan-intended —
  ADR-4's consequence says typecheck fails until task 05 branches — so the
  defect is the task file's scope note contradicting the plan, already
  flagged in the implementer's notes. Disposition belongs to the
  orchestrator/G2: land task 05 before G2 (the plan already sequences 05
  after 02) and treat this criterion as discharged there. Nothing inside
  this task's `file_contact_surface` can fix it, hence not blocking here.

### F2 — minor — The scope's "any other paused_reason, **including null**" row is unpinned by tests
- **Where:** `frontend/packages/core/test/readiness.test.ts:13–51` —
  `addPausedRun` accepts `null` (the `?? 'null'` branch) but is never called
  with it; only `gate-declined` pins the mid-flight-pause row.
- **Failure scenario (surviving mutant):** rewrite readiness.ts:148's strict
  equality as a truthiness form (`!state.paused_reason ||
  state.paused_reason === STAGED_REASON`, or a `??`-defaulting `isStaged`
  helper) — the suite still passes, yet a run paused with no recorded reason
  (schema-legal: schema.ts:119) renders "Run staged: awaiting arm" whose Arm
  affordance `planDecision` refuses — the same broken-affordance class R6
  exists to kill. Fix is four lines: a third
  `addPausedRun(dir, 'paused-no-reason', null)` fixture plus a
  paused-not-staged assertion; fold in at the next touch of this file.

## Coverage

Requirement coverage: R6's derivation half (AC6.1) is discharged. The staged
item in `frontend/packages/core/src/view-model/readiness.ts:148–163` matches
the plan's Readiness interface contract field-for-field — all nine fields
verbatim, `since` from `lastTouched(['state.yaml'])` exactly as the paused
item, and the extended `InboxKind` union in the plan's exact member order.
`STAGED_REASON` is imported from the record layer (schema.ts:25, value
`'staged'`), respecting the view-model→record layering direction; the
rules-table comment gains both the amended Paused row and the new Staged row.

Discrimination logic, all three arms traced: `paused_reason === 'staged'` →
staged item, early return; any other string → unchanged paused item (title
still interpolates the reason); `null` → strict equality is false → paused
item titled "no reason recorded". Escalations and round-cap items push before
the paused/staged branch, so a staged run with an unresolved escalation still
surfaces it — identical to prior paused behavior. Gate suppression for staged
runs is structurally guaranteed independent of the early return: `pendingGate`
(readiness.ts:64) requires `state.phase` in `GATE_PHASES[gate]`, and no gate
lists `paused` — the early return's real work is preventing a duplicate
paused item, and the mutant that drops it is killed by the staged test's
`toHaveLength(1)`.

Tests as product, mutation reasoning on the two new cases: inverted
condition, dropped early return, wrong title/detail strings, swapped packet
order (`toEqual`), null `since`, and `reviewable: false` mutants all die
against the staged test's pinned assertions; a swapped-branch mutant dies on
the other-reason test's `gate-declined` title check. The one surviving mutant
is F2's. Fixture realism checked statically: the handwritten `state.yaml`
round-trips `runStateSchema` (patch profile with G1/G2 present per
`PROFILE_GATES`, `paused` in `PHASES`, nullish budget/tasks/escalations
handled); `addPausedRun` inherits the generator's repo-local git identity and
`main` default branch (fixtures/src/index.ts:331–333) and restores the main
checkout. Count-sensitive assertions survive the two new fixture runs: the
run-discovery slug list is updated in correct sort order, the inbox-ordering
test's `>= 8` and escalated-first assertions hold (the new items' `since` is
now; the escalation is seven days old), each core test file builds its own
fixture so no other file sees the extra branches, and the shared
`@agentic/fixtures` generator is untouched per ADR-8, leaving the server
suite's run counts alone.

Interim web behavior between this task and task 05, checked: a staged run's
card loses the Resume affordance entirely (kind `'staged'` matches no
decide.tsx branch; `itemHref` emits no `decide` param), so the live
DecisionError defect named in the spec's Context is dead at this commit, with
the Arm affordance arriving in 05 — no crash path in the meantime.

Gap: neither `npx vitest run packages/core` nor `npm run typecheck` was
executed — `frontend/node_modules` is absent in this checkout, so the
dispatch's temporary-worktree recipe had nothing to symlink. The 170-passing
claim and the failure-isolated-to-chips.tsx claim rest on the static analysis
above (all `InboxKind` consumers enumerated by grep and read). Additionally,
the working tree held a staged revert of this commit during review, so every
reviewed line was read from commit 10af385 itself, never from disk. G2 should
see a green core-suite run before merge.

Concurrency: not assessed — nothing in scope touches concurrent access.

## Boundary check

Clean. `git show --stat 10af385` lists the two `file_contact_surface` files
plus the task's own yaml; the yaml change is a pure append to its `notes`
block (zero deletions, no top-level key changed) — exactly the append-only
implementer log `contracts/work-item.yaml` prescribes, not a surface
violation. No web, server, cli, or fixtures file is touched. The commit's
immediate neighbors are orchestrator state-metadata commits, so the diff
bounds this task's changes alone.
