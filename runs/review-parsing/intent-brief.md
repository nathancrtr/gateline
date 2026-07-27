# Intent Brief: Typed parsing of review reports

## Profile

patch

## Problem

The review-report grammar is parsed in exactly one place today —
`frontend/packages/orchestrator/src/review-report.ts` — and only far enough to
drive the review loop: the task id and the ordered verdicts. Neither
`packages/core` nor Gatehouse has a typed notion of a finding, a severity, a
verdict, or a round.

The consequence is felt at G2. A human opening `review-01.md` gets
undifferentiated prose and has to reconstruct "what is still open" by eye,
across rounds appended to the same file. A finding that round 2 resolved reads
at exactly the same weight as one still standing.

This is issue #214.

## Motivation

Gate reading is the human's whole job in this pipeline, and it is the part that
does not scale. Every G2 approval currently pays a re-derivation cost that the
committed artifact already contains the answer to.

Typed parsing is also the enabling step for the rest of the reading-experience
set: issue #215 (finding cards and verdict chips) and issue #217 (decide-time
vs audit-time folding) both consume it. Nothing downstream can start until this
lands, so it is first.

If we do not do this, the planned multi-run dogfooding experiment runs with
gate-reading fatigue as an uncontrolled variable — every run costs more human
attention than the change itself warrants.

## Constraints

- **Verbatim derivation only.** Every field the parser exposes is a slice of the
  committed artifact. Nothing is summarized, rewritten, normalized, or
  re-ordered into new prose, and no text in the artifact becomes unreachable
  through the typed view. No LLM involvement anywhere in the parse.
- **Browser-safe leaf module.** Follow the `lexicon.ts` pattern in
  `frontend/packages/core/src/view-model/`: no Node imports, no filesystem, no
  network — a pure function from artifact text to a typed value.
- **Layering holds.** `core` is record → sources → view-model and derivation
  stays a pure function of committed state. `packages/core/test/layering.test.ts`
  enforces this; it must keep passing.
- **The orchestrator's parser is not touched.** Deduplicating the two parsers is
  a later refactor with its own risk profile. Two parsers coexisting is the
  accepted outcome of this change.
- **Tolerant of real artifacts, not just clean ones.** Finished runs under
  `runs/` are the fixtures. An artifact that does not match the grammar must
  degrade to "no typed view" and still render as today's prose — never throw,
  never blank the page.
- Node >= 24; `npm test` and `npm run typecheck` in `frontend/` must pass.

## Out of scope

- Any rendering change. Gatehouse consumes this parser in issue #215; this run
  ships the parser and its server exposure, and the UI keeps rendering exactly
  as it does today.
- Section-level `AUDIENCE` folding (issue #217) and the Coverage-table contract
  amendment (issue #218).
- Retro-editing any artifact under `runs/`. Finished runs are historical
  records; they are read-only fixtures here.
- Changing `contracts/review-report.md`. This run parses the grammar as it is
  already written; it does not amend it.
- Deduplicating this parser with the orchestrator's.
