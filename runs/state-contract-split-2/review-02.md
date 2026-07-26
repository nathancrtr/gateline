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
