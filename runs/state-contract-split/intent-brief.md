# Intent Brief: Split the run-state contract into a generic core and an SDLC extension

<!-- Contract: all four sections required. Author: a human. Consumer: Analyst.
     This is deliberately informal — it captures what you want, not a spec. -->

## Problem

`contracts/state.yaml` welds two things together: generic run mechanics (run
identity, a set of named human gates, escalations, pause state) and SDLC
specifics (the `branch: run/<slug>` convention, exactly four gates named G0–G3,
the tasks mirror, the budget block). Two independent consumers have now hit the
seam from opposite sides:

1. A downstream integration of the framework into a non-SDLC host (integration
   notes maintained outside this repository) could not describe its brief-shaped
   runs with the contract and recorded a deliberate fork in its framework
   lockfile — per the INTEGRATION.md forks mechanism, which worked, but a fork of
   a core contract is the mechanism's worst case, meant for exceptions rather
   than the first non-SDLC consumer's first hour.
2. The Gate frontend (PR #19) compiles the SDLC shape into its run-state schema:
   `branch` required, `gates` fixed to exactly G0–G3, `phase` fixed to the SDLC
   ladder. Pointed read-only at that same downstream host, every run renders as
   malformed — `phase: unknown`, four synthesized empty G0–G3 entries, empty
   metrics — even though each run is well-formed against the host's own copy of
   the contract. Notably, this is the one surface that violates the frontend's
   own R3 rule: artifacts are validated against the *target repo's* `contracts/`
   templates, but run state is validated against a schema baked into the app.

## Motivation

- **Gate vocabulary is a host decision even inside the SDLC.** A host that
  renames a gate, adds a fifth, or runs a two-gate lightweight profile is
  currently indistinguishable from a corrupted run. Reading the gate set from
  the host's `contracts/state.yaml` (per R3's own logic) fixes the general case,
  not just the non-SDLC one.
- **INTEGRATION.md's overlay design needs a defined place for state extension.**
  The core/extension split gives project-layer state additions a sanctioned home
  instead of a fork entry.
- **The product claim is "the git-native control plane."** The evidence from the
  downstream probe is that every layer of the frontend — discovery, freshness,
  inbox, R3 bounce discipline, all read endpoints — generalizes with zero
  modification; the compiled-in state schema is the single boundary. Removing
  that boundary is cheap now and structurally hard for session-based competitors
  to copy, and it does not require this repository to grow any non-SDLC content.
- If we don't do this: every future host divergence (SDLC or not) lands as a
  contract fork plus a frontend that cries wolf, and the "process portable
  across hosts" claim quietly narrows to "hosts shaped exactly like this one."

## Constraints

- Backward compatible: the wordfreq run's `state.yaml` and any existing
  `run/<slug>` branch must parse unchanged, with zero edits to completed-run
  artifacts (they are historical records).
- The frontend's three rules (repo is the only database; one write path; R3)
  are load-bearing and must survive intact. No write-path changes for
  non-SDLC gates are required — read surfaces first.
- The SDLC remains this repository's product scope: the split is layering
  within the existing contract, not a scope expansion; no business-function
  vocabulary enters `roles/` or `contracts/`.
- Coordinate with PR #19 (the frontend schema lives there) and the
  INTEGRATION.md draft (#20); this brief does not presume which lands first.

## Out of scope

- Any non-SDLC roles, contracts, or examples in this repository.
- Frontend decision affordances (approve/decline) for non-G0–G3 gates.
- Orchestrator changes (its dispatch rules stay G0–G3-shaped for now).
- Escalation visibility on schema-invalid runs — filed separately as
  `runs/escalation-visibility/`, which stands on its own regardless of this
  brief's fate; the two should be sequenced at G0.
