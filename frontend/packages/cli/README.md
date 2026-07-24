# `agentic` — the gate frontend in terminal form

The same portfolio, inbox, and decision write path as FleetView, driveable
entirely from a shell. Nothing here is a second system: every view is
recomputed from `runs/*/state.yaml` in git (R1), every mutation is one
compare-and-swap commit to a run's `state.yaml` (R2), and a malformed packet
is never presented as approvable (R3) — see the
[frontend README](../../README.md) for the three rules and
[docs/FRONTEND.md](../../../docs/FRONTEND.md) for the design.

## Install

Runs from TypeScript source — Node ≥ 24, no build step for the CLI:

```sh
cd frontend && npm install
(cd packages/cli && npm link)   # global `agentic`, linked to this checkout
```

The link points at the checkout, so `git pull` there updates the CLI; re-run
`npm install` after dependency changes. (`npm run build` is only needed for
the web app that `ui`/`up` serve.)

## Commands

```
agentic status                          portfolio: phases, gates, needs-a-human
agentic inbox                           everything waiting on a human, oldest first
agentic approve <slug> <gate>           --burden … [--notes …] [--no-advance] [--hold <reason>]
agentic decline <slug> <gate>           --reason … (pauses the run as gate-declined)
agentic resolve-escalation <slug> <n>   --note … (index shown by inbox)
agentic pause <slug> [--reason …]
agentic resume <slug> [--phase …]       phase derived from the gate ledger if omitted
agentic sync [--live]                   copy approved PR reviews into undecided G2 entries
agentic ui [--demo] [--port N]          serve the web app (no engine)
agentic up [--spend-limit-usd N]        web app + the v1 orchestrator over one clone
```

Global: `--repo <path>` (repeatable) overrides source discovery;
`--source <id>` disambiguates a slug that exists in more than one source.

## Common workflows

**Triage, then decide.** `agentic inbox` lists every gate and escalation
waiting on a human, oldest first. Read the packet's artifacts in your editor
(paths are repo-relative), then:

```sh
agentic approve mdtoc G1 --notes "plan holds"
agentic decline mdtoc G2 --reason "review-02 findings unaddressed"
```

`approve` prompts for the burden category on a TTY
(`confirmation | light-correction | heavy-correction` — the pilot's headline
metric). `decline --reason` is the correction channel back to the producing
role; it pauses the run as `gate-declined`. Once the fix lands,
`agentic resume mdtoc` — the phase is derived from the gate ledger.

**Approve without releasing the next phase.** Two distinct holds:
`--no-advance` records the approval but leaves the phase alone;
`--hold <reason>` approves *and pauses in the same commit* — the
dispatch-safe way to say yes while a human decision is still pending, because
an engine watching the repo never sees an approved-but-undecided window.

**Resolve an escalation.** `agentic inbox` shows each escalation's index;
`agentic resolve-escalation mdtoc 0 --note "proceed with candidate A"`.

**G2 from a PR review.** If the change gate is exercised as a GitHub PR
review, `agentic sync` plans the copy of approved reviews into undecided G2
entries and `sync --live` records them (uses the `gh` CLI's login).

**Many repos.** List sources in `~/.config/agentic/config.yaml` (see the
[frontend README](../../README.md)), or point at one ad hoc with
`--repo <path>`. Hosts integrated under a prefix are discovered via their
`.agentic/framework-lock.json` — no per-host configuration.

**Headless / no browser.** Everything above is already browser-free. The
engine, too — `up` serves FleetView alongside it, but the orchestrator has
its own binary for engine-only operation:

```sh
agentic-orchestrator tick --dry-run   # derive and print each run's next action; write nothing
agentic-orchestrator tick             # one live reconcile pass: dispatch, meter, exit
agentic-orchestrator watch            # resident engine: ref watcher + heartbeat
agentic-orchestrator shadow <slug>    # replay a finished run, derived vs actual
```

`--dry-run` is the safe preview; a live `tick`/`watch` dispatches real,
metered agents. `up` runs exactly one engine over one clone — pass a single
`--repo` (the server may still aggregate more via config).

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
