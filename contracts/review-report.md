# Review Report: <task id>

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first, short-form
     minor findings (FINDING SHAPE below) after every full-form one.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them.
     ESCALATE SCOPE: escalate covers a plan/decomposition defect even when the
     diff under review is itself approvable — including one that only
     threatens a not-yet-dispatched task (its fix lives outside every
     remaining task's file_contact_surface). Verdict carries both signals at
     once: approve this diff, escalate the run. Say so in the Escalation
     section below; a defect folded into a low-severity finding or a
     Coverage-section aside has no power to pause dispatch.
     ESCALATION (normative — tooling parses the `REQUIRED WHEN:` line and the
     section's bold fields): the `## Escalation` section is required exactly
     when the verdict in force is `escalate`, and is what the human resolving
     the escalation reads on the card. A report whose verdict is `escalate`
     and carries no Escalation section is malformed. Under any other verdict
     the section is not required; one left behind by an earlier round is
     history, not a deviation, since rounds append and never overwrite.
     `**Diff verdict:**` inside it is the diff's own verdict — the second
     signal ESCALATE SCOPE describes — and is one of `approve` or
     `request-changes`; the run-level verdict line stays `escalate`.
     Options are a bulleted list, one route per item: what the escalating
     role would do, never what it has decided — the human picks.
     REQUIRED WHEN: Escalation=escalate
     SUMMARY (normative — every round): the `**Summary:**` line under Diff
     reviewed is the bottom line, decide-time. Two or three plain sentences,
     60 words or fewer: whether the change does what it should, what kind of
     findings these are (defects in shipped behaviour, gaps in what the tests
     would catch), and what the approver accepts by approving. Each round
     writes its own, as of that round.
     FINDING SHAPE (normative): the full form carries Where, Failure
     scenario, Requirement, and optionally Fix — what the implementer should
     do, omitted when the scenario makes it obvious; the approver may skip
     it. A fix recipe goes there, never in the failure scenario. A minor
     finding that violates no requirement takes the short form: its
     `### F<n> — minor — <title>` heading, Where, and a one-sentence failure
     scenario of 30 words or fewer — no Requirement bullet, Fix only if
     needed. Blocking, major, and minor-with-a-requirement keep the full form.
     READABILITY (normative — human-facing: the Summary line, Findings,
     verify round, Coverage; a breach is bounced like a malformed finding,
     with the rule cited). The Summary line takes no code spans, paths, or
     parenthetical cites. Name before cite applies throughout: give any id
     or file a noun phrase on first use. A testing term or a label coined this run — mutant,
     kill, survive, pin — is explained in plain words at first use, naming
     the actor and what changes rather than the term alone.
     (a) A finding's title (the `<one-line defect>` below) is one line, 20
     words or fewer. (b) Its failure scenario opens with one plain sentence —
     the consequence, and for whom — before the inputs, counts, or trace that
     prove it. (c) A finding about test strength opens with the present
     state in plain words (what the code does today, what a missing test
     would let through) before the demonstration that shows it. (d) A
     verify-round disposition line (grammar below) is 60 words or fewer; one
     that needs more is a sign the fix introduced something that belongs in
     its own finding, not a longer disposition line.
     (e) Coverage opens with one plain-words sentence stating overall
     coverage — no code spans, paths, or parenthetical cites — 40 words or
     fewer. It states coverage only; the bottom line is the Summary's.
     (f) Then the Coverage table (shape below): one row per
     requirement or area checked. The table is the shape — a bullet list or
     a paragraph in its place is in breach. Cites live in the Where column,
     one location per row; the Mechanism column holds a clause, never a
     chain of clauses, 25 words or fewer — a cell that needs more becomes
     two rows.
     AUDIENCE (normative — tooling parses the `AUDIENCE:` line): decide-time
     sections are what the G2 approver weighs at the gate; audit-time sections
     are evidence, read when trust is in question, and Gatehouse folds them to
     their heading until opened. Unlisted sections are decide-time.
     AUDIENCE: Coverage=audit; Boundary check=audit
     VERIFY ROUND (normative — round ≥ 2): a verify round does not
     re-derive the full review. Scope is the implementer's response note, the
     diff's changed hunks since the round you're checking, and the disposition
     of each prior finding. Disposition each prior finding in one compact line
     instead of restating it — grammar `- **F<n> — resolved|stands** —
     <one-line reason, 60 words or fewer>`; "stands" is the only word for a
     finding that is not resolved; tooling reads exactly these two
     disposition words and no others. A defect the delta introduces — in the
     changed hunks, or in a fix itself — is a full new finding (`### F<n> —
     <severity> — <title>`, the same fields as any other), never a third
     disposition word or an overlong disposition line: a fix earns the same
     scrutiny as new code, never less. Coverage and Boundary check
     follow the same economy: restate only what changed since the round
     you're checking — new rows for newly-checked areas, a new line for new
     housekeeping — and let earlier rounds' rows and lines stand unrepeated.
     See the example below Findings. -->

**Verdict:** approve | request-changes | escalate
**Round:** <n of 3>
**Diff reviewed:** <branch/commit>
**Summary:** <two or three plain sentences, 60 words or fewer: does the change do what it should, what kind of findings are these, what does approving accept>

## Escalation
<!-- Present exactly when Verdict is escalate; omit it otherwise (see
     ESCALATION above). This is the decision the human is being asked to
     make — the card shows it verbatim, so write it for that reader. The
     three bold fields are grammar; the paragraph and the options are prose
     and READABILITY rules govern them: open with one plain-words sentence
     stating what is defective, then name where the fix would have to land
     and why no remaining task owns it, then the routes as you see them. -->

**Diff verdict:** approve | request-changes
**Traces to:** <the spec or plan clause the defect lives in — R<n> / AC<n>.<m> / ADR-<n>>
**Outside every remaining surface:** <the file or area the fix needs, and which task's file_contact_surface would have to name it — or "no" if a remaining task owns it>

<one plain-words paragraph: what is defective, and what happens if the run proceeds past it>

The options as I see them:
- <route one — e.g. widen task NN's surface by the file above>
- <route two — e.g. amend R<n> to name the surfaces in scope and record the rest out of scope>

## Findings

### F1 — <severity: blocking | major | minor> — <one-line defect, 20 words or fewer>
- **Where:** `path/to/file.py:123`
- **Failure scenario:** <one plain sentence: the consequence, and for whom —
  then concrete inputs/state → wrong output or crash. No fix recipe. If you
  can't construct one, mark the finding PLAUSIBLE.>
- **Requirement:** <spec/plan reference this violates, if applicable>
- **Fix:** <optional, for the implementer: what to change>

<!-- Round ≥ 2 appends below round 1, never overwriting it — see VERIFY ROUND
     above. Shape (fenced here so it reads as an example, not live headings;
     F4 shows the short form, last): -->
```
# Round 2

**Verdict:** approve | request-changes | escalate
**Round:** 2 of 3
**Diff reviewed:** <delta since the round-1 diff>
**Summary:** <as above, as of this round: e.g. "The fix closes the crash
  on empty input. One new defect remains in the retry path, and approving
  ships it.">

## Verify round
- **F1 — resolved** — <60 words or fewer: what changed, why the
  deliberately-broken version of the code now fails>
- **F2 — stands** — <60 words or fewer: why the fix doesn't close it>

### F3 — major — <a defect the delta itself introduced>
- **Where:** `path/to/file.py:200`
- **Failure scenario:** <as above>
- **Requirement:** <as above>

### F4 — minor — <a defect that violates no requirement>
- **Where:** `path/to/file.py:40`
- **Failure scenario:** <one sentence, 30 words or fewer>
```

## Coverage
<!-- What you checked and found clean — the G2 human relies on this, not just
     the findings. One plain-words sentence on overall coverage, then the
     table: one row per requirement or area, the same facts a prose chain
     would carry at a fraction of the parse cost (the verification report's
     Results table is the precedent). Status is ✓, ✗, partial, or n/a,
     naming the criterion where one applies. Human-facing: READABILITY rules
     govern the sentence and the table (word caps above). Round ≥ 2: restate
     only what changed since the round you're checking (VERIFY ROUND above);
     earlier rounds' rows stand unrepeated. -->

<one sentence, coverage only: what was covered, what was not, and how — static reading, execution, both>

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R2 | `walker.py:35-42` | `followlinks=False`; `lstat` + `S_ISREG` excludes file symlinks | ✓ AC2.2 |
| error paths | `cli.py:88-104` | every raise maps to a named exit code | ✓ |
| concurrency | — | not assessed: no concurrent access in scope | n/a |

## Boundary check
<!-- Did the diff stay inside the task's declared file_contact_surface?
     Housekeeping — reverted edits, reinstalled dependencies — gets one
     short line here, if any. Anything a human must act on (another process
     touched the worktree, a hazard to the run) is a finding or an
     escalation instead, never left here as an aside. Round ≥ 2: restate
     only what changed since the round you're checking (VERIFY ROUND
     above). -->
