# Verification Report: <run or task id>

<!-- Contract: produced by Verifier; consumed by gate G2.
     Every in-scope acceptance criterion gets a row and evidence.
     Evidence = the command you ran and the output you observed.
     GRAMMAR (normative — tooling parses these shapes): evidence-block
     headings exactly `### E<k> — AC<n>.<m>`; the Criterion column carries the
     bare `AC<n>.<m>` id. A deviation is a malformed artifact.
     BUDGET: paste FAILING output in full; for passing checks the command plus
     its concluding line/exit code suffices. Never paste entire suites or
     restate the spec — reference criteria by number. -->

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
     states, boundaries, restarts) and what happened.
     Human-facing: the G2 approver reads this and Gaps as prose — give any id
     a noun phrase on first use, never a naked cite. -->

## Gaps
<!-- Criteria you could not verify and why; tests you added; coverage still missing. -->
