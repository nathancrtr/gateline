# `gateline` — the gate frontend in terminal form

The same portfolio, inbox, and decision write path as Gatehouse, driveable
entirely from a shell. Nothing here is a second system: every view is
recomputed from `runs/*/state.yaml` in git (R1), every mutation is one
compare-and-swap commit to a run's `state.yaml` (R2), and a malformed packet
is never presented as approvable (R3) — see the
[frontend README](../README.md) for the three rules and
[docs/FRONTEND.md](../../docs/FRONTEND.md) for the design.

## Install

Runs from TypeScript source — Node ≥ 24, no build step for the CLI:

```sh
cd packages && npm install
(cd cli && npm link)   # global `gateline`, linked to this checkout
```

The link points at the checkout, so `git pull` there updates the CLI; re-run
`npm install` after dependency changes. (`npm run build` is only needed for
the web app that `ui`/`up` serve.)

## Commands

```
gateline status                          portfolio: phases, gates, needs-a-human
gateline inbox                           everything waiting on a human, oldest first
gateline new --slug … --title …          stage a run: --brief-file … [--profile patch|standard|full]
                                         [--task-file …] (patch: the work item; arm refuses a stub)
gateline arm <slug>                      start a staged run (also ensures its draft PR)
gateline approve <slug> <gate>           --burden … [--notes …] [--no-advance] [--hold <reason>]
gateline decline <slug> <gate>           --reason … (pauses the run as gate-declined)
gateline resolve-escalation <slug> <n>   --note … (index shown by inbox)
gateline pause <slug> [--reason …]
gateline resume <slug> [--phase …]       phase derived from the gate ledger if omitted
                                         [--cost-limit N] (required from a budget-exhausted pause)
gateline sync [--live]                   copy approved PR reviews into undecided G2 entries
gateline repo add <path> --mode <mode>   list a repository: view | decide | dispatch
                                         [--name …] [--gateline-prefix …]
gateline repo remove <id or name>        drop a repository from the list
gateline repo list                       id, origin, display name, mode, framework ref
gateline ui [--demo] [--port N]          serve the web app (no engine)
gateline up [--spend-limit-usd N]        web app + the v1 orchestrator over one clone
                                         [--spend-window H] (the limit is per rolling window, default 24h)
```

Global: `--repo <path>` (repeatable) names repositories by path in place of
the config file. `--repository <id or name>` picks the repository on any
command that takes a slug, and on `new` and `sync`; it is needed when a slug
exists in more than one. It takes the repository's full id
(`github.com/acme/billing`, `local/sandbox`) or its display name (`billing`),
in any case, and the display name is what `status` and `inbox` print before
each slug. `--source` is its older spelling and still works.

Every next step `inbox` prints can be pasted and run: with several
repositories it carries `--repository <display name>`, as in
`gateline arm add-export --repository billing`; with one it stays bare. A
repository in `view` mode gets no commands, only a line saying so.

## Common workflows

**Triage, then decide.** `gateline inbox` lists every gate and escalation
waiting on a human, oldest first. Read the packet's artifacts in your editor
(paths are repo-relative), then:

```sh
gateline approve mdtoc G1 --notes "plan holds"
gateline decline mdtoc G2 --reason "review-02 findings unaddressed"
```

`approve` prompts for the burden category on a TTY
(`confirmation | light-correction | heavy-correction` — the pilot's headline
metric). `decline --reason` is the correction channel back to the producing
role; it pauses the run as `gate-declined`. Once the fix lands,
`gateline resume mdtoc` — the phase is derived from the gate ledger.

**Approve without releasing the next phase.** Two distinct holds:
`--no-advance` records the approval but leaves the phase alone;
`--hold <reason>` approves *and pauses in the same commit* — the
dispatch-safe way to say yes while a human decision is still pending, because
an engine watching the repo never sees an approved-but-undecided window.

**Resolve an escalation.** `gateline inbox` shows each escalation's index;
`gateline resolve-escalation mdtoc 0 --note "proceed with candidate A"`.

**G2 from a PR review.** If the change gate is exercised as a GitHub PR
review, `gateline sync` plans the copy of approved reviews into undecided G2
entries and `sync --live` records them (uses the `gh` CLI's login).

**Many repos.** `gateline repo add ~/repos/billing --mode decide` lists a
repository in `~/.config/gateline/config.yaml`; `repo list` prints what is
listed and `repo remove billing` drops it. Every entry states a mode: `view`
reads only, `decide` also records decisions, and `dispatch` also lets `up` run
an engine. A decision in a `view` repository is refused with
`refused (view-mode): …` and exit code 1. `repo add` refuses a repository
whose default branch does not carry the framework, and one already listed.
The file format, and the migration for a file written before modes existed,
is in the [frontend README](../README.md). To point at one repository ad hoc,
use `--repo <path>`. A host integrated with a custom `gateline init --prefix`
is added with `--gateline-prefix <dir>`.

`gateline init` ends by printing the `gateline repo add` command for the host.
It is an offer: nothing is written to your config, and the check it runs
reads the default branch, so run it after the scaffold PR merges.

**Headless / no browser.** Everything above is already browser-free. The
engine, too — `up` serves Gatehouse alongside it, but the orchestrator has
its own binary for engine-only operation:

```sh
gateline-orchestrator tick --dry-run   # derive and print each run's next action; write nothing
gateline-orchestrator tick             # one live reconcile pass: dispatch, meter, exit
gateline-orchestrator watch            # resident engine: ref watcher + heartbeat
gateline-orchestrator shadow <slug>    # replay a finished run, derived vs actual
```

`--dry-run` is the safe preview; a live `tick`/`watch` dispatches real,
metered agents. `up` runs exactly one engine over one clone — pass a single
`--repo`, and its Gatehouse serves that repository alone. `gateline ui` serves
the config file's list, with no engine.

## Pitfalls

* **`SyntaxError` at launch** — Node < 24. The CLI runs TypeScript source
  directly; there is no build to fall back on.
* **"git user.name/user.email are unset"** — decisions must be attributable
  to a named human; set both in the clone you are deciding in. Approvals are
  recorded under this identity in the gate grammar
  (`G<N> approved by <name>`).
* **"--burden is required" when scripted** — the burden prompt needs a TTY;
  pipes and CI must pass `--burden` explicitly.
* **"…moved while deciding — re-read and re-present"** — the compare-and-swap
  write refused because the run branch advanced under you. Not an error to
  force: re-run `inbox`, re-read, decide again.
* **A gate renders bounced, with no approve path** — the packet is malformed
  against the host's own `contracts/` templates (R3). Fix the artifact;
  approval is structurally withheld everywhere (CLI, web, API alike), so
  there is no flag to override it.
* **`sync` "did nothing"** — it is a dry run by default (`--live` records),
  needs `gh` authenticated, and only fills G2 entries that are still
  undecided.
* **"no runs found"** — a run exists once its `state.yaml` does; a freshly
  integrated host has none yet. Prefixed hosts are found via the lockfile
  probe, so a missing/renamed `framework-lock.json` also looks like this.
* **A gate appears bot-written** — it can't be: the orchestrator structurally
  never writes `gates.*`; its commits use its own verbs
  (`dispatched | bounced | advanced | escalated | paused | metered`). If you
  see otherwise, treat it as an identity problem and investigate before
  trusting the ledger.
