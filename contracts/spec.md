# Specification: <title>

<!-- Contract: produced by Analyst; consumed by Architect, Reviewer, Verifier.
     Gate: G0. All sections required. Requirements are numbered (R1, R2, ...)
     and every requirement has ≥1 testable acceptance criterion.
     GRAMMAR (normative — tooling parses these shapes): requirement headings
     exactly `### R<n> — <short name>`; criteria as list items whose text
     begins `AC<n>.<m> — `. A deviation is a malformed artifact.
     BUDGET: reference the intent brief, never restate it. Target: reviewable
     by the G0 human in ten minutes.
     READABILITY (normative — human-facing sections: Context, Requirements,
     Assumptions). The G0 approver reads them as prose; a breach is bounced
     like a grammar deviation, with the rule cited. (a) The first sentence of
     the Context, of each requirement body and of each assumption entry
     states the takeaway in plain words — no code spans, paths, or
     parenthetical cites. (b) One idea per paragraph: at most 4 sentences and
     120 words each. (c) Three or more parallel items (gaps, cases, call
     sites) become a bulleted list under a lead-in sentence — never a
     semicolon chain. (d) One claim per sentence; never join clauses with a
     semicolon. An assumption's arrow form counts as one sentence. (e) Name
     before cite, criteria included: give any id or file a noun phrase on
     first use ("the ordering rule (R5)"), at most one parenthetical
     file:line cite per sentence, full path at first mention only — short
     name after. (f) A term coined in the brief or during the run is
     explained in plain words at first use. (g) A requirement's short name
     states its point as a claim ("A human's own edit is never silently
     discarded"), never a label ("CLI file input"). (h) A criterion opens
     with its promise: one sentence naming who acts (a user, the approver,
     the engine, a script) and what anyone can observe. The promise names no
     path, function or internal symbol. A code span in it is only what a
     user types or sees: a command, an input, an output. (i) The check
     follows, in the same item: the one command, observation or threshold
     the verifier will use. It observes the promise and never dictates how
     to build it. A promise observable as written, such as a command and its
     output, is its own check. (j) One condition per criterion, at most 30
     words with its check. Parts that could fail separately (joined by
     "and", an exception, or an inline list) become separate criteria: split
     to meet the cap, never compress. A set of three or more members is
     named by the rule that defines it or listed in the requirement body,
     and the criterion names the set. (k) A check that searches for a string
     says what the string stands for. When a match is ambiguous, the promise
     decides. (l) Never name a mechanism and then hedge it ("or
     equivalent"). State the promise and let the check name one way to
     observe it. (m) A criterion is one list item: continuation lines
     indented, no blank line, no nested list. Tooling ends a criterion at a
     blank line or a nested list item and drops what follows.
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
<!-- What must be true, not how to build it. A criterion in shape
     (READABILITY h–m), its promise and then its check:
       AC1.1 — The snapshot generator never opens a network port. Its
       script contains neither port-binding call the server makes
       (`serve(`, `.listen(`). -->
**Acceptance criteria:**
- [ ] AC1.1 — <promise: who does what, observably>. <check: a command to run, behavior to observe, or threshold to measure>

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
     one. A request to the G0 approver opens its entry, right after the
     marker ("**ASSUMPTION:** G0 to confirm: …"), never mid-entry. -->
- **ASSUMPTION:** <ambiguity> → resolved as <choice> because <reason>

## Out of scope
<!-- Explicit non-goals, including adjacent work an implementer might drift into. -->
