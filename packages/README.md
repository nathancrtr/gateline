# Gate — the pipeline's human frontend

The surfaces through which humans perform their contractual interactions with
the agent pipeline: a decision **inbox**, a **portfolio** view, per-run detail
with **gate cards**, the **`gateline` CLI**, and **metrics** — all rendered from
`runs/*/state.yaml` and the run artifacts in git.

Design: [docs/FRONTEND.md](../docs/FRONTEND.md) · Plan:
[docs/FRONTEND-PLAN.md](../docs/FRONTEND-PLAN.md)

## The three rules

- **R1 — The repo is the only database.** Every view is recomputed from git;
  deleting `packages/` loses nothing. The app owns no store, ever.
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
cd packages
npm install
npm run build          # builds the SPA once

node cli/src/main.ts ui            # serve the current repo
node cli/src/main.ts ui --demo     # explore a generated demo repo
node cli/src/main.ts status        # portfolio in the terminal
```

`gateline ui` binds to `127.0.0.1` and opens the browser. `--host` exists, but
multi-user serving (auth, routing, rotation) is Stage C's problem and
deliberately not this build's — see FRONTEND.md §6. A *single-user* hosted
instance (one URL, you behind an authenticating proxy) is supported: see
[docs/DEPLOY.md](../docs/DEPLOY.md).

## CLI

```
gateline status                          portfolio: phases, gates, needs-a-human
gateline inbox                           everything waiting, oldest first
gateline approve <slug> <gate>           --burden confirmation|light-correction|heavy-correction
                                        [--notes …] [--no-advance] (burden prompted on a TTY)
gateline decline <slug> <gate>           --reason … (pauses the run as gate-declined)
gateline resolve-escalation <slug> <n>   --note …
gateline pause <slug> [--reason …]
gateline resume <slug> [--phase …]       phase derived from the gate ledger if omitted
gateline sync [--live]                   copy approved PR reviews into undecided G2 entries
gateline ui [--demo] [--port N]          serve the web app
```

Global: `--repo <path>` (repeatable) overrides source discovery.

Common terminal workflows and pitfalls — deciding gates, approve-and-hold,
PR-review sync, headless engine operation:
[packages/cli/README.md](cli/README.md).

## Multi-repo configuration

`~/.config/gateline/config.yaml`:

```yaml
sources:
  - name: sandbox
    path: ~/repos/gateline
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
npm run dev            # API server; pair with: npm run dev -w @gateline/web
```

`fixtures/` generates a repo with runs in every interesting state — each gate
pending, an escalation, a round-cap breach, a paused run, malformed artifacts,
a merged run. Tests, Playwright, and `--demo` all use it.

Three test layers, and picking the wrong one is how a defect goes uncaught
(#301). Pure derivation modules are the default and take no DOM. A component's
*structure* is testable from a plain `.ts` test through `renderToStaticMarkup`
— no jsdom, no `@testing-library`, no new dependency — see
`web/test/findings.test.ts`. **Geometry** (wrap, overflow, width, visibility) is
Playwright's alone, because nothing else lays out: `e2e/geometry.spec.ts` sweeps
every fixture state at 800/900/1000/1280. The full rationale, and when a DOM
environment would actually be warranted, is at the head of `vitest.config.ts`.

Layout: `packages/core` (schema, discovery, readiness, validation, write path,
metrics — zero UI deps) · `packages/cli` · `packages/server` (Hono) ·
`packages/web` (React 19 + Vite + Tailwind v4). Dependency posture is lean and
boring; every new package needs a reason in the PR description.

## The wire contract

`server/src/contract.ts` is the one declaration of what the HTTP API accepts
and returns (#317). Handlers answer through `respond<'GET /api/inbox'>(c, …)`
or `fail(c, 404, …)`, both generic over that module, so a response body that
drifts from its declaration fails `npm run typecheck` on the server rather than
in a browser. `API_VERSION` rides on `GET /api/health`; bump it when a change
here would break a client compiled against the previous one.

It belongs to the server because the server owns its own wire shape. Putting it
in `core/view-model` was considered and rejected — core describes derivations,
not transport, and a route map there would make every consumer of core a
consumer of the HTTP API.

Gatehouse imports that module and nothing else across the workspace. Two guards
hold the line, and they catch different failures:

- `web/test/boundary.test.ts` governs what the **source** may import. The one
  exception is ADR-6's: two named pages value-import `@gateline/core/record`
  (browser-safe — yaml and zod, no node builtins) so the new-run form can
  preview the exact commit the server will make. That list is enumerated;
  growing it means editing the test on purpose.
- `web/scripts/check-bundle.mjs` runs after `vite build` and reads the **built
  output**, failing the build if a node builtin landed in it. Its own patterns
  are tested (`web/test/bundle-guard.test.ts`) because the first draft matched
  `node:` loosely and fired on minified object literals — a guard that cries
  wolf gets deleted, and one that matches nothing passes forever.

`@gateline/core` and `@gateline/server` are **dev**Dependencies of `web` on
purpose: web takes types from them, which erase at build, plus the record-layer
values Vite bundles into the SPA. Nothing is resolved from `node_modules` at
runtime — the browser loads one self-contained bundle — so they are build
inputs, not runtime dependencies.
