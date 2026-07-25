# Intent Brief: The writeState kill window wedges a run until a human hand-commits

## Problem

Killing the engine at the wrong instant permanently wedges a run. Writing
`state.yaml` to a run branch that is checked out in a worktree takes two steps:
write the mutated file into the checkout, then commit it. A process kill between
the two leaves the checkout dirty.

Every later state write on that branch then refuses with `dirty-worktree`. The
refusal is the right instinct, because a checkout's edits must never be
clobbered behind its back. But when the dirt is the engine's own half-finished
write, the engine cannot tell the difference and cannot clear it. It retries the
blocked bookkeeping every tick, forever, and the run stops making progress.

This is not hypothetical. On 2026-07-23 the engine was killed during a restart
just after three parallel review folds landed, and died inside a meter write for
the reviewer of `04-server-orchestrator-wiring`. The restarted engine looped on
`dirty-worktree` refusals while delivered review verdicts sat unrecorded.
Recovery took a human hand-committing the dirty file in the engine's own
checkout under the bot identity.

The GitHub issue tracking this is #193, which also proposes two candidate
fixes and names the files involved.

## Motivation

Restart-by-kill is how the engine picks up merged code today, so this window is
opened routinely rather than rarely. Every restart is a chance to wedge a live
run.

Recovery is worse than the fault. It needs a human doing manual git surgery
inside the engine's working checkout — the exact class of intervention this
framework exists to remove, and one that is easy to get wrong under pressure.

This blocks the other substrate work. Runs that wedge on their own bookkeeping
make every subsequent dogfooding run unreliable, so this is the first of the
five substrate bugs to clear.

## Constraints

* A human's uncommitted edits in a run-branch checkout must stay protected. Any
  self-heal must prove the dirt is the engine's own abandoned write, not
  someone's work in progress.
* The checkout must never be left silently diverged from its branch. That
  invariant is why the commit-through-the-checkout path exists at all.
* State writes stay on the co-writer contract: compare-and-swap ref updates,
  comment-preserving YAML, and ISO-8601 timestamps.
* Any refusal that survives should name the run and print the exact remedy
  commands, because operator recovery today is manual and undocumented.
* The change belongs in `frontend/packages/core`, and `npm test` plus
  `npm run typecheck` must pass in `frontend/`.

## Out of scope

* Graceful drain and restart (#150). This run makes the kill survivable; it does
  not remove the kill.
* Checkout teardown losing uncommitted work (#184). Same family of crash-window
  defect, but a separate run.
* The three remaining substrate bugs (#96, #97, #114, #115), each of which gets
  its own run.
* Any change to gate grammar or to who may write gate entries. The orchestrator
  still never writes `gates.*`.
* A general redesign of worktree lifecycle management.

## Profile

standard
