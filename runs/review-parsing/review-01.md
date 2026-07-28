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

---

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit cc835f0 (branch run/review-parsing; cumulative 8f4a22c..cc835f0)

## Findings

None blocking. All three round-1 findings are genuinely resolved (verified below); one new plausible gap, non-blocking.

### F4 — minor (PLAUSIBLE) — affirmative-form "not yet" phrasings still classify as resolved: the widened lexicon blocks negations but not aspectual or degree constructions
- **Where:** `frontend/packages/core/src/view-model/review-report.ts:150-169` (`RESOLVED_WORD`/`NEGATED_RESOLVED`/`classifyResolution`)
- **Failure scenario:** a future resolution bullet whose status reads "partially resolved; edge case remains" (likewise "remains to be resolved", "yet to be resolved", "far from resolved") carries no negation cue, so the unnegated "resolved" token classifies `resolved` and a still-standing finding folds. I probed all four against the built classifier: each returns `resolved`. PLAUSIBLE only — zero hits across all 48 corpus artifacts, the negation family the task mandates is now handled, and round 1 accepted this lexicon architecture as the fix path. Non-blocking; a follow-on lexicon entry for these phrasings is cheap whenever this file is next touched.
- **Requirement:** task scope item 3 ("resolved ONLY on a confident … match")

### Resolution of round-1 findings

- **F1 (major, resolved)** — `review-report.ts:150-169`. Re-ran both round-1 failure scenarios against the built classifier, not the notes: "still isn't resolved." and "cannot be resolved without a spec change." both classify `open` now, as do "no longer resolved", a curly-apostrophe "wasn’t resolved", and the mandated negation trap (runner-agent review-04's F1 stays `open` through round 3, matching the artifact). Regression check: the resolved-true sets of the round-1 and round-2 parsers over all 48 artifacts differ by zero losses — the widened lexicon un-resolves nothing genuine. The two new pinning tests match my scenarios verbatim. Killed.
- **F2 (minor, resolved)** — `review-report.ts:368-375`. The captured parenthetical now reaches the classifier: wordfreq review-03's F1 and F2 resolutions (its lines 134 and 144) classify `resolved`, and my old-versus-new corpus diff shows exactly those two entries gained, nothing else changed. The parenthetical stays out of the verbatim text field as claimed. Killed.
- **F3 (minor, resolved)** — `review-report.ts:42-60`. The tri-state `status` landed with `resolved` kept as the derived fold decision, preserving the still-open bias (`unclassified` reads as not-resolved). Verified against real artifacts: dupefind F2-F4 classify `unclassified` (free-form "stands as written"), runner-agent review-04 F2 classifies `open` in round 2 then `resolved` in round 3 — both matching artifact ground truth. No other module reads the type (grepped the packages; the server passes the report through opaquely; typecheck clean). Killed.

## Delta coverage

I re-verified every round-1 finding against the real corpus with my own independent old-versus-new parser comparison, re-ran the full suite and typecheck myself, and audited the round-2 changes for newly introduced defects; outside the one plausible lexicon gap above, the delta is clean.

- Round-1 fixes ✓ — each failure scenario re-executed directly (see resolutions), none taken on faith from the implementer's notes.
- Corpus sweep ✓ — all 48 review artifacts (the corpus grew by this run's own round-1 report): 0 throws, 0 nulls, 0 verbatim mismatches; classification flips versus round 1 are exactly the two intended wordfreq gains.
- Widened-negation audit ✓ — the contraction pattern covers straight and curly apostrophes; "unresolved" still never matches the affirmative; the classifier checks `resolved` first, so an open-token mention inside a genuinely-resolved line cannot demote it.
- Paren-fold audit ✓ — the classification input orders dash-tail status before the parenthetical, so a tail negation is never severed from its target; only the classifier sees the parenthetical, never the rendered text.
- Tri-state audit ✓ — `open` requires a negated "resolved" or an explicit unresolved/open marker; free-form abstains and empty statuses land in `unclassified`; finding-level `resolved` still derives from the last resolution only, false when there is none.
- Tests ✓ — 8 added (20 total in the parser's test file), each fixed finding pinned by a synthetic case plus a real-artifact case; `npm test` 590 passed / 2 pre-existing skips and `npm run typecheck` clean, run by me.
- Acceptance spot-recheck ✓ — dupefind review-01 still yields 4 findings, blocking F1 resolved in round 2, verdict order request-changes then approve.
- Not assessed: server route behavior beyond pass-through (unchanged this round) and Playwright e2e (no web change).

## Boundary check (round 2)

In bounds. Commit cc835f0 touches two declared surface files (the parser and its test) plus the task YAML's own `notes:` bookkeeping — expected, per round-1's treatment. The lockfile is untouched in the diff; my own install reproduced and reverted the same churn.
