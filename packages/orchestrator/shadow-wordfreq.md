# Shadow replay: wordfreq — disposition of disagreements

**What this is:** the M1 exit deliverable for run 1 of the N=3 shadow bar
(ORCHESTRATOR.md §10, resolved question 3). `gateline-orchestrator shadow
wordfreq` replays the run's history commit by commit, deriving the engine's
action at each state and comparing it with what the human orchestrator
actually did next. Every disagreement below is dispositioned as an engine bug
or a design finding. `test/shadow-wordfreq.test.ts` holds the replay to this
table.

**Result: 19 steps — 8 agree, 9 disagree, 1 note.** Zero engine bugs; every
disagreement falls into two classes of the same v0 design gap, both closed by
the M2 commit-then-launch protocol.

## Where the engine agreed

At every state whose bookkeeping was current, the derived action matched the
human exactly:

- intent brief committed → dispatch analyst (the human dispatched the analyst)
- spec landed, G0 approved → dispatch architect
- plan approved → dispatch implementer for the first eligible task
- G2 packet complete → **rest**; the human decided next (the autonomy boundary
  holding exactly where P4 puts it — the engine never derived a decision)
- run done → rest, permanently

## Disagreement class 1 — v0 deferred *dispatch* bookkeeping (4 steps)

Steps where the engine derived `dispatch implementer(01-core-logic)` (or
`04-cli-tests`) while that task's work had already landed. Cause: the v0
human dispatched agents in the harness without committing any state change,
so `state.yaml` still said `pending` — files were the only store, and the
files were stale. The engine, reading only files, correctly re-derives the
dispatch; done live, that would be a duplicate.

**Disposition: design finding, not an engine bug.** This is precisely the
gap ORCHESTRATOR.md §4.4 predicts and closes: v1 commits the dispatch intent
(task → `dispatched`, ledger entry opened) *before* launching, so the state
the next tick reads always reflects in-flight work. The v0 walkthrough now
carries the same lesson in ledger form (M0).

## Disagreement class 2 — v0 deferred *round* bookkeeping (5 steps)

Steps where the engine derived `record review_rounds/status` sync (e.g.
`04-cli-tests rounds→1`) that the human batched into a later commit. The
review verdicts had landed as artifacts; `state.yaml`'s counters lagged them
by several commits. The engine insists on converging bookkeeping before
launching anything new (one transition per tick); the human got to the same
final numbers, later, in fewer commits.

**Disposition: design finding — convergent behavior, differently factored.**
The final states agree; only the commit granularity differs. Under v1 the
closing bookkeeping lands in the same commit as each dispatch's completion
(§4.4 step 3), so the class disappears.

## Matcher honesty notes

- The registry is read as of each replayed commit, like everything else the
  engine observes. wordfreq predates `dispatch_estimates_usd`, so its DB
  pre-flight ran on the default per-role estimate against the run's $5 limit;
  replaying under today's estimates would derive a budget escalation the human
  never made.
- The implementer-dispatch matcher treats any code commit as a landing for
  any derived implementer dispatch, which converted three class-1 states into
  soft `agree`s (steps 3, 4, 8). The class-1 disposition covers them; the
  matcher stays loose deliberately — it flags for human disposition, it does
  not adjudicate.
- One `note`: the post-merge scrub commit touched `runs/wordfreq/` after
  `phase: done`; the engine rested (D1), which is compatible with any human
  activity.

## Standing items for the next two shadow runs

The N=3 bar needs two more v0 runs. For those, watch specifically:

1. A run that exercises **decline recovery** (no gate was declined in
   wordfreq, so D9 has only fixture coverage).
2. A run with a **hand-maintained ledger** from the start (M0 landed the
   contract after wordfreq finished), which will exercise DB pre-flight
   against real spend instead of `cost_spent_usd: 0`.
