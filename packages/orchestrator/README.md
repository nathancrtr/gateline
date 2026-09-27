# @gateline/orchestrator — the v1 orchestrator

The [ORCHESTRATOR.md](../../docs/ORCHESTRATOR.md) design, implemented: a
**stateless reconciler** that executes `roles/orchestrator.md` without a human.
Triggers fire an idempotent tick that reads `state.yaml` at the run branch tip,
derives the next action from committed files alone, executes it, CAS-commits,
and exits. Gate waits are rest states and cost nothing. Humans interact only at
gates and escalations, through the frontend or `gateline` CLI, as before.

Rules it is built to be checked against:

- **No code path writes `gates.*`.** "The orchestrator never approves a gate"
  is structural, not behavioral.
- **The co-writer contract** (design §7): CAS ref updates; comment-preserving
  YAML; ISO-8601 timestamps; the orchestrator's own commit verbs
  (`dispatched | bounced | advanced | escalated | paused | metered | harvested`)
  under a bot identity (`gateline-orchestrator`, one per install) — the human
  decision grammar (`G2 approved by <name>`) is reserved for humans.
- **Every model invocation flows through the dispatch seam** and is metered
  into `budget.ledger[]`; enforcement is a pre-flight cap check that pauses
  (`budget-exhausted`), never degrades. Enforcement can be
  switched off with `--no-budget-enforcement` (also on `gateline up`) for
  flat-rate-billed harnesses (#109); metering cannot — the ledger records either way.
- **R2 scoping:** the frontend's "exactly one write path" governs the human
  surfaces (web, CLI, server — still dispatch-free). The orchestrator is the
  sanctioned machine co-writer, a sibling consumer of the same `@gateline/core`
  write path, under the same rules about what it may write.

## Runbook

All commands run from `packages/` (Node ≥ 24, `npm install` once). The target
repo defaults to the current directory; pass `--repo <path>` otherwise.

```bash
# M1 — shadow mode: derive and print; writes nothing, dispatches nothing
node orchestrator/src/main.ts --repo ~/repos/myproject tick --dry-run

# Replay a finished run: engine's derived action vs what the human did
node orchestrator/src/main.ts --repo ~/repos/myproject shadow wordfreq

# M2 — one live reconcile pass (dispatches agents, meters, exits when idle)
node orchestrator/src/main.ts --repo ~/repos/myproject tick

# Resident mode: ref watcher + heartbeat + dispatch completions
node orchestrator/src/main.ts --repo ~/repos/myproject watch

# M3 — cross-vendor: first adapter runs the pipeline; later adapters satisfy
# the registry's avoid_vendor_of pins (reviewer/verifier off the implementer's vendor)
node orchestrator/src/main.ts --repo ~/repos/myproject \
  --adapter claude-code --adapter copilot-cli watch

# Force a scheduled sweep now (dueness bypassed; the open-sweep and
# same-day guards still apply)
node orchestrator/src/main.ts --repo ~/repos/myproject sweep historian
```

**Merge-updates.** `watch` (and `gateline up`, its co-located twin) checks the code
checkout it runs from at each heartbeat/startup tick boundary; once a `git pull`
there fast-forwards past the commit the process started on, it drains in-flight
dispatches and exits `75` (`SUPERSEDE_EXIT_CODE`, docs/ORCHESTRATOR.md §13 —
self-supersede, #141). Pair `watch` with a supervisor (systemd
`RestartForceExitStatus=75`, launchd `KeepAlive`, or the Fly recipe's own restart
loop) for hands-off merge-updates; unsupervised, the process just stops and waits
for a manual restart. `gateline self-update` is the one-command update: refuses on a
dirty tree, `git pull --ff-only`, then `npm install` if `HEAD` moved.

Scheduled roles (design §4.6): when the target repo commits an
`orchestrator.yaml` with a `schedules:` section, every tick also reconciles
those schedules — a due Historian sweep is seeded as `runs/historian-<date>/`
on branch `run/historian-<date>` (a `sweep.yaml` marker as its one-entry
ledger, no `state.yaml`), the role is dispatched through the same seam, and
the branch waits for a human to review the docs-delta and merge. No
`orchestrator.yaml`, no sweeps — the feature is entirely opt-in per repo.
`orchestrator.yaml` is read once at startup, at the same default-branch commit
as the registry and the adapter manifests.

**Limits (the governor, #501).** One governor per process owns
`--max-concurrent-dispatches` and `--spend-limit-usd` / `--spend-window`. Run
dispatches and sweeps both reserve a slot from it before their intent commit,
so a sweep counts toward the cap, and is deferred (written nowhere, derived
again later) when the cap or the spend window refuses it. Recorded sweep costs
count toward the spend window. Runs are taken oldest-waiting first: the run
whose branch tip is oldest. After a restart, open ledger entries hold their
slots until they close or the role timeout passes, and a sweep that was running
when the process died holds its slot until the sweep timeout (30 minutes) passes;
with a cap of 1 that blocks dispatch for that long. The standalone binary has a
governor of its own, so running it beside `gateline up` on one machine doubles
the limits. See docs/ORCHESTRATOR.md §6.

Driving a live toy run end-to-end (the M2 exit criterion):

1. Create the run by hand as in WALKTHROUGH.md §0 (branch,
   `runs/<slug>/`, intent brief, `state.yaml` with a real
   `budget.cost_limit_usd`), commit.
2. Start `watch`. The orchestrator dispatches the Analyst and rests at G0.
3. Decide gates in the frontend (`gateline ui`) or CLI (`gateline approve …`)
   as they arrive in the inbox. Pause any time (`gateline pause`); in-flight
   work lands harmlessly, nothing new launches until you resume.
4. Watch `git log run/<slug>` — every dispatch, bounce, and metering commit is
   there, authored by the bot; every decision is yours, authored by you.

Stopping a resident orchestrator (`watch`, `gateline up`) is a drain ladder (#150),
so picking up a merged fix never has to cost in-flight metered work:

1. First `^C` **drains**: nothing new dispatches; in-flight work runs to its
   normal close (ledger entries land). Each in-flight dispatch is named, with
   progress lines while you wait.
2. Second `^C` **aborts**: the harness process groups are SIGKILLed, but each
   dispatch still resolves through the ordinary failure path — closing commits
   land and the tasks are freed for retry. Killed work, closed books.
3. Third `^C` exits immediately; open ledger entries are aged out by the next
   orchestrator's heartbeat (§4.4 crash recovery).

The heartbeat also warns when an adapter manifest or `orchestrator.yaml`
changes on the default branch after load. Both are read once at startup, from
the default branch, so a merged fix needs a restart to apply. Edits in the
working tree or on another branch are not read, and the heartbeat does not
report them.

## Trigger packaging

`watch` is the resident form. For a machine that should reconcile without a
resident process, drive `tick` from the OS scheduler — the tick is idempotent
and a missed event is only ever a delay, never a lost action:

```bash
# cron: a tick every 5 minutes
*/5 * * * * cd $HOME/repos/gateline/packages && /usr/local/bin/node orchestrator/src/main.ts --repo $HOME/repos/myproject tick >> $HOME/.gateline-orchestrator.log 2>&1
```

```xml
<!-- launchd: ~/Library/LaunchAgents/dev.gateline.orchestrator.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.gateline.orchestrator</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>orchestrator/src/main.ts</string>
    <string>--repo</string><string>/Users/you/repos/myproject</string>
    <string>tick</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/you/repos/gateline/packages</string>
  <key>StartInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>/tmp/gateline-orchestrator.log</string>
  <key>StandardErrorPath</key><string>/tmp/gateline-orchestrator.log</string>
</dict></plist>
<!-- launchctl load ~/Library/LaunchAgents/dev.gateline.orchestrator.plist -->
```

A CI-triggered variant (scheduled + event-dispatched workflows) slots into the
same `tick` entry point without engine changes; out of scope until local v1
has earned trust (design §10).

## How it works

| Module | What it owns |
|---|---|
| `derive.ts` | The derivation table (D0–D19 + DB): observation → rest / dispatch / record / escalate. Pure; one test per row. |
| `observe.ts` | One immutable snapshot per run from committed files: validations, review verdicts, decline events, bounce counts, the ledger. |
| `engine.ts` | The execute half: commit-then-launch (the CAS intent commit is the duplicate-dispatch guard), closing bookkeeping with real usage, stale-dispatch aging, per-run write serialization, and the harvest-commit (#182) that rescues a non-isolated role's uncommitted artifacts before its checkout is torn down. |
| `capabilities.ts` | Reads `roles/<role>.md` frontmatter for `capabilities: [...]` (#182): the engine's only signal for which roles have no shell and must be told the orchestrator will harvest their work for them. |
| `seam.ts` + `manifest.ts` | `dispatch()` driven entirely by adapters' `headless` manifest sections; a new runner costs one manifest. |
| `router.ts` | Dispatch-time P5: `avoid_vendor_of` routes reviewer/verifier to an adapter on a different vendor than the implementer; refuses when two adapters both violate the pin; advisory when one single-vendor adapter makes it unsatisfiable. |
| `workspace.ts` | Run checkouts as disposable worktrees; per-task isolation for parallel implementers with serial fold-back. A fold classifies its own failure (`conflict \| dirty \| contention \| infra`): only a content conflict is a plan defect and escalates, the rest retry. Before the rebase it harvest-commits whatever is uncommitted inside the task's file-contact surface (#184), then discards the tracked dirt outside it and names both that and the untracked files the worktree removal will drop. A failed fold keeps its task branch for inspection. |
| `governor.ts` | Admission (#501): the process's one owner of the concurrency cap and the spend window. Engines and schedulers reserve before committing an intent and release on every path; a release wakes the repositories it refused, round-robin. Holds nothing on disk; seeded from open ledger entries at startup. |
| `triggers.ts` | Ref watcher, heartbeat, dispatch-completion, the governor's wake, manual — all funnel into one non-overlapping tick loop. |
| `schedule.ts` | Scheduled roles (S0–S4 + SB, one test per row): `orchestrator.yaml` schedules → due sweeps, admitted by the governor, seeded as marker-only mini-runs by commit-then-launch, metered through the same seam. |
| `shadow.ts` | M1: replay history, derived vs actual, disagreements dispositioned (see `shadow-wordfreq.md`). |

Crash recovery: job handles are never committed (host ephemera). A `dispatched`
ledger entry with no living job and no artifact is the crash signature;
the heartbeat ages it out (metered at the static estimate, marked `failed`) and
the next derivation re-dispatches — one retry, then escalate. Kill the process
anywhere; restart converges (`test/hardening.test.ts` drills this).

## Autonomy gate

Running M2+ against real work is gated on the DESIGN.md §7 promotion criterion:
sustained majority-`confirmation` burden across v0 gate decisions, and the
shadow bar of **three** full v0 runs whose disagreements are all dispositioned
— met 2026-07-13 (`shadow-wordfreq.md`, `shadow-mdtoc.md`, `shadow-dupefind.md`).
M2 begins with a toy run in this repo, humans at every gate, on the operator's
laptop or their hosted cockpit machine (docs/DEPLOY.md, `ORCH_ENABLED=1` —
which wires in `--push`, `--require-budget`, and `--spend-limit-usd`). Until
that toy run closes, `tick --dry-run` and `shadow` remain the sanctioned modes
outside toy runs.
