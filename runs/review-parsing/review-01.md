# Review Report: 01-review-parsing

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 073f1bb (branch run/review-parsing)

## Findings

### F1 — major — the resolved-classifier defaults open, not closed: any unnegated whole-word "resolved" counts, and the negation lexicon is only `not|never`, so natural-English negations classify as RESOLVED — the exact false-resolved direction the task calls a correctness bug
- **Where:** `frontend/packages/core/src/view-model/review-report.ts:130-136` (`RESOLVED_WORD`/`NEGATED_RESOLVED`/`classifyResolved`)
- **Failure scenario:** a future round-2 bullet `- **F1 — still isn't resolved.**` (or `- **F1 — cannot be resolved without a spec change.**`) → `\bnot\b` matches neither "isn't" nor "cannot" → `classifyResolved` returns true → a standing blocking finding folds out of the approver's default view. No committed artifact trips this today (I grepped the 47-file corpus for `isn't|wasn't|hasn't|cannot|can't|no longer|partially … resolved`: zero hits), but the task's required behavior is "resolved ONLY on a confident match; anything you cannot classify with confidence is unclassified, NOT resolved" — the implementation inverts that default for any status text containing an unnegated "resolved" token. Fix is cheap: widen the negation pattern (contractions, `cannot`, `no`, `no longer`) or tighten what counts as a confident affirmative, plus a test pinning one contraction case.
- **Requirement:** task scope item 3 (required behavior paragraph: confident match only, bias toward "still open")

### F2 — minor — the `(severity, resolved)` parenthetical shape in a real committed artifact yields an empty status, so two genuinely-resolved blocking findings render as still standing
- **Where:** `frontend/packages/core/src/view-model/review-report.ts:314-320` (`scanResolutions` passes only `rb[3]`/the tail to `classifyResolved`; the captured parenthetical `rb[2]` is discarded)
- **Failure scenario:** `runs/wordfreq/review-03.md:133,144` — `- **F1 (blocking, resolved)** — …` puts "resolved" inside the parenthetical; the bold span ends right after it, so status is `''` and the tail regex (dash-then-bold) does not match → F1 and F2 carry `resolved: false` despite the round-2 approve stating both resolved. This is the tolerated false-open direction (mild noise, verbatim text still carried and unfolded), but it is a systematic miss of a shape present in the fixture corpus, not an unclassifiable free-form line — the evidence is already captured in `rb[2]` and thrown away.
- **Requirement:** task scope item 3 (resolution vocabulary survey); acceptance test 5's spirit (corpus fidelity)

### F3 — minor — the type model has no `unclassified` state: `FindingResolution.resolved` is a boolean, conflating "reviewer confidently said still open" with "parser could not classify"
- **Where:** `frontend/packages/core/src/view-model/review-report.ts:36-48` (`FindingResolution`)
- **Failure scenario:** downstream consumers (#215 cards, #217 decide-time folding) cannot distinguish `NOT RESOLVED` (reviewer asserts open) from `stands as written`/`n/a, correctly left alone`/empty-status (parser abstained), so a UI wanting to badge "unclassified — read the verbatim text" has no signal. Behaviorally safe today (both render unfolded with verbatim text), so minor — but the task names `unclassified` as a distinct state.
- **Requirement:** task scope item 3 ("Anything you cannot classify with confidence is `unclassified`")

## Coverage

I ran every acceptance check myself, swept the full 47-artifact corpus through the parser independently of the committed tests, and audited every resolved-true classification by hand; outside the three findings above the diff is clean.

- Corpus sweep ✓ — all 47 review artifacts parse with 0 throws, 0 nulls, 0 verbatim mismatches (every heading, definition block, and resolution text is a byte-slice of its source file), 0 unknown verdicts, 0 unknown severities.
- Silent-drop audit ✓ — raw `F<n>` heading count per file equals parsed finding count in every file; no finding is skipped by the severity gate at review-report.ts:373.
- Resolved-true audit ✓ — all 75 resolved-true classifications across the corpus checked against their verbatim text; every one is a genuine resolution (including `resolved-by-disposition`, `RESOLVED as re-scoped`, and the two-bold-span shape in runs/creation-seam/review-05.md). The mandated negation trap holds on both the synthetic fixture and the real artifact (runs/runner-agent/review-04.md F1 stays open through round 3, matching the artifact's actual final state).
- Acceptance tests 1–4 ✓ — dupefind review-01 parses to 4 findings, F1 blocking-and-resolved-in-round-2, F2–F4 standing, verdict order request-changes → approve, blocking sorts first; all asserted against the real file, not a copy.
- Acceptance tests 6 and 8 ✓ — ran `npm test` (583 passed, 2 pre-existing skips, 0 failed — layering test included) and `npm run typecheck` (clean) myself; the parser module has zero import statements.
- Acceptance test 7 ✓ — the reviews route sits beside the lexicon route with the same find-run 404, cache-key, and served-as-data pattern (frontend/packages/server/src/app.ts:370-385); per-file `report: null` degradation preserved. Route behavior is untested, but server test files are outside the declared surface — noted, not a finding.
- Grammar-variance handling ✓ — round anchoring survives every heading shape in the corpus (both levels, dates, parentheticals, the title-suffix form, and the hyphenated `Round-1 …` subsections correctly excluded); the one field-less artifact (runs/creation-seam/review-06.md) degrades to two round-2 segments with no finding lost, exactly as the task notes claim.
- Fence handling, dash-depth severity/title split, multi-id bullets, and the stable severity sort ✓ — each verified against a corpus instance or the committed test.
- Not assessed: Playwright e2e (no web change in the diff) and live server behavior (route exercised by inspection only).

## Boundary check

In bounds. Commit 073f1bb touches exactly the four declared surface files plus the task YAML's own `notes:`/status bookkeeping (expected). The claimed `package-lock.json` churn revert is confirmed — the lockfile is untouched in the diff, and my own `npm install` reproduced (and reverted) the same churn.
