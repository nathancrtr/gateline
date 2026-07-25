# Docs Delta: historian-2026-07-25

**Interval covered:** 2026-07-12T04:00:00.000Z → 2026-07-25
**Evidence swept:** PRs #145–#204 (frontend features, orchestrator improvements, adapters, integration tooling); two completed runs merged (creation-seam #172, web-staging #173); fleetview-design in release phase; docs/, README.md, AGENTS.md, all role/contract/registry/adapter sources checked.

## Drift found

| # | Surface | Drift | Evidence | Disposition |
|---|---------|-------|----------|-------------|
| 1 | docs/DESIGN.md header | Status line says "exercised end-to-end by the wordfreq run" but AGENTS.md (updated in PR #187, same interval) documents three human-orchestrated runs (wordfreq/mdtoc/dupefind) plus three orchestrator-driven runs (creation-seam, web-staging, fleetview-design) as the evidence base | AGENTS.md status §1 line 37–41 vs DESIGN.md line 3–4; PRs #172, #173; creation-seam/web-staging `state.yaml` phase=done | applied |

## Applied changes

- `docs/DESIGN.md` header status line (row 1) — aligned with AGENTS.md status phrasing and run catalog to reflect completed orchestrator-driven runs and ongoing fleetview-design.

## Proposed actions

None. No authenticated tracker CLI available; no tracker mutations needed. All mentioned runs are complete or documented; no issues require closure.

## Escalations

None. All drift owned by documentation surfaces; no role spec, contract, or registry changes required.

## Surfaces checked, no drift

- `AGENTS.md` — correctly updated (PR #187) with references to creation-seam, web-staging, and fleetview-design.
- `README.md` — status section correctly uses "orchestrator-driven runs against this repository itself" (compatible with new runs).
- `frontend/README.md` — current; R1–R3 rules and Quickstart accurate.
- `frontend/packages/orchestrator/README.md` — current, including references to capabilities.ts (#182) and harvest-commit.
- `docs/WALKTHROUGH.md` — wordfreq-focused example; no updates needed for completed runs.
- `docs/ORCHESTRATOR.md`, `docs/FRONTEND.md`, `docs/FRONTEND-PLAN.md`, `docs/INTEGRATION.md`, `docs/TOPOLOGY.md` — all current against merged PRs.
- `roles/historian.md` — current (added in previous sweep, #25).
- `contracts/docs-delta.md`, `contracts/state.yaml` — current.
- `registry/models.yaml`, adapter manifests — consistent with merged PRs (#178 opencode, #166 grammar/readability rules).
- Rendered agents (`.claude/agents/`, `.github/agents/`, `.opencode/agents/`) — verified current per CI render check.
- `runs/README.md` — correctly documents run directory structure and historian sweep layout.
- `NOTICE.md`, `LICENSE.md` — current.
- No TODO/FIXME/XXX markers in main documentation surfaces.
- No consumer-specific repository references found.
