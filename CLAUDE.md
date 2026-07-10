# Agentic Software Development: Sandbox

## Orientation

This repository **is the product**: a runtime-neutral framework of SDLC agent roles
(`roles/`), handoff contracts (`contracts/`), a model registry (`registry/`), and thin
runtime adapters (`adapters/`). Application code under `apps/` is the output of
pipeline runs, kept as evidence — not software being maintained for its own sake.

Read [`docs/DESIGN.md`](docs/DESIGN.md) before changing the framework: it defines the
principles (P1–P6), roles, gates, and failure modes that changes are judged against.
[`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) shows how to drive the pipeline in v0
(human-orchestrated) mode, and [`runs/README.md`](runs/README.md) documents the run
directory layout.

Status: v0.2 — the design has been exercised end-to-end by the wordfreq run
(`runs/wordfreq/`, G0→G3); retro findings feed back into roles, contracts, and
adapters.

## Invariants — check before editing

* **`.claude/agents/` and `.github/agents/` are rendered files; never hand-edit
  them.** Edit the source role spec (`roles/<role>.md`) or the adapter's
  `manifest.json`, then run `python3 scripts/render-agents.py`. CI
  (`.github/workflows/render-check.yml`) fails any PR with stale renders.
* **No vendor or model name may appear in `roles/` or `contracts/`** (principle P2).
  Concrete model IDs live only in `registry/models.yaml`; changing a binding there
  also means updating each adapter's `manifest.json` and re-rendering.
* **Adapters may narrow a role (fewer tools, tighter permissions) but never widen
  it.** The role spec is the ceiling.
* **`scripts/render-agents.py` stays stdlib-only and Python 3.9-compatible** (JSON
  manifests, no PEP 604 annotations) so any operator's machine can run it.
* **Contracts specify required sections and concision budgets.** An artifact missing
  a required section is malformed — consuming agents bounce it, never guess.
* **Completed runs are historical records.** Do not retro-edit artifacts under
  `runs/<slug>/` for a finished run; fold new lessons into roles, contracts, or docs
  instead.

## Commands

* Re-render adapter agent files after any `roles/` or manifest change:
  `python3 scripts/render-agents.py` (verify with `--check` — the same check CI runs)
* Run the tests for pipeline-run output: `pytest apps/wordfreq`

## Conventions

* Pipeline runs live in `runs/<slug>/` on branch `run/<slug>`; artifacts are committed
  as they are produced. Gate approvals in a run's `state.yaml` are written only by the
  named human approver — agents never self-approve a gate.
* Route framework fixes by kind: agent misbehavior → the role spec (`roles/*.md`,
  then re-render); a malformed or ambiguous handoff → the contract (`contracts/*`);
  a model or vendor change → `registry/models.yaml`.
* Do not add AI-attribution trailers (e.g. `Co-Authored-By: Claude ...`) to commits.

---

The sections below are the project charter — the brief this work answers to.

## Background

This project develops and maintains an open-source framework for agent-driven
software development: the role specs, handoff contracts, and model/runtime bindings
needed to run the SDLC as a team of semi-autonomous agents with humans approving at
phase gates. It began as a design exploration for a single engineering team and has
matured into a product in its own right (see Project posture below). You are tasked
with expert analysis, design, and implementation in service of that framework.

Its intended adopters are engineers who are already experienced with LLM-based coding
assistants, but mostly within a classic "chatbot" interface — a single-stream,
one-on-one conversation between developer and model. The framework takes that to a
higher level of abstraction wherein multiple agents work more autonomously.

The projects those agents may work on vary across disciplines: a conventional web
app, a distributed service, a CI/CD pipeline, or a high-volume data pipeline are all
possibilities. The framework therefore distills the core roles and operations of the
SDLC into agent roles that adopters can adapt and expand as needed.

## Requirements

* We must be able to use different models for different agents rather than commit to a single model across the swarm
* At this stage, we value flexibility over customizability (see Future Considerations #1)

## Project posture

* This is a fully open-source project (Apache-2.0) with a single maintainer. The repository is private only until the framework settles into a usable state; after that, consumers adopt it via the public repository and/or published package releases.
* Downstream organizations — including any organization the maintainer works with — consume the framework as an ordinary open-source dependency. Assume maintainer-only code authorship; settling a contribution policy (CLA/DCO) is a prerequisite to accepting outside contributors.
* This repository must remain consumer-agnostic: no document, issue, commit, or artifact in it may reference a specific downstream organization.

## Future Considerations

Once we have designed a capable system of software development agents for a single team, there are two main directions that further work could take:

1. **Generalize up the organizational chain**
  a. Consider what it would take to move this up one level of abstraction to be a project maintained at the company or organizational level. What, if any, additional considerations would this entail?

2. **Concrete implementation**
  a. Identify a real production application currently maintained by one of the operators and develop a concrete plan to integrate the agent system into that specific project
    - The specific project is identified by the operators outside this repository
  b. Implement that plan
