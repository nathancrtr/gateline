# Intent Brief: Budget guards must be recoverable, and the host ceiling must not brick the deployment

## Problem

Both budget guards can wedge a run — and the host-wide one can wedge the whole
deployment — with no remedy reachable from the surfaces an operator has.

**The run-level guard (DB) is a dead loop.** A run paused `budget-exhausted`
cannot be resumed. `budget-exhausted` is a *condition* the deriver recomputes
from unchanged facts, but resolve-and-resume treats it as an *event* a human
disposition can clear. Resume writes `phase` back and clears `paused_reason`; it
changes none of the guard's inputs, so the next tick re-derives the identical
escalate+pause. Each cycle burns two human decisions and appends another
`escalations[]` entry — the engine's escalate path appends without dedup. The
pause card's copy is hardcoded regardless of `paused_reason` ("Resume, or decline
the pending gate to end the run"), which names neither of the two things that
actually work. Reproduced live on `run/fleetview-intake`: ledger $7.31 + 3
implementer estimates × $8 = $31.31 against `cost_limit_usd` $30, re-pausing
within seconds of each resume. Full commit sequence and file:line root cause in
issue #96.

**The host-level guard (HB) ratchets toward permanent exhaustion.** Raising
`cost_limit_usd` — #96's only workaround — trips the host guard, which has the
same dead-loop shape plus three problems of its own:

1. `hostProjectedUsd` sums the **lifetime** ledgers of every unmerged run
   branch, not in-flight or prospective spend. Ledgers only grow, and a run
   leaves the sum only when its directory lands on the default branch. Under
   this repo's own convention of keeping run branches, the base is monotonically
   non-decreasing: every deployment with a static `--spend-limit-usd` eventually
   reaches a state where **no run can ever dispatch again**. Observed on the
   hosted deployment at $63.76 against $50, where $39.76 was past spend on four
   other runs — $23 of it by a run sitting at rest in `spec`.
2. The remedy is fully out of band. HB's limit is a process flag on the
   orchestrator host (`ORCH_SPEND_LIMIT_USD` → `--spend-limit-usd`). Nothing in
   FleetView *or in the repository* can clear the condition, yet `state.yaml` is
   documented as the entire control plane in both directions (ORCHESTRATOR.md
   §4.5).
3. A host-level condition is recorded as a run-level escalation. HB fires inside
   whichever run happened to request dispatch that tick, and the escalation
   packet points at a `state.yaml` that contains no $50 anywhere. Several runs
   wanting dispatch each collect their own escalation for one shared condition.

**The accounting semantics are unsettled and this run should settle them.** HB
could measure (a) lifetime spend across active branches — today's behavior,
(b) in-flight plus requested spend only (a concurrency/burst ceiling), or (c)
spend within a rolling window (a rate limit). Each is defensible; (a) is the only
one that bricks the host permanently by default. My recommendation, to confirm or
overrule at G0: a **rolling window** as the primary semantics, with in-flight and
requested spend counted inside it. It is the only option that both bounds the
burn rate an operator actually fears and self-heals without intervention — a
burst ceiling bounds concurrency but not total spend, and a lifetime allowance
bounds total spend but makes merge hygiene load-bearing for whether agents can
work at all. If the maintainer wants a hard lifetime cap instead, it needs a
different name, documented as a deployment allowance, with remaining headroom
surfaced in FleetView and a way to raise it from the repository.

No test pins the resolve → resume → re-escalate cycle for either guard. DB
itself and rest-while-paused are tested; the round trip through a human
resolution is unexamined behavior, not a settled design choice.

## Motivation

Every run that trips either guard today needs a hand-edit of `state.yaml` — or,
for HB, a redeploy of the orchestrator host — to make forward progress. On a
hosted deployment, which is the shipped topology in `deploy/`, the operator has
no checkout at hand and the run is bricked at the UI level. That is the failure
mode most likely to be hit by the first adopter who is not the maintainer: budget
caps exist precisely so people set them, and the guard firing is the expected
case, not the exceptional one.

It is also self-inflicting right now, and the workaround already in force is the
strongest evidence that the guards are unlivable as built. Measured on this
repository at the time of staging, the lifetime ledgers of the unmerged run
branches sum to **$103.64** — more than double the $50 host ceiling that
ORCHESTRATOR.md and DEPLOY.md document. The two largest contributors are
`fleetview-intake` at $41.14, a *finished* run whose only sin is that its
directory has not landed on the default branch, and `state-contract-split-2` at
$42.22, in flight. Under today's semantics this deployment is already in the
permanently-exhausted state #97 predicts: no run can dispatch, at any per-run
budget, until branches merge or the flag moves. The engine is in fact running as
`agentic up --no-budget-enforcement` — the maintainer's live remedy is to switch
the guards off entirely, which is the honest measure of how usable they are.

The two issues are one change: the same escalate+pause path, the same pause-card
copy, the same dedup question, and the same "what can a human do about it"
answer. Fixing them separately means writing the copy and the dedup twice.

## Constraints

- **The guards must keep working.** No fix may make a runaway dispatch cheaper to
  cause. "Pause, never degrade" (DESIGN.md §6) stays: partial dispatch of an
  eligible parallel set that does not fit under the cap remains a non-goal.
- **`state.yaml` stays the control plane in both directions.** Whatever the human
  can do about a fired guard must be expressible in committed run state, not only
  in a process flag — including for the host guard.
- **The orchestrator never writes `gates.*`,** and anything touching `state.yaml`
  follows the co-writer contract: compare-and-swap ref updates,
  comment-preserving YAML, ISO-8601 timestamps.
- **Never test by running a live `tick`/`watch` against this repository.** Verify
  with the test suites, `tick --dry-run`, or `shadow` replays of finished runs.
- Changing the host guard's accounting semantics is a documented behavior change:
  ORCHESTRATOR.md and DEPLOY.md must land with it, and an existing deployment's
  configured flag must not silently come to mean something new without saying so.
- `frontend/packages/core` keeps its record → sources → view-model layering, and
  derivation stays a pure function of committed state.

## Out of scope

- **Signed or verifiable gate records** (#121, #122, epic #129). Unrelated seam.
- **Retiring or deleting runs** (#200). It would shrink the HB base sum as a side
  effect, which is worth noting in the record, but it is a separate decision about
  the inbox — do not fold it in.
- **Replacing static dispatch estimates with trailing-average or real usage**
  (#36, #39, #75). The guards' arithmetic is only as good as its estimates, but
  this run takes `dispatch_estimates_usd` as it finds it: what changes is
  recoverability and accounting semantics, not estimate quality.
- **Fold and dispatch failure recovery** (#114, #115). Also escalation-path
  defects, also needing hand-edits, but a different derivation rule and a
  different root cause.
- **Per-run budget UI beyond what recovery needs.** If resume-from-budget-exhausted
  needs to carry a new limit, build exactly that; a general budget-editing surface
  is not asked for.

## Profile

standard
