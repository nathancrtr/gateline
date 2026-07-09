# Retro: wordfreq run

Observations logged during the run (per WALKTHROUGH.md — these feed design
iteration and the production pilot plan).

## 2026-07-08 — G1

- **ADR-4 validates the frontier-reasoning binding for the Architect role.** The
  Architect rejected `Counter.most_common()` because its insertion-order tie
  handling silently violates the spec's alphabetical tie-break criterion (AC5.1),
  mandating an explicit `sorted(key=(-count, word))` instead. This is the classic
  silent-wrongness bug: every happy-path test passes, the defect only surfaces on
  tied counts. Catching it at plan time — before any code existed — is exactly the
  judgment-concentrated work DESIGN.md §6 argues should get the deepest model;
  a cheaper binding that missed it would have cost an implement/review round (or
  shipped it). Datapoint for: profile assignments in registry/models.yaml.

## 2026-07-08 — implement phase (pre-G2)

- **Adversarial review of tests works.** Both test-authoring tasks (03, 04) got
  legitimate request-changes on round 1 — tests that couldn't discriminate correct
  implementations from specific mutants (count-blind sort, missing truncation,
  site-packages-as-stdlib). Both fixes were verified by constructing the mutants.
  Reviewing tests as the product, with mutation reasoning, should be standard in
  the reviewer role spec — consider promoting from dispatch-prompt guidance to
  roles/reviewer.md.
- **Environment constraints surface repeatedly; ADRs contain them.** Python 3.9.6
  broke the plan's pinned PEP 604 signature (task 02) and the task text's
  stdlib-check mechanism (task 04) independently. The amend-the-plan flow
  (ADR-8, ADR-9) worked well: cheap, auditable, and ADR-9's guidance was applied
  by the round-2 reviewer as the correctness standard. Lesson for the production pilot:
  Architect should probe the runtime environment (interpreter version, tool
  availability) at plan time, not discover it at implement time.
- **Parallel implementers saw each other's mid-flight states.** Task 03's agent hit
  task 02's transient broken import while both worked in one working tree. Disjoint
  file surfaces prevented damage, but true isolation (worktrees per implementer)
  would remove the class entirely — consider for the adapter.
- **Contract gaps found by using them:** (1) task status enum lacks a state for
  "review-approved, awaiting verification" — improvised `review-approved`;
  (2) `review_rounds` is duplicated between task yamls and state.yaml and drifted
  immediately — pick one home (state.yaml); (3) `budget.cost_spent_usd` stayed 0
  all run — nothing updates it in v0; token-usage tracking needs a mechanism
  before the budget cap is real.

## 2026-07-07 — G0

- Dispatch mechanics ("use the X subagent") weren't obvious from the walkthrough
  alone; clarified in docs (commit b7e97a5). Watch whether other operators still
  trip on session-restart requirement for newly created agents.
