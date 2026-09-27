# Several repositories — Design

How one gateline deployment serves more than one repository: what identifies a
repository, how one joins the set, how dispatch is shared between them, and how
Gatehouse and the CLI show runs from several of them at once. It extends
FRONTEND.md §5 (the portfolio across repos), TOPOLOGY.md §3.1 (one authority per
deployment) and INTEGRATION.md §10 question 7 (fleet registration). The
companion issues are #33 (the fleet view as a rebuildable projection) and #34
(budget caps shared across repos), both under the scaling epic #27.

**Status (2026-09-26): decided.** The maintainer confirmed all nineteen
decisions in §11 on 2026-09-26. One of them, the inbox fold (P10), is taken
provisionally, and §16 records what remains open about it. Nothing in this
document is built.

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

The writing side takes one repository, by design:

- `gateline up` exits if it is given a second `--repo`, and starts its server
  over that single repository, so the config file is never read under `up`.
- The standalone `gateline-orchestrator` takes one `--repo` and never calls
  `loadSources`.
- The hosted recipe takes one `REPO_URL`.

So the question this document answers is narrower than "add multi-repo". The
reader exists and has never been designed for. The engine has no answer at all.

## 2. What a two-repository trial showed

On 2026-09-26 a read-only viewer (`gateline ui`, no engine) was pointed at this
repository and at a second host repository whose runs are not SDLC-shaped. 44
runs were listed, 30 of them needing a human. These are the findings, each
observed in the browser or the terminal.

| Surface | How the repository appears | What went wrong |
|---|---|---|
| Inbox | A grey prefix on the slug. Filters exist for kind only. | 24 of the 30 items were "Malformed run state" from one repository. They filled the first screen and pushed this repository's two gate decisions below the fold. |
| Portfolio | A subline under the slug, beside the profile. | Runs from both repositories interleave by recency. There is no grouping and no filter. |
| Metrics | It does not appear. | Approval rates, burden and review rounds are pooled. A gate that over-triggers in one repository is averaged with the other. |
| Run page | Only in the URL. | The header names the run and its branch, and never the repository. |
| CLI `status` | A `source/slug` column. | The same flooding as the inbox. |

Reading the code added five findings the trial could not show.

- **The repository's name is a directory basename.** Two clones with the same
  basename passed as `--repo` get the same id, and the server answers for
  whichever came first. The demo's id is a random temporary directory name.
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

## 3. Goals and non-goals

Goals:

- An operator with a handful of repositories on one machine sees one inbox, one
  portfolio and one set of metrics, and can narrow all three to a repository.
- One `gateline up` dispatches work in all of them, under limits that mean what
  their flags say.
- Every run is named the same way on every machine, in every interface.
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
- **A second authority over one repository.** TOPOLOGY.md §3.1 stands
  unchanged. This document adds repositories to a deployment, and never adds
  deployments to a repository.

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
- **Governor** — the part of `up` that owns the limits shared by every engine
  in the process (§8).
- **Operator scale** — one person, one machine, local clones, roughly two to
  ten repositories.
- **Fleet scale** — more repositories than one machine should clone, read
  through the host's API and an index (#33).

## 5. Three stages

The work is staged so that operator scale is a natural resting point on the way
to fleet scale (decision D1).

| Stage | What it is | State |
|---|---|---|
| 0 | Several repositories can be read. Nothing is designed around them. | Today |
| 1 | Operator scale. §6 to §9 of this document. | Decided, not built |
| 2 | Fleet scale. Sketched in §10 to the level of interfaces. | Parked on #33's trigger |

Stage 1 can be held indefinitely because it adds no infrastructure. There is no
database, no index and no hosted service. Deleting the config file returns the
deployment to a single repository with nothing lost.

Four rules keep stage 2 open while stage 1 is built. Each is a constraint on
stage 1 work.

1. **The repository id is derived, never invented per machine.** An index can
   only be keyed by a name that every reader computes the same way.
2. **Every cross-repository view is a projection.** Nothing about the set is
   stored anywhere except the operator's list. FRONTEND.md §4 principle 6
   already requires this.
3. **The view model never asks whether a repository is a local clone.** It
   reads through `RunSource`. A later `GitHubSource` must be able to stand in
   without the pages changing.
4. **Admission to dispatch passes through one interface.** The governor is that
   interface. At stage 1 it is a function call inside one process. At stage 2
   it is where #34's coordinator attaches.

## 6. Repository identity

**Decision D5.** A repository's id is derived from its origin URL, in the form
`<host>/<owner>/<name>`, for example `github.com/acme/billing`. The operator may
give it a short display name in the config.

Rules:

- The id is computed from `remote.origin.url` by normalizing the SSH and HTTPS
  forms to the same string, lowercasing the host and dropping a `.git` suffix.
- A repository with no origin has no derivable id. Its config entry must then
  carry a `name`, and its id is `local/<name>`. The local-only topology
  (TOPOLOGY.md §3.6) keeps working.
- Two entries that resolve to the same id are an error at startup, naming both
  paths. The `-2` suffix is retired. Two clones of one repository in one
  deployment would be two authorities over the same runs.
- The display name is presentation only. It never appears in a URL, a cache key
  or a commit.
- The record does not change. `state.yaml` carries no repository field and
  needs none, because the repository is the container the record sits in.

A run's full name is `<repository id>/<slug>`. Interfaces shorten it in two
cases only, following the practice GitLab and Argo CD document for their own
references: when the set has one repository, and when the current scope is one
repository. Anything written to disk, logged or copied to the clipboard uses
the full name.

**Decision P1 — the URL shape.** An id contains slashes, and a GitLab id can
nest to any depth, so `/runs/:src/:slug` cannot hold it.

| Option | For | Against |
|---|---|---|
| `/repos/<host>/<owner>/<name>/-/runs/<slug>` | Readable, and the `/-/` separator makes any depth parse without guessing. | Longer URLs. |
| Percent-encode the id into one segment | The route shape stays. | `github.com%2Facme%2Fbilling` is unreadable, and some proxies decode it. |
| A short hash of the id | Short. | Opaque. A URL no longer says where it points. |

Decided: the first. Existing `/runs/<basename>/<slug>` links redirect
when the basename matches exactly one repository in the set, and show a
"which repository?" page when it matches several.

## 7. Registration and configuration

**Decision D6.** A repository joins the set when two things are true: the
operator's config lists it, and the repository carries the framework lock that
`gateline init` writes. Atlantis, Renovate, Backstage and Jenkins all use this
two-key shape, an operator grant plus an opt-in committed to the repository.

- The list stays in `~/.config/gateline/config.yaml`. Repeated `--repo` flags
  remain the no-file form and resolve through the same rules.
- `gateline repo add <path>`, `repo remove <id>` and `repo list` edit and print
  the list. `repo list` shows each repository's id, display name, mode and
  whether its lock was found.
- `gateline init` ends by offering to register the host. This settles
  INTEGRATION.md §10 question 7 as "offered, never automatic".
- A listed repository with no lock is refused with a message that names
  `gateline init`. Today it would appear as a wall of malformed runs.
- The framework's own repository carries no lock, since it is the source of the
  content the lock describes. It is recognized by its shape (`roles/`,
  `contracts/` and `registry/` at the root), which is how framework roots are
  already discovered.

**Decision P2 — per-repository mode.** Each entry declares what the deployment
may do there.

| Mode | Reads | Human decisions | Dispatch |
|---|---|---|---|
| `view` | yes | no | no |
| `decide` | yes | yes | no |
| `dispatch` | yes | yes | yes |

Decided: the three modes, with `dispatch` as the default under
`up` and `decide` as the default under `ui`. This gives a safe way to look at a
repository that another deployment is the authority for. The existing `push`
and `local_only` settings are unchanged and answer a different question, which
is whether origin is touched.

**Decision P3 — which setting wins.** Two files configure a repository: the
operator's config on the machine, and `orchestrator.yaml` committed in the
repository.

| Option | For | Against |
|---|---|---|
| The operator sets a ceiling, and the repository sets policy beneath it | The operator owns the machine and the bill. Atlantis and Argo CD use this shape, as do most tools that execute code. | A repository cannot raise its own limit. |
| The most specific file wins | Familiar from Renovate. | A committed file could raise spend on a machine its author does not own. |

Decided: the ceiling. Limits, adapters and modes belong to the operator.
Sweep schedules stay in `orchestrator.yaml`, read at the default-branch tip as
now. That reading rule becomes an invariant, because Atlantis documents the
alternative, reading configuration from the change's own branch, as a security
risk.

The proposed config, for illustration:

```yaml
limits:
  max_concurrent_dispatches: 2   # the machine, across every repository
  spend_limit_usd: 40            # across every repository, per window
  spend_window_hours: 24
repositories:
  - path: ~/repos/billing
    name: billing                # display name, optional
    mode: dispatch
    limits:
      spend_limit_usd: 25        # optional, beneath the machine's
  - path: ~/repos/ops-notes
    mode: decide
```

The `sources:` key is read as an alias of `repositories:` so existing files
keep working.

## 8. Dispatch

**Decision D3.** One `gateline up` runs one engine instance per repository in
`dispatch` mode, inside one supervised process, under one governor.

This keeps TOPOLOGY.md §3.1 true at the level where it matters. Each repository
still has exactly one authority. The deployment has one process to supervise,
one liveness signal and one place where limits are enforced.

### 8.1 What each engine keeps

Each engine keeps what is about its repository: the ref watcher, the tick, the
write locks, the worktrees (already keyed by a hash of the repository path),
the `engine-health.json` under its git directory, the registry and the adapter
manifests read from that repository.

Two pieces of engine state are module-level today and keyed by slug alone: the
memo of draft PRs already ensured, and the set of runs whose task branches were
reaped. Both move onto the engine instance. The remote runner's intent
(`PendingIntent`) and its job key gain the repository id, and the runner API
stops taking "the first source with a local repo" as its repository.

### 8.2 What the governor owns

The governor owns what is about the machine or the bill.

- **Concurrent dispatches.** One counter for the process. An engine asks the
  governor for a slot before it launches a role and returns it on completion.
- **The spend window.** The projection sums ledger entries across every
  repository in the set, which is what "host-wide" already claims.
- **Per-repository ceilings.** Optional, beneath the machine's. A refusal names
  which limit refused it.

Because every engine is in one process, the governor's check and its grant are
one step with nothing between them. This removes #34's race at operator scale.
It does not settle #34, which concerns several installs sharing a cap.

**Decision P4 — fairness.** When slots are scarce, some repository waits.

| Option | For | Against |
|---|---|---|
| Round-robin between repositories, oldest waiting run first within each | No repository starves. Simple to explain. | A repository with one urgent run waits its turn. |
| Oldest waiting run first, across the set | Closest to today's behaviour. | One repository with a long queue holds every slot. |
| Operator-assigned weights | Expressive. | A knob nobody has asked for yet. |

Decided: round-robin. The deferral chip in Gatehouse already reports a
held dispatch and its rule. It gains the repository.

### 8.3 One code tree for every repository

The engine's code comes from one checkout. Two consequences follow.

**Decision P5 — a framework update restarts every engine together.** The
code-tree monitor pauses dispatch when the checkout leaves the default branch,
and exits with code 75 after a clean fast-forward. With several engines, the
process drains all of them and exits once. Decided: accept this. The
alternative is one process per repository, which is the topology D3 declined.

**Decision P6 — hosts pinned to different framework versions.** Each host's
lock records the framework ref its vendored roles and contracts came from.
Nothing compares that ref with the code that is running. One process will serve
hosts pinned to different refs.

| Option | For | Against |
|---|---|---|
| Show the difference, dispatch anyway | Roles and contracts are read from the host, so the host's content is still what runs. Only the tooling differs. | A contract change the tooling depends on could bounce valid artifacts. |
| Refuse dispatch on a mismatch | Safe. | Every framework update blocks every host until each re-runs `init`. |
| One framework checkout per host | Exact. | Several code trees, several monitors, and the lock stops being the only pin. |

Decided: show the difference per repository, in `repo list` and in Gatehouse,
and dispatch anyway. Whether a difference across a major version should ever
refuse dispatch is left until releases are tagged (§16).

### 8.4 Identity and credentials

**Decision P7 — the bot identity stays one per install.** ORCHESTRATOR.md §12
question 4 already decided this and deferred per-repository identities to
org-level audit. Several repositories do not change the argument.

**Decision P8 — credentials.** Draft PRs are opened by `gh` running inside the
clone, so the target repository and the credential are already resolved per
repository. Two process-wide values remain, `GITHUB_TOKEN` and
`GITHUB_WEBHOOK_SECRET`. Decided: keep both as the default, allow a
per-repository override naming an environment variable, and route each webhook
event by the repository in its payload so that one repository's push syncs only
that repository.

## 9. Gatehouse and the CLI

**Decision D4.** Inbox, Portfolio and Metrics stay joined across the set by
default. A scope control narrows all three at once.

**Decision D7.** A repository is shown as text in a fixed position. No colour
and no per-repository mark is assigned, because colour in Gatehouse carries run
state (GATEHOUSE-DESIGN.md, round 5).

The joined default follows FRONTEND.md §5: the view no terminal or PR list
offers is "what needs a human, everywhere, ranked by age". Every inbox surveyed
in §12 defaults the same way, sectioned by what an item needs and filterable by
repository.

### 9.1 Scope

- The scope control sits in the navigation rail, above Inbox. It lists the set
  by display name, with each repository's count of waiting decisions.
- It is hidden when the set has one repository. A single-repository deployment
  looks exactly as it does today.
- The scope is carried in the URL as a `repo` query parameter, so a scoped view
  can be linked and reloaded.
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

- **Inbox and Portfolio rows:** before the slug, in the row's existing
  secondary text style, as `billing / add-export`. With a one-repository scope
  it is dropped from rows and stated once in the page heading.
- **Run page:** in the header, above the run's name, linking to the Portfolio
  scoped to that repository. Today the header never states it.
- **Grouping:** Portfolio and Inbox gain a "group by repository" toggle. Group
  headings carry the display name, the full id and the counts. An open Argo CD
  issue describes what happens without this, where a filtered list no longer
  shows the dimension it was filtered by.
- **Tooltips and copies** carry the full id.
- **The page title** names the scope, so browser tabs can be told apart.

### 9.3 Flooding

One repository can fill the inbox, as §2 showed. GitHub's inbox has the same
weakness at its own scale: it holds a fixed number of notifications and drops
older ones as new ones arrive, so a busy repository displaces a quiet one.

**Decision P10 — folding repeated items.**

| Option | For | Against |
|---|---|---|
| Fold a repository's unreadable runs into one row | 24 rows become one that says "24 runs in ops-notes have unreadable state". The items that can be decided rise. | One row stands for several facts, so it must state its count and open to the full list. |
| Rank decidable items above undecidable ones | No folding. | Changes "oldest first", which the inbox promises. |
| Leave it to the scope control | No new behaviour. | The default view stays unusable until the operator acts. |

Decided, for now: fold, for the `malformed` kind only, when a repository
contributes more than three. The fold is a count with a link and never drops an
item, so it states that the items exist and changes none of their words
(SEAM.md §2). Gate decisions and escalations are never folded.

The maintainer took the fold provisionally and does not hold "oldest first" as
a literal promise. Splitting the inbox into items that can be decided and items
that cannot, with the second group foldable, may be the better shape. The
second option in the table is therefore still live, and §16 carries it.

### 9.4 Metrics

Pooled rates mislead. A gate approved 100% of the time in one repository and
70% in another shows 85%, and the over-triggering flag (FRONTEND.md §4
principle 4) fires for neither or for both.

**Decision P11 — metrics follow a scope and never require one.**

| Option | For | Against |
|---|---|---|
| Metrics follow the scope, and the unscoped page shows one row per repository under each gate | The pooled figure stays as a total and each repository's figure sits beside it. | A taller page. |
| Metrics require a scope | No pooled figure exists to mislead. | The operator cannot compare. |
| Keep pooling | No work. | The flag is wrong whenever repositories differ. |

Decided: the first. The 90% flag is computed per repository. A
repository with too few decisions to support a rate shows its counts and no
rate.

### 9.5 Liveness

TOPOLOGY.md §3.4 already specifies liveness per repository, and the banner and
chips already iterate engines by id. Three changes are needed:

- They show the display name.
- A repository in `view` or `decide` mode has no engine by design. It shows
  "no engine here" as a plain fact and raises no outage banner.
- The code-tree drift chip describes the one code checkout, so it appears once
  and names no repository.

### 9.6 The CLI

- `status` and `inbox` take `--repo-id <id or display name>` to scope, and
  group by repository when the set has several.
- Every printed next step carries the repository. Today `gateline arm <slug>`
  is printed bare and then refused as ambiguous.
- `--source` remains as an alias.
- `new` continues to require a repository when the set has several.

### 9.7 The demo

`ui --demo` generates one fixture repository with a random id. It becomes two
fixtures with fixed ids, one of them small, so that every state in §9.1 to §9.5
can be trialed and captured. `--demo=single` keeps the one-repository form.

## 10. Freshness and faults

Three server behaviours stop scaling at the second repository. They are
ordinary engineering and carry no fork.

- **Change events name what changed.** The event stream sends the repository
  id, and the run where it is known. Pages refetch only queries that read it.
  The unmerged warm-views work (#461) already validates each view against the
  refs it was derived from, and this completes it.
- **A repository that cannot be read is reported and skipped.** The portfolio
  is built per repository with a fault boundary between them. The failed one
  appears in the scope control and at the top of the page with its error.
- **Repositories are read concurrently,** with a bound, as #463 does for runs.

## 11. Decisions

Confirmed by the maintainer on 2026-09-26:

| # | Decision |
|---|---|
| D1 | The work is staged. Operator scale is a resting point on the way to fleet scale, and fleet scale remains a goal. |
| D2 | A run lives in exactly one repository. Spanning runs are a stated non-goal. |
| D3 | One `up` runs one engine per repository, under one governor. |
| D4 | The views are joined by default, with a scope control and grouping. |
| D5 | The repository id is derived from the origin URL. A display name is presentation only. |
| D6 | A repository joins by being listed by the operator and carrying the framework lock. |
| D7 | A repository is shown as text in a fixed position, with no colour or mark. |

Confirmed by the maintainer later the same day, with the reasoning in the
section named:

| # | Fork | Decision | Section |
|---|---|---|---|
| P1 | URL shape for an id with slashes | `/repos/<id>/-/runs/<slug>`, with redirects | §6 |
| P2 | Per-repository mode | `view`, `decide`, `dispatch` | §7 |
| P3 | Which configuration wins | The operator sets the ceiling | §7 |
| P4 | Fairness when slots are scarce | Round-robin between repositories | §8.2 |
| P5 | A framework update restarts every engine | Accept | §8.3 |
| P6 | Hosts pinned to different framework versions | Show the difference, dispatch anyway | §8.3 |
| P7 | Bot identity | One per install, unchanged | §8.4 |
| P8 | Credentials and webhook routing | Process-wide default, per-repository override, route by payload | §8.4 |
| P9 | Whether the scope is remembered | URL only | §9.1 |
| P10 | Inbox flooding | Fold one repository's unreadable runs into one row, provisionally | §9.3 |
| P11 | Metrics across repositories | Follow a scope without requiring one, one row per repository when unscoped | §9.4 |
| P12 | The word in the interface | "Repository" everywhere, "source" in code only | §4 |

## 12. Prior art

Surveyed on 2026-09-26 from each product's current documentation. Claims are
paraphrased. Where documentation did not state a behaviour, it is left out.

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
| Repository configuration read from the change's own branch | [Atlantis security notes](https://www.runatlantis.io/docs/security) | P3 |
| A parent shows healthy while its children are not | [Argo CD app-of-apps](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/) | D2 |
| A repository's own rules stop applying once several are loaded | [Claude Code projects](https://code.claude.com/docs/en/claude-projects) | §7: every per-repository setting keeps applying at any set size |

## 13. Fleet scale, sketched

Stage 2 is #33 as written. It starts when its trigger fires. This section
records only what stage 1 must leave room for.

| Concern | Stage 1 | Stage 2 |
|---|---|---|
| Reading a repository | `LocalGitSource` over a clone | `GitHubSource` over the host API, with no clone |
| Knowing the set | The operator's list | An installation on an organization, plus the lock as the opt-in |
| Cross-repository views | Computed on request | An index fed by webhooks and rebuildable from the repositories |
| Admission to dispatch | The governor, in process | A coordinator behind the same interface (#34) |
| People | One operator | Several, with routing (#13) |

The index holds derived facts only. Deleting it loses nothing. Each repository
remains the record of its own runs.

## 14. The order of work

Each step ships alone and leaves the deployment working.

1. **Identity.** Derive the id, refuse duplicates, move the URL shape, add
   redirects. Everything later is keyed by it.
2. **Registration.** `gateline repo add|remove|list`, the lock check, the offer
   at the end of `init`.
3. **Faults and freshness.** The fault boundary, change events that name the
   repository, concurrent reads.
4. **Naming in the interface.** The run header, row placement, the page title,
   CLI next steps. This fixes the one-repository run page too.
5. **Scope and grouping.** The scope control, the `repo` parameter, the
   two-number badge, the two-fixture demo.
6. **Flooding and metrics.** The fold, and per-repository metrics.
7. **The governor.** Extracted from the engine while `up` still serves one
   repository, so that the limits are proven unchanged.
8. **Several engines.** `up` reads the list, runs one engine per `dispatch`
   repository, and moves the slug-keyed state onto the instance.
9. **The remote runner and the hosted recipe** carry the repository id.

Steps 1 to 6 need no engine change and can be used with `ui` alone. Step 7 is
the last point at which nothing about dispatch has changed.

## 15. What stays exactly as it is

- The record. `state.yaml`, the artifacts, the run branch and the decision
  grammar carry no repository field.
- One authority per repository, and the blessed checkout on the default branch.
- The orchestrator never writes `gates.*` or `closure`.
- A deployment with one repository and no config file behaves and looks as it
  does today.
- Git is the only authoritative store.

## 16. Open questions

1. **Major versions.** P6 dispatches across any version difference. Once
   releases are tagged, a difference across a major version may need to refuse
   dispatch, and that depends on what a major version will mean.
2. **The inbox's order.** P10 folds unreadable runs and leaves the order
   oldest first. The alternative is two groups, items that can be decided
   above items that cannot, with the second group foldable. The choice should
   be made against the two-fixture demo (§9.7), where both can be seen.
3. **An unreadable host.** The second repository in the trial holds runs that
   do not match the state contract. Whether Gatehouse should read runs of
   another shape is a question for DESIGN.md §4.2 and is outside this document.
   The fold in §9.3 only makes the symptom bearable.
4. **The hosted recipe.** DEPLOY.md's security model is written for one
   repository and one scoped token. Serving several from one hosted instance
   needs its own pass before step 9.
5. **Cross-run citations.** Issue #171 records that a reference such as `R3`
   resolves in the current run's namespace. Several repositories widen the
   ways that can go wrong, and the fix belongs to that issue.
