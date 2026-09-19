# Prior "sound less generated" passes — what was done, what worked, what to keep

Read-only research, 2026-09-18. Sources: gateline commit `3b5b91e` (PR #365, squash of
branch `prose/assembly`), the six `prose/*` branches, `the previous docs repository's .work/`
(review-01, review-02, fragment-contract, onboarding-evidence), GitHub PRs/issues
(#365, #177, #162, #214–#218, #294, #335, #363, #370), and
`the maintainer's house style` plus its enforcing test and detector.

One fact to state up front: **PR #365 has zero review comments and zero PR comments**
(`gh pr view 365 --json comments,reviews` → both empty). The maintainer's stated
rules live in the PR body, the commit subjects/bodies on `prose/assembly`, the
house-style file, and the contract READABILITY blocks — not in a comment thread.

---

## 0. Branch and commit topology (so the next pass does not redo it)

- `3b5b91e` is the squash merge of `prose/assembly` (31 commits, merged
  2026-09-16 00:43Z). `git diff 3b5b91e prose/assembly -- docs/ README.md AGENTS.md
  CONTRIBUTING.md adapters/ packages/web/DESIGN.md` is **empty** — everything on the
  branch landed.
- `prose/adapters`, `prose/design`, `prose/frontend`, `prose/integration`,
  `prose/ops` are each one first-pass commit, all merged into `prose/assembly`
  (then corrected there). They show as "unmerged" to `main` only because the merge
  was a squash. Nothing on them is missing from `main`.
- Files touched: README, AGENTS, CONTRIBUTING, adapters/copilot-cli/README,
  docs/{DESIGN, FRONTEND, FRONTEND-PLAN, INTEGRATION, INTEGRATION-PLAN, ORCHESTRATOR,
  DEPLOY, TOPOLOGY, WALKTHROUGH, GATEHOUSE-DESIGN}, packages/web/DESIGN.md,
  packages/orchestrator/README.md. **Excluded on purpose:** `runs/`, `apps/`,
  `roles/`, `contracts/` ("role specs and contracts are agent-facing, and changing
  their register changes agent behavior").
- Two-stage shape: stage 1 per area (five branches + the front-door commit), stage 2
  corrective commits on `prose/assembly` after the maintainer measured the stage-1
  result and found it was mostly relabelling.

---

## (a) The rules actually applied so far

### A. From PR #365 and its commits (the docs pass)

1. **Ration the `X, not Y` antithesis.** Target stated as "about one per document,
   spent on the sentence that carries the decision" (house-style §5). Stage 1 kept
   one per file — README kept "typed artifacts in git, not chat"; AGENTS kept
   "evidence, not a merge path"; CONTRIBUTING kept "by policy, not by accident";
   DESIGN kept "Gates are named humans, not 'the team.'"; FRONTEND/FRONTEND-PLAN one
   each; ORCHESTRATOR kept the executor-not-role charter and "a ledger, not a
   running total"; the orchestrator README kept "structural, not behavioral".
2. **Measure total contrastive load, not antithesis count.** The stage-2 correction:
   count `X, not Y` + `rather than` + `instead of` together. Stage 1 had "turned
   `X, not Y` into `X rather than Y`, the same rhetorical move in a longer coat";
   ORCHESTRATOR.md ended stage 1 with 42 "rather than" in 9,800 words (one per 230
   words); INTEGRATION.md with 18 (one per ~270 words). "Measured properly it was
   13%" not the reported 62%; "Five files netted exactly zero improvement."
3. **The test that replaced the count:** *"would a reader arriving here actually
   believe Y?"* An antithesis "earns its place only by ruling out a live
   misreading, and most did not — the information lives in the first half."
4. **Three moves, in order of how often each was right:**
   1. Delete the second half ("the most common correct edit, and the one the first
      pass almost never made").
   2. Restate positively (`Some roles are periodic, not gate-driven` → `Some roles
      run on a schedule`).
   3. Keep it sharp — where a reader genuinely would believe Y, `X, not Y` beats
      "rather than", so stage 2 **restored** some to the sharp form (P6's "roles,
      not tuning knobs"; `--color-on-solid` is "the paper showing through, not
      white"; "branch order, not a clock").
5. **Intensifiers.** Delete `exactly`, `precisely`, `explicitly`, `genuinely`,
   `deliberately`, `literally`, `truly` where they "added emphasis without adding
   meaning"; keep where they measure a real quantity ("exactly one write path",
   "exactly one blessed tree", "exactly one kind of saturated mark") or mark a
   deliberate design choice ("deliberately not committed", "deliberately deferred").
6. **Canned section openers removed:** "P5 deserves a note:", "This matters three
   ways:", "One thing to know about how fixes land here:".
7. **Semicolon chains → real lists:** AGENTS.md's nine-item fix-routing chain;
   INTEGRATION-PLAN's lettered `(a) (b) (c) (d)` risk paragraph.
8. **Protected vocabulary — never touch a quoted phrase.** `fixed sets, not knobs`
   (quoted by DESIGN §4.2 and the AGENTS invariant), `typed artifacts in git, not
   chat`, `exactly one write path`, the R1/R2/R3 statements, `The record is a
   ledger, not a running total` (quoted by `orchestrator/test/invariants.ts` for
   I3). Stage 1 shortened the AGENTS invariant and broke DESIGN's quotation of it;
   restored in `4b1bd20` ("'fixed sets, not knobs' is quoted vocabulary, not a
   stylistic choice").
9. **Nothing technical moves.** "No technical claim, number, path, command, flag,
   default or behavior statement. Preserved verbatim throughout: code spans and
   fences, links and targets, heading text and level, table structure, and every
   identifier."
10. **Parallelism of bolded list labels.** Converting an earned antithesis broke
    TOPOLOGY's `**Naming the mode, not just inferring it.**` into a sentence among
    noun-phrase labels; restored to `**Naming the mode.**`.
11. **Over-deletion check.** A deleted second half in `packages/web/DESIGN.md`
    "removed the clause answering the objection its own paragraph raises";
    restored (`f4d81cb`: "the ground's defence needs its own objection named").
12. **Verification ritual:** render check clean, 0 dead relative links across 45
    files, heading counts identical in all touched files, "every hunk read by
    hand", integrate tests pass.

Numbers the PR reports (across ~46,000 words, 16 docs): antitheses 137 → 56;
"rather than"/"instead of" 78 → 21; total contrastive 215 → 77. Per file:
ORCHESTRATOR 51 → 3; INTEGRATION 27 → 8; DESIGN 25 → 14 → 7; FRONTEND 26 → 11;
FRONTEND-PLAN 8 → 3; GATEHOUSE-DESIGN 11 → 3; web/DESIGN 14 → 5.

Re-measured on today's `main` with the job-radar `_ANTITHESIS` detector (comma /
semicolon / dash + `not`, code and comments stripped), pre-pass `c2883fd` vs now:

| file | words | pre | main | per 1k | rather/instead | intensifiers |
|---|---|---|---|---|---|---|
| docs/ORCHESTRATOR.md | 10,361 | 25 | 4 | 0.4 | 3 | 10 |
| docs/INTEGRATION.md | 5,182 | 20 | 9 | 1.7 | 3 | 4 |
| docs/FRONTEND.md | 5,213 | 15 | 10 | 1.9 | 1 | 1 |
| docs/DESIGN.md | 3,723 | 20 | 8 | 2.1 | 0 | 3 |
| docs/GATEHOUSE-DESIGN.md | 3,998 | 10 | 4 | 1.0 | 0 | 2 |
| packages/web/DESIGN.md | 2,118 | 11 | 7 | 3.3 | 0 | 1 |
| AGENTS.md | 2,314 | 4 | 4 | 1.7 | 3 | 1 |
| README.md | 1,565 | 3 | 2 | 1.3 | 0 | 1 |
| (all 17 files) | | 136 | 63 | | 16 | 36 |

Under the job-radar ceiling (2 per 1,000 words, floor 2) the only docs still over
are `packages/web/DESIGN.md` (3.3) and `docs/DESIGN.md` (2.1, marginal). The
detector misses `never` swaps and semicolon-hidden pairs — see (d).

### B. From the contracts (PR #177 / issue #162 — the "readability" set)

The `READABILITY (normative …)` block in `contracts/{spec,plan,verification-report,
review-report,release-plan}.md`, bounceable like a grammar breach:

- (a) first sentence states the takeaway in plain words — no code spans, paths,
  or parenthetical cites;
- (b) one idea per paragraph: at most 4 sentences and 120 words;
- (c) three or more parallel items become a bulleted list under a lead-in
  sentence — never a semicolon chain;
- (d) one claim per sentence; never join clauses with a semicolon;
- (e) name before cite: noun phrase on first use, at most one `file:line` cite per
  sentence, full path at first mention only.

Two calibration lessons recorded in #177: a sentence-count budget ("2–5 sentences")
produced "exactly 5 sentences of 51 words each, semicolon-chained" — so budgets are
word counts plus shape rules; and "write it as prose" for Coverage "produced the worst
walls in the corpus" — the proven bullet shape became the rule, then a table (#218,
PR #335: "a prose chain of ✓-annotated claims is a breach, not a denser table").
Issues #214–#216 are the same "reading experience" set but are UI/parser work, not
prose rules. `AUDIENCE: decide | audit` (#217) folds audit-time sections in Gatehouse.

### C. From `the maintainer's house style` (the canonical tic catalog)

§1 Voice: one voice, "a sharp analyst whose only job is to protect the reader's
attention… dry, specific, and willing to be blunt… would rather say a small true
thing than a large impressive one." "Personality lives in judgment, never in
ornament." Reader is "you" (job-radar-specific; N/A for gateline docs).

§2 Register (positively specified because "be concise" produces confetti and "be
thorough" produces walls): paragraphs of 2–4 sentences, varied length ("two
same-shaped paragraphs in a row is a tell"); one idea per sentence (a sentence
needing a semicolon "usually wants to be two sentences — or one, shorter"); lead
with the thing that decides it; prefer a fact to an adjective; true lists only for
genuinely parallel enumerable items, "never as bolded run-in headers… which are
paragraphs wearing a costume"; American spellings.

§3 One home per fact: "the single largest source of bloat… was not wordy sentences
— it was the same fact re-litigated in every section it touched." Elsewhere a
clause-length reference at most. Budgets counted, not trusted (reading-contract §4:
paragraph ceiling 110 words; memo 800 target / 1,000 ceiling; digest card 60–110).

§4 Calibration: confidence language bound, never freestyled; hedge only about
named evidence gaps; every positive claim cites a fact; every recommendation
contains one genuine reason to pass.

§5 Tic catalog, with budgets:
- **Rationed — `X, not Y`:** "about one per document, spent on the sentence that
  carries the decision. If you have written it twice, the second one becomes a
  plain statement." Enforced by density in `tests/style_documents_test.py`:
  `ANTITHESIS_CEILING = 2` per 1,000 words, floor 2. Origin story: the fit-memo
  prompt demonstrated the construction thirteen times while rationing it to one;
  "The memo of 2026-08-07 came back with five and was rejected for it."
- **Banned — canned scaffolds:** "Be blunt about the N things that matter",
  "looks like a strong fit on paper, but", "Let's break this down". "Say the
  content of the section without announcing it."
- **Banned — the enumerated paragraph:** "First, … Second, … Third, …" in one
  block. "Usually the honest fix is that two of the four didn't need saying."
- **Banned — semicolon-spliced pseudo-lists.**
- **Banned — the spliced search snippet** (ellipsis-joined quotation).
- **Banned — vendor marketing quoted as analysis.**
- **Banned — our requirement IDs in the output** (`(D2)` etc.; N/A for gateline,
  whose IDs are the product).
- **Banned — marketing vocabulary and stock gestures:** `leverage`, `seamless`,
  `robust`, `delve`, `tapestry`, `landscape`, `passionate about`, `at the
  intersection of`, tricolons and escalating triplets, `game-changer`, `testament
  to` (detector adds `award-winning`, `best-in-class`, `world-class`,
  `industry-leading`, `cutting-edge`, `next-generation`, `trusted partner`).
- **Budgeted — intensifiers:** precisely, exactly, explicitly, genuinely, truly,
  crucially — "confidence adverbs in disguise… Almost every sentence is stronger
  with the intensifier deleted."
- **Budgeted — bold:** the recommendation line, a quoted phrase whose exact wording
  matters, or a hard number. "Bolding a phrase per paragraph trains the reader to
  skip bold."
- **Watch — uniform rhythm and false tidiness:** same-length paragraphs, every
  section resolving neatly, every claim balanced by a concession; "where the
  evidence ran out, say so and stop, rather than rounding the section off with a
  summary sentence that adds nothing."

§7 Exemplars: "Rules drift; examples anchor. These pairs are normative — when a rule
above changes, these change in the same commit, because a model shown a stale
example follows the example." Three before/after pairs (digest card, memo risk
section, researched company section) each followed by a "What changed:" line. The
§7 lesson cuts both ways: the rule documents themselves are tested for the tics they
ban ("the rule documents eat their own cooking", commit `9cbf54e3`).

§8 Sources: Wikipedia *Signs of AI writing*; LAMP (arXiv 2504.07532 — "specificity
up, ornament down, and LLM-as-judge for style is barely better than random");
few-shot exemplars steer register more reliably than verbal rules; OpenAI Model
Spec as the template for behavioral voice rules.

### D. From `the previous docs repository's .work/`

- **fragment-contract.md Voice:** "A well-written expert blog post on a genuinely
  hard technical subject, for readers who are engineers but not specialists…
  Direct, concrete, illustrative; explains jargon when it first appears; uses the
  real run records… as worked examples… Not reference prose… and not pitch prose
  (no rhetorical questions-as-headlines, no 'imagine if…')." Length targets
  measured in prose words: how-it-works/reference 900–1,400 per page; onboarding
  ~2,200 per module ("The first draft of modules 1–3 came in at 11,448 words and was
  cut back deliberately"). Naming: "the company… may appear at most once, only where
  genuinely informative… never in a sales register. When in doubt, omit."
- **review-01 / review-02** were factual-accuracy reviews, and prose was explicitly
  out of scope ("Deliberately NOT checked: … prose style, grammar and typography
  beyond the specific clarity defects reported"). What they did flag about prose:
  - F17 (review-02): module 1 at 3,661 body-prose words is "2.6× the fragment
    contract's prose budget… it reads as two modules"; the two governing documents
    disagreed on the target and "the fix pass should settle rather than guess at".
  - F12: a blurb and a cross-link dropped a heading's qualifier ("…and the limit
    of that idea") and so "plant the exact misconception the modules are written to
    remove" — a compression that changed meaning.
  - F11: a reference page presented one homogenized five-rule READABILITY set when
    review-report.md declares a different three-rule set.
  - F15 (review-01): a fix pass "left a duplicated half-sentence" — "Any provider
    in its catalog, Any provider in its Models.dev catalog" — "a visibly botched
    edit in the page's key honesty table."
  - Both verdicts route minors "as a single copy-editing pass".
- **onboarding-evidence.md** carries no prose rules; its relevant lesson is the
  verification posture ("Anything I could not confirm is marked UNVERIFIED rather
  than asserted"; "do not over-claim here").

---

## (b) Worked examples — good vs awkward

Each pair is quoted from the diffs of `3b5b91e` or the stage-2 commits on
`prose/assembly`. "Good" means the rewrite reads as written and loses nothing;
"awkward" means it introduced a tell of its own or the maintainer reverted it.

**1. GOOD — delete the second half (WALKTHROUGH.md).**
Before: "The defect lives in the **plan layer**, so the fix belongs there, not in
the review artifacts:" → After: "…so the fix belongs there:" — nobody thought it
belonged in the review artifacts; the PR body cites this as the paradigm case.

**2. GOOD — delete the second half (ORCHESTRATOR.md).**
"budgets that pause rather than degrade." → "budgets that pause." Also "checkable
from metrics rather than vibes" and "asks for a human rather than answering for
one" lost their tails the same way.

**3. GOOD — restate positively (DESIGN.md, two stages).**
"concision is a contract property, not a style hope" → stage 1 "a contract property
instead of a style hope" (relabel) → stage 2 "an enforced contract property". The
adjective carries what the antithesis carried.

**4. GOOD — restate positively (ORCHESTRATOR.md).**
"a resolution alone re-escalates, which is the engine nagging rather than a bug" →
"…which is the engine nagging as designed." And "so the engine asks once per extra
round rather than once and never again" → "so the engine asks again for each extra
round."

**5. GOOD — keep it sharp where Y is a live misreading (DESIGN.md P6, `167e747`).**
Stage 1 "Extend by adding roles rather than tuning knobs" → restored "Extend by
adding roles, not tuning knobs." Commit subject: "P6's contrast is earned — a reader
would otherwise assume knobs." Same move for `--color-on-solid`: "reversed type is
paper showing through rather than white" → "paper showing through, not white"
(a token named `on-solid` would conventionally be white).

**6. GOOD — kill a duplicate rather than reword it (INTEGRATION.md §5).**
"the lock, not the layout, is the record of what is core." (a restatement of §4)
→ "which files are core is a lock question (§4)." One home per fact.

**7. GOOD — a lettered paragraph becomes the list it was (INTEGRATION-PLAN.md).**
"(a) W0 scope… (b) The P1 fork collapse… (c) Version-number semantics (W4) is a
one-way door once a public consumer exists — it is a named decision, not a
default. (d)…" → four bullets, and (c) ends at "exists." (the "one-way door" already
said it).

**8. AWKWARD — nominalized padding (adapters/copilot-cli/README.md, Haiku stage 1).**
Before: "real cross-vendor decorrelation, not same-vendor, different-lineage as a
fallback." → After: "This achieves true cross-vendor decorrelation rather than
relying on the same-vendor, different-lineage approach that the Claude Code adapter
uses as a fallback." Longer, "achieves true", "relying on the … approach" — the
classic generated coat. The maintainer cut it twice (`17d7937` "the decorrelation
line stays short"; then `1fbb254` deleted the clause outright → "(see the mapping
table)."). Lesson: when the second half goes, the first half usually does not need
a new predicate either.

**9. AWKWARD — stilted pronoun after the contrast was removed (DESIGN.md).**
Before: "**Orchestrator is a role, not a requirement.** In v0 operating mode a human
plays it (see §7). Automating it is an upgrade, not a prerequisite." → After:
"**Orchestrator is a role, and a human may play it.** In v0 operating mode one does
(see §7). Automating it is an upgrade the pipeline does not require." "one does" is
a tell of editing-around; and "an upgrade the pipeline does not require" is the same
contrast folded into a relative clause. Still on `main`.

**10. AWKWARD — semicolon as an antithesis costume (DESIGN.md and elsewhere).**
"More roles mean richer gate decisions, not more gate decisions." → "More roles
enrich a gate decision; they never add one." Same for "the human's to supply, not
the engine's to improvise" → "the human's to supply; the engine must not improvise
it", and INTEGRATION's "supported path, not hand-editing the markers" → "supported
path; hand-editing the markers is not." These pass the `not`-after-comma detector
while keeping the two-beat rhythm, and they breach the contracts' own rule (d)
"never join clauses with a semicolon." The stage-2 commits never audited these.

**11. AWKWARD — `never` swapped in for `not` (DESIGN.md).**
"Adapter agent files are **rendered, not written**:" → "**rendered**, never
hand-written:"; "bounce it, not to guess" → "bounce it, never to guess"; "receive
`spec.md` directly, not the implementer's summary" → "directly, never the
implementer's summary". Invisible to a detector keyed on `not`, identical to the
ear.

**12. AWKWARD — an idiom inflated into a hedge (INTEGRATION.md table).**
"validate is necessary, not sufficient;" → "validate is a necessary check, but
passing it does not guarantee success;". Four words became eleven and the
"necessary/sufficient" precision went soft. Still on `main`.

**13. AWKWARD — em-dash emphasis traded for "rather than" (FRONTEND.md).**
"This — not Stage B — is where 'a group of teams of humans' is served" → "Stage C,
rather than Stage B, is where…". The original em-dash aside was a human move; the
replacement is the coat the PR body itself names.

**14. BORDERLINE — stacked appositive (DESIGN.md / FRONTEND.md).**
"which is a G0/G1 defect, not an implementation defect." → "that defect sits at
G0/G1, upstream of the implementation." (reads fine) versus FRONTEND: "a spec
ambiguity rather than an implementation defect" → "a spec ambiguity, a defect
upstream of the implementation." — two appositives in a row; the second one is a
restatement.

**15. AWKWARD-then-fixed — the over-deletion (packages/web/DESIGN.md).**
Stage 2 cut "…which is the register's aggregate finding, shown live, not an argument
against this value." to "…shown live." — but the paragraph exists to answer that
objection, so `f4d81cb` put "not an argument against this value" back. Deletion has
to be checked against the paragraph's job, not the sentence's.

---

## (c) The maintainer's stated preferences, verbatim

From the PR #365 body (the only place the pass's rules are written out):

> "The house style (the maintainer's tic catalog, §5) rations the `X, not Y`
> antithesis to about one per document, 'spent on the sentence that carries the
> decision'. It is the sharpest construction available and the one that decays
> fastest under repetition."

> "The first pass converted 137 antitheses and reported a 62% win. Measured properly
> it was **13%** — it had turned `X, not Y` into `X rather than Y`, the same
> rhetorical move in a longer coat, and one document ended up with 42 instances of
> 'rather than'. Five files netted exactly zero improvement."

> "**would a reader arriving here actually believe Y?** An antithesis earns its
> place only by ruling out a live misreading, and most did not — the information
> lives in the first half."

> "1. **Delete the second half.** The most common correct edit, and the one the
> first pass almost never made. 2. **Restate positively.** … 3. **Keep it sharp.**
> Where a reader genuinely would believe Y, `X, not Y` beats 'rather than' — so this
> pass *restored* some."

> "`runs/`, `apps/`, `roles/` and `contracts/` were out of scope — role specs and
> contracts are agent-facing, and changing their register changes agent behavior."

From commit subjects on `prose/assembly` (the maintainer's one-line verdicts on the
agents' work):

- `17d7937` "copilot-cli README: the decorrelation line stays short"
- `4b1bd20` "AGENTS.md: 'fixed sets, not knobs' is quoted vocabulary, not a
  stylistic choice"
- `167e747` "DESIGN.md: P6's contrast is earned — a reader would otherwise assume
  knobs"
- `1fbb254` "AGENTS.md + copilot-cli README: one earned contrast restored sharp, one
  redundant clause cut"
- `f4d81cb` "web/DESIGN: the ground's defence needs its own objection named"
- `c0c7120` "docs: cut decorative contrastives the first pass missed, not just
  reworded"
- `4de0b29` "docs: stage 2 prose pass on INTEGRATION.md — vary the contrast, don't
  relabel it"
- `50d94dc` "orchestrator docs: the second half of the antithesis, deleted"
- `4117c99` "docs: fix the prose pass's rather-than swap on ops docs" — body: "the
  same contrast in a longer coat, netting zero real improvement on two of the four
  files."

(Observe that the subjects themselves lean on `X, not Y` — the construction is house
voice; the rule is rationing, not abolition.)

From PR #177 (contracts readability):

> "Sentence-count budgets invite clause-chaining; replaced with a word budget
> (~150 target, 250 cap) plus shape rules."

> "the only runs that took it literally produced the worst walls in the corpus,
> while bullet-form Coverage stayed healthy everywhere. The proven bullet shape is
> now the requirement."

From issue #294 (the run header), the same instinct applied to UI copy:

> "One home per fact." … "This is not a spacing problem. More whitespace would make
> the repetition *longer*, not quieter." … "the fix is deletion inside the existing
> scaffold, not a new one".

From PR #335: "a prose chain of ✓-annotated claims is a breach, not a denser table."

From PR #370 (open; the README positioning section, framed for the maintainer to
rewrite): "The prose is a draft in your voice's place." and "No comparison table. A
table invites scoring, and scoring a neighbour you surveyed once, months ago, is
how a README acquires a claim it cannot defend."

From `house-style.md` (the maintainer's own catalog, job-radar):

> "Personality lives in judgment, never in ornament."
> "Budget: about one per document, spent on the sentence that carries the decision.
> If you have written it twice, the second one becomes a plain statement."
> "Say the content of the section without announcing it."
> "Usually the honest fix is that two of the four didn't need saying."
> "Almost every sentence is stronger with the intensifier deleted."
> "where the evidence ran out, say so and stop, rather than rounding the section
> off with a summary sentence that adds nothing."
> "Rules drift; examples anchor."

From the AGENTS.md invariant (in force for run artifacts): "the **READABILITY
rules** on human-facing sections (plain-words opening sentence, one idea per
paragraph, lists instead of semicolon chains, name before cite). Breaches are
bounced with the rule cited."

---

## (d) Recommendations for the next pass

### Keep

1. **The test, and the order of moves.** "Would a reader here believe Y?" → delete
   the second half; else restate positively; else keep it sharp. This is the one
   thing the whole history proves works.
2. **Measure with the same detector before and after, and put the numbers in the
   commit body.** The maintainer adopted `N → M` per file as the commit convention;
   the job-radar regex is the closest thing to a shared instrument:
   `(?:[,;]|\s[—–-])\s*not\s+(?!only\b)(?:merely\s+|just\s+|simply\s+)?[\w“"]`
   over prose with code spans, fences, comments and link targets stripped. Use
   density (per 1,000 words, ceiling 2, floor 2), not "one per document" — a
   10,000-word ORCHESTRATOR.md at 0.4/1k is already under; `packages/web/DESIGN.md`
   (3.3/1k) and `docs/DESIGN.md` (2.1/1k) are the only ones still over.
3. **Protected-vocabulary grep before every edit.** Before touching any `X, not Y`,
   grep the phrase across the repo including `packages/*/test` — the
   `invariants.ts` quotation and the DESIGN→AGENTS quotation were the two near
   misses. Keep the list from the PR body and add to it.
4. **The scope line.** Docs and READMEs only; `roles/`, `contracts/`, `runs/`,
   `apps/` untouched; no code span, path, number, heading, link or table structure
   changes; heading-count and link checks after.
5. **Paragraph-level re-read after every deletion** (the objection-answering clause;
   the bolded label parallelism) — both stage-1 defects were sentence-correct and
   paragraph-wrong.
6. **Hand-read every hunk.** The the previous private repository F15 defect ("Any provider in its
   catalog, Any provider in its Models.dev catalog") is what a fix pass leaves
   when nobody re-reads the line it patched.

### Drop

1. **Relabelling.** No `rather than`, `instead of`, `never`, `; it does not`,
   `; they never` as replacements. The stage-2 detector only sees `not` after a
   comma/semicolon/dash, so the next pass needs to add the swaps stage 2 could not
   see: `never` after a comma, and the two-clause semicolon pair (`X; Y is not`).
   Examples 10 and 11 above are still on `main`.
2. **Counting antitheses as the metric.** Total contrastive load, plus the new
   evasions above.
3. **Rewriting the first half when only the second half was the problem.** Example
   8 (the copilot-cli line) and example 12 (necessary/not sufficient → eleven-word
   hedge): the cheapest correct edit was a period.
4. **Delegating stage 1 to a model without the test in the prompt.** The Haiku
   commit's rewrite was the one the maintainer reverted twice; the Opus/Sonnet
   stage-2 commits that stated the test in the commit body were accepted as-is.
5. **Re-running the contrastive pass as the whole job.** It is 70% done and the
   remaining density is close to the ceiling. The catalog's *other* tics were never
   audited in gateline's docs and are visibly present on `main`:
   - "worth naming/noting" scaffolds: "A consequence of statelessness worth naming:",
     "One more boundary, learned from practice:", "One more thing the lock pins
     down:", "One asymmetry worth naming:" (review-02) — house-style "Banned —
     canned scaffolds".
   - Semicolon-spliced pseudo-lists inside prose paragraphs (contracts ban them for
     agent artifacts; the docs are full of them).
   - Uniform rhythm / false tidiness: paragraphs that close with a summarizing
     sentence; the "— which is what X is for" tail.
   - Bold-per-paragraph run-in labels (`**Naming the mode.**` style is a deliberate
     list idiom; bolding inside running prose is the tic).
   - Stacked appositives (example 14) and the "one does" / "as designed" patches
     that editing-around leaves behind (example 9).
   - Intensifiers still at 36 across the set (ORCHESTRATOR 10); most are
     load-bearing, but re-audit under the "measures a real quantity or marks a
     deliberate choice" rule.
6. **Length budgets by sentence count.** #177's finding: a sentence budget produced
   five 51-word sentences. If the next pass sets budgets, set them in words per
   paragraph (110–120) and words per page (fragment-contract: 900–1,400).

### Suggested protocol for the next pass

- One branch per document area, each commit body carrying the per-file before/after
  table and the specific test applied; assemble and squash as #365 did.
- Stage 0: run the detector plus a `never`/semicolon-pair grep and list every hit
  with 40 chars of context in the commit body, marked keep/delete/restate before
  editing — the "keep" list is what the maintainer will review.
- Stage 1: contrastives that survived, using the three moves.
- Stage 2: the untouched tics (scaffolds, semicolon prose, closing summaries,
  bold), same discipline.
- Stage 3: re-read each changed paragraph in full; heading/link/render checks.
- Never write in the same coat: the commit subject is allowed one `X, not Y`.
