# Technical Plan: <title>

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml.
     GRAMMAR (normative — tooling parses this shape): decision headings
     `### ADR-<n>: <decision>`, or with an optional qualifier
     `### ADR-<n> (<qualifier>): <decision>` — e.g. an amendment note.
     A deviation is a malformed artifact.
     BUDGET: reference spec requirements by number, never re-quote them.
     Approach in a few short paragraphs; the ADRs carry the argument.
     READABILITY (normative — human-facing sections: Approach; each ADR's
     Rejected and Consequences lines). The G1 approver reads these as prose;
     a breach is bounced like a grammar deviation, with the rule cited.
     (a) The first sentence states the takeaway in plain words — no code
     spans, paths, or parenthetical cites. (b) One idea per paragraph: at
     most 4 sentences and 120 words each. (c) Three or more parallel items
     (components, cases, call sites) become a bulleted list under a lead-in
     sentence — never a semicolon chain. (d) One claim per sentence; never
     join clauses with a semicolon. (e) Name before cite: give any id or file
     a noun phrase on first use ("the ordering rule (R5)"), at most one
     parenthetical file:line cite per sentence, full path at first mention
     only — short name after. -->

## Approach
<!-- The shape of the solution and how it fits the existing codebase.
     Interface signatures and schemas allowed; function bodies are not.
     Never exceed 350 words. Human-facing: READABILITY rules govern the
     shape; the first sentence tells the G1 approver what the solution is. -->

## Interface contracts
<!-- Boundaries between components/tasks: signatures, schemas, protocols.
     These are what parallel Implementers build against. -->

## Decisions (ADRs)
<!-- Rejected/Consequences carry the human-readable why for the G1 approver —
     READABILITY rules apply, not agent shorthand. -->

### ADR-1: <decision>
- **Choice:** <what we're doing>
- **Rejected:** <the strongest alternative> — <why it lost>
- **Consequences:** <what this commits us to>

## Requirement → task mapping
<!-- Every spec requirement number maps to ≥1 task. Uncovered requirement = malformed plan. -->
| Requirement | Task(s) |
|-------------|---------|
| R1 | 01-… |

## Risks
<!-- What could invalidate this plan mid-flight, and the early signal for each. -->
