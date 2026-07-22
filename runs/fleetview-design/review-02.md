# Review Report: 01-g1-evidence-audit

<!-- Dispatch named this report review-01.md on the premise that no review-NN.md
     existed yet; runs/fleetview-design/review-01.md was written by the parallel
     reviewer for task 02-ledger-foundations before this report landed, so this
     report takes the next number per runs/README.md sequential convention. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 1f307548b8dfb7fe2f5f16d324d1b59831c2d449 (run/fleetview-design)

## Findings

### F1 — blocking — AC4.3 recorded PASS though the check as specified fails
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:129-140,168` (notes AC4.3 + summary)
- **Failure scenario:** the check is "grep each mockup .html (case-insensitive) for lorem, ipsum, foo, bar — zero hits" (task scope:21-22; spec AC4.3 "anywhere in the mockup HTML"). That grep returns 19 hits in candidate-b (`railfoot`, `bbar` — I reproduced every cited file:line). The G1 human reads "all 14 acceptance tests pass" (notes:168), signs off R4 as mechanically clean; any literal re-run of the specified check then contradicts the recorded evidence. The whole-word reinterpretation is a waiver the gate owns, not the auditor — record FAIL with the (already-present) file:line list and false-positive analysis, and let the G1 human waive it.
- **Requirement:** AC4.3; task acceptance test "each failure with file:line"; task scope:28-29 ("findings route to the gate")

### F2 — major — AC2.4 PASS rests on a false evidence claim about REC citations
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:93-94`
- **Failure scenario:** notes assert "Every P1-P5, A1-A5, and REC1-REC6 entry carries a citation (URL and/or file:line)"; REC1–REC6 (`ux-research.md:140-164`) carry only `(from P_, A_)` traces — zero URLs or file:line. A G1 human spot-checking AC2.4 by its letter ("cites a source (URL or file:line)") finds six entries contradicting the recorded evidence. PASS is defensible via the contract's own REC template (`contracts/ux-research.md:33`), but the note must state that basis instead of claiming evidence that does not exist — the lesser P4 style question got a spot-check flag (notes:94-98); this interpretation call got none.
- **Requirement:** AC2.4

### F3 — minor — recorded AC4.3 whole-word pattern is a typo and vacuous as written
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:129`
- **Failure scenario:** `\blfoo\b` (stray `l`) matches nothing by construction, so the recorded command is not the one that produced the claimed "zero whole-word hits for foo"; anyone replaying the audit from the notes runs a different check than the one recorded.
- **Requirement:** task scope:27-28 (checklist recorded so the G1 human can spot-check rather than re-derive)

### F4 — minor — AC2.2 count is internally inconsistent
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:78-82`
- **Failure scenario:** notes say "found 6 distinct sources" then list 7; PASS unaffected (floor is 3), but an audit whose counts don't match its own list invites the G1 human to distrust the rest.
- **Requirement:** AC2.2

### F5 — minor — AC2.3 over-claims "every trait is covered at least twice"
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:91`
- **Failure scenario:** "no typographic identity" is tagged only on A3 (`ux-research.md:100`), as the same note paragraph's own tag list shows. PASS unaffected (spec requires the four traits covered, not covered twice), but the extra claim is false as recorded.
- **Requirement:** AC2.3

## Coverage

- **Boundary/diff shape:** diff touches only the task yaml (`git show --name-only`); changes are `status: pending → in-review`, `review_rounds: 1`, and the notes block — clean.
- **Re-derived, not taken on faith:** re-ran the AC4.1 grep (`http://|https://|<script src=|@import url\(`) — zero hits across all 18 mockups ✓; the AC4.3 substring grep — the 19 hits match the implementer's enumeration exactly, file:line for file:line, and a correct whole-word `\bfoo\b|\bbar\b` grep does return zero ✓; the AC4.4 grep (`TBD|TODO|XXX`) — zero hits ✓.
- **File inventory (AC1.2/AC3.1/AC4.1):** exactly 6 `.html` + 1 `design-candidate.md` per candidate, correct six screen ids, all six indexed by filename in each Mockups section ✓.
- **Line-number citations:** every claimed anchor checked is exact — ux-research.md section heads (3/18/74/138/166), all 7 cited URLs, the five trait tags (77/87/100/115/128), P4's inline URL at :58, REC5 at :157; all 18 candidate section heads (a: 3/12/33/83/104/126; b: 3/14/39/98/129/156; c: 3/12/40/94/119/149); AC4.4/AC4.5/AC4.6 line ranges verified by reading all three Look-and-feel/Ergonomics/Traceability sections ✓.
- **AC4.2 spot-check:** grepped mockups for zero-runs, no-diff/merged, no-history, no-decisions, malformed, burden picker — present in all three candidates ✓.
- **Spot-check note characterizations:** P4 (notes:94-98) is correctly a non-failure — AC2.4 requires a citation, not a "Source:" label, and the URL is present. The foo/bar note is **not** correctly a non-failure under the letter — that is F1.
- **Not assessed:** AC3.2 (gate-notes distinguishability — the G1 human's own check, correctly absent from this task); R5/R6 (out of this task's scope).

## Boundary check

Inside the declared `file_contact_surface` — the diff modifies only
`runs/fleetview-design/tasks/01-g1-evidence-audit.yaml`; no other artifact under
`runs/fleetview-design/` changed in the commit.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** 87c1d28decc0118097f0ab5d6f702bebc3e46cc9 (run/fleetview-design) — 82-line pure append (0 deletions) to the task file's notes

## Findings

### F1 (blocking, round 1) — RESOLVED
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:176-201,250-256`
- **Verified:** AC4.3 is now recorded **FAIL** as literally specified, routed to the
  G1 human as an explicit waiver decision rather than pre-waived. Re-ran
  `grep -rinE 'lorem|ipsum|foo|bar'` over all 18 mockup .html files myself:
  exactly **18 hits** (18 matching lines; `-o` match count also 18), all in
  candidate-b, file:line-for-file:line identical to the note's list; whole-word
  `\bfoo\b|\bbar\b|lorem|ipsum` returns zero. The revised summary (notes:250-256)
  states 13/14 pass with AC4.3 failing and lists exactly 13 passing ACs. The
  failing check carries file:line, satisfying the task's final acceptance test.
  *Correction to round 1 of this report (appended, per the append-only
  convention): round 1's own figure "19 hits" was off by one — the true count is
  18; round 1's statement that the hits matched the implementer's enumeration
  file:line-for-file:line was correct (that enumeration has 18 entries).*
- **Requirement:** AC4.3; task scope:28-29

### F2 (major, round 1) — RESOLVED
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:202-217`
- **Verified:** the note now states the actual basis for AC2.4 and explicitly
  supersedes the false blanket claim at notes:93-94. Independently re-derived:
  REC1–REC6 (`ux-research.md:140-164`) carry only `(from P_/A_)` traces — REC1
  "(from A1, A2)" at :140, REC6 "(from P2)" at :161 — and zero URLs or file:line
  (a URL grep of the file finds nothing between :111 and the backtick-quoted
  pattern literals at :168-169). `contracts/ux-research.md:33` defines the REC
  template as `(from P_, A_)` tracing to P/A numbers ("each tracing to P/A
  numbers", :31). P1–P5 and A1–A5 each carry a `Source:` file:line and/or URL
  (re-verified directly in `ux-research.md` Patterns :18-73 and Anti-patterns
  :74-136).
- **Requirement:** AC2.4

### F3 (minor, round 1) — RESOLVED
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:218-222`
- **Verified:** pattern recorded as `\bfoo\b|\bbar\b` (stray `l` gone); I ran that
  exact pattern against all 18 mockups — zero hits, so the recorded command now
  reproduces the recorded result.

### F4 (minor, round 1) — RESOLVED
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:223-231`
- **Verified:** re-ran `grep -noE 'https?://[^ )]*' ux-research.md` myself —
  exactly 7 citation URLs at lines 27, 42, 49, 58, 68, 97, 111 (the :168-169
  matches are grep-pattern literals in Open questions, not sources). The stated
  count (7) now matches the list; floor of 3 comfortably cleared.

### F5 (minor, round 1) — RESOLVED
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:232-242`
- **Verified:** re-derived the trait-tag census: "uniform treatment of every
  surface" at ux-research.md:77 (A1) and :115 (A4); "default component styling"
  at :87 (A2) and :128 (A5); "no spatial identity" at :115 (A4) and :128 (A5);
  "no typographic identity" at :100 (A3) **only** (:147 is REC2 prose, not an
  anti-pattern tag). The corrected statement (three traits twice, one trait once,
  all four covered at least once) is exact; spec AC2.3 requires the four traits
  covered, not covered twice — PASS stands.

### F6 — minor — NEW — `review_rounds` not incremented for the round-2 submission
- **Where:** `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml:54`
- **Failure scenario:** the field still reads `1` on a second-round submission
  (round 1 set it when entering in-review); anyone reconstructing the round count
  from the task file rather than the state commits under-counts by one, and with
  a 3-round cap that miscount could admit an extra round. PLAUSIBLE — no contract
  defines this field, and the orchestrator's state commits track rounds
  authoritatively. Non-blocking.
- **Requirement:** none (convention consistency only)

## Coverage

- **Diff shape:** commit 87c1d28 is a pure append (82 insertions, 0 deletions);
  every byte of the round-1 note text above the appended section is untouched,
  honoring the append-only convention ✓.
- **Every number re-derived, none taken on faith:** literal substring grep = 18
  hits (line count and `-o` match count agree), all file:lines exact ✓;
  whole-word grep = 0 ✓; URL count = 7 at the exact lines cited ✓; REC trace
  anchors :140/:161 exact ✓; contract REC template at
  `contracts/ux-research.md:33` exact ✓; trait-tag lines 77/87/100/115/128
  exact ✓.
- **Revised summary arithmetic:** 13 ACs listed as passing + AC4.3 FAIL = 14 ✓;
  FAIL entry carries file:line per the task's final acceptance test ✓.
- **Spec wording re-checked at source:** spec.md:73-75 (AC4.3 — case-insensitive,
  "anywhere in the mockup HTML": literal substring reading is correct, so FAIL is
  the right verdict absent a G1 waiver); spec.md:48-51 (AC2.3 coverage floor is
  once, not twice); spec.md:52-53 (AC2.4) and :46-47 (AC2.2) consistent with the
  corrected notes ✓.
- **Not re-assessed this round:** AC1.1, AC1.2, AC2.1, AC2.5, AC3.1, AC4.1,
  AC4.2, AC4.4, AC4.5, AC4.6 — their evidence is untouched by this diff and was
  verified clean in round 1.
- **Verdict rationale:** approve with a recorded FAIL is correct here — this
  task's product is accurate gate evidence, not a passing artifact set; the
  AC4.3 FAIL is now truthfully recorded and routed to the G1 human exactly as
  task scope:28-29 requires. F6 is minor and non-blocking.

## Boundary check

Inside the declared `file_contact_surface` — `git show 87c1d28 --name-only` lists
only `runs/fleetview-design/tasks/01-g1-evidence-audit.yaml`; no other artifact
under `runs/fleetview-design/` and no product file changed ✓.
