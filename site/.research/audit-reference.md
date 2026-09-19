# Accuracy and currency audit — `public/reference/*` (the previous private repository docs site)

Audited read-only on 2026-09-18 against `nathancrtr/gateline` `main` at `eaeea92b` (2026-09-18 15:39 -0400).
Pages were written 2026-07-27/28 against the pre-rename repository (`agentic-sandbox`, `frontend/`, Python scripts).
Only the content between `<!-- content:start -->` and `<!-- content:end -->` was read.

Status key: **OK** — true now · **STALE** — was true, name/path/command changed · **WRONG** — not true now (or never was) · **UNVERIFIABLE** — could not be checked from the repo · **MISSING-NEWER** — page omits something that now exists and a reference page should carry.

Every `<!-- evidence: -->` comment cites line numbers; all of them are stale (the tree has been reorganised twice since July). The tables below give current paths/sections without line numbers.

## Rename map (applies to every page)

| Retired / renamed | Replacement now | Where it appears |
|---|---|---|
| `agentic` (CLI) | `gateline` (`packages/cli/package.json` bin) | index ×1, cli ×~20, cli page anchors `#agentic-global-flags` |
| `agentic-orchestrator` (binary and bot identity) | `gateline-orchestrator` (`packages/orchestrator/package.json` bin; `BOT_IDENTITY.name` in `packages/orchestrator/src/start.ts`, email `orchestrator@gateline.invalid`) | index ×1, cli ×8, contract-grammar ×1 |
| `agentic-runner-agent` | `gateline-runner-agent` (`packages/runner-agent/package.json` bin) | index ×1, cli ×3 |
| `--agentic-prefix` | `--gateline-prefix` (orchestrator and runner-agent) | cli ×1 |
| `.agentic/` (implied by the prefix flag) | `.gateline/` (`DEFAULT_FRAMEWORK_PREFIX` in `packages/framework/src/roots.ts`) | cli (implicit) |
| `frontend/packages/...` | `packages/...` (renamed 2026-07-29, #133) | cli ×33, state-yaml ×9, orchestrator-yaml ×5, contract-grammar ×16 (all in evidence comments or visible file paths) |
| `agentic upgrade` | `gateline self-update` (renamed 2026-09-16, #371) | cli ×2, state-yaml ×1 (in prose about profile upgrades — that one is fine, it is the word not the command) |
| `scripts/render-agents.py`, `python3 scripts/render-agents.py --check` | `gateline render [repo] [--check]`; CI runs `node packages/framework/src/main.ts render --check` (`.github/workflows/render-check.yml`); implementation `packages/framework/src/render.ts` (2026-09-16, #371) | adapter-manifests ×13 |
| `render_permission_map` | `renderPermissionMap` (`packages/framework/src/render.ts`) | adapter-manifests ×1 |
| "stdlib-only", "Python 3.9-compatible", "no PEP 604", "no PyYAML" | `@gateline/framework` takes no runtime dependencies (`node:` builtins only, AGENTS.md invariant); Node ≥ 24; JSON manifests and a hand-rolled flat frontmatter reader (`packages/framework/src/role.ts`) | adapter-manifests ×8 |
| `scripts/integrate.py` (not named on these pages, but the evidence map's basis) | `gateline init | validate | fork` (`packages/framework/src/integrate.ts`, #372) | — |
| Binary names count | There are now **five** bins: `gateline`, `gateline-orchestrator`, `gateline-runner-agent`, `gateline-framework` (`packages/framework`, dependency-free `render|init|validate|fork`), `gateline-fixture` (`packages/fixtures`) | cli says "third binary" |

Retired product names *FleetView* / *ADS* / *Agentic Development System*: **none** found on the six pages.

---

## reference/index.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "The `agentic` command is the gate frontend in terminal form" | STALE | `gateline` | Rename |
| 2 | "Every subcommand across the inspect, decide, create and serve groups" | MISSING-NEWER | AGENTS.md "Commands" now lists five groups: inspect, decide, *end a run short of done* (`close`/`reopen`), create, serve, plus **render/init/validate/fork** (integration) and `self-update` | Add "close, integrate (render/init/validate/fork)" to the blurb |
| 3 | "the `agentic-orchestrator` engine binary and the `agentic-runner-agent` dispatch relay" | STALE | `gateline-orchestrator`, `gateline-runner-agent`; a fourth, `gateline-framework`, is the dependency-free integration entry | Rename; mention `gateline-framework` |
| 4 | state.yaml blurb: "phases, the three profiles…, escalations and dispositions" | MISSING-NEWER | `phase: closed` and the `closure` record (typed disposition) exist since #200 | Add "the closure record" |
| 5 | orchestrator.yaml blurb | OK | matches `orchestrator.yaml` and `packages/orchestrator/src/schedule.ts` | — |
| 6 | Adapter manifests blurb: "how the render script consumes role specs and manifests" | STALE | The renderer is `gateline render` in `@gateline/framework` (TypeScript), not a script | "how `gateline render` consumes…" |
| 7 | Contract grammar blurb: "two normative rule families" | MISSING-NEWER | Contracts now carry a third tooling-parsed line, `AUDIENCE:` (spec.md, review-report.md), and a normative VERIFY ROUND block (review-report.md) | Mention AUDIENCE |
| 8 | Link to `../api/index.html` "generated API documentation" | OK (exists; content not audited) | `public/api/` present | — |

Counts: 8 claims — OK 2, STALE 3, MISSING-NEWER 3, WRONG 0.

---

## reference/cli.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | Lede: "The `agentic` command…", "companion binary `agentic-orchestrator`" | STALE | `gateline`, `gateline-orchestrator` | Rename throughout (31 occurrences) |
| 2 | "installed by `npm install` in the framework workspace, run from TypeScript source" | OK | Workspace is `packages/` (Node ≥ 24); every bin points at `src/main.ts` | Say `packages/` explicitly |
| 3 | "no running server required for the inspect/decide/create groups" | OK | Confirmed: `resolveSources()` reads git directly | — |
| 4 | Global flag `--repo <path>` repeatable, default config file then cwd | OK | Same; help also shows `-V, --version` (0.3.0) and the config path in the no-sources error is `~/.config/gateline/config.yaml` | Add `-V` |
| 5 | `status`: portfolio table (phase, gates ✓/✕/·, tasks, updated, needs) | OK / MISSING-NEWER | Phase cell now carries a suffix: `(<paused_reason>)` when paused, `(<closure.as>)` when closed | Note the suffix |
| 6 | `inbox`: kinds, `✕ BOUNCED: <problem>` | OK / MISSING-NEWER | Also prints `⋯ SUPERSEDED: <detail>` when the gate's producer is in flight (#159) | Add the SUPERSEDED line |
| 7 | `show <slug> [artifact]`, `--refs first-line|full|off`, `--source` | OK | Same | — |
| 8 | "If a concurrent write moved the ref, the command is re-derived — no merge, no guess" | WRONG | The CLI does not re-derive: on CAS refusal it prints `refused (ref-moved): …` and exits **2** (other refusals exit 1); the human re-runs. Re-derivation on refusal is the *engine's* behaviour (ORCHESTRATOR.md §4.3) | "…the command refuses and exits 2; rerun it" |
| 9 | `approve`: `--burden` required, prompted on a TTY; `--notes`, `--source` | OK | Prompt is `burden? [1] confirmation [2] light-correction [3] heavy-correction`; `--note` is a hidden alias of `--notes` (#264); gate argument is upper-cased | — |
| 10 | `--no-advance` | OK | Same | — |
| 11 | `--hold <reason>` signs the gate and sets `phase: paused` in the same commit | OK | Commit message becomes `state(<slug>): G<N> approved by <name> [burden: …] and held (<reason>)` | Quote the commit form |
| 12 | `decline`: `--reason` required | OK | Enforced by `requireNoteText` (same error shape as a required option); `--note`/`--notes` hidden aliases; message `state(<slug>): G<N> declined by <name>` | — |
| 13 | `resolve-escalation <slug> <index>`: `--note` required; `--disposition re-review|return-to-implement|re-plan`; omit → engine default | OK | Same; `re-plan` (#190) sends the finding to the architect's amendment mode and later raises a fresh escalation | — |
| 14 | `pause --reason` enum, default `escalation` | OK | Same four values in the CLI; the schema's `PAUSED_REASONS` additionally knows `staged` and `slug-landed` (not selectable) | — |
| 15 | `resume`: phase from `deriveResumePhase` unless `--phase` | OK / MISSING-NEWER | New flag `--cost-limit <usd>` — writes a new `budget.cost_limit_usd` in the same commit; **required** to resume from a `budget-exhausted` pause (#96). Resuming a `gate-declined` run re-opens the declined gate | Add `--cost-limit` |
| 16 | `sync`: dry-run unless `--live`; `--source`; `local-only: nothing to sync` | OK | Also prints `nothing to sync — no undecided G2 with an approved PR review`; sync obeys the same "gate on the table" rule as decisions (#344) | — |
| 17 | `new`: stages inert (`paused`/`staged`) | OK | Same | — |
| 18 | `new` flag table (`--slug`, `--title`, `--profile` default `standard`, `--brief-file`, `--budget` 50, `--key`, `--source`) | OK / MISSING-NEWER | New `--task-file <path>` — patch profile only: the human-authored work item, staged as `tasks/01-<slug>.yaml` (#221). Without it a patch run stages a stub and `arm` refuses until it is written | Add `--task-file` row |
| 19 | Profile landmine callout (CLI `standard` vs contract `full`) | OK | `runStateSchema.profile` defaults to `full`; CLI default `'standard'` | — |
| 20 | TTY fallback: `$EDITOR`/`$VISUAL` (fallback `vi`), section validation, `stage? [y/N]`, invalid slug rejected before the edit | OK | Precedence is `VISUAL`, then `EDITOR`, then `vi`; slug loop runs before the editor; identity (`git user.name/email`) is checked before the session too | Swap to "`$VISUAL`/`$EDITOR`" |
| 21 | `arm <slug>`: starts at first undecided-gate phase; best-effort draft PR | OK / MISSING-NEWER | Also refuses a patch run whose work item is still the stub (`armRefusal`) | Add the refusal |
| 22 | `up`: Gatehouse + engine, Hono, port 4310, self-supersede exit 75 | OK | `SUPERSEDE_EXIT_CODE = 75` (`packages/core/src/sources/code-tree.ts`); `up` refuses more than one `--repo` | — |
| 23 | `--spend-limit-usd` — "refuse new dispatches when projected spend … exceeds this" | STALE | Now "**defer** new dispatches while projected spend across all active runs **inside the window** exceeds this (a rate limit, never a pause; #97)" | Reword; add `--spend-window` |
| 24 | `up` key flags list | MISSING-NEWER | Missing `--spend-window <hours>` (rolling window for the limit, default 24) | Add |
| 25 | `--heartbeat` 180, `--role-timeout` 1800, `--max-concurrent-dispatches` 2 (0 disables), `--push/--no-push/--local-only`, `--no-budget-enforcement`, `--no-open`, `--adapter` repeatable | OK | Same | — |
| 26 | `ui`: `--port`, `--host`, `--demo`, `--no-open` | OK | Same | — |
| 27 | `agentic upgrade` — pull `--ff-only`, `npm install`, `npm run build`, refuses dirty tree | STALE | Command is **`gateline self-update`** (#371); behaviour as described, plus: refuses when the install is not a git checkout; prints that a running engine will exit 75 at its next tick boundary | Rename |
| 28 | (absent) `close <slug> --as <disposition> --reason <text>` | MISSING-NEWER | Added 2026-08-02 (#200/#293): both flags required; `--as` one of `already-delivered | superseded | obsolete | abandoned`; writes `phase: closed` + `closure` block; message `state(<slug>): closed by <name> [disposition: …]` | Add section |
| 29 | (absent) `reopen <slug>` | MISSING-NEWER | Undoes a closure; run returns to the phase its gate ledger derives; message `state(<slug>): reopened to <phase> by <name> (was closed as <disposition>)` | Add section |
| 30 | (absent) `render [repo] [--check]` | MISSING-NEWER | Re-renders every adapter's agent files; `--check` writes nothing and exits 1 on staleness (the check CI runs) | Add "integrate" group |
| 31 | (absent) `init <target>` | MISSING-NEWER | `--take all|<group>|<file,…>` (default `all`), `--layout prefixed|root` (default `prefixed`), `--prefix <dir>` (default `.gateline`), `--provenance redistribute|private` (**required, no default**), `--adapters auto|<list>` (default `auto`) | Add |
| 32 | (absent) `validate [target] [--prefix]` | MISSING-NEWER | Re-proves the static integration invariants (lock, checksums, provenance, overlay stubs, renders current) | Add |
| 33 | (absent) `fork <file> --reason <text> [--target .] [--prefix .gateline]` | MISSING-NEWER | Records a deliberate divergence of a core file | Add |
| 34 | `agentic-orchestrator` shared flags list | STALE / MISSING-NEWER | Names renamed; both binaries also have `--spend-window`; the engine's `--adapter` help adds "later ones satisfy `avoid_vendor_of` pins" | Update |
| 35 | Orchestrator adds `--require-budget` and `--agentic-prefix` | STALE | `--require-budget` OK; prefix flag is **`--gateline-prefix`** | Rename |
| 36 | "`agentic up` adds server flags (`--port`, `--host`, `--heartbeat`, `--no-open`) that the engine does not have" | OK (with nuance) | `--heartbeat` is a `watch` subcommand option on the engine, not a global; the page's own `watch` entry says so | Say "as globals" |
| 37 | `tick`: one reconcile pass; `--dry-run` prints without dispatching | OK / MISSING-NEWER | A live tick first syncs from origin, then also runs the **scheduler** tick (sweeps) and drains its jobs; `--dry-run` moves no refs at all | Mention sweeps |
| 38 | `watch`: ref watcher + heartbeat + completions; `--heartbeat` 180 | OK | Also runs the code-tree monitor (self-supersede) and the manifest staleness probe | — |
| 39 | `sweep <role>`: ignores dueness, not the other guards | OK | `force` nulls `lastSweptAt` only (bypasses S2); S0/S1/S3/SB still apply; exits 1 when the role has no schedule; syncs from remote first (#273) | — |
| 40 | `shadow <slug>`, `--ref`, M1 | OK | `--ref <rev>` "default: the run branch, else the default branch" | — |
| 41 | `agentic-runner-agent` polls `/api/runner/*`, disposable clone | STALE / MISSING-NEWER | Name; page lists **no flags**. Current: `--control-plane <url>` (required), `--token <token>` (required, matches server `RUNNER_TOKEN`), `--adapter <name>` (required, no default by design), `--work-dir <path>` (default cwd), `--poll-interval <seconds>` (default 5), `--repo-url <url>`, `--gateline-prefix <prefix>` | Add flag table |
| 42 | "A third binary" | STALE | Fourth and fifth bins exist: `gateline-framework` (dependency-free; used by host CI as `node packages/framework/src/main.ts render --check`) and `gateline-fixture` | Add `gateline-framework` |

Counts: 42 claims — OK 20, STALE 8, WRONG 1, MISSING-NEWER 13 (several rows carry two statuses; primary counted).

### Current command inventory (rebuild source)

#### `gateline` (`packages/cli/src/main.ts`, v0.3.0)

Global: `--repo <path>` (repeatable; default: config file `~/.config/gateline/config.yaml`, else cwd) · `-V, --version` · `-h, --help`

| Command | Flags (default) | Purpose |
|---|---|---|
| `status` | — | Portfolio: every run, phase (suffixed with paused reason or closure disposition), gates `✓/✕/·` per profile, tasks done/total, updated age, needs-human count; points at `inbox` |
| `inbox` | — | Everything needing a human, oldest first; `✕ BOUNCED: <problem>` for malformed packets, `⋯ SUPERSEDED: <detail>` when the producer is in flight |
| `show <slug> [artifact]` | `--source <id>`, `--refs first-line|full|off` (`first-line`) | Print an artifact with cited R/AC/ADR definitions as footnotes; omit artifact to list paths |
| `approve <slug> <gate>` | `--burden confirmation|light-correction|heavy-correction` (prompted on TTY; required otherwise), `--notes <text>` (`--note` hidden alias), `--no-advance`, `--hold <reason>`, `--source <id>` | Approve a gate; advances the phase unless `--no-advance`; `--hold` pauses in the same commit |
| `decline <slug> <gate>` | `--reason <text>` (required; `--note`/`--notes` hidden aliases), `--source <id>` | Decline a gate; pauses the run as `gate-declined` |
| `resolve-escalation <slug> <index>` | `--note <text>` (required; `--notes` alias), `--disposition re-review|return-to-implement|re-plan`, `--source <id>` | Resolve an escalation with a note and optional engine route |
| `pause <slug>` | `--reason budget-exhausted|round-cap|escalation|gate-declined` (`escalation`), `--source <id>` | Pause a run |
| `resume <slug>` | `--phase spec|plan|implement|integrate|release`, `--cost-limit <usd>` (required from a budget-exhausted pause), `--source <id>` | Resume; phase derived from the gate ledger unless `--phase`; re-opens a declined gate |
| `close <slug>` | `--as already-delivered|superseded|obsolete|abandoned` (required), `--reason <text>` (required), `--source <id>` | End a run short of `done` with a typed disposition |
| `reopen <slug>` | `--source <id>` | Undo a closure; run returns to the derived phase |
| `new` | `--slug <slug>` (`[a-z0-9][a-z0-9-]*`), `--title`, `--profile patch|standard|full` (`standard`), `--brief-file <path>`, `--task-file <path>` (patch only → `tasks/01-<slug>.yaml`), `--budget <usd>` (`50`), `--key <key>`, `--source <id>`; TTY fallback prompts + `$VISUAL`/`$EDITOR`/`vi` + `stage? [y/N]` | Stage a run (branch + intent-brief.md + state.yaml), inert until `arm` |
| `arm <slug>` | `--source <id>` | Start a staged run at the profile's first undecided-gate phase; refuses a stub patch work item; then best-effort draft PR |
| `sync` | `--source <id>`, `--live` | Copy PR-review approvals into G2 (dry-run by default; `local-only: nothing to sync` for local-only sources) |
| `up` | `--port <n>` (`4310`), `--host <h>` (`127.0.0.1`), `--no-open`, `--adapter <name>` (repeatable), `--spend-limit-usd <usd>`, `--spend-window <hours>` (24), `--no-budget-enforcement`, `--push`, `--no-push` (= `--local-only`), `--local-only`, `--heartbeat <seconds>` (`180`), `--role-timeout <seconds>` (1800), `--max-concurrent-dispatches <n>` (2; 0 disables); exactly one `--repo` | Gatehouse + engine over one clone; exit 75 on self-supersede |
| `render [repo]` | `--check` | Re-render every adapter's agent files from role specs + manifests |
| `init <target>` | `--take <subset>` (`all`), `--layout prefixed|root` (`prefixed`), `--prefix <dir>` (`.gateline`), `--provenance redistribute|private` (required), `--adapters <list>` (`auto`) | Scaffold the framework into a host repo (writes lock, provenance, `.github/workflows/gateline-render-check.yml`, overlay stubs) |
| `validate [target]` | `--prefix <dir>` (`.gateline`) | Re-prove the static integration invariants |
| `fork <file>` | `--reason <text>`, `--target <path>` (`.`), `--prefix <dir>` (`.gateline`) | Record a deliberate divergence of a taken core file |
| `self-update` | — | `git pull --ff-only` the checkout this CLI runs from; `npm install` + `npm run build` if HEAD moved; refuses dirty tree / non-git install |
| `ui` | `--port <n>` (`4310`), `--host <h>` (`127.0.0.1`), `--demo`, `--no-open` | Viewer-only web app, no engine |

#### `gateline-orchestrator` (`packages/orchestrator/src/main.ts`, v0.3.0)

Global: `--repo <path>` (cwd) · `--gateline-prefix <prefix>` · `--adapter <name>` (repeatable; first is default runner, later ones satisfy `avoid_vendor_of`) · `--push` · `--local-only` (conflicts with `--push`; unset auto-detects off a missing origin) · `--spend-limit-usd <usd>` · `--spend-window <hours>` (24) · `--require-budget` · `--no-budget-enforcement` (disables per-run cap, `--require-budget`, and `--spend-limit-usd`) · `--role-timeout <seconds>` (1800) · `--max-concurrent-dispatches <n>` (2; 0 disables) · `-V`

| Command | Flags | Purpose |
|---|---|---|
| `tick` | `--dry-run` | One reconcile pass over every run (+ scheduler tick); dry-run derives and prints, moves no refs |
| `watch` | `--heartbeat <seconds>` (`180`) | Resident mode: ref changes, dispatch completions, heartbeat; code-tree monitor → exit 75 on fast-forward |
| `sweep <role>` | — | Run a scheduled sweep now, ignoring dueness (S2) only |
| `shadow <slug>` | `--ref <rev>` (run branch, else default branch) | Replay a run's history: derived vs actual |

#### `gateline-runner-agent` (`packages/runner-agent/src/main.ts`, v0.3.0) — no subcommands

`--control-plane <url>` (required) · `--token <token>` (required; matches server `RUNNER_TOKEN`) · `--adapter <name>` (required) · `--work-dir <path>` (cwd) · `--poll-interval <seconds>` (`5`, must be > 0) · `--repo-url <url>` · `--gateline-prefix <prefix>` · `-V`

#### `gateline-framework` (`packages/framework/src/main.ts`) — dependency-free twin of the four integration commands

`render [repo] [--check]` · `init <target> --provenance <redistribute|private> [--take …] [--layout …] [--prefix …] [--adapters …]` · `validate [target] [--prefix …]` · `fork <file> --reason <text> [--target .] [--prefix …]`. Long flags only, no short options. This is what host-repo CI runs as `node <framework>/packages/framework/src/main.ts render --check`.

---

## reference/state-yaml.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | Lede: single source of truth, co-written by human and orchestrator | OK | `contracts/state.yaml` header; `packages/core/src/record/schema.ts` | Fix evidence paths |
| 2 | `phase` enum "spec | plan | implement | integrate | release | done | paused" | STALE | `PHASES` adds **`closed`**; `TERMINAL_PHASES = ['done', 'closed']` | Add `closed` |
| 3 | `profile` absent → `full` | OK | `runStateSchema.profile` transform | — |
| 4 | `paused_reason` enum "budget-exhausted | round-cap | escalation | gate-declined | staged" | MISSING-NEWER | Schema `PAUSED_REASONS` also has **`slug-landed`** (#213, rule LR: `runs/<slug>/` already shipped on the default branch; nothing clears it). The contract comment itself still lists only five — a source-side lag worth flagging upstream | Add `slug-landed` |
| 5 | `intake` object (source, ref, url, client_key, staged_by) | OK | Same | — |
| 6 | `budget` (cost_limit_usd, cost_spent_usd, ledger[]) | OK | Same | — |
| 7 | `gates` — one entry per profile gate; absent never auto-approved; humans only | OK | `superRefine` also makes a *missing in-profile* gate a malformed file | Add that nuance |
| 8 | `tasks` — id, status, review_rounds | OK | Same | — |
| 9 | `escalations` — at, from_role, reason, resolved, optional disposition | OK | Schema also carries resolved_by, resolved_at, resolution (page lists them later) | — |
| 10 | (absent) top-level `closure` | MISSING-NEWER | `closure: {as, by, at, reason}` — required when `phase: closed`, absent otherwise; `as` ∈ `already-delivered | superseded | obsolete | abandoned`; written only by the named human; `reopen` clears it; the orchestrator never writes it (AGENTS.md) | Add a row and a "Closure record" section |
| 11 | Profiles table (gates and phase sequences) | OK | `PROFILE_GATES`, `PROFILE_PHASES`; `paused` and `closed` are rest states every profile can reach | Mention `closed` |
| 12 | Upgrades one-way; downgrade → engine escalates (D21) | OK | `derive.ts` rule D21; ORCHESTRATOR.md §4.2 | Fix line refs |
| 13 | Gate entry shape (approved, by, at, notes, burden) | OK | Same (`gateEntrySchema`) | — |
| 14 | Ledger fields at…cost_usd | OK | `BudgetLedgerEntry` in `packages/core/src/record/ledger.ts` | — |
| 15 | "`failed` — Optional flag … present in `runs/creation-seam/state.yaml` but **not in the contract itself**" | WRONG (now) | The contract now documents `failed: true` explicitly, plus three more optional keys | Rewrite the row |
| 16 | (absent) ledger keys `refused`, `engine`, `session` | MISSING-NEWER | `refused: true` — no process spawned, cost 0, neither failure nor retry (#155); `engine: <hostname>:<pid>` — which orchestrator process opened the entry, read by the stale sweep (#349); `session: <id>` — the runner's own session, resumed on a same-round retry (#181). An entry with `cost_usd: null` and not failed is "an agent in flight" | Add rows |
| 17 | "schema.ts uses `.passthrough()` and tolerates additional keys" | OK | `budgetSchema` is passthrough; the ledger is parsed defensively by `parseLedger` | Point at `ledger.ts` |
| 18 | "Facts, not running totals"; v0 hand-append, v1 seam appends | OK | Same | — |
| 19 | Task status enum (8 values) | OK | `TASK_STATUSES`; contract now also explains `in-progress` is read as in-flight only alongside an open ledger entry, else returned to `pending` | Optional note |
| 20 | Escalation entry fields incl. disposition enum | OK | Same | — |
| 21 | "six-point co-writer contract" | STALE | ORCHESTRATOR.md §7 lists **seven** conventions; #7 (since #344): a gate decision is legal only for the gate on the table (profile's first un-approved gate, in one of its phases); CLI, API and PR-sync all refuse otherwise | Add point 7 |
| 22 | CAS via `git update-ref` with expected-old OID | OK | `Git.updateRefCAS` in `packages/core/src/sources/git.ts` | Fix path |
| 23 | Human commit grammar example `G2 approved by <name> [burden: …]` | OK / MISSING-NEWER | Contract now reserves five forms: `G<N> approved by`, `staged by … [client-key: …]`, `armed by`, `closed by … [disposition: …]`, `reopened to <phase> by … (was closed as …)` | List all five |
| 24 | Bot verbs `dispatched | bounced | advanced | escalated | paused | metered | harvested` | OK | ORCHESTRATOR.md §4.3 and `packages/orchestrator/README.md`; the contract comment omits `harvested` (source lag) | — |
| 25 | Gate authorship structural; orchestrator presents, never approves | OK | `roles/orchestrator.md` step 3; AGENTS.md invariant now says "never writes `gates.*` **or `closure`**" | Add closure |
| 26 | Evidence: `frontend/packages/core/...` (9×) | STALE | `packages/core/...` | Repath |

Counts: 26 claims — OK 17, STALE 3, WRONG 1, MISSING-NEWER 5.

### Current field list (contract `contracts/state.yaml` ⟷ `packages/core/src/record/schema.ts`)

| Key | Contract | Schema | Notes |
|---|---|---|---|
| `run` | required | `z.string()` | slug |
| `branch` | required | `z.string()` | `run/<slug>` |
| `phase` | `spec | plan | implement | integrate | release | done | paused | closed` | `PHASES` (same 8) | `done`, `closed` terminal |
| `profile` | `patch | standard | full`, absent → full | `PROFILES`, default `full` | — |
| `paused_reason` | `budget-exhausted | round-cap | escalation | gate-declined | staged` | `PAUSED_REASONS` + **`slug-landed`**; parsed as free string | contract lags schema by one value |
| `closure` | required when `phase: closed`; `as | by | at | reason` | `closureSchema`, `as ∈ CLOSURES`; `superRefine` requires it when closed | human-only; `reopen` clears |
| `intake` | optional: `source | ref | url | client_key | staged_by` | passthrough (not typed) | written once at staging |
| `budget.cost_limit_usd` | number | nullable | exhaustion pauses |
| `budget.cost_spent_usd` | derived sum | nullable | — |
| `budget.ledger[]` | `{at, role, task, round, adapter, model, tokens_in, tokens_out, cost_usd}` + optional `failed`, `refused`, `engine`, `session` | `BudgetLedgerEntry` (ledger.ts) | append-only |
| `gates.G0..G3` | exactly the profile's gates; `{approved, by, at, notes, burden?}` | `gateEntrySchema`; in-profile gates required; absent out-of-profile → undecided | `burden ∈ BURDENS` |
| `tasks[]` | `{id, status, review_rounds}`; status ∈ 8 values | `taskEntrySchema` (status free string, `review_rounds` ≥ 0 default 0) | only home of `review_rounds`; `ROUND_CAP = 3` |
| `escalations[]` | `{at, from_role, reason, resolved}` (+ `resolved_by`, `resolved_at`, `resolution`, `disposition`) | `escalationSchema`; `disposition ∈ DISPOSITIONS` | append-only |

Schema constants: `PHASES`, `TERMINAL_PHASES`, `PAUSED_REASONS`, `STAGED_REASON`, `DECLINED_REASON`, `BUDGET_REASON`, `LANDED_REASON`, `ESCALATION_REASON`, `CLOSED_PHASE`, `CLOSURES`, `CLOSURE_MEANINGS`, `GATE_IDS`, `PROFILES`, `PROFILE_GATES`, `PROFILE_PHASES`, `BURDENS`, `DISPOSITIONS`, `TASK_STATUSES`, `G2_COMPLETE_STATUSES`, `ROUND_CAP`. Helpers: `parseRunState`, `bestEffortEscalations`, `gateUndecided`, `PHASE_AFTER_GATE`, `phaseAfterGate`, `GATE_PHASES`, `deriveResumePhase`, `pendingGateAt`, `pendingGate`, `decisionPhase`, `gateProducer`, `isReviewFile`, `g2PacketReady`.

---

## reference/orchestrator-yaml.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | Lives at repo root; schedules; Historian only; committed policy | OK | `orchestrator.yaml` unchanged in substance | — |
| 2 | Read from default-branch tip via `git.show(defaultBranch, 'orchestrator.yaml')`; absent → empty; parse errors logged | OK | `Scheduler.tick()` in `packages/orchestrator/src/schedule.ts` | Fix path/line refs |
| 3 | `every` required, `<n>d|<n>h|<n>m`, sub-daily clamps to daily | OK | `parseEvery`; missing/invalid `every` is an error entry and the role is skipped | — |
| 4 | `cost_limit_usd` optional; absent → no SB check | OK | `costLimitUsd !== null && estimate > cap` | — |
| 5 | `enabled` optional; disabled → S0 | OK | `entry.enabled !== false` (default true) | Say "default true" |
| 6 | Grammar `^(\d+)([dhm])$`, positive integer, returns ms or null | OK | Input is trimmed; `0` → null | — |
| 7 | Example block | OK | Matches file | — |
| 8 | Sweep lifecycle: `runs/<role>-<date>/`, `sweep.yaml`, no `state.yaml`, merge is approval | OK | Same; `runs/README.md` | — |
| 9 | Rules S0–S4+SB, one test per row in `test/schedule.test.ts` | OK | `packages/orchestrator/test/schedule.test.ts` exists; evaluation order S0, S1, S2, S3, SB, S4 | — |
| 10 | S1/S3 "sweep branch … open/exists" | OK / MISSING-NEWER | Both rules now read local **and** remote-tracking refs (`refs/remotes/*/run/<name>`), and the caller fetches `--prune` first (#273) | Add one sentence |
| 11 | Commit-then-launch from `ZERO_OID`; closing commit records real usage | OK | Closing commit retries CAS 5×, appends `failed: "<error>"` on failure; falls back to the registry estimate when cost is unknown | Optional |
| 12 | (absent) marker fields | MISSING-NEWER | `sweep.yaml`: `sweep, role, every, at, covering_since, adapter, model, cost_limit_usd, tokens_in, tokens_out, cost_usd` (+ `failed`) | Add a small table |
| 13 | Evidence `frontend/packages/orchestrator/...` (5×) | STALE | `packages/orchestrator/...` | Repath |

Counts: 13 claims — OK 10, STALE 1, WRONG 0, MISSING-NEWER 2.

---

## reference/adapter-manifests.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "the script `scripts/render-agents.py` reads role specs and manifests" | WRONG (now) | The renderer is **`gateline render`** — `packages/framework/src/render.ts` (`renderAll`/`renderAgent`), via `@gateline/framework`; the Python script was deleted 2026-09-16 (#371) | Rewrite lede |
| 2 | "CI enforces staleness via `python3 scripts/render-agents.py --check`" | WRONG (now) | `.github/workflows/render-check.yml` runs `node packages/framework/src/main.ts render --check` with **no install step** (by design) | Replace command |
| 3 | Narrow-never-widen rule | OK | AGENTS.md invariant; DESIGN.md §8 | — |
| 4 | Registry model IDs marked ILLUSTRATIVE | OK | `registry/models.yaml` header still says so | Drop line refs |
| 5 | Opencode Kimi binding marked TEMPORARY | OK | `_comment_reviewer_pending_swap` still present | Drop line ref |
| 6 | "OpenRouter pricing entries are reference-only, not a live code path" | STALE | Registry now says `resolveModel()` is adapter-aware (#359) and these entries back the token-based **fallback**; opencode reports real cost directly, so they are not the live path *today* | Reword |
| 7 | Three adapters table (output dirs, filename templates, tools styles) | OK | Same; typo "capabilites" | Fix typo |
| 8 | "All three manifests carry identical non-`_comment` key sets" | STALE | Top-level keys are identical (`adapter, output_dir, filename, roles, tools_style, tool_map, model_map, model_overrides, model_vendors, extra_frontmatter, headless`); but `headless` differs: opencode adds `session_field` and `resume_args` | Qualify |
| 9 | "Only `extra_frontmatter` is optional to the render script — every other key is subscripted directly" | WRONG | `loadAdapterManifest` requires `adapter, output_dir, filename, tools_style` (strings) and `roles` (array); `tool_map`/`model_map` are required at use; `model_overrides` and `extra_frontmatter` are optional; `model_vendors` and `headless` are **not read by the renderer** (orchestrator's `manifest.ts` / router read them) | Rewrite |
| 10 | Key table rows `adapter`, `output_dir`, `filename`, `roles[]` (eight roles, orchestrator not rendered), `tools_style`, `tool_map`, `model_map`, `model_overrides`, `model_vendors`, `extra_frontmatter` | OK | Values match all three manifests (see inventory) | — |
| 11 | `headless.command[]`: `{prompt}` and `{role}` substituted | OK | Same | — |
| 12 | `headless.dispatch_prompt`: `{role}`, `{body}` | OK | Default `{body}` when absent | — |
| 13 | `headless.usage_report`: `json-stdout` / `static-estimate` / `ndjson-sum` | OK | `UsageFormat` in `packages/orchestrator/src/manifest.ts`; sub-keys `fields`, `line_filter`, `error_field`, `result_field` | — |
| 14 | (absent) `headless.session_field`, `headless.resume_args` | MISSING-NEWER | opencode: `session_field: "sessionID"`, `resume_args: ["--session", "{session}"]` — a retry of the same role+task+round resumes the harness session (#181); `{session}` substituted | Add rows |
| 15 | "How render-agents.py consumes manifests": stdlib-only, Python 3.9, no PEP 604 | WRONG (now) | Node package with zero runtime dependencies (`node:` builtins only); JSON manifests; flat hand-rolled frontmatter reader | Rewrite section as "How `gateline render` consumes manifests" |
| 16 | `main()` globs `adapters/*/manifest.json` | STALE | `listAdapters(coreRoot)` — directories under `adapters/` containing `manifest.json`, **sorted by name** for stable output | — |
| 17 | Step 1: frontmatter requires `dispatch`, `capabilities`, `capability_profile` | OK | `requireFrontmatter(spec, label, [...])` | — |
| 18 | Step 2: `model_overrides[role]` then `model_map[capability_profile]` | OK | Same; missing → `FrameworkError` | — |
| 19 | Step 3: capabilities → tools via `tool_map` | OK | `mergeTools` (ordered, deduped; unknown capability → error) | — |
| 20 | Step 4: frontmatter order, HEADER, body, overlays | OK | Header text is now `RENDERED from roles/<role>.md by gateline render - DO NOT EDIT. Edit the role spec, then run: gateline render`; extra frontmatter values are JSON-serialised | Update header quote |
| 21 | Overlays `overlays/_all.md` and `overlays/<role>.md` spliced | OK | `overlaysFor(coreRoot, role)`; note the framework repo itself has **no** `overlays/` — they exist in host repos (`gateline init` writes stubs; `validate` requires them non-empty) | Say "host repos" |
| 22 | `--check` mode; CI workflow `render-check.yml` | OK / STALE | Mode OK; the command in the workflow changed (row 2). Host repos get `.github/workflows/gateline-render-check.yml` from `init` | — |
| 23 | Permission model: `render_permission_map` | STALE | `renderPermissionMap` in `render.ts`: `permission:` / `"*": deny` / `<key>: allow` | Rename |
| 24 | P5 table: claude-code partial (fable reviews sonnet), copilot full, opencode three-way | OK | `adapters/claude-code/README.md`, `adapters/copilot-cli/README.md`, opencode manifest comments (no opencode README exists) | — |
| 25 | Dispatch-time `avoid_vendor_of` enforcement | OK | `registry/models.yaml` bindings; ORCHESTRATOR.md §5.3; `--adapter` "later ones satisfy avoid_vendor_of pins" | — |
| 26 | "Render script constraints" list | WRONG (now) | Replace: no runtime dependencies (`node:` only — a dependency forcing an install step in render-check is the bug); Node ≥ 24; JSON manifests; overlays as above; comment-only stubs splice nothing; unparseable manifest/missing frontmatter → `FrameworkError`, exit 1 | Rewrite |
| 27 | (absent) prefixed host layout | MISSING-NEWER | In a host, `gateline render` resolves the core root from `<prefix>/framework-lock.json` (`resolveCoreRoot`); default prefix `.gateline` | Add |

Counts: 27 claims — OK 15, STALE 5, WRONG 5, MISSING-NEWER 2.

### Current manifest key inventory (all three adapters)

| Key | claude-code | copilot-cli | opencode |
|---|---|---|---|
| `adapter` | `claude-code` | `copilot-cli` | `opencode` |
| `output_dir` | `.claude/agents` | `.github/agents` | `.opencode/agents` |
| `filename` | `{role}.md` | `{role}.agent.md` | `{role}.md` |
| `roles` | analyst, architect, implementer, reviewer, verifier, ops, integrator, historian | same 8 | same 8 |
| `tools_style` | `comma` | `flow-list` | `permission-map` |
| `tool_map.read` | `[Read]` | `[read]` | `[read]` |
| `tool_map.search` | `[Grep, Glob]` | `[search]` | `[grep, glob, list]` |
| `tool_map.write-artifacts` | `[Write]` | `[edit]` | `[edit]` |
| `tool_map.edit-code` | `[Write, Edit]` | `[edit]` | `[edit]` |
| `tool_map.shell` | `[Bash]` | `[execute]` | `[bash]` |
| `model_map.frontier-reasoning` | `fable` | `claude-fable-5` | `openrouter/z-ai/glm-5.2` |
| `model_map.balanced` | `sonnet` | `claude-sonnet-5` | `openrouter/deepseek/deepseek-v4-pro` |
| `model_map.fast-cheap` | `haiku` | `gemini-3-flash` | `openrouter/deepseek/deepseek-v4-flash` |
| `model_overrides` | `{}` | `reviewer: gpt-5.4`, `verifier: gemini-3-flash` | `reviewer: openrouter/moonshotai/kimi-k2.6`, `verifier: openrouter/minimax/minimax-m3` |
| `model_vendors` | fable/sonnet/haiku → `anthropic` | claude-fable-5, claude-sonnet-5 → `anthropic`; gpt-5.4 → `openai`; gemini-3-flash → `google` | glm-5.2 → `z-ai`; deepseek-v4-pro/flash → `deepseek`; kimi-k2.6 → `moonshotai`; minimax-m3 → `minimax` |
| `extra_frontmatter` | `{}` | `disable-model-invocation: true`, `user-invocable: true` | `mode: all` |
| `headless.command` | `claude -p {prompt} --output-format json --permission-mode bypassPermissions` | `copilot -p {prompt} --agent {role} --allow-all-tools` | `opencode run {prompt} --agent {role} --format json --auto` |
| `headless.dispatch_prompt` | "Use the {role} subagent, running it in the foreground — … {body}" | `{body}` | `{body}` |
| `headless.session_field` | — | — | `sessionID` |
| `headless.resume_args` | — | — | `["--session", "{session}"]` |
| `headless.usage_report.format` | `json-stdout` | `static-estimate` | `ndjson-sum` |
| `headless.usage_report.fields` | `cost_usd: total_cost_usd`, `tokens_in: usage.input_tokens`, `tokens_out: usage.output_tokens` | — | `cost_usd: part.cost`, `tokens_in: part.tokens.input`, `tokens_out: part.tokens.output` |
| `headless.usage_report.line_filter` | — | — | `{type: step_finish}` |
| `headless.usage_report.error_field` / `result_field` | `is_error` / `result` | — | — |
| `_comment_*` keys | `_comment_models`, `_comment_model_vendors`, `_comment_headless` | same three | `_comment_tools`, `_comment_models`, `_comment_reviewer_pending_swap`, `_comment_model_vendors`, `_comment_mode`, `_comment_headless`, `headless._comment_resume` |

Renderer reads: `adapter, output_dir, filename, roles, tools_style, tool_map, model_map, model_overrides?, extra_frontmatter?`. Orchestrator reads: `headless.*` (`manifest.ts`), `model_vendors` (router). `TOOL_VERSION` of the integration lock format: `0.2`.

---

## reference/contract-grammar.html

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | Lede: two rule families, bounce not guess, third grammar for commits | OK / MISSING-NEWER | A third tooling-parsed contract line exists: `AUDIENCE:` (spec.md, review-report.md) — Gatehouse folds audit-time sections; AGENTS.md calls it contract meaning | Mention AUDIENCE |
| 2 | "Nine contracts" | WRONG | **Ten**: `release-plan.md` (Ops → gate G3; GRAMMAR + BUDGET + READABILITY; added #260) | Add row; retitle |
| 3 | `work-item.yaml` "Produced by Architect" | OK / MISSING-NEWER | In a patch run it is authored by the human alongside the intent brief (`--task-file`) | Add "(or the human in `patch`)" |
| 4 | `intent-brief.md` "Human (or analyst in v1)" | WRONG | Contract: "Author: a human"; consumer Analyst, or in a patch run the Implementer/Reviewer directly. Nothing in v1 has the analyst author a brief | "Human" |
| 5 | `validate.ts` implements required-section checks (`validateArtifact`, `missingSections`, `extractSections`, `BUILTIN_SECTIONS`) | OK / MISSING-NEWER | Also `extractAudience`, `BUILTIN_AUDIT_SECTIONS`, `verdictLines`, `verificationVerdict`, `VERIFICATION_VERDICTS`, `BUILTIN_WORK_ITEM_KEYS`, `contractFor`; required sections are read from the target repo's own `contracts/` at read time, built-ins are the fallback | Extend |
| 6 | R/AC/ADR parsed in `lexicon.ts` | OK | `packages/core/src/view-model/lexicon.ts` | Repath |
| 7 | E-block parsed in `evidence.ts` `E_HEADING` | OK | `packages/core/src/view-model/evidence.ts` (`/^#{1,6}\s*(E\d+)\s+—\s+(AC\d+\.\d+)/`) | Drop line ref |
| 8 | "The F-finding shape has **no parser anywhere in `core/`** … a template convention, not machine-enforced" | WRONG (now) | `packages/core/src/view-model/review.ts` parses `### F<n> — <severity> — <title>` (`FINDING_HEADING`, also tolerating `### F1 (blocking) — …`) and the round ≥ 2 disposition lines `- **F<n> — resolved|stands** — …` (`RESOLUTION`); `packages/orchestrator/src/review-report.ts` reads the `**Verdict:**` lines | Rewrite |
| 9 | "`review-report.md` carries BUDGET, ESCALATE SCOPE, and READABILITY only — no normative shape rules" | WRONG (now) | It carries BUDGET, ESCALATE SCOPE, READABILITY, **AUDIENCE** (`Coverage=audit; Boundary check=audit`) and **VERIFY ROUND** ("tooling reads exactly these two disposition words and no others"); the Coverage table is "the mandated shape" | Rewrite |
| 10 | Shapes table: R, AC, ADR, E, F | OK | All five match the contracts; AC items may carry a `[ ]`/`[x]` checkbox | — |
| 11 | `ID_PATTERN = \b(?:R\d+|AC\d+\.\d+|ADR-\d+)\b`, regex names | OK | Verbatim | — |
| 12 | Human-facing sections: spec Context (~150/250 words), plan Approach (350) + ADR Rejected/Consequences, review Coverage, verification Beyond the happy path + Gaps | OK / MISSING-NEWER | Add **release-plan.md**: CI health, Rollback plan, Verification after release, Blast radius (five-rule set) | Add |
| 13 | Shared five-rule READABILITY set (a)–(e) wording | OK | Matches spec/plan/verification-report/release-plan word for word (see below) | Say "four contracts" |
| 14 | Coverage: "(b) one bullet per area checked — terse lines, never chained into a paragraph, any paragraph over 120 words in breach" | WRONG (now) | Rule (b) is now the **Coverage table**: "one row per requirement or area checked. The table is the shape — a bullet list or a paragraph in its place is in breach. Cites live in the Where column, one location per row; the Mechanism column says what was checked in a clause, never a chain of clauses." | Replace |
| 15 | Coverage (a) and (c) | OK | (a) same; (c) "Name before cite: … on first use **in the opening sentence**" | Add the tail |
| 16 | Commit grammar table (approved / staged / armed / bot verbs) | OK / MISSING-NEWER | Contract reserves two more human forms: `state(<slug>): closed by <name> [disposition: <as>]`, `state(<slug>): reopened to <phase> by <name> (was closed as <disposition>)`; approve-and-hold appends ` and held (<reason>)`. The CLI also writes `G<N> declined by <name>`, `escalation #<i> resolved by <name> [disposition: …]`, `paused by <name> (<reason>)`, `resumed to <phase> by <name> …` (actions.ts) | Add rows |
| 17 | Bot identity "`agentic-orchestrator`, one per install" | STALE | `gateline-orchestrator` (`BOT_IDENTITY`, email `orchestrator@gateline.invalid`) | Rename |
| 18 | "engine has no code path that writes `gates.*`" | OK | Also never writes `closure` (AGENTS.md) | Add |
| 19 | Tooling list (lexicon, evidence, validate, actions) | OK / MISSING-NEWER | `DecisionAction` now `approve | decline | resolve-escalation | pause | resume | arm | close | reopen`; add `view-model/review.ts` (findings/dispositions), `record/validate.ts` `verdictLines` (verification verdict, shared by engine and Gatehouse), `orchestrator/src/review-report.ts` and `verification-report.ts` | Extend |
| 20 | Evidence `frontend/packages/...` (16×) | STALE | `packages/...` | Repath |

Counts: 20 claims — OK 11, STALE 2, WRONG 5, MISSING-NEWER 2.

### Current contract list (`contracts/`, 10 files)

| Contract | Produced by | Consumed by | Gate | Normative header blocks | Required sections (H2) / keys |
|---|---|---|---|---|---|
| `intent-brief.md` | Human | Analyst (patch: Implementer/Reviewer directly) | — | (optional `## Profile` section) | Problem, Motivation, Constraints, Out of scope |
| `spec.md` | Analyst | Architect, Reviewer, Verifier | G0 | GRAMMAR, BUDGET, READABILITY (Context), AUDIENCE `Out of scope=audit` | Context, Requirements, Assumptions, Out of scope |
| `plan.md` | Architect | Implementers, Reviewer | G1 | GRAMMAR, BUDGET, READABILITY (Approach; each ADR's Rejected and Consequences) | Approach, Interface contracts, Decisions (ADRs), Requirement → task mapping, Risks |
| `work-item.yaml` | Architect (patch: the human) | one Implementer | G1 | all top-level keys required | id, title, requirements, scope, file_contact_surface, acceptance_tests, depends_on, status, notes |
| `review-report.md` | Reviewer | Implementer, gate G2 | — | BUDGET, ESCALATE SCOPE, READABILITY (Coverage), AUDIENCE `Coverage=audit; Boundary check=audit`, VERIFY ROUND | Findings, Coverage, Boundary check (+ Verify round for round ≥ 2) |
| `verification-report.md` | Verifier | gate G2 | — | GRAMMAR, VERDICT, BUDGET, READABILITY (Beyond the happy path, Gaps) | Results, Beyond the happy path, Gaps |
| `release-plan.md` | Ops | gate G3 | — | GRAMMAR, BUDGET, READABILITY (CI health, Rollback plan, Verification after release, Blast radius) | CI health, Release steps, Rollback plan, Verification after release, Blast radius |
| `state.yaml` | Human + Orchestrator | everyone | — | writer/provenance + commit grammar header | see state-yaml section |
| `docs-delta.md` | Historian | human reviewing the sweep branch | (merge) | BUDGET | Drift found, Applied changes, Proposed actions, Escalations, Surfaces checked, no drift |
| `integration-profile.md` | Integrator | GI human, later runs | GI | BUDGET | Environment probe, Gate mapping, Conventions map, Guardrail register, Decorrelation assessment, Runs location, Dispatch reality, Gate GI record |

### Exact rule wording

**GRAMMAR lines**

- spec.md: "requirement headings exactly `### R<n> — <short name>`; criteria as list items whose text begins `AC<n>.<m> — `. A deviation is a malformed artifact."
- plan.md: "decision headings `### ADR-<n>: <decision>`, or with an optional qualifier `### ADR-<n> (<qualifier>): <decision>` — e.g. an amendment note. A deviation is a malformed artifact."
- verification-report.md: "evidence-block headings exactly `### E<k> — AC<n>.<m>`; the Criterion column carries the bare `AC<n>.<m>` id; one overall `**Verdict:** pass | fail | escalate` line. A deviation is a malformed artifact." VERDICT: "exactly one of the three words, alone on its line — `fail — see Gaps` is a deviation, not a verdict. … A re-verification appended to this report adds its own verdict line; the last line is the verdict in force."
- release-plan.md: "the preamble fields `**Change released:**`, `**Environment:**`, `**Rollback trigger:**` and `**Rollback exercised:**` appear as bold-label lines exactly as spelled here; Release steps is an ordered (numbered) list, one act per item. A deviation is a malformed artifact."
- review-report.md VERIFY ROUND (round ≥ 2): "Disposition each prior finding in one compact line instead of restating it — grammar `- **F<n> — resolved|stands** — <one-line reason>`; "stands" is the only word for a finding that is not resolved; tooling reads exactly these two disposition words and no others. A defect the delta introduces … is a full new finding (`### F<n> — <severity> — <title>`, the same fields as any other), never a third disposition word."
- AUDIENCE (spec.md, review-report.md): "AUDIENCE (normative — tooling parses the `AUDIENCE:` line): decide-time sections are what the G<N> approver weighs at the gate; audit-time sections are evidence, read when trust is in question, and Gatehouse folds them to their heading until opened. Unlisted sections are decide-time." Lines: `AUDIENCE: Out of scope=audit` (spec); `AUDIENCE: Coverage=audit; Boundary check=audit` (review).

**Shared READABILITY set** (spec.md Context; plan.md Approach + ADR Rejected/Consequences; verification-report.md Beyond the happy path, Gaps; release-plan.md CI health, Rollback plan, Verification after release, Blast radius). Preamble: "(normative — human-facing section(s): …). The G<N> approver reads it/these as prose; a breach is bounced like a grammar deviation, with the rule cited."

- (a) "The first sentence states the takeaway in plain words — no code spans, paths, or parenthetical cites."
- (b) "One idea per paragraph: at most 4 sentences and 120 words each."
- (c) "Three or more parallel items (<examples vary per contract>) become a bulleted list under a lead-in sentence — never a semicolon chain."
- (d) "One claim per sentence; never join clauses with a semicolon."
- (e) "Name before cite: give any id or file a noun phrase on first use ("the ordering rule (R5)"), at most one parenthetical file:line cite per sentence, full path at first mention only — short name after." (release-plan adds "id, file, or environment"; verification-report omits the example.)

**review-report.md Coverage READABILITY** (three rules): "(a) Open with one plain-words sentence stating overall coverage — no code spans, paths, or parenthetical cites. (b) Then the Coverage table (shape below): one row per requirement or area checked. The table is the shape — a bullet list or a paragraph in its place is in breach. Cites live in the Where column, one location per row; the Mechanism column says what was checked in a clause, never a chain of clauses. (c) Name before cite: give any id or file a noun phrase on first use in the opening sentence." Table columns: `Requirement | Where | Mechanism checked | Status` (Status ✓, ✗, partial, n/a).

**Commit grammar** (`contracts/state.yaml`): human, reserved — `state(<slug>): G2 approved by <name> [burden: light-correction]`, `state(<slug>): staged by <name> [client-key: <key>]`, `state(<slug>): armed by <name>`, `state(<slug>): closed by <name> [disposition: already-delivered]`, `state(<slug>): reopened to <phase> by <name> (was closed as <disposition>)`; orchestrator, bot identity only — `state(<slug>): dispatched|bounced|advanced|escalated|paused|metered …` (docs and README add `harvested`).

---

## Summary

| Page | Claims | OK | STALE | WRONG | MISSING-NEWER | Retired-name hits |
|---|---|---|---|---|---|---|
| index.html | 8 | 2 | 3 | 0 | 3 | 3 |
| cli.html | 42 | 20 | 8 | 1 | 13 | 66 (`agentic` 31, `frontend/` 33, `upgrade` 2) |
| state-yaml.html | 26 | 17 | 3 | 1 | 5 | 9 (`frontend/`) |
| orchestrator-yaml.html | 13 | 10 | 1 | 0 | 2 | 5 (`frontend/`) |
| adapter-manifests.html | 27 | 15 | 5 | 5 | 2 | 21 (`render-agents.py`/`render_permission_map` 13, Python 8) |
| contract-grammar.html | 20 | 11 | 2 | 5 | 2 | 17 (`frontend/` 16, `agentic-orchestrator` 1) |
| **Total** | **136** | **75** | **22** | **12** | **27** | **121** |

### Five most consequential findings

1. **adapter-manifests.html describes a tool that no longer exists.** The entire "How render-agents.py consumes manifests", "Render script constraints" and CI-command content is Python (`scripts/render-agents.py`, `python3 … --check`, stdlib/3.9/PEP 604). Since 2026-09-16 (#371/#372) the renderer and integration tooling are `@gateline/framework` (`gateline render|init|validate|fork`, `node packages/framework/src/main.ts render --check`, zero runtime dependencies). Roughly a third of the page must be rewritten, not just renamed.
2. **cli.html is missing seven commands and a binary rename.** `close`, `reopen` (2026-08-02), `render`, `init`, `validate`, `fork` (2026-09-16) are absent; `upgrade` is now `self-update`; `--agentic-prefix` is `--gateline-prefix`; `new --task-file`, `resume --cost-limit`, `up/orchestrator --spend-window` are absent; the runner-agent has seven flags the page does not list; and there are now five bins, not three. The inventory above is complete enough to rebuild the page.
3. **contract-grammar.html makes two claims that are now false and undercounts the contracts.** The F-finding shape *is* parsed (`view-model/review.ts`, plus the `resolved|stands` disposition grammar), review-report.md carries normative AUDIENCE and VERIFY ROUND blocks, the Coverage rule (b) is a mandated table rather than bullets, and there are ten contracts (`release-plan.md` with its own GRAMMAR and READABILITY set), not nine.
4. **state-yaml.html omits the `closed` phase and the `closure` record**, states the `failed` ledger flag is "not in the contract" (it is, with `refused`, `engine`, `session` beside it), and calls the co-writer contract six-point when ORCHESTRATOR.md §7 now lists seven (the "gate on the table" rule, #344, which the CLI, API and PR-sync all enforce). `slug-landed` is a paused reason the schema knows and the contract comment does not.
5. **Every binary, package and path name on all six pages is pre-rename** — `agentic`/`agentic-orchestrator`/`agentic-runner-agent` → `gateline-*`, `frontend/packages/` → `packages/`, bot identity `gateline-orchestrator` — 121 occurrences in total, plus one behavioural error in cli.html: the CLI does not "re-derive" on a CAS refusal, it exits 2 and the human reruns.

Minor but worth doing in the same pass: `--spend-limit-usd` is now documented as a rate limit that *defers* (never pauses); `inbox`/`status` grew SUPERSEDED and closure/paused suffixes; `arm` refuses a stub patch work item; orchestrator.yaml's S1/S3 read remote-tracking refs; the registry's OpenRouter pricing note has been reworded (fallback path, not "reference-only").
