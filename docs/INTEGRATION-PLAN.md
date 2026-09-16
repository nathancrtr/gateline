# Framework Integration — Build & Proof Plan

**Status:** v1.0 — the executable synthesis of [INTEGRATION.md](INTEGRATION.md)
v0.2, its round-1 adversarial review
(`runs/integration-hardening/review-01.md`), and the field evidence from the
framework's two hand-executed integrations (the production pilot's Phase 0, and
integration #2 — a non-SDLC, single-operator ops host whose retro is maintained
outside this repository).
**Prerequisite reading:** [INTEGRATION.md](INTEGRATION.md) (the design this plan
builds), [FRONTEND.md](FRONTEND.md) §6 (staging), [ORCHESTRATOR.md](ORCHESTRATOR.md)
§10 (what this plan does *not* require from the orchestrator).

---

## 1. What this plan delivers, and how we know it worked

Two proofs, in dependency order:

1. **Upstream:** the framework becomes an adoptable open dependency — a tagged
   release an arms-length operator can integrate from, with `integrate.py`,
   renderer overlays, and a normative lockfile schema.
2. **Downstream:** integration #2 is re-based onto that release and operated
   through the framework's own toolchain — its operator manages real gate
   decisions through a locally launched gate-frontend (Gatehouse) instance
   pointed at the host, with the audit trail landing in the host's git history.

**The plan's exit criterion** (deliberately stricter than "validate passes"):
`gateline validate` passes on integration #2, *and* at least one real gate
decision on that host is recorded through its Gatehouse instance — named human,
timestamp, CAS commit — with no hand edit of `state.yaml`. That is the
INTEGRATION.md Stage-3 discipline ("done when validate passes for someone other
than the operator who ran init") adapted to a single-operator host: the second
"someone" is the toolchain itself exercising the full read+decide path.

## 2. Work breakdown — upstream scaffolding

Ordered. Each item names its exit criterion; tracked issues in parentheses.

### W0 — the state-contract split *(active run `run/state-contract-split`; #48, #49)*

Split `contracts/state.yaml` into a generic core (run identity, gates-as-map,
escalations, pause) and an SDLC extension (branch convention, G0–G3, tasks,
budget); the frontend validates run state against the target repo's own
`contracts/state.yaml` per its R3 rule.
Best-effort escalation parsing (#49, `run/escalation-visibility`) rides the same
milestone or lands immediately after.

*Why it heads the queue:* INTEGRATION.md §11 — the tag must not freeze the
about-to-fork schema; the Gatehouse proof (§3) is unreachable for a non-SDLC
host without it; and it is the one item with an intent brief already filed.
**Exit:** integration #2's runs — per-run gate maps (`publish`), artifact
lifecycle phases — parse as well-formed against the host's own contract;
frontend tests cover a non-G0–G3 gate map end-to-end.

### W1 — renderer: overlays, path-relativity, vocabulary *(#43, #50, #51)*

`render-agents.py` composes *role + `overlays/_all.md` + `overlays/<role>.md`*
with marked splice boundaries; resolves paths relative to its own location;
validates capabilities and gate names against the union of framework-declared
and instance-declared vocabulary (declaration syntax = INTEGRATION.md open
question 6 — decide here, smallest mechanism that distinguishes "instance-added"
from "typo'd"). Stays stdlib-only, Python 3.11+.
**Exit:** this repo re-renders byte-identical with no overlays present (CI
`--check` green); a fixture host with overlays + instance vocabulary renders
correctly; an undeclared capability or gate name fails the render.

### W2 — `gateline init | validate`, the copy manifest, the Integrator

The tool per INTEGRATION.md §5 as revised: `--take`/`--layout`/`--provenance`,
copy manifest shipped with the release, lock written per §3's normative schema
(shipped as a JSON Schema beside the tool), dual-mode provenance templates,
`validate` static checks scoped to the taken subset. Plus the judgment half:
`roles/integrator.md`, `contracts/integration-profile.md` (including the
gate-mapping-to-adopted-set and dispatch-reality sections), and the canned smoke
brief. `upgrade` is **not** in this item (v1, per §11) — except the narrow slice
P1 needs: reading a commit-pinned lock and rewriting it against a tag, which counts
as `init`-adjacent bookkeeping, not the 3-way merge.
**Exit:** the §11 acceptance test — replay `init` against both hand-built hosts
and diff against their scaffolds, every delta dispositioned as tool bug or
hand-integration mistake; `validate` passes on the tool's own output.

### W3 — commercial boundary lands *(active run `run/ee-boundary`; parallel)*

Not this plan's work, but the release checklist depends on its outcome: release
artifacts are Apache-2.0 by construction and must exclude `ee/` paths once the
convention exists. Runs in parallel with W1–W2; only W4 waits on it.

### W4 — the first tagged release *(#42; also decide #31 first)*

Tag, release checklist (what ships: core trees, copy manifest, `integrate.py`,
the `packages/` workspace as source; what doesn't: `runs/`, `apps/`, `ee/` paths),
and the versioning decision — recommendation: start semver at `v0.3.0` to match
the docs' version narrative rather than resetting to 0.1.0, since two field
locks already cite "v0.2". Decide the `runs/` tree fan-out (#31) before cutting,
per that issue's own note.
**Exit:** an operator can run `gateline init` from the tag's
checkout/tarball with no reference to `main`; both field locks have something
real to re-pin to.

### W5 — the operator cockpit path, documented

The two-channel model's second channel (INTEGRATION.md §3): checkout the tag,
`npm install` in `packages/`, `gateline ui --repo <host>` (and the multi-repo
fleet config for operators with several hosts). One documented page — a
WALKTHROUGH or frontend README section — sufficient for a cold operator.
npm-publishing the packages stays deferred until the repo goes public (epic
#12); running from the pinned checkout *is* the v0 distribution.
**Exit:** a second operator (or a clean machine) launches Gatehouse against a
host from the docs alone.

## 3. Proof — integration #2 as the test case

All steps happen in the host repo or the operator's cockpit; none of them adds
host-specific content to this repository (retro lessons flow back
maintainer-mediated and redacted, as INTEGRATION.md §6 requires).

- **P0 — read re-probe (immediately after W0, before anything else).** Re-run
  the host's Gatehouse generality probe: `gateline status` / `inbox` / API
  against the host. Prior result: everything generalized except the compiled-in
  state schema. Expected now: runs render with their real phases and gate maps,
  the known open escalation is visible, metrics populate. Any residual bounce is
  a W0 defect found cheap.
- **P1 — re-pin the lock.** Upgrade the host's hand-written,
  commit-pinned lock to the W4 tag. Expected collateral: the host's
  `contracts/state.yaml` fork **collapses into the sanctioned extension point**
  the split created — the lock's `forks{}` shrinks toward empty, `taken[]`,
  `instance_layer`, and `provenance_mode: private` are recorded per the
  normative schema. If the host's lifecycle values exceed what the extension
  expresses, the fork stays and shrinks — record, don't force.
- **P2 — validate.** `gateline validate` on the host: checksums over the
  taken subset, provenance mode `private` matches its NOTICE pattern, renders
  current, state parses against the host's own contract, instance vocabulary
  (`web` capability; `publish`/`none` gates) declared.
- **P3 — Gatehouse live.** From the cockpit checkout at the pinned tag:
  `gateline ui --repo <host>` — single-user, `127.0.0.1`, browser. Acceptance,
  in order of increasing consequence:
  1. Portfolio lists the host's runs with true phases and its own gate
     vocabulary; no synthesized G0–G3 ghosts.
  2. Inbox shows everything waiting, oldest first, including the open
     escalation and any deadline-driven decision (known limitation: `decide_by`
     ordering is icebox #54 — note it, don't block on it).
  3. **One real founder decision** — a `publish` gate or a standing-decision
     commit gate — approved in the UI: lands as a CAS commit editing that run's
     `state.yaml`, authored by the named human, burden captured; the host's
     `git log` shows it; nothing else changed.
- **P4 — retro.** Append findings to the host's integration retro;
  framework-general lessons return here as issues, per the flowback rule. The
  plan is complete when §1's exit criterion holds.

## 4. Review findings → resolution map

| Finding (review-01) | Resolved by |
|---|---|
| F1 partial adoption vs. workflow stages (blocking) | INTEGRATION.md §5 `--take`/`--layout`, gate-mapping and smoke scoped to the adopted set (round-2 edit); mechanism built in W2 |
| F2 §8 self-sufficiency claim | §8 host-repo / operator-cockpit split (round-2 edit); documented in W5 |
| F3 upgrade base unfetchable | §3/§6 retained-upstream-copy base (round-2 edit); full `upgrade` stays v1; P1 uses only the lock-rewrite slice (W2) |
| F4 provenance mode unverifiable | §5 explicit `--provenance` recorded in the lock (round-2 edit); W2 |
| F5 lock schema not normative in-repo | §3 field-list schema (round-2 edit); JSON Schema ships in W2 |
| F6 dangling INTEGRATION-PLAN.md reference | This document |
| F7 tag-sequencing contradiction | §3 wording (round-2 edit); W0 ordered before W4 here |
| F8 read check unsatisfiable pre-split | §5 precondition stated (round-2 edit); P0 sequenced after W0 |
| F9 manifest × lock × upgrade gaps | §3/§6 taken-subset checksums, fork-base rule, added-file notes (round-2 edit); W2 |
| F10 R3 citation target | Citations now point at `packages/README.md` (round-2 edit) |
| F11 scheduled-dispatch omission | §5 profile "dispatch reality" section (round-2 edit); contract authored in W2 |

## 5. Sequencing, risks, non-goals

**Order:** W0 → (W1 ∥ W3) → W2 → W4 → W5; P0 runs as soon as W0 lands; P1–P4
after W4. Nothing here waits on the orchestrator trust ladder — the proof is
read + decide, not dispatch, so #35/#36 (shadow bar, live-dispatch
verification) are out of the critical path.

**Risks.**

- W0 scope: the split touches a core contract with two machine consumers
  (frontend, orchestrator) — hold it to the intent brief's constraints, resist
  folding queue features (#46, #54) in.
- The P1 fork collapse is a hypothesis; its failure mode is benign (a smaller
  recorded fork) but would be a design finding worth an issue.
- Version-number semantics (W4) is a one-way door once a public consumer
  exists.
- The W2 acceptance replay against the pilot host depends on access to that
  scaffold; if unavailable, integration #2 alone is the replay target and the
  pilot diff waits.

**Non-goals of this plan:** npm/package publishing, hosted multi-user Stage C,
orchestrator deployment on any host, `GitHubSource` (#45), the full 3-way-merge
`upgrade` (v1 per INTEGRATION.md §11), and any go-public step — the release in
W4 is a tag consumable from the private repo by its existing operators.

---

*Companion documents: [INTEGRATION.md](INTEGRATION.md) (the design),
[FRONTEND.md](FRONTEND.md) / [FRONTEND-PLAN.md](FRONTEND-PLAN.md) (the toolchain
the proof exercises), [ORCHESTRATOR.md](ORCHESTRATOR.md) (outside
the critical path).*
