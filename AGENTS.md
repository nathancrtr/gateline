# gateline

Guidance for coding agents (and humans) working on this repository. It is
runner-neutral on purpose — the same portability principle the framework itself is
built on: AGENTS.md-native runners read this file directly; Claude Code loads it
through the import in [`CLAUDE.md`](CLAUDE.md).

## Orientation

This repository **is the product**: a runtime-neutral framework of SDLC agent roles
(`roles/`), handoff contracts (`contracts/`), a model registry (`registry/`), thin
runtime adapters (`adapters/`), host-repo integration tooling (`scripts/`), and the
framework's product components under `packages/` — the gate frontend (web, CLI,
server over `@gateline/core`) and the v1 orchestrator
(`packages/orchestrator`), with a hosted single-user deployment recipe
under `deploy/`. Application code under `apps/` is the output of pipeline runs, kept
as evidence — not software being maintained for its own sake.

**Names.** The framework and this repository are **gateline**; the web UI is
**Gatehouse**. Two earlier names are retired and must not be reintroduced:
*FleetView* (never a decided name) and *ADS* / *Agentic Development System*. Both
still appear inside `runs/` — those are historical records and stay as written.
Lowercase `gate` remains the domain term for a pipeline approval point, and is
unrelated to the UI's name. The rename is fully executed: the repository is
`nathancrtr/gateline`, the CLI commands are `gateline` / `gateline-orchestrator`,
the packages are `@gateline/*`, and the vendored prefix is `.gateline/`. The
legacy `agentic` identifiers are retired with the old names and appear only in
`runs/` and other historical records.

Read [`docs/DESIGN.md`](docs/DESIGN.md) before changing the framework: it defines the
principles (P1–P6), roles, gates, and failure modes that changes are judged against.
Then, by area:

* [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) — driving the pipeline in v0
  (human-orchestrated) mode; [`runs/README.md`](runs/README.md) — run directory layout
* [`docs/ORCHESTRATOR.md`](docs/ORCHESTRATOR.md) — the v1 agent-orchestrated mode
  (runbook in `packages/orchestrator/README.md`)
* [`docs/FRONTEND.md`](docs/FRONTEND.md) — the gate frontend design
  (plan: [`docs/FRONTEND-PLAN.md`](docs/FRONTEND-PLAN.md))
* [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — importing the framework into a host
  repo (plan: [`docs/INTEGRATION-PLAN.md`](docs/INTEGRATION-PLAN.md))
* [`docs/TOPOLOGY.md`](docs/TOPOLOGY.md) — control-plane topology: one authority per
  deployment, origin as the linearization point, and how to trial unmerged changes
  without disturbing the blessed checkout
* [`docs/DEPLOY.md`](docs/DEPLOY.md) — hosting the frontend (and, opt-in, the
  orchestrator) as a single-user instance; read its security model first

Status: v0.2 — the design has been exercised end-to-end by three human-orchestrated
G0→G3 runs (`runs/wordfreq/`, `runs/mdtoc/`, `runs/dupefind/` — the
shadow-agreement evidence for the v1 trust ladder), and since then by
orchestrator-driven runs against the framework itself (`runs/creation-seam/`,
`runs/web-staging/`, `runs/fleetview-design/`); retro findings feed back into roles,
contracts, and adapters. Runs declare a **profile** — `patch | standard | full`
(DESIGN.md §4.1) — scaling which roles run and which gates exist to the size of the
change; a run whose `state.yaml` carries no `profile:` is `full`. Three runner
adapters are built: `claude-code`, `copilot-cli`, and `opencode` (the any-provider
one). The gate frontend (Gatehouse) and the v1 orchestrator are implemented and
co-located by design — `gateline up` runs both over a single clone, which is the
blessed topology; the hosted recipe under `deploy/` remains a documented self-host
option. Integration tooling v0 (`scripts/integrate.py`) ships `init|validate|fork`.
Autonomy remains gated on the DESIGN.md §7 promotion criterion.

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
  `contracts/` is never a pipeline outcome. The rationale, the
  evidence-position/production-role distinction, and the adopter extension rule
  ("open table, closed gates") are recorded in DESIGN.md §4.2.
* **`scripts/render-agents.py` and `scripts/integrate.py` stay stdlib-only and
  Python 3.11-compatible** (JSON manifests, no third-party imports) so they run on
  any operator's machine — including before the environment probe has fixed
  anything (INTEGRATION.md §8).
* **A new portable core file must be added to `scripts/copy-manifest.json`**, or
  releases never offer it to host repos. `python3 scripts/integrate.py validate`
  re-proves the static integration invariants.
* **Contracts specify required sections, concision budgets, normative grammar, and
  each section's audience.** An artifact missing a required section is malformed —
  consuming agents bounce it, never guess. A contract's `AUDIENCE:` line names the
  sections that are audit-time evidence rather than decide-time reading; Gatehouse
  folds those to their heading, and the line is contract meaning, not a UI
  setting. Two rule families are equally normative and equally bounceable: the
  **ID/heading grammar** tooling parses (`### R<n> — <name>`, criteria beginning
  `AC<n>.<m> — `) and the **READABILITY rules** on human-facing sections (plain-words
  opening sentence, one idea per paragraph, lists instead of semicolon chains, name
  before cite). Breaches are bounced with the rule cited.
* **Run profiles are fixed sets, not knobs.** There is no per-run role or gate
  toggle; if a profile doesn't fit, pick the next heavier one. Profile upgrades are
  one-way and human-decided (a human edits `profile:` and resumes — the reconciler
  derives the backfill); downgrading mid-run is forbidden, and an engine that
  observes a profile lighter than the gates already decided escalates.
* **One authority per deployment, and the blessed checkout stays on the default
  branch** (TOPOLOGY.md §3.1, §3.5). Never point a second writable clone's engine at
  the same runs, and never move the checkout the global `gateline` resolves to onto a
  branch — an engine there would put unreviewed code in charge of live, metered
  dispatch. The code-tree monitor enforces this: a checkout that leaves the default
  branch, goes dirty, or moves by anything but a fast-forward pauses dispatch until
  it is clean and back on the default branch (a clean fast-forward instead exits the
  engine `75` to be restarted on the new code). Trial an unmerged frontend change
  from that branch's own worktree with `ui`, never `up`.
* **Completed runs are historical records, and `run/*` branches are test
  fixtures.** Do not retro-edit artifacts under `runs/<slug>/` for a finished run —
  fold new lessons into roles, contracts, or docs — and do not delete or rewrite
  `run/*` branches: frontend CI checks out full history, and the core/shadow tests
  walk finished runs.
* **The orchestrator never writes `gates.*` or `closure`.** Gate entries, the run's
  closure record, and the human decision grammar (`G<N> approved by <name>`,
  `closed by <name>`) are reserved for named humans; the
  orchestrator commits under its own bot identity and verbs
  (`dispatched | bounced | advanced | escalated | paused | metered | harvested`).
  Anything touching `state.yaml` follows the co-writer contract: compare-and-swap
  ref updates, comment-preserving YAML, ISO-8601 timestamps.
* **Never run a live orchestrator `tick`/`watch` against this repository as a
  test.** It dispatches real, metered agents onto live `run/*` branches. Verify
  with the test suites, `tick --dry-run`, or `shadow` replays of finished runs.
* **Instance-specific config and secrets stay uncommitted.** `fly.toml` (copy
  `deploy/fly.example.toml`; see DEPLOY.md) and `.env` (local provider API keys) are
  gitignored by design — never commit either. `orchestrator.yaml` is the opposite
  case: committed project policy (sweep schedules), read by the orchestrator at the
  default-branch tip.

## Commands

* Re-render adapter agent files after any `roles/` or manifest change:
  `python3 scripts/render-agents.py` (verify with `--check` — the same check CI runs)
* Run the frontend/orchestrator tests: `npm test` in `packages/` (typecheck:
  `npm run typecheck`; e2e: `npm run build && npx playwright test`; needs
  `npm install` once, Node ≥ 24)
* Drive the local instance with the `gateline` CLI (`packages/cli`, run from
  source — `node packages/cli/src/main.ts <cmd>` in any tree *is* that tree's
  `gateline`):
  * inspect — `status`, `inbox`, `show <slug> [artifact]`
  * decide — `approve`, `decline`, `resolve-escalation`, `pause`, `resume`, `sync`
  * end a run short of `done` — `close <slug> --as <disposition> --reason <text>`
    (`already-delivered | superseded | obsolete | abandoned`); `reopen` undoes it
  * create a run — `new` stages `runs/<slug>/` on its branch; `arm <slug>` starts it
  * serve — `up [--repo <path>]` (Gatehouse + engine over one clone, the blessed
    topology), `ui` (viewer only), `upgrade` (pull + rebuild the web dist, then let
    the running engine self-supersede)
* Verify the orchestrator without dispatching: `gateline-orchestrator tick --dry-run`
  or `shadow <slug>` (replay a finished run); `watch` and `sweep <role>` are live
* Try unmerged frontend changes: from that branch's worktree, `npm install &&
  npm run build` in `packages/`, then `node packages/cli/src/main.ts ui --demo`
  (or `--repo <path>`)
  on a side port — never check the branch out in the blessed main checkout, and never
  `up` from a trial tree (TOPOLOGY.md §3.5). Web-only changes can use
  `npm run dev -w @gateline/web` instead
* Run the tests for pipeline-run output: `pytest apps/<app>` — one app per
  invocation (`wordfreq`, `mdtoc`, `dupefind`); the apps' identically named test
  modules collide when pytest collects `apps/` in one pass
* Run the integration-tooling tests: `pytest scripts/test_integrate.py`
* Integrate the framework into a host repo:
  `python3 scripts/integrate.py init|validate|fork` (see INTEGRATION.md)
* CI: `render-check` (stale renders), `packages-ci` (lockfile platform check,
  typecheck, vitest, build, Playwright e2e), `deploy-image` (Docker build + container smoke test; triggered
  by `deploy/**` or `packages/**` changes)

## Conventions

* Pipeline runs live in `runs/<slug>/` on branch `run/<slug>`; artifacts are committed
  as they are produced. Gate approvals in a run's `state.yaml` are written only by the
  named human approver — agents never self-approve a gate.
* A run is created in two steps: `gateline new` stages the record (branch,
  `intent-brief.md`, `state.yaml`) for human review, and `arm` is what makes it
  dispatchable — a staged run is inert, and arming is also what ensures its draft
  PR. That PR's title and description are generated from the run's own artifacts
  (the intent brief, then the spec once it lands) and refresh as the run
  progresses — until a human edits the body, which hands the description to them
  for good. The PR stays a draft, carrying a "do not merge" banner, for as long
  as the run is in flight; reaching `done` is what marks it ready for review and
  replaces the banner with the finished record. The profile is chosen in the
  intent brief and recorded as
  `profile:` at init; from then on `state.yaml` is authoritative, and `gates:` carries
  exactly that profile's gates (a gate that doesn't exist is absent, never
  auto-approved).
* Historian sweeps are gate-less mini-runs (`runs/historian-<date>/`, no
  `state.yaml`); merging the sweep branch is the approval, and its `sweep.yaml` on
  the default branch is what makes the next sweep's interval derivable.
* Route framework fixes by kind: agent misbehavior → the role spec (`roles/*.md`,
  then re-render); a malformed or ambiguous handoff → the contract (`contracts/*`);
  a model or vendor change → `registry/models.yaml`; orchestrator behavior →
  `packages/orchestrator` (design: ORCHESTRATOR.md); what a human sees or
  clicks → `packages/{core,server,web,cli}` (design: FRONTEND.md; `core` is
  layered record → sources → view-model, and derivation stays a pure function of
  committed state); integration workflow → `scripts/integrate.py` + the copy manifest
  (design: INTEGRATION.md); deployment posture → TOPOLOGY.md; hosting → `deploy/`
  (recipe: DEPLOY.md); sweep scheduling → `orchestrator.yaml`.
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
