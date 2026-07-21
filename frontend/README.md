# Gate — the pipeline's human frontend

The surfaces through which humans perform their contractual interactions with
the agent pipeline: a decision **inbox**, a **portfolio** view, per-run detail
with **gate cards**, the **`agentic` CLI**, and **metrics** — all rendered from
`runs/*/state.yaml` and the run artifacts in git.

Design: [docs/FRONTEND.md](../docs/FRONTEND.md) · Plan:
[docs/FRONTEND-PLAN.md](../docs/FRONTEND-PLAN.md)

## The three rules

- **R1 — The repo is the only database.** Every view is recomputed from git;
  deleting `frontend/` loses nothing. The app owns no store, ever.
- **R2 — Exactly one write path.** The only mutation in the system is a commit
  editing one run's `state.yaml`: gate decisions, escalation resolutions,
  pause/resume. No dispatch, no artifact edits, no second channel. Writes are
  compare-and-swap (`git update-ref` with the expected old value): if the run
  branch moved while you decided, the write refuses and the UI re-presents.
  R2 scopes to the *human* surfaces (web, CLI, server): the v1 orchestrator
  (`packages/orchestrator`) is the sanctioned machine co-writer, using the same
  core write path under its own bot identity and commit grammar — it dispatches
  agents; the human surfaces never do.
- **R3 — A malformed packet never renders as reviewable.** Artifacts are
  validated against the target repo's *own* `contracts/` templates; a packet
  missing required sections gets a bounce view with no approve control — in the
  UI, the CLI, and the API alike.

Deliberate absences (from FRONTEND.md §5): the frontend does not dispatch or
steer agents (the harness is the cockpit), does not host chat, does not author
artifacts, and never surfaces an approval finer-grained than the four gates
plus escalations.

## Quickstart

Requires Node ≥ 24 (the packages run from TypeScript source; no build step for
the CLI/server) and `git`.

```sh
cd frontend
npm install
npm run build          # builds the SPA once

node packages/cli/src/main.ts ui            # serve the current repo
node packages/cli/src/main.ts ui --demo     # explore a generated demo repo
node packages/cli/src/main.ts status        # portfolio in the terminal
```

`agentic ui` binds to `127.0.0.1` and opens the browser. `--host` exists, but
multi-user serving (auth, routing, rotation) is Stage C's problem and
deliberately not this build's — see FRONTEND.md §6. A *single-user* hosted
instance (one URL, you behind an authenticating proxy) is supported: see
[docs/DEPLOY.md](../docs/DEPLOY.md).

## CLI

```
agentic status                          portfolio: phases, gates, needs-a-human
agentic inbox                           everything waiting, oldest first
agentic approve <slug> <gate>           --burden confirmation|light-correction|heavy-correction
                                        [--notes …] [--no-advance] (burden prompted on a TTY)
agentic decline <slug> <gate>           --reason … (pauses the run as gate-declined)
agentic resolve-escalation <slug> <n>   --note …
agentic pause <slug> [--reason …]
agentic resume <slug> [--phase …]       phase derived from the gate ledger if omitted
agentic sync [--live]                   copy approved PR reviews into undecided G2 entries
agentic ui [--demo] [--port N]          serve the web app
```

Global: `--repo <path>` (repeatable) overrides source discovery.

Common terminal workflows and pitfalls — deciding gates, approve-and-hold,
PR-review sync, headless engine operation:
[packages/cli/README.md](packages/cli/README.md).

## Multi-repo configuration

`~/.config/agentic/config.yaml`:

```yaml
sources:
  - name: sandbox
    path: ~/repos/agentic-sandbox
  - name: product
    path: ~/repos/product-app
    push: true          # push run branches after each decision commit
    fetch_interval: 60  # seconds between `git fetch`es of origin; unset = never poll
```

No config file → the current repository, zero setup.

## Keyboard model

| Where | Key | Action |
|---|---|---|
| Inbox | `j` / `k` | move selection |
| Inbox | `↵` | open the selected item |
| Run page | `a` | approve (or resolve) on the primary card |
| Run page | `x` | decline on the primary card |
| Run page | `1` `2` `3` | pick burden: confirmation / light / heavy |
| Run page | `e` | cycle artifacts |
| Anywhere | `esc` | close the decision / back to the inbox |

## How decisions are recorded

An approval writes the gate entry — `approved, by (git user.name), at
(ISO-8601), notes, burden` — into `state.yaml` on the run branch as a commit
authored by you, with a structured message:

```
state(<slug>): G2 approved by <name> [burden: light-correction]
```

Metrics (approval rate per gate with the >90% over-triggering check, burden
mix, decision latency, review rounds, budget honesty) are computed from that
history. Nothing is logged separately: if it isn't in git, it didn't happen.

## Development

```sh
npm test               # vitest: core, server, CLI (fixture-repo backed)
npm run typecheck
npx playwright test    # e2e smoke against a generated fixture repo
npm run dev            # API server; pair with: npm run dev -w @agentic/web
```

`fixtures/` generates a repo with runs in every interesting state — each gate
pending, an escalation, a round-cap breach, a paused run, malformed artifacts,
a merged run. Tests, Playwright, and `--demo` all use it.

Layout: `packages/core` (schema, discovery, readiness, validation, write path,
metrics — zero UI deps) · `packages/cli` · `packages/server` (Hono) ·
`packages/web` (React 19 + Vite + Tailwind v4). Dependency posture is lean and
boring; every new package needs a reason in the PR description.
