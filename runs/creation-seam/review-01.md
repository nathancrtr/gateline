# Review Report: 01-merge-main

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** run/creation-seam `47fc258..4835e607` (70aae4c merged-main content + 4835e607 task-file notes)

## Findings

### F1 — minor — Branch history was linearized after the fact: the merge commit the notes cite (282e7d3) is dangling; the branch instead carries 70aae4c, a single-parent replay of b11428e
- **Where:** `runs/creation-seam/tasks/01-merge-main.yaml:38-39` (notes claim "merge commit 282e7d3 (parents 47fc258, b11428e)"); branch commit `70aae4c` (parent `47fc258` only)
- **Failure scenario:** Not content — verified `git diff 282e7d3 70aae4c` is empty (identical tree 74f7873b) and `git diff 4835e607 b11428e -- . ':!runs/'` is empty, so the reviewed tree outside `runs/` is byte-identical to origin/main tip b11428e. The consequences are ancestry-shaped: (a) b11428e is not an ancestor of run/creation-seam, so the eventual run PR's three-dot diff against main re-shows #156's 28 framework files as apparent run-branch changes — a later reviewer or G2 human told to "diff against main" would see other work's hunks (this task's dispatch avoided it by using a commit range; later dispatches must too); (b) the committed run record describes a two-parent merge that is not the branch's actual history — an audit-trail inaccuracy in what AGENTS.md treats as evidence. Forensics: 282e7d3 is a real signed merge onto worktree branch `run/creation-seam--task/01-merge-main` (its message names that branch); 70aae4c reuses b11428e's message and author date with a later committer date — the signature of the orchestrator's harvest rebasing the task branch without `--rebase-merges`, flattening the merge. This is orchestration machinery behavior, not an implementer defect; the notes were accurate for the commit the implementer actually made. Non-blocking because every requirement this task exists to satisfy depends on tree content, which is exact. Suggested routing: orchestrator harvest behavior (`frontend/packages/orchestrator`), not a task-02+ code change; a one-line orchestrator/implementer note recording the final linearized shape would repair the record without hand-editing.
- **Requirement:** task scope "the merge commit is the entire change" (letter deviated, substance met); AGENTS.md "completed runs are historical records"

## Coverage

- **R4/R5 grounding (this task's claimed requirements)** ✓ — the merged tree carries everything later tasks bind to, verified at `4835e607` directly: `PROFILES` (`frontend/packages/core/src/record/schema.ts:29`), `PROFILE_GATES` (:33), `PROFILE_PHASES` (:40), `deriveResumePhase(state: RunState): Phase` walking `PROFILE_GATES[state.profile]` (:210-213 — matches plan.md's ADR-2/actions-delta citation exactly), D21 in `frontend/packages/orchestrator/src/derive.ts` (:34, :140, :147, :153, :207 including the patch-run-no-task-file escalation AC4.2 relies on).
- **ADR-6 escalation conditions** ✓ clean — zero conflicts (no conflict markers anywhere under `frontend/` at the reviewed tree), no merged shape contradicts plan.md's Interface contracts. The implementer's noted "deviation" (deriveResumePhase in `record/schema.ts`, not `derive.ts`) is not a plan contradiction — the plan cites it by behavior in the actions delta, not by that file — so declining to escalate was correct.
- **Mechanical-merge fidelity** ✓ — `git diff 4835e607 b11428e -- . ':!runs/'` empty: no hand-authored hunks exist anywhere outside `runs/`; the only `runs/` change in the span is the notes append to the task file itself (`git diff --name-only 47fc258..4835e607 -- runs/` → the task file only). The run's own `state.yaml`/artifacts were untouched by the merge.
- **Acceptance tests:** greps 1 and 2 re-run directly against `4835e607` ✓ (outputs match the notes verbatim). `npm test` / `npm run typecheck` **not re-run**; relied on the implementer's pasted evidence, corroborated independently by the fact that the reviewed tree outside `runs/` is byte-identical to b11428e — the merged #156 tip that passed frontend-ci on main.
- **Notes accuracy** ✓ except the 282e7d3 lineage claim (F1); merge-base 1733b41, pre-merge divergence check, and grep line numbers all verified true.

## Boundary check

Clean. Declared surface is "(merge commit only — entire tree, mechanical; no hand-authored hunks)": 70aae4c introduces no hunk that differs from origin/main's own content (tree-identical to the true merge), and 4835e607 touches only this task's own `notes:` block. No other task's surface, no `runs/` artifact beyond the task file, no rendered-agent or state-file edits in the reviewed span.
