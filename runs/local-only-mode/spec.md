# Specification: Local-only as a first-class mode

## Context

Local-only operation already works today as an emergent property of a three-layer
`push` resolution — CLI `--no-push` → per-source config `push:` → the
`pushWhenOriginExists()` origin auto-detect in
`frontend/packages/core/src/view-model/config.ts` — not as a named mode. All three
gaps the intent brief cites are confirmed in the checked-out code: `ensureDraftPr`
(`frontend/packages/core/src/sources/pr-ensure.ts`) gates on `remote.origin.url` and
whether the branch is already on origin, never on the `push` flag, so `--no-push` on
a repo with an origin and a previously pushed branch still opens a draft PR; the CLI
`sync` command (`frontend/packages/cli/src/main.ts:647-675`) wires
`GhCliProvider.approval` (`frontend/packages/core/src/sources/sync.ts:90-110`) with
no try/catch, so a remoteless repo's rejected `gh pr list` propagates as an uncaught
throw instead of a clean report; and `docs/TOPOLOGY.md` §3.1 claims "the orchestrator
refuses `--push` without a sync provider," but neither `EngineConfig`
(`frontend/packages/orchestrator/src/engine.ts`) nor the `up` command
(`main.ts:679-771`) has any such guard or sync-provider concept at all. A fourth,
unnamed gap surfaces from the same reading: the engine's heartbeat `syncFromRemote`
(`engine.ts:165-171`) and the server's per-source interval sync
(`frontend/packages/server/src/main.ts:76-92`) both always issue `git fetch origin`
even on a remoteless clone, tolerating the resulting failure rather than skipping the
attempt — at odds with the brief's "no fetch against origin is attempted"
constraint. `agentic up` already logs an informal `local-only` vs `pushing to origin`
marker keyed off the `push` boolean (`main.ts:771`), the closest existing precedent
for the named mode this run introduces. The webhook's own PR-review sync
(`frontend/packages/server/src/webhook.ts`) already self-skips without a configured
secret and belongs to the hosted topology the brief marks out of scope, so it needs
no separate suppression work here.

## Requirements

### R1 — Local-only is a named mode, not a parallel code path
A local-only designator resolves onto the existing `push` boolean and its existing
precedence chain (explicit setting > per-source config > origin auto-detect); it
adds no second resolution mechanism.

**Acceptance criteria:**
- [ ] AC1.1 — A repo with no remote and no explicit setting still resolves local-only via the existing `pushWhenOriginExists` auto-detect (trigger condition unchanged), and wherever the resolved mode is surfaced (startup log, error text) it is nameable as `local-only`, not merely inferable from `push === false`.
- [ ] AC1.2 — An explicit local-only designator, settable via CLI flag and via per-source config (mirroring `push`'s existing two explicit tiers), overrides origin auto-detect exactly as `--no-push`/`push:false` does today — demonstrated on a repo with a live origin, where enabling it still suppresses push.
- [ ] AC1.3 — `push` precedence when local-only is not requested is unchanged: explicit `--push`/`push:true` still overrides auto-detect, and bare auto-detect still governs otherwise — regression-checked against `frontend/packages/core/test/divergence.test.ts`'s existing cases (lines 72-113).

### R2 — Local-only suppresses all origin-directed network egress
No `git push`, no `gh`/GitHub API call, and no `git fetch` against `origin` ever
runs while local-only mode is active, at every existing call site.

**Acceptance criteria:**
- [ ] AC2.1 — With local-only mode active, a decision write against a repo with a live origin leaves origin's tip unchanged — no `git push` subprocess runs (extends the existing `push:false` ceiling case, `divergence.test.ts` lines 90-102, to the named mode).
- [ ] AC2.2 — With local-only mode active, `ensureDraftPr`'s suppression covers both call sites — the engine's first-dispatch ensure (`engine.ts:458`) and `agentic arm` (`main.ts:630`) — including the brief's leak case (origin exists, branch already pushed before local-only was requested): each call returns `status: 'skipped'` with a note, and the injected `ExecLike` spy (the seam `pr-ensure.test.ts` already uses) records zero `gh` invocations. Whether the guard lives in `pr-ensure.ts` or at each caller is the Architect's call, recorded as an ADR.
- [ ] AC2.3 — With local-only mode active, the PR-approval sync provider (`GhCliProvider.approval`, `sync.ts:90-110`) is never constructed or called; `planSync`'s caller short-circuits first with a logged note, verified by a provider spy recording zero calls.
- [ ] AC2.4 — With local-only mode active, no `git fetch` against `origin` is attempted by either the engine's heartbeat `syncFromRemote` (`engine.ts:165-171`) or the server's per-source interval sync (`server/src/main.ts:76-92`) — a spy on the git-run seam shows zero `fetch` invocations, not merely a caught failure as happens today on a bare remoteless clone.

### R3 — `agentic sync` reports cleanly under local-only
`agentic sync` never throws when local-only mode applies; it reports that there is
nothing to sync and exits cleanly, including on a repo with no `origin` remote at
all (today's actual throw case).

**Acceptance criteria:**
- [ ] AC3.1 — Running `agentic sync` against a source resolved to local-only mode prints the literal `local-only: nothing to sync` and exits 0, making zero `gh` calls — including when no `origin` remote is configured, where today `GhCliProvider.approval`'s uncaught `gh pr list` rejection propagates out of `planSync` as a thrown error.
- [ ] AC3.2 — The same holds with `--live` passed: no state writes occur, exit 0.

### R4 — Conflicting `--push` is rejected at startup; the resolved mode is logged unambiguously
Local-only combined with an explicit request to push is refused before anything
starts, and every resolution path is stated in plain text in the startup log.

**Acceptance criteria:**
- [ ] AC4.1 — Requesting local-only mode together with an explicit `--push` (CLI) or `push: true` (per-source config) on the same source fails at startup with a distinct, named error — non-zero exit, no engine or server started — rather than silently resolving one over the other.
- [ ] AC4.2 — `agentic up`'s startup log line states the resolved mode unambiguously for every resolution path (explicit local-only, explicit push, auto-detect), extending the existing `local-only`/`pushing to origin` marker at `main.ts:771` so the log text alone answers "will this run touch origin?" without reading code.

### R5 — `docs/TOPOLOGY.md` §3.1 is reconciled with actual `--push`-without-sync-provider behavior
The doc's claimed startup refusal either exists in code or the doc no longer claims
it; the two do not contradict each other after this run.

**Acceptance criteria:**
- [ ] AC5.1 — Either a startup guard refusing `--push` without a sync provider is added to the orchestrator/`up` command and exercised by a test, or `docs/TOPOLOGY.md` §3.1's sentence is edited to no longer claim a guard that doesn't exist — one of the two, with the choice recorded as an ADR in this run's plan.
- [ ] AC5.2 — After the change, no doc under `docs/` makes a claim about `--push`-without-sync-provider behavior that the actual `up`/engine startup code contradicts.

### R6 — Local-only documented as a supported, first-class topology
An adopter can find local-only named and explained in the docs, with the hosted
boundary stated explicitly.

**Acceptance criteria:**
- [ ] AC6.1 — `docs/ORCHESTRATOR.md` and/or `docs/TOPOLOGY.md` gains a section naming local-only as a supported, first-class topology — not merely inferable from `--no-push` — stating its guarantees (no push, no `gh`/GitHub API calls, no origin fetch) per R2.
- [ ] AC6.2 — That section states the boundary explicitly: the `deploy/` hosted entrypoint (`PUSH_DECISIONS`, the GitHub webhook) legitimately requires a remote and is out of scope, with at most a cross-reference from `docs/DEPLOY.md`.

### R7 — Test coverage extended, hosted push path unregressed
The remoteless test file gains coverage of the two closed leaks; existing hosted
push-path coverage stays green.

**Acceptance criteria:**
- [ ] AC7.1 — `frontend/packages/core/test/divergence.test.ts` gains cases covering the PR-ensure short-circuit (the brief's leak case: origin exists, branch previously pushed, local-only requested) and the sync short-circuit (remoteless `agentic sync`) described in R2/R3.
- [ ] AC7.2 — `npm test` in `frontend/` passes in full, including the existing hosted-push-path cases in `divergence.test.ts` (lines 72-114, 134-211), `pr-ensure.test.ts`, and `sync.test.ts` — no regression.

### R8 — No changes to `roles/` or `contracts/`
This run stays inside the seam it names and hardens; agent-facing role/contract
definitions are untouched.

**Acceptance criteria:**
- [ ] AC8.1 — `git diff main...HEAD -- roles/ contracts/` (this run's branch against `main`) is empty at verification time.

## Assumptions

- **ASSUMPTION:** the brief doesn't name the literal CLI flag or config key for the local-only designator → resolved as: left to the Architect as an implementation decision, recorded as an ADR, because the brief frames this as "one switch" without naming it and this contract separates *what* (Analyst) from *how* (Architect).
- **ASSUMPTION:** the brief's precedence text ("config `push:`/mode") implies the designator is settable per-source in `~/.config/agentic/config.yaml`, not only as a process-wide CLI flag on `agentic up` → resolved as: it must be expressible at both the CLI-flag and per-source-config tiers, mirroring `push`'s existing precedence exactly (R1.2), because that's the only reading consistent with the brief's own precedence chain.
- **ASSUMPTION:** "rejected at startup with a named error" (R4) doesn't say which entry points enforce the push+local-only conflict → resolved as: the check lives in `loadSources`, the one seam every CLI command and `up` share, so the conflict is caught regardless of which command reads the config first.
- **ASSUMPTION:** "review sync" in the brief's suppression list refers to the webhook's PR-review sync (`server/src/webhook.ts`), which already self-skips without a configured secret and belongs to the hosted topology the brief marks out of scope → resolved as: no separate suppression logic is required there; R2 covers only the CLI `sync` command's `planSync`/`GhCliProvider` path.

## Out of scope

- The `deploy/` hosted topology (entrypoint, `PUSH_DECISIONS`, the GitHub webhook): it legitimately requires a remote; at most a `docs/DEPLOY.md` cross-reference to the new mode (R6.2).
- Any new sync-provider or remote-abstraction layer — this run names and hardens the existing seam, it does not generalize it.
- Non-GitHub forge support (GitLab et al.); local-only simply never reaches forge code.
- FleetView UI treatment of local-only sources beyond whatever the existing badges already show (ahead/behind "not knowable" rendering is untouched).
- The webhook's PR-review sync (`server/src/webhook.ts`) — already self-skips without a configured secret; see the "review sync" Assumption above.
- A second, independent resolution mechanism for local-only that bypasses the existing `push` precedence chain (R1) — any implementation that duplicates rather than resolves onto that chain is out of scope.
