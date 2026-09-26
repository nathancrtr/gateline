# Review Report: 04-fixture-label

<!-- AUDIENCE: Coverage=audit; Boundary check=audit -->

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit eac2e95 (`git diff eac2e95^ eac2e95`)

**Escalation (plan defect, outside every remaining surface):** spec R3 says *every* page rendering a fixture-sourced run carries the label, but the plan's "Fixture label" section and ADR-5 enumerate three surfaces (run header, inbox row, portfolio row) and stop. The demo also ships a fourth: `packages/web/src/pages/metrics.tsx:230-232` prints one `source/slug` row per run across all sources (`core/src/view-model/metrics.ts:107-108`), and the snapshot both writes `/api/metrics.json` and shells `/metrics` (`server/src/snapshot.ts:142,148`), so `/demo/metrics` will list `fixture/g2-pending` and its siblings with no label. `metrics.tsx` is in no task's `file_contact_surface` (04's is the five files above; 05 is the render check and its config; 06 is the workflow), so no remaining task can close the gap. A human decides one of two cheap things: widen 04's surface by `pages/metrics.tsx` (one gated render on the run cell, one test), or amend R3 to name the three surfaces and record that the metrics table is out of scope. The diff itself is separately **request-changes** on F1; the implementer can take F1 in round 2 whichever way the escalation resolves.

## Findings

### F1 — major — The markup test cannot tell visible text from hover-only text, so it does not pin AC3.2 as its own comment claims
- **Where:** `packages/web/test/fixture-label.test.ts:22-26` (comment at lines 3-4 names AC3.2)
- **Failure scenario:** mutant: `fixture-label.tsx:21-25` becomes `<Imp tone="hatch" data-fixture-label className={className} title="fixture data" />` — no children, the text lives only in the tooltip. `renderToStaticMarkup` yields `<span data-fixture-label="true" title="fixture data" class="imp imp-hatch "></span>`, which contains both `data-fixture-label` and `fixture data`; the file passes 3/3 (verified in place, restored). That is precisely the hover-only rendering AC3.2 forbids, and task 05's e2e is the only thing left to catch it. One assertion kills it: `expect(html).toMatch(/>fixture data</)` or `expect(html.replace(/<[^>]+>/g, '')).toBe('fixture data')`.
- **Requirement:** R3 / AC3.2; task scope ("The text is visible in the markup, never hover-only")

### F2 — minor — `isFixtureSource` is pinned only against a source id that shares no characters with the constant, so substring and prefix matches survive
- **Where:** `packages/web/test/fixture-label.test.ts:15-17`
- **Failure scenario:** mutant: `fixture-label.tsx:14` becomes `source.includes(FIXTURE_SOURCE_ID)` (or `startsWith`, or a case-fold) → 3/3 still pass (verified in place, restored). A `--repo` source takes its id from the checkout's directory name (`core/src/view-model/config.ts:146`), so `gateline ui --repo ~/fixtures` labels every real run in that repository "fixture data" — R3's "no real run carries that label" broken silently. One negative case, `isFixtureSource('fixtures')` → `false`, kills all three.
- **Requirement:** R3 / AC3.1 (negative half); plan "Fixture label" (`source === FIXTURE_SOURCE_ID`)

## Coverage

I read the whole diff against requirement three and the plan's fixture-label contract and ADR-5, ran the web typecheck, the full web test suite and lint, rendered the label to a string to see its real markup, ran the implementer's two mutants plus three of my own against the new test file, and traced each of the three call sites to the source id the snapshot generator assigns; the shipped component and its three gates are correct, the findings are in the test product, and the one gap that matters is the metrics page the plan never assigned to anyone.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R3 / AC3.1 positive | `packages/web/src/pages/run.tsx:286` | `isFixtureSource(summary.source)` gates the label after the `<h1>` in the header's first flex row; the snapshot names the fixture source `FIXTURE_SOURCE_ID` (`server/src/snapshot.ts:172`), so the demo's fixture run pages render it | ✓ AC3.1 (browser proof is task 05) |
| R3 / AC3.1 negative | `packages/server/src/snapshot.ts:171,276` | the real run's source id is `repoId`, default `gateline`, never `fixture`; `isFixtureSource('gateline')` is false | ✓ AC3.1 |
| R3 / AC3.2 | `packages/web/src/components/fixture-label.tsx:18-26` | rendered markup is `<span data-fixture-label="true" title="…" class="imp imp-hatch ">fixture data</span>` — text is a child node; `title` is the only hover-only content | ✓ product (test — F1) |
| R3 "every page" | `packages/web/src/pages/metrics.tsx:230-232` | run rows listed by `source/slug` with no label; page is shelled and its data snapshotted; file is in no task's surface | ✗ — escalated |
| inbox gate | `packages/web/src/pages/inbox.tsx:73` | `isFixtureSource(item.source)` on `InboxItem.source`, sibling of the `source/slug` span inside the same flex-wrap row | ✓ |
| portfolio gate | `packages/web/src/pages/portfolio.tsx:181` | `isFixtureSource(run.source)` on `RunSummary.source`, `className="ml-2"` on the `source · profile` line | ✓ |
| plan signatures | `packages/web/src/components/fixture-label.tsx:13,17` | `isFixtureSource(source: string): boolean` and `FixtureLabel({ className? })`; `tone="hatch"`, `data-fixture-label`, the literal title string and text match the plan and task word for word | ✓ |
| `Imp` pass-through | `packages/web/src/components/chips.tsx:47-63` | `...rest` spreads `data-fixture-label` onto the span; `title` and `className` are explicit props; `tone="hatch"` is in the union | ✓ |
| label not visually suppressed | `packages/web/src/styles.css:203-222` | `.imp` is `inline-block`, 11px mono, `white-space: nowrap`; `.imp-hatch` adds left padding and a gradient stripe; nothing sets `visibility`, `font-size: 0`, or clips | ✓ (layout is task 05 / geometry) |
| web→server boundary | `packages/web/test/boundary.test.ts:29` | the only workspace import is a value import of `@gateline/server/contract`, the one open specifier; suite green | ✓ |
| layer-2 test idiom | `packages/web/test/fixture-label.test.ts:6-9` | `.ts` file, `renderToStaticMarkup`, imports the `.tsx` component, no provider needed; no jsdom or new dependency; matches the vitest `include` glob | ✓ |
| implementer's mutants | `packages/web/src/components/fixture-label.tsx:14,21-25` | (a) `return true` fails "is false for a real source id"; (b) attribute and text renamed fails "renders the data hook and visible text" — both re-run in place and restored | ✓ as claimed |
| reviewer's mutants | `packages/web/test/fixture-label.test.ts` | (c) text moved into `title`, no children — survives 3/3; (d) `includes` — survives 3/3; (e) `sr-only` class — survives, but class-based hiding is outside what static markup can assert | partial — F1, F2; (e) n/a |
| toolchain claims | `packages/` | `npx tsc -p web/tsconfig.json` clean; `npx vitest run web/test` 22 files / 261 tests pass; `npm run lint` 231 files, no diagnostics | ✓ |
| Playwright | — | not run this round: `ui --demo` derives its source id from the generated temp directory's name (`core/src/view-model/config.ts:146`), never `fixture`, so no existing e2e page renders the label and no assertion moves | n/a |
| task 05 hook | `packages/web/src/components/fixture-label.tsx:21` | `[data-fixture-label]` containing `fixture data` is present; 05's route `/demo/runs/fixture/g2-pending` matches the `fixture` source id the snapshot assigns | ✓ no threat to 05 beyond the escalation |

## Boundary check

Inside the surface. eac2e95 touches exactly the five declared files plus the task file's `notes:` block; nothing under `packages/server`, `packages/core`, `e2e/` or the root config moved. Every mutant was applied to `fixture-label.tsx` alone and restored with `git checkout --` (worktree diff empty after each); the one scratch test lived under `web/test/` for a single run and was deleted. Operational note for the orchestrator, not a finding: at 19:33 local time, while this review was running, `packages/server/src/snapshot.ts` became modified in the worktree (a four-line deletion of the `phase !== 'done'` exclusion in `DoneOnDefaultBranchSource`). HEAD did not move, the change is not in eac2e95, and nothing I ran touches that file; the edit was gone again by the time this report was written and an untracked `review-02.md` had appeared beside it, so task 02's reviewer is working in this same worktree concurrently and that was almost certainly one of their in-place mutants. I touched neither. The worktree is otherwise clean apart from this report and theirs.

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** `run/gatehouse-demo`, commit bd10b19 (`git diff bd10b19^ bd10b19`); cumulative task diff `git diff eac2e95^ bd10b19 -- packages/`

## Verify round
- **F1 — resolved** — `packages/web/test/fixture-label.test.ts:32-38` strips every tag and requires the remainder to equal `fixture data`, then pins `/>fixture data</`; re-applied the round-1 mutant (`title="fixture data"`, no children) in place → 1 failed / 4 passed (`expected '' to be 'fixture data'`), restored.
- **F2 — resolved** — `packages/web/test/fixture-label.test.ts:20-22` adds `isFixtureSource('fixtures')` → `false`; re-applied `includes` and `startsWith` in place → each 1 failed / 4 passed (`expected true to be false`), restored. The case-fold variant round 1 also named is not killed by this case (see F3); round 1 overclaimed that one negative case covered it.
- **Escalation — resolved** — the human widened the surface rather than narrowing R3 (`afe5809`, disposition `return-to-implement` in `ab8571a`); `packages/web/src/pages/metrics.tsx:234` now renders `<FixtureLabel className="ml-2" />` gated on `isFixtureSource(r.source)` in the budget-honesty run cell, the only per-run row on that page (`metrics.tsx:231-234`), matching scope item 5 word for word.

### F3 — minor — A case-insensitive match still passes the suite, so exact equality is pinned only up to case
- **Where:** `packages/web/test/fixture-label.test.ts:11-23`
- **Failure scenario:** mutant: `fixture-label.tsx:14` becomes `source.toLowerCase() === FIXTURE_SOURCE_ID` → 5/5 pass (verified in place, restored). Source ids come from directory basenames (`core/src/view-model/config.ts:146`), so `gateline ui --repo ~/Fixture` would label every real run in that checkout. Residual of round-1 F2, not something this delta introduced; the shipped code is `===` and the task's acceptance-test line is met as amended. One line kills it: `expect(isFixtureSource('Fixture')).toBe(false)`. Non-blocking.
- **Requirement:** R3 negative half; plan "Fixture label" (`source === FIXTURE_SOURCE_ID`)

## Coverage

I re-read only the round-2 hunks and the implementer's response note, re-ran the round-1 mutants plus two variants against the current test file with the component restored and byte-compared after each, reinstalled `packages/node_modules` (absent when this round started) and ran the three toolchain claims myself; the two test gaps are closed, the fourth surface is gated the same way as the other three, and the one residual is a minor test-discrimination gap on case.

| Requirement | Where | Mechanism checked | Status |
|-------------|-------|-------------------|--------|
| R3 "every page" (escalation) | `packages/web/src/pages/metrics.tsx:8,234` | import plus one gated render in `BudgetSection`'s run cell; `r.source` is `string` (`core/src/view-model/metrics.ts:34`); no other per-run row exists on the page | ✓ scope item 5 |
| R3 / AC3.2 test pin (F1) | `packages/web/test/fixture-label.test.ts:32-38` | tag-stripped text equals `fixture data`; `>fixture data<` present; title-only mutant fails | ✓ AC3.2 |
| R3 negative half (F2) | `packages/web/test/fixture-label.test.ts:20-22` | `'fixtures'` → false kills `includes` and `startsWith`; case-fold survives | partial — F3 |
| unchanged surfaces | `packages/web/src/components/fixture-label.tsx`, `run.tsx`, `inbox.tsx`, `portfolio.tsx` | not in bd10b19 (`git show --stat`); round-1 ✓ rows stand | ✓ |
| round-1 mutants (a)(b) | `packages/web/src/components/fixture-label.tsx:14,19-26` | not re-run; the test cases that killed them are unchanged in the delta | n/a |
| `sr-only` variant (e) | — | still survives; class-based hiding is outside static markup, as round 1 recorded | n/a |
| toolchain claims | `packages/` | `npx tsc -p web/tsconfig.json` exit 0, no output; `npx vitest run web/test` 22 files / 263 tests passed (261 + 2 new); `npm run lint` 231 files, no fixes | ✓ |
| Playwright | `packages/e2e/smoke.spec.ts:134-137`, `geometry.spec.ts:127` | `/metrics` is visited but no assertion reads the run cell, and `ui --demo`'s source id is never `fixture`; not run | n/a |
| task 05 hook | `packages/web/src/components/fixture-label.tsx:21` | `[data-fixture-label]` unchanged; metrics gate adds a fourth page carrying it | ✓ |

## Boundary check

Inside the surface. bd10b19 touches exactly `packages/web/src/pages/metrics.tsx`, `packages/web/test/fixture-label.test.ts`, and the `notes:` block of the task file (hunk starts at `notes: |` line 102, additions only). The cumulative range `eac2e95^..bd10b19` also lists `review-02.md`, `review-04.md`, and `state.yaml`, all from orchestrator and reviewer commits, none from the implementer. This round every mutant was applied to `fixture-label.tsx` alone, restored with `git checkout --`, and `cmp`-verified against a pre-mutant copy; `git status --short` was empty after the last restore. Operational note, not a finding: `packages/node_modules` did not exist when this round began (round 1 ran the suite here, so it was removed in between); a concurrent `npm ci` was running in a different worktree (`contracts-escalation-section`), not this one, so I ran `npm ci --no-audit --no-fund` here — gitignored, nothing tracked moved. No unexpected modified files from task 02's agents appeared during this round.
