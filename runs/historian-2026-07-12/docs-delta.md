# Docs Delta: historian-2026-07-12

**Interval covered:** repository start → 2026-07-12 (first sweep; evidence read at `main` = `c3a821f`)
**Evidence swept:** merged run `runs/wordfreq/` (incl. retro), PRs #19–#24 (gate frontend, integration design, orchestrator design + implementation, CLAUDE.md refresh, OSS posture), all of `docs/`, root docs, `frontend/` READMEs, role specs, contracts, GitHub issues #1–#18. PR #25 (Historian role) is in flight and treated as pending, not drift.

## Drift found

| # | Surface | Drift | Evidence | Disposition |
|---|---------|-------|----------|-------------|
| 1 | docs/DESIGN.md header | Status said "v0.1 — draft for team review"; repo is v0.2, single-maintainer, and §7's v1 design is implemented | README/CLAUDE.md status; PR #24 | applied |
| 2 | docs/DESIGN.md §4 budget cap | Called automated metering "a v1 prerequisite, not a nice-to-have" — v1 landed it (seam metering, `budget.ledger[]`, pre-flight cap) | PR #24; ORCHESTRATOR.md §6 | applied |
| 3 | docs/DESIGN.md §7 | Said the v1 design "is drafted in ORCHESTRATOR.md" — it is implemented in `frontend/packages/orchestrator` | PR #24; WALKTHROUGH.md v1 section | applied |
| 4 | docs/DESIGN.md §9 | Failure-mode row said "adapters should isolate parallel implementers in per-task worktrees" — the v1 orchestrator does (serial fold-back) | `workspace.ts`; ORCHESTRATOR.md §5.3 | applied |
| 5 | README.md repo map | No row for docs/FRONTEND.md (+ FRONTEND-PLAN.md), though frontend/ has one | repo map vs docs/ | applied |
| 6 | README.md status | "Next: team review of the production pilot plan, then Phase 0 scaffolding" — stale; frontend + v1 orchestrator merged since; next steps are the v1 exit evidence, integration workflow, first tagged release | PRs #19, #23, #24; ORCHESTRATOR.md §10 | applied |
| 7 | CLAUDE.md orientation | Product description omitted `frontend/` (gate frontend + orchestrator), which merged after the CLAUDE.md refresh (#22 predates #19/#24) | merge order #22 → #19 → #24 | applied |
| 8 | CLAUDE.md commands | No command for the frontend/orchestrator test suite (`npm test`) — the repo's largest code surface | frontend/package.json | applied |
| 9 | docs/DESIGN.md §3 roster + P6 bullet | Roster says seven roles and the Historian bullet is still future-tense — being fixed in PR #25; not duplicated here to avoid conflicting edits | PR #25 | escalated (in flight) |
| 10 | Issues #7, #9, #10 | Epics whose outcomes landed: gate frontend (#19), v1 orchestrated mode (#23/#24), automated metering (#24). Residual work is smaller than the epics (see todo-catalog C1/C2) | merged PRs | proposed |
| 11 | Issues #15, #16 | "Review & merge" tasks for design branches that merged as PRs #19 and #20 | merge history | proposed |
| 12 | Issue #18 | Per-implementer worktree isolation — implemented in v1 (`workspace.ts`), ahead of its icebox trigger; only v0 shared-tree dispatch remains as designed | PR #24 | proposed |
| 13 | Issue #14 | Design-debt epic largely discharged (frontend, integration, orchestrator drafts all merged); #17 is the main open item | merged PRs | proposed |

## Applied changes

- `docs/DESIGN.md` — header status (row 1); §4 budget-cap bullet (row 2); §7 v1 paragraph (row 3); §9 isolation row (row 4).
- `README.md` — FRONTEND.md repo-map row (row 5); status paragraph (row 6).
- `CLAUDE.md` — orientation includes `frontend/` (row 7); commands include the frontend test suite (row 8).

## Proposed actions

Tracker mutations for the human (exact commands; see `todo-catalog.md` for the new issues to open first, so closures can reference them):

- `gh issue close 7 --comment "Landed: the gate frontend (web, CLI, server over @agentic/core) merged in #19; co-writer scoping and PR-approval sync refined in #24."`
- `gh issue close 9 --comment "Landed: v1 orchestrator design (#23) and implementation M0–M4 (#24). Residual exit evidence tracked separately: shadow-agreement bar (2 of 3 runs remaining) and live cross-vendor dispatch verification."`
- `gh issue close 10 --comment "Landed in #24: every dispatch is metered through the seam into budget.ledger[] with registry pricing and a pre-flight cap. Residual: copilot-cli reports no per-invocation usage yet (static-estimate fallback), tracked separately."`
- `gh issue close 15 --comment "Merged as #19."`
- `gh issue close 16 --comment "Merged as #20."`
- `gh issue close 18 --comment "Implemented ahead of the icebox trigger: the v1 orchestrator isolates each parallel implementer in a per-task worktree with serial fold-back (#24, workspace.ts). v0 human dispatch still shares one tree by design (DESIGN.md §9)."`
- `gh issue comment 14 --body "Status: branch consolidation complete — FRONTEND (#19), INTEGRATION (#20), ORCHESTRATOR (#23/#24) all merged; retro contract fixes landed. Remaining open item under this epic: #17."`

## Escalations

- **DESIGN.md §3 roster/P6 bullet** (row 9): owned by in-flight PR #25; fold there, not here.
- **FRONTEND.md §7 / INTEGRATION.md §10 "open questions for team review"**: several are already implicitly decided (e.g. FRONTEND Q1 — the local-first build answered it). Recording those decisions is maintainer judgment over design docs' decision sections, out of Historian scope; proposed as catalog item C10.

## Surfaces checked, no drift

- `docs/WALKTHROUGH.md` — current, including its v1 closing section (updated in #24).
- `docs/ORCHESTRATOR.md` — current at main; §8 amendments all landed; §12 records resolutions.
- `docs/FRONTEND.md` / `docs/FRONTEND-PLAN.md` — headers accurately describe what was built vs deferred.
- `docs/INTEGRATION.md` — accurately marked "nothing here is implemented yet".
- `runs/wordfreq/retro.md` findings — all absorbed: mutation reasoning is in `roles/reviewer.md`, environment probing in `roles/architect.md`, `review_rounds` single-homed and `review-approved` in the enum (`contracts/state.yaml`, `work-item.yaml`).
- `roles/*`, `contracts/*`, `registry/models.yaml`, adapter manifests, rendered agents — consistent with each other and with the render check.
- `NOTICE.md`, `LICENSE.md`, `frontend/README.md`, `frontend/packages/orchestrator/README.md` — current.
- No TODO/FIXME markers in code; no consumer-specific references found anywhere in the repo.
