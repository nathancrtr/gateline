# Retro: fleetview-intake

**Run:** design/research run, 2026-07-15 → 2026-07-21. G0 approved (light-correction),
G1 approved (confirmation). Partial selection recorded 2026-07-16 ahead of G2: the
seam + CLI subset (R4–R11, `agentic new`/`agentic arm`, the GitHub trigger path,
carried by task 03) selected; web-desk candidates (tasks 01/02) withdrawn, revivable
if the value curve bends (shared gate duty, operators who don't live in terminals).
Task 03's round-3 verdict: approve (one minor residual, F8). Spend: $41.14 of $200.

**Disposition:** G2 approved-and-held as the design of record. This run's product is
`design/seam-reference.md` plus the research artifacts — a buildable specification,
not code. Implementation is deliberately re-cut as a fresh `standard`-profile run
(`run/creation-seam`) planned against current `main`, because the framework moved
under this run: run profiles (#156) landed after the seam reference chose its
`staged`-phase representation (ADR-2), and #118/#119 were filed as its follow-on
context. No release phase for a design run; the hold note closes it.

## Findings

1. **Design-document tasks need a different acceptance-check style than code
   tasks.** Task 03 embedded executable verification greps whose corpus included
   the document itself; all three review rounds were spent litigating whether those
   checks could ever pass (the tracker-noun isolation grep tripped on zod's
   `error.issues` API and on the doc's own example URL), not the design substance.
   Route: task-cutting guidance in `roles/architect.md` — acceptance criteria for
   document products should be structural (sections, cross-references resolve,
   claims verified against source) rather than self-referential executable checks.

2. **The round-cap alarm fired four times after convergence, and resolution
   quality collapsed.** The task's final verdict was approve, but the pre-#140
   engine kept escalating round-cap; the human's resolutions degraded to
   dismissals ("I don't think this is real", "blah blah"), and the last one was
   left unresolved — the run parked on a stale alarm. The engine defect is fixed
   (#140, approve-on-cap-round is convergence). The residual lesson: dismissive
   resolution text is itself a signal of alarm miscalibration, and nothing mines
   it today. Routed to the historian/metrics: flag runs whose escalation
   resolutions look dismissive (issue filed).

3. **Mid-run scope selection worked.** The partial-selection decision — recorded
   as a dated note in `state.yaml` ahead of G2, holding two tasks and returning
   one to review — kept the run honest without inventing new gate vocabulary.
   Together with fleetview-design's approve-and-hold (#98), this is evidence the
   decision grammar supports design-selection runs.

4. **Infrastructure losses were misclassified, not design defects.** Escalation
   #8 (rebase failure) traced to the frozen pre-#113 hosted working tree; task
   01's round-1 mockups were stranded on the since-destroyed hosted machine and
   discarded with the hold. Already routed: #114 (fold-failure classification),
   hosted instance torn down in favor of local `agentic up`.

## What the follow-on inherits

`design/seam-reference.md` (the R4–R11 seam, registry, staged lifecycle, CLI
contract, worked examples) as design input — with the caveat that its phase-enum
and blast-radius sections predate run profiles and must be re-planned against
current `main`. Open design decisions handed to the follow-on: the one-seam
draft-PR question (#118), and staged-state representation now that profiles exist.
