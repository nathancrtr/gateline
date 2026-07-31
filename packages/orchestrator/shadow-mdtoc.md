# Shadow replay: mdtoc — disposition of disagreements

**What this is:** the M1 exit deliverable for run 2 of the N=3 shadow bar
(ORCHESTRATOR.md §10, resolved question 3). `gateline-orchestrator shadow
mdtoc` replays the run's history commit by commit, deriving the engine's
action at each state and comparing it with what the human orchestrator
actually did next. Every disagreement below is dispositioned as an engine bug
or a design finding. `test/shadow-mdtoc.test.ts` holds the replay to this
table.

**Result: 22 steps — 18 agree, 1 note, 2 disagree, 1 end.** Both remaining
disagreements are design findings; the run additionally **found and fixed two
engine bugs in the shadow matcher itself** (below). Compare wordfreq's
8-agree/9-disagree: this run was bookkept with M0/§4.4 discipline (dispatch
intent committed before launch, closing bookkeeping with each artifact, a
ledger entry per model invocation), and the engine tracked it nearly
step-for-step.

## What this run exercised that wordfreq could not

Both standing items from shadow-wordfreq.md, for real:

1. **Decline recovery (D9), from a genuine disagreement.** G1 was declined by
   the founder over anchor fidelity (live GitHub preserves underscores; spec
   R4 and plan ADR-4 had formalized it away). The replay shows the full
   designed shape: decline → D2 rest ("resume is a human decision", step 4,
   `note`) → resume → D9 re-dispatch of the producer with the decline notes →
   amended plan → G1 round-2 approval (light-correction).
2. **A hand-maintained ledger from the first dispatch.** 13 entries,
   $10.10 of $50; every DB pre-flight in the replay ran against real
   accumulated spend, and the registry's `dispatch_estimates_usd` were read
   as of each replayed commit.

## Disagreement 1 (step 5) — decline notes ripple upstream of D9's producer

After the resume, the engine derived `dispatch architect` (D9: re-dispatch
the declined gate's producer with the notes). The human's next commit was an
**analyst** dispatch — a spec amendment to R4 — and the architect's plan
amendment landed one commit later (step 6, where the engine re-derived D9 and
agreed).

**Disposition: design finding, not an engine bug.** The founder's decline
notes invalidated not only the plan's ADR-4 but the spec's R4 — the upstream
artifact the plan formalized. D9 models producer-only recovery; it has no
concept of a decline whose notes contradict an artifact *above* the declined
gate. The v0 human dispatched the analyst first so spec and plan could not
diverge on exactly the behavior the founder corrected. Candidate for
ORCHESTRATOR.md: on `resume` after decline, the orchestrator (or the human at
the gate) should be able to name additional artifacts the notes invalidate —
producer-only is the right default, not a ceiling. Recorded in
`runs/mdtoc/retro.md` §1.

## Disagreement 2 (step 13) — parallel in-flight landings arrive between derivation and dispatch

With tasks 02 and 03 both in flight, task 02's tests landed first; the engine
at that state derived `dispatch reviewer(02)`. The actual next commit was
task 03's landing — the sibling's in-flight work arriving — and one commit
later (step 14) the engine derived both reviewer dispatches and agreed.

**Disposition: design finding — convergent behavior, ordering artifact.**
Under live v1 the tick would have dispatched reviewer(02) while 03's landing
raced it; both writers converge through CAS (§4.4), and the end state is
identical — the replay's linearized history just interleaves them. The
matcher deliberately does not paper over this: an unrelated landing is not
the derived action, and saying so keeps the matcher honest. Expect this class
whenever a replayed run had parallel dispatches; it is the replay's
linearization, not the engine, that disagrees.

## Engine bugs found by this run (fixed in this change)

The first replay of this run showed 5 disagreements; 3 were the matcher
failing to recognize its own protocol, fixed in `shadow.ts` and pinned by the
test:

1. **Intent commits weren't credited (steps 8, 11).** A `state(<slug>):
   dispatched implementer(<task>)` commit — the engine's own §4.4
   commit-then-launch step, performed by hand per M0 — was scored `disagree`
   because `dispatchLanded()` looked only for artifacts. A disciplined v0 run
   was penalized for doing exactly what the engine would do. Fixed:
   a next-commit that flips the derived dispatch's task to `dispatched` is
   agreement (`dispatch intent committed next`).
2. **`review-rounds` records could never match (step 15).** The record
   matcher knew `phase` and `task-status` deltas only; a derived
   `review_rounds` sync fell through to `disagree` even when the next commit
   performed precisely that bookkeeping. Fixed: rounds deltas now match.

Neither fix disturbs wordfreq's dispositioned table (its 9 disagreements
involved bookkeeping the next commit did *not* perform, and it predates
intent commits); `shadow-wordfreq.test.ts` still passes unmodified.

## Matcher honesty notes

- The ledger's `cost_usd` values are estimates: this harness reports combined
  subagent tokens only (no in/out split), priced at the registry's rates with
  an assumed 85/15 split, raw totals in entry comments. DB pre-flight
  semantics are unaffected (it needs a sum, not provenance), but
  `tokens_in`/`tokens_out` are null throughout — v1's dispatch seam records
  real usage.
- review-03.md landed one commit early (rode along with review-02's commit —
  its reviewer finished while the orchestrator was committing). The replay
  absorbs this: step 15's derived rounds-sync matches the very next commit.
- G3 was recorded N/A (local CLI, no deploy surface, walkthrough §6), so D6's
  ops dispatch was never derivable. Ops-role coverage remains fixture-only —
  carried as a candidate item for run 3.

## Standing items for run 3 (dupefind)

1. **A bounce (D7).** Neither run has yet produced a malformed artifact;
   bounce handling still has only fixture coverage. Do not manufacture one —
   but if one occurs, its replay evidence is the last untrodden path.
2. **Real `tokens_in`/`tokens_out`** if the harness exposes a usage split;
   otherwise carry the estimate discipline unchanged.
3. **Consider exercising ops/G3** with a real (if minimal) release surface so
   D6's release-phase row gets non-fixture evidence.
