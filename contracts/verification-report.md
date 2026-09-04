# Verification Report: <run or task id>

<!-- Contract: produced by Verifier; consumed by gate G2.
     Every in-scope acceptance criterion gets a row and evidence.
     Evidence = the command you ran and the output you observed.
     GRAMMAR (normative — tooling parses these shapes): evidence-block
     headings exactly `### E<k> — AC<n>.<m>`; the Criterion column carries the
     bare `AC<n>.<m>` id; one overall `**Verdict:** pass | fail | escalate`
     line. A deviation is a malformed artifact.
     VERDICT: exactly one of the three words, alone on its line — `fail —
     see Gaps` is a deviation, not a verdict. `pass` when every in-scope
     criterion is verified; `fail` when any criterion failed or could not be
     verified for a reason that lies in the implementation or the environment
     — the G2 approver weighs it on the card; `escalate` when a failure traces
     to the spec, the plan, or the gate process rather than the
     implementation — this is the verifier's escalation channel, and it
     pauses the run for a human the way a reviewer's `escalate` does. When
     causes are mixed, escalate wins: one spec-traced failure among
     implementation failures makes the verdict `escalate`, and a criterion
     that is unverifiable because the spec references something that does
     not exist is a spec defect, not an environment gap. A re-verification
     appended to this report adds its own verdict line; the last line is the
     verdict in force. Prose in Gaps has no such power: an escalation that
     lives only in a sentence never reaches the gate.
     BUDGET: paste FAILING output in full; for passing checks the command plus
     its concluding line/exit code suffices. Never paste entire suites or
     restate the spec — reference criteria by number.
     READABILITY (normative — human-facing sections: Beyond the happy path,
     Gaps). The G2 approver reads these as prose; a breach is bounced like a
     grammar deviation, with the rule cited. (a) The first sentence states the
     takeaway in plain words — no code spans, paths, or parenthetical cites.
     (b) One idea per paragraph: at most 4 sentences and 120 words each.
     (c) Three or more parallel items (probes, gaps, cases) become a bulleted
     list under a lead-in sentence — never a semicolon chain. (d) One claim
     per sentence; never join clauses with a semicolon. (e) Name before cite:
     give any id or file a noun phrase on first use, at most one parenthetical
     file:line cite per sentence, full path at first mention only — short
     name after. -->

**Verdict:** pass | fail | escalate
**Change verified:** <branch/commit>
**Environment:** <where this ran: local, CI, staging + versions that matter>

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified / failed / unverifiable | see E1 |

### E1 — AC1.1
```
$ <command>
<observed output>
```
<!-- One evidence block per criterion. Failed runs are results too — paste them. -->

## Beyond the happy path
<!-- What you probed that the criteria didn't ask for (malformed input, empty
     states, boundaries, restarts) and what happened. Human-facing: a one-
     sentence lead-in plus one bullet per probe is the proven shape;
     READABILITY rules govern. -->

## Gaps
<!-- Criteria you could not verify and why; tests you added; coverage still
     missing. Human-facing: one bullet per gap; READABILITY rules govern. -->
