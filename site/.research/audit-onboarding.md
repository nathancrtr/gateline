# Accuracy and currency audit — Onboarding modules (the previous docs repository/onboarding/)

Audited 2026-09-18 against `nathancrtr/gateline` `main` @ `eaeea92`, read-only.
Pages were written 2026-07-27/28 against `agentic-sandbox` @ `934ecca`.
Git used for exercise replay: `git version 2.50.1 (Apple Git-155)`.

Status legend: **OK** true as written · **STALE** true in substance, wrong name/path/number · **WRONG** no longer true · **UNVERIFIABLE** could not be checked read-only · **MISSING-NEWER** true but a newer fact changes the lesson.

Path convention below: every `frontend/packages/...` in the pages is now `packages/...`. That one substitution is listed once per page in the retired-names section rather than repeated in every row.

---

## 1. onboarding/index.html

Counts: 7 claims — 7 OK, 0 STALE, 0 WRONG. No exercises. No retired names.

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "`CONTRIBUTING.md` is policy" | OK | `CONTRIBUTING.md` exists at repo root | — |
| 2 | Links to How It Works / Reference / API pages | OK | All `../how-it-works/`, `../reference/`, `../api/` targets exist in `public/` | — |
| 3 | "Modules 1 and 2 carry runnable exercises" | OK | All nine exercises across the two modules still run and match (see tally) | — |
| 4 | Module 1 blurb: "commit messages as a protocol, and the limit of that idea" | OK (blurb) | The body's "limit" argument (one parser in the codebase) is now stale — see page 2 #38 and page 3 #30 | Leave blurb; fix the bodies |
| 5 | Module 3 blurb: "where the parsers live, which shapes have none" | OK (blurb) | The body's "which shapes have none" list is now wrong (F<n> findings are parsed) — see page 4 #11 | Leave blurb; fix the body |
| 6 | Modules 4–6 "Planned" | OK | Not present | — |
| 7 | Framework named "gateline" throughout | OK | Correct current name | — |

Newer facts the page should reflect: none required. Optional: the module-4 blurb could name the render command (`gateline render`) and the module-5 blurb `gateline self-update`, since both now exist as CLI commands.

---

## 2. onboarding/git-plumbing.html

Counts: 45 claims — 35 OK, 6 STALE, 2 WRONG, 0 UNVERIFIABLE, 2 MISSING-NEWER. Exercises: 5 of 5 PASS.

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | Thesis at "the top of the module that wraps the git CLI: reads always address refs…" | OK | `packages/core/src/sources/git.ts` header, verbatim | Path only |
| 2 | "`frontend/packages/core/src/sources/git.ts`" (visible, intro) | STALE | `packages/core/src/sources/git.ts` | Replace path |
| 3 | "Not one read method on the `Git` class… takes a working-tree path" | OK | Still true; new rev-addressed readers since (`objectId`, `revListCount`, `diff`) | — |
| 4 | Plumbing/porcelain; `git-commit-tree(1)` "usually not what an end user wants to run directly" | OK | Verified against local man page | — |
| 5 | `gitglossary(7)` object / tree definitions | OK | Verbatim | — |
| 6 | Exercise 1 (objects) expected output | OK | Identical output (see tally) | — |
| 7 | `writeTreeWithBlob` docblock quote; `GIT_INDEX_FILE` scratch index; `read-tree` → `update-index --add --cacheinfo 100644,…` → `write-tree`; `finally` removes dir | OK | Verbatim; temp dir is now prefixed `gateline-index-` | — |
| 8 | `git(1)` "an alternate index file" | OK | Verbatim | — |
| 9 | `commitTree` sets the four `GIT_AUTHOR_*`/`GIT_COMMITTER_*` vars from optional identity | OK | Unchanged | — |
| 10 | `gitglossary(7)` ref definition and "ref namespace is hierarchical…" | OK | Verbatim | — |
| 11 | "gateline uses `refs/agentic/wip/<branch>`" | WRONG (renamed) | `refs/gateline/wip/<branch>` (`local-source.ts` `writeState` and `recoverIntent`) | Rename |
| 12 | Pseudoref quote; "code-tree monitor tests for the existence of `MERGE_HEAD`" | OK | `IN_PROGRESS_MARKERS = ['rebase-merge','rebase-apply','MERGE_HEAD']` via `rev-parse --git-path` + `existsSync` | — |
| 13 | `git-update-ref(1)` three-argument quote | OK | Verbatim | — |
| 14 | Exercise 2 (refusal) expected output | OK | Identical, including both OIDs | — |
| 15 | `updateRefCAS` docblock "the ref no longer points at `expectedOld` — the caller re-reads and re-presents"; try/true, catch/false | OK | Verbatim | — |
| 16 | "closing-bookkeeping loop gives up after five attempts and logs" | OK | `engine.ts`: `for (attempt < 5)`; log "closing commit lost CAS 5×; the heartbeat will age the open entry" | — |
| 17 | `ZERO_OID` used in three places: staging a run branch, creating a sweep branch, materializing a remote-only run branch | OK | `local-source.ts` `stageRun` + `writeState`; `schedule.ts` sweep creation | — |
| 18 | Scheduler header: "branch creation from ZERO_OID is the CAS duplicate-dispatch guard" | OK | Verbatim in `packages/orchestrator/src/schedule.ts` header | — |
| 19 | Exercise 3 (create-only) expected output | OK | Identical | — |
| 20 | `gitrevisions(7)` `<rev>:<path>` and `:[<n>:]<path>` quotes | OK | Verbatim | — |
| 21 | Exercise 4 `git show main:runs/dupefind/state.yaml \| head -6` | OK | Identical output | — |
| 22 | "run/dupefind … no longer exists anywhere in the repository" | OK | `git branch -a \| grep dupefind` → 0 refs | — |
| 23 | `Git.show` returns `null` via a regex on the "does not exist" family | OK | `MISSING_PATH_RE` | — |
| 24 | Shadow replay hands the observer a run ref whose revision is a commit id | OK | `shadow.ts`: `ref: commit.oid` | — |
| 25 | "`origin/run/<slug>` is the portable form" in a fresh clone | OK | — | — |
| 26 | `gitglossary(7)` fast-forward quote | OK | Verbatim | — |
| 27 | `git merge --ff-only` and `git pull --ff-only` quotes differ | OK | Both verbatim from local man pages | — |
| 28 | `syncFromRemote` builds `refs/heads/<b>:refs/heads/<b>`, no `+`, one per branch | OK | Unchanged | — |
| 29 | "The ancestry test … is what the code-tree monitor calls" | OK | `CodeTreeMonitor.check` → `git.isAncestor(startHead, codeHead)` | — |
| 30 | Non-ff fetch is a per-ref refusal, swallowed; fetching into a checked-out branch is fatal, filtered first | OK | Comments cite #104 | — |
| 31 | Exercise 5 (`merge-base --is-ancestor`, three exit codes) | OK | Identical | — |
| 32 | `git-merge-base(1)` "non-zero status that is not 1"; `isAncestor` folds every failure to `false` | OK | Verbatim; `isAncestor` catch → false | — |
| 33 | `CodeTreeMonitor` decision order (dirty → in-progress → HEAD unmoved → detached → off-default → not-ancestor) and what each does | OK | Matches `check()` exactly | — |
| 34 | Same section | MISSING-NEWER | Since #222 a pause carries a machine-readable `cause` (`dirty \| in-progress \| detached \| off-default-branch \| non-fast-forward`) and a dirty tree that hides a queued fast-forward sets `upgradeBlocked` | Add one sentence |
| 35 | Two consecutive checks debounce; exits `EX_TEMPFAIL`; "the engine never pulls: updating the code is an operator act" | OK | `SUPERSEDE_EXIT_CODE = 75`; debounce unchanged | — |
| 36 | Same section | MISSING-NEWER | The operator act now has a command: `gateline self-update` (pull + rebuild web dist, then let the running engine self-supersede) | Name the command |
| 37 | Maintainer note: TOPOLOGY.md incident (budget limit raised on origin, stale local branch re-escalated; "the state store was replicated, and both replicas accepted writes") | OK | TOPOLOGY.md §1, verbatim ("Within one day…") | — |
| 38 | `git-worktree(1)` quotes incl. REFS section | OK | Verbatim | — |
| 39 | "gateline's own `refs/agentic/wip/*`" (worktree section) | WRONG (renamed) | `refs/gateline/wip/*` | Rename |
| 40 | `Git.worktrees` parses `worktree list --porcelain`; "four separate decisions consult it" | OK | Exactly four call sites: `syncFromRemote`, `writeState` (ff-first, #99), `writeState` (route choice), `Engine.recoverRejectedPush` | — |
| 41 | Commit grammar: `G2 approved by <name> [burden: …]`, `staged by <name>`, `armed by <name>` | OK | `contracts/state.yaml` header + `actions.ts` | — |
| 42 | Same | MISSING-NEWER (minor) | Human grammar also has `closed by <name> [disposition: …]`, `reopened to <phase> by <name> (was closed as …)`, `staged by <name> [client-key: <key>]`, `escalation #<i> resolved by <name> [disposition: …]` | Optional mention |
| 43 | "exactly one place in the entire codebase parses a commit message, and it is a regular expression counting how often an artifact was bounced" | WRONG | A second parser landed with #268: `parseLedgerSubject` in `packages/core/src/view-model/ledger.ts` turns every `state(<slug>): …` subject into a typed decision-ledger entry (kind, actor human/orchestrator/unknown, gate, by, burden), served by `packages/server/src/app.ts` on `GET /api/runs/:src/:slug` as `history[].ledger`. The observer's bounce regex (`observe.ts`) remains the only parser that feeds *derivation*. | Rewrite: "two parsers, neither feeds a decision: the observer counts bounces; Gatehouse renders a ledger. Everything that *decides* reads the file." |
| 44 | "a reflog, which nothing in gateline reads or writes" | OK | No `reflog` reference in core/orchestrator/cli sources | — |
| 45 | Further reading: `git.ts` "under three hundred lines" | STALE | 311 lines | "about three hundred lines" |

Visible-text path/name occurrences also STALE: lines 39 and 590 (`frontend/packages/core/src/sources/git.ts`), 250 and 534 (`refs/agentic/wip/…`). Further-reading paths `local-source.ts`, `docs/TOPOLOGY.md §3`, `docs/ORCHESTRATOR.md §13` — all still exist under those section numbers.

### Exercises (module 1)

| Exercise | Runs as written? | Expected output matches? |
|---|---|---|
| 1 — objects | Yes | Yes, byte-identical (blob `5626abf0…`, tree `7385b9ca…`) |
| 2 — feel the refusal | Yes | Yes, including OIDs `0c807259…` / `c6534426…` and both exit codes |
| 3 — create-only | Yes | Yes ("reference already exists", exit 128) |
| 4 — read a run's spine | Yes | Yes, six lines identical |
| 5 — fast-forward test | Yes | Yes (0 / 1 / 128 with "Not a valid commit name") |

### Newer facts the page should now reflect

- The write-ahead intent ref namespace is `refs/gateline/wip/`.
- Gatehouse now has a commit-subject parser of its own (`view-model/ledger.ts`, #268). The "one parser" framing and the check-your-understanding question 6 ("What does [the grammar] *not* do?") need re-aiming: the grammar is now *rendered* by the machine, but still never *decided on* by it.
- `writeState` fast-forwards a local branch strictly behind origin before choosing a route (#99), so `ref-moved` can fire in three places, and `stale-checkout` is what a non-fast-forwardable checkout returns.
- The bounce regex counts per dispute, not per lifetime (#348): only bounces newer than the last resolved contract dispute over that artifact count.
- Code-tree monitor: `cause` discriminant and `upgradeBlocked` (#222); `gateline self-update` is the operator's pull.
- The bot identity is `gateline-orchestrator <orchestrator@gateline.invalid>` (`packages/orchestrator/src/start.ts`); this page only alludes to "its own bot identity", so no text change is needed here.

---

## 3. onboarding/the-co-written-state-file.html

Counts: 40 claims — 30 OK, 5 STALE, 3 WRONG, 0 UNVERIFIABLE, 2 MISSING-NEWER. Exercises: 4 of 4 PASS.

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "a human edits it through Gatehouse or the `agentic` CLI" | STALE | The CLI is `gateline` (`packages/cli`) | Rename |
| 2 | Contract header: gate entries written only by the named human approver | OK | `contracts/state.yaml` line "Gate entries are written ONLY by the named human approver" | — |
| 3 | Ledger inline comment "facts, not a running total — totals are derived, so races and audits survive" | OK | Verbatim | — |
| 4 | Exercise 1 (`creation-seam` first ten lines) | OK | Identical | — |
| 5 | `parse` vs `parseDocument`; schema/validate import `parse`; single write path imports `parseDocument`; `setIn`; `toString` | OK | `schema.ts`, `validate.ts`, `scaffold.ts`, `observe.ts`, `registry.ts`, `schedule.ts` import `parse`; only `local-source.ts` imports `parseDocument` | — |
| 6 | Sweep marker closed by line-oriented regex replacement | OK | `schedule.ts` `.replace(/^tokens_in: .*$/m, …)` etc. | — |
| 7 | `planDecision` in `actions.ts` returns `mutate`, `message`, `summary`; only reach outside its arguments is the clock | OK | `PlannedDecision` interface; `nowIso()` | Path only |
| 8 | Legality checks: gate outside profile throws; already decided throws pointing at resume; missing burden throws | OK | `requireGate`/`requireOnTheTable`; "resume the run to re-open it"; "approve requires a burden category" | — |
| 9 | Same | MISSING-NEWER | Two more refusals: every verb but `close`/`reopen` is refused on a closed run (`phase: closed`, `closure:` block, `gateline close/reopen`), and `requireProducerAtRest` refuses approving while the producer is in flight; approve also takes `hold`/`holdReason` | Add a sentence |
| 10 | `writeState` docblock "the single write path" | OK | `source.ts` interface docblock | — |
| 11 | No-identity refusal "decisions must be attributable to a named human" | OK | Verbatim | — |
| 12 | Route choice: no worktree → plumbing + CAS; worktree → `git commit -m <msg> -- <statePath>`; dirty refuses | OK | Unchanged | — |
| 13 | Same section | MISSING-NEWER | Before the route choice, `writeState` now fast-forwards a local branch that is strictly behind origin (#99): via `merge --ff-only` in the checkout (failure → `stale-checkout`) or a CAS ref move (failure → `ref-moved`). The figure's "resolve the tip" box hides this step. | Add a step to the figure/prose |
| 14 | Figure: `refs/agentic/wip/<branch>` (two SVG labels) | STALE | `refs/gateline/wip/<branch>` | Rename |
| 15 | Figure: six refusals `ref-moved, dirty-worktree, stale-checkout, no-branch, no-identity, error` | OK | `WriteFailure` type in `source.ts` | — |
| 16 | Figure: "only ref-moved is retried, up to 5 attempts" | OK | `engine.ts` | — |
| 17 | Maintainer note: 2026-07-23 kill window; "recovery was worse than the fault" | OK | `runs/writestate-kill-window/intent-brief.md`: "On 2026-07-23 the engine was killed during a restart…", "Recovery is worse than the fault. It needs a human doing manual git surgery" | Quote tense: "Recovery is worse than the fault" |
| 18 | Only `ref-moved` retried; others "logs and gives up… the heartbeat will age the open entry" | OK | Verbatim log line | — |
| 19 | `expectedTip` docblock "extends the CAS window back to the caller's read"; engine passes it, human surfaces omit it | OK | `source.ts` docblock verbatim | — |
| 20 | Exercise 2 (two writers) expected output | OK | Identical incl. OIDs `173b42ea…` / `1aece1d2…` | — |
| 21 | Every action derivable from committed files and idempotent to re-derive | OK | `derive.ts` header, ORCHESTRATOR.md §4.7 | — |
| 22 | Dispatch protocol: "commits the intent first … and only launches the job if that commit lands" | STALE | Commit-then-**push**-then-launch (#103): origin *accepting the push* of the intent commit is what authorizes the launch; a rejected push drops the intent (plumbing path) or keeps it local (checkout path) and launches nothing | Add the push step |
| 23 | "job handles — process ids, harness session identifiers — are deliberately not committed" | WRONG | The ledger entry now carries `session: <id>` (#181, so a same-round retry resumes the agent's harness session) and `engine: <hostname>:<pid>` (#349, so a second engine does not re-dispatch a live job). ORCHESTRATOR.md §4.4 keeps the *handle* rule and explains why neither is a handle: nothing is derived from them. | Rewrite: handles are not committed; a session id and the writer's process identity are, as facts handed back, not state read |
| 24 | Ledger fields "timestamp, role, task, round, adapter, model, tokens, cost" | OK (incomplete) | Also `failed`, `refused`, `session`, `engine` | Optional |
| 25 | `cost_spent_usd` annotated "derived: the sum of ledger[].cost_usd" | OK | Verbatim | — |
| 26 | Engine recomputes total by reducing over the whole ledger | OK | `ledger.reduce(...)` then `setIn(['budget','cost_spent_usd'], round2(spent))` | — |
| 27 | Exercise 3 (dupefind ledger 16 / 12.15 / 12.15) | OK | Identical | — |
| 28 | Budget limit is a pre-flight gate (DB); `creation-seam` 104.54 vs 60 | OK | `cost_limit_usd: 60`, `cost_spent_usd: 104.54` on main; DB rule; newer: skipped when enforcement is off (#109), refused dispatches meter $0 (#155) | — |
| 29 | Decline → resume re-opens; consumer walks history for `!approved && by !== null` | OK | `observe.ts` declineEvents | — |
| 30 | Schema normalizes absent out-of-profile gate to undecided; docblock "can never masquerade as approved" | OK | `schema.ts` verbatim | — |
| 31 | Bot identity "`agentic-orchestrator <orchestrator@agentic.invalid>`" | STALE | `gateline-orchestrator <orchestrator@gateline.invalid>` (`packages/orchestrator/src/start.ts`). History carries 466 commits under the old identity and 2 under the new. | Rename; note that finished runs keep the old author |
| 32 | Exercise 4 (`shortlog` 70/37; verb census) | OK | Identical. Output legitimately still says `agentic-orchestrator` — it is history | Add a one-line note that the identity shown is the run's historical bot name |
| 33 | "The metrics reader walks the state file's history … never inspects the subject" | OK | `metrics.ts` `collectRunDecisions`: "the first commit at which the gate stops being undecided" | — |
| 34 | "The bounce-count regular expression in the observer is the only place in the codebase that parses a commit message at all" | WRONG | `parseLedgerSubject` (`packages/core/src/view-model/ledger.ts`, #268) parses every state commit subject for Gatehouse's decision ledger; it is a pure function, never feeds derivation, and unparseable subjects come back as `other` verbatim | Rewrite as "two parsers; one counts bounces, one renders history; neither decides" |
| 35 | Design docs say the human decision grammar is "what the metrics reader treats as authoritative" | OK | ORCHESTRATOR.md §4.3 still says so | — |
| 36 | dupefind's final commit `state(dupefind): G3 recorded N/A by nthncrtr; phase -> done` "matches no reserved grammar and is harmless, because nothing parses it" | WRONG (half) | Still the last commit on main touching that file, still matches no grammar; but Gatehouse's ledger parser *does* read it and classifies it `other`, rendering the subject verbatim — harmless by design ("never guess, say so"), not by absence | "harmless because the one parser that sees it renders it verbatim as `other`" |
| 37 | Check-your-understanding Q5 "State the two invariants by name" | OK | derivable-from-committed-files, idempotent-to-re-derive | — |
| 38 | Further reading paths (`actions.ts`, `local-source.ts`) | STALE | `packages/core/src/record/actions.ts`, `packages/core/src/sources/local-source.ts` | Replace prefix |
| 39 | ORCHESTRATOR.md §4.2, §4.3, §4.4, §7; `contracts/state.yaml` | OK | Sections exist under those numbers | — |
| 40 | "phase: … done" list implies `done` is terminal | OK (incomplete) | `state.yaml` phases now include `closed` (`gateline close --as <disposition>`), a rest state distinct from `done` | Optional mention |

Visible-text retired names: line 33 (`agentic` CLI), 111/550/552 (`frontend/packages/...`), 258/271 (SVG `refs/agentic/wip/<branch>`), 480–481 (bot identity), 493 (exercise output — historical, keep as-is with a note).

### Exercises (module 2)

| Exercise | Runs as written? | Expected output matches? |
|---|---|---|
| 1 — comments that survived | Yes | Yes, ten lines identical |
| 2 — two writers, one tip | Yes | Yes, byte-identical (OIDs, subject, file) |
| 3 — recompute the total | Yes | Yes (`16`, `12.15`, `cost_spent_usd: 12.15`) |
| 4 — the partnership, counted | Yes | Yes (70 `agentic-orchestrator` / 37 Nathan Carter; 28/21/19/4/2/2) — the bot name in the output is historical |

### Newer facts the page should now reflect

- `refs/gateline/wip/`; bot identity `gateline-orchestrator <orchestrator@gateline.invalid>`; CLI `gateline`.
- Ledger entries carry `session` (#181) and `engine: host:pid` (#349); ORCHESTRATOR.md §4.4 is the authoritative wording on why these are not "handles".
- Push-then-launch (#103): the intent commit must reach origin before a job launches; `Engine.recoverRejectedPush` rolls a rejected plumbing-path commit back with `updateRefCAS(branchRef, parent, commit)` — CAS used to move a ref *backwards*, a good module-1 callback.
- `writeState`'s fast-forward-first step (#99) and the `stale-checkout` refusal it produces.
- Gatehouse's decision ledger (#268) parses commit subjects; the "machine reads the file / grammar is for humans" division becomes "machine *decides* from the file; the grammar is rendered for humans, by a parser that never guesses".
- Bounce counts are per dispute (#348).
- `closed` phase and `closure` block; `close`/`reopen` verbs in the human grammar.
- `approve` can `hold` a run (approve-and-hold) — an `advancePhase: false` alone is insufficient because the engine's convergence rule would advance anyway.

---

## 4. onboarding/contracts-and-their-parsers.html

Counts: 42 claims — 22 OK, 9 STALE, 8 WRONG, 0 UNVERIFIABLE, 3 MISSING-NEWER. No runnable exercises (two worked cases, both still mechanically correct except the CLI name).

| # | Claim (quoted, short) | Status | What is true now | Suggested fix |
|---|---|---|---|---|
| 1 | "bounce, never guess" — missing required section is malformed | OK | DESIGN.md §5, AGENTS.md | — |
| 2 | "There are nine contracts" | WRONG | Ten: `contracts/release-plan.md` was added (#260) | "ten" |
| 3 | "A template can declare up to four kinds of rule" (sections, BUDGET, GRAMMAR, READABILITY) | STALE | A fifth normative, *parsed* family exists: `AUDIENCE:` (#217) — `<section>=audit` pairs that Gatehouse folds to their heading, parsed by `extractAudience` in `validate.ts`; `spec.md` and `review-report.md` carry one. `review-report.md` also has a normative VERIFY ROUND block and `verification-report.md` a VERDICT block | Add AUDIENCE as a fifth family; mention VERIFY ROUND / VERDICT |
| 4 | "Six of the nine declare [BUDGET]" | STALE | Seven of ten (docs-delta, integration-profile, plan, release-plan, review-report, spec, verification-report) | Update numbers |
| 5 | "Only `spec.md`, `plan.md` and `verification-report.md` declare [GRAMMAR]" | WRONG | `release-plan.md` also declares GRAMMAR: bold-label preamble lines `**Change released:**`, `**Environment:**`, `**Rollback trigger:**`, `**Rollback exercised:**` and a numbered Release steps list | Four contracts |
| 6 | "Four contracts declare [READABILITY]" | STALE | Five (`release-plan.md` added the five-rule set for CI health, Rollback plan, Verification after release, Blast radius) | Update |
| 7 | "Three GRAMMAR blocks declare five shapes" | STALE | Four blocks; `verification-report.md` now also declares the overall `**Verdict:** pass \| fail \| escalate` line (#152); `release-plan.md` adds preamble fields + ordered steps | Recount shapes (eight) |
| 8 | `buildLexicon` / `buildEvidenceRollup`; "never a paraphrase"; presence not verdicts | OK | `lexicon.ts`, `evidence.ts` headers | Path only |
| 9 | `scanIds` reads through fences on purpose, with the reason in a comment; the review-mention loop in `evidence.ts` carries no fence state; the verification loop above it does | OK | All three verified | — |
| 10 | Grid: `# Review Report: <task id>` and `**Verdict:**` parsed by `parseReviewReport` though no GRAMMAR block declares them | OK (still no GRAMMAR block) | `orchestrator/review-report.ts` unchanged. But the contract now declares the round-2 disposition grammar as normative ("tooling reads exactly these two disposition words"), so "outside every GRAMMAR block" is true only in the narrow sense of the block's label | Soften to "declared nowhere as GRAMMAR, though VERIFY ROUND now declares a parsed shape" |
| 11 | "`### F<n> — <severity> — <one-line defect>` … used in every review report; read by nothing" | WRONG | `parseReview` in `packages/core/src/view-model/review.ts` (#214) parses `FINDING_HEADING` (both `### F1 — minor (PLAUSIBLE) — …` and `### F1 (blocking) — …` spellings), severities, `**Verdict:**`/`**Round:**` lines and `- **F<n> — resolved\|stands**` dispositions; `evidence.ts` uses it to attribute findings to criteria. The "convention only" quadrant is now empty for review reports | Move F<n> to "parsed · not declared as GRAMMAR"; the empty quadrant is itself a lesson |
| 12 | "`release-plan.md`, `retro.md`, `docs-delta.md` and `integration-profile.md` get no contract back from `contractFor`" | WRONG for release-plan | `contractFor` returns `'release-plan.md'`; `BUILTIN_SECTIONS` lists CI health, Release steps, Rollback plan, Verification after release, Blast radius. The other three still return null | Drop release-plan from the list |
| 13 | Same | MISSING-NEWER | Release-plan's GRAMMAR (the bold preamble fields) is declared normative but *no parser reads it* — only its H2 sections are validated. That is a new occupant of the "declared · no parser" quadrant beside READABILITY | Add to the grid |
| 14 | `review-report.md` "declares BUDGET, an ESCALATE SCOPE clause and READABILITY — and no GRAMMAR block" | STALE | Also AUDIENCE (`Coverage=audit; Boundary check=audit`) and VERIFY ROUND; still no block labelled GRAMMAR | Update list |
| 15 | `parseReviewReport` binds by header not filename; last `**Verdict:**` is live; engine routes on it; verdict count reconciled against `review_rounds`; cap decides when a fourth round escalates | OK | `derive.ts` D4 with `ROUND_CAP = 3`; `review.verdicts.length` reconciled | — |
| 16 | Same | MISSING-NEWER | A resolved round-cap escalation now grants one more round (#342); a reviewer `escalate` verdict's resolution can carry a `disposition` (`re-review`, `return-to-implement`, `re-plan`) that routes the next step (#189/#190) | Optional |
| 17 | "Three contracts declare the same five-rule set" | STALE | Four (release-plan added) | Update |
| 18 | Five READABILITY rules (a)–(e) as quoted | OK | Verbatim in spec/plan/verification-report/release-plan | — |
| 19 | Coverage rules quoted: "(b) Then one bullet per area checked; terse 'R1-R3 ✓'-style entries are the proven shape. Never chain areas into a paragraph — any paragraph over 120 words is in breach" | WRONG | Rule (b) now reads: "Then the Coverage table (shape below): one row per requirement or area checked. The table is the shape — a bullet list or a paragraph in its place is in breach. Cites live in the Where column, one location per row; the Mechanism column says what was checked in a clause, never a chain of clauses." The 120-word clause is gone. Rule (c) is now scoped "on first use in the opening sentence" | Requote all three rules |
| 20 | "In their place it prescribes a shape — one bullet per area — and turns the 120-word figure … into an outright breach" | WRONG | The prescribed shape is a four-column table (Requirement / Where / Mechanism checked / Status); a bullet list is itself a breach | Rewrite paragraph |
| 21 | "so its contract demands the list and forbids the paragraph" | WRONG | Demands the table, forbids both list and paragraph | Rewrite |
| 22 | Spec breach "bounced like a grammar deviation"; review "bounced like a malformed finding" | OK | Both verbatim | — |
| 23 | AGENTS.md summary sentence is accurate for the five-rule set and "not true of Coverage" | OK | AGENTS.md still says "plain-words opening sentence, one idea per paragraph, lists instead of semicolon chains, name before cite" | — |
| 24 | `validateArtifact` derives sections from the target repo's `contracts/*.md` at the default branch by ref; `BUILTIN_SECTIONS` fallback docblock "at the time of writing" | OK | `local-source.ts` templates read `git.show(defaultBranch, contracts/<name>)`; docblock verbatim | Path only |
| 25 | Normalization: lowercase, non-alphanumeric runs → single space | OK | `normalize` | — |
| 26 | `PROFILE_GATES`/`PROFILE_PHASES` mirror DESIGN.md §4.1; `runStateSchema` requires the profile's gates; surplus tolerated; absent profile → full; passthrough | OK | `schema.ts` | — |
| 27 | Case 1 spec "should carry four sections" (Context, Requirements, Assumptions, Out of scope) | OK | `contracts/spec.md` H2s | — |
| 28 | Case 1 example: "`agentic new` on an existing slug" | STALE | `gateline new` | Rename |
| 29 | D7 subject `state(<slug>): bounced spec.md — re-dispatching analyst (missing: Context)` | OK | `engine.ts` verbatim template | — |
| 30 | "On the third malformed delivery the bounce cap is reached … D8" | OK | `BOUNCE_CAP = 2`; newer: the count resets when the D8 dispute is resolved (#348) | Add the reset |
| 31 | "it never reads a section's body" | STALE | For `verification-report.md` the validator now also reads the `**Verdict:**` lines (#152) and reports `Verdict: pass \| fail \| escalate` as missing when the last one is not exactly one of the three words | Narrow the claim to markdown sections; note the one body check |
| 32 | Validator result consumed by the engine only for producer artifacts (spec, plan, work items, verification report, release plan); reviewer not among them; malformed review with `Verdict: approve` still advances | OK | `bounceOrEscalate` call sites in `producerPhase`/`planPhase`; D16 records verdicts unconditionally; D24 additionally reads the verification verdict only when its validation is `ok` | — |
| 33 | Frontend: "Packet malformed — bounced, not reviewable" with the missing section named | OK | `readiness.ts` verbatim | — |
| 34 | Case 2: `requirementNames` accepts em dash or hyphen, exactly three hashes; `R_HEADING` any level, em dash only | OK | `/^###\s+(R\d+)\s*[—-]\s*…/` vs `/^#{1,6}\s*R(\d+)\s+—\s+…/` | — |
| 35 | Unparsed criterion cited by the record is marked "defined nowhere" | OK | `CriterionEvidence.defined: false` | — |
| 36 | Maintainer note: mdtoc "no D7 bounce was exercised"; dupefind "three runs, zero D7 bounces — bounce handling remains fixture-only evidence" | OK | Both verbatim in the retros | — |
| 37 | Check-your-understanding Q1 "the one shape the template shows that no code ever reads" | WRONG | No such shape remains in review-report.md (F<n> is parsed). The answer that is true now is release-plan's preamble fields | Re-aim the question |
| 38 | Further reading "`contracts/` — nine files" | STALE | Ten | Update |
| 39 | "Nearly every scanner here skips fenced code blocks" | OK | Newer: `record/sections.ts` `FenceTracker` (#217) reads fences per CommonMark for validation and Gatehouse folding; lexicon/evidence still toggle on any ``` line | Optional |
| 40 | Grid entry "required ## sections — validate.ts" | OK | Now via `sections.ts` `h2Headings` | — |
| 41 | "escalate waits for a human" | OK | D17 | — |
| 42 | Grid rows "READABILITY (a)–(c) review-report.md — three different rules" | STALE | Still three rules, but (b) is now the table rule | Requote |

Visible-text retired names: lines 102 and 384 (`frontend/packages/...`), 433 (`agentic new`).

### Newer facts the page should now reflect

- Ten contracts; `release-plan.md` has a contract, GRAMMAR, BUDGET and READABILITY, and its GRAMMAR (preamble fields) has no parser — the cleanest current example of "declared normative, no code behind it".
- `AUDIENCE:` is a fifth rule family, parsed (`extractAudience`), and is contract meaning, not a UI setting (AGENTS.md invariant).
- `review-report.md`'s Coverage is a **table** now; the VERIFY ROUND block declares a disposition grammar (`- **F<n> — resolved|stands** — …`) that tooling reads.
- `packages/core/src/view-model/review.ts` (`parseReview`, #214) parses findings, severities, rounds and dispositions; the two-by-two grid's "convention only" cell must be redrawn.
- `verification-report.md` declares an overall `**Verdict:**` line; `validate.ts` `verdictLines`/`verificationVerdict` is the one parser shared by the orchestrator (`verification-report.ts`, D24) and Gatehouse, and the validator bounces a verdict line that is not exactly one of the three words.
- Bounce budget is per dispute (#348).
- `sections.ts` `FenceTracker` is the CommonMark-correct fence reader used by validation and folding.

---

## Retired / renamed names — every occurrence

Replacement key: `frontend/packages/…` → `packages/…`; `refs/agentic/wip/` → `refs/gateline/wip/`; `agentic` (CLI) → `gateline`; `agentic-orchestrator <orchestrator@agentic.invalid>` → `gateline-orchestrator <orchestrator@gateline.invalid>`. No occurrence of `@agentic/`, `.agentic/`, `render-agents.py`, `integrate.py`, `agentic-sandbox`, `FleetView`, or `ADS` was found in any of the four files (head, nav, or content).

| Page | Line | Occurrence | Visible? | Replacement |
|---|---|---|---|---|
| index.html | — | none | — | — |
| git-plumbing.html | 39 | `frontend/packages/core/src/sources/git.ts` | yes | `packages/core/src/sources/git.ts` |
| git-plumbing.html | 590 | `frontend/packages/core/src/sources/git.ts` | yes | same |
| git-plumbing.html | 250 | `refs/agentic/wip/<branch>` | yes | `refs/gateline/wip/<branch>` |
| git-plumbing.html | 534 | `refs/agentic/wip/*` | yes | `refs/gateline/wip/*` |
| git-plumbing.html | 43, 54, 229, 238, 254, 262, 317, 326, 332, 344, 376, 404, 413, 435, 444, 450, 459, 500, 507, 536, 547, 558, 566 | `frontend/packages/…` in `<!-- evidence: -->` comments (30 path tokens on 23 lines) | no | strip `frontend/` |
| the-co-written-state-file.html | 33 | "the `agentic` CLI" | yes | "the `gateline` CLI" |
| the-co-written-state-file.html | 111, 550, 552 | `frontend/packages/core/src/record/actions.ts`, `…/sources/local-source.ts` | yes | strip `frontend/` |
| the-co-written-state-file.html | 258, 271 | SVG label `refs/agentic/wip/<branch>` | yes | `refs/gateline/wip/<branch>` |
| the-co-written-state-file.html | 480–481 | `agentic-orchestrator <orchestrator@agentic.invalid>` | yes | `gateline-orchestrator <orchestrator@gateline.invalid>` (note old name persists in finished runs) |
| the-co-written-state-file.html | 493 | exercise output `70 agentic-orchestrator` | yes | keep — it is the actual output; add a note |
| the-co-written-state-file.html | 91, 97, 105, 118, 126, 134, 141, 152, 336, 344, 354, 425, 464, 472, 514, 526 | `frontend/packages/…` in evidence comments (25 path tokens) | no | strip `frontend/` |
| contracts-and-their-parsers.html | 102 | `frontend/packages/core/src/view-model/lexicon.ts` | yes | strip `frontend/` |
| contracts-and-their-parsers.html | 384 | `frontend/packages/core/src/record/validate.ts` | yes | strip `frontend/` |
| contracts-and-their-parsers.html | 433 | "`agentic new` on an existing slug" | yes | `gateline new` |
| contracts-and-their-parsers.html | 49, 109, 120, 279, 289, 300, 384, 389, 397, 411, 464, 473, 482, 491, 508, 517 | `frontend/packages/…` in evidence comments (32 path tokens) | no | strip `frontend/` |

Also worth noting for the evidence maps: `.work/onboarding-evidence.md` states "All paths are relative to the pre-rename checkout path" — the repo is now `the framework checkout`.

---

## Exercise tally

9 exercises, 9 PASS (5 in module 1, 4 in module 2). Every command runs as written against the current repo and every expected-output block is byte-identical, including pinned object ids. The one caveat is cosmetic: module 2 exercise 4's output shows the historical bot author `agentic-orchestrator`, which remains correct because finished runs are never rewritten.

## Summary counts

| Page | Claims | OK | STALE | WRONG | UNVERIFIABLE | MISSING-NEWER | Visible retired names |
|---|---|---|---|---|---|---|---|
| index.html | 7 | 7 | 0 | 0 | 0 | 0 | 0 |
| git-plumbing.html | 45 | 35 | 6 | 2 | 0 | 2 | 4 (+30 hidden path tokens) |
| the-co-written-state-file.html | 40 | 30 | 5 | 3 | 0 | 2 | 9 (+25 hidden) |
| contracts-and-their-parsers.html | 42 | 22 | 9 | 8 | 0 | 3 | 3 (+32 hidden) |

## The five most consequential findings

1. **The "one parser" thesis is false (modules 1 and 2).** `parseLedgerSubject` in `packages/core/src/view-model/ledger.ts` (#268) parses every state commit subject for Gatehouse's decision ledger. The lesson survives in a sharper form — nothing that *decides* reads a subject — but three passages, one figure caption and two check-your-understanding questions state the old absolute.
2. **Module 3's Coverage section is now wrong in every particular.** `contracts/review-report.md` rule (b) mandates a four-column table; the "one bullet per area" shape and the "120-word breach" clause are gone. Three paragraphs and a check-your-understanding question need requoting.
3. **The "read by nothing" finding shape is parsed.** `packages/core/src/view-model/review.ts` (#214) reads `### F<n>` headings, severities, rounds and dispositions, and VERIFY ROUND declares the disposition grammar normative. The two-by-two grid's "convention only" cell is empty; the "declared but unparsed" cell has a new occupant (release-plan's GRAMMAR preamble fields), which is the better teaching example now.
4. **Ten contracts, not nine.** `release-plan.md` has a contract, GRAMMAR, BUDGET and READABILITY, and `contractFor` returns it — five explicit counts and the "no contract back from contractFor" list are wrong. `AUDIENCE:` is a fifth, parsed rule family the page does not know.
5. **Module 2's "not committed" claim about session ids is inverted.** Ledger entries carry `session` (#181) and `engine: host:pid` (#349); ORCHESTRATOR.md §4.4 now draws the handle/session distinction explicitly. Related: launch waits on origin accepting the intent push (#103), not just the local CAS.

Renames (`refs/gateline/wip/`, `gateline` CLI, `gateline-orchestrator` identity, `packages/` paths) are mechanical: 16 visible occurrences plus 87 hidden path tokens across the three module pages.
