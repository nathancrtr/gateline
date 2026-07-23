# Review Report: <task id>

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them.
     READABILITY (normative — human-facing section: Coverage). The G2 approver
     reads it to trust the review; a breach is bounced like a malformed
     finding, with the rule cited. (a) Open with one plain-words sentence
     stating overall coverage — no code spans, paths, or parenthetical cites.
     (b) Then one bullet per area checked; terse "R1-R3 ✓"-style entries are
     the proven shape. Never chain areas into a paragraph — any paragraph
     over 120 words is in breach. (c) Name before cite: give any id or file
     a noun phrase on first use, at most one parenthetical file:line cite
     per sentence. -->

**Verdict:** approve | request-changes | escalate
**Round:** <n of 3>
**Diff reviewed:** <branch/commit>

## Findings

### F1 — <severity: blocking | major | minor> — <one-line defect>
- **Where:** `path/to/file.py:123`
- **Failure scenario:** <concrete inputs/state → wrong output or crash.
  If you can't construct one, mark the finding PLAUSIBLE.>
- **Requirement:** <spec/plan reference this violates, if applicable>

## Coverage
<!-- What you checked and found clean — the G2 human relies on this, not just
     the findings. One bullet per area, e.g.: "requirement coverage R1-R3 ✓",
     "error paths in X ✓", "concurrency not assessed (no concurrent access
     in scope)". Human-facing: READABILITY rules govern the shape. -->

## Boundary check
<!-- Did the diff stay inside the task's declared file_contact_surface? -->
