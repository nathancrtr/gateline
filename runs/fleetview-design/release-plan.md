# Release Plan: fleetview-design

<!-- `contracts/release-plan.md` does not exist in this repository (checked;
     `contracts/` has no file by that name, though `roles/ops.md`,
     `docs/DESIGN.md`, `docs/FRONTEND-PLAN.md`, and `runs/README.md` all
     reference it as the G3 artifact). This document follows roles/ops.md's
     explicit dispatch requirements (deployment steps in order, ordering
     constraints, health signals, rollback procedure + trigger conditions)
     and borrows verification-report.md's evidence-block convention in the
     absence of a real template. Flagging the missing contract file itself
     as a framework gap in the report-back, separate from this run's
     blocking finding below. -->

**Change assessed:** branch `run/fleetview-design` @ `aba516b` (open draft PR
[#212](https://github.com/nathancrtr/agentic-sandbox/pull/212), base `main`).
**Environment:** local read-only assessment (`git`, `gh`) — no build/deploy
executed, because the release-readiness finding below blocks it before that
step is reachable.

## Release readiness: **NOT READY — blocking finding, escalating to G3**

This run's own diff is verification-clean (G2 approved; see
`verification-report.md`), but the *target it would release into* has moved
in a way that makes proceeding wrong, not just risky. Summary, evidence
below:

1. **This exact run already shipped once.** `run/fleetview-design` was
   previously opened as PR #153 and squash-merged to `main` as `e1614b8` on
   2026-07-22T01:19:47Z (E1, E2). Its `styles.css` carries the `.pulse-glow`
   / `.pulse-panel` keyframes that are this run's actual selected-and-built
   candidate B ("Signal Deck") signature, per `verification-report.md` E20/E23
   (E3) — i.e., this run's work is already live history on `main`, not new.
2. **`main` has since been restyled again, independently.** PR #197
   (`991f773`, merged 2026-07-25T05:41:44Z) — run `gate-redesign`, "warm-paper
   palette, serif reading surface, lifted cards" — touches the identical file
   surface (`app.tsx`, `chips.tsx`, `inbox.tsx`, `portfolio.tsx`, `run.tsx`,
   `styles.css`) a second time (E4).
3. **Consequence:** deploying this branch now would not add anything — it
   would *revert* the currently-live UI (the 2026-07-25 redesign) back to the
   restyle this same run already shipped three days earlier. GitHub confirms
   this isn't a clean fast-forward: PR #212 reports `mergeable: CONFLICTING`,
   `mergeStateStatus: DIRTY` (E5), and `git merge-tree` reproduces real
   content conflicts in exactly those six files, plus an **add/add conflict
   on the run's own `state.yaml`** — `main` already carries a finished copy
   of it from the first merge (E6).
4. **The revert would also undo today's rebrand.** `59d6c12` (#211, merged
   2026-07-26) retired the FleetView/ADS names: the shipped masthead on `main`
   now reads **Gatehouse**. This branch's `app.tsx` — one of the six
   conflicting files — still renders `Gate` (E8). So the regression isn't only
   stylistic; landing this branch's side of that conflict un-ships a
   same-day naming decision. (The web sources carry no literal `FleetView`
   string, so this is the only brand surface at risk — but it reinforces
   option (a): the run's own product name no longer exists.)
5. **No CI has run against the current merge target.** PR #212's
   `statusCheckRollup` is empty (E5) — it was only opened at
   2026-07-26T23:14:36Z, the same minute as this dispatch. The last green CI
   for this branch's content is from the *first* merge cycle, superseded by
   points 1-3 (E7).
6. The framework's own auto-generated PR body for #212 already carries the
   guard: *"⚠️ Run in flight — do not merge. ... Merging now lands an
   incomplete run record and leaves the run with no review surface."*

Picking which of three now-competing redesigns is "the" shipped UI is a
product decision, and reconciling this branch against two rounds of
intervening history is git surgery this role isn't positioned to do
unilaterally (rewriting a `run/*` branch's content to match a different,
later design is not a pipeline/infra change in scope for Ops, and no G0/G1
re-scoping has happened to authorize it). Per `roles/ops.md`, "nothing
deploys before G3 approval" — this stops at G3, not before it: it's the human
call the gate exists for.

**Recommended options for the G3 approver** (not Ops's call to make):
- **(a) Close this run as already-delivered/superseded.** The work shipped
  once (2026-07-22); treat this continuation as done and retire the branch/PR
  without a second deploy. Worth a short framework note on the duplicate-slug
  reuse (a fresh `run/*` slug per attempt would have caught this
  mechanically instead of at G3).
- **(b) Re-scope.** If a specific piece of this run isn't present in the
  2026-07-25 redesign and is still wanted (e.g., the portfolio zero-runs
  empty state, R1/AC6.3 — worth checking against `gate-redesign`'s
  `candidate-*` output), cut a fresh run rebased on current `main` rather than
  reconciling this branch's conflicts by hand.
- **(c)** Any other resolution the human decides — Ops will execute
  deployment mechanics against whatever the resolved target turns out to be,
  once G3 is reached on a mergeable change.

The mechanics below describe how a release *would* proceed once this is
resolved; none of it has been executed.

## Deployment steps (once unblocked)

No database/schema migrations are in scope — this is a frontend-only SPA
restyle (`AC5.4`/`AC6.3`: no `packages/core|server|cli|orchestrator` diff, no
new routes/endpoints beyond the portfolio zero-runs render branch). Ordering:

1. Confirm `frontend-ci` and `deploy-image` are green on the actual resolved
   merge commit on `main` (not this branch in isolation — E5/E7 above are why
   that distinction matters here specifically).
2. `fly deploy` from the operator's own `fly.toml` (gitignored, instance
   config — `docs/DEPLOY.md`). This rebuilds `deploy/Dockerfile` (server + the
   built SPA + git + cloudflared) and rolls the app's machine(s).
3. `fly secrets set TUNNEL_TOKEN=...` only if the tunnel token is rotating;
   otherwise no secret changes are implied by this diff (no new env var, no
   config surface added).
4. `fly scale count 1` is a standing invariant here, not a step to redo —
   the volume holding the git clone is single-writer; do not scale beyond 1.
5. Post-deploy smoke (manual, or scripted against the tunneled URL): masthead
   renders, inbox/portfolio/metrics/run screens load, a gate decision's SSE
   live-update still lands (the ref watcher — unrelated to this diff's scope
   but the one thing a restyle could silently break via a stray class/DOM
   change).

## Reversibility

This recipe has **no canary, staged rollout, or blue/green** — Fly's
single-machine, single-writer-volume topology (`docs/DEPLOY.md`) means every
deploy replaces the running instance directly. The cost of that: a bad deploy
is visible to every user of that instance simultaneously, with no
progressive-exposure backstop. What *is* reversible: **the repo is the only
state** (`docs/DEPLOY.md`'s own framing) — the volume holds nothing but a git
clone, so rolling the image back loses no data; worst case is a re-clone on
next boot.

## Health signals to watch after rollout

- `GET /api/health` (the same endpoint `deploy-image.yml`'s CI smoke test
  polls) — reachability plus the "source healthy" check.
- Cloudflare Tunnel connection status (container binds loopback-only behind
  it; a dead tunnel means totally unreachable, not degraded).
- Browser console/network errors on the four restyled screens (inbox,
  portfolio, metrics, run — this diff's actual surface).
- SSE ref-watcher liveness — a decision recorded elsewhere should appear live
  without a manual refresh.
- The `AC6.4` CAS-409 path specifically (`verification-report.md` E23): a
  decision race should re-present, never silently drop or double-commit.

## Rollback procedure

**Trigger conditions:** `/api/health` failing or absent, tunnel not
connecting, a blank/broken screen on any of the four restyled pages, SSE
updates stopping, or a regression in the keyboard model / CAS-409 re-present
behavior that `verification-report.md` AC5.3/AC6.4 established as the floor.

**Procedure:**
1. `fly releases list` to identify the prior good release/image.
2. `fly deploy --image <previous-good-image-ref>` (or `git revert` the
   merge commit on `main` and `fly deploy` from that revert) — either path is
   safe because the container's volume carries no state of its own beyond the
   git clone (`docs/DEPLOY.md`, "the repo is the only state").
3. Re-run the health-signal checklist above against the rolled-back instance
   before considering the incident closed.

## Rollback exercised?

**No.** `docs/DEPLOY.md` documents exactly one deployment tier — the
operator's own hosted single-user instance (Fly.io, uncommitted `fly.toml`)
— plus `deploy-image.yml`'s CI smoke test against an ephemeral, scratch-repo
container. There is no pre-production/staging tier in this repo's deploy
recipe to rehearse a real `fly deploy --image <prior>` rollback against
without touching the operator's actual instance. This is a standing G3
consideration independent of this run's blocking finding: a repeat-release
project this size would benefit from a second, disposable Fly app (or a
scripted local-Docker rollback drill against the CI smoke harness) so
rollback is proven before it's needed rather than the first time it's
needed. Flagging it here rather than deploying to production to test it.

## Evidence

### E1 — this run already merged once (PR #153)
```
$ gh pr list --head run/fleetview-design --state all --json number,title,state,mergedAt,url
[{"mergedAt":null,"number":212,"state":"OPEN", ...},
 {"mergedAt":"2026-07-22T01:19:47Z","number":153,"state":"MERGED",
  "title":"fleetview-design: \"The Ledger\" restyle of the gate frontend", ...}]
```

### E2 — the merge commit is an ancestor of `origin/main`
```
$ git log --oneline fb22431..origin/main -- frontend/packages/web/src/...
59d6c12 Retire FleetView and ADS: ...
991f773 frontend: redesign the gate dashboard — warm-paper palette ... (#197)
...
e1614b8 fleetview-design: "The Ledger" restyle of the gate frontend (#153)
...
```
(`fb22431` = this branch's merge-base with `main`.)

### E3 — the merged content matches this run's actual build, not the PR title
```
$ git show e1614b8:frontend/packages/web/src/styles.css | grep -iE "pulse|serif|ledger"
--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', ...
@keyframes pulse {
@keyframes pulsepanel {
.pulse-glow { animation: pulse 2.4s ease-in-out infinite; ... }
.pulse-panel { animation: pulsepanel 2.8s ease-in-out infinite; ... }
```
`.pulse-glow`/`.pulse-panel` are candidate B ("Signal Deck")'s signature per
`verification-report.md` E20/E23 — the PR #153 title/body ("candidate A, The
Ledger") does not match what actually shipped; a labeling error in the PR
description, not a content one.

### E4 — `main` was restyled again, independently, after that merge
```
$ git show 991f773 --stat | head -12
frontend: redesign the gate dashboard — warm-paper palette, serif reading
surface, lifted cards (#197)
 frontend/packages/web/src/app.tsx                  |   30 +-
 frontend/packages/web/src/components/chips.tsx     |  111 +-
 frontend/packages/web/src/pages/inbox.tsx          |  210 ++-
 frontend/packages/web/src/pages/portfolio.tsx      |  198 ++-
 frontend/packages/web/src/pages/run.tsx            |  369 +++--
 frontend/packages/web/src/styles.css               |  311 ++--
 runs/gate-redesign/... (three new candidates, brief.md)
```

### E5 — the open PR for this branch cannot merge cleanly, and has no CI yet
```
$ gh pr view 212 --json mergeable,mergeStateStatus,statusCheckRollup,body
{
  "mergeable": "CONFLICTING",
  "mergeStateStatus": "DIRTY",
  "statusCheckRollup": [],
  "body": "...⚠️ Run in flight — do not merge. phase `release` · gates G0 ✓ G1 ✓ G2 ✓ G3 · ..."
}
```

### E6 — reproduced locally: real content conflicts, not a stale-ref artifact
```
$ git merge-tree --write-tree run/fleetview-design origin/main
...
Auto-merging frontend/packages/web/src/app.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/app.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/components/chips.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/pages/inbox.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/pages/portfolio.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/pages/run.tsx
CONFLICT (content): Merge conflict in frontend/packages/web/src/styles.css
CONFLICT (add/add): Merge conflict in runs/fleetview-design/state.yaml
```

### E7 — last CI run for this branch predates both the merge and the re-merge conflict
```
$ gh run list --branch run/fleetview-design --limit 3
completed  success  fleetview-design: "The Ledger" restyle ...  frontend-ci    ... 2026-07-22T01:17:25Z
completed  success  fleetview-design: "The Ledger" restyle ...  deploy-image   ... 2026-07-22T01:17:25Z
completed  success  fleetview-design: "The Ledger" restyle ...  Rendered ...   ... 2026-07-22T01:17:25Z
```
All from the PR #153 cycle; nothing has run for PR #212's current diff.

### E8 — the masthead brand differs: `main` ships Gatehouse, this branch ships Gate
```
$ git show origin/main:frontend/packages/web/src/app.tsx | grep -n 'text-ink">Gate'
132:  <span className="font-sans ... text-ink">Gatehouse</span>
157:  <span className="font-sans ... text-ink">Gatehouse</span>

$ git show HEAD:frontend/packages/web/src/app.tsx | grep -n 'Gate<'
115:  <span className="font-mono ... tracking-[0.16em]">Gate</span>
132:  <span className="mr-2 font-mono ... tracking-[0.16em]">Gate</span>

$ git grep -in fleetview HEAD -- frontend/packages/web/src   # (no matches)
```
`59d6c12` (#211, 2026-07-26) is the commit that made `main` say Gatehouse.
