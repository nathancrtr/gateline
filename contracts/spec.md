# Specification: <title>

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion.
     GRAMMAR (normative — tooling parses these shapes): requirement headings
     exactly `### R<n> — <short name>`; criteria as list items whose text
     begins `AC<n>.<m> — `. A deviation is a malformed artifact.
     BUDGET: reference the intent brief, never restate it. Target: reviewable
     by the G0 human in ten minutes.
     READABILITY (normative — human-facing section: Context). The G0 approver
     reads it as prose; a breach is bounced like a grammar deviation, with the
     rule cited. (a) The first sentence states the takeaway in plain words —
     no code spans, paths, or parenthetical cites. (b) One idea per paragraph:
     at most 4 sentences and 120 words each. (c) Three or more parallel items
     (gaps, cases, call sites) become a bulleted list under a lead-in
     sentence — never a semicolon chain. (d) One claim per sentence; never
     join clauses with a semicolon. (e) Name before cite: give any id or file
     a noun phrase on first use ("the ordering rule (R5)"), at most one
     parenthetical file:line cite per sentence, full path at first mention
     only — short name after.
     AUDIENCE (normative — tooling parses the `AUDIENCE:` line): decide-time
     sections are what the G0 approver weighs at the gate; audit-time sections
     are evidence, read when trust is in question, and Gatehouse folds them to
     their heading until opened. Unlisted sections are decide-time.
     AUDIENCE: Out of scope=audit -->

## Context
<!-- The problem, grounded in the system as it exists. Note any mismatch
     between the intent brief and observed reality. Target ~150 words; never
     exceed 250 — the cap is on words, not sentences, and the READABILITY
     rules govern the shape (a sentence budget invites clause-chaining). -->

## Requirements

### R1 — <short name>
<!-- What must be true, not how to build it. -->
**Acceptance criteria:**
- [ ] AC1.1 — <a command to run, behavior to observe, or threshold to measure>

### R2 — <short name>
**Acceptance criteria:**
- [ ] AC2.1 — ...

## Assumptions
<!-- Each ambiguity in the brief, with the resolution you chose. The G0
     reviewer vetoes these here, cheaply. If none, say "none". An assumption
     that encodes an external system's behavior — a platform's rendering
     rules, a library's runtime default, an API's documented contract —
     names whether that behavior was verified against the live system or
     derived from documentation/reasoning; a plausible-looking derivation is
     exactly what a confirmation-grade review waves through. When the brief
     admits two readings, name both and tee the choice up for G0 instead of
     resolving it silently — G0 can veto a stated choice, never a hidden
     one. -->
- **ASSUMPTION:** <ambiguity> → resolved as <choice> because <reason>

## Out of scope
<!-- Explicit non-goals, including adjacent work an implementer might drift into. -->
