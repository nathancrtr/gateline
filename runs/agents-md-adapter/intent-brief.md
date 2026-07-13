# Intent Brief: agents-md-adapter — AGENTS.md render target

<!-- Drafted by the v0 orchestrator delegate from issue #80; the G0 human
     vetoes or amends here. -->

## Problem
Role specs render to two runtime-specific agent-definition dialects
(`.claude/agents/`, `.github/agents/`). The ecosystem has meanwhile converged
on AGENTS.md (agents.md, stewarded by the Agentic AI Foundation) as a broadly
read agent-definition and repo-context convention. A team on any
AGENTS.md-reading runtime we lack an adapter for currently gets nothing from
`roles/` without authoring a full adapter themselves.

## Motivation
Adoption cost: meeting runtimes at the convention they already read is the
cheapest possible on-ramp to the role system, and issue #80 (epic #79,
standards interop) names this the first boundary to cover. Process: this is
the first run gated end-to-end through the gate frontend rather than
hand-edited state — treat any friction in that flow as a finding, not an
annoyance to route around.

## Constraints
One new adapter under `adapters/` with a `manifest.json` consumed by
`scripts/render-agents.py`; the renderer stays stdlib-only and
Python 3.9-compatible; role specs and contracts change zero lines (P2/P3);
the adapter may narrow a role but never widen it — where AGENTS.md cannot
enforce a narrowing (no tool-allowlist field), the rendered output must state
the narrowing in prose rather than drop it silently; rendered files carry the
do-not-hand-edit provenance header like the existing two adapters;
`render-agents.py --check` (the CI check) must cover the new render target.
Before committing to an output shape, survey which AGENTS.md dialect real
consumers parse (single root file vs per-agent definition files) and record
the choice with its evidence.

## Out of scope
Orchestrated (headless) dispatch through AGENTS.md-only runtimes — no
`headless` manifest section this run; changes to the existing claude-code or
copilot-cli adapters beyond what manifest-schema reuse requires; a model or
vendor binding field in the rendered output (registry semantics stay in
`registry/models.yaml`); publishing or announcing the adapter.
