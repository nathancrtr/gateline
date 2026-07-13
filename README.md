# Agentic Development System

**Agents never share a conversation. They share typed artifacts in git — and a
named human signs four gates.**

ADS runs the software development lifecycle as a governed team of AI agents:
analyst, architect, implementer, reviewer, verifier, ops. Each role is a
runtime-neutral contract, not a persona — it consumes declared files, produces
declared files, and can be replaced mid-run. An adversarial reviewer and an
independent verifier stand between implementation and merge. The pipeline stops
at four gates — spec, plan, change, release — until a human approves a concrete
artifact, and that approval is data in your repo, not a vibe in a chat window.

Built for teams who have outgrown single-conversation AI pair-programming and
refuse to ship the output of a swarm they cannot audit.

## Get started on your repository

Three commands and one agent dispatch:

```bash
git clone https://github.com/nathancrtr/agentic-sandbox.git ads
python3 ads/scripts/integrate.py init ~/code/my-app --provenance private
# dispatch the Integrator prompt that init printed in your coding agent,
# review the integration profile it produces, then prove the scaffold:
python3 ~/code/my-app/.agentic/scripts/integrate.py validate
```

`init` vendors the role contracts into your repo under `.agentic/`, pins the
framework version in a lockfile, renders agents for the runtimes you already
use (Claude Code and Copilot CLI today), and wires a CI check that keeps the
renders honest. `validate` re-proves the integration invariants any time —
checksums, renders, provenance. Everything that lands in your repo is
stdlib-only Python and markdown; there is nothing to install and no service to
sign up for. Details: [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

Prefer to see it run first? [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) drives
a toy task through the full pipeline in this repo in about an hour.

## Why teams pick ADS

- **You sign the release, with evidence.** Four human gates, each a recorded
  approval of a concrete artifact. When someone asks "who signed off on this,
  and on what evidence?" the answer is a file in git with a name and a date.
- **Nobody grades their own homework.** Review and verification are separate
  roles under separate contracts; the verifier runs your system and pastes the
  output as evidence against each acceptance criterion. The model registry
  supports pinning reviewer and verifier to a different vendor than the
  implementer, so shared blind spots don't review themselves.
- **Own the process, rent the models.** Every vendor and model ID in the
  entire system lives in one registry file; swapping models is a one-line
  edit. Roles render to any runtime through thin adapters — two runtimes
  render from the same source today, CI-checked on every commit.
- **Every run is replayable.** Pipeline state is typed files in a run
  directory: spec, plan, review reports, verification evidence, gate
  approvals. A postmortem is a `git log`, not an archaeology dig through
  vanished sessions.

## How it works

A role consumes files and produces files — never a shared conversation, so an
agent can be discarded and replaced without losing state, and nothing important
exists only in a scrollback. Contracts specify each artifact's required
sections; a malformed artifact is bounced by its consumer, never guessed at.
Humans approve at the four gates, and gate entries in `state.yaml` are written
only by the named human approver.

| Layer | Where | What it does |
|-------|-------|--------------|
| Roles | [`roles/`](roles/) | Runtime-neutral contracts: mission, inputs, outputs, escalation triggers |
| Contracts | [`contracts/`](contracts/) | Templates for every handoff artifact — spec, plan, tasks, reports, run state |
| Registry | [`registry/models.yaml`](registry/models.yaml) | The only place vendor/model IDs exist; roles bind via capability profiles |
| Adapters | [`adapters/`](adapters/) | Thin per-runtime bindings; a CI-checked renderer emits each runner's agent files |
| Integration | [`scripts/integrate.py`](scripts/integrate.py) | Vendors the core into your repo with a lockfile, provenance, and validate checks |
| FleetView | [`frontend/`](frontend/) | The control plane: decision inbox, run portfolio, gate cards, metrics, CLI |
| Runs | [`runs/`](runs/) | One directory per pipeline run — the audit trail lives in git |

The full architecture — principles, roles, gates, failure modes — is
[`docs/DESIGN.md`](docs/DESIGN.md).

## FleetView

FleetView is where humans hold up their end of the contract: a decision inbox,
a portfolio of runs, per-run gate cards with the evidence attached, and
metrics — web UI, `agentic` CLI, and HTTP API, all rendered from run state in
git. The repo is the only database: every view recomputes from your repo, and
the only write FleetView ever performs is a commit recording a human decision.
It runs from this checkout, pointed at any repo ADS is integrated into
(`agentic status --repo ~/code/my-app`). Design:
[`docs/FRONTEND.md`](docs/FRONTEND.md).

## What's real today

This is v0.2, and the evidence is in the repo rather than in this paragraph:

- Three complete pipeline runs, G0 through G3, with signed gate records:
  [`runs/wordfreq/`](runs/wordfreq/), `runs/mdtoc/`, `runs/dupefind/` —
  including adversarial review cycles that caught blocking defects green test
  suites had missed (see the runs' `review-*.md`).
- Two runtime adapters (Claude Code, Copilot CLI) rendering from the same role
  specs, staleness-checked in CI on every commit.
- FleetView and the v1 orchestrator implemented in [`frontend/`](frontend/);
  autonomous orchestration stays gated behind the promotion criterion in
  [`docs/DESIGN.md`](docs/DESIGN.md) §7 — routing autonomy is earned on
  recorded evidence, the same trust ladder the pipeline applies to its agents.
- `integrate.py init | validate` for host-repo adoption, with the lockfile
  schema and integration workflow in [`docs/INTEGRATION.md`](docs/INTEGRATION.md).

What it is not yet: a tagged package release (the first is on the roadmap), a
hosted service, or a system that asks for autonomy it hasn't demonstrated.

## Backing and license

This repository is **ADS Core** — the complete framework, free and
Apache-2.0, and it stays that way. It is built and maintained by
<!-- COMPANY-NAME: placeholder — settle the public company name before launch -->
**[the company behind ADS and FleetView]**, which also runs its own business
operations on this framework.

Copyright © 2026 Nathan Carter. Licensed under the
[Apache License 2.0](LICENSE.md); see [NOTICE.md](NOTICE.md) for provenance.
