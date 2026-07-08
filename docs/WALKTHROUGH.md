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

- Verdict `request-changes` → bump `review_rounds` in the task file and re-dispatch
  the implementer **with the review report path in the prompt**. Cap: 3 rounds, then
  it's yours.
- Verdict `approve` → mark the task `in-review → verified`-eligible and move on.

## 4. Verify (Verifier)

Once tasks are approved:

> Use the **verifier** subagent for run `runs/wordfreq`, verifying the changes on
> this branch.

Read `verification-report.md`. Every acceptance criterion should have a verdict with
pasted command output. `failed` rows go back to step 3; `unverifiable` rows are a G2
judgment call for you.

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
`redacted` pilot plan (Future Consideration #2).
