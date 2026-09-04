# Walkthrough: run a toy task through the pipeline

This exercises the v0 operating mode (you = Orchestrator) end to end, in this repo,
using the Claude Code adapter. The toy task: a small Python CLI, `wordfreq`, that
prints the top-N most frequent words in a text file. Small enough to finish in a
session; real enough to exercise every handoff.

Everything below happens in a Claude Code session opened in this repo.

**How dispatches work:** the indented "Use the **X** subagent…" lines are ordinary
chat messages you type to the main session — there is no special syntax. Claude Code
loads `.claude/agents/*.md` at session start (verify with `/agents`; restart the
session if you created or edited them mid-session), and when your message names a
subagent, the main session spawns it with your text as its dispatch prompt. It runs
cold in its own context, under its own model and restricted tools, and reports back.
Naming the agent explicitly matters: it guarantees delegation instead of the main
session doing the role's work itself with its full toolset.

## 0. Set up the run

```bash
git checkout -b run/wordfreq
mkdir -p runs/wordfreq/tasks
cp contracts/state.yaml runs/wordfreq/state.yaml   # edit: run/branch names, budget
cp contracts/intent-brief.md runs/wordfreq/intent-brief.md
```

Fill in the intent brief yourself — you're the human with the intent. For the toy:

> **Problem:** We need a quick way to see the most common words in a text file from
> the shell. **Motivation:** exercising the agent pipeline on something verifiable.
> **Constraints:** Python 3, stdlib only, single file, `pytest` for tests.
> **Out of scope:** stemming, stop-word lists, multi-file input, packaging/PyPI.

Commit: `git add runs/ && git commit -m "wordfreq: intent brief"`.

This walkthrough runs the `full` profile — every role, every gate — which is also
what an absent `profile:` field means. Smaller changes can declare a reduced
profile in the brief and `state.yaml` (`standard`: no Ops/G3, the merge is the
release; `patch`: Implementer + Reviewer only, you author the single work item
yourself and G1 approves brief + work item together). See DESIGN.md §4.1 for the
role/gate matrix and the upgrade guardrail.

For a `patch` run, supply the work item when you stage it: `gateline new
--profile patch --brief-file <brief> --task-file <work-item>` writes your file as
`tasks/01-<slug>.yaml`. Staged without one, the run carries a stub and `arm`
refuses until it is written. If you fill the stub in by hand, do it on
`run/<slug>` from a throwaway `git worktree` — never by checking the run branch
out in the blessed checkout (TOPOLOGY.md §3.5).

## 1. Spec (Analyst → G0)

Dispatch:

> Use the **analyst** subagent for run `runs/wordfreq`.

Read the resulting `runs/wordfreq/spec.md`. Your G0 review: are the numbered
requirements what you meant? Veto or accept each `ASSUMPTION`. When satisfied, record
it in `state.yaml` (`G0: {approved: true, by: <you>, at: <date>}`), set
`phase: plan`, commit.

## 2. Plan (Architect → G1)

> Use the **architect** subagent for run `runs/wordfreq`.

Your G1 review: judge the ADRs (each names its rejected alternative — do you agree?),
check the requirement→task table covers everything, check the tasks' file-contact
surfaces don't overlap. Record G1, set `phase: implement`, commit.

## 3. Build (Implementer ⇄ Reviewer, per task)

For each task (parallel-safe tasks can go to parallel subagents):

> Use the **implementer** subagent on task `runs/wordfreq/tasks/01-<name>.yaml`.

Then:

> Use the **reviewer** subagent on task `runs/wordfreq/tasks/01-<name>.yaml`,
> reviewing the diff of the last commit(s) for that task.

The diff you name must bound **that task's changes only**. On a branch already
carrying earlier tasks' commits, give the reviewer the task's own commit range
(`<sha-before-task>..HEAD`), never the whole branch against its base — the whole
branch reads as one giant boundary violation. Commit each task before dispatching
its review so the range is well-defined.

- Verdict `request-changes` → bump the task's `review_rounds` in `state.yaml` (its
  only home) and re-dispatch the implementer **with the review report path in the
  prompt**. Cap: 3 rounds, then it's yours.
- Verdict `approve` → mark the task `in-review → verified`-eligible and move on.
- Verdict `escalate` → the reviewer found something no implementer round can fix
  (branch damage, a plan defect, cross-task fallout). Fix the named condition in
  the repo yourself, then dispatch the reviewer for a **fresh round** — the review
  report is append-only, so the standing `escalate` is superseded only by a newer
  verdict, never edited away. (In v1 the orchestrator does this for you: resolving
  the escalation after the verdict landed dispatches the re-review round.)

### Recovering when a task's contact surface was too narrow

Sometimes the implementer needed a file the task never declared — the code is
right, the boundary was wrong. The reviewer flags it (correctly) under Boundaries.
The defect lives in the **plan layer**, so the fix belongs there, not in the review
artifacts:

1. **Widen the task.** Add the file(s) to `file_contact_surface` in
   `runs/<slug>/tasks/NN-<name>.yaml`. You approved the plan at G1, so widening it
   is your call — but first check the widened surface against every other task's
   surface; if it now overlaps a parallel task, serialize them.
2. **Log it.** Append one line to the task's `notes:` saying what was added and
   why. `notes:` is append-only; it is what the next review round reads.
3. **Leave `review-NN.md` alone.** Review reports are append-only history, and
   deleting a finding changes nothing anyway: every round re-derives the boundary
   check from the task file and the diff, not from the previous report.
4. **Reset via the round machinery**, exactly as for any `request-changes`: bump
   `review_rounds` in `state.yaml`, re-dispatch the implementer with the review
   report path (with the surface widened and the code already correct, its job is
   the rebuttal note in `notes:`), then re-dispatch the reviewer — round 2 verifies
   the finding against the amended task file and appends its section to the report.

Hand-widening the surface yourself (steps 1–4 above) remains valid v0 practice —
nothing about the orchestrated path below deprecates it.

**The orchestrated path (v1, issue #190).** When the reviewer's verdict is
`escalate` rather than `request-changes` — the finding is a decomposition defect,
not something an implementer round can fix — resolve the escalation with
`--disposition re-plan` (`gateline resolve-escalation <slug> <index> --note "…" --disposition re-plan`,
or the web decide card's "Re-plan" option). The engine dispatches the **architect**
in amendment mode, carrying the review report path and your resolution note: the
architect amends `plan.md` with a dated ADR and, if the finding names a surface or
decomposition defect, may widen the affected task's `file_contact_surface` in
`tasks/*.yaml` itself — checking it against every other task's surface and
serializing any overlap via `depends_on`, exactly as step 1 above describes, just
performed by the architect rather than by you.

The widening does not take effect silently. Once the amendment lands, the engine
raises a *fresh* escalation naming the task, pauses, and waits for you to
acknowledge it — the architect proposes the widened boundary, you dispose. Resolve
that escalation the normal way, typically with `--disposition return-to-implement`:
the engine sends the task back to the implementer with the review report (its job
is the same as step 4's rebuttal note, now against the amended task file), then on
to the reviewer for a fresh round once the implementer responds.

## 4. Verify (Verifier)

Once tasks are approved:

> Use the **verifier** subagent for run `runs/wordfreq`, verifying the changes on
> this branch.

Read `verification-report.md`. Every acceptance criterion should have a verdict with
pasted command output. `failed` rows go back to step 3; `unverifiable` rows are a G2
judgment call for you.

The report ends with one overall `**Verdict:** pass | fail | escalate` line (the
word alone). `escalate` is the verifier's escalation channel: a failure that
traces to the spec or plan, not the code. Treat it exactly like a reviewer's
`escalate` — resolve it before deciding G2, and expect the v1 orchestrator to
pause on it (rule D24). `fail` does not pause; it is yours to weigh at G2, and
Gatehouse quotes the verdict and the non-verified rows on the card.

## 5. G2 — merge

You now hold: the diff, a review report with a coverage statement, and a verification
report with evidence. That's the gate packet. If it supports merging: record G2,
merge `run/wordfreq` to `main`.

## 6. Release (Ops → G3) — optional for the toy

A local CLI has no deploy, so either skip (record G3 as N/A) or dispatch **ops** to
see the contract in action — it should correctly report there's no CI/deploy surface
and produce a minimal plan.

## What to pay attention to (the actual point)

The toy task's output is throwaway; the observations aren't. After the run, note:

1. **Where did you intervene beyond gates?** Each intervention is either a role-spec
   defect (fix `roles/*.md`) or a contract gap (fix `contracts/*`).
2. **Were gate reviews confirmations or corrections?** Corrections at G2 that trace
   to ambiguity at G0/G1 mean the upstream contracts need tightening — that's the
   promotion criterion for v1 (DESIGN.md §7).
3. **Did any artifact get bounced as malformed?** Good — that's the contracts
   working. Silent guessing is the failure mode, not bouncing.

Log observations in `runs/wordfreq/retro.md` — these retros are the input to the
production pilot plan (Future Consideration #2).

## v1: the same pipeline, orchestrated by machinery

Everything above is v0 — you are the Orchestrator. In v1 the same run is driven
by the orchestrator engine ([ORCHESTRATOR.md](ORCHESTRATOR.md), implemented in
[`packages/orchestrator`](../packages/orchestrator/)): you
still write the intent brief and set up the run (§0), but steps 1–6's
dispatching, bouncing, round counting, and budget metering happen without you.
You act only where the design says a human must — gates, escalations,
pause/resume — through the gate frontend or the `gateline` CLI.

```bash
cd packages
node orchestrator/src/main.ts tick --dry-run   # shadow: derive, print, touch nothing
node orchestrator/src/main.ts watch            # live: reconcile until ^C
```

Two things to know before trusting it with more than a toy: autonomy is gated
on the §7 promotion criterion (measured by the frontend's burden metric), and
one hand-maintained duty moves into the contract either way — in v0, append a
`budget.ledger[]` entry to `state.yaml` from your harness's usage output after
each dispatch (the wordfreq run proved a running total silently stays zero;
the ledger is the shape v1 automates). The runbook, trigger packaging, and
crash-recovery story live in the
[orchestrator README](../packages/orchestrator/README.md).
