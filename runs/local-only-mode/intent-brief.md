# Intent Brief: Local-only as a first-class mode

<!-- Drafted from issue #174 (background session, 2026-07-22) at Nathan
     Carter's direction; staging is the draft act — arming is the human
     confirmation. Source survey: the #174 issue body. -->

## Profile

standard

## Problem

Local-only operation — no pushes, no PRs, no GitHub code paths — works today
but only emergently: it falls out of a three-layer resolution (CLI `--no-push`
flag → per-source config `push:` → origin-exists auto-detect in
`pushWhenOriginExists()`) rather than being a named, discoverable mode. Three
gaps make the emergent behavior leaky: `ensureDraftPr()` keys off origin
existence rather than the push flag, so `--no-push` on a repo with an origin
and a previously pushed run branch can still open a draft PR; `agentic sync`
throws on a remoteless repo instead of reporting there is nothing to sync;
and `docs/TOPOLOGY.md` §3.1 claims the orchestrator refuses `--push` without
a sync provider, but no such guard exists in code. No doc blesses remoteless
operation as a supported topology — the closest surfaces are
`PUSH_DECISIONS=false` in DEPLOY.md (framed as a degraded hosted config) and
WALKTHROUGH.md (implicitly remoteless, never says so).

## Motivation

Adopters evaluating the framework should be able to run it against a plain
local repository — no remote, no GitHub account, no risk of anything leaving
the machine — with one switch whose semantics they can state without reading
three code paths. The plumbing is already ~90% there (every `git push` is
guarded by one boolean, the state.yaml CAS is local-ref based, GitHub paths
self-skip), so this run is mostly about naming the mode, closing the three
leaks, and reconciling the docs. Issue #174 is the brief's source of record;
closing it is in scope.

## Constraints

- One named mode, not a parallel code path: the mode setting resolves the
  existing `push` boolean plus the new suppressions. A repo with no remote
  must map onto the same mode via the existing auto-detect, and the existing
  precedence holds (explicit flag > config `push:`/mode > origin auto-detect).
- In local-only mode: no `git push` ever runs, no `gh` or GitHub API call
  ever runs (draft-PR ensure, sync provider, review sync all short-circuit
  with a logged note), and no fetch against origin is attempted.
- `ensureDraftPr` suppression must cover both call sites (engine first-
  dispatch ensure and `agentic arm`) — decide whether the guard lives in
  `pr-ensure.ts` or at the callers, and record it as an ADR.
- `agentic sync` in local-only mode reports "local-only: nothing to sync"
  and exits cleanly instead of throwing.
- `--push` (or `push: true`) combined with local-only mode is rejected at
  startup with a named error, and the `agentic up` startup log states the
  resolved mode unambiguously.
- Reconcile `docs/TOPOLOGY.md` §3.1: either implement the documented
  refusal (orchestrator `--push` without a sync provider fails at startup)
  or amend the doc to match code; record the choice as an ADR.
- Document local-only as a supported first-class topology (ORCHESTRATOR.md
  and/or TOPOLOGY.md), noting the boundary: the deploy entrypoint (hosted
  topology) legitimately hard-requires a remote and is out of scope.
- Extend the existing remoteless test (`core/test/divergence.test.ts`) to
  cover the PR-ensure and sync short-circuits; no regression in the hosted
  push path.
- No changes to `roles/` or `contracts/` — the survey confirmed agent
  behavior is already remote-agnostic, and this run must keep it that way.

## Out of scope

- The deploy/ hosted topology (entrypoint, `PUSH_DECISIONS`, webhook): it
  legitimately requires a remote; at most a DEPLOY.md cross-reference to the
  new mode.
- Any new sync-provider or remote-abstraction layer — this run names and
  hardens the existing seam, it does not generalize it.
- Non-GitHub forge support (GitLab et al.); local-only simply never reaches
  forge code.
- FleetView UI treatment of local-only sources beyond whatever the existing
  badges already show (ahead/behind "not knowable" rendering is untouched).
