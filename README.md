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
| [`roles/`](roles/) | Runtime-neutral role specs (mission, instructions, escalation triggers) | ✅ core |
| [`contracts/`](contracts/) | Templates for every handoff artifact (spec, plan, task, reports, state) | ✅ core |
| [`registry/models.yaml`](registry/models.yaml) | The only place vendor/model IDs exist; roles bind via capability profiles | ✅ core |
| [`adapters/claude-code/`](adapters/claude-code/) | First runtime binding: role specs → `.claude/agents/` subagents | per-runtime |
| [`.claude/agents/`](.claude/agents/) | The rendered subagents (runnable in Claude Code today) | per-runtime |
| [`runs/`](runs/) | One directory per pipeline run — the pipeline state lives in git | working area |

## The one idea

Agents never share a conversation; they share **typed artifacts in git**. A role
consumes files, produces files, and a human approves at four gates (spec, plan,
change, release). Because roles are contracts over files, any agent can be replaced
mid-run, models swap via a one-file registry edit, and new runtimes attach by writing
a thin adapter — which is how the cross-vendor requirement and "flexibility over
customizability" are both satisfied by the same mechanism.

## Status

v0.1 — design drafted, Claude Code adapter built, unexercised. Next: team review of
DESIGN.md, then a toy run per the walkthrough, then the `redacted` pilot plan
(CLAUDE.md Future Consideration #2).
