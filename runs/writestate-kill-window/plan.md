# Technical Plan: The writeState kill window wedges a run until a human hand-commits

## Approach

The engine will leave itself a durable note before every risky write, so a later
write can recognize its own abandoned work and clean it up on its own. Today the
checked-out-branch path of the state writer runs in two steps — write the file,
then commit it (`frontend/packages/core/src/sources/local-source.ts:350-367`) — and
a kill between them leaves dirt the next write cannot attribute, so it refuses
forever.

The fix records a write-ahead intent before the working-tree write lands. The
intent is an ordinary commit object, built with the plumbing the clean path already
uses, and held by a ref no branch ever reaches (`refs/agentic/wip/<branch>`). That
one object captures the three facts recovery needs: the tip the write built on, the
exact bytes it meant to write, and the commit message.

On a later write that finds the state file dirty, the dirt is provably the engine's
own only when every check passes:

- the state file's dirt is a worktree-only modification, with nothing staged
- the intent ref exists, and its commit's parent is the current branch tip
- the dirty file's bytes equal the intent commit's copy of the state file

When all three hold, recovery discards the dirt, deletes the intent ref, and lets
the current write proceed exactly as a clean write would (R1). The abandoned
mutation is not replayed — the orchestrator's derivation re-derives it on a later
tick (ADR-2). Any failed check refuses as today (R2), but the surviving refusal
now names the run and prints two copy-pasteable remedy commands (R3).

Nothing else moves. The plumbing path for branches without a checkout is untouched,
because a kill there leaves only unreachable objects, never dirt. Compare-and-swap,
comment-preserving mutation, identity handling, and push behavior are unchanged
(R5). Recovery restores the checkout to its ref before writing, so the checkout
never diverges from its branch (R4).

Two tasks carry this: the recovery mechanism with its tests, then the enriched
refusal message. Both edit the same file, so they are serialized, not parallel.

## Interface contracts

`writeState`'s public signature, the `WriteFailure` union, and the `WriteResult`
shape are unchanged. Everything below is internal to `LocalGitSource` but normative
— the tests in task 01 exercise the on-disk format directly.

**Intent record** (written only on the checked-out-branch path):

- Ref name: `refs/agentic/wip/<branch>` where `<branch>` is the run branch
  (e.g. `refs/agentic/wip/run/<slug>`). Refs are shared across worktrees, so it is
  written and read through the source's main `Git` handle.
- Points at an *intent commit* built with existing primitives
  (`hashObject` → `writeTreeWithBlob` → `commitTree`):
  - parent: the branch tip the write built on (`tip`)
  - tree: `tip`'s tree with the state file blob replaced by the intended content
  - message: the write's commit message; author: `options.identity` when set
- Lifecycle within one `writeState` call on the worktree path:
  1. build `updated`; 2. build the intent commit and force-set the intent ref;
  3. `writeFile` into the checkout; 4. `git commit` through the checkout (as
  today); 5. best-effort delete the intent ref (`update-ref -d`, errors on a
  missing ref swallowed); 6. push when configured.

**Recovery predicate** — applied where the current code refuses on dirty status;
all conditions required, any miss falls through to the refusal:

1. Scoped `status --porcelain -- <statePath>` reports only a worktree-only
   modification of the state file (exactly the ` M <statePath>` line — anything
   staged, untracked, or additional refuses).
2. The intent ref resolves to a commit whose first parent equals the current
   branch tip.
3. The checkout's state-file bytes are identical to `show(<intent>, <statePath>)`.

**Recovery action:** restore the state file from HEAD in the checkout
(`git checkout -- <statePath>` via the worktree's `Git` handle), delete the intent
ref, then continue into the unchanged clean-path write.

**Surviving refusal message** (task 02) — `reason` stays `'dirty-worktree'` (the
server keys HTTP 423 off it); the `message` must contain all of:

- the run's slug, named as the run (not only inside a path)
- the checkout path and the state-file path
- two literal commands scoped with `git -C <checkout.path>` and the
  `-- <statePath>` pathspec: a keep remedy
  (`git -C <path> commit -m "state(<slug>): manual recovery" -- <statePath>`) and
  a discard remedy (`git -C <path> checkout -- <statePath>`)

## Decisions (ADRs)

### ADR-1: Prove authorship with a write-ahead intent ref, not a heuristic
- **Choice:** Before the working-tree write, record an intent commit (base tip +
  intended bytes + message) under `refs/agentic/wip/<branch>`; dirt is the
  engine's own only when it matches that record under the three-part predicate.
- **Rejected:** Heuristic attribution — treating dirt as the engine's when it
  parses as valid run state or matches an expected mutation shape. A human
  hand-repairing state in the bot's checkout produces exactly that shape, so the
  heuristic would discard human work and violate R2. Also rejected: reordering to
  commit-by-plumbing before touching the checkout. That ordering leaves the
  checkout diverged from its ref inside the new window, and needs index surgery
  in a worktree the framework promises never to mutate behind anyone's back (R4).
- **Consequences:** Every checked-out-branch write costs two extra ref updates and
  a few unreachable objects. The proof is exact rather than probabilistic, so a
  stale intent ref can never validate foreign dirt — the parent-equals-tip check
  invalidates it the moment a real commit lands.

### ADR-2: Recovery discards and re-derives; it never finishes the abandoned commit
- **Choice:** On a positive match, restore the file from HEAD and let the current
  call apply its own mutation; the abandoned mutation is dropped.
- **Rejected:** Completing the abandoned write by committing the recorded content.
  It commits a derivation that may be stale by the time recovery runs, and it adds
  a commit the current caller never asked for — exactly what AC1.2 forbids. The
  orchestrator already re-derives idempotently (docs/ORCHESTRATOR.md §4.2), so
  finishing buys nothing that a later tick doesn't.
- **Consequences:** The branch history holds exactly one commit per successful
  call, which AC1.2's test asserts. Intent commits become unreachable objects that
  ordinary git garbage collection removes. A discarded action reappears on a later
  derivation, so recovery never loses human-visible data.

### ADR-3: When attribution is ambiguous, refuse — staged or mixed dirt never recovers
- **Choice:** The predicate demands a worktree-only modification of the state file
  and nothing else; any staged change, extra status line, or byte difference falls
  through to the refusal.
- **Rejected:** Recovering whenever content matches, regardless of index state. The
  engine never stages, so a staged entry is evidence of a human hand in the
  checkout, and R2 ranks protecting that hand above self-healing.
- **Consequences:** Some genuinely-abandoned writes that a human has since touched
  will still refuse. That is the intended trade: the refusal now carries its own
  remedy (R3), so the residual manual path is a copy-paste, not git surgery.

### ADR-4: Tests reproduce the kill by intercepting the worktree commit, not via a production hook
- **Choice:** The reproduction test patches `Git.prototype.run` to make the
  checkout's `commit` invocation die after the intent ref and file write have
  landed, then restores it and calls `writeState` again.
- **Rejected:** An injected test-only callback (for example `onBeforeCommit`) on
  `writeState`. It widens a public API that three packages consume for the sake of
  one test, and the prototype patch exercises the identical code path because the
  worktree handle is constructed from the same class.
- **Consequences:** The test drives the real write path end to end, so the intent
  record format is covered by construction rather than by a hand-built replica.
  The patch must be restored in a `finally` block to keep the suite hermetic.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-intent-ref-recovery |
| R2 | 01-intent-ref-recovery |
| R3 | 02-refusal-message |
| R4 | 01-intent-ref-recovery |
| R5 | 01-intent-ref-recovery, 02-refusal-message |

## Risks

- **Unprobed git edge behavior.** This planning session had no shell, so two git
  details rest on documentation, not local execution: `update-ref -d` errors on a
  missing ref (hence "best-effort delete, errors swallowed"), and porcelain v1
  emits exactly ` M <path>` for a worktree-only modification. Early signal: task
  01's first test run; both are contained inside the predicate/lifecycle helpers.
- **Co-writer race during recovery.** Two writers hitting the same checkout could
  both pass the predicate; the second's discard is a no-op and the existing
  worktree-commit race posture is unchanged, but this is asserted, not proven.
  Early signal: flaky `ref-moved` results in the new tests.
- **Strict reading of AC1.2's "orphaned commit".** Intent commits are deliberate
  unreachable objects (ADR-2); the test asserts branch history, not the object
  database. If the G2 verifier reads AC1.2 as forbidding dangling objects, that is
  a plan-level dispute — route it back here as an amendment, not an implementer
  workaround.
- **Fixture topology.** The tests dirty the primary checkout (the fixture repo's
  own working tree), not a linked worktree; `git worktree list` reports both
  identically, but if recovery behaves differently in a linked worktree the tests
  would miss it. Early signal: manual `agentic` smoke against a real engine
  checkout at G2.
