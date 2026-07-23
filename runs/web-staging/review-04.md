# Review Report: 04-web-staging-form

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit e18c620 (run/web-staging)

## Findings

### F1 — major — `pushFailed` on a created outcome is silently dropped: the form navigates away and never renders it
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:137-142` (vs the plan's Web API client contract, plan.md:129; `api.ts:210` faithfully passes it through)
- **Failure scenario:** hosted deploy (DEPLOY.md model), origin push fails after the local commit — server returns 201 with `pushFailed` per the task-03 contract; `onSuccess` fires `navigate()` on the same tick, so neither the (already-dead) ok Flash nor any warning renders. Operator believes the record replicated; the remote never got `run/<slug>`.
- **Requirement:** plan "Web API client" contract (the type carries `pushFailed` precisely so the form can show it); ux A5 (silent failure).

### F2 — major — budget values the planner rejects are submitted anyway and degrade to an unmetered run
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:102-103` (NaN→null coercion), `:133` (`ready` ignores `scaffoldError`), `:157` (request)
- **Failure scenario:** budget `1e999` → `Number()` gives `Infinity` → the live preview shows `planRunScaffold`'s ScaffoldError, but submit stays enabled; `JSON.stringify` serializes `Infinity` as `null`, so the server stages the run with `cost_limit_usd: null` — the operator typed a ceiling and got an unmetered run, silently. (Same shape: the explicit `Number.isNaN → null` coercion; and a negative budget, e.g. `-50`, stages as-is.) Contradicts the candidate's disabled-with-reason submit and ux P5 (prevent client-side what the client can know — here the client literally computed the error).
- **Requirement:** R1/AC1.2 record integrity in spirit; design/genesis-preview 02 (submit disabled with reason); ux P5.

### F3 — major — a `conflict` refusal renders under the "Refused — slug taken." headline with a link to a run that may not exist
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:207-215`
- **Failure scenario:** point Gate at a fresh source whose default branch has no commits (reachable: `local-source.ts:418` returns `reason: 'conflict'`, message "default branch … has no commits to stage against") → the form headlines it "slug taken" and offers "Open the existing `<slug>`" — a dead link and a misdiagnosed cause. The verbatim server message below mitigates but the taxonomy members are collapsed, and the CAS-race `conflict` (`local-source.ts:439`) loses its re-present posture (ux P6/REC7(c) vs REC11).
- **Requirement:** R8/AC8.2 rendering half (name the *existing* branch — only true for `slug-taken`); ux A5 (taxonomy collapse).

### F4 — minor — the preview's author line renders a dangling label, never the identity, and its conditional is keyed on the wrong field
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:543-546`
- **Failure scenario:** any valid title+slug → `scaffold.clientKey` is always the session UUID, so the line always reads "author & committer" with no name/email — the design candidate's author-line-in-the-preview (its argued REC9 deviation: identity display mandatory in the record panel) never appears there; clientKey presence has nothing to do with author-vs-committer.
- **Requirement:** design/genesis-preview thesis + mockup 02 (author line from the server's git identity).

### F5 — minor — the slug grammar is re-duplicated as a local literal, the exact drift task 01 just paid to remove from the CLI
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:16`
- **Failure scenario:** core's `SLUG_PATTERN` changes → this fallback silently diverges. Practically shielded (config gates rendering, so the server-supplied pattern is in force whenever the form is interactive), and the file already value-imports from `@agentic/core/record`, where `SLUG_PATTERN` lives one named export away.
- **Requirement:** plan move 1 / ADR-3's single-truth rationale (drift hazard, not a live defect).

### F6 — minor (PLAUSIBLE) — multi-source: the picker preselects the first source, so staging can proceed without a deliberate pick
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:71-74`, `:258-266`
- **Failure scenario:** two sources configured; operator never touches the Repository select; submit is enabled and the record lands in whichever source is listed first. AC1.3's "requires picking one before staging" is met only under the ask-vs-don't-ask reading — which the G1-approved mockup itself endorses (`design/genesis-preview/02-staging-form.html:203` shows the first option preselected), so this is flagged for G2 visibility, not as an implementer deviation.
- **Requirement:** R1/AC1.3 (strict reading).

## Coverage

Checked clean against the spec: the brief editor (AC2.1) renders one initially-empty
textarea per config-supplied section with headings as fixed chrome and
instructive-only placeholders — no prefilled prose anywhere, and no model or
completion call exists (AC2.3: I ran the spec's grep over
`frontend/packages/{server,web}/src` — zero matches at all, the implementer's
"left blank" rewording held). Intake (AC3.1/AC3.2) is exactly three plain text
inputs plus a session-generated `crypto.randomUUID()` client key that is displayed
but never typed; the AC3.2 grep's only hits are the pre-existing
`linear-gradient` lines in `styles.css`, untouched by this diff. Attribution
(AC4.2 form half) has no name field; identity renders read-only from config, and
the identity-null case shows the red config strip while leaving refusal to the
server per ux REC9/REC7(d). The nav (AC7.1) is untouched — `main.tsx` gains only
the `portfolio/new` child route, `app.tsx` is not in the diff. The replay outcome
(AC8.1 rendering half) uses a bordered informational tone visually disjoint from
both ok and bad, says "not an error," and links the run; the genuine `slug-taken`
refusal names the branch via the server's verbatim message (AC8.2 — see F3 for
the `conflict` sibling). The five-outcome taxonomy plus a network-error case all
render locally in `new-run.tsx`; `decide.tsx` is untouched as task 05 requires.
The missing-sections refusal implements ux REC6 correctly: `role="alert"` summary,
focus moved via effect, entries anchor-linked to sections, identical wording
between summary links and inline text, server message quoted verbatim; the local
pre-check only disables submit and openly defers to server wording. The API
client matches the plan's interface contract shape exactly (refusals resolve as
values carrying reason/message/missing/status; only network/unparseable bodies
throw ApiError), and I cross-checked it against the since-landed task-03 route
bodies — created/exists/refused shapes and statuses line up. The ADR-6 exception
comment in `api.ts` is present and accurate (the file itself stays type-only; the
value import of `planRunScaffold` lives in the page, and core's `./record`
subpath export exists). Preview honesty holds where it matters: the preview
passes the same slug/profile/briefMarkdown/intake the request sends
(`planRunScaffold` trims title internally, so the raw-vs-trimmed title difference
cannot diverge the files).

Static typecheck hazards were audited by hand since `frontend/node_modules` is
absent in this checkout (noted per dispatch, not installed): `verbatimModuleSyntax`
type-only imports are correct, every index access under `noUncheckedIndexedAccess`
is `?? ''`-guarded or narrowed, `PageStatus` is exported from `inbox.tsx`, and the
`React.ReactNode` UMD-in-type-position usage has precedent in `decide.tsx`. Gap:
the task's own "typecheck && build pass" acceptance rests on the implementer's
report plus this static audit — G2 should see a green CI run. One cosmetic note:
`@agentic/core` sits in web's `devDependencies` while now being a bundled runtime
import — harmless for a private Vite-bundled app. The implementer's round-notes
claim that task 01's exports "don't exist in this tree yet" is stale — commit
c9383c5 is an ancestor of e18c620 — but harmless, since the form correctly takes
the slug pattern as data per ADR-6. Navigation on success invalidates queries
before navigating (unawaited, but invalidation marks synchronously and the run
query is fresh-keyed). Concurrency beyond the client-key replay path was not
assessed — nothing else in this surface is concurrent.

## Boundary check

Clean. `git show --stat e18c620` lists exactly the four files in the task's
`file_contact_surface` (`api.ts`, `main.tsx`, `pages/new-run.tsx`,
`pages/portfolio.tsx`) plus the implementer's round-notes append to its own task
file — the sanctioned report-back channel, not a surface breach. Tasks 01 and 02
are ancestors of this commit, and `git log e18c620..HEAD -- frontend/` at review
time contained no frontend commits, so the diff bounds this task's changes alone.
`decide.tsx`, `chips.tsx`, and `app.tsx` (other tasks' surfaces) are untouched.

---

# Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit 6409073 (run/web-staging) — `frontend/packages/web/src/pages/new-run.tsx` + the implementer's round-notes append to its own task file

## Prior-finding resolution

- **F1 — resolved.** `new-run.tsx:169` gates `navigate()` on `!result.pushFailed`; the ok Flash is now `created && !pushFailed` (`:215`) and a `created && pushFailed` warn Flash (`:226-240`) names the local commit/branch, quotes the push error verbatim, states the remote never received `run/<slug>`, and offers a manual continue link. Mutant check: a 201-with-`pushFailed` response now renders and stays put — the round-1 silent-navigate is dead. Copy verified against `core/src/sources/local-source.ts:447-449` (push threw → remote ref not updated → "commit is local only" is accurate).
- **F2 — resolved.** The NaN→null coercion is gone: `:113` carries the raw parse, `:114` flags non-finite (catches `1e999`→Infinity and NaN) and negative, `:133-134` sets `scaffoldError` before the planner runs, `:156` adds `!scaffoldError` to `ready`, and `submit()` (`:178`) checks `ready` — so Infinity can never reach `JSON.stringify`, and a negative can never stage as-is. `submitHint:197` and `border-bad`/`min="0"` (`:423-426`) surface the reason. The `< 0` client check is load-bearing: core's planner only checks finiteness (`scaffold.ts:60`), so I confirmed no path around `ready` exists in the form.
- **F3 — resolved.** `conflict` no longer shares the slug-taken branch: `:252-259` is `slug-taken`-only (headline + existing-branch link intact per AC8.2), `:268-277` gives `conflict` its own re-present warn Flash quoting the server message verbatim, no link — matching the `decide.tsx:294` 409 precedent (tone and `role="status"` both). Residual copy nit recorded as F7 below.
- **F4 — resolved.** `RecordPreview` takes `identity` (`:554`, typed to match `api.ts:100`) and renders `<name> <email> — author & committer` when present (`:609-614`) or a `text-bad` "(no identity configured)" line when null (`:616`). The always-true `clientKey` conditional is gone.
- **F5 — resolved.** `:11` imports `SLUG_PATTERN` from `@agentic/core/record`; `:20` aliases it as the fallback. Verified it exists as a string export at this commit (`core/src/record/scaffold.ts:41`), so both `new RegExp(slugPattern)` (`:101`) and the interpolation in `submitHint` stay type-correct.
- **F6 — intentionally deferred**, as round 1's own note directed: `:72-78` still preselect the first source, `:320-342` unchanged. Stands for G2 to weigh AC1.3's strict reading against the G1-approved mockup's preselect.

## Findings

### F7 — minor — the conflict Flash's fixed caption "Not a slug collision" contradicts the CAS-race sibling it also renders
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:273` (vs `core/src/sources/local-source.ts:439`)
- **Failure scenario:** lost CAS race → the quoted server line reads "`run/<slug>` appeared concurrently — re-check and retry" while the caption directly below asserts "Not a slug collision" — the two sentences contradict; the operator resubmits (as instructed) and only then gets the accurate `slug-taken`/`exists` rendering. Self-correcting, cosmetic; the verbatim server message dominates.
- **Requirement:** R8/AC8.2 spirit (taxonomy honesty); ux A5.

### F8 — minor (PLAUSIBLE) — browser badInput still stages an unmetered run when the operator types a non-numeric ceiling
- **Where:** `frontend/packages/web/src/pages/new-run.tsx:113-114`, `:420-427`
- **Failure scenario:** Firefox (which accepts arbitrary text in `type="number"`), operator types `$50` → the DOM reports `value=''` (badInput), so React's `budget` stays `''` → `costLimitUsd` null, `budgetInvalid` false, submit enabled → run stages unmetered while the field visibly holds "$50". F2's cited shapes (1e999, negative, NaN-from-parse) are all closed; this residual needs `ValidityState.badInput` to detect and is browser-dependent — PLAUSIBLE, not blocking.
- **Requirement:** ux P5 (same silent-degradation shape as F2, one detection layer deeper).

## Coverage

The round-2 delta is confined to the five fixes plus their supporting seams, and each
seam checked clean: the new `warn` Flash tone maps to CSS tokens that exist
(`--color-warn`/`--color-warn-soft`, `styles.css:18,23`) and matches the tone
`decide.tsx` already uses for its 409; `pushFailed` is `string | undefined` end-to-end
(`api.ts:124`, `:210`) so the ok/warn split on truthiness cannot double-render; the
warn Flash's `source.id` use sits below the `!source` early-return (`:192`), so no
null deref; the `identity` prop type matches `StagingSourceConfig` exactly. Re-ran the
spec's wording-guard greps over the committed tree (`git grep` at 6409073, both AC2.3
and AC3.2 targets): AC2.3 zero matches; AC3.2's only hits remain the two pre-existing
`styles.css` gradient lines — the implementer's "incomplete→partial" reword held.
The budget fix keeps preview honesty: an invalid budget never reaches
`planRunScaffold`, and the same `costLimitUsd` value feeds preview and request.
Requirement coverage from round 1 (AC2.1/AC2.3/AC3.1/AC3.2/AC4.2-form/AC7.1/AC8.1)
is untouched by this delta — the diff adds no input, no route change, no new prose
into the brief path.

Verification gap for G2: the task's "typecheck && build pass" acceptance is
*undemonstrated* this round — the implementer's own notes report both failing in
their checkout on a `chips.tsx` kind-lookup error. My static read of the tree at
6409073 says that error does not exist in the committed state (task 05's landed
round-1 commit 66b2fae handles `kind === 'staged'` at `chips.tsx:55`, and core's
`InboxKind` includes `'staged'` at `readiness.ts:31` — the failure came from the
implementer's working-tree contamination, not this commit), and the round-2 delta
itself introduces no typecheck hazard I can find (string-typed `SLUG_PATTERN`,
matching prop types, valid tone-union extension). But that is a hand audit twice
over now — G2 should see a green CI run on this commit before approving. The
reported orchestrator vitest timeouts are outside this task's surface and
reproduced as CPU contention per the implementer's solo re-run; not re-verified
here (dispatch: git only).

## Boundary check

Clean. `git show --stat 6409073` lists exactly `pages/new-run.tsx` (in the task's
`file_contact_surface`) and the implementer's round-notes append to its own task
file — the sanctioned report-back channel. The five working-tree modifications
present at review time (`chips.tsx`, `decide.tsx`, `inbox.tsx`, `new-run.tsx`,
`run.tsx`) are task 05's uncommitted work, outside this diff and ignored per
dispatch. Commits between e18c620 and 6409073 belong to tasks 03/05 and state
bookkeeping — none are part of the reviewed range.
