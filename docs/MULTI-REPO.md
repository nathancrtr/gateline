# Several repositories — Design

How one gateline deployment serves more than one repository: what identifies a
repository, how one joins the set, how dispatch is shared between them, and how
Gatehouse and the CLI show runs from several of them at once. It extends
FRONTEND.md §5 (the portfolio across repos) and INTEGRATION.md §10 question 7
(fleet registration), and it amends TOPOLOGY.md §3.1 and §3.6 (§16 lists every
document it amends). The companion issues are #33 (the view across many
repositories as a rebuildable projection) and #34 (budget caps shared across
repositories), both under the scaling epic #27.

**Status (2026-09-27): decided and built.** The maintainer
confirmed twenty-three decisions in §11 on 2026-09-26, and four more while the
work was built. One further decision was taken in review and awaits him. All ten
steps of §14 have merged; the last, step 9, runs one engine per `dispatch`
repository under `up` (#502). §17 lists what remains open.

**Prerequisite reading:** [TOPOLOGY.md](TOPOLOGY.md) §3,
[FRONTEND.md](FRONTEND.md) §4–§5, [ORCHESTRATOR.md](ORCHESTRATOR.md) §4 and §6,
[INTEGRATION.md](INTEGRATION.md) §3.

---

## 1. The problem, and what already exists

Issue #33 describes a future in which the portfolio reads many repositories
through an index fed by webhooks. It is parked until a portfolio spans more than
one repository. That condition is close: two host repositories carry the
framework today, and an operator with both wants one inbox.

The code is further along than the issue suggests. The reading side has taken a
list of repositories since the first frontend build:

- `loadSources` in `packages/core/src/view-model/config.ts` reads a list from
  `~/.config/gateline/config.yaml`, or from repeated `--repo` flags.
- Every server route, web route and cache key already pairs a repository with a
  run: `/runs/:src/:slug`, `/api/runs/:src/:slug/...`.
- The CLI prints `source/slug` and refuses an ambiguous slug until `--source`
  is given.

The writing side took one repository, by design, until #502:

- `gateline up` exited if it was given a second `--repo`, and started its server
  over that single repository, so the config file was never read under `up`.
- The standalone `gateline-orchestrator` takes one `--repo` and never calls
  `loadSources`.
- The hosted recipe takes one `REPO_URL`.

So the question this document answers is narrower than "add multi-repo". The
reader exists and has never been designed for. The engine has no answer at all.

## 2. What a two-repository trial showed

On 2026-09-26 a read-only viewer (`gateline ui`, no engine) was pointed at this
repository and at a second host repository. The second host's runs do not
follow the gate ladder that the state contract describes, which DESIGN.md §4.2
allows a host to do. 44 runs were listed, 30 of them needing a human. These are
the findings, each observed in the browser or the terminal.

| Surface | How the repository appears | What went wrong |
|---|---|---|
| Inbox | A grey prefix on the slug. Filters exist for kind only. | 24 of the 30 items were "Malformed run state" from one repository. They filled the first screen and pushed this repository's two gate decisions off it. |
| Portfolio | A subline under the slug, beside the profile. | Runs from both repositories interleave by recency. There is no grouping and no filter. |
| Metrics | It does not appear. | Approval rates, burden and review rounds are pooled. A gate that over-triggers in one repository is averaged with the other. |
| Run page | Only in the URL. | The header names the run and its branch, and never the repository. |
| CLI `status` | A `source/slug` column. | The same flooding as the inbox. |

Reading the code added six findings the trial could not show.

- **The repository's id is a local name.** It is the `name` a config entry
  gives, or else the directory's basename. Two clones with the same basename
  passed as `--repo` get the same id, and the server answers for whichever came
  first. The demo's id is a random temporary directory name.
- **One change anywhere refreshes everything.** The server keeps one generation
  counter, and its event stream sends a bare `change`. Every open page refetches
  every query when any repository's refs move.
- **One unreadable repository fails the whole portfolio.** `buildPortfolio`
  walks the repositories in turn with no fault boundary between them.
- **The webhook ignores which repository sent it.** A `push` event syncs every
  repository, and one secret covers all of them.
- **The engine's limits are counted per engine.** `--max-concurrent-dispatches`
  is documented as a machine ceiling and `--spend-limit-usd` as a host-wide
  window, and both are computed from the one repository the engine serves. Two
  engines on one machine double both.
- **A config entry that points inside a repository reads it wrongly.** Config
  entries build their source from the path as written. `--repo` and the
  working-directory default resolve the repository's top first. A config entry
  naming a subdirectory lists runs on `run/` branches with no artifacts, and
  omits runs that exist only on the default branch. No warning is printed. `up`
  passes its path to the engine unresolved in the same way. This was reproduced
  in a throwaway repository during review. It is a defect today, and §14 fixes
  it first.

## 3. Goals and non-goals

Goals:

- An operator with a handful of repositories on one machine sees one inbox, one
  portfolio and one set of metrics, and can narrow all three to a repository.
- One `gateline up` dispatches work in all of them, under limits that mean what
  their flags say.
- A repository with an origin is named the same way on every machine, in every
  interface.
- Each step is a place the project can stop for as long as it likes. Nothing
  built for operator scale has to be thrown away to reach fleet scale.

Non-goals:

- **A run that spans repositories.** A run lives in exactly one repository
  (decision D2). A change that needs two repositories is two runs, coordinated
  by a human. The reason is the record: a finished run is verifiable on its own
  because one branch holds all of it, and a spanning run has no single branch to
  hold its gates, budget or closure.
- **Several users.** Approver pools, routing and permissions belong to the org
  epic (#13). This document assumes one operator.
- **Discovery.** Nothing crawls a directory or an organization for repositories
  at operator scale.
- **A second authority over one repository.** This document adds repositories
  to a deployment. It never adds a second engine to a repository.

## 4. Terms

- **Repository** — one git repository that carries the framework and holds runs.
  This is the word every interface uses.
- **Source** — the driver through which the code reads a repository
  (`RunSource`, with `LocalGitSource` as the one implementation). It stays a
  code term. An operator never needs the word.
- **Repository id** — the canonical name of a repository, defined in §6.
- **The set** — the repositories one deployment serves.
- **Scope** — the subset of the set a person is currently looking at. The
  default scope is the whole set.
- **Mode** — what a deployment may do in one repository: `view`, `decide` or
  `dispatch` (§7).
- **Governor** — the part of `up` that owns the limits shared by every engine
  in the process (§8).
- **Operator scale** — one person, one machine, local clones, roughly two to
  ten repositories.
- **Fleet scale** — more repositories than one machine should clone, read
  through the host's API and an index (#33). "Fleet" in this document always
  means that scale.
- **Collapse** — to show several inbox rows as one counted row (§9.3). The word
  "fold" is avoided because FRONTEND.md and the engine each already use it for
  something else.
- **Code checkout** — the clone the running `gateline` loads its own code from.
  AGENTS.md calls the operator's one "the blessed checkout".
- **Supersede** — the engine ending its own process with exit code 75 after its
  code checkout fast-forwards, so that a supervisor restarts it on the new code
  (ORCHESTRATOR.md §13).
- **Deferral** — a dispatch held back by a limit and written nowhere. Gatehouse
  shows held dispatches as a small labelled mark in the navigation rail.

## 5. Three stages

The work is staged so that operator scale is a natural resting point on the way
to fleet scale (decision D1).

| Stage | What it is | State |
|---|---|---|
| 0 | Several repositories can be read. Nothing is designed around them. | Today |
| 1 | Operator scale. §6 to §10 of this document. | Built |
| 2 | Fleet scale. Sketched in §13 to the level of interfaces. | Parked on #33's trigger |

Stage 1 can be held indefinitely because it adds no infrastructure. There is no
database, no index and no hosted service. Deleting the config file returns the
deployment to a single repository with nothing lost.

Four rules keep stage 2 open while stage 1 is built. Each is a constraint on
stage 1 work.

1. **A repository with an origin has an id derived from that origin.** An index
   can only be keyed by a name that every reader computes the same way. A
   repository with no origin has a local id (§6), is marked as local, and
   cannot enter a stage 2 index until it has an origin.
2. **Every cross-repository view is a projection.** Nothing about the set is
   stored anywhere except the operator's list. FRONTEND.md §4 principle 6
   already requires this.
3. **The view model reads a repository only through `RunSource`.** The source
   reports its own id. A later `GitHubSource` must be able to stand in without
   the pages changing. The server reaches a repository's directory through
   methods on the source, each optional so that a source with no local clone
   can leave it out, and a test fails if a cast to reach the directory
   returns (#496). The CLI reaches a clone the same way: `arm` and `sync`,
   which hand a working directory to `gh`, and `up`, which starts an engine
   there, ask the source for `workingDirectory()`, and a test fails if a cast
   returns to the CLI (#502).
4. **Admission to dispatch passes through one interface.** The governor is that
   interface. At stage 1 it is a function call inside one process. At stage 2
   it is where #34's coordinator attaches.

Three stage 1 mechanisms are tied to a local clone on purpose and are replaced
at stage 2: deriving the id from git config, summing spend by reading ledgers
from clones, and opening draft PRs with `gh` inside a clone.

## 6. Repository identity

**Decision D5.** A repository's id is derived from its origin URL, in the form
`<host>/<owner>/<name>`, for example `github.com/acme/billing`. The operator may
give it a short display name in the config.

**Decision R1.** A repository with no origin has the id `local/<name>`, where
the name is the config entry's `name`, or else the directory's basename.

### 6.1 Deriving the id

- The URL is read with `git remote get-url origin`, which applies the
  operator's `insteadOf` rewrites. One function in the sources layer does the
  derivation. The three parsers of origin URLs that exist today are replaced by
  it.
- SSH and HTTPS forms normalize to the same string. A port, a user, a trailing
  slash and a `.git` suffix are dropped. The host is lowercased.
- Owner and name keep their case in the id. Two ids that differ only in case
  are treated as the same repository.
- A filesystem or `file://` origin yields no id, and the repository is treated
  as having no origin.
- A host alias from `~/.ssh/config` cannot be seen through. The derived host
  would be the alias, which is local to the machine. For this case, and any
  other where derivation is wrong, a config entry may state `id:` outright.
- No segment of an id may be `-`. A `local/` name is limited to letters,
  digits, `.`, `_` and `-`, and may not be `-` alone.

### 6.2 Rules that follow

- Two entries that resolve to the same id are an error at startup, naming both
  paths. The `-2` suffix is retired. The reason is that names and URLs would
  collide. For two `dispatch` entries it would also put two authorities over
  the same runs.
- The display name is presentation only. It never appears in a URL, a cache key
  or a commit. When none is given it is the last segment of the id. Display
  names must be unique within the set, and a collision is a startup error that
  asks for a `name`.
- The record does not change. `state.yaml` carries no repository field and
  needs none, because the repository is the container the record sits in.
- The engine uses the same id. Today it names its source `orchestrator`
  whatever the repository, and its log lines carry only the slug.

A run's full name is `<repository id>/<slug>`. Interfaces shorten it in two
cases only, following the practice GitLab and Argo CD document for their own
references: when the set has one repository, and when the current scope is one
repository. Anything written to disk or logged uses the full name. A control
whose purpose is to copy an address gives the full name. A selection copied
from a page gives what is on the screen, and the full name is on hover.

### 6.3 When an id changes

An id changes when the repository is renamed or transferred on its host and the
clone's origin is updated, or when a local repository gains an origin.

- Nothing the deployment stores is keyed by id. The engine's health file and
  its worktrees are keyed by path. A changed id therefore loses no state.
- Links made under the old id stop resolving. This is accepted. A config entry
  may list `former_ids:` to keep them redirecting.
- A clone whose origin still carries the old name keeps the old id, so two
  machines can disagree until the remote is updated. `repo list` prints the
  origin beside the id to make this visible.

### 6.4 The URL shape

**Decision P1.** An id contains slashes, and a GitLab id can nest to any depth,
so `/runs/:src/:slug` cannot hold it.

| Option | For | Against |
|---|---|---|
| `/repos/<host>/<owner>/<name>/-/runs/<slug>` | Readable, and the `/-/` separator makes any depth parse without guessing. | Longer URLs. |
| Percent-encode the id into one segment | The route shape stays. | `github.com%2Facme%2Fbilling` is unreadable, and some proxies decode it. |
| A short hash of the id | Short. | Opaque. A URL no longer says where it points. |

Decided: the first.

- The slug is everything after `/-/runs/` up to the next route segment, since a
  slug may itself contain a slash.
- The API routes move to the same shape in the same change, together with the
  typed contract in `packages/server/src/contract.ts`, the web client and the
  end-to-end suite.
- An old `/runs/<old id>/<slug>` link redirects when the old id matches exactly
  one repository. The old id is whatever the deployment used before: a config
  `name`, a basename, or either with a `-2` suffix. When it matches several, a
  page asks which repository was meant.

## 7. Registration and configuration

**Decision D6.** A repository joins the set when two things are true: the
operator's config lists it, and the repository carries the framework. Atlantis,
Renovate, Backstage and Jenkins all use this two-key shape, an operator grant
plus an opt-in committed to the repository.

### 7.1 The list

- The list stays in `~/.config/gateline/config.yaml`. Repeated `--repo` flags
  remain the no-file form.
- `gateline repo add <path>`, `repo remove <id>` and `repo list` edit and print
  the list. `repo list` shows each repository's id, origin, display name, mode,
  and the framework ref its lock pins.
- `gateline init` ends by offering to register the host. This settles
  INTEGRATION.md §10 question 7 as "offered, never automatic".
- Every path is resolved to the repository's top before it is used, for the
  server and for the engine alike (§2, the sixth finding).

### 7.2 What counts as carrying the framework

The check reads the repository's default-branch tip through git, as the
existing reader of framework roots does. It passes in either of two cases.

1. A framework lock exists at `<prefix>/framework-lock.json`. The prefix is
   `.gateline` unless the entry's `gateline_prefix` says otherwise. That
   setting is kept.
2. No lock exists, and `roles/`, `contracts/` and `registry/` exist at the
   root. This is the layout of the framework's own repository and of hosts
   integrated by hand before `init` existed. `repo list` marks such a
   repository "no lock".

Anything else is refused with a message. The message names `gateline init`, and
names `gateline_prefix` when a lock is found under another directory. A refused
config entry is left out of the set with that message as a warning, and the
other repositories load (§10); startup stops only when none can be served.

Three limits of the check are stated here so that it is not over-read.

- The second case checks shape only: three directories at the root, whatever
  they hold. Before #495 a repository with no lock was assumed to carry the
  framework at its root, and `--repo` and the working directory still are.
- A host whose `init` change is not yet merged to its default branch is
  refused. That is intended.
- The check catches a mistyped path or an unrelated repository. It would not
  have prevented what the trial saw, because that host carries the framework
  and its runs are unreadable for another reason (§17).

The demo and the test fixtures are generated with the root layout or with a
lock, so that they pass.

### 7.3 Modes

**Decision P2.** Each repository has a mode.

| Mode | Reads | Human decisions | Dispatch | Counts toward the spend window |
|---|---|---|---|---|
| `view` | yes | no | no | no |
| `decide` | yes | yes | no | no |
| `dispatch` | yes | yes | yes | yes |

**Decision R3.** A config entry must state its mode. An entry without one is
refused at startup with a message naming the three. A repository given by
`--repo` or by the working directory has no entry, and keeps today's
behaviour: `dispatch` under `up`, `decide` under `ui`.

The reason is that an engine acts on every run it can see. It ensures a draft
PR for each run on every tick, before it derives what to do and even when it
will do nothing. A repository listed without thought must not reach that code.

Modes bind every entry point. The server refuses a decision for a `view`
repository, and so does the CLI, which loads the list on its own. Under `ui`
no engine runs, and a `dispatch` entry behaves as `decide`.

**Decision R2.** A `dispatch` entry pushes when the repository has an origin
and is local-only when it has none, which is what `up` does today. Explicit
`push` and `local_only` settings win, under the precedence TOPOLOGY.md §3.6
already defines. `view` and `decide` entries keep the config file's present
default, which is not to push unless told to.

Without this rule, moving `up` onto the list would have turned pushing off for
every listed repository, and an engine that commits without pushing is the
split state TOPOLOGY.md §3.2 exists to prevent.

### 7.4 Who owns what

**Decision P3.** Two parties configure a repository: the operator, in the
config file on the machine, and the host repository, in files it commits. The
operator sets a ceiling and the repository sets policy beneath it.

| Option | For | Against |
|---|---|---|
| The operator sets a ceiling, and the repository sets policy beneath it | The operator owns the machine and the bill. Atlantis and Argo CD use this shape, as do most tools that execute code. | A repository cannot raise its own limit. |
| The most specific file wins | Familiar from Renovate. | A committed file could raise spend on a machine its author does not own. |

Decided: the ceiling. What each party owns:

| Setting | Owner | Where it is read |
|---|---|---|
| Which repositories, and each one's mode | Operator | Config file |
| Concurrent dispatches, spend limit and window | Operator | Config file, or flags to `up` |
| Which adapters may run, role timeout, heartbeat, budget enforcement | Operator | Config file, or flags to `up` |
| The engine name that stands in for the hostname | Operator | Config file, or `--engine-name` to `up` |
| Push and local-only | Operator | Config file; flags to `up` for a repository with no config entry |
| Sweep schedules | Host | `orchestrator.yaml`, default-branch tip |
| Model bindings, prices and per-role cost estimates | Host | `registry/models.yaml`, default-branch tip |
| The command an adapter runs | Host | The adapter's `manifest.json`, default-branch tip |
| Role capabilities | Host | Role specs, default-branch tip |
| A run's own budget cap | Host, by the human who stages the run | `state.yaml` |

**Decision R4.** The ceiling is a ceiling on spend as metered, and the host
supplies two inputs to the meter. Its registry supplies the estimates that the
spend projection uses for dispatches still open, and its manifest supplies the
command that is executed. INTEGRATION.md makes both project-owned, and this
design keeps them so. Listing a repository as `dispatch` therefore means
trusting what that repository has merged. The document says so plainly, and
two things follow.

- Adapter manifests and role capabilities are read through git at the
  default-branch tip, where the registry and `orchestrator.yaml` are read, so
  no host input the engine itself acts on comes from a checked-out branch or
  a run branch (#500).
- "Host configuration is read at the default-branch tip" is an invariant in
  AGENTS.md. Atlantis documents the alternative, reading configuration from
  the change's own branch, as a security risk.

The tip is the local default-branch ref, with no fetch, and a host with no
determinable default branch reads its checked-out branch with a startup
warning. The remote runner still reads its manifest from the run branch
(#507), and the harness loads the rendered agent file from the run branch by
design.

Every per-repository setting applies at any size of set. No setting is dropped
because a second repository was added.

The config, for illustration:

```yaml
limits:
  max_concurrent_dispatches: 2   # the machine, across every repository
  spend_limit_usd: 40            # across every dispatch repository, per window
  spend_window_hours: 24
engine:
  adapters: [claude-code]        # defaults for every dispatch repository
  role_timeout_seconds: 1800
  name: workstation-1            # in place of the hostname; unique per repository across machines
  budget_enforcement: true       # false meters spend and enforces no spend limit
repositories:
  - path: ~/repos/billing
    name: billing                # display name, optional
    mode: dispatch
    limits:
      spend_limit_usd: 25        # optional, beneath the machine's
  - path: ~/repos/website
    mode: decide
    gateline_prefix: .framework  # only for a host integrated with --prefix
```

Flags to `up` override `limits:` and `engine:`, and `up` prints at startup each
value it took and where it came from. `--repo` replaces the file whole, its
`limits:` and `engine:` with its list. The `sources:` key is read as
an alias of `repositories:`. An existing file needs a `mode` added to each
entry, and the refusal message says so.

## 8. Dispatch

**Decision D3.** One `gateline up` runs one engine instance per repository in
`dispatch` mode, inside one supervised process, under one governor.

TOPOLOGY.md §3.1 read "one authority per deployment", meaning one supervised
unit over one clone. This design restated it, and #502 made the restatement
true: **one authority per repository, and one process per machine**. Each repository still has exactly
one engine. The machine has one process to supervise, one liveness signal and
one place where limits are enforced.

### 8.1 What each engine keeps

Each engine keeps what is about its repository: the ref watcher, the tick, the
write locks, the scheduler for sweeps, the worktrees (already keyed by a hash
of the repository path), and the `engine-health.json` under its git directory.

Two pieces of engine state were module-level and keyed by slug alone: the memo
of draft PRs already ensured, and the set of runs whose task branches were
reaped. Both moved onto the engine instance (#502).

### 8.2 The governor

The governor owns what is about the machine or the bill.

Before #501, admission was a count taken when a dispatch launched. An engine
compared its own jobs in flight with the cap, and a dispatch that did not fit
was not started and was derived again on a later tick. There was no queue. A
freed slot woke only the engine that freed it, and the others found out on
their next heartbeat, three minutes later by default. Several engines cannot
share a limit on that basis, so the governor works by reservation. It is built
(#501) and described in ORCHESTRATOR.md §6.1.

1. **Reserve.** Before an engine commits a dispatch intent, it asks the
   governor for a slot and states the role's estimated cost. The governor
   checks the concurrency cap, the machine's spend window and the repository's
   own ceiling. It grants or refuses in one step, and a refusal names the limit.
2. **Commit.** The engine commits and pushes the intent and launches the role.
   The reservation becomes a running job.
3. **Release.** The engine releases the slot when the job settles. It also
   releases on every path that reserves without launching: a lost
   compare-and-swap, a rejected push, the guard that refuses to move a finished
   run, and any later guard that defers.
4. **Wake.** A release wakes every engine that was refused since it was last
   woken, and offers the free slots in the order P4 sets.

The spend window is the sum of three things across every `dispatch`
repository: closed ledger entries inside the window, estimates for ledger
entries still open, and estimates for reservations not yet committed to a
ledger. The third term is what several engines ticking at once would otherwise
miss.

Historian sweeps pass through the governor as well. Before #501 each engine's
scheduler started a sweep with no concurrency or spend check, and a sweep's
cost was recorded in `sweep.yaml` where the window never read it. A sweep
takes a slot like any dispatch, and the window reads sweep costs.

**After a restart** the governor holds nothing in memory. Roles are launched
as detached processes and can outlive the process that launched them. The
governor therefore starts by reading the open ledger entries of every
`dispatch` repository and counts each as an occupied slot until it closes or
the role timeout passes.

Because every engine is in one process, reserving is atomic. This removes
#34's race at operator scale, on two conditions: the standalone
`gateline-orchestrator` is not run beside `up` on the same machine, and the
deployment is not the hosted recipe (§8.5). It does not settle #34, which
concerns several installs sharing a cap.

**Decision P4 — fairness.** When slots are scarce, some repository waits.

| Option | For | Against |
|---|---|---|
| Round-robin between repositories, oldest waiting run first within each | No repository starves. Simple to explain. | A repository with one urgent run waits its turn. |
| Oldest waiting run first, across the set | One rule for everything. | One repository with a long queue holds every slot. |
| Operator-assigned weights | Expressive. | A knob nobody has asked for yet. |

Decided: round-robin. It is a change from today, where an engine takes its
runs in alphabetical order of slug. A repository that has reached its own
ceiling is skipped and does not hold the turn. The deferral mark in Gatehouse
gains the repository.

### 8.3 One code checkout for every repository

The engine's code comes from one checkout. Three consequences follow.

**Decision P5 — a framework update restarts every engine together.** The
code-tree monitor pauses dispatch when the code checkout leaves the default
branch or goes dirty, and supersedes after a clean fast-forward. With several
engines, the process drains all of them and exits once, and running roles are
picked up after the restart as §8.2 describes. Decided: accept this. The
alternative is one process per repository, which D3 declined.

This repository is usually both the code checkout and a repository with runs.
A commit to a run branch does not move the default branch, so dispatching here
does not trip the monitor. Merging a finished run to the default branch does,
and restarts every engine. That is the present behaviour, now felt by every
repository in the set.

**Decision P6 — hosts pinned to different framework versions.** Each host's
lock records the framework ref its vendored content came from. Nothing
compares that ref with the code that is running. One process will serve hosts
pinned to different refs. What a dispatch uses, and where it comes from:

| Comes from | What |
|---|---|
| The host, default-branch tip | The registry, contract templates, the lock, sweep schedules, adapter manifests and role capabilities. |
| The host, the run's branch | The rendered agent files the harness loads, and the run's record. |
| The code checkout | The rules that derive the next action, the role list, dispatch prompt bodies, the `state.yaml` parser, contract validation, generated PR descriptions. |

So the host's roles and contracts are what its agents read, and the code
checkout decides whether the host's record can be read at all and what happens
next.

| Option | For | Against |
|---|---|---|
| Show the difference, dispatch anyway | Works with no release process. | A change to the parser or the derivation rules can make an older host's record unreadable. |
| Refuse dispatch on a mismatch | Safe. | Every framework update blocks every host until each re-runs `init`. |
| One framework checkout per host | Exact. | Several code trees, several monitors, and the lock stops being the only pin. |

Decided: show the difference per repository, in `repo list` and in Gatehouse,
and dispatch anyway. Whether a difference across a major version should ever
refuse dispatch is left until releases are tagged (§17).

**One engine's failure must not end the process.** Node ends the process for a
rejected promise that no code caught, and before #502 a git failure while an
engine closed a dispatch was such a rejection. With several engines that would
stop dispatch everywhere. Each engine's tick and each job's settlement now has
a boundary that catches, logs with the repository, and marks that engine
failed in its health file. The other engines continue. Shutdown and supersede
drain every engine (ORCHESTRATOR.md §6.2).

### 8.4 Identity and credentials

**Decision P7 — the bot identity stays one per install.** ORCHESTRATOR.md §12
question 4 already decided this and deferred per-repository identities to
org-level audit. Several repositories do not change the argument.

**Decision P8 — credentials.** Three kinds are in play.

- **The git host.** Draft PRs are opened by `gh` running inside the clone, so
  the target repository is resolved per repository. The credential is whatever
  `gh` and git are configured with on the machine, and a `GITHUB_TOKEN` in the
  environment applies to every repository. Decided: keep that as the default
  and allow a per-repository override naming an environment variable.
- **The webhook.** `GITHUB_WEBHOOK_SECRET` stays process-wide by default, with
  the same override. Each event is routed by the repository named in its
  payload, compared with the ids in the set without regard to case, so one
  repository's push syncs only that repository. The payload's id comes from
  its clone URL, by the same parser as the sources' ids. A repository whose
  id is not the one its origin gives (a `local/` id, or one stated by hand
  that differs), and one served local-only, receives no webhook routing and
  relies on its fetch interval; the server says so once at startup. The per-repository secret
  is not built yet.
- **The model provider.** Roles inherit the process environment, so every
  repository's agents run under the same provider login and bill the same
  account. This design does not change that. The per-repository spend ceiling
  is the control it offers.

### 8.5 The other entry points

- **The standalone `gateline-orchestrator`** stays single-repository. It
  remains the way to run an engine with no server. It has a governor of its
  own, not shared with `up`, so running it beside `up` on one machine doubles
  the limits, and its help text, `up`'s and the runbook say so.
- **The hosted recipe** runs the engine binary and the server as two
  processes. An in-process governor does not apply to it. It stays
  single-repository until it has its own design pass (§17).
- **The remote runner** is not enabled by any entry point today. Its intent
  and its job key carry the slug and no repository, and the runner API takes
  the first source with a local clone as its repository. These gain the
  repository id when the runner is wired in, and not before.
- **`gateline new` and `arm`** require a repository when the set has several,
  as `new` does today. Whether `arm` is allowed in a `decide` repository is
  open (§17).
- **`shadow`** replays a finished run and takes a repository the same way.
- **`self-update`** acts on the code checkout and is unchanged.

## 9. Gatehouse and the CLI

**Decision D4.** Inbox, Portfolio and Metrics stay joined across the set by
default. A scope control narrows all three at once.

**Decision D7.** A repository is shown as text, in the same position on every
row, card and page. No colour and no per-repository mark is assigned, because
colour in Gatehouse carries run state (GATEHOUSE-DESIGN.md, round 5). Where a
page shows one repository only, the name is stated once in the page heading
and left off its rows.

The joined default follows FRONTEND.md §5: the view no terminal or PR list
offers is "what needs a human, everywhere, ranked by age". Every inbox surveyed
in §12 defaults the same way, sectioned by what an item needs and filterable by
repository.

### 9.1 Scope

- The scope control sits in the navigation rail, above Inbox. It lists the set
  by display name, with each repository's count of waiting decisions.
- It is hidden when the set has one repository. A single-repository deployment
  looks as it does today, apart from its URLs (§15).
- The scope is carried in the URL as a `repo` query parameter, so a scoped view
  can be linked and reloaded. While the served set has not yet loaded (or
  `/api/health` has failed), a link built from it keeps the URL's `repo`
  unchanged rather than resolving it against a set that is not yet known
  (#551).
- The Inbox badge always counts the whole set. When a scope is active it reads
  as two numbers, for example `3 of 30`. A decision waiting outside the scope
  stays visible as a number, which is the reason a switcher was declined.

**Decision P9 — whether the scope is remembered.**

| Option | For | Against |
|---|---|---|
| URL only | A fresh visit always shows everything. Nothing is hidden by a forgotten setting. | The operator re-selects each session. |
| Remembered in the browser | Convenient for someone who mostly works in one repository. | A stale scope hides decisions, softened only by the badge. |

Decided: URL only.

### 9.2 Where the repository's name goes

- **Inbox rows:** before the slug, in the row's existing secondary text
  style, as `billing / add-export`. An inbox row is a sentence, so the name is
  part of it.
- **Portfolio and the Metrics budget table:** a `repository` column to the
  left of `run`. These are registers, and a name printed inside the run cell
  left the slugs ragged, so they could not be scanned down the column. Below
  1280px the column is not drawn and the name folds under the slug.
- **Run page:** in the header, above the run's name, linking to the Portfolio
  scoped to that repository.
- **Grouping:** Portfolio and Inbox gain a "group by repository" toggle. Group
  headings carry the display name, the full id and the counts. An open Argo CD
  issue describes what happens without this, where a filtered list no longer
  shows the dimension it was filtered by. Under a group heading the rows leave
  the name off, as they do under a one-repository scope, because the heading
  states it; a screen reader still hears it with each row.
- **Tooltips** carry the full id.
- **The page title** names the scope, so browser tabs can be told apart.

Text alone distinguishes repositories, so display names must be unique (§6.2),
and the name is real text that a screen reader reads with the row.

### 9.3 Flooding

One repository can fill the inbox, as §2 showed. GitHub's inbox has the same
weakness at its own scale: it holds a fixed number of notifications and drops
older ones as new ones arrive, so a busy repository displaces a quiet one.

**Decision P10 — collapsing repeated items.**

| Option | For | Against |
|---|---|---|
| Collapse a repository's unreadable runs into one row | 24 rows become one that says "24 runs in website have unreadable state". The items that can be decided rise. | One row stands for several facts, so it must state its count and open to the full list. |
| Rank decidable items above undecidable ones | No collapsing. | Changes "oldest first", which the inbox promises. |
| Leave it to the scope control | No new behaviour. | The default view stays unusable until the operator acts. |

Decided: collapse, for the `malformed` kind only, when a repository
contributes more than three. Gate decisions and escalations are never
collapsed. The collapsed row is a count that opens in place to the full list,
and never drops an item: every count on the page counts the items it stands
for. Its sentence is the interface speaking, so under SEAM.md §2 it is
composed in the web package from a count and a repository that core supplies
(`inboxCollapses`, sent on `/api/inbox` as `collapsed`).

Both shapes were compared on a flooded set on 2026-09-27, and the collapse was
kept because a bounced packet needs a person's work and stays visible at its
age.

### 9.4 Metrics

Pooled rates mislead. A gate approved every time in one repository and seven
times in ten in another shows a pooled rate somewhere between, weighted by how
many decisions each has. The over-triggering flag (FRONTEND.md §4 principle 4)
then fires for neither or for both.

**Decision P11 — metrics follow a scope and never require one.**

| Option | For | Against |
|---|---|---|
| Metrics follow the scope, and the unscoped page shows one row per repository under each gate | The pooled figure stays as a total and each repository's figure sits beside it. | A taller page. |
| Metrics require a scope | No pooled figure exists to mislead. | The operator cannot compare. |
| Keep pooling | No work. | The flag is wrong whenever repositories differ. |

Decided: the first. The 90% flag is computed per repository, and the pooled
total carries no flag. The flag needs five decisions at a gate today. Split by
repository, many rows will fall short of that, and such a row shows its counts
and no rate.

### 9.5 Liveness

TOPOLOGY.md §3.4 already specifies liveness per repository, and the banner and
marks already iterate engines by id. Today the presence of a health file is
what tells the server that an engine is expected. With modes, the expectation
comes from the mode.

| Mode | Health file | What Gatehouse shows |
|---|---|---|
| `dispatch` | Fresh | Nothing. The engine is live. |
| `dispatch` | Stale or absent | The outage banner, naming the repository. |
| `view` or `decide` | Absent | "No engine in this deployment", as a plain fact. |
| `view` or `decide` | Fresh | "An engine outside this deployment, last seen" and the time. |
| `view` or `decide` | Stale | "No engine in this deployment". No banner. |

Drift between the running code and the code checkout is written into every
repository's health file, because each engine writes its own. It describes the
one code checkout, so Gatehouse shows it once and names no repository. It is
shown when any health file reports it, and the most recent of those speaks
for it.

The server sends the two facts separately: each repository's mode on
`/api/health`, its health file on `/api/engine-health`. Gatehouse applies the
table. The outage banner stays at the top of the page. The plain facts sit
beside the repository's name in the rail: under each entry of the scope
control when the set has several, and at the rail's foot when it has one.

A fact every repository shares is said once. When all the repositories that
could be read have the same mode and the same outcome in the table above, the
rail's foot states it for the set and no entry repeats it. When they differ,
each entry states its own and the foot says nothing about mode or engine.
Last-seen times do not count toward a difference, but an engine outside the
deployment is shown with its own last-seen time, so any such repository makes
the set differ. A repository that could not be read is left out of the
comparison and keeps its own mark under its entry. Below 768px the facts sit
at the foot of the page under the same rule.

### 9.6 The CLI

- `status` and `inbox` take `--repository <id or display name>` to scope, and
  group by repository when the set has several.
- Every printed next step carries the repository when the set has several.
  Today `gateline arm <slug>` is printed bare, and is refused if another
  repository has a run of the same slug.
- `--source` remains as an alias of `--repository`. The global `--repo <path>`
  keeps its meaning, which is to name a repository by path in place of the
  config file.
- `gateline repo` is the subcommand that edits the list (§7.1).

### 9.7 The demo

`ui --demo` generates two fixtures in directories with fixed names, so their
ids are `local/demo` and `local/demo-small`, and every state in §9.1 to §9.5
can be trialed and captured. `demo` holds a run in every state; `demo-small`
holds four runs in four states, so the two are easy to tell apart and their
counts differ. `--demo=single` keeps the one-repository form.

## 10. Freshness and faults

Three server behaviours stop scaling at the second repository. They are
ordinary engineering and carry no fork.

- **Change events name what changed.** The event stream sends the repository
  id, and the run where it is known. Pages refetch only queries that read it.
  One event lists everything that moved since the last, as
  `{ changes: [{ source, slug }] }`. A slug of null means the repository as a
  whole: its default branch moved, which every run's views read, or more
  runs moved at once than are worth listing.
- **A repository that cannot be read is reported and skipped.** The portfolio
  and the metrics are built per repository with a fault boundary between
  them. The failed one is returned beside the rows, with its error on one
  line, and the page shows it in the scope control and at the top (§14
  step 6).
- **Repositories are read concurrently,** with a bound. Four are read at a
  time, and each summarizes up to eight runs at a time, so at most 32
  summaries are in flight.

This was built by #496 on the views that stay valid until their refs move
(PR #462) and the portfolio built several runs at a time (PR #463).

## 11. Decisions

Confirmed by the maintainer on 2026-09-26, before review:

| # | Decision | Section |
|---|---|---|
| D1 | The work is staged. Operator scale is a resting point on the way to fleet scale, and fleet scale remains a goal. | §5 |
| D2 | A run lives in exactly one repository. Spanning runs are a stated non-goal. | §3 |
| D3 | One `up` runs one engine per repository, under one governor. | §8 |
| D4 | The views are joined by default, with a scope control and grouping. | §9 |
| D5 | The repository id is derived from the origin URL. A display name is presentation only. | §6 |
| D6 | A repository joins by being listed by the operator and carrying the framework. | §7 |
| D7 | A repository is shown as text in the same position everywhere, with no colour or mark. | §9 |
| P1 | URLs take the shape `/repos/<id>/-/runs/<slug>`, with redirects. | §6.4 |
| P2 | Each repository has a mode: `view`, `decide` or `dispatch`. | §7.3 |
| P3 | The operator sets the ceiling. | §7.4 |
| P4 | Round-robin between repositories when slots are scarce. | §8.2 |
| P5 | A framework update restarts every engine together. | §8.3 |
| P6 | A framework version difference is shown, and dispatch proceeds. | §8.3 |
| P7 | One bot identity per install, unchanged. | §8.4 |
| P8 | Credentials are process-wide by default with a per-repository override. Webhooks route by payload. | §8.4 |
| P9 | The scope lives in the URL only. | §9.1 |
| P10 | One repository's unreadable runs collapse into one row. | §9.3 |
| P11 | Metrics follow a scope without requiring one, with one row per repository when unscoped. | §9.4 |
| P12 | "Repository" is the word in every interface. "Source" stays in code. | §4 |

Confirmed by the maintainer on 2026-09-26, after review:

| # | Decision | Section |
|---|---|---|
| R1 | A repository with no origin has the id `local/<name>`, falling back to the directory's basename. | §6 |
| R2 | A `dispatch` entry pushes when an origin exists. | §7.3 |
| R3 | A config entry must state its mode. | §7.3 |
| R4 | The document states that dispatch trusts the host's merged registry and manifests, and manifest and capability reads move to the default-branch tip. | §7.4 |

Confirmed by the maintainer on 2026-09-27, while the work was built:

| # | Decision | Section |
|---|---|---|
| B1 | In the Portfolio and the Metrics budget table the repository has a column of its own. The Inbox keeps it before the slug. This refines D7. | §9.2 |
| B2 | A selection copied from a page gives what is on the screen. | §6.2 |
| B3 | The collapse is kept. It was compared with a two-group inbox on a flooded set. P10 is no longer provisional. | §9.3 |
| B4 | A mode and engine state shared by every repository is stated once. | §9.5 |

Taken in review of #514 and not yet confirmed by the maintainer:

| # | Decision | Section |
|---|---|---|
| B5 | A repository that fails the framework check is left out of the set with a warning. An error in the config file itself stops startup. | §7.2 |

## 12. Prior art

Surveyed on 2026-09-26 from each product's current documentation. Claims are
paraphrased. Where documentation did not state a behaviour, it is left out.
The review of this document did not re-check this section.

| Pattern | Where it appears | What this design takes |
|---|---|---|
| One stream, sectioned by what an item needs, with the repository as a filter | [GitHub's inbox](https://docs.github.com/en/account-and-profile/managing-subscriptions-and-notifications-on-github/viewing-and-triaging-notifications/managing-notifications-from-your-inbox), [Graphite's PR inbox](https://graphite.com/docs/use-pr-inbox), [Linear's inbox](https://linear.app/docs/inbox), [Buildkite's pipeline list](https://buildkite.com/docs/pipelines/dashboard-walkthrough) | D4 |
| A global view and a per-repository view, side by side | [GitLab merge requests](https://docs.gitlab.com/user/project/merge_requests/), [Copilot's agent sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/manage-agents) | The scope control |
| An operator grant plus an opt-in committed to the repository | [Atlantis](https://www.runatlantis.io/docs/server-side-repo-config), [Renovate](https://docs.renovatebot.com/self-hosted-configuration/), [Backstage](https://backstage.io/docs/integrations/github/discovery), [Jenkins](https://www.jenkins.io/doc/book/pipeline/multibranch/) | D6 |
| The operator sets a ceiling and names what a repository may override | [Atlantis](https://www.runatlantis.io/docs/server-side-repo-config), [Argo CD Projects](https://argo-cd.readthedocs.io/en/stable/user-guide/projects/) | P3 |
| Qualified names, shortened inside the home scope | [GitLab references](https://docs.gitlab.com/user/markdown/), [Argo CD](https://argo-cd.readthedocs.io/en/stable/operator-manual/app-any-namespace/), and [Backstage](https://backstage.io/docs/features/software-catalog/references), which forbids shortening in storage | §6 |
| One unit of work across repositories, with generated children | [Sourcegraph Batch Changes](https://sourcegraph.com/docs/batch-changes), [Argo CD ApplicationSet](https://argo-cd.readthedocs.io/en/stable/operator-manual/applicationset/) | Declined, D2 |

Failures reported by users of those tools, which this design is shaped to
avoid. The search looked for complaints, so these show that each failure
happens and say nothing about how often.

| Failure | Report | Answer here |
|---|---|---|
| A busy repository displaces a quiet one in a bounded inbox | [GitHub community discussion 186939](https://github.com/orgs/community/discussions/186939) | §9.3 |
| Dashboards exist per repository with nothing above them | [Renovate issue 19324](https://github.com/renovatebot/renovate/issues/19324), closed as not planned | D4 |
| A filtered list stops showing what it was filtered by | [Argo CD issue 16377](https://github.com/argoproj/argo-cd/issues/16377) | §9.2 |
| Repository configuration read from the change's own branch | [Atlantis security notes](https://www.runatlantis.io/docs/security) | R4 |
| A parent shows healthy while its children are not | [Argo CD app-of-apps](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/) | D2 |
| A repository's own rules stop applying once several are loaded | [Claude Code projects](https://code.claude.com/docs/en/claude-projects) | §7.4 |

## 13. Fleet scale, sketched

Stage 2 is #33 as written. It starts when its trigger fires. This section
records only what stage 1 must leave room for.

| Concern | Stage 1 | Stage 2 |
|---|---|---|
| Reading a repository | `LocalGitSource` over a clone | `GitHubSource` over the host API, with no clone |
| Naming a repository | Derived from the clone's origin, or `local/` | Reported by the host. `local/` repositories are not eligible. |
| Knowing the set | The operator's list | An installation on an organization, plus the lock as the opt-in |
| Cross-repository views | Computed on request | An index fed by webhooks and rebuildable from the repositories |
| Admission to dispatch | The governor, in process | A coordinator behind the same interface (#34) |
| People | One operator | Several, with routing (#13) |

The index holds derived facts only. Deleting it loses nothing. Each repository
remains the record of its own runs.

## 14. The order of work

Each step leaves the deployment working, and the demo and test fixtures
passing. Where a step depends on another, it says so.

0. **Resolve every path to the repository's top.** Fixes the sixth finding in
   §2 for config entries, for `up` and for the standalone binary, with a test
   for the config-file path. Independent of everything below. Done by #493.
1. **Identity.** Derive the id with one parser, add the `local/` fallback,
   refuse duplicates, and have the source report its id. Move the web and API
   routes, the typed contract, the client and the end-to-end suite together.
   Add redirects. Generate the demo and fixtures in directories with fixed
   names. Done by #494, after PR #462 merged, since it re-keys that work.
2. **Registration and modes.** `gateline repo add|remove|list`, the framework
   check, the required `mode`, the push default, enforcement in the server and
   the CLI, the offer at the end of `init`. Fixtures gain the root layout or a
   lock. Done by #495, together with the CLI half of step 4 (`--repository`,
   and next steps that name the repository).
3. **Faults and freshness.** The fault boundary, change events that name the
   repository, concurrent reads, webhook routing, and the three casts moved
   behind methods on the source. Done by #496.
4. **Naming in the interface.** The run header, row placement, the page title,
   CLI next steps. This fixes the one-repository run page too. Done by #497:
   the web in #515, the CLI with step 2.
5. **Scope and grouping.** The scope control, the `repo` parameter, the
   two-number badge, the two-fixture demo. Depends on step 1's fixtures.
   Done by #498, with the CLI's grouping and `--repository` scope on
   `status` and `inbox`. The Metrics gate table follows the scope since
   step 6 split it by repository (#540).
6. **Flooding, metrics and liveness by mode.** The collapse, per-repository
   metrics, and the table in §9.5. Done by #540 (per-repository metrics) and
   #541 (the collapse, the notice for a repository that cannot be read,
   liveness by mode, and each repository's name and mode on the wire).
7. **Host inputs at the default-branch tip.** Adapter manifests and role
   capabilities are read through git (R4). Independent of steps 1 to 6. Done
   by #500 (PR #505).
8. **The governor.** Reserve, commit, release and wake, with sweeps admitted
   through it, built while `up` still serves one repository. This changes
   behaviour and is not a refactor: admission moves from a count at launch to
   a reservation, and the order of dispatch changes. With one engine it is
   tested for the same admissions as before. Fairness, waking and recovery
   after a restart are tested with two engine instances in the test suite.
   Done by #501.
9. **Several engines.** `up` reads the list and runs one engine per `dispatch`
   repository. Slug-keyed state moves onto the instance, the engine takes the
   repository id, each engine gets a fault boundary, and shutdown drains all
   of them. Depends on steps 2, 7 and 8. Done by #502: the orchestrator
   package in #538, and `up` serving the set in PR_NUMBER.

Steps 0 to 6 need no engine change and can be used with `ui` alone. After
step 7 nothing about admission has changed. Step 8 is the first that does.

The remote runner and the hosted recipe are outside this order (§8.5).

## 15. What stays exactly as it is

- The record. `state.yaml`, the artifacts, the run branch and the decision
  grammar carry no repository field.
- One engine per repository, and the code checkout on the default branch.
- The orchestrator never writes `gates.*` or `closure`.
- Registry and adapter manifests remain the host's, as INTEGRATION.md has
  them.
- Git is the only authoritative store.
- A deployment with one repository and no config file behaves as it did
  before this work, with four visible differences. Its URLs take the new
  shape, and old links redirect. The run page names the repository in its
  header. On the Metrics page a gate with fewer than five decisions shows its
  counts and no rate. Runs are dispatched oldest-waiting first, where they
  went in alphabetical order of slug.

## 16. Documents this design amends

Each is changed in the same pull request as the step that makes it untrue.

| Document | What changes | Step |
|---|---|---|
| AGENTS.md | The invariant "one authority per deployment" is restated as one engine per repository and one process per machine. The `up` command line and the status paragraph stop saying "a single clone". A new invariant records that host configuration is read at the default-branch tip. | 7, 9 |
| TOPOLOGY.md §3.1 | The same restatement. | 9 |
| TOPOLOGY.md §3.6 | The table of push defaults gains the `dispatch` entry (R2). | 2 |
| ORCHESTRATOR.md §6 | The spend window and the concurrency cap are described as the governor's, with the reservation steps. | 8 |
| INTEGRATION.md §10 | Question 7 is recorded as resolved. | 2 |
| FRONTEND.md §5 | Points here for the portfolio across repositories. | 5 |
| `packages/README.md`, `packages/cli/README.md` | The config example, the required `mode`, `gateline repo`, and the warning about running the standalone engine beside `up`. | 2, 9 |
| DEPLOY.md | States that the hosted recipe serves one repository. | 9 |

## 17. Open questions

1. **Major versions.** P6 dispatches across any version difference. Once
   releases are tagged, a difference across a major version may need to refuse
   dispatch, and that depends on what a major version will mean.
2. **A host whose runs are another shape.** The second repository in the trial
   holds runs that do not match the state contract. Whether Gatehouse should
   read them is a question for DESIGN.md §4.2 and is outside this document.
   The collapse in §9.3 only makes the symptom bearable.
3. **The promotion criterion.** DESIGN.md §7 ties autonomy to measured gate
   burden. With several repositories, it is undecided whether promotion is
   judged per repository or across the set.
4. **`arm` in a `decide` repository.** Arming ensures a draft PR, and no
   engine in this deployment will dispatch the run. It may still be wanted by
   a human driving the pipeline by hand.
5. **The hosted recipe.** It runs two processes, and DEPLOY.md's security
   model is written for one repository and one scoped token. Serving several
   needs its own design.
6. **Cross-run citations.** Issue #171 records that a reference such as `R3`
   resolves in the current run's namespace. Several repositories widen the
   ways that can go wrong, and the fix belongs to that issue.
