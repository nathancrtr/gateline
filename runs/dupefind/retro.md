# Retro: dupefind run (shadow-bar run 3 of 3)

Observations per WALKTHROUGH.md's closing questions. Context: third and final
run toward the M1 shadow bar; ledger maintained from the first dispatch so
every DB pre-flight ran against real accumulated spend. Orchestration
mechanics driven by the maintainer's session; the intent brief (by adoption)
and every gate decision were the founder's.

## 1. Interventions beyond gates

- None that patched agent output; every change went through a role dispatch.
- New pattern this run: a **G0 assumption veto** (empty-file override flag
  struck). Handled as: analyst amendment first, gate approval recorded
  against the amended spec. Cleaner than the mdtoc decline path when the
  human agrees with the artifact except for one assumption — no pause, no
  D9. The engine has no rule modeling "approve-with-veto"; in v1 this is a
  decline-with-notes or a pre-approval bounce. Candidate design question for
  ORCHESTRATOR.md: is assumption-level veto a distinct gate outcome, or is
  collapsing it into decline notes acceptable?

## 2. Gate reviews: confirmations or corrections?

- G0: confirmation with one assumption veto (recorded burden: confirmation —
  the veto chose between two readings the analyst had explicitly teed up).
- G1: confirmation (the architect's ADR-6 LBYL departure from house EAFP
  precedent was flagged by the architect itself, with correct reasoning —
  os.walk raises nothing on a bad root).
- G2: pending at retro time.
- The G0-veto'd flag traces to brief wording ("excluded by default" implies
  a non-default), which the analyst read literally. Contracts lesson
  (mirrors mdtoc's): brief phrasing that implies configurability gets
  formalized into scope; the "flag the alternative reading" behavior the
  analyst showed here is exactly right and worth encoding in
  contracts/spec.md as expected practice.

## 3. Malformed artifacts / bounces

- None. Three runs, zero D7 bounces — bounce handling remains fixture-only
  evidence. Not manufactured, per shadow-mdtoc.md's standing item.

## Review-round pattern worth a framework note

Both test tasks took exactly one request-changes round for surviving
mutants, same as mdtoc's unit-test task — three-for-three across runs 2–3.
The findings are consistently "fixture fails to discriminate the mutant"
(basename-vs-path sort keys, false-assurance probes the implementation's own
error handling swallows, unpinned halves of compound ACs). The
frontier-model reviewer catches these against workhorse-model suites every
time — P5 decorrelation earning its cost. Two candidate role-spec upgrades:
(a) roles/implementer.md, for test tasks: verify each required fixture kills
its named mutant by hand-patching before reporting (task 02 round 2 did
this; its verify round passed clean); (b) accept one review round on test
tasks as the expected steady state and budget for it.

## Bookkeeping quality (for the shadow replay)

- Full §4.4 discipline: intent commits before implementer launches; one
  commit per review verdict (no ride-alongs this run — the mdtoc blemish
  didn't recur); ledger entry per model invocation (16 entries incl.
  verifier, $12.15 of $50 at retro time).
- cost_usd remains estimated (combined-token harness reporting, 85/15
  split assumption) — carried unchanged from mdtoc; real in/out usage stays
  a v1 dispatch-seam item.
