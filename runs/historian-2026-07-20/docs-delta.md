# Docs Delta: historian-2026-07-20

**Interval covered:** 2026-07-12T04:00:00.000Z → 2026-07-20T15:04:55.843Z
**Evidence swept:** runs merged (mdtoc, dupefind), PRs #105 (#116, #113, #111, #108, #98, #102, #101); docs/ORCHESTRATOR.md updated (approve-and-hold, AGENTS.md reference); new doc docs/TOPOLOGY.md added; CLAUDE.md split into thin import + runner-neutral AGENTS.md; three complete G0→G3 pipeline runs now landed on main (wordfreq, mdtoc, dupefind) with shadow-agreement evidence complete.

## Drift found

| # | Surface | Drift | Evidence | Disposition |
|---|---------|-------|----------|-------------|
| 1 | README.md repo map | Missing entry for docs/TOPOLOGY.md, added 2026-07-15 as part of control-plane topology design | commit f95b69d (#105); docs/TOPOLOGY.md exists | applied |
| 2 | README.md Status section | Claims "design exercised end-to-end by the wordfreq run" and "Next: finish the v1 trust ladder's exit evidence (shadow-agreement runs...)" — now three full G0→G3 runs landed (wordfreq, mdtoc, dupefind) with shadow-agreement evidence complete; next steps should reflect topology-in-progress | runs/mdtoc/, runs/dupefind/ merged; AGENTS.md correctly states three runs; commit c306d01 (shadow replay 3/3) | applied |
| 3 | docs/DESIGN.md header status | Claims "exercised end-to-end by the wordfreq run" — same as drift #2 | same evidence as #2 | applied |

## Applied changes

- `README.md` — repo map row added for docs/TOPOLOGY.md (row 1); Status section rewritten to reflect three complete runs and shadow-agreement evidence complete, topology in progress (row 2).
- `docs/DESIGN.md` — header status updated from "wordfreq run" to "three full G0→G3 runs (wordfreq, mdtoc, dupefind)" (row 3).

## Proposed actions

None. All drift was in documentation surfaces the Historian may edit directly.

## Escalations

None. All drift was surface-level status/repo-map updates; framework changes (roles, contracts, registry, adapters) are current.

## Surfaces checked, no drift

- `docs/TOPOLOGY.md` — new file, content correct (control-plane topology design, one authority per deployment, origin as linearization point; #105).
- `CLAUDE.md` — correctly refactored as thin import of AGENTS.md (runner-neutral guidance moved to AGENTS.md per #116).
- `AGENTS.md` — newly created, status correctly states "three full G0→G3 runs" and "shadow-agreement evidence for the v1 trust ladder" (per #116).
- `docs/ORCHESTRATOR.md` — updated with approve-and-hold feature (#98) and AGENTS.md convention reference (per #116 refactor); status v0.3 with M0–M4 implementation correct.
- `docs/FRONTEND.md` — header status v0.2, describes local-first build and staging logic; current.
- `docs/INTEGRATION.md` — header status v0.2, describes field evidence integration and adversarial review; current.
- `docs/WALKTHROUGH.md` — v0 walkthrough using wordfreq toy task; example/tutorial, not status-bearing.
- `docs/DEPLOY.md` — FleetView single-user deployment recipe; unchanged, current.
- `frontend/README.md`, `frontend/packages/orchestrator/README.md` — no version/status claiming outdated evidence; current.
- `roles/*`, `contracts/*`, `registry/models.yaml`, adapter manifests, rendered agents (`.claude/agents/`, `.github/agents/`) — consistent with each other and with the render check.
- `NOTICE.md`, `LICENSE.md` — unchanged.
- No consumer-specific references found anywhere in the repo.
