# Review Report: 04-docs-landed

<!-- Dispatch named review-01.md, but that file already holds the
     01-contracts-split report (written by the parallel reviewer); this report
     takes the next number to preserve the audit trail. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit e91bb9b on `run/state-contract-split-2`

## Findings

### F1 — major — §11 asserts state checks in `validate` that do not exist and are produced by no task in this run
- **Where:** `docs/INTEGRATION.md:497-498` ("`validate`'s state checks and the
  frontend read check already read the split schema")
- **Failure scenario:** an operator preparing the first tag reads §11, treats
  state-shape validation as already covered by the static tool, and drops it
  from release prep; `scripts/integrate.py` contains zero occurrences of the
  string `state` in its 482 lines, so a host's malformed state file passes
  `validate` while the doc promised a check. Unlike the frontend half of the
  sentence, this half stays false even after tasks 02/03 land, because
  `scripts/` is outside this run's allowed surface (AC6.1) and plan ADR-6
  names only two deferred debts — copy manifest and gate glyphs — neither a
  validate state check. Fix is one sentence: attribute the split-schema
  reading to the frontend read check only, leaving `validate`'s state checks
  where the old text had them, as future tooling.
- **Requirement:** R7; plan ADR-6.

### F2 — major — landed-voice claims about frontend behavior describe outcomes of tasks 02/03, which have zero commits, while this task declares no dependency on them
- **Where:** `docs/INTEGRATION.md:157-161` (state validates against the host's
  own contract), `docs/INTEGRATION.md:371-374` (core-only hosts parse cleanly
  in the §5 read check), `docs/INTEGRATION.md:463` (§9 mitigation marked
  landed)
- **Failure scenario:** PLAUSIBLE — G2/G3 defers or bounces tasks 02/03 (the
  spec's own first assumption contemplates striking R4) and merges the rest;
  the default branch then documents contract-resolved state validation while
  `validate.ts` is still presence-only and `parseRunState` still
  compiled-SDLC, so an adopter running the §5 check against a core-only host
  gets exactly the bounces §5 now says no longer happen. The prose is what the
  task scope dictates and is true at an atomic merge with 02/03 complete; the
  defect traces to the task graph (`tasks/04-docs-landed.yaml` declares
  `depends_on: []`), so the resolution is a merge-ordering guarantee or a
  dependency edge decided at G2 — not a prose rewrite. Recorded so the
  overclaim window is a named, accepted risk rather than a silent one.
- **Requirement:** R7 ("once it lands"); AC7.1.

### F3 — minor — §5 over-generalizes which hosts stop bouncing
- **Where:** `docs/INTEGRATION.md:373-374` ("a host with instance gate
  vocabulary parses cleanly instead of bouncing by design")
- **Failure scenario:** an SDLC-derived host renames a gate in its copied
  contract while keeping `branch`/`budget`/`tasks`; per ADR-2's stated
  consequence it still gets the compiled G0–G3 schema and bounces — the
  rename case is explicitly unfixed. The sentence needs the qualifier its own
  first half implies: cleanly-parsing hosts are those whose contract declares
  only the core shape.
- **Requirement:** plan ADR-2 (consequences).

## Coverage
The two edited docs were checked line by line against the task scope, the plan's decisions, and what actually exists on the branch, and everything outside the three findings is clean.

- AC7.1 grep ✓ — the acceptance grep returns four hits, all landed-voice,
  none pending or future-tense (docs/INTEGRATION.md:135, 371, 463, 496)
- AC7.2 ✓ — the DESIGN.md state row names the SDLC extension and the core
  file, keeps the one-line table format, and its field list matches the core
  document task 01 actually landed (docs/DESIGN.md:201)
- ADR-6 residual honesty ✓ — the cli/web gate-glyph limitation is stated
  unsoftened, including that it can throw (docs/INTEGRATION.md:374-377)
- Deferred release-prep item ✓ — the copy-manifest entry for the core
  contract is named in both places the task requires, the §3 tagging note and
  the §11 sequencing note
- §4 fork narrative ✓ — integration #2's fork history is retained intact;
  only the "sequenced as an active run" sentence flipped to landed
- Unrelated "active run" mentions ✓ — the escalation-visibility row in §9 and
  the commercial-boundary note near §11 are correctly left active
- R6 ✓ — no non-SDLC vocabulary, roles, or business examples enter either doc
- Tree cross-check ✓ — the core contract and rewritten SDLC template exist at
  the branch tip via task 01 (in-review); the frontend claims were checked
  against tasks 02/03 and are covered by F2

## Boundary check
The commit touches exactly `docs/INTEGRATION.md` and `docs/DESIGN.md` — inside the declared `file_contact_surface`, and the task's "diff touches only these two files" acceptance test passes.

---

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 81a388e on `run/state-contract-split-2`; cumulative
task diff verified as `a16cd26..HEAD` for the two docs. (The dispatch's
suggested cumulative base `5367aad` postdates the round-1 commit `e91bb9b`, so
that range shows round 2 only; `e91bb9b` is confirmed an ancestor of HEAD, and
only `e91bb9b` and `81a388e` touch the two docs since the task's true base
`a16cd26`.)

### Round-1 finding dispositions

- **F1 — resolved.** Re-verified against the code, not the implementer's
  notes: `scripts/integrate.py` is 482 lines with zero case-insensitive
  occurrences of `state`, so `validate` performs no state checks of any kind.
  The rewritten §11 sentence attributes split-schema reading to the frontend
  read check only and names a validate state-shape check as future tooling
  (docs/INTEGRATION.md:498-502) — exactly the fix F1 asked for. A residual
  introduced by the fix's "(§5)" cite is recorded as F4 below.
- **F2 — rebutted-and-accepted.** Evidence gathered independently: tasks
  02-state-contract-resolution and 03-generic-read-path are both
  `status: pending`, `git log a16cd26..HEAD -- frontend/ scripts/` is empty,
  `parseRunState` still takes only `text` with no contract parameter
  (frontend/packages/core/src/record/schema.ts:162), no `StateContract` type
  exists in core, and the validate.ts state branch is still presence-only
  (frontend/packages/core/src/record/validate.ts:118). So the overclaim
  window round 1 named is still open at HEAD. The rebuttal is accepted
  because it matches round 1's own classification: the prose is what the task
  scope dictates and is true at an atomic merge with 02/03; the fix is a
  dependency edge or merge-ordering guarantee at G2, outside the
  implementer's surface. Restated here as a standing condition: **G2 must not
  merge this task's docs without 02/03 landing with or before them.**
- **F3 — resolved.** The qualifier landed (docs/INTEGRATION.md:373-376):
  cleanly-parsing hosts are those whose contract declares only the generic
  core shape, and the new parenthetical matches plan ADR-2's stated
  consequence — a rename-a-gate SDLC host keeps the marker keys, gets the
  compiled G0–G3 schema, and still bounces.

### Findings

#### F4 — minor — the F1 fix's "(§5)" cite points at a sentence asserting the opposite
- **Where:** `docs/INTEGRATION.md:500-501` ("`validate` itself does not parse
  state-file contents at all (§5)") vs `docs/INTEGRATION.md:356-357` (§5
  Static bullet: "the host's run state parses against the host's *own*
  `contracts/state.yaml`" listed among `validate`'s checks)
- **Failure scenario:** an operator reads §5's Static checklist, takes the
  state-parse line as a shipped `validate` check (it is not — the tool has no
  state handling), and skips independent state validation; a reader following
  §11's "(§5)" pointer finds the contradicting claim rather than support. The
  §5 bullet is pre-existing base text outside the task's enumerated edits,
  but round 2 made the contradiction explicit and cited it. One-line fix
  inside the declared surface: qualify the §5 Static bullet (or drop the
  cite) so the doc gives one answer on whether `validate` parses state.
- **Requirement:** R7 (docs consistent with what actually landed); plan ADR-6.

#### F5 — minor — round-2 rewrap breaks the doc's 80-column convention in both edited paragraphs
- **Where:** `docs/INTEGRATION.md:502` (121-character prose line) and
  `docs/INTEGRATION.md:379` (39-character orphan line "…gate column. This
  one" mid-paragraph)
- **Failure scenario:** cosmetic only — no functional failure constructible;
  recorded because both paragraphs otherwise hold the file's ~80-column wrap
  (the long line at 465 is a table row and exempt) and the ragged lines will
  churn the next edit's diff.
- **Requirement:** task scope ("write in the docs' existing voice; keep edits
  minimal and local").

### Coverage
Every round-1 finding was re-verified against the code and branch state directly, and the round-2 delta was checked claim by claim against the plan and the tree; only the two minor findings above are unclean.

- F1 recheck ✓ — grep over the whole of `scripts/integrate.py` (0 matches in
  482 lines), then the rewritten §11 sentence against it
- F2 recheck ✓ — task statuses, branch commit log, and the core package's
  parse/validate code all confirm 02/03 are unlanded; disposition above
- F3 recheck ✓ — new §5 wording compared against plan ADR-2's consequences
  paragraph; substance matches
- AC7.1 ✓ — the exact acceptance grep returns four hits, all landed-voice
  (docs/INTEGRATION.md:135, 371, 465, 498); the §5 precondition sentence is
  gone and the run is pointed at as done
- AC7.2 ✓ — the DESIGN.md state row is untouched in round 2 and still names
  the SDLC extension plus the core file in one-line table format
  (docs/DESIGN.md:201)
- Round-2 factual accuracy ✓ except F4 — "hosts whose contract declares only
  the generic core shape" is a safe understatement of ADR-2 (any markerless
  template derives a generic descriptor), and "the frontend read check
  already reads the split schema" falls inside F2's accepted window
- R6 ✓ — the round-2 delta adds no non-SDLC vocabulary, roles, or examples
- Diff parentage ✓ — only the two task commits touch the two docs since base
  `a16cd26`; no other task's work rides in this diff

### Boundary check
The round-2 commit touches `docs/INTEGRATION.md` plus the task's own `tasks/04-docs-landed.yaml` (status/notes bookkeeping — the implementer's report channel, not product surface). The cumulative product diff `a16cd26..HEAD -- docs/` touches exactly the two declared files, so the "diff touches only docs/INTEGRATION.md and docs/DESIGN.md" acceptance test passes for the product diff.
