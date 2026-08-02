# Docs Delta: historian-2026-08-02

**Interval covered:** 2026-07-25T20:42:14.706Z → 2026-08-01 (present)
**Evidence swept:** 34 commits merged to main including major refactors (PRs #279/#265: gateline rename execution; #271/#133: frontend → packages hoisting); 25 feature PRs (#289, #288, #287, #286, #278, #277, #276, #275, #274, #272, #266, #263, #262, #247, #245, etc.); no new runs merged in this interval.

## Drift found

| # | Surface | Drift | Evidence | Disposition |
|---|---------|-------|----------|-------------|
| none | — | — | — | — |

## Applied changes

None. All documentation surfaces were correctly updated for the gateline rename (PR #279) and frontend → packages restructuring (PR #271). No drift between artifacts and documentation.

## Proposed actions

None.

## Escalations

None.

## Surfaces checked, no drift

- `AGENTS.md` status section — correctly documents three human-orchestrated runs (wordfreq, mdtoc, dupefind) and three orchestrator-driven runs (creation-seam, web-staging, fleetview-design).
- `docs/DESIGN.md` status — consistent with AGENTS.md; references `packages/` correctly.
- `docs/FRONTEND.md` — content current; refers to Gatehouse by name (the frontend UI).
- `docs/FRONTEND-PLAN.md` — implementation plan correctly names `packages/` as the home (line 22).
- `docs/TOPOLOGY.md` — topology design current; refers to Gatehouse and framework correctly.
- `docs/DEPLOY.md` — hosting guide accurate; no outdated paths.
- `docs/ORCHESTRATOR.md` — design current; historical notes about `frontend/` in pre-rename checkouts (lines 458, 624) are accurate context for backwards-compatibility in the upgrade path, not directives.
- `docs/INTEGRATION.md` — integration workflow current; vendor copy and lockfile mechanisms unchanged.
- `docs/WALKTHROUGH.md` — toy pipeline walkthrough; no references to old directory structure.
- `README.md` — repo overview updated for `packages/` structure; repo map table current.
- `packages/README.md` — gate frontend overview current (product name correct, no path confusion).
- `packages/orchestrator/README.md` — orchestrator runbook correctly uses @gateline/orchestrator package naming.
- `runs/README.md` — run directory layout unchanged; historical notes about FleetView/ADS names in old runs correctly preserved as record convention.
- `contracts/docs-delta.md` — contract itself current.
- `contracts/release-plan.md` — new contract (PR #288/#260) added; well-formed; G3 artifact template current.
- All other `contracts/` templates (`state.yaml`, `spec.md`, `plan.md`, `tasks.yaml`, review/verification reports, etc.) — current.
- `roles/*.md` — no references to renamed components or old paths.
- `registry/models.yaml` — model registry current; cost estimates and bindings unchanged.
- Adapter manifests (`adapters/*/manifest.json`) — not hand-edited; updated by `render-agents.py` on merge.
- Rendered agents (`.claude/agents/`, `.github/agents/`, `.opencode/agents/`) — verified current per CI render-check.
- `NOTICE.md`, `LICENSE.md` — static; no changes needed.
- No TODO/FIXME/XXX markers in main documentation surfaces.
- No consumer-specific repository references in any documentation surface.
- No references to retired names (FleetView, ADS) outside historical records (`runs/`).
