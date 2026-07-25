# Intent Brief: Open escalations must stay visible when run state fails validation

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

## Problem

The Gate frontend (PR #19) reads a run's escalations only after the full
run-state schema validates. A `state.yaml` that fails validation for reasons
unrelated to escalations — an unexpected phase value, a missing field, a
host-local divergence — reports `escalationsOpen: 0` on every surface (CLI
status, inbox, `/api/runs`, run detail).

Observed concretely in a downstream integration (notes maintained outside this
repository): a run carrying an unresolved escalation — flagged by its producing
role as requiring human attention before dependent work proceeds — rendered
with `escalationsOpen: 0` because the surrounding state failed schema checks on
unrelated fields. The run did render as malformed, loudly, so the signal was
degraded rather than silently lost; but "malformed run" and "a role has raised
an alarm a human must act on" are different severities, and today the second is
hidden inside the first.

## Motivation

Escalations are the pipeline's alarm channel: the one field whose entire
purpose is to survive everything else going wrong. A governance surface whose
alarm visibility depends on full schema validity has its dependencies inverted —
the moment state is most broken is the moment an open escalation most needs to
be seen. The fix is small (a conservative, best-effort read of the
`escalations` list on parse failure), the value is asymmetric, and it directly
strengthens the product's core claim that oversight is structural rather than
aspirational.

## Constraints

- R3 stays intact: a schema-invalid run gains no approve, decline, or
  resolve-escalation controls from this change. Visibility only.
- Best-effort means conservative: surface an escalation count/preview only when
  the `escalations` entries themselves are well-formed (at, from_role, reason,
  resolved); never invent, repair, or guess. If the list itself is unreadable,
  show nothing beyond the existing malformed bounce.
- No new write path, no store, no change to the state contract itself.

## Out of scope

- General partial-schema tolerance for any other field (phase, gates, tasks,
  budget) — malformed stays malformed.
- The core/extension split of the state contract, filed separately as
  `runs/state-contract-split-2/`; this brief is deliberately independent so it
  can ship even if that one is declined, and the two should be sequenced at G0.
- Resolving escalations from the frontend on schema-invalid runs.
