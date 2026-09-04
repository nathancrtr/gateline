# Review Report: <task id>

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them.
     ESCALATE SCOPE: escalate covers a plan/decomposition defect even when the
     diff under review is itself approvable — including one that only
     threatens a not-yet-dispatched task (its fix lives outside every
     remaining task's file_contact_surface). Verdict carries both signals at
     once: approve this diff, escalate the run. Say so plainly; a defect
     folded into a low-severity finding or a Coverage-section aside has no
     power to pause dispatch.
     READABILITY (normative — human-facing section: Coverage). The G2 approver
     reads it to trust the review; a breach is bounced like a malformed
     finding, with the rule cited. (a) Open with one plain-words sentence
     stating overall coverage — no code spans, paths, or parenthetical cites.
     (b) Then the Coverage table (shape below): one row per requirement or
     area checked. The table is the shape — a bullet list or a paragraph in
     its place is in breach. Cites live in the Where column, one location per
     row; the Mechanism column says what was checked in a clause, never a
     chain of clauses. (c) Name before cite: give any id or file a noun phrase
     on first use in the opening sentence. -->

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
     the findings. One plain-words sentence on overall coverage, then the
     table: one row per requirement or area, the same facts a prose chain
     would carry at a fraction of the parse cost (the verification report's
     Results table is the precedent). Status is ✓, ✗, partial, or n/a,
     naming the criterion where one applies. Human-facing: READABILITY rules
     govern the sentence; the table is the mandated shape. -->

<one sentence: what was covered, what was not, and how — static reading, execution, both>

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R2 | `walker.py:35-42` | `followlinks=False`; `lstat` + `S_ISREG` excludes file symlinks | ✓ AC2.2 |
| error paths | `cli.py:88-104` | every raise maps to a named exit code | ✓ |
| concurrency | — | not assessed: no concurrent access in scope | n/a |

## Boundary check
<!-- Did the diff stay inside the task's declared file_contact_surface? -->
