# Verification Report: <run or task id>

<!-- Contract: produced by Verifier; consumed by gate G2.
     Every in-scope acceptance criterion gets a row and evidence.
     Evidence = the command you ran and the output you observed.
     GRAMMAR (normative — tooling parses these shapes): evidence-block
     headings exactly `### E<k> — AC<n>.<m>`; the Criterion column carries the
     bare `AC<n>.<m>` id. A deviation is a malformed artifact.
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
