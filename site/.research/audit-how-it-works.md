# Accuracy and currency audit — the previous (private) docs repository How-It-Works pages

Audited 2026-09-18 against `the framework checkout` at `main` (`1633ed7`, tag `v0.3.0`).
Pages: `index.html`, `how-it-works/index.html`, `how-it-works/how-a-run-works.html`,
`how-it-works/how-gates-keep-a-human-in-charge.html`,
`how-it-works/how-gateline-stays-vendor-neutral.html`, `404.html`. Only the text between
`<!-- content:start -->` and `<!-- content:end -->` was read (SVG `<text>` nodes included).

Status key: **OK** — true now. **STALE** — was true at write time, a name/path/count moved.
**WRONG** — not true now (or names a thing that no longer exists). **UNVERIFIABLE** — not a
framework claim (site-internal link or property). **MISSING-NEWER** is recorded in the
per-page omissions lists, not as a table status, except where an OK claim is now materially
incomplete (noted in the "true now" column).

Counts (claims): index 21 — OK 14 / STALE 4 / WRONG 0 / UNVERIFIABLE 3 ·
how-it-works/index 11 — OK 11 ·
how-a-run-works 50 — OK 44 / STALE 4 / WRONG 1 / UNVERIFIABLE 1 ·
how-gates 53 — OK 38 / STALE 13 / WRONG 1 / UNVERIFIABLE 1 ·
vendor-neutral 41 — OK 36 / STALE 2 / WRONG 2 / UNVERIFIABLE 1 ·
404 — 0 framework claims (4 site links, out of scope).

---

## 1. `index.html`

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "Run the software development lifecycle as a team of semi-autonomous agents — with a named human approving at every phase gate" | OK | README.md lede; DESIGN.md §2 P4. | — |
| 2 | "Agents never share a conversation; they share typed artifacts in git — a spec, a plan, work items, review and verification reports" | OK | DESIGN.md §1, §5 artifact table. | — |
| 3 | "**Gatehouse** is the web UI where humans review gate packets and record decisions" | OK | AGENTS.md "Names". | — |
| 4 | "the `agentic` CLI and the v1 orchestrator engine run alongside it" | STALE | CLI is `gateline` (`packages/cli/src/main.ts`, `program.name('gateline')`); engine binary is `gateline-orchestrator`; `gateline up` runs Gatehouse + engine over one clone as the blessed topology (AGENTS.md Commands; TOPOLOGY.md §3.1). | `the <code>gateline</code> CLI and the v1 orchestrator engine — <code>gateline up</code> runs both over one clone` |
| 5 | "You start human-orchestrated … autonomy increases along a measured trust ladder and stays gated on evidence — gate reviews that have become confirmations rather than corrections" | OK | DESIGN.md §7; ORCHESTRATOR.md §10; AGENTS.md status line. | — |
| 6 | "An artifact missing a required section is malformed, and the consuming agent's first duty is to bounce it back … never to guess" | OK | DESIGN.md §5; AGENTS.md invariant on contracts. | — |
| 7 | "The engine dispatches agents, meters spend, and moves the state file forward — but it may not record a gate decision" | OK | ORCHESTRATOR.md §3; `packages/orchestrator/README.md`. Now also never writes `closure` (ORCHESTRATOR.md §4.5 "Closing a run"; AGENTS.md invariant). | Optionally: "may not record a gate decision or close a run" |
| 8 | "That prohibition is built into the code rather than instructed" | OK | ORCHESTRATOR.md §3 "no code path that writes `gates.*.approved`". | — |
| 9 | "a deterministic loop that meets a state it has no rule for escalates instead of improvising" | OK | ORCHESTRATOR.md §3 "Honest failure". | — |
| 10 | evidence comment `frontend/packages/orchestrator/README.md` | STALE | `packages/orchestrator/README.md` (`frontend/` → `packages/`, #133). | Update path |
| 11 | "No role knows which model executes it … models are bindings resolved in a single registry, and runtimes attach through thin generated adapters" | OK | DESIGN.md §2 P2/P3, §6, §8. | — |
| 12 | "no vendor or model name may appear in `roles/` or `contracts/`" | OK | AGENTS.md invariants. | — |
| 13 | "A run is one change … from a one-page brief to a merged branch. Four gates mark the phase boundaries" | OK | DESIGN.md §4 (full profile; fewer under `patch`/`standard`, which the page says next). | — |
| 14 | Gate table G0–G3: questions and artifacts on the table | OK | DESIGN.md §4 gate table (G2: `review-report.md`, `verification-report.md`; G3: `release-plan.md`, rollback plan — `contracts/release-plan.md` now exists). | — |
| 15 | "`patch`, `standard`, and `full` are fixed sets, and they nest" | OK | DESIGN.md §4.1; `packages/core/src/record/schema.ts` `PROFILES`, `PROFILE_GATES`. | — |
| 16 | "Generated interface documentation for `@agentic/core`, the orchestrator, server, CLI, and runner agent" (path grid) | STALE | Packages are `@gateline/*` (`@gateline/core`, `@gateline/orchestrator`, server, cli, runner-agent, web, and the new `@gateline/framework`). | `@gateline/core`; consider adding `framework` |
| 17 | "TypeDoc-generated interface documentation for `@agentic/core`, the orchestrator, server, CLI, and runner agent" (section-nav card) | STALE | Same as 16. | `@gateline/core` |
| 18 | "Open source, Apache-2.0" | OK | `LICENSE.md`, `NOTICE.md`, AGENTS.md "Project posture". | — |
| 19 | "created and maintained by Nathan Carter as an independent personal work, and released under the Apache-2.0 license" | OK | `NOTICE.md`. | — |
| 20 | "Static documentation — no tracking, no external assets" | UNVERIFIABLE | Site property, not a framework claim. | — |
| 21 | Onboarding/Reference/API blurbs (git object model, state and schedule schemas, adapter manifests, contract grammar) | UNVERIFIABLE | Site sections outside this audit's scope. | — |

**Omitted, now true, worth adding (index):**
- The repository has been public since 2026-09-16 (AGENTS.md "Project posture"); `v0.3.0` is the first tag (2026-09-18, `1633ed7`). "published package releases remain a later step".
- `gateline up` is the blessed topology: Gatehouse + engine over one clone (TOPOLOGY.md §3.1). The hosted `deploy/` recipe is a documented self-host option.
- Runs can end short of `done` via `gateline close --as already-delivered|superseded|obsolete|abandoned` and `reopen` (schema.ts `CLOSURES`; ORCHESTRATOR.md §4.5).
- Integration tooling is `gateline init|validate|fork` in the dependency-free Node package `@gateline/framework`; only content (roles, contracts, templates) vendors into a host, never executables (INTEGRATION.md §3; `scripts/copy-manifest.json`).
- The four packages named for API docs are now six-plus: `core`, `server`, `web`, `cli`, `orchestrator`, `runner-agent`, `framework`.

---

## 2. `how-it-works/index.html`

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "the shape of a run, the structure that keeps a named human in charge of it, and the separation that keeps the whole pipeline independent of any one model vendor" | OK | DESIGN.md §1, §2, §4, §7. | — |
| 2 | "every falsifiable claim carries a source comment in the page markup" | OK | Observed (`<!-- evidence: -->` comments present); many paths are stale — see per-page tables. | Refresh evidence paths |
| 3 | "the four gates and the question each asks" | OK | DESIGN.md §4. | — |
| 4 | "the run directory as the entire pipeline state, `state.yaml` as its spine" | OK | `runs/README.md`; `contracts/state.yaml`. | — |
| 5 | "the three run profiles and how they nest" | OK | DESIGN.md §4.1. | — |
| 6 | "the two-step `new` → `arm` creation seam and the draft pull request" | OK | AGENTS.md Conventions; `packages/cli/src/main.ts` `new`/`arm`. | — |
| 7 | "the one gate-less exception: historian sweeps" | OK | `runs/README.md`; ORCHESTRATOR.md §4.6. | — |
| 8 | "The engine dispatches agents and meters spend, but it cannot sign a gate" | OK | ORCHESTRATOR.md §3. | — |
| 9 | "the co-writer contract that lets a human and the engine share one file safely, the commit grammar that distinguishes their voices" | OK | ORCHESTRATOR.md §7 (now seven conventions — see gates page #11). | — |
| 10 | "one-authority topology and the blessed checkout, approve-and-hold, round caps and the escalation path, and the trust ladder" | OK | TOPOLOGY.md §3.1, §3.5; ORCHESTRATOR.md §4.2, §10. | — |
| 11 | "the closed role roster, the registry as the only place model IDs live, adapters as rendered rather than written … the three shipped adapters" | OK | DESIGN.md §3, §6, §8; `adapters/` has exactly three. | — |

**Omitted, now true, worth adding (hub):**
- Page 1 summary could mention `close`/`reopen` (a run's terminal states are `done` and `closed`), since the run page will need it.
- Page 2 summary says "co-writer contract" — the hub is fine, but the rewrite should say seven conventions, not six.
- The hub says nothing about the Node framework tooling or `gateline render`; page 3's summary should reflect that renders come from `gateline render`, not a script.

---

## 3. `how-it-works/how-a-run-works.html`

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "one change … carried from a one-page brief to a merged branch by a chain of specialized agents, with a named human approving at each phase boundary" | OK | DESIGN.md §1, §4. | — |
| 2 | "Everything the run is … lives in a single directory of files committed to git" | OK | `runs/README.md` ("no state lives anywhere else"). | — |
| 3 | "throughput caps at one conversation, and none of the intermediate reasoning survives the session" | OK | DESIGN.md §1. | — |
| 4 | Three properties: replaceable mid-flight; models/runtimes swappable; "why did we build it this way?" has a `git log` answer | OK | DESIGN.md §1 consequences 1–3. | — |
| 5 | "At full weight a run flows through four phases, each closed by a gate" | OK | DESIGN.md §4; full phase sequence is `spec → plan → implement → integrate → release → done` (five working phases, four gates). | Consider "four gates" rather than "four phases" |
| 6 | "The Analyst turns the intent brief into a testable spec; at G0 …" | OK | DESIGN.md §3, §4. | — |
| 7 | "The Architect turns the spec into a technical plan cut into work items; at G1 …" | OK | DESIGN.md §3, §4. | — |
| 8 | "Each work item then loops between an Implementer and a Reviewer, and a Verifier exercises the finished change end to end; at G2 …" | OK | DESIGN.md §4. | — |
| 9 | "the Ops role prepares release and rollback plans; at G3, 'ship it?'" | OK | DESIGN.md §4; `contracts/release-plan.md`. | — |
| 10 | Gate table (G0–G3) | OK | DESIGN.md §4 table. | — |
| 11 | "Implementer ⇄ Reviewer cycles are capped at three rounds per work item; a fourth round becomes an automatic escalation to the human with both sides' artifacts" | OK | DESIGN.md §4; `schema.ts` `ROUND_CAP = 3`. Newer: resolving the round-cap escalation grants exactly one more round (#342, ORCHESTRATOR.md §4.2; `derive.ts` D4). | Add the one-more-round exit |
| 12 | "agents arguing past three rounds are almost always stuck on an ambiguity in the spec, which is a G0 or G1 defect" | OK | DESIGN.md §4 "Iteration cap". | — |
| 13 | "each run carries a cost budget whose exhaustion pauses the pipeline rather than letting quality degrade silently" | OK | DESIGN.md §4 "Budget cap"; ORCHESTRATOR.md §6. | — |
| 14 | "Reviewer and Verifier are deliberately separate roles … rubber-stamp reviews" | OK | DESIGN.md §3 notes. | — |
| 15 | Diagram: "eight roles, four gates"; "named human merges" at G2; "round 4 → escalate to human" | OK | DESIGN.md §4 diagram. | — |
| 16 | Diagram: `runs/<slug>/state.yaml` — "every step commits" | OK | `runs/README.md` conventions. | — |
| 17 | "`runs/dupefind/`, a completed human-orchestrated run at full weight (its state file predates the profile field, and an absent `profile:` means `full`)" | OK | `runs/dupefind/state.yaml` has no `profile:`; DESIGN.md §4.1. | — |
| 18 | "three work items each verified after two review rounds" | OK | `runs/dupefind/state.yaml` tasks: 3 × `verified`, `review_rounds: 2`. | — |
| 19 | "a hand-appended budget ledger of sixteen entries totaling $12.15 against a $50 limit" | OK | 16 ledger entries; `cost_spent_usd: 12.15`; `cost_limit_usd: 50`. | — |
| 20 | "four gates approved by the same named human with the first three recorded as `burden: confirmation`" | OK | All four `by: nthncrtr`; G0–G2 `notes:` end with the text "burden: confirmation" (inside notes, not a `burden:` field); G3 has none. | Say "noted as" rather than implying a `burden` field |
| 21 | "zero escalations" | OK | `escalations: []`. | — |
| 22 | "A run lives at `runs/<slug>/` on its own branch, `run/<slug>`, and the directory is the pipeline's state" | OK | `runs/README.md`. | — |
| 23 | "Artifacts are committed as they are produced … Once a run merges, its directory is a historical record and is never retro-edited" | OK | `runs/README.md`; AGENTS.md invariant. | — |
| 24 | Run-directory tree (`state.yaml`, `intent-brief.md`, `spec.md`, `plan.md`, `tasks/NN-name.yaml`, `review-NN.md`, `verification-report.md`, `release-plan.md`, `retro.md`) | OK | `runs/README.md`. Newer: the README tree also lists `ux-research.md` and `design/<candidate>/` ("design runs only"); the tree is flat by decision (#31, 2026-09-18). | Optionally add the design-run rows or a note |
| 25 | "`state.yaml` … records the phase and profile; the budget as an append-only ledger — one entry per model invocation, carrying timestamp, role, task, round, adapter, model, tokens, and cost — from which totals are derived rather than maintained" | OK | `contracts/state.yaml` `budget.ledger[]`. Newer optional entry keys: `failed`, `refused`, `engine`, `session`; optional `intake:` and `closure:` blocks. | — |
| 26 | "the gate ledger, one entry per gate with who approved, when, notes, and an optional burden rating" | OK | `contracts/state.yaml` `gates:`. | — |
| 27 | "task statuses and review-round counts; and an append-only escalation list" | OK | `contracts/state.yaml` `tasks:` ("the ONLY home of review_rounds"), `escalations:`. | — |
| 28 | "Every artifact in the tree follows a contract from `contracts/`: required sections and concision budgets, not prose style" | WRONG | Contracts now specify required sections, concision budgets, normative ID/heading grammar, an `AUDIENCE:` line tooling parses, and normative READABILITY rules on human-facing sections (plain-words opening sentence, one idea per paragraph, lists not semicolon chains, name before cite) — breaches of the readability rules are bounced with the rule cited (AGENTS.md invariants; `contracts/spec.md`, `plan.md`, `review-report.md`, `verification-report.md` headers). "Not prose style" is no longer true. | Replace with: "required sections, concision budgets, a parseable ID grammar, and readability rules for the sections a human reads — all equally bounceable" |
| 29 | "An artifact missing a required section is malformed … bounce it back … never to guess" | OK | DESIGN.md §5; AGENTS.md. | — |
| 30 | Profile table: `patch` = Implementer, Reviewer / G1, G2 / plan→implement→integrate→done; `standard` = +Analyst, Architect, Verifier / G0–G2; `full` = all eight / G0–G3 | OK | DESIGN.md §4.1 table; `schema.ts` `PROFILE_GATES`, `PROFILE_PHASES`. Newer: `closed` is a terminal rest state any profile can reach. | — |
| 31 | "`patch` … the human authors the intent brief and the single work item at creation, G1 approves both together, and there is no Verifier" | OK | DESIGN.md §4.1. Newer: `gateline new --task-file <path>` stages it as `tasks/01-<slug>.yaml`. | — |
| 32 | "`standard` … drops Ops and G3 because for most repository work the merge is the release" | OK | DESIGN.md §4.1. | — |
| 33 | "`full` is the complete pipeline, for when deployment is a distinct, risky act" | OK | DESIGN.md §4.1. | — |
| 34 | "Profiles are fixed sets, not knobs: there is no per-run role or gate toggle … pick the next heavier one" | OK | DESIGN.md §4.1, §4.2; AGENTS.md. | — |
| 35 | "The gate ledger carries exactly the profile's gates; a gate outside the profile is absent, never auto-approved" | OK | DESIGN.md §4.1; `contracts/state.yaml` `gates:` comment. | — |
| 36 | "Upgrades are one-way and human-decided … downgrading mid-run is forbidden, and an engine that observes one escalates" | OK | DESIGN.md §4.1; AGENTS.md; `roles/orchestrator.md` instruction 2. | — |
| 37 | "A `state.yaml` with no `profile:` field is a `full` run" | OK | DESIGN.md §4.1; `schema.ts` comment. | — |
| 38 | "The `agentic new` command, one layer up, defaults to `--profile standard`" | STALE | `gateline new` defaults `--profile standard` (and `--budget 50`) — `packages/cli/src/main.ts`. | `gateline new` |
| 39 | evidence `frontend/packages/cli/src/main.ts`; `frontend/packages/core/src/record/schema.ts` | STALE | `packages/cli/src/main.ts`; `packages/core/src/record/schema.ts`. | Update paths |
| 40 | "`runs/creation-seam/` — a `standard` run — lists a G3 entry that today's contract would omit: present but undecided, a compatibility shim for a parser written before per-profile gate sets" | OK | `runs/creation-seam/state.yaml`: `profile: standard`; comment "G3 listed only for pre-#156 parser compatibility"; `G3: {approved: false…}`. | — |
| 41 | "an undecided or absent gate can never masquerade as approved" | OK | DESIGN.md §4.1. | — |
| 42 | Profile diagram: "no profile: field in state.yaml = full"; "upgrade: human edit profile: + resume"; "downgrade: forbidden — the engine escalates" | OK | DESIGN.md §4.1. | — |
| 43 | "`agentic new` stages the record — branch, intent brief, state file — in a paused, inert state (`paused_reason: staged`) … nothing can dispatch against a staged run" | STALE | Name only: `gateline new`. Mechanism holds (`schema.ts` `STAGED_REASON`; `contracts/state.yaml` `paused_reason` enum; AGENTS.md). | `gateline new` |
| 44 | "`agentic arm` is what makes it dispatchable: it starts the run at the profile's first undecided-gate phase and ensures the run's draft pull request exists" | STALE | Name only: `gateline arm` — CLI description "arm a staged run — starts it at the profile's first undecided-gate phase"; AGENTS.md "arming is also what ensures its draft PR". | `gateline arm` |
| 45 | "That pull request is generated from the run's own artifacts — the intent brief first, then the spec … until a human edits the body. The edit removes a marker comment … ownership passes to the human permanently" | OK | AGENTS.md Conventions; `packages/core/src/sources/pr-description.ts` (`GENERATED_MARKER = '<!-- gateline:draft-pr -->'`, was `agentic:draft-pr`). | — |
| 46 | "The PR stays a draft, carrying a do-not-merge banner, until the run reaches `done`" | OK | AGENTS.md; `pr-description.ts` `banner()`. Newer: a closed run's banner names the disposition instead. | Optionally mention closed runs |
| 47 | "committed policy in the repo-root `orchestrator.yaml` sets its cadence — in this repository, a sweep every seven days with a $5 pre-flight cost cap" | OK | `orchestrator.yaml`: `every: 7d`, `cost_limit_usd: 5`, `enabled: true`. | — |
| 48 | "A due sweep is dispatched as a mini-run, `runs/historian-<date>/` on branch `run/historian-<date>`, carrying a one-entry ledger and deliberately no `state.yaml`" | OK | `runs/README.md`; ORCHESTRATOR.md §4.6 (`sweep.yaml`). Three sweeps exist: `runs/historian-2026-07-12/`, `-20/`, `-25/`. | — |
| 49 | "a human reviews the `docs-delta.md` and merges the sweep branch — and that merge is the approval" | OK | `runs/README.md`; `roles/historian.md` `gate: none`. Newer: one open sweep per role at a time; sub-daily intervals clamp to daily; the merged marker's `at` makes the next interval derivable (`schedule.ts` S0–S4, SB). | — |
| 50 | Links to `../reference/state-yaml.html`, `../reference/cli.html` | UNVERIFIABLE | Site-internal. | — |

**Omitted, now true, worth adding (run page):**
- **`closed` is a terminal phase alongside `done`**: `gateline close <slug> --as <disposition> --reason <text>` with dispositions `already-delivered | superseded | obsolete | abandoned`; `gateline reopen` undoes it; the engine never closes a run; closing deletes nothing (DESIGN.md §4.1; ORCHESTRATOR.md §4.5; `schema.ts` `CLOSURES`; `contracts/state.yaml` `closure:`).
- The human decision grammar now includes `closed by <name> [disposition: …]` and `reopened to <phase> by <name>` (`contracts/state.yaml` header).
- The round cap has an exit: resolving the round-cap escalation grants one more round, and the engine asks again for each extra round (#342).
- Resume from `budget-exhausted` must carry a higher `cost_limit_usd` in the same commit (`gateline resume --cost-limit`, #96) because the pause is a recomputed condition, not an event.
- `patch` staging: `gateline new --task-file` places the human-authored work item; the `intake:` block records staging provenance (`source`, `ref`, `client_key`, `staged_by`).
- DESIGN.md §4.2 "closed vocabulary, open table" — why gate and profile sets are fixed: evidence-bearing positions (Implementer, Reviewer, Verifier, Orchestrator-as-emitter) vs production roles; adopter roles may add evidence to an existing gate's table but never mint a gate; `G<n>` names are reserved.
- `runs/` stays flat by decision (#31, 2026-09-18); an archival tier bounds it later.
- Design runs add `ux-research.md` and `design/<candidate>/` to the tree (`runs/README.md`).
- Ledger entries can be `failed`/`refused` (a refusal meters $0), and carry `engine` and `session` keys (same-round retry resumes the agent's harness session, #181).
- The orchestrator-driven run set has grown beyond `creation-seam`: `web-staging`, `fleetview-design`, `gate-redesign`, `escalation-visibility-2`, `integration-hardening`, `local-only-mode`, `runner-agent`, `writestate-kill-window`.

---

## 4. `how-it-works/how-gates-keep-a-human-in-charge.html`

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "In an orchestrator-driven run, the engine dispatches the agents, meters the spend, and moves the state file forward" | OK | ORCHESTRATOR.md §1, §4. | — |
| 2 | "two operating modes. In v0 a human plays the Orchestrator … In v1 an engine executes the same role spec … only who executes `orchestrator.md` changes" | OK | DESIGN.md §7; ORCHESTRATOR.md §1. | — |
| 3 | "The engine is a stateless reconciler. It wakes on a trigger, reads `state.yaml` at the run branch tip, derives the next action from committed files alone, executes it, commits, and exits" | OK | ORCHESTRATOR.md §2 "Execution model". | — |
| 4 | "a gate wait is simply a state from which no action derives" | OK | ORCHESTRATOR.md §2, §4.2. | — |
| 5 | "The engine has no code path that writes `gates.*.approved`" | OK | ORCHESTRATOR.md §3; `packages/orchestrator/README.md`. Newer: `closure` is on the same read-only list (§4.5). | Optionally "`gates.*` or `closure`" |
| 6 | "the Orchestrator owns the gates in the sense that it presents them, and it must halt until a named human records approval" | OK | `roles/orchestrator.md` (`gates_owned: … # presents them; never approves them`; instruction 3). | — |
| 7 | "a deterministic loop that meets a state it has no rule for escalates, where a model in the same position would improvise" | OK | ORCHESTRATOR.md §3. | — |
| 8 | evidence `frontend/packages/orchestrator/README.md` (structural "never") | STALE | `packages/orchestrator/README.md`. | Update path |
| 9 | "`state.yaml` is the entire control plane in both directions — there is no orchestrator API, config channel, or command queue" | OK | ORCHESTRATOR.md §4.5. | — |
| 10 | "Humans speak through Gatehouse, the framework's web UI, and the `agentic` CLI" | STALE | `gateline` CLI (ORCHESTRATOR.md §7). | `gateline` |
| 11 | "the co-writer contract supplies six: CAS; comment-preserving YAML; ISO-8601; structured commit grammar under distinguishable identities; review-round counts only in `state.yaml`; enums" | STALE | ORCHESTRATOR.md §7 now lists **seven** conventions. The seventh (#344): a gate decision is legal only for the gate on the table — the profile's first un-approved gate, while the run stands in a phase that gate is decided in; Gatehouse, the CLI, the API and the PR-approval sync all refuse an out-of-order approval. | "seven", and add the gate-on-the-table rule |
| 12 | CAS description: read tip, edit, commit, update the ref only if it still points at the commit read; loser discards and re-derives | OK | ORCHESTRATOR.md §4.3; `packages/core/src/sources/git.ts` `updateRefCAS()` (`git update-ref <ref> <new> <expected-old>`). | — |
| 13 | evidence `frontend/packages/core/src/sources/git.ts` | STALE | `packages/core/src/sources/git.ts`. | Update path |
| 14 | "A refused write is the designed outcome of a race, not an error, and it is how a human decision always wins" | OK | ORCHESTRATOR.md §1 (quoting FRONTEND-PLAN §11), §7 convention 1. | — |
| 15 | "Engine commits are authored by a dedicated bot identity (`agentic-orchestrator`, one per install)" | STALE | The identity is `gateline-orchestrator` `<orchestrator@gateline.invalid>` (`packages/orchestrator/src/start.ts`; `packages/orchestrator/README.md`). The historical creation-seam commits carry the old `agentic-orchestrator` name — quoting them is fine; naming the current identity that way is not. | `gateline-orchestrator` |
| 16 | Verbs "`dispatched`, `bounced`, `advanced`, `escalated`, `paused`, `metered`, `harvested`" | OK | ORCHESTRATOR.md §4.3; README; AGENTS.md. | — |
| 17 | "The decision grammar — `G2 approved by <name>`, `staged by <name>`, `armed by <name>` — is reserved for humans" | OK | `contracts/state.yaml` header. Newer: `closed by <name> [disposition: …]`, `reopened to <phase> by <name> (was closed as <disposition>)`; `staged by` may carry `[client-key: <key>]`. | Add `closed by` / `reopened … by` |
| 18 | "the metrics reader treats it as authoritative" | OK | ORCHESTRATOR.md §4.3. | — |
| 19 | Log excerpt `c4b9d95 state(creation-seam): G2 approved by Nathan Carter [burden: confirmation]` / `fdef5f2 state(creation-seam): metered verifier $3.11` | OK | Both commits exist with exactly those subjects (`git show c4b9d95 fdef5f2`); `fdef5f2` is authored by the then-named `agentic-orchestrator`. | — |
| 20 | "The `creation-seam` record shows both hands in the same file: ledger entries written by the engine with true per-dispatch token counts, and gate entries written by the named human, each carrying a burden rating" | OK | `runs/creation-seam/state.yaml`: G0 `burden: light-correction`, G1/G2 `confirmation`; ledger entries with `tokens_in`/`tokens_out`. | — |
| 21 | Diagram text "human — via Gatehouse / agentic CLI" | STALE | `gateline` CLI. | `gateline CLI` |
| 22 | Diagram text "bot identity: agentic-orchestrator" | STALE | `gateline-orchestrator`. | Update |
| 23 | Diagram text "six rules: CAS writes · comment-preserving YAML · ISO-8601 timestamps · structured commit grammar · review_rounds only here · contract enums only" | STALE | Seven (see #11). | "seven rules … · gate-on-the-table only" |
| 24 | Diagram: `refs/heads/run/<slug>` — "update-ref (CAS) only if ref still = the commit I read"; "✕ refused → discard; re-read; re-derive" | OK | ORCHESTRATOR.md §4.3. | — |
| 25 | "Implementer ⇄ Reviewer cycles are capped at three rounds per work item; a fourth round escalates automatically, with both sides' artifacts" | OK | DESIGN.md §4; `ROUND_CAP = 3`. Newer: one-more-round grant on resolution (#342). | Add the exit |
| 26 | "every model invocation flows through the dispatch seam and is metered into the run's budget ledger, and before any dispatch the engine projects the ledger sum plus a static per-role estimate against the run's cost limit" | OK | ORCHESTRATOR.md §6; `registry/models.yaml` `dispatch_estimates_usd`. | — |
| 27 | "A projected exceedance pauses the run as `budget-exhausted` and escalates — exhaustion pauses the pipeline; it never degrades quality" | OK | ORCHESTRATOR.md §6; `schema.ts` `BUDGET_REASON`. Newer: resume needs a higher `cost_limit_usd` in the same commit (#96); host-level rolling-window `--spend-limit-usd`/`--spend-window` defers rather than pauses (#97); a refused dispatch meters $0 (#155). | Add the resume rule |
| 28 | "Operators on flat-rate-billed harnesses can start the engine with `--no-budget-enforcement`; the ledger, derived totals, and token counts record regardless" | OK | `packages/orchestrator/src/main.ts`; also on `gateline up`; ORCHESTRATOR.md §6 (#109). | — |
| 29 | "With the ledger at $44.02, the engine projected $68.02 against the run's $60 limit, paused, and escalated" | OK | `runs/creation-seam/state.yaml` `escalations[0]`: "projected spend $68.02 (ledger $44.02 + estimates) exceeds cost_limit_usd $60". | — |
| 30 | "The human resolved the escalation by restarting the engine with budget enforcement disabled and resuming" | OK | `resolution: restarted orchestrator with budget constraints disabled -- resuming`. | — |
| 31 | "the record closes at $104.54 spent against the original $60 limit" | OK | `cost_spent_usd: 104.54`, `cost_limit_usd: 60`, `phase: done`. | — |
| 32 | "`agentic approve --hold <reason>` signs the gate and sets `phase: paused` in the same commit … resume releases it into whatever phase the gate ledger implies" | STALE | Name only: `gateline approve --hold <reason>` (`packages/cli/src/main.ts`; ORCHESTRATOR.md §4.2). | `gateline approve --hold` |
| 33 | evidence `frontend/packages/cli/src/main.ts` (approve-and-hold) | STALE | `packages/cli/src/main.ts`. | Update path |
| 34 | "Gatehouse and the engine run as one supervised unit over one clone — the `agentic up` topology — with one sync loop and one push path" | STALE | `gateline up` (TOPOLOGY.md §3.1; CLI `up` description "the single-authority deployment"). | `gateline up` |
| 35 | "the git host's origin is the linearization point, so a dispatch is armed only once its intent commit has been accepted by origin" | OK | TOPOLOGY.md §3.2 (push-then-launch). Newer: **local-only** is a first-class topology (§3.6) where neither writer pushes or fetches. | Mention local-only |
| 36 | "the topology design records a day of split deployment in which an engine kept deriving against a stale budget limit, and machine bookkeeping and human decisions accumulated on divergent histories that needed manual repair" | OK | TOPOLOGY.md §1 (#104, #103, #100). | — |
| 37 | "The blessed checkout stays on the default branch, and a code-tree monitor enforces it" | OK | TOPOLOGY.md §3.5; ORCHESTRATOR.md §13; AGENTS.md invariant; `packages/core/src/sources/code-tree.ts`. | — |
| 38 | "Only a clean fast-forward of the default branch counts as an update; on one, the engine drains in-flight work and exits with code 75 … a supervisor restarts (unsupervised, the operator restarts it by hand)" | OK | `code-tree.ts` `SUPERSEDE_EXIT_CODE = 75`; ORCHESTRATOR.md §13. Newer: a fast-forward must be seen on two consecutive boundary checks (debounce). | — |
| 39 | "A dirty tree, a branch switch, or any non-fast-forward movement pauses dispatch instead" | OK | ORCHESTRATOR.md §13 states table (`paused`). | — |
| 40 | "it never pulls: updating is always an operator act (`git pull`, or `agentic upgrade`)" | WRONG | `agentic upgrade` does not exist; the command is `gateline self-update` (git pull --ff-only, npm install, rebuild web dist) — `packages/cli/src/main.ts`; ORCHESTRATOR.md §13; AGENTS.md Commands. | `gateline self-update` |
| 41 | "Unmerged changes are tried from their own worktree with `agentic ui` — never `up`" | STALE | `gateline ui` (TOPOLOGY.md §3.5; AGENTS.md). | `gateline ui` |
| 42 | "v0 exists so the team builds a calibrated sense of where agents are strong before granting routing autonomy" | OK | DESIGN.md §7. | — |
| 43 | "The promotion criterion is explicit — gate reviews have become confirmations rather than corrections" | OK | DESIGN.md §7. | — |
| 44 | "the gate frontend records a burden (`confirmation`, `light-correction`, or `heavy-correction`) in the act of deciding, and hand-recorded decisions are expected to set it" | OK | `contracts/state.yaml` `gates:` comment; `schema.ts` `BURDENS`; CLI `approve --burden` (prompted on a TTY). | — |
| 45 | "M0 lands the contracts and a hand-kept ledger" | OK | ORCHESTRATOR.md §10 table. | — |
| 46 | "M1 runs the engine in shadow mode — a dry-run tick against finished v0 runs … the bar was three full runs with every disagreement dispositioned" | OK | ORCHESTRATOR.md §10; README `tick --dry-run`, `shadow <slug>`. | — |
| 47 | "M2 is the autonomous loop on one vendor, and it does not begin until the promotion criterion is credibly met" | OK (as design text) | ORCHESTRATOR.md §10 "autonomy gate". Materially incomplete: M2 has happened — the engine has driven real runs (`runs/creation-seam/`, `web-staging/`, `fleetview-design/` per DESIGN.md status; README "fully operable and run as one unit via `gateline up`"). The page's own creation-seam example proves it but the ladder prose reads as future. | State that M2 has run and what remains gated |
| 48 | "M3 adds cross-vendor dispatch with the vendor pins enforced at dispatch time; M4 hardens crash recovery and isolation" | OK | ORCHESTRATOR.md §10; `router.ts` `VendorPinError`. Newer: per-task worktrees, harvest-before-fold, session resume, and crash recovery are implemented (§4.4, §5.3). | — |
| 49 | "matched the human's on 8 of 19 steps … agreement reached 18 of 22 and 16 of 23 steps" | OK | `packages/orchestrator/shadow-{wordfreq,mdtoc,dupefind}.md` summary table. | — |
| 50 | evidence `frontend/packages/orchestrator/shadow-dupefind.md` | STALE | `packages/orchestrator/shadow-dupefind.md`. | Update path |
| 51 | "Autonomy here is not a switch that ships: it remains gated on the measured criterion, and no mode of the framework is 'fully autonomous'" | OK | AGENTS.md status; DESIGN.md §7. | — |
| 52 | Diagram: M0–M4 labels; "M4 hardening: crash recovery, isolation, packaging"; "evidence so far: 8/19 → 18/22 → 16/23 (wordfreq → mdtoc → dupefind)" | OK | ORCHESTRATOR.md §10; shadow reports. | — |
| 53 | Links to `../reference/cli.html`, `../reference/state-yaml.html` | UNVERIFIABLE | Site-internal. | — |

**Omitted, now true, worth adding (gates page):**
- **Seventh co-writer convention (#344)**: only the gate on the table can be decided; CLI/API/PR-sync refuse out-of-order approvals.
- **`closure` joins `gates.*`** on the engine's read-only list; `close`/`reopen` are human verbs with their own commit grammar.
- **Resume from `budget-exhausted` carries the budget decision** (`--cost-limit`, #96); `slug-landed` is a pause with no resume, only close-and-carry-on.
- **Host ceiling is a rolling window** (`--spend-limit-usd` over `--spend-window`, default 24 h) that defers rather than pauses (#97); `--require-budget` refuses dispatch on runs with no cap; `gateline up` exposes the same flags.
- **Local-only topology** (TOPOLOGY.md §3.6): no push, no `gh`, no fetch; `gateline up --no-push`/`--local-only`; startup log names which resolution fired.
- **Code-tree monitor debounce** and the heartbeat's `codeState`/`codeReason` surfaced as Gatehouse's drift chip; `gateline self-update` is the operator's update input.
- **Escalation dispositions**: `resolve-escalation --disposition re-review | return-to-implement | re-plan` routes the engine (#189/#190); verifier `escalate` verdicts (#152).
- **Bounce budget**: two bounces of the same artifact per dispute escalate (#348).
- **PR-approval sync** (`gateline sync`) copies PR review approvals into G2 entries, subject to the gate-on-the-table rule.
- The engine's own commit grammar and identity are `gateline-orchestrator` / `orchestrator@gateline.invalid`.

---

## 5. `how-it-works/how-gateline-stays-vendor-neutral.html`

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "No role in gateline knows which model executes it. Roles are contracts over files; models are bindings resolved in a single registry; runtimes attach through thin, generated adapters" | OK | DESIGN.md §2, §6, §8. | — |
| 2 | "Six principles … P1 … P6" | OK | DESIGN.md §2 table. | — |
| 3 | "P2 rules out hardcoding a `claude-*` or `gpt-*` identifier in any role definition" | OK | DESIGN.md §2 P2 "What it rules out". | — |
| 4 | "no vendor or model name may appear in `roles/` or `contracts/` — model IDs live only in the registry" | OK | AGENTS.md invariant. | — |
| 5 | "Models from the same family share blind spots … the same model grading its own homework" | OK | DESIGN.md §2 P5 and note. | — |
| 6 | "The SDLC distills to eight operations, and the roster maps them to eight roles" + per-role missions | OK | DESIGN.md §3 table. | — |
| 7 | "Reviewer and Verifier are separate on purpose: review is reading, verification is running" | OK | DESIGN.md §3 notes. | — |
| 8 | "`roles/` holds one more spec: the Integrator … with its own gate (GI). It is not a ninth SDLC role" | OK | `roles/integrator.md` (`gate: GI`); INTEGRATION.md "Stage 2 — Gate GI"; `scripts/copy-manifest.json` `always`. | — |
| 9 | "The set is closed: adding a role takes an explicit maintainer decision recorded in an issue, because P6 makes roles the only extension surface" | OK | AGENTS.md invariant; DESIGN.md §2 P6. Newer: DESIGN.md §4.2 refines this — "open table, closed gates": adopter overlay roles may add evidence to an existing gate's table, never mint a gate; companion agents are not roles. | Cite §4.2 |
| 10 | "The Historian is the worked example — … one spec, one contract, and one registry binding, with no change to any other role or contract" | OK | DESIGN.md §3 "Historian is the worked example of P6". | — |
| 11 | "Each role spec carries its mission, operating instructions, definition of done, and explicit escalation triggers, with frontmatter declaring its capabilities and a capability profile" | OK | DESIGN.md §3 closing line; `roles/*.md` frontmatter (`capabilities:`, `capability_profile:`). | — |
| 12 | "One role is never rendered to a runner at all: the Orchestrator … so no adapter ships an agent file for it" | OK | All three manifests' `roles` lists omit `orchestrator`; no rendered orchestrator file. (Adapters now also render `integrator` and `historian` — the adapter READMEs' tables predate that, a framework-side staleness.) | — |
| 13 | "`registry/models.yaml` is the only place vendor and model IDs exist" | OK | Registry header; AGENTS.md (manifests re-spell them, as the page says). | — |
| 14 | "`frontier-reasoning` … `balanced` … `fast-cheap` for high-volume, low-stakes work" | OK | DESIGN.md §6; `registry/models.yaml` `profiles:` (historian binds `fast-cheap`). | — |
| 15 | "A bindings map attaches each role to a profile, and the Reviewer and Verifier entries carry `avoid_vendor_of: implementer`" | OK | `registry/models.yaml` `bindings:`. | — |
| 16 | "Resolution runs role → capability profile → registry profile → concrete vendor/model ID" | OK | DESIGN.md §6. Newer: resolution is adapter-aware (#359) — the dispatch's manifest spelling (`model_overrides[role] ?? model_map[profile]`) is what lands in the ledger and prices the dispatch (ORCHESTRATOR.md §6 "Model resolution is adapter-aware"). | Add "…then the adapter's spelling" |
| 17 | "Changing vendors is an edit to the registry, then re-spelling the binding in each adapter's manifest and re-rendering; no role spec or contract ever changes" | OK | AGENTS.md invariant; registry header. | — |
| 18 | "The same file holds the pricing map used to meter dispatches and the static per-role estimates behind the pre-flight budget check" | OK | `registry/models.yaml` `pricing:`, `dispatch_estimates_usd:`. | — |
| 19 | "The shipped model IDs are marked ILLUSTRATIVE" | OK | Registry header. | — |
| 20 | "the OpenRouter pricing entries are currently reference-only, not a live code path: the opencode adapter reports real per-dispatch cost directly" | STALE | The registry now says: `resolveModel()` is adapter-aware (#359), so these entries key correctly for the token-based fallback if opencode's usage report ever stops carrying cost; opencode still reports real cost directly, so they "back that fallback rather than the live path". Wired fallback, not "reference-only". | "a wired fallback, not the live path" |
| 21 | Diagram: `roles/reviewer.md` — `capability_profile: frontier-reasoning`; "writes_code / capabilities" | OK | `roles/reviewer.md` frontmatter. | — |
| 22 | Diagram: `registry/models.yaml` — "profiles → vendor/model IDs"; "bindings: reviewer { avoid_vendor_of: implementer }"; "pricing: · dispatch_estimates_usd:" | OK | Registry. | — |
| 23 | Diagram: `adapters/<name>/manifest.json` — "model_map / model_overrides (runner spellings)"; "tool_map · headless dispatch" | OK | All three manifests. | — |
| 24 | Diagram arrow label "render-agents.py (+ CI staleness check)" | WRONG | `scripts/render-agents.py` no longer exists. The renderer is `gateline render` in the dependency-free Node package `@gateline/framework` (`packages/framework/src/render.ts`); CI runs `node packages/framework/src/main.ts render --check` (`.github/workflows/render-check.yml`). | "gateline render (+ CI --check)" |
| 25 | Diagram: `.github/agents/reviewer.agent.md` — "RENDERED … DO NOT EDIT" | OK | Rendered file carries `<!-- RENDERED from roles/reviewer.md by gateline render - DO NOT EDIT.` | — |
| 26 | Diagram: "swap vendors = edit registry + manifests, re-render — role specs and contracts untouched" | OK | AGENTS.md. | — |
| 27 | evidence `scripts/render-agents.py` (three comments) | STALE | `packages/framework/src/render.ts`; `.github/workflows/render-check.yml`. | Update paths |
| 28 | "Three adapters ship. `claude-code` renders `.claude/agents/`; `copilot-cli` renders `.github/agents/`; `opencode` renders `.opencode/agents/` against its any-provider catalog" | OK | `adapters/*/manifest.json` `output_dir`; DESIGN.md §8 table. | — |
| 29 | "`scripts/render-agents.py` generates each agent file from the role spec — the body verbatim … — plus the adapter's `manifest.json`, which supplies the frontmatter shape, the capability-to-tool map, and the runner's model spellings" | WRONG (tool name); mechanism OK | `gateline render` (`@gateline/framework`, the only reader of role specs and manifests — AGENTS.md "Route framework fixes"); the description of what it consumes is still right (adapter READMEs; DESIGN.md §8). | Replace the script name with `gateline render` and name the package |
| 30 | "Rendered files carry a do-not-edit header, and CI fails any pull request whose renders are stale" | OK | Rendered headers; `render-check.yml` (runs with nothing installed by design). | — |
| 31 | "An adapter may narrow a role — fewer tools, tighter permissions — but never widen it; the role spec is the ceiling" | OK | DESIGN.md §8; AGENTS.md. | — |
| 32 | "In the opencode adapter the rule is a rendered property: each agent carries a deny-by-default permission map" | OK | `.opencode/agents/*.md` `permission: "*": deny` + explicit allows; manifest `tools_style: permission-map`. | — |
| 33 | "The v1 engine dispatches through the same manifests: a `headless` section gives the invocation template and the usage-report parsing spec" | OK | Manifests' `headless` (`command`, `dispatch_prompt`, `usage_report`); DESIGN.md §8; ORCHESTRATOR.md §5.2. | — |
| 34 | "Supporting a new runner costs one manifest — the roles are never restated per runner" | OK | DESIGN.md §8. | — |
| 35 | Table row `claude-code`: "One vendor's models … Partially honored … reviewer runs `fable`, implementer `sonnet`" | OK | `adapters/claude-code/README.md`; manifest `model_map`. | — |
| 36 | Table row `copilot-cli`: "Anthropic, OpenAI, and Google models natively … Fully honored … `gpt-5.4` and `gemini-3-flash` against a `claude-sonnet-5` implementer" | OK | `adapters/copilot-cli/manifest.json` `model_overrides`; README. Honesty note worth adding: its `headless.usage_report` is `static-estimate` — metering records the registry estimate with tokens null until per-invocation usage is verified live. | Add the metering caveat |
| 37 | Table row `opencode`: "Any provider in its Models.dev catalog … three distinct labs (DeepSeek, Moonshot, MiniMax), where 'vendor' means the underlying lab, not the OpenRouter routing layer" | OK | `adapters/opencode/manifest.json` (`model_vendors`; comment on lab vs router). The manifest flags the reviewer binding (Kimi K2.6) as TEMPORARY pending a K3 swap. | — |
| 38 | "Where more than one vendor is live, enforcement is mechanical: the dispatch seam refuses to bind the Reviewer or Verifier to the Implementer's vendor" | OK | `packages/orchestrator/src/router.ts` throws `VendorPinError` when >1 adapter and the pin is unsatisfiable; a single-adapter install logs a P5 advisory instead. ORCHESTRATOR.md §5.3. | — |
| 39 | "in the human-orchestrated dupefind run, every implementer ledger entry is one model lineage and every reviewer entry another, under the single vendor that harness hosts" | OK | `runs/dupefind/state.yaml`: implementer → `anthropic/claude-sonnet-5`, reviewer → `anthropic/claude-fable-5`. | — |
| 40 | "the judgment encoded in roles and contracts is portable; model preference is a registry edit; runner preference is one manifest" | OK | DESIGN.md §6, §8. | — |
| 41 | Links to `../reference/adapter-manifests.html`, `../reference/contract-grammar.html`, `../api/index.html` | UNVERIFIABLE | Site-internal. | — |

**Omitted, now true, worth adding (vendor page):**
- **The renderer is a dependency-free Node package** (`@gateline/framework`, `packages/framework/`), invoked as `gateline render` or `node packages/framework/src/main.ts render --check` with nothing installed — the zero-dependency rule is an AGENTS.md invariant so a host repo's render-staleness CI needs no install step.
- **It is the only reader of role specs and manifests**; `core` and `orchestrator` narrow its output rather than re-parsing (AGENTS.md "Route framework fixes").
- **Adapter-aware model resolution** (#359): the ledger and pricing key on the adapter's spelling (`sonnet`, `openrouter/…`), not the registry's illustrative default.
- **Same-round retry resumes the harness session** on runners that have one (opencode `session_field`/`resume_args`, #181; ledger `session:` key).
- **opencode's `ndjson-sum` usage report was verified live** (per-`step_finish` cost summed); copilot's is `static-estimate`.
- **Adapters render `integrator` and `historian`** as well as the six pipeline roles (all three manifests' `roles` lists); the adapter READMEs' tables have not caught up.
- **DESIGN.md §4.2** — evidence-bearing positions (Implementer/Reviewer/Verifier/Orchestrator-as-emitter) are structurally closed because the P5 claim names them; production roles are closed by governance; "open table, closed gates" for host overlays; companion agents belong in a runner's native agent mechanism, not `roles/`.
- **What travels into a host is content only** — role specs, contracts, templates; tooling runs from the framework checkout the host's lock pins (`scripts/copy-manifest.json`; INTEGRATION.md §3 two-channel model).
- Known framework-side landmine unchanged: DESIGN.md §10 still says "exercised via per-role vendor pins and future adapters" — keep citing §8 and the adapter READMEs, as the page already does.

---

## 6. `404.html`

No framework claims. Four site-internal links (How It Works, Onboarding, Reference, API) and a link to the documentation home — out of scope. No retired names.

---

## 7. Retired / renamed names — every occurrence (content sections only)

Replacement rule set: `agentic` CLI → `gateline`; `agentic-orchestrator` → `gateline-orchestrator`; `@agentic/*` → `@gateline/*`; `frontend/packages/…` → `packages/…`; `scripts/render-agents.py` → `gateline render` (`packages/framework/src/render.ts`); `agentic upgrade` → `gateline self-update`.

| Page | Location | Occurrence | Replacement |
|---|---|---|---|
| index.html | landing intro paragraph | `<code>agentic</code> CLI` | `<code>gateline</code>` CLI |
| index.html | evidence comment, feature "Gates a machine cannot sign" | `frontend/packages/orchestrator/README.md` | `packages/orchestrator/README.md` |
| index.html | path grid "Working with the packages" | `@agentic/core` | `@gateline/core` |
| index.html | section-nav "API" card | `@agentic/core` | `@gateline/core` |
| how-a-run-works | callout on the two defaults | `agentic new` | `gateline new` |
| how-a-run-works | evidence comment on that callout | `frontend/packages/cli/src/main.ts` | `packages/cli/src/main.ts` |
| how-a-run-works | evidence comment on the creation-seam G3 paragraph | `frontend/packages/core/src/record/schema.ts` | `packages/core/src/record/schema.ts` |
| how-a-run-works | "Creating a run: stage, then arm", first paragraph | `agentic new` | `gateline new` |
| how-a-run-works | same paragraph | `agentic arm` | `gateline arm` |
| how-a-run-works | evidence comment on that paragraph | `frontend/packages/cli/src/main.ts` | `packages/cli/src/main.ts` |
| how-a-run-works | evidence comment on the PR paragraph | `frontend/packages/core/src/sources/pr-description.ts` | `packages/core/src/sources/pr-description.ts` |
| how-gates | evidence comment, "A structural never" second paragraph | `frontend/packages/orchestrator/README.md` | `packages/orchestrator/README.md` |
| how-gates | "One file, two writers", first paragraph | `<code>agentic</code> CLI` | `<code>gateline</code>` CLI |
| how-gates | evidence comment on the CAS paragraph | `frontend/packages/core/src/sources/git.ts` | `packages/core/src/sources/git.ts` |
| how-gates | provenance paragraph | `agentic-orchestrator` (bot identity) | `gateline-orchestrator` |
| how-gates | evidence comment on the provenance paragraph | `frontend/packages/orchestrator/README.md` | `packages/orchestrator/README.md` |
| how-gates | SVG `cas-co-writer` text | "human — via Gatehouse / agentic CLI" | "… / gateline CLI" |
| how-gates | SVG `cas-co-writer` text | "bot identity: agentic-orchestrator" | "bot identity: gateline-orchestrator" |
| how-gates | evidence comment on the `--no-budget-enforcement` paragraph | `frontend/packages/orchestrator/README.md` | `packages/orchestrator/README.md` |
| how-gates | approve-and-hold callout | `agentic approve --hold <reason>` | `gateline approve --hold <reason>` |
| how-gates | evidence comment on that callout | `frontend/packages/cli/src/main.ts` | `packages/cli/src/main.ts` |
| how-gates | "One authority per deployment", first paragraph | `agentic up` | `gateline up` |
| how-gates | blessed-checkout paragraph | `agentic upgrade` | `gateline self-update` |
| how-gates | blessed-checkout paragraph | `agentic ui` | `gateline ui` |
| how-gates | evidence comment on the shadow-record paragraph | `frontend/packages/orchestrator/shadow-dupefind.md` | `packages/orchestrator/shadow-dupefind.md` |
| vendor-neutral | SVG `binding-resolution` arrow label | `render-agents.py` | `gateline render` |
| vendor-neutral | evidence comment after the diagram | `scripts/render-agents.py` | `packages/framework/src/render.ts` |
| vendor-neutral | "Adapters are rendered, not written", first paragraph | `scripts/render-agents.py` | `gateline render` (`@gateline/framework`) |
| vendor-neutral | evidence comment on that paragraph | `scripts/render-agents.py` | `packages/framework/src/render.ts`; `.github/workflows/render-check.yml` |
| vendor-neutral | evidence comment on the narrow-never-widen paragraph | `scripts/render-agents.py` | `packages/framework/src/render.ts` |

Not found in any of the six pages' content: `.agentic`, `integrate.py`, `agentic-sandbox`, `FleetView`, `ADS`. (The grounding file `.work/evidence-map.md` is itself written against `agentic-sandbox`, `frontend/`, `scripts/render-agents.py` and the `agentic` binary throughout, and its line numbers are as of 2026-07-27; it should be regenerated, not patched, before the rewrite.)

The quoted commit `fdef5f2` legitimately shows the historical author `agentic-orchestrator`; that is a record and stays. Only the prose and diagram that name the *current* identity need changing.

---

## 8. Five most consequential findings

1. **`agentic upgrade` names a command that no longer exists** (gates page, blessed-checkout paragraph). The operator's update input is `gateline self-update` (`packages/cli/src/main.ts`; ORCHESTRATOR.md §13). A reader following the page would type a command the CLI rejects.
2. **The renderer is not `scripts/render-agents.py`** (vendor page: diagram label, prose, and four evidence comments). It is `gateline render` in the zero-dependency Node package `@gateline/framework`; CI runs `node packages/framework/src/main.ts render --check`. The Python tooling was retired with #371–#373 on 2026-09-16; the whole "how a render happens" story on the page points at a file that is gone.
3. **The engine's bot identity is `gateline-orchestrator`**, not `agentic-orchestrator` (gates page prose + CAS diagram). `packages/orchestrator/src/start.ts` sets `gateline-orchestrator <orchestrator@gateline.invalid>`.
4. **The co-writer contract has seven conventions, not six** (gates page prose + diagram). The seventh (#344) is a safety property the page's own thesis leans on: a gate decision is legal only for the gate on the table, and Gatehouse, the CLI, the API, and PR-approval sync all refuse an out-of-order approval.
5. **Contracts are no longer "required sections and concision budgets, not prose style"** (run page). READABILITY rules on human-facing sections and the parsed `AUDIENCE:` line are normative and bounceable (AGENTS.md invariant; `contracts/spec.md`, `plan.md`, `review-report.md`, `verification-report.md`). The sentence as written now states the opposite of the rule.

Systemic behind all five: 29 occurrences of retired names (`agentic` CLI/identity ×13 incl. SVG text, `@agentic/core` ×2, `frontend/` evidence paths ×9, `render-agents.py` ×5). And the biggest *omission*: nothing on any page mentions `close`/`reopen` (a run's two terminal states), the repository being public since 2026-09-16 with `v0.3.0` tagged, or that M2 autonomy has actually run — the ladder prose reads as future while the page's own creation-seam example is an orchestrator-driven run.
