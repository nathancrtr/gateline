# Gate Frontend — Architecture & Implementation Plan

**Status:** v0.1 — implementation plan for maintainer review; executes the design in
[FRONTEND.md](FRONTEND.md)
**Prerequisite reading:** [FRONTEND.md](FRONTEND.md) (the requirements this plan
answers to), [DESIGN.md](DESIGN.md) §4–5 (gates, contracts)

---

## 0. Charter and settled decisions

FRONTEND.md defers the full inbox app (its Stage C) until multiple reviewers or teams
exist. This build pulls the Stage C *experience* forward while refusing the Stage C
*infrastructure* — an explicit maintainer decision to spend spare capacity now. Four
scoping decisions are settled and not revisited below:

| Decision | Choice |
|---|---|
| Posture | **Local-first, remote-ready.** One command serves the app on localhost; it reads local clones and writes real git commits. Data access sits behind a driver interface so a GitHub-API driver can arrive later without UI changes. |
| Stack | **TypeScript end-to-end.** React 19 + Vite + Tailwind v4 (shadcn/ui-style copied components) in front; a small Hono server on Node behind; npm workspaces (Node ≥ 22, no extra toolchain). |
| Scope | Core surfaces (inbox, portfolio, run detail, gate cards, the write path) **plus** the `agentic` CLI, metrics/trends (I8), and GitHub PR-approval sync (§2 of FRONTEND.md). Slack notifications: out. |
| Home | **This repo, top-level `packages/`** — a product component of the framework, versioned with the contracts it renders. `apps/` stays reserved for pipeline-run output. |

Everything in FRONTEND.md §4 remains binding. Three of its principles harden into
architecture rules here:

- **R1 — The repo is the only database** (§4.6). The app owns no store. Its entire
  state is `(repo refs, working config)`; every view is recomputable from `git` alone,
  and deleting `packages/` loses nothing.
- **R2 — Exactly one write path** (§5). The only mutation the system performs is a
  commit that edits one run's `state.yaml` (gate decision, escalation resolution,
  pause/resume). No dispatch, no artifact edits, no second write channel.
- **R3 — A malformed packet never renders as reviewable** (§4.1). Contract
  well-formedness is computed before human attention is spent; a packet missing
  required sections gets a bounce view with no approve affordance.

## 1. Product shape

Three human surfaces plus a CLI, all views over the same core library:

```
                    ┌─────────────────────────────────────────┐
                    │ @agentic/core                           │
                    │ schema · discovery · readiness ·        │
                    │ validation · write path · metrics       │
                    └───────┬─────────────────┬───────────────┘
                            │                 │
                   ┌────────┴───────┐  ┌──────┴────────┐
                   │ agentic (CLI)  │  │ server (Hono) │──── SSE / JSON ────┐
                   │ status·inbox·  │  └───────────────┘                    │
                   │ approve·sync·ui│                              ┌────────┴───────┐
                   └────────────────┘                              │ web (React)    │
                                                                   │ Inbox·Portfolio│
                                                                   │ Run·Metrics    │
                                                                   └────────────────┘
```

- **Inbox** — the default screen: everything that needs a human, across every
  configured repo, ranked by age. Gate-ready packets, unresolved escalations,
  round-cap breaches, paused runs. Opening an item lands on its gate card.
- **Portfolio** — the I6 table: every run × repo with phase, gate ledger, task
  rollup, budget state, escalation count, age. One glance answers "what is the
  pipeline doing, everywhere."
- **Run detail** — one run's story: phase timeline, artifact browser (rendered
  markdown with per-contract validation badges), task board with review-round
  counts, and the `state.yaml` git history as an audit trail.
- **Gate card** — the decision surface, one per pending decision (see §4).
- **`agentic` CLI** — the same read models and the same write path in terminal form:
  `status`, `inbox`, `approve`/`decline`, `resolve-escalation`, `pause`/`resume`,
  `sync`, and `ui` (starts the server, opens the browser). FRONTEND.md's Stage B
  tool, subsumed rather than skipped — decisions stay possible when no browser is.

Deliberate absences, restated from FRONTEND.md §5 so they survive into code review:
no dispatch or steering of agents (the harness is the cockpit), no chat, no artifact
authoring/editing, no approval granularity finer than the four gates + escalations.
The one sanctioned control that is not a gate is pause/resume, because pause is
state, not dispatch.

## 2. The core library

### 2.1 Data model and validation

`@agentic/core` types mirror the contracts exactly: `RunState` (from
`contracts/state.yaml`), `Task`, `GateEntry`, `Escalation`, plus derived types
(`InboxItem`, `GatePacket`, `RunSummary`). Parsing is zod-validated YAML; a state
file that fails schema validation surfaces as a *malformed run* (visible, opens the
raw file, never guessable-around — the contract's bounce rule applied to ourselves).

Artifact well-formedness (R3) derives required sections **from the target repo's own
`contracts/*.md` templates at read time** — the validator reads the section headings
of `contracts/spec.md` in the repo it is rendering, not a list hardcoded in the app.
A consumer who forks the framework and amends a contract gets a frontend that
validates against *their* contract, for free. (Built-in fallbacks cover repos that
imported runs but not `contracts/`.)

### 2.2 Run discovery — the `RunSource` driver

```ts
interface RunSource {
  id: string
  listRuns(): Promise<RunRef[]>            // slug, ref, phase, freshness
  readState(ref: RunRef): Promise<RunState>
  readArtifact(ref: RunRef, path: string): Promise<Artifact>
  readDiff(ref: RunRef): Promise<Diff>     // run branch vs default branch
  stateHistory(ref: RunRef): Promise<StateCommit[]>
  writeState(ref, mutate, message): Promise<WriteResult>   // §3
}
```

**`LocalGitSource`** (this build) reads a clone *without touching its checkout*:

- **Discovery:** `git for-each-ref refs/heads/run/* refs/remotes/origin/run/*` for
  in-flight runs, plus `runs/*/state.yaml` on the default branch for merged/done
  runs. Same slug in both → the branch tip wins while it's ahead.
- **Reads:** `git cat-file`/`git show <ref>:<path>` — content at the run branch tip,
  never the working tree, so N concurrent runs are all visible with none checked out.
- **Freshness:** watch `.git/refs` + `packed-refs` (debounced) and optionally
  `git fetch` on an interval; changes push an SSE event, the UI revalidates.

**`GitHubSource`** (later, out of scope now) implements the same interface over the
REST/GraphQL API with API-commit writes — the promised remote-ready seam. Nothing
above `RunSource` may know which driver it is talking to.

Multi-repo: `~/.config/agentic/config.yaml` lists sources
(`{path, name, fetch_interval}`), overridable per-invocation with `--repo`. No
config file → the current repo, zero setup.

### 2.3 Readiness — deriving "needs a human" (never storing it)

The doc's central object, the *interrupt*, is a derived fact about files (R1: derive,
don't store). Core encodes one rule per interaction:

| Item | Derivation | Packet on the card |
|---|---|---|
| G0 ready | `phase: spec` ∧ `spec.md` present ∧ well-formed ∧ ¬G0 | `intent-brief.md` + `spec.md` |
| G1 ready | `phase: plan` ∧ `plan.md` + `tasks/*` present ∧ well-formed ∧ ¬G1 | `plan.md`, tasks, ADRs |
| G2 ready | `phase: implement∨integrate` ∧ all tasks `done` ∧ latest reviews + `verification-report.md` present ∧ ¬G2 | diff, review + verification reports |
| G3 ready | `phase: release` ∧ `release-plan.md` present ∧ ¬G3 | `release-plan.md` incl. rollback |
| Escalation | any `escalations[]` entry with `resolved: false` | the entry + `from_role` context |
| Round-cap | any task `review_rounds ≥ 3` ∧ status ≠ done | both sides' latest artifacts |
| Paused | `phase: paused` | `paused_reason` + budget/gate context |

Each item carries **since** — the commit timestamp at which its condition became
true (the newest commit touching its trigger artifacts) — giving honest SLA ages
with no clock of our own. The inbox is this list, sorted oldest-first: the queue
discipline FRONTEND.md principle 5 demands for escalations, applied uniformly.

## 3. The write path (R2, in full)

A decision is a surgical edit to one run's `state.yaml`, committed to the run branch
with the human's own git identity. Mechanics:

1. Resolve `tip = refs/heads/run/<slug>`; read `state.yaml` at `tip`.
2. Mutate via the `yaml` package's document API (**comment- and format-preserving** —
   `state.yaml` files carry contract commentary that hand-editing preserves today;
   the tool must not be worse than hand-editing).
3. Write the new blob/tree with plumbing (`hash-object`, temp-index `write-tree`) and
   `commit-tree` — author = `git config user.name/email`, the *named human*.
4. `git update-ref refs/heads/run/<slug> <new> <tip>` — an atomic **compare-and-swap**.
   If the branch moved since read (an agent committed, another session decided), the
   update refuses; the app re-reads and re-presents. No lock, no drift, no clobber.
5. If the branch happens to be checked out in some worktree: detect via
   `git worktree list --porcelain` and fall back to committing through that worktree
   (clean file) or refusing with a pointed message (dirty file). Never leave a
   checkout silently diverged from its ref.
6. Optional `--push` / auto-push per source config.

Commit messages are structured for the audit trail and the metrics reader:
`state(<slug>): G2 approved by <name> [burden: light-correction]`.

What a decision records — name, timestamp, notes, and **gate burden** — is captured
*in the act of deciding* (FRONTEND.md principle 3): approve requires a one-click
burden pick (confirmation / light correction / heavy correction); decline requires a
reason. This needs one small contract amendment (§7).

## 4. Gate cards — per-gate packets and affordances

The card template is fixed (FRONTEND.md principle 2): **what → why → what changes →
how verified → how to undo**, then the affordances. Per-gate content and affordances
differ, echoing the Agent Inbox per-interrupt configuration:

| Card | Layout | Affordances |
|---|---|---|
| **G0** | Brief and spec side-by-side; requirements/acceptance-criteria numbered and anchor-linked | Approve · Approve with notes · **Decline with reason** (routes back to Analyst — the "edit the spec" instinct is served by declining with specific notes, not by editing in-app; the frontend never adds content) |
| **G1** | Plan with ADRs foregrounded; task cards with file-contact surfaces, overlap check rendered as a badge | Approve · Approve with notes · Decline with reason |
| **G2** | Verdict strip (reviewer verdict, verifier result, rounds used) → diff viewer → both reports; evidence expanded only for failures, per the contracts' own budget rules | Approve · Approve with notes · Decline with reason; deep-link to the PR when one exists |
| **G3** | Release plan with the rollback section pinned and non-collapsible | Approve · Decline |
| **Escalation** | The `escalations[]` entry, `from_role`, age, and both sides' artifacts for round-cap cases | Resolve with disposition note |
| **Paused** | `paused_reason`, budget meter, gate context | Resume · Keep paused (kill = decline at the pending gate) |

Malformed packet → the bounce view: which contract, which sections missing, a link to
the raw artifact — and no approve control anywhere (R3). Every approve records burden;
every card shows the run's remaining budget so cost context rides along.

**Keyboard model** (the review-queue ergonomic that makes "decision quality per
human-minute" real): `j/k` move through the inbox, `enter` opens, `1/2/3` picks
burden, `a` approve, `x` decline, `e` next artifact, `esc` back. The whole gate loop
is doable without the pointer.

## 5. Server and web app

**Server** — Hono on `@hono/node-server`, one process, serves the built SPA and:

```
GET  /api/inbox                     ranked InboxItems across sources
GET  /api/runs                      portfolio rows
GET  /api/runs/:src/:slug           state + readiness + validation + history
GET  /api/runs/:src/:slug/artifact  ?path=…  (raw + rendered)
GET  /api/runs/:src/:slug/diff      unified diff, parsed server-side
POST /api/decisions                 {src, slug, action, gate?, notes?, burden?} → CAS result
GET  /api/metrics                   §6 aggregates
GET  /api/events                    SSE: ref/file changes → client revalidation
```

Bound to `127.0.0.1` by default; `--host` exists but the README states plainly that
multi-user serving is Stage C's problem (auth, routing) and not this build's.

**Web** — React 19, Vite, Tailwind v4, shadcn/ui-pattern components (copied in, not
a dependency), TanStack Query keyed to SSE invalidations, React Router. Markdown via
remark; diffs rendered from the server's parsed hunks with a lightweight highlighter.
Dependency posture: lean and boring — every dependency is one more thing a future
maintainer of a *framework* repo must trust.

**Design language** — calm, editorial, quiet: the subject matter (specs, diffs,
verdicts) supplies the visual interest. Neutral surfaces, one accent; status is
encoded in a small fixed vocabulary (gate states, phases, verdicts) used identically
everywhere; Inter/system for UI, mono for artifacts; generous line length limits for
reading specs; light and dark from day one. Metrics charts follow the dataviz
guidance at implementation time. The bar: an engineer reviews a G2 on a phone at a
coffee shop and it feels like reading, not operating.

## 6. Metrics (I8) — computed, never logged

All from git history of `state.yaml` plus the burden field — no scribe, no store (R1):

- **Decision latency** per gate: readiness-commit time → gate-entry commit time.
- **Approval rate** per gate, trailing window, with the **>90% over-triggering flag**
  rendered as a standing nudge on the gate's row (FRONTEND.md principle 4 made
  ambient, feeding the retro check).
- **Burden mix** per gate over time — the pilot's headline metric, now a side effect
  of clicking approve.
- **Rounds** per task (from state history), distribution and trend.
- **Cost** — renders `budget` fields honestly, including "never updated," which is
  itself the finding (the wordfreq lesson); automated metering stays a v1
  orchestrator concern, not a frontend one.

## 7. Contract and doc changes (small, explicit)

1. `contracts/state.yaml`: gate entries gain optional
   `burden: confirmation | light-correction | heavy-correction`; comment notes that
   `at` should be an ISO-8601 timestamp (dates parse fine; latency metrics degrade
   gracefully). Optional `assigned_to` on escalation entries is *deferred* until a
   second approver exists.
2. `docs/FRONTEND.md`: status note that Stage C's UX was pulled forward as a
   local-first build (posture decision recorded, staging logic intact).
3. New `packages/README.md`: quickstart, config, keyboard reference, the R1–R3 rules
   restated for contributors.

No role spec changes; no `.claude/agents` / `.github/agents` re-render needed
(nothing here touches roles or manifests).

## 8. Repository layout

```
packages/
├── package.json            # npm workspaces root; engines: node ≥22
├── core/                   # @agentic/core — everything in §2–§3, zero UI deps
├── cli/                    # agentic — commander-based, thin over core
├── server/                 # Hono app, thin over core
├── web/                    # Vite + React SPA
└── fixtures/               # demo-repo generator (§9)
```

Root `package.json` scripts: `build`, `test`, `lint`, `dev` (server + Vite HMR).
CI: a `packages-ci.yml` workflow (install, typecheck, test, build) that triggers only
on `packages/**` paths so framework-only PRs stay fast.

## 9. Testing and verification

- **Fixture generator** (`packages/fixtures/`): scripts a temp git repo containing
  runs in *every* interesting state — each gate pending, an unresolved escalation, a
  round-cap breach, a paused run, a malformed spec, a done run. Used by unit tests,
  by Playwright, and by `agentic ui --demo` for screenshots and hand-testing. This
  matters because the only real run (wordfreq) is finished — the fixture repo is how
  in-flight behavior stays testable.
- **Core**: vitest against the fixture repo — discovery, readiness table (§2.3, one
  test per row), validator against this repo's real contracts, write-path CAS
  (including the concurrent-move refusal and the checked-out-branch fallback).
- **Server**: route tests over the fixture source.
- **Web**: Playwright smoke — inbox → gate card → approve → the commit exists with
  the right author, message, and preserved YAML comments; bounce view shows no
  approve control.
- **Real-repo check**: portfolio and metrics rendered against this repo's actual
  wordfreq history as the final acceptance pass.

## 10. Milestones

Each lands as working software; order front-loads the riskiest mechanics (git
plumbing, CAS, YAML preservation) behind the smallest UI.

| # | Milestone | Contents | Acceptance |
|---|---|---|---|
| M0 | Foundation | Workspace scaffold; core schema, discovery, readiness, validation; fixture generator | `npm test` green; core lists wordfreq from this repo and all fixture states correctly |
| M1 | Read surfaces | Server API, app shell, portfolio, run detail, artifact + diff rendering, SSE freshness | Browse wordfreq end-to-end in the browser; malformed fixture shows bounce view |
| M2 | Decide | Write path (plumbing + CAS + worktree fallback); gate cards with per-gate affordances + burden; CLI decision commands | Full decision loop on the fixture repo produces correct, comment-preserving commits; CAS refusal demonstrated |
| M3 | Scale & measure | Inbox ranking/aging, multi-repo config, metrics view, GitHub PR-approval sync (`agentic sync` + opt-in poll) | Metrics computed from real wordfreq history; sync writes a correct G2 entry from a PR review (dry-run + live modes) |
| M4 | Polish & ship | Keyboard model, empty states, dark mode, demo mode, README + contract amendment + FRONTEND.md note, CI workflow | Playwright suite green; `agentic ui` cold-start against this repo < 2s; draft PR opened |

## 11. Risks

| Risk | Mitigation |
|---|---|
| YAML round-trip mangles hand-written state files | Document API of `yaml` (not re-serialization); golden-file tests over this repo's real `state.yaml`s |
| Writing refs under a live agent session races the orchestrator | CAS on `update-ref` (§3.4); refusal + re-present is the *designed* outcome |
| Readiness rules drift from contract evolution | Rules live in one core module with the §2.3 table as its doc comment; one test per row |
| Scope creep toward orchestration | R2 named in the README; PR review checks any new write against it |
| Dependency sprawl in a framework repo | Lean-deps rule (§5); each new package justified in the PR description |

---

*Execution note: implementation proceeds directly on a feature branch (not as a
pipeline run — the builder cannot approve its own gates), with the maintainer
reviewing at the milestone boundaries above via the draft PR.*
