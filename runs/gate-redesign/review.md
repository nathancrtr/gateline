# Gate Frontend Redesign — Blind Comparative Review

**Standard**: the design brief at `brief.md`. I judged the actual CSS/markup, not the rationale prose, and spot-checked each candidate's claims against its code. WCAG contrast ratios below are my own sRGB-luminance calculations (approximate but directionally reliable).

---

## 1. Per-candidate analysis

### Candidate A

**Scores**
| Dimension | Score | Note |
|---|---|---|
| 1. Aesthetic maturity | 5 | Fraunces (italic display) + Newsreader (reading serif) + Inter + JetBrains Mono — four genuinely distinct roles; terracotta `#a04423` on warm paper `#faf7f1`; gate sigil + blueprint grid on one surface. Reads as a product with a team. |
| 2. Reading-first | 5 | `run-detail.html:168` Newsreader 16.5px / 1.68, `max-width:76ch` (`:162`), 40–56px padding (`:158`). Full typographic range exercised. Metadata rail docked right (`:243`) so it never competes with prose. |
| 3. Anti-pattern floor (A1–A5) | 5 | A1: three distinct wrappers (flat task board `:120`, accent-rail+tint+shadow NeedsYou `:95`, borderless reading page `:156`). A2: radius ladder 4/6/8/12/16 (`:31`). A3: four roles. A4: scan/comfortable/reading/evidence rhythms. A5: every chip carries glyph + shape + fill (`:146–166`). |
| 4. Preservation | 4 | All 12 hold. Gate sets correct per profile (`portfolio.html:402` patch shows only G1/G2). **MAJOR**: `--faint:#a89f95` (`inbox.html:26`) on `#faf7f1` measures ~2.45:1 — fails WCAG AA on small text (`.packet` 11.5px `:198`, `.foot` 12.5px `:245`). `--muted:#7a726a` is ~4.45:1, borderline. |
| 5. Genesis chip | 5 | `new-run.html:169–173` commit message in Fraunces italic 21px as the hero, `[client-key: …]` dropped to a mono subline (`:175`), filled-accent dot with 4px halo (`:166`). Editorial page-proof, not a `<pre>`. |
| 6. Cozy/comfortable | 5 | Warm paper ground, terracotta accent, generous breathing room, serif reading surface. Invites lingering. |
| 7. Consistency | 5 | Shared topbar (sigil + italic "Gate" wordmark + nav + user) on all four screens, shared palette/type/chip system. |

**Strengths.** The reading surface is the standout — a real borderless page on warmer paper (`--reading-bg:#fdfbf6`), serif body, italic-serif H1 against Inter H3, left-ruled blockquote with a mono cite, an `ASSUMPTION:` callout, a quiet-bordered table, task-list checkboxes. The NeedsYou card is the only elevated surface (stakes-varied, A1). The genesis chip is the most editorial of the three. Mock data is internally coherent (spec content matches the decision card's `src/core.py` + `src/errors.py`).

**Weaknesses.** The `--faint` contrast is a real AA miss on small text. `run-detail.html:78` names a class `.gate.pulse-ring` but defines no animation — the *behavior* is a static ring (correct per the "no pulsing" rule), but the name is a misleading smell that a future maintainer might "fix" by adding a pulse. `inbox.html:168` has a duplicate `align-items` declaration on `.kindcol` (last wins; cosmetic). The "$94 spent this week" hero stat on `portfolio.html:213` is invented beyond the brief's data fields — a reasonable editorial flourish, not a violation.

---

### Candidate B

**Scores**
| Dimension | Score | Note |
|---|---|---|
| 1. Aesthetic maturity | 4 | Newsreader (italic display + roman body) + Inter + Mono — three roles, editorial and clean. Gradient arch brand mark. Warm off-white `#faf8f5`. Slightly less typographic range than A. |
| 2. Reading-first | 5 | `run-detail.html:341–348` Newsreader roman 16px / 1.7, `max-width:76ch`, 40px pane padding. Italic H1 with a gradient rule (`:359–366`), H2/H3 back to Inter for structure. Full range. |
| 3. Anti-pattern floor (A1–A5) | 3 | A1 ✓, A2 ✓ (6/12/16 + capsule), A3 ✓, A4 ✓. **A5 PARTIAL FAIL**: phase chips are color-only. `.chip` (`portfolio.html:210`) and `.chip-implement` (`run-detail.html:149`) carry no glyph/shape — only hue varies across phases. The brief's PhaseChip spec explicitly requires "phase name + a non-color signal… `paused` differs from `done` in shape/fill, not just hue." B has nothing. |
| 4. Preservation | 3 | **MAJOR**: pending gates in the inbox are rendered with the *ok-green* `chip-gate` (`inbox.html:228`) and no `·` pending glyph — `inbox.html:410` (G0 pending) and `:443` (G2 pending) show green "G2" chips, which read as *approved*. Status encoded as the wrong color + no form signal → violates #4. **MAJOR**: run-detail metadata rail (`run-detail.html:488–501`) omits divergence entirely; the header spec lists "divergence (ahead/behind origin)." Genesis line (`:500`) drops "staged by Nathan Carter" and "from." `--gate-subtle:#7a838d` (`inbox.html:15`) on `#faf8f5` ~3.52:1 — fails AA for small text (eyebrow, file-meta). |
| 5. Genesis chip | 5 | `new-run.html:354–359` Newsreader italic 22px (`t-editorial`) commit message, client-key as mono subline (`:360–365`), halo dot (`:346–347`). Comparable editorial hero to A. |
| 6. Cozy/comfortable | 4 | Warm, generous, editorial. Slightly more functional in temperature than A. |
| 7. Consistency | 5 | Shared topbar/palette/type/chips across all four. |

**Strengths.** The reading surface and genesis chip are genuinely strong and roughly on par with A. The state-switcher pattern (populated/empty/loading/validation/success via `data-*` body attributes) is the cleanest multi-state plumbing of the three. The blueprint dot-grid on the preview (`new-run.html:162`) is restrained. The inbox age badge pairs an SVG clock glyph + weight + warn hue (good A5).

**Weaknesses.** The phase-chip A5 miss is the most consequential: the brief calls it out by name and B skipped it. The pending-gate-as-green-chip in the inbox is a status-encoding bug — a sighted user sees "approved" where the aria-label says "pending." `new-run.html:800` has a real HTML defect: `<span class="field-label">Recorded as</label>` — a `<span>` closed by `</label>`. Browsers auto-recover, but it is invalid markup. `new-run.html:672` includes `runs/csv-importer/tasks/01-csv-importer.yaml [new]` even though the selected profile is `standard` — the brief says the tasks stub appears only for `patch`. The portfolio "+ New run" button (`portfolio.html:349`) is a `<button>` with a no-op `onclick` instead of a link to `new-run.html`. The rationale file mis-titles itself "Candidate A" (`rationale.md:1`).

---

### Candidate C

**Scores**
| Dimension | Score | Note |
|---|---|---|
| 1. Aesthetic maturity | 3 | Four families (Playfair + Inter + Source Serif 4 + Mono), but the accent is GitHub-blue `#2563eb` and the status palette is literally Primer's (`#dafbe1`/`#ffebe9`/`#fff1c0`). Reads more "functional GitHub admin" than "warm editorial." The diamond motif is barely visible (only empty states + faint preview grid). |
| 2. Reading-first | 4 | `run-detail.html:466–473` Source Serif 4 16px / 1.65, `max-width:76ch`, 40–48px padding. Solid. But the artifact H1 is Inter 700 (`:474`), not the serif — less editorial than A's italic-serif H1. |
| 3. Anti-pattern floor (A1–A5) | 4 | A1 ✓, A2 ✓ (6/12/16), A3 ✓ (4 roles), A4 ✓. A5 mostly ✓ (kind chips have glyphs `◈ ○ ⏸ ↗ ⟲ ✕ ·`), but the phase-dot is a *filled* circle for every phase including `done` and `paused` (`portfolio.html:220–227`) — the brief requires paused-vs-done to differ in shape. Over-budget on `paused-budget` is color-only (`:558–561`): bar sits at 100% (not past), no ⚠ glyph. |
| 4. Preservation | 2 | **BLOCKING**: `portfolio.html:428–449` — `data-pipeline` is labeled "e14s · standard" yet renders G0✓ G1✓ G2✓ G3✓. Standard profile = G0,G1,G2; G3 is absent and must never render, never be auto-approved. C renders an absent gate *as approved*. This is precisely the forbidden behavior in #12. **MAJOR**: portfolio has no divergence column (`:414–424`) and no dedicated max-rounds column — both spec'd. `--text-tertiary:#8b949e` (`inbox.html:25`) on `#faf8f5` ~2.96:1, used pervasively for labels/captions — fails AA on small text, worst of the three. Inbox `staged` row is aged 5d (`inbox.html:512`), contradicting "freshly staged." |
| 5. Genesis chip | 3 | `new-run.html:411–418` sets the commit message in **JetBrains Mono 13px** — the rationale commits to this. It is on an elevated card with a status dot and a "ready to stage" label, but the hero element reads closer to debug output than the editorial hero the PO explicitly invited ("the genesis commit message can carry editorial type"). Weakest of the three on the dimension the brief singled out. |
| 6. Cozy/comfortable | 3 | Cream ground but the blue accent cools it; the complete absence of chrome makes each screen feel like a standalone landing page rather than a place to linger. |
| 7. Consistency | 2 | No shared topbar on any of the four screens — each opens straight into its own hero. No wordmark, no nav, no user line, no way to move between Inbox/Portfolio/New Run/Run Detail from within a screen. Palette and type roles are consistent, but the product has no chrome to be consistent *about*. The signature motif is almost invisible. |

**Strengths.** Kind chips are the best glyph+color set of the three (`◈ ○ ⏸ ↗ ⟲ ✕ ·` — every kind distinct in form). The brief section headers render the literal `## Problem` markdown chrome in mono (`new-run.html:656`) — a nice contract-as-typography touch. The run-detail History tab actually renders a commit table (the others stub it). The collapsible `state.yaml` correctly omits the tasks stub for a standard profile (`new-run.html` file tree), where B incorrectly included one.

**Weaknesses.** The profile violation is blocking on its own. Beyond that: no global chrome is a wayfinding failure — the brief's user flow (Inbox → Run → Portfolio → New Run) cannot be performed in the prototype. The genesis chip's mono treatment squanders the one element the PO flagged as most rewarding. The portfolio drops two spec'd columns. The malformed-spec row renders G0 as `gate-declined` (✕) rather than the bounced shape (dashed+strikethrough) — C defines no `.gate-bounced` class in the portfolio at all.

---

## 2. Comparative analysis

**Where they converge.** All three chose warm light, killed the cold-dark identity, removed keyboard hints, dropped pulsing glow, capped the reading surface at 76ch with serif body and ≥1.65 leading, gave the NeedsYou card an accent rail + elevation (A1), and used tinted Primer-style chips. All three render the R3 bounce message in the inbox and the 5-part decision card. All three commit to a radius ladder (6/12/16 or a variant). On the brief's hard constraints, the three agree more than they disagree.

**Where they diverge — strongest on each dimension:**
- *Aesthetic maturity*: **A**. Four families vs B's three; terracotta warmth vs C's blue; a visible signature (sigil + grid) vs C's near-invisible diamond.
- *Reading-first*: **A** (barely). All three meet the bar; A's italic-serif artifact H1 + italic lead + mono-cite blockquote edge it.
- *A5 / form+color*: **A**. A varies shape *and* fill across statuses; C varies glyph but holds the phase-dot shape constant; B drops the non-color signal on phase chips entirely.
- *Preservation*: **A**. A is the only one with no preservation violation. B bends #4 (phase/pending-gate color-only). C breaks #12 (absent gate rendered as approved).
- *Genesis chip*: tie **A ≈ B**, both italic-serif heroes; **C** deliberately chose mono and lands as the least hero-like.
- *Cozy*: **A**.
- *Consistency*: **A ≈ B** (both share a full topbar); **C** has none.

**The discriminating failure.** A and B are both credible shippable prototypes with fixable polish issues. C is the only one that violates a non-negotiable preservation constraint and that ships without global navigation — the former is blocking, the latter breaks the prototype as a clickable product.

---

## 3. Overall ranking

**1st — Candidate A.** The strongest point of view and the fewest real defects. It commits to four type roles, makes the reading surface a genuine borderless page, gives the genesis chip the editorial hero the PO asked for, varies wrapper treatment by stakes, and encodes every status with form *and* color. Its only meaningful issue is the `--faint` tier failing AA on small text — a localized, fixable contrast problem. No preservation violations.

**2nd — Candidate B.** A solid, clean, editorial second. Its reading surface and genesis chip are essentially as good as A's, and its multi-state plumbing is the best of the three. But it fails A5 on phase chips (color-only), mis-encodes pending gates as green in the inbox, omits divergence from the run-detail header, ships a `<span>…</label>` tag bug, and includes a tasks stub for a non-patch profile. None of these is blocking; all are fixable in a follow-up pass. It is a clear and honest second.

**3rd — Candidate C.** The best kind-chip glyph set and the most literal `##` chrome, but it carries the only blocking failure: a standard-profile run rendering an approved G3 gate — exactly the "absent gates are not rendered, never auto-approved" behavior the brief forbids. Compounding that: no global chrome on any screen (no way to navigate the prototype), a mono genesis chip that dodges the editorial hero the PO highlighted, two missing portfolio columns (divergence, max-rounds), the worst tertiary-text contrast of the three, and a blue/Primer palette that reads functional rather than cozy. Several of these are fixable, but the profile violation and the missing chrome are structural, not polish.

---

## 4. Recommendation

**Pick Candidate A.** It is the only candidate that clears the anti-pattern floor, satisfies all preservation constraints, and delivers the reframe's centerpiece — a genuinely comfortable reading surface — without a blocking defect. It also gives the genesis commit chip the editorial hero the product owner specifically called out as rewarding a point of view.

If A were unavailable, **B** is a safe second: its MAJOR issues (phase-chip glyph, pending-gate green, run-detail divergence, the tag bug) are all narrow, one-pass fixes against an otherwise mature design. **C** should not ship as-is; the profile violation must be fixed before it can even be re-evaluated, and the missing chrome is a separate structural decision that needs to be made deliberately rather than retrofitted.

---

## 5. Open concerns (apply to whichever candidate is chosen)

- **Faintest-tier contrast.** All three candidates have a near-white text token that fails WCAG AA on small text: A `--faint` (~2.45:1), B `--gate-subtle` (~3.52:1), C `--text-tertiary` (~2.96:1). These are used on labels, captions, packet paths, and footers. The brief mandates AA. The fix is to darken the faintest token to ≥4.5:1 for small text (or reserve it for ≥3:1 large-text/UI only). This is the single most universal issue across the set.
- **The `pulse-ring` class name in A** (`run-detail.html:78`) is behaviorally correct (no animation) but semantically a trap. Rename it (`static-ring`) so a future maintainer doesn't "restore" the pulse the brief explicitly removed.
- **Profile/gate-set coherence** needs a test in the eventual build: the C bug (G3 on a standard run) is exactly the kind of regression a fixture generator should refuse to emit. Worth adding an assertion to the fixture suite.
- **Run-detail header completeness.** The brief lists phase, gate ledger, divergence, budget, genesis. B dropped divergence; none of the three rendered a failing-contract banner *and* a failing artifact simultaneously (C shows a ✕ glyph on `verification-report.md` with the banner hidden — pick one). The build should guarantee all header fields and the conditional banner together.
- **Staged-inbox age.** "Freshly staged" should render at minutes/hours, not days (C used 5d). Minor, but it muddies the "staged is a rest state" semantics.
- **Serif-body decision.** A and B commit to a serif reading body (Newsreader); C commits to Source Serif 4. All three are valid per the brief's "pick one and commit." The build should pick one serif and load only that one to keep the font payload reasonable.
- **Multi-state representation.** B's `data-*` body-attribute state switching is the cleanest pattern; A and C stack states as separate sketch sections on the same page. Both satisfy "all states in the single file," but B's approach is closer to how a real app would toggle. Worth aligning on one approach before the build.

---

**Verdict: approve Candidate A; request-changes on B; request-changes (blocking) on C.**

**Coverage statement.** I read all 12 HTML files in full and all 3 rationale files, judged the CSS/markup directly (typography values, color tokens, radius ladders, chip shape/glyph/fill, measure caps, leading, mock-data coherence against the brief's vocabularies and per-screen specs), and computed approximate WCAG contrast for each candidate's faintest text token. I attacked each candidate's strong form: A's reading surface and genesis chip, B's status encoding and run-detail header completeness, C's profile/gate-set integrity and chrome. The one blocking finding (C's standard-profile G3) is concretely locatable (`candidate-c/portfolio.html:428–449`) and matches the brief's forbidden behavior verbatim. The approval of A is calibrated, not lenient: A has a real MAJOR contrast issue on `--faint` that should be fixed, but it is localized and does not rise to blocking.
