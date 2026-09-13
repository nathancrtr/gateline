# Control-Plane Topology — Design

**Status:** draft — written after the 2026-07-15/16 split-topology incidents
(#96/#97 budget-pause loops, #103 silent push rejection, #104 stale materialized
branches); proposes the deployment posture the epic (#100 + successors) implements
**Prerequisite reading:** [DESIGN.md](DESIGN.md) §7 (operating modes),
[ORCHESTRATOR.md](ORCHESTRATOR.md) §2 (first deployment), §4.3–4.5 (write
discipline, control plane); [DEPLOY.md](DEPLOY.md)

---

## 1. The problem, stated honestly

The frontend (Gatehouse) and the v1 orchestrator are separated cleanly in code:
derivation is a pure function of committed state, writes are CAS'd, humans and
machines commit under distinguishable identities. That separation is correct and
this document does not touch it.

What failed in practice is the **topology**. Within one day of running Gatehouse
hosted and the orchestrator on an operator workstation, every seam between the two
produced an incident:

- A human raised a budget limit on origin; the workstation orchestrator, reading a
  materialized local branch that nothing ever fast-forwarded, kept deriving against
  the stale limit and re-escalated within seconds of the human's resolve (#104).
- The engine's pushes to origin were rejected (non-fast-forward) for half an hour
  with no signal; machine bookkeeping and human decisions accumulated on divergent
  histories that needed manual ref surgery to reconcile (#103).
- Earlier the same day: the workstation watcher was down, the hosted machine had
  dispatch disabled, and human decisions sat unactioned with nothing anywhere
  reporting that *no orchestrator was listening* (#100).

The root observation: **the state store was replicated, and both replicas accepted
writes.** Every other property of the system assumes one authority per deployment.

## 2. The pattern, and what its exemplars do

This system is a control plane over declarative shared state with a stateless
reconciler — the same shape as the most-validated infrastructure of the last
decade. The exemplars agree on the load-bearing rules:

| System | State store | Who touches the store | What is distributed |
|---|---|---|---|
| Kubernetes | etcd | the API server, exclusively | controllers (leader-elected), kubelets |
| Argo CD | git + redis cache | the repo-server, exclusively | nothing — ships as one install unit |
| Flux | git | source-controller | nothing (UI reads through the k8s API) |
| Airflow / Dagster / Temporal | one metadata DB | the serving layer | workers, via task queues |
| CI (GitHub Actions, Buildkite) | control-plane DB | the control plane | **runners only** — stateless, disposable workspaces |

Three lessons transfer directly:

1. **One store-toucher per deployment.** Nobody replicates the state store to a
   second live authority; components co-deploy against a single instance and use
   its native concurrency control. (Argo CD is logically three services and
   operationally one unit.)
2. **Distribute the runner, never the reconciler.** When work must execute on
   user-controlled hardware — the CI systems' daily bread, and our
   subscription-billing constraint — the remote piece is a thin agent that pulls a
   job, runs it in a disposable workspace, and reports back through the control
   plane. The scheduler never moves.
3. **Liveness is UI state.** Airflow's "the scheduler does not appear to be
   running" banner exists because scheduler/webserver drift produced years of
   silent-stall pain. An open decision with no engine heartbeat is an outage, not
   a wait.

Git-as-state-store is this framework's deliberate deviation (audit trail, offline
operation, zero infrastructure) and it is worth keeping. Its price is the absence
of a server-side transaction manager: origin only linearizes writers that treat
*push acceptance* as their commit protocol. The incidents above are what happens
when a writer doesn't.

## 3. Proposal

### 3.1 One authority per deployment

Server + engine ship and run as one supervised unit over one clone, one sync loop,
one push path — hosted (the entrypoint already co-locates them; make
`ORCH_ENABLED=1` the blessed default once §3.3 lands) and locally (a single
`up`-style command for consumers). The ad-hoc pattern this replaces — a second
clone with its own fetch loop and `watch --push` — is retired in favor of that
single `up` authority (#104). There is no startup guard that refuses `--push`
without a sync provider — "sync provider" is not a first-class object anywhere
in the `up`/engine startup path, and building one would be the new
remote-abstraction layer this proposal doesn't need. What a deployment's
origin-egress posture actually is — pushing, polling read-only, or touching
origin not at all — is a property of each source's resolved mode, decided once
at startup and named unambiguously in the log; the fully-off case is the
first-class **local-only** topology described in §3.6.

Direct git edits to run branches remain legal — break-glass is git's charm — but
are treated as *foreign writes to reconcile* (fast-forward sync, then re-derive),
never assumed absent.

### 3.2 Origin is the linearization point

Wherever more than one writer can exist, commit-then-launch (ORCHESTRATOR.md §4.4)
extends to **push-then-launch**: a dispatch is armed only once its intent commit is
accepted by origin. A rejected push means another authority acted; the response is
sync + re-derive, and repeated rejection is a host-scoped escalation, never a
silent retry loop (#103). Sync/push health (last successful push per branch,
divergence counts) becomes visible state in Gatehouse.

### 3.3 The runner agent — distribute the right thing

The reason an orchestrator ended up on a workstation was never topology; it was
billing: dispatch had to run a harness CLI under an operator's subscription login
rather than an API key. That is a **runner concern**. The fix is a thin
workstation agent — the only component that runs off the control-plane machine:

- receives a dispatch intent (role, run, prompt body) from the control plane;
- executes the adapter's headless command in a **disposable workspace checkout**
  (CI-runner semantics — a workspace is not a state replica and holds no
  authority);
- reports the outcome and usage through the control plane, which does all state
  writing and metering itself.

The dispatch seam (`seam.ts`) already isolates the surface that needs to
move; a runner agent is a `Dispatcher` implementation whose execution happens to
be remote. Transport can start as low-tech as the rest of the system (the agent
polls the control plane; no inbound port on the workstation).

### 3.4 Liveness as first-class state

Gatehouse surfaces, per repository: engine heartbeat age, last successful push,
and open decisions older than the heartbeat interval. The Airflow banner,
verbatim: if decisions are landing and no engine has ticked within N minutes, the
portfolio view says so at the top, loudly (#100).

### 3.5 Trying changes locally — the trial instance

A corollary of §3.1: the blessed checkout (the tree the global `gateline`
symlinks into) stays on the default branch, always. Trying an unmerged frontend
change never means moving that checkout to a branch — if an engine is running
there, that would put unreviewed code in charge of live, metered dispatch.

Instead, the branch's own worktree is the trial instance. Two properties make
this free: the CLI and server run from TypeScript source (`node
packages/cli/src/main.ts` in any tree *is* that tree's `gateline`), and Gatehouse
observes a repository through its git refs, so the observed repo's checked-out
branch is irrelevant. From the worktree:

```sh
cd <worktree>/packages
npm install && npm run build     # the server serves web/dist — UI changes are invisible until built
node cli/src/main.ts ui --repo <path-to-repo> --port 4312
```

That is a self-contained second Gatehouse on a side port; the blessed instance
is untouched and ctrl-C removes the trial. Rules of the road:

- **`ui`, never `up`, from a trial tree.** `up` starts the dispatch engine;
  trying UI changes never requires one.
- **Decision clicks belong to `ui --demo`** (a generated throwaway repository).
  `POST /api/decisions` writes real state commits to whatever repo is observed.
- **Web-only changes** can use the hot-reload loop instead: `npm run dev -w
  @gateline/web` (vite on 4311, proxying `/api` to 4310). For changes that touch
  server or core routes, use the built self-contained flow above so the API
  comes from the trial tree too.

### 3.6 Local-only: a supported, first-class topology

A deployment that never touches origin at all — no `git push`, no `gh`/GitHub
API call, no `git fetch` of `origin` — is not an accident of `--no-push` left
with a fetch loop that happens to fail quietly. It is a named, first-class
mode: **local-only**. `gateline up` and per-source config resolve through the
one `push`/local-only precedence table implemented once in `resolveMode`
(`packages/core/src/view-model/config.ts`, called from
`loadSources`). The standalone `gateline-orchestrator` binary never calls
`loadSources` — it has its own repo (no config file, no multi-source list) —
so `assembleOrchestrator` (`packages/orchestrator/src/start.ts`)
repeats the same conflict check and auto-detect logic against its own
`--push`/`--local-only` flags. Two call sites, one precedence table: the
tiers below hold for both.

**Resolution tiers, in order:**

1. An explicit local-only designator (`--local-only` on the CLI, or
   `local_only: true` per source in config) together with an explicit request
   to push (`--push` / `push: true`) on the same source is rejected at
   startup: `LocalOnlyPushConflictError`, non-zero exit, no server or engine
   started.
2. Otherwise, the explicit local-only designator wins, if set.
3. Otherwise, an explicit push setting wins: `--push`/`push: true` turns
   local-only off; **at the CLI tier only**, `--no-push` turns it on (the
   alias below).
4. Otherwise, origin auto-detect decides *local-only*: no
   `remote.origin.url` configured → local-only; an origin exists → not
   local-only. Whether a not-local-only source then pushes is a separate
   question, answered by rule 3's push default for its tier — CLI-tier
   sources (`gateline up` against `--repo` paths or the cwd default) also
   auto-detect push the same way (`push = originExists`, #149); config-file
   entries and the standalone binary default `push` to `false` even with an
   origin present, and stay a read-only poller (or touch origin not at all)
   unless `push`/`--push` is set explicitly.

**The `--no-push` alias, and where it stops.** `gateline up --no-push` resolves
to full local-only — no push, no `gh` calls, no origin fetch — not merely a
push ceiling; a `--no-push` clone that still fetched origin and opened draft
PRs behind the operator's back was the leak this topology closes. (The
standalone `gateline-orchestrator` binary has no `--no-push` of its own — it
takes `--push` and `--local-only` directly.) The alias holds only at the CLI
tier.
A **config-tier** source with an explicit `push: false` and an origin present
is a different, legal topology — a read-only poller that keeps fetching on
`fetch_interval` and stays on the sync/PR paths — and is left alone; only
`local_only: true`, or a config-tier source with no origin at all, puts a
config source into local-only.

**Guarantees, while local-only is active:**

- No `git push` ever runs — the resolved `push` boolean is forced `false`.
- No `gh`/GitHub API call is made — the draft-PR ensure short-circuits before
  any git or `gh` invocation (at both call sites: the engine's first-dispatch
  ensure and `gateline arm`), and the PR-approval sync path never even
  constructs its provider.
- No `git fetch` of `origin` runs, from either the engine's heartbeat sync or
  the server's per-source interval sync.
- `gateline sync` never throws, including on a repo with no `origin` remote at
  all; it prints the literal `local-only: nothing to sync` and exits 0.

**Naming the mode.** `gateline up`'s startup log states
which resolution path fired: `local-only (--local-only)`, `local-only
(--no-push)`, or `local-only (no origin remote)` on one side; `pushing to
origin (--push)` or `pushing to origin (origin auto-detected)` on the other.
The log line alone answers "will this run touch origin?" without reading
code.

**Out of scope: the hosted deployment.** The `deploy/` hosted entrypoint
(`PUSH_DECISIONS`, the GitHub webhook) legitimately requires a remote — it
clones from `REPO_URL`, and its entire purpose is a shared, origin-backed
record. Local-only is not an option there; see [DEPLOY.md](DEPLOY.md).

## 4. What this deliberately does not change

- The role/contract/registry architecture, the gate discipline, and
  state-in-git as the only interface. This is a deployment-posture change.
- The v0 cockpit mode: a human orchestrator driving a harness by hand remains a
  supported (and load-bearing) operating mode; it is single-writer by nature.
- P2 neutrality: the runner agent is adapter-generic — it executes whatever the
  manifest's headless command is; nothing vendor-specific enters roles or
  contracts.

## 5. Sequencing

Tracked by the topology epic; order chosen so each step removes a live hazard
before the next adds capability:

1. **#104** — orchestrator self-sync (call the source's sync per tick; refuse
   unsupported topologies at startup). Small; stops stale-state derivation.
2. **#103** — push-then-launch + host-scoped escalation on rejection; sync/push
   health surfaced. Makes origin the commit protocol.
3. **#100** — deployment consolidation: one supervised unit, `ORCH_ENABLED=1`
   default, liveness banner, runner script retired.
4. **Runner agent** — subscription-billed dispatch from a workstation without a
   second control plane; unblocks retiring the last legitimate reason for the
   split topology.
