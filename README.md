# gateline

Run the software development lifecycle as a team of agents that hand off
**typed artifacts in git, not chat** — roles defined as portable contracts,
models and runtimes attached as swappable bindings, and a human approving at
each phase gate from a cockpit that reads nothing but the repository. Built for
senior engineers moving from single-conversation AI pair-programming to
multi-agent development.

![Gatehouse, the cockpit: the decision inbox, the portfolio's gate ledger, a run paused on an escalation, a finished run's artifact record, and the metrics computed from state history](docs/images/gatehouse.gif)

## Why it is built this way

- **Agents never share a conversation.** A role consumes files and produces
  files — spec, plan, tasks, reviews, evidence — validated against contracts
  the host repo owns. Any agent can be replaced mid-run; models swap in a
  one-file registry; a new runtime is a thin adapter over the same role specs.
- **The repo is the only database.** Every view in the cockpit is recomputed
  from git; delete the app and nothing is lost. There is exactly one write
  path — a compare-and-swap commit to one run's `state.yaml` — and a malformed
  packet never renders as approvable, in the web, the CLI or the API.
- **Humans decide at gates, and only at gates.** Up to four (spec, plan,
  change, release) depending on the run's profile, plus escalations. The
  frontend does not dispatch, steer or chat; the harness you already use is
  the cockpit for that.
- **Money is metered per run.** No cost ceiling, no dispatch; every run shows
  what it has spent against its limit, and a run that crosses it says so.
- **The gates measure themselves.** Approval rates, burden mix and review
  rounds are computed from the state history, and a gate that approves
  everything is flagged as over-triggering — the signal to move its scope down
  the tier ladder.

<p align="center">
  <img src="docs/images/portfolio.png" alt="The portfolio: every run's progress through its gates, recomputed live from its branch" width="49%">
  <img src="docs/images/run-escalation.png" alt="A run page: the phase spine, the task board, the budget, and an escalation waiting for a human" width="49%">
</p>

**Start here → [`docs/DESIGN.md`](docs/DESIGN.md)** · then run the toy pipeline:
[`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)

The screenshots show this repository's own run history — gateline develops
itself through its own gates. They were captured with no orchestrator
running, so the cockpit's "not running" banner is hidden in them.

## Repo map

| Path | What it is | Portable? |
|------|-----------|-----------|
| [`docs/DESIGN.md`](docs/DESIGN.md) | The architecture: principles, roles, gates, failure modes | — |
| [`docs/TOPOLOGY.md`](docs/TOPOLOGY.md) | Control-plane topology: one authority per deployment, origin as linearization point | — |
| [`docs/FRONTEND.md`](docs/FRONTEND.md) | Design for the gate frontend — the human interfaces to the pipeline (plan: [FRONTEND-PLAN.md](docs/FRONTEND-PLAN.md)) | — |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | Design (draft) for the workflow that imports the framework into a host repo | — |
| [`docs/ORCHESTRATOR.md`](docs/ORCHESTRATOR.md) | Design for the v1 agent-orchestrated operating mode (implemented in `packages/orchestrator`) | — |
| [`packages/`](packages/) | The gate frontend (web, CLI, server over `@gateline/core`) and the v1 orchestrator (`packages/orchestrator`) | product component |
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
consumes files, produces files, and a human approves at up to four gates (spec, plan,
change, release — how many depends on the run's profile). Because roles are contracts
over files, any agent can be replaced mid-run, models swap via a one-file registry
edit, and new runtimes attach by writing a thin adapter — which is how the
cross-vendor requirement and "flexibility over customizability" are both satisfied by
the same mechanism.

## Setup

The shortest path from nothing to a working install: vendor the framework into a
host repo with `integrate.py`, then run the cockpit over it with `gateline up`.
Every step below is rehearsed against the current tree. No tagged release exists
yet, so the source is a clone of `main`; once the first release tags, a pinned
release replaces the clone as the canonical source
([INTEGRATION.md §3](docs/INTEGRATION.md)).

**Prerequisites:** `git`; Python ≥ 3.9 (stdlib only — the integration tool has no
dependencies); Node ≥ 24 for the cockpit; and an agent runner logged in on your
machine (Claude Code in the examples — the Copilot CLI and opencode adapters
render the same agents).

### 1. Install

```sh
git clone https://github.com/nathancrtr/gateline.git
cd gateline/packages
npm install && npm run build      # builds the Gatehouse SPA once
(cd cli && npm link)              # global `gateline`, linked to this checkout
```

The linked CLI runs from this tree — keep the checkout on `main` (it is the
operator's instrument, not something the host repo depends on).

### 2. Integrate into an existing codebase

```sh
python3 <checkout>/scripts/integrate.py init ~/repos/my-app --provenance private
```

One command: it detects the runners present in the host, vendors the portable
core under `.gateline/`, seeds the model registry and policy overlays, renders
the agents, and writes the lockfile. `--provenance` has no default on purpose —
state the host's posture: `private` for a closed host, `redistribute` for an
open-source one.

`init` prints the one dispatch that remains: open your runner in the host repo
and ask it to *use the integrator subagent for run `runs/000-integration`,
producing `integration-profile.md` per `contracts/integration-profile.md`*.
Review what it produces — the environment probe and the drafted overlays are
exactly the "how should agents behave in this house" decision (gate GI) — then
prove the result:

```sh
cd ~/repos/my-app
python3 .gateline/scripts/integrate.py validate   # checksums, renders, provenance
```

### 3. Spin up

Two things gate real dispatch: bind real model IDs in
`.gateline/registry/models.yaml` (the seeded values are illustrative
placeholders), and give each run a `budget.cost_limit_usd` — no ceiling, no
dispatch. Then:

```sh
gateline up --repo ~/repos/my-app --spend-limit-usd 20
```

That serves Gatehouse on `127.0.0.1:4310` and runs the orchestrator engine over
the same clone — dispatch bills through whatever harness CLI is logged in
locally, orchestrator commits push to origin by default (`--no-push` to keep
them local), and gates remain named-human decisions in the UI or via
`gateline approve`. To look before anything dispatches:
`gateline status --repo ~/repos/my-app` renders the same state read-only.

The browser is optional. The whole gate workflow is terminal-native —
`gateline inbox`, `approve`, `decline`, `resolve-escalation` — and the engine
runs headless without Gatehouse: `gateline-orchestrator watch` (resident) or
`tick` (one reconcile pass, with `--dry-run` to derive and print next actions
while writing and dispatching nothing). Common terminal workflows and their
pitfalls: [`packages/cli/README.md`](packages/cli/README.md).

Before the first real dispatch, read [ORCHESTRATOR.md §10](docs/ORCHESTRATOR.md)
(the autonomy ladder — first live work is a toy run with humans at every gate).
To drive the pipeline by hand instead — no Node, no orchestrator, just the
rendered agents and git — start at [WALKTHROUGH.md](docs/WALKTHROUGH.md).
[INTEGRATION.md](docs/INTEGRATION.md) has the knobs this section skips
(`--take` partial adoption, `--layout root`, forks and upgrades);
[DEPLOY.md](docs/DEPLOY.md) hosts the same pair on a single-user instance.

## Status

v0.2 — the design has been exercised end-to-end by three human-orchestrated G0→G3
runs (`runs/wordfreq/`, `runs/mdtoc/`, `runs/dupefind/`, each with adversarial review
cycles and independent verification — the shadow-agreement evidence for the v1 trust
ladder), and since then by orchestrator-driven runs against this repository itself;
retro findings fold back into roles, contracts, and all three adapters. Runs now
declare a **profile** — `patch | standard | full` ([DESIGN.md](docs/DESIGN.md) §4.1)
— that scales which roles run and which gates exist to the size of the change, so a
bug fix no longer pays for the full ceremony. The gate frontend (web, CLI, server)
and the v1 orchestrator are implemented in `packages/` and run as one co-located unit
(`gateline up`) over a single clone — one authority per deployment
([TOPOLOGY.md](docs/TOPOLOGY.md)); a single-user hosting recipe lives in
[`deploy/`](deploy/). Autonomy stays gated on the DESIGN.md §7 promotion criterion.
Next: live cross-vendor dispatch, then the integration workflow
([INTEGRATION.md](docs/INTEGRATION.md)) and a first tagged release.

## License

Copyright © 2026 Nathan Carter. Licensed under the [Apache License 2.0](LICENSE.md);
see [NOTICE.md](NOTICE.md) for provenance.
