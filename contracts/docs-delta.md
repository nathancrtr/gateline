# Docs Delta: <sweep slug>

<!-- Contract: produced by Historian; consumed by the human reviewing the sweep
     branch. One delta per sweep, at runs/<slug>/docs-delta.md.
     Dispositions: applied (edited on this branch), proposed (exact action for
     the human, e.g. a tracker command), escalated (drift owned by roles/,
     contracts/, or registry/ — the Historian never edits those).
     BUDGET: one row per drifted surface; cite evidence by path/commit/issue,
     never quote it. A human should review the whole delta in five minutes. -->

**Interval covered:** <last sweep marker or repo start> → <this sweep date>
**Evidence swept:** <runs merged, notable merges/commits on the default branch>

## Drift found

| # | Surface | Drift | Evidence | Disposition |
|---|---------|-------|----------|-------------|
| 1 | <file or issue> | <what it claims vs what happened> | <artifact/commit/issue> | applied / proposed / escalated |

## Applied changes

<!-- One line per file edited on this branch: path — what changed, and which
     drift row it resolves. -->

## Proposed actions

<!-- Mutations left for the human, each with the exact command or edit
     (e.g. `gh issue close 12 --comment "..."`) and its drift row. -->

## Escalations

<!-- Drift the Historian may not fix: which file owns the fix
     (roles/*.md, contracts/*, registry/models.yaml) and why. -->

## Surfaces checked, no drift

<!-- One line each. This is the evidence the sweep looked — an empty "Drift
     found" table is only credible next to a non-empty list here. -->
