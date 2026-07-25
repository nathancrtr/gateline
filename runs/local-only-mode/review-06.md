# Review Report: 06-docs-topology

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** commit a68b706 (branch `run/local-only-mode`)

## Findings

### F1 — blocking — §3.6 tier 4 misstates auto-detect: "an origin exists → push mode" is false for two of the three entry points the section claims to cover
- **Where:** `docs/TOPOLOGY.md:182-183`
- **Failure scenario:** an operator lists a source in config with an origin
  and no `push:` key, reads tier 4, and expects push mode; `resolveMode`
  gives `push = false` for non-CLI tiers
  (`frontend/packages/core/src/view-model/config.ts:116`, plan table rule 3:
  "`false` for config-file entries") — the read-only poller, so their
  decisions silently never reach origin. Same for the standalone binary
  without `--push` (`frontend/packages/orchestrator/src/start.ts:73`,
  ADR-7's "explicit `--push` default-off semantics"). Only zero-config CLI
  sources get `push = originExists`. The doc's own §3.1 rewrite (line 85)
  names three postures — pushing, polling read-only, off — so "push mode"
  here cannot be read as merely "not local-only"; §3.6's own poller
  paragraph (lines 192-196) contradicts tier 4 as written.
- **Requirement:** AC6.1 — the task scope requires "the resolution tiers
  exactly as implemented (plan table)"; tier 4 collapses table rule 2d
  (local-only auto-detect, correct) with rule 3's push default (wrong).
  Fix is one clause: origin auto-detect decides *local-only*; whether a
  non-local-only source then *pushes* follows the push default for its
  tier (CLI auto-detect pushes; config entries and the standalone binary
  stay no-push unless explicit).

### F2 — minor — §3.6 intro attributes the standalone binary's resolution to `loadSources`; the binary never calls it
- **Where:** `docs/TOPOLOGY.md:165-169`
- **Failure scenario:** an adopter tracing the binary's mode resolution
  greps `loadSources` call sites under `frontend/packages/orchestrator/`
  and finds none — the conflict check and auto-detect are duplicated in
  `start.ts:69-73` (plan ADR-5: `assembleOrchestrator` "never calls
  `loadSources`"). Semantics match the normative table, so no behavior is
  misstated — only the code-location claim ("there is no second resolution
  mechanism" as a statement about code, not semantics) is wrong.
- **Requirement:** AC6.1 (accuracy of the section against the code); R1's
  "no second resolution mechanism" is spec language about the precedence
  chain, which the doc converts into a false single-call-site claim.

### F3 — minor — DEPLOY.md:210 still claims `--push` by default for `agentic up`; pre-existing, disclosed, outside this task's cap
- **Where:** `docs/DEPLOY.md:210`
- **Failure scenario:** an operator on a remoteless clone reads "the same
  hard lines (`--push` by default)", expects hosted-parity pushing, gets
  local-only (`resolveUpMode`, auto-detect). Predates this run; the task
  capped DEPLOY.md at a one-line cross-reference, so the implementer's
  disclose-don't-fix call is correct and AC5.2's literal scope
  (`--push`-without-sync-provider claims) is not violated. Needs a
  follow-up task, not a fix in this one.
- **Requirement:** none violated here; residual doc/code divergence for
  the maintainer to queue.

## Coverage

I verified every doc claim in the diff directly against the merged code and found everything clean except the three findings above.

- AC5.1 ✓ — the §3.1 phantom-guard sentence is gone; the replacement
  matches ADR-6 and the code (no guard, no "sync provider" object in the
  `up` startup path).
- AC5.2 ✓ — re-ran `grep -rni "push" docs/`: the only "sync provider" hit
  is §3.1's own negation; all other push mentions are historical incident
  narration, hosted-only accurate claims (`PUSH_DECISIONS`, entrypoint
  `--push` at DEPLOY.md:243), §3.2's multi-writer-scoped push-then-launch,
  or the new section — with the one pre-existing exception in F3.
- AC6.1 tiers 1-3 ✓ — conflict throw, designator precedence, explicit-push
  precedence, and the CLI-only `--no-push` rule all match `resolveMode`
  (config.ts:105-111); tier 4's local-only half matches; its push half is F1.
- AC6.1 alias ✓ — `--no-push` resolves to full local-only at the CLI tier
  only (config.ts:110, cli/main.ts:742); config `push: false` with an
  origin stays a fetching poller (ADR-2); the binary has `--push`/
  `--local-only` and no `--no-push` (orchestrator/main.ts:40-43), as stated.
- AC6.1 guarantees ✓ — push forced false (config.ts:114,
  local-source.ts:73-74); `ensureDraftPr` short-circuits first (pr-
  ensure.ts:41) at both call sites (engine.ts:465, cli/main.ts:631-632);
  `planSyncForSource` never invokes the provider factory (sync.ts:66);
  `syncFromRemote` returns first under the flag (local-source.ts:111) and
  the server also skips with its own line (server/main.ts:86-87).
- AC6.1 conflict/markers ✓ — `LocalOnlyPushConflictError` named and thrown
  (config.ts:49-52,105; start.ts:69); `up` resolves before starting
  anything and exits 1 on it (cli/main.ts:777-793); all five marker
  literals and `local-only: nothing to sync` match the code exactly
  (cli/main.ts:671,713-720).
- AC6.2 ✓ — §3.6 states the deploy/ hosted boundary (`PUSH_DECISIONS`,
  webhook, `REPO_URL`); DEPLOY.md gained one sentence, a cross-reference
  within the spec's "at most a cross-reference" budget.
- ORCHESTRATOR.md §4.3 ✓ — the rescoped paragraph is accurate: both
  writers still commit locally under local-only, neither pushes, origin is
  never fetched.
- Implementer's disclosed DEPLOY.md discovery ✓ — judged correct to leave
  unfixed (F3).

## Boundary check

Doc edits touch exactly the declared surface: `docs/TOPOLOGY.md`,
`docs/ORCHESTRATOR.md`, `docs/DEPLOY.md`. The commit also appends the
implementer's round-1 `notes:` block to
`runs/local-only-mode/tasks/06-docs-topology.yaml` — standard run-record
bookkeeping, not a surface violation. No code, `roles/`, or `contracts/`
changes (R8 intact on this diff).

## Round 2

**Verdict:** approve
**Round:** 2 of 3
**Diff reviewed:** commit b68018f (branch `run/local-only-mode`)

### Prior findings

- **F1 — resolved.** Rewritten tier 4 (`docs/TOPOLOGY.md:186-194`) now
  separates the two decisions exactly as the code does: auto-detect sets
  *local-only* only (config.ts:111 `localOnly = !originExists`;
  start.ts:72), and the push default follows rule 3's per-tier split
  (config.ts:116 `push = cliTier ? await originExists() : false`;
  start.ts:73 `push = localOnly ? false : opts.push`, falsy when `--push`
  is unset). The round-1 mutant — a config-entry operator with an origin
  and no `push:` key expecting push mode — now reads the correct answer
  ("config-file entries and the standalone binary default `push` to
  `false` even with an origin present"). Tier 4 no longer contradicts the
  poller paragraph (TOPOLOGY.md:203-207); the `#149` cite matches
  config.ts:66-74.
- **F2 — resolved.** The intro (`docs/TOPOLOGY.md:165-173`) now says
  `agentic up` and per-source config resolve through `resolveMode` via
  `loadSources`, and that the binary never calls `loadSources` —
  `assembleOrchestrator` repeats the conflict check and auto-detect
  itself. Verified: zero `loadSources` references under
  `frontend/packages/orchestrator/src/` outside start.ts comments;
  `loadSources` callers are cli/main.ts:64,782 and server/main.ts:54; the
  binary's flags are `--push`/`--local-only` (orchestrator/main.ts:40-43).
  The round-1 mutant (grep for the binary's `loadSources` call site finds
  nothing) no longer survives.
- **F3 — n/a, correctly left alone.** `docs/DEPLOY.md:210` unchanged, as
  round 1 concluded it should be (pre-existing, outside the one-line
  DEPLOY.md cap, no requirement violated); the discovery note for the
  maintainer stands in the task file.

### New findings

None.

## Coverage (round 2)

I re-verified every rewritten claim against the code and re-checked the untouched remainder of §3.6 and the four acceptance tests; everything is clean.

- Tier 4 vs code ✓ — both halves of the rewrite match `resolveMode`
  (config.ts:107-116) and the binary path (start.ts:69-73); "tiers below
  hold for both" holds for the binary's tier-1 conflict, tier-2
  designator, tier-3 explicit push, and tier-4 auto-detect.
- Intro vs code ✓ — two call sites, one table, as stated (F2 above).
- §3.6 internal consistency ✓ — the `--no-push` alias paragraph, poller
  paragraph, guarantees, markers, and hosted-boundary paragraph are
  untouched by this diff and now agree with tier 4 instead of
  contradicting it.
- AC5.1 ✓ — §3.1 untouched in round 2; the round-1 verification stands.
- AC5.2 ✓ — re-ran the sweep: the only "sync provider" hit in `docs/` is
  §3.1's own negation; the new tier-4 push claims are accurate, no new
  contradictions.
- AC6.1 ✓ — the tiers now state the resolution exactly as implemented;
  alias, guarantees, and markers unchanged from the round-1-verified text.
- AC6.2 ✓ — boundary paragraph and the one-line DEPLOY.md cross-reference
  unchanged.

## Boundary check (round 2)

Commit b68018f touches `docs/TOPOLOGY.md` (in surface) and appends the
implementer's round-2 `notes:` block to
`runs/local-only-mode/tasks/06-docs-topology.yaml` — run-record
bookkeeping, consistent with round 1's treatment. No other files; no code,
`roles/`, or `contracts/` changes.
