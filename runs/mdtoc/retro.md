# Retro: mdtoc run (shadow-bar run 2 of 3)

Observations per WALKTHROUGH.md's closing questions. Context: this run was
executed to the M1 shadow bar's standing items (shadow-wordfreq.md): decline
recovery exercised for real, and a hand-maintained ledger from the first
dispatch. Orchestration mechanics were driven by the maintainer's session;
every gate decision, the G1 decline, and the intent brief (by adoption) were
the founder's.

## 1. Interventions beyond gates

- **None that patched agent output.** No artifact was hand-edited; every
  change went through a role dispatch.
- **One orchestration call outside the engine's model:** the G1 decline notes
  invalidated the *spec's* R4 as well as the plan's ADR-4. D9 models
  producer-only recovery (re-dispatch the architect); the human orchestrator
  additionally dispatched the analyst to amend R4. Without it, spec and plan
  would have diverged on the exact behavior the founder corrected. Candidate
  design finding for ORCHESTRATOR.md: decline notes may ripple upstream of
  the declined gate's producer.

## 2. Gate reviews: confirmations or corrections?

- G0: confirmation (all 7 assumptions accepted as resolved).
- G1 round 1: **declined** — a real correction (anchor fidelity: live GitHub
  preserves underscores; spec R4 and plan ADR-4 had formalized it away). The
  decline→resume→re-dispatch path worked as designed; both amendments landed
  with provenance (annotated assumption, inverted ADR with the old position
  preserved as rejected).
- G1 round 2: light-correction (delta review of the two amendments).
- The correction traces to G0: the analyst's assumption 2 *looked* like a
  clean derivation ("GitHub's documented scheme") and was approved as such.
  Lesson for contracts/spec.md: assumptions that encode an external system's
  behavior deserve a "verified against the live system?" flag — plausible
  formalizations of external behavior are where confirmation-grade review
  quietly passes errors.

## 3. Malformed artifacts / bounces

- None. All artifacts arrived well-formed; no D7 bounce was exercised (still
  only fixture coverage — carry-over item for run 3 if it occurs naturally).

## Bookkeeping quality (for the shadow replay)

- Commit-then-launch intent commits preceded implementer dispatches; closing
  bookkeeping landed with each artifact; ledger has one entry per model
  invocation (12 entries, $10.10 of $50 spent against real usage).
- Two known granularity blemishes, recorded for disposition: review-03.md
  landed one commit early (rode along with review-02's commit while its
  reviewer finished first); and this harness reports combined subagent
  tokens only, so ledger cost_usd values are estimates at registry pricing
  with an assumed 85/15 in/out split (raw totals in entry comments).
- One dispatch-seam note: the task-02 verify-round reviewer session was
  stopped by the user mid-flight and could not be resumed; a fresh reviewer
  was dispatched with the committed round-1 report as context. No state was
  lost (the report is the interface — exactly the contract working).
