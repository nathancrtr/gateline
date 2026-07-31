# Shadow replay: dupefind — disposition of disagreements

**What this is:** the M1 exit deliverable for run 3 of the N=3 shadow bar
(ORCHESTRATOR.md §10, resolved question 3). `gateline-orchestrator shadow
dupefind` replays the run's history commit by commit, deriving the engine's
action at each state and comparing it with what the human orchestrator
actually did next. Every disagreement below is dispositioned as an engine bug
or a design finding. `test/shadow-dupefind.test.ts` holds the replay to this
table. **This completes the bar: three full v0 runs replayed with every
disagreement dispositioned** (shadow-wordfreq.md, shadow-mdtoc.md, this).

**Result: 23 steps — 16 agree, 2 note, 4 disagree.** The four disagreements
fall into exactly two classes: one already dispositioned by the mdtoc replay
(parallel landing skew) and one new **contract gap this run discovered**,
closed in this change by a role-spec amendment.

## What this run exercised

- **A G0 assumption veto** (empty-file override flag struck by the founder):
  handled as analyst-amendment-then-approve, no pause. The replay absorbs it
  as a `note` at step 1 (engine rests at the gate; the amendment commit is
  "not a gate decision" — compatible). The engine has no rule modeling
  approve-with-veto; recorded in `runs/dupefind/retro.md` as a design
  question (distinct gate outcome vs. collapse into decline notes).
- **A hand-maintained ledger from the first dispatch**: 16 entries, $12.15
  of $50; every DB pre-flight in the replay ran against real accumulated
  spend — standing item 2 from shadow-wordfreq.md, now exercised twice.
- **Three review round-trips (D13/D14/D15 territory)**: both test tasks and
  the implementation task each took a request-changes round and a verify
  round.

## Disagreement class A (steps 9, 17, 18) — the implementer's response is invisible without a task-file note

At three states where an implementer's round-2 response had already landed
(the fix commit is *right there* in history), the engine derived `dispatch
implementer` again instead of the verify-round reviewer the human actually
dispatched next.

**Root cause — a contract gap, not an engine bug.** D15 decides "implementer
responded" by one signal: the task file's `notes:` touched after the review
landed (`derive.ts`: "The task file's notes record the implementer's
response"). But `roles/implementer.md` said *"fix it, **or** rebut it in
notes"* — an implementer who fixes every finding with nothing to rebut never
touches the task file, and the response is unobservable in the run
directory. mdtoc's round-2 implementer happened to append notes (its replay
step 16 agreed); dupefind's three round-2 responses did not, and all three
states misdirected.

**Disposition: design finding, fixed here.** `roles/implementer.md` now
mandates a response entry in `notes:` on every round 2+ (fixes and rebuttals
alike) and names it as the machine-visible response signal; adapters
re-rendered. Engine-side hardening (also treating a post-review commit to the
task's declared `file_contact_surface` as "responded") is filed as a
follow-up issue rather than changed here — the note requirement keeps the
signal inside the run directory, which is where the engine's observation
contract (P4/R1) wants it, and the note has audit value of its own.

## Disagreement class B (step 12) — parallel in-flight landings

Task 02's tests landed; the engine derived `dispatch reviewer(02)`; the
actual next commit was sibling task 03's landing. Identical to mdtoc's
disagreement 2: the replay's linearization interleaves parallel work between
derivation and dispatch; live, CAS converges. Already dispositioned
(shadow-mdtoc.md); expected in any run with parallel dispatches.

## Notes (2)

- Step 1: resting at G0 while the veto amendment lands (above).
- Step 14: the engine derived `implementer(02) + reviewer(03)` in parallel;
  the human serialized (review-03's verdict landed first). The matcher's
  partial-landing `note` class — v0 human serialized what the engine would
  parallelize.

## The bar, closed

| Run | Steps | Agree | Note | Disagree | Engine bugs found | Design findings |
|---|---|---|---|---|---|---|
| wordfreq | 19 | 8 | 1 | 9 | 0 | v0 deferred dispatch/round bookkeeping (2 classes, closed by M0/§4.4) |
| mdtoc | 22 | 18 | 1 | 2 | 2 matcher bugs (fixed) | D9 decline ripple; parallel landing skew |
| dupefind | 23 | 16 | 2 | 4 | 0 | response-visibility contract gap (fixed); skew recurrence |

Every disagreement across all three runs is dispositioned; each run's table
is pinned by a test. The trajectory is the point: the disagreements stopped
being "the engine can't see v0's bookkeeping" (wordfreq) and became specific,
fixable contract and matcher defects (mdtoc, dupefind) — the shadow bar
functioning as design review, exactly as ORCHESTRATOR.md §10 intended.
