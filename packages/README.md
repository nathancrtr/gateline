# Gate — the pipeline's human frontend

The surfaces through which humans perform their contractual interactions with
the agent pipeline: a decision **inbox**, a **portfolio** view, per-run detail
with **gate cards**, the **`gateline` CLI**, and **metrics** — all rendered from
`runs/*/state.yaml` and the run artifacts in git.

Design: [docs/FRONTEND.md](../docs/FRONTEND.md) · Plan:
[docs/FRONTEND-PLAN.md](../docs/FRONTEND-PLAN.md)

## The three rules

- **R1 — Git is the only authoritative store.** Every view is recomputed from
  git; deleting `packages/` loses nothing today. A derived store (cache, index)
  is sanctioned only under the rebuildability rule in
  [FRONTEND.md §4](../docs/FRONTEND.md), principle 6 — none exists in this build.
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
node cli/src/main.ts ui --demo     # explore two generated demo repositories
node cli/src/main.ts ui --demo=single  # the same demo as one repository
node cli/src/main.ts status        # portfolio in the terminal
```

The demo serves `local/demo`, a repository with runs in every state, and
`local/demo-small`, a second repository with four runs, so the scope control,
grouping by repository and the Inbox badge's two numbers can be tried
(docs/MULTI-REPO.md §9.1, §9.7). `--demo=single` serves `local/demo` alone,
which is how a one-repository deployment looks.

`gateline ui` binds to `127.0.0.1` and opens the browser. `--host` exists, but
multi-user serving (auth, routing, rotation) is Stage C's problem and
deliberately not this build's — see FRONTEND.md §6. A *single-user* hosted
instance (one URL, you behind an authenticating proxy) is supported: see
[docs/DEPLOY.md](../docs/DEPLOY.md).

## CLI

```
gateline status [--repository …]         portfolio: phases, gates, needs-a-human
gateline inbox [--repository …]          everything waiting, oldest first
gateline approve <slug> <gate>           --burden confirmation|light-correction|heavy-correction
                                        [--notes …] [--no-advance] (burden prompted on a TTY)
gateline decline <slug> <gate>           --reason … (pauses the run as gate-declined)
gateline resolve-escalation <slug> <n>   --note …
gateline pause <slug> [--reason …]
gateline resume <slug> [--phase …]       phase derived from the gate ledger if omitted
gateline sync [--live]                   copy approved PR reviews into undecided G2 entries
gateline repo add <path> --mode <mode>   list a repository [--name …] [--gateline-prefix …]
gateline repo remove <id or name>        drop it from the list
gateline repo list                       id, origin, display name, mode, framework ref
gateline ui [--demo[=single]] [--port N] serve the web app
gateline up [--repo …]…                  the web app over the set, and one engine per dispatch repository
gateline render [repo] [--check]         re-render the adapter agent files
gateline self-update                     pull + rebuild the checkout this CLI runs from
```

Global: `--repo <path>` (repeatable) names repositories by path in place of
the config file. `--repository <id or name>` picks one repository on any
command that takes a slug (`--source` is the older spelling, still accepted).
With several repositories, `status` and `inbox` print a heading line per
repository and take `--repository` to show one.

Common terminal workflows and pitfalls — deciding gates, approve-and-hold,
PR-review sync, headless engine operation:
[packages/cli/README.md](cli/README.md).

## Multi-repo configuration

`~/.config/gateline/config.yaml` (under `$XDG_CONFIG_HOME` when that is set)
lists the repositories one deployment serves. `gateline repo add|remove|list`
edit and print it, keeping its comments and order; the file can also be
edited by hand:

```yaml
limits:                           # the machine's, across every repository
  max_concurrent_dispatches: 2
  spend_limit_usd: 40
  spend_window_hours: 24
engine:                           # defaults for every dispatch repository
  adapters: [claude-code]
  role_timeout_seconds: 1800
  heartbeat_seconds: 180
  name: workstation-1             # stands in for the hostname in engine ids; see below
  budget_enforcement: true        # false: meter spend, enforce no spend limit
repositories:
  - path: ~/repos/billing         # id from its origin: github.com/acme/billing
    mode: dispatch                # view | decide | dispatch — required
    fetch_interval: 60            # seconds between `git fetch`es of origin; unset = never poll
    former_ids: [github.com/acme/billing-service]  # links under an old id keep redirecting
    limits:
      spend_limit_usd: 25         # beneath the machine's, never above it
  - name: sandbox                 # a display name; with no origin it also names the id, local/sandbox
    path: ~/repos/gateline-sandbox
    mode: decide
  - path: ~/repos/website
    mode: view
    gateline_prefix: .framework   # only for a host integrated with `gateline init --prefix .framework`
```

No config file → the current repository, zero setup. `--repo <path>` and the
working directory behave as they always have: `decide` for the CLI and `ui`,
`dispatch` under `up`, with no framework check.

**Modes** (docs/MULTI-REPO.md §7.3). Every entry states one, and an entry
without one is refused at startup:

| Mode | Reads | Records decisions | Engine under `up` |
|---|---|---|---|
| `view` | yes | no | no |
| `decide` | yes | yes | no |
| `dispatch` | yes | yes | yes |

A `view` repository refuses every write, from Gatehouse and from the CLI
alike. Under `ui` and the CLI no engine runs, so a `dispatch` entry behaves as
`decide`. A `dispatch` entry pushes decisions when the repository has an
origin; `view` and `decide` entries push only with `push: true`. An explicit
`push` or `local_only` always wins (docs/TOPOLOGY.md §3.6).

**An older file** lists entries under `sources:` with no `mode`. `sources:` is
still read as the list, but startup refuses each entry until it has a `mode`:
add `mode: decide` for what the entry did before (or `view`, or `dispatch`).
A file with both `repositories:` and `sources:` is refused, as is any key this
section does not name.

**Carrying the framework** (§7.2). A listed repository must carry the
framework on its default branch, read through git: a lock at
`.gateline/framework-lock.json` (or under `gateline_prefix`), or `roles/`,
`contracts/` and `registry/` at its root, which `repo list` marks "no lock".
Anything else is refused with a message naming `gateline init`. An `init`
that has not merged to the default branch does not count yet. A refused
repository, or an entry whose path is not a git repository, is left out of
the set with a warning and the others load; startup stops only when no listed
repository can be served. `repo add` refuses such a repository outright.

**Limits and engine defaults** are what `gateline up` runs under (#502). `up`
serves every repository in the file and runs one engine for each `dispatch`
repository, in one process, under the one set of `limits:`. A flag to `up`
(`--max-concurrent-dispatches`, `--spend-limit-usd`, `--spend-window`,
`--no-budget-enforcement`, `--adapter`, `--role-timeout`, `--heartbeat`,
`--engine-name`) overrides the matching key. A repository's own
`limits.spend_limit_usd` is its ceiling beneath the machine's; one above the
machine's is refused when the file is read. `up` prints, before anything
starts, every limit it took and where from, and each repository's mode, push or
local-only, and ceiling. `--repo` replaces the file whole, its limits with its
list, and `up` warns when a file it is not reading exists.

`engine.name` (or `--engine-name`) replaces this machine's hostname in every
engine id written to a ledger. It must be unique among the machines that run an
engine against the same repository: an engine reads an entry carrying its own
name, whose process is not running on this machine, as one it left behind when
it died, and dispatches that work again. Letters, digits, `.`, `_` and `-`.

Do not run the standalone `gateline-orchestrator` beside `up` on one machine.
It serves one repository with limits of its own, so the two together count every
limit twice.

Each repository has an id (docs/MULTI-REPO.md §6). With an origin, it is
`<host>/<owner>/<name>`, derived from `git remote get-url origin`; without
one, it is `local/<name>`, the name being the entry's `name` or else the
directory's basename. A run's page is `/repos/<id>/-/runs/<slug>`. An entry
may state `id:` outright where the origin would give the wrong one, such as
an ssh host alias. One repository listed twice, two entries with one id, or
two with one display name, are a startup error. Links in the old
`/runs/<name>/<slug>` shape redirect.

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
npm run lint            # biome check . — see biome.json for the tuned rule set
npx playwright test    # e2e smoke against a generated fixture repo
npm run dev            # API server; pair with: npm run dev -w @gateline/web
```

`fixtures/` generates a repo with runs in every interesting state — each gate
pending, an escalation, a round-cap breach, a paused run, malformed artifacts,
a merged run. Tests, Playwright, and `--demo` all use it. Its `small` set is
the demo's second repository, four runs in four states; `generateDemoSet`
makes both side by side under the fixed names `demo` and `demo-small`.

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

`@gateline/framework` carries a third guard of the same family, for a different
reason: it has **no dependencies at all**, because a host repository's
render-staleness CI runs it with nothing installed (INTEGRATION.md §8). It may
import `node:` builtins and its own modules, and nothing else. That is why it is
a package rather than a layer inside `core`, whose `yaml` and `zod` would defeat
the point.

`@gateline/core` and `@gateline/server` are **dev**Dependencies of `web` on
purpose: web takes types from them, which erase at build, plus the record-layer
values Vite bundles into the SPA. Nothing is resolved from `node_modules` at
runtime — the browser loads one self-contained bundle — so they are build
inputs, not runtime dependencies.
