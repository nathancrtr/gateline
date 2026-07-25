# Release Plan: runner-agent

<!-- No contracts/release-plan.md exists in this repo yet (checked; only
     runs/README.md and roles/ops.md name this file's placement and required
     content). Structured per roles/ops.md's dispatch list (deployment steps
     in order, ordering constraints, health signals, rollback with trigger
     conditions) and docs/DESIGN.md's G3 description, in the section style
     the sibling contracts (verification-report.md, docs-delta.md) use. Worth
     a maintainer follow-up to add contracts/release-plan.md itself — this is
     the first non-fixture run to reach G3 (issue #69). -->

**Change verified:** `run/runner-agent` at `8f868b3` (PR #176, base `main`
at `aec22f98`) — G2 approved 2026-07-25T01:46:45Z; see
`runs/runner-agent/verification-report.md`.
**Environment:** local (darwin), Node v26.3.0, npm 10 — re-ran the CI
pipeline's own steps fresh for this plan (see CI Health); GitHub Actions
itself is currently unable to run (see below).

## Summary

**Not ready to merge or deploy today.** This plan documents two independent
blockers discovered while assessing release readiness, neither of which Ops
can fix directly (one is an account-level billing issue, the other is
application code requiring an architect/implementer reconciliation), plus
the deployment sequence, health signals, and rollback procedure to use once
both clear. The shipped mechanism itself is opt-in and unreachable from
every current entrypoint, which is the load-bearing fact behind this plan's
low blast-radius and rollback story — see Reversibility.

## CI health

**GitHub Actions is down repo-wide, for a reason unrelated to this change.**
Every workflow run on every branch — `run/runner-agent`, `main`, and
unrelated branches (`run/local-only-mode`, `escalation-replan`,
`worktree-reviewer-escalate-forward-gap`) — has failed within 2-3 seconds
since 2026-07-24T04:30:05Z (confirmed continuing through the most recent
push to `main` at 2026-07-25T01:48:54Z, ~21 hours). The job annotation is
identical on every run:

```
$ gh run view 30139237198 --repo nathancrtr/agentic-sandbox
X The job was not started because recent account payments have failed or
  your spending limit needs to be increased. Please check the 'Billing &
  plans' section in your settings
```

This is a GitHub account billing block, not a test or build failure — it
predates this change, affects `main` identically, and is outside anything
this repository's config controls. Per the ops role's rule ("CI red for
reasons unrelated to this change → escalate; don't work around it"), I did
not attempt a workaround. I substituted independent, fresh local runs of the
same steps `frontend-ci.yml`'s `test` job runs, against the current branch
HEAD:

```
$ cd frontend && npm ci --no-audit --no-fund
added 236 packages in 3s

$ npm run typecheck
> tsc -p tsconfig.json && tsc -p packages/web/tsconfig.json
(clean, exit 0)

$ npm test
 Test Files  47 passed | 2 skipped (49)
      Tests  469 passed | 2 skipped (471)
   Duration  190.13s
(the 2 skipped are the opt-in real-spend live-smoke tests, gated off by default)

$ npm run build
✓ built in 2.68s
```

This matches the verifier's own evidence (`verification-report.md`) and
extends it with a fresh, independent run for this plan. The `e2e`
(Playwright) job was not independently re-run here: this change touches
`frontend/packages/orchestrator`, `frontend/packages/server`, and the new
`frontend/packages/runner-agent` only — no file under `packages/web` — so
e2e risk is low, but it remains unverified by an actual pipeline run because
none can currently execute. **Recommendation: resolve the GitHub Actions
billing block (account settings, outside this repo) before treating any
branch's CI status — including `main`'s — as trustworthy again; this is
pipeline debt independent of this run and blocks more than this release.**

## Merge readiness (blocking)

**PR #176 is not mergeable: `main` has diverged with a real, non-mechanical
conflict.** Seven PRs landed on `main` after this branch's base commit
(`aec22f98`); `git merge-tree` against current `main` (`1f8270c`) reports:

```
$ git merge-tree --write-tree origin/run/runner-agent origin/main
CONFLICT (content): Merge conflict in frontend/packages/orchestrator/src/engine.ts
CONFLICT (add/add): Merge conflict in frontend/packages/orchestrator/test/harvest.test.ts
CONFLICT (content): Merge conflict in frontend/packages/server/src/main.ts
```

**`server/src/main.ts` — mechanical, low-risk.** Both sides add adjacent,
non-overlapping blocks: `main`'s `run/local-only-mode` merge (#175) adds a
`localOnly` option; this run adds `runnerCallback`/`runnerApi` wiring a few
lines away. A straightforward rebase resolution (keep both blocks) is
expected to be safe.

**`engine.ts` + `harvest.test.ts` — a real design collision, not a text
conflict.** `main`'s `orchestrator: harvest-commit for shell-less roles`
(#182/#183, merged 2026-07-23T13:30, i.e. *after* this branch's base but
*before* this run's own task 04 round 3 ADR-8 amendment) independently
solves the problem this run's ADR-8 solves — "rescue a role's own artifacts
before the checkout is torn down" — with a **private, non-exported**
`harvestPathspecs(runsRoot, slug, role, task)` inside `engine.ts`, mapping
role → pathspec identically to this run's own (exported, shared)
`harvest.ts` module: analyst → `spec.md`, architect → `plan.md`+`tasks/`,
reviewer → `review-*.md`, verifier → `verification-report.md`, ops →
`release-plan.md`. Both branches independently created a test file at the
identical path `frontend/packages/orchestrator/test/harvest.test.ts` (an
add/add conflict) testing two different things — `main`'s exercises the
private in-engine harvest-commit end to end via `Engine`; this run's tests
the standalone exported function.

This is more than duplicated code. `engine.ts`'s `launch()` on `main` adds
`} else if (outcome.ok) { <local harvest-commit> }` immediately after the
dispatch's own success check; this run's ADR-8 adds `} else if
(managesOwnWorkspace && outcome.harvest) { <fold the remote harvest branch>
}` at the *same* branch point. A naive conflict resolution that simply
chains both `else if` arms risks a `managesOwnWorkspace` dispatch (which
sets `checkout = null` and a placeholder `cwd` of `this.cfg.repoDir` — the
control plane's own live clone, never a throwaway checkout) falling through
into `main`'s harvest-commit, which runs `git status`/`git add`/`git commit`
against whatever `cwd` it's given. That would mean an accidental commit
attempt against the engine's own canonical repo clone rather than a
dispatch-scoped checkout — a correctness/safety bug, not a lint issue.

This needs an architect- or implementer-level reconciliation: most likely,
unify on the one shared `harvest.ts` module (have `main`'s private function
call the shared export instead of duplicating it), merge the two
`harvest.test.ts` suites without losing either's coverage, and re-verify
`launch()`'s branching makes the two paths mutually exclusive by
construction, not by convention. That is an application-code change, which
per the ops role I do not make myself — **this is the finding I am
escalating**, not something this release plan resolves. Recorded here as
the primary blocking precondition below.

**PR housekeeping.** PR #176's title/description still read `[WIP]` /
"Status: work in progress, not ready to merge", written before G1's redo,
before task 04-06 landed, and before G2 approval. This should be refreshed
before merge — routine, not itself blocking.

## Deployment steps

### Phase 0 — Preconditions (must complete before Phase 1)

1. Restore GitHub Actions billing so CI can run again (account settings;
   outside this repository).
2. Reconcile the harvest-mechanism duplication between `main` (#182/#183)
   and this run (ADR-8) — see Merge readiness. Scope: unify the pathspec
   mapping on one shared implementation, resolve the `harvest.test.ts`
   add/add conflict without losing either suite's coverage, and prove
   `launch()`'s local-harvest-commit and remote-harvest-fold branches are
   mutually exclusive (a `managesOwnWorkspace` outcome must never reach the
   local harvest-commit code path). This is application code — route it as
   a G2-adjacent escalation/follow-on task, not an Ops fix.
3. Rebase `run/runner-agent` onto the post-reconciliation `main` (the
   `server/main.ts` conflict resolves mechanically at the same time), then
   re-run the full pipeline (`npm ci && npm run typecheck && npm test &&
   npm run build`, plus Playwright e2e) against the rebased HEAD. Treat this
   as a fresh check, not a formality — the CI Health and Merge Readiness
   evidence above is against pre-rebase HEAD (`8f868b3`), and the
   reconciliation in step 2 touches reviewed, G2-approved code
   (`engine.ts`'s `launch()`); the human should decide whether that
   reconciliation warrants a targeted reviewer pass before G3 stands.
4. Update PR #176's title and description to drop the stale `[WIP]` framing.

### Phase 1 — Merge (the release act)

5. Merge PR #176 into `main` (squash, matching this repo's existing
   convention for run branches — e.g. `1f8270c`, `f5bc0e6`) once Phase 0 is
   complete and CI is green on the rebased branch.
6. No further action is required for this step to be safe: no current
   entrypoint enables the runner path (confirmed by reading
   `frontend/packages/orchestrator/src/main.ts`,
   `frontend/packages/server/src/main.ts`, and `deploy/entrypoint.sh` — none
   sets `OrchestratorOptions.runner`, constructs a `runnerCallback`, or sets
   `RUNNER_TOKEN`). Merging changes zero observed behavior for any consumer
   — self-hosted `agentic up`/`agentic-orchestrator watch`, or the hosted
   FleetView Docker image. See Reversibility.

### Phase 2 — Out of this run's scope (named, not scheduled here)

7. Actually exercising the runner-agent mechanism in a real deployment
   requires wiring work this run explicitly did not do: threading
   `runner.enabled` and a `runnerCallback` into a real entrypoint, setting
   `RUNNER_TOKEN` on the control-plane server, and running the new
   `agentic-runner-agent` binary on a workstation
   (`--control-plane <url> --token <token> --adapter <name>`). Tracked by
   the topology epic (#107) / issue #106's remaining scope; review-05.md's
   round-1 observations name the same gap. A future run's own release plan
   should cover its health signals (agent liveness, harvest-push failures,
   fold conflicts) — none of that applies here because nothing reaches this
   code path yet.

## Ordering constraints

- No database or schema migration: this framework's only state is git refs
  plus YAML/Markdown files in the pipeline repo. This run adds optional
  fields to existing shapes (`budget.ledger[].adapter: 'runner'`,
  `DispatchOutcome.harvest`) but nothing can emit them until Phase 2's
  wiring exists, so there is no backfill and no migration step.
- Phase 0 steps are strictly sequential preconditions for Phase 1 — do not
  merge (step 5) before the reconciliation (step 2) and rebase-revalidation
  (step 3) land; do not treat this plan's CI evidence as still valid after
  step 2's reconciliation diff exists without re-running step 3.
- No feature-flag rollout sequencing is needed for the merge itself:
  `runner.enabled`, `RUNNER_TOKEN`, and the new CLI binary are independently
  inert until Phase 2, and nothing in Phase 1 depends on their order.

## Health signals to watch after rollout

The merge itself is "dark" (see Reversibility), so most of what would
normally be post-rollout monitoring collapses to: confirm nothing changed.

- CI green on `main` after the merge commit (`frontend-ci`: typecheck,
  test, build; `deploy-image`: container build + smoke test) — currently
  unobservable until the billing block clears (CI Health); until then,
  `npm run typecheck && npm test` locally against `main`'s tip is the
  available substitute.
- No new shape appears in any run's `budget.ledger[]` — specifically no
  `adapter: 'runner'` entries anywhere — until an operator has deliberately
  completed Phase 2. If one appears without that wiring having been done
  intentionally, treat it as a signal something unexpected dispatched
  through the new path.
- Any live orchestrator instance (self-hosted or the hosted FleetView image
  with `ORCH_ENABLED=1`) continues writing its heartbeat and metering
  dispatches exactly as before upgrading to a post-merge commit — the
  reconciled `launch()` (Phase 0 step 2) is the one piece of this change
  that runs on every dispatch, flag or not, so this is the signal that
  actually matters.
- FleetView's ledger/run-detail rendering for any run continues to render
  correctly post-merge — a quick manual look is enough; nothing in
  `packages/web` needs a code change for this release, but it is the one
  place a new (currently unreachable) `adapter` value or `harvest` field
  could eventually surface, worth a glance once Phase 2 exists.

## Rollback procedure

**Trigger conditions:**

- CI on `main` (once the billing block clears) fails against the merge
  commit, or a fresh commit after it, for a reason attributable to this
  change rather than the pre-existing billing issue.
- A regression appears in a shared surface this change touches that is live
  regardless of `runner.enabled` — `seam.ts`'s interfaces, or (post-Phase-0)
  `engine.ts`'s reconciled `launch()` — e.g. an ordinary `HeadlessDispatcher`
  dispatch metering wrong, committing to the wrong place, or a task fold
  conflicting where it did not before.
- The Phase 0 reconciliation itself regresses `main`'s already-shipping
  #182 behavior (a shell-less role's artifact stops landing, or double-
  commits).

**Mechanism:**

- Primary: `git revert` the squash-merge commit on `main`. Caution specific
  to this change: if Phase 0's reconciliation touched `main`'s #182
  harvest-commit code directly (the expected resolution), a single-commit
  revert of this release risks reverting past #182's own fix too —
  resurfacing the original bug it exists to prevent (a shell-less role's
  work destroyed by `removeRunCheckout`'s force-remove). Whoever carries out
  the revert should check whether the reconciliation commit needs to be
  reverted separately from, or partially preserved against, this release's
  revert — that judgment depends on a reconciliation diff that does not
  exist yet, so it cannot be resolved further here.
- Hosted deployment: if the Docker image had been rebuilt from a post-merge
  commit, `fly deploy` from the pre-merge (or reverted) checkout restores
  it — the volume/clone is untouched by an image change (`docs/DEPLOY.md`'s
  existing Upgrades/Recovery notes cover this generically; nothing
  runner-agent-specific is needed).
- Self-hosted `agentic up` / `agentic-orchestrator watch` operators: check
  out the pre-merge commit (or pull the revert) and restart — the existing
  self-supersede/restart discipline (`ORCHESTRATOR.md` §13, `docs/DEPLOY.md`
  "Merge-updates") already covers this path; no runner-agent-specific
  handling is needed because nothing in this change creates persistent
  runtime state to unwind (no registration, no queue, no migration).
- No data migration to roll back: state is git refs, so a revert is an
  ordinary forward commit that every reader (FleetView, CLI, orchestrator)
  converges on the same way it would any other revert.

**Rollback exercised?** No, and it cannot be meaningfully exercised yet.
There is no pre-production environment separate from `main` to rehearse
against — this is a source-consumed framework repository, and the one
hosted instance `docs/DEPLOY.md` describes is single-user/production, not a
staging deployment — and the change has not merged (see Merge readiness), so
there is nothing to revert from today. **Recommendation:** once Phase 0
lands, rehearse the revert on a scratch branch (create the squash-merge
commit there, `git revert` it, re-run the full suite) before relying on the
mechanism for real. This is a cheap, git-only rehearsal that needs no live
deployment, and it directly tests the caution named above once a real
reconciliation diff exists to test it against.

## Reversibility

The load-bearing property of this release is that it ships **dark**: the
entire remote-dispatch mechanism — `RemoteDispatcher`, the runner-agent
binary, the `/api/runner/*` routes — is reachable only if an operator writes
new wiring code this run deliberately left undone (Phase 2). I confirmed
this by reading every existing entrypoint (`agentic-orchestrator`'s
`main.ts`, `@agentic/server`'s `main.ts`, `deploy/entrypoint.sh`) rather than
taking the plan's own claim on faith: none constructs a `runnerCallback`,
sets `runner.enabled`, or sets `RUNNER_TOKEN`. That gives this change the
same practical reversibility a feature flag would, without needing one, for
everything except the one shared surface (`launch()`) Phase 0's
reconciliation touches — which is exactly why that reconciliation, not the
merge itself, is this plan's real risk surface.

There is no canary or staged rollout available for this repository beyond
the single hosted FleetView instance `docs/DEPLOY.md` describes, and that
instance will not observe this change at all unless the operator later does
the Phase 2 wiring by hand. Stating plainly, per the role's requirement to
name this when the project doesn't support it: there is no rollout to
stage — the release event is a single merge to `main`, followed, at the
operator's own later discretion, by a Docker rebuild or an `agentic up`
restart that picks up the new (still-inert) code.
