# Agentic Development System

A design + runnable skeleton for a team of SDLC agents: roles defined as portable
contracts, models and runtimes attached as swappable bindings, humans approving at
phase gates. Built for a team of senior engineers moving from single-conversation AI
pair-programming to multi-agent development.

**Start here → [`docs/DESIGN.md`](docs/DESIGN.md)** · then run the toy pipeline:
[`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)

## Repo map

| Path | What it is | Portable? |
|------|-----------|-----------|
| [`docs/DESIGN.md`](docs/DESIGN.md) | The architecture: principles, roles, gates, failure modes | — |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | Design for the gate frontend — the human interfaces to the pipeline (plan: [FRONTEND-PLAN.md](docs/FRONTEND-PLAN.md)) | — |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | Design (draft) for the workflow that imports the framework into a host repo | — |
| [`docs/ORCHESTRATOR.md`](docs/ORCHESTRATOR.md) | Design for the v1 agent-orchestrated operating mode (implemented in `frontend/packages/orchestrator`) | — |
| [`frontend/`](frontend/) | The gate frontend (web, CLI, server over `@agentic/core`) and the v1 orchestrator (`packages/orchestrator`) | product component |
| [`roles/`](roles/) | Runtime-neutral role specs (mission, instructions, escalation triggers) | ✅ core |
| [`contracts/`](contracts/) | Templates for every handoff artifact (spec, plan, task, reports, state) | ✅ core |
| [`registry/models.yaml`](registry/models.yaml) | The only place vendor/model IDs exist; roles bind via capability profiles | ✅ core |
| [`scripts/render-agents.py`](scripts/render-agents.py) | Renders every adapter's agent files from `roles/` + each adapter's `manifest.json`; CI-checked | ✅ core |
| [`adapters/claude-code/`](adapters/claude-code/) | First runtime binding: role specs → `.claude/agents/` subagents | per-runtime |
| [`.claude/agents/`](.claude/agents/) | The rendered subagents (runnable in Claude Code today) | per-runtime |
| [`adapters/copilot-cli/`](adapters/copilot-cli/) | Second runtime binding: role specs → `.github/agents/*.agent.md` custom agents | per-runtime |
| [`.github/agents/`](.github/agents/) | The rendered custom agents (runnable in Copilot CLI today) | per-runtime |
| [`adapters/opencode/`](adapters/opencode/) | Third runtime binding: role specs → `.opencode/agents/*.md` agents | per-runtime |
| [`.opencode/agents/`](.opencode/agents/) | The rendered opencode agents (any-provider model bindings) | per-runtime |
| [`runs/`](runs/) | One directory per pipeline run — the pipeline state lives in git | working area |

## The one idea

Agents never share a conversation; they share **typed artifacts in git**. A role
consumes files, produces files, and a human approves at four gates (spec, plan,
change, release). Because roles are contracts over files, any agent can be replaced
mid-run, models swap via a one-file registry edit, and new runtimes attach by writing
a thin adapter — which is how the cross-vendor requirement and "flexibility over
customizability" are both satisfied by the same mechanism.

## Status

v0.2 — design exercised end-to-end by the wordfreq run (`runs/wordfreq/`, G0→G3 with
two adversarial-review cycles and independent verification); retro findings folded
back into roles, contracts, and both adapters. The gate frontend (web, CLI, server)
and the v1 orchestrator are implemented in `frontend/`; autonomy stays gated on the
DESIGN.md §7 promotion criterion. Next: finish the v1 trust ladder's exit evidence
(shadow-agreement runs, live cross-vendor dispatch), then the integration workflow
(docs/INTEGRATION.md) and a first tagged release.

## License

Copyright © 2026 Nathan Carter. Licensed under the [Apache License 2.0](LICENSE.md);
see [NOTICE.md](NOTICE.md) for provenance.
