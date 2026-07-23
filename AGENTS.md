# Agentic Software Development: Sandbox

Guidance for coding agents (and humans) working on this repository. It is
runner-neutral on purpose — the same portability principle the framework itself is
built on: AGENTS.md-native runners read this file directly; Claude Code loads it
through the import in [`CLAUDE.md`](CLAUDE.md).

## Orientation

This repository **is the product**: a runtime-neutral framework of SDLC agent roles
(`roles/`), handoff contracts (`contracts/`), a model registry (`registry/`), thin
runtime adapters (`adapters/`), host-repo integration tooling (`scripts/`), and the
framework's product components under `frontend/` — the gate frontend (web, CLI,
server over `@agentic/core`) and the v1 orchestrator
(`frontend/packages/orchestrator`), with a hosted single-user deployment recipe
under `deploy/`. Application code under `apps/` is the output of pipeline runs, kept
as evidence — not software being maintained for its own sake.

Read [`docs/DESIGN.md`](docs/DESIGN.md) before changing the framework: it defines the
principles (P1–P6), roles, gates, and failure modes that changes are judged against.
Then, by area:

* [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) — driving the pipeline in v0
  (human-orchestrated) mode; [`runs/README.md`](runs/README.md) — run directory layout
* [`docs/ORCHESTRATOR.md`](docs/ORCHESTRATOR.md) — the v1 agent-orchestrated mode
  (runbook in `frontend/packages/orchestrator/README.md`)
* [`docs/FRONTEND.md`](docs/FRONTEND.md) — the gate frontend design
  (plan: [`docs/FRONTEND-PLAN.md`](docs/FRONTEND-PLAN.md))
* [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — importing the framework into a host
  repo (plan: [`docs/INTEGRATION-PLAN.md`](docs/INTEGRATION-PLAN.md))
* [`docs/DEPLOY.md`](docs/DEPLOY.md) — hosting the frontend (and, opt-in, the
  orchestrator) as a single-user instance; read its security model first

Status: v0.2 — the design has been exercised end-to-end by three full G0→G3 runs
(`runs/wordfreq/`, `runs/mdtoc/`, `runs/dupefind/` — the shadow-agreement evidence
for the v1 trust ladder); retro findings feed back into roles, contracts, and
adapters. The gate frontend and v1 orchestrator are implemented; hosted deployment
is documented, with orchestrator dispatch as an opt-in second process under hard
spend/push ceilings. Integration tooling v0 (`scripts/integrate.py`) ships
`init|validate|fork`. Autonomy remains gated on the DESIGN.md §7 promotion
criterion.

## Invariants — check before editing

* **`.claude/agents/`, `.github/agents/`, and `.opencode/agents/` are rendered
  files; never hand-edit them.** Edit the source role spec (`roles/<role>.md`) or the adapter's
  `manifest.json`, then run `python3 scripts/render-agents.py`. CI
  (`.github/workflows/render-check.yml`) fails any PR with stale renders.
* **No vendor or model name may appear in `roles/` or `contracts/`** (principle P2).
  Concrete model IDs live only in `registry/models.yaml`; changing a binding there
  also means updating each adapter's `manifest.json` and re-rendering.
* **Adapters may narrow a role (fewer tools, tighter permissions) but never widen
  it.** The role spec is the ceiling.
* **The role set is closed.** The roles under `roles/` are the complete SDLC set;
  do not add a new role — or its contract, registry binding, adapter entry, or
  render — without an explicit maintainer decision recorded in an issue first. A
  run may prototype an extension role inside its own `runs/<slug>/` record, but
  that record is evidence, not a merge path: generalizing into `roles/` or
  `contracts/` is never a pipeline outcome.
* **`scripts/render-agents.py` and `scripts/integrate.py` stay stdlib-only and
  Python 3.9-compatible** (JSON manifests, no PEP 604 annotations) so they run on
  any operator's machine — including before the environment probe has fixed
  anything (INTEGRATION.md §8).
* **A new portable core file must be added to `scripts/copy-manifest.json`**, or
  releases never offer it to host repos. `python3 scripts/integrate.py validate`
  re-proves the static integration invariants.
* **Contracts specify required sections and concision budgets.** An artifact missing
  a required section is malformed — consuming agents bounce it, never guess.
* **Completed runs are historical records, and `run/*` branches are test
  fixtures.** Do not retro-edit artifacts under `runs/<slug>/` for a finished run —
  fold new lessons into roles, contracts, or docs — and do not delete or rewrite
  `run/*` branches: frontend CI checks out full history, and the core/shadow tests
  walk finished runs.
* **The orchestrator never writes `gates.*`.** Gate entries and the human decision
  grammar (`G<N> approved by <name>`) are reserved for named humans; the
  orchestrator commits under its own bot identity and verbs
  (`dispatched | bounced | advanced | escalated | paused | metered | harvested`).
  Anything touching `state.yaml` follows the co-writer contract: compare-and-swap
  ref updates, comment-preserving YAML, ISO-8601 timestamps.
* **Never run a live orchestrator `tick`/`watch` against this repository as a
  test.** It dispatches real, metered agents onto live `run/*` branches. Verify
  with the test suites, `tick --dry-run`, or `shadow` replays of finished runs.
* **Instance-specific deploy config stays uncommitted.** `fly.toml` is gitignored
  by design (copy `deploy/fly.example.toml`; see DEPLOY.md) — never commit it.
  `orchestrator.yaml` is the opposite case: committed project policy (sweep
  schedules), read by the orchestrator at the default-branch tip.

## Commands

* Re-render adapter agent files after any `roles/` or manifest change:
  `python3 scripts/render-agents.py` (verify with `--check` — the same check CI runs)
* Run the frontend/orchestrator tests: `npm test` in `frontend/` (typecheck:
  `npm run typecheck`; e2e: `npm run build && npx playwright test`; needs
  `npm install` once, Node ≥ 24)
* Try unmerged frontend changes: from that branch's worktree, `npm run build`
  then `node packages/cli/src/main.ts ui --demo` (or `--repo <path>`) on a side
  port — never check the branch out in the blessed main checkout, and never
  `up` from a trial tree (TOPOLOGY.md §3.5)
* Run the tests for pipeline-run output: `pytest apps/<app>` — one app per
  invocation (`wordfreq`, `mdtoc`, `dupefind`); the apps' identically named test
  modules collide when pytest collects `apps/` in one pass
* Run the integration-tooling tests: `pytest scripts/test_integrate.py`
* Integrate the framework into a host repo:
  `python3 scripts/integrate.py init|validate|fork` (see INTEGRATION.md)
* CI: `render-check` (stale renders), `frontend-ci` (typecheck, vitest, build,
  Playwright e2e), `deploy-image` (Docker build + container smoke test; triggered
  by `deploy/**` or `frontend/**` changes)

## Conventions

* Pipeline runs live in `runs/<slug>/` on branch `run/<slug>`; artifacts are committed
  as they are produced. Gate approvals in a run's `state.yaml` are written only by the
  named human approver — agents never self-approve a gate.
* Historian sweeps are gate-less mini-runs (`runs/historian-<date>/`, no
  `state.yaml`); merging the sweep branch is the approval, and its `sweep.yaml` on
  the default branch is what makes the next sweep's interval derivable.
* Route framework fixes by kind: agent misbehavior → the role spec (`roles/*.md`,
  then re-render); a malformed or ambiguous handoff → the contract (`contracts/*`);
  a model or vendor change → `registry/models.yaml`; orchestrator behavior →
  `frontend/packages/orchestrator` (design: ORCHESTRATOR.md); integration workflow →
  `scripts/integrate.py` + the copy manifest (design: INTEGRATION.md); hosting →
  `deploy/` (recipe: DEPLOY.md); sweep scheduling → `orchestrator.yaml`.
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
