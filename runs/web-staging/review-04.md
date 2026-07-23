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
