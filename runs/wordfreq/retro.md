# Retro: wordfreq run

Observations logged during the run (per WALKTHROUGH.md — these feed design
iteration and the redacted pilot plan).

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

## 2026-07-07 — G0

- Dispatch mechanics ("use the X subagent") weren't obvious from the walkthrough
  alone; clarified in docs (commit b7e97a5). Watch whether other operators still
  trip on session-restart requirement for newly created agents.
