# Review Report: 02-unit-tests

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit 7181db2 (branch run/mdtoc), scope `apps/mdtoc/` — new file `test_core.py` (16 tests)

## Findings

The product under review is a test suite; findings are mutation-survival gaps
against spec-pinned behavior (R4's amended character class, R3's "matching
closing fence", the plan's binding interface contracts), each with a concrete
wrong implementation the suite cannot distinguish from the correct one.

### F1 — blocking — no test anywhere discriminates hyphen preservation in `slugify` (R4's kept class)
- **Where:** `apps/mdtoc/test_core.py:49-77` (slug section) — and no `render_toc` fixture contains a source hyphen either
- **Failure scenario:** mutant `slugify` with kept class `ch in " _"` (hyphen dropped): all 16 tests pass — AC4.3's only removed-char coverage is the em dash, and every expected hyphen in every fixture originates from a space. Heading `## Re-entry Vector` → mutant anchor `#reentry-vector` vs correct `#re-entry-vector`; the tool ships broken links for any hyphenated heading.
- **Requirement:** R4 (kept class explicitly includes hyphen); R9 (suite must verify anchor slugging)

### F2 — major — suite cannot distinguish the predicate filter from the `\w\s`-regex idiom ADR-4 explicitly rejected (tab leakage)
- **Where:** `apps/mdtoc/test_core.py:49-77`
- **Failure scenario:** mutant `re.sub(r"[^\w\s-]", "", text.lower()).replace(" ", "-")` passes all 16 tests (no fixture contains a tab); `slugify("a\tb")` → mutant `"a\tb"` (literal tab in anchor) vs correct `"ab"`. Plan ADR-4 rejection (b) names this exact defect as spec-relevant; the suite doesn't pin it.
- **Requirement:** R4 (only *space* is kept/mapped; tab is neither kept nor a hyphen source); plan ADR-4

### F3 — major — fence-close discrimination absent: mixed-char close, ≥`fence_len` close, and unclosed-to-EOF all untested
- **Where:** `apps/mdtoc/test_core.py:36-45` (both fixtures use a same-char, same-length, properly closed fence)
- **Failure scenario:** mutant close rule "any run of ≥3 backticks *or* tildes closes any fence" passes both fence tests; input `"```\n~~~\n## After\n"` → mutant emits `(2, "After")`, correct emits `[]` (a tilde line never closes a backtick fence). Likewise a mutant that discards unclosed-fence state at EOF passes the suite (`"```\n# hidden\n"` → mutant `[(1, "hidden")]`, correct `[]`).
- **Requirement:** R3 ("the **matching** closing fence"); plan ADR-3 + "Behavior not covered by any AC" (unclosed fence extends to EOF)

### F4 — minor — duplicate counting keyed on the wrong thing survives: AC5.1's fixture uses identical texts only
- **Where:** `apps/mdtoc/test_core.py:83-92`
- **Failure scenario:** mutant `render_toc` keying its occurrence dict on raw heading text instead of the base slug passes all tests; `[(1, "Foo Bar"), (1, "foo bar")]` → mutant emits `#foo-bar` twice (non-unique anchors) vs correct `#foo-bar` / `#foo-bar-1`. (The converse global-counter mutant is killed by the AC6.1 test — noted in Coverage.)
- **Requirement:** R5 (disambiguation is triggered by same *base anchor*, not same text)

### F5 — minor — plan-pinned `extract_headings` text semantics untested: bare marker and `.strip()`
- **Where:** `apps/mdtoc/test_core.py:14-31` (heading section)
- **Failure scenario:** mutant regex `^(#{1,6}) (.+)$` (space and text mandatory, no strip) passes all 16 tests; `extract_headings("##\n")` → mutant `[]` vs contract `[(2, "")]`, and `"# Title  \n"` → mutant text `"Title  "` vs contract `"Title"`.
- **Requirement:** plan Interface contracts (binding on task 02): "a bare marker line yields text ''", text is "`.strip()`ped"

## Coverage

Reviewed against `spec.md` (R2–R6, R8, R9; R4 as amended with AC4.5) and
`plan.md` (interface contracts, test-layout and test-name contracts, ADR-3/4/5)
directly; the commit message was context only. Static verification per dispatch
(git only, no pytest run): every assertion was traced by hand through
`mdtoc.py`'s regex, fence scanner, `slugify`, and `render_toc` — all 16
assertions are correct against the approved implementation and would pass.

- **Task bullet coverage** ✓ — every required bullet in the task scope has ≥1
  test: AC2.1–2.3, AC3.1–3.2, AC4.1–4.4, underscore preservation (both the
  task's `foo_bar baz` and AC4.5's `Use snake_case Names`), AC5.1, AC6.1–6.2,
  AC8.1–8.2. The findings above are gaps in discrimination power, not in the
  bullet list.
- **AC9.2 name contract** ✓ — distinct, individually named tests containing
  each required substring: `heading` ×3, `fence` ×2, `slug` ×5, `duplicate` ×1,
  `empty` ×3.
- **Mutants the suite does kill** ✓ (checked and clean): missing-lowercase and
  space-collapsing slug mutants (AC4.1/AC4.3); underscore-stripping (the G1
  regression the ADR-4 amendment exists for — both underscore assertions kill
  it); global-occurrence-counter duplicates (killed by the AC6.1 exact-bytes
  test's four distinct anchors); relative-renumbered or `level*2` indentation
  (AC6.2 + exact-bytes); fence-never-opens and fence-never-closes scanners
  (AC3.1); backtick-only fence support (AC3.2); `#1234` / 7-hash acceptance
  (AC2.2/AC2.3); trailing-newline drop and empty-input newline emission
  (exact-string equalities incl. `render_toc([]) == ""`).
- **Task constraints** ✓ — pure-function tests only, no subprocess/file I/O, no
  duplication of task 03's process-level surface; `import mdtoc` per the
  test-layout contract; no `__init__.py`; `mdtoc.py` untouched; imports are
  `mdtoc` only (stdlib+pytest constraint holds); no annotations at all, so
  3.9/ADR-8 safe. AC4.4's backtick fixture uses `chr(96)` as scope directs;
  the fence fixtures embed literal backticks in plain string literals, which
  is valid Python and within the scope's "or escaped quoting" latitude.
- **Not assessed:** AC9.1 execution (dispatch is git-only; the commit message's
  "16 passed on 3.9.6" is unverified context — my pass/fail tracing is static);
  process-level behavior (task 03's surface); bracket/brace pass-through in
  link text (plan-pinned literal-text behavior, no discriminating test — same
  class as F5, not separately filed).

## Boundary check

Declared `file_contact_surface`: `apps/mdtoc/test_core.py` — the only code
file touched (new file). The commit also edits `runs/mdtoc/state.yaml` (task
status → in-review, ledger entry 7, spent total); orchestrator bookkeeping
with the gates section untouched, consistent with the review-01 precedent. In
bounds. No untracked `test_cli.py` was present in the working tree at review
time.

---

## Round 2 (verify)

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 784b195 (range 38d4a7d..784b195) — `apps/mdtoc/test_core.py` additions only (+63 lines, 8 tests, 16 → 24), plus sanctioned notes in `runs/mdtoc/tasks/02-unit-tests.yaml` and ledger bookkeeping in `runs/mdtoc/state.yaml`

### Round-1 finding resolution

- **F1 resolved** — `test_core.py:118`: `slugify("Re-entry Vector") == "re-entry-vector"`. The kept-class-drops-hyphen mutant (`ch in " _"`) yields `reentry-vector` and fails. Mutant killed.
- **F2 resolved** — `test_core.py:126`: `slugify("a\tb") == "ab"`. The `\w\s`-regex mutant keeps the tab literally (`a\tb`); a tab-to-hyphen mutant yields `a-b` — both fail. Mutant killed.
- **F3 resolved for both named mutants; one residual (F6)** — `test_core.py:60` kills the any-dialect-closes mutant (`"```\n~~~\n## After\n"` → mutant `[(2, "After")]` vs asserted `[]`); `test_core.py:76` kills the unclosed-state-discarded-at-EOF mutant (`"```\n# hidden\n"` → mutant `[(1, "hidden")]` vs asserted `[]`); `test_core.py:68` additionally kills the shorter-run-closes and fence_len-ignoring close mutants (either would surface `Hidden`; the test asserts only `Shown`).
- **F4 resolved** — `test_core.py:148`: `[(1, "Foo Bar"), (1, "foo bar")]` → `#foo-bar` / `#foo-bar-1`. The raw-text-keyed mutant emits `#foo-bar` twice and fails. Mutant killed.
- **F5 resolved** — `test_core.py:33` (`"##\n"` → `[(2, "")]`) and `test_core.py:39` (`"# Title  \n"` → `[(1, "Title")]`). The mandatory-space/mandatory-text/no-strip regex mutant fails both. Mutant killed.

### New findings

#### F6 — minor (non-blocking) — longer-than-opening fence close still undiscriminated: an exact-length-match close mutant survives all 24 tests
- **Where:** `apps/mdtoc/test_core.py:68` — the fixture closes a length-4 fence with a run of exactly 4; no fixture closes any fence with a run *longer* than its opener
- **Failure scenario:** mutant close rule `run_len == fence_len` (instead of `>=`): all 24 tests pass; input `"```\n# hidden\n````\n## After\n"` → mutant `[]` (fence never closes, `After` swallowed) vs correct `[(2, "After")]`. The test's name claims `at_least_opening_length` but proves only the equal and shorter cases.
- **Requirement:** plan ADR-3 consequence (a 4-backtick line closes a 3-backtick fence); R3 has no AC pinning length semantics — plan-pinned only, same tier as round-1 F4/F5
- **Disposition:** residual sliver of F3's headline ("≥ fence_len close untested"), not of its named failure scenarios, which are both dead. One added assertion closes it. Not blocking approval — flagged for the G2 human; fold in if any future round touches this file.

### Coverage (round 2)

Static verification per dispatch (git only, no pytest run). All 8 added tests
traced by hand through the approved `mdtoc.py` (HEADING_RE, fence scanner,
`slugify`, `render_toc`): every assertion is correct against the
implementation and would pass. The fence-length fixture in particular:
`"````"` opens char backtick len 4; `"```"` (run 3 < 4) does not close;
the second `"````"` (4 >= 4) does → `[(2, "Shown")]` as asserted.

- **AC9.2 name contract** ✓ intact post-additions — distinct, individually
  named tests containing each required substring: `heading` ×7, `fence` ×5,
  `slug` ×8 (incl. the F4 test's `base_slug`), `duplicate` ×2, `empty` ×4.
- **No regressions** ✓ — the 16 round-1 tests are byte-identical (the diff is
  pure additions); task constraints hold: pure-function tests only, no
  subprocess/file I/O, `import mdtoc` only, no `__init__.py`, no annotations
  (3.9/ADR-8 safe), `mdtoc.py` untouched.
- **Implementer notes** — checked against the diff and accurate per finding;
  used as context only, resolution verified against spec/plan directly.
- **Not assessed:** AC9.1 execution (the commit message's "24 passed on
  3.9.6" is unverified context — my pass/fail tracing is static).

### Boundary check (round 2)

`apps/mdtoc/test_core.py` — in surface (additions only). `runs/mdtoc/tasks/
02-unit-tests.yaml` — per-finding notes, sanctioned by the round-2 dispatch.
`runs/mdtoc/state.yaml` — ledger entry 11 and spent total only; gates section
untouched, consistent with prior-round precedent. `mdtoc.py` and `test_cli.py`
untouched (commit stat confirms). In bounds.
