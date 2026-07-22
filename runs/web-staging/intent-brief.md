# Intent Brief: FleetView staging surface — the web sibling of `agentic new` / `agentic arm`

## Problem

Staging and arming runs exist only as CLI acts (`agentic new`, `agentic arm`,
landed in `run/creation-seam`). FleetView — the gate frontend where humans
already review packets and record decisions — cannot create a staged run,
renders no staged rest state, and has no arm control. An operator working in
the web surface must context-switch to a terminal to mint or start a run, and
the server exposes no staging routes (the creation-seam run's Out of scope
explicitly deferred them).

## Motivation

- The staged→armed lifecycle is complete at the core seam but reaches humans
  on one surface only; the gate frontend is the natural second carrier.
- The creation-seam run named the web capture surface as its follow-on; this
  run is that follow-on.
- Dogfooding: this run is itself staged with `agentic new` and armed with
  `agentic arm`, exercising the just-merged seam end-to-end, and it
  resurrects the designer and ux-researcher extension roles as in-run
  prototypes for the design work.

## Constraints

- **Free-form staging only.** The surface captures the operator's own words.
  The intake provenance fields (source/ref/url) are human-typed pointer text;
  FleetView never fetches from, renders, embeds, or writes to any external
  tracker — no issue browser, no import pipeline, no LLM drafting of briefs.
  If a screen starts resembling a tracker client, it is out of bounds.
- **The brief is human-authored.** The web editor supplies structure (the
  intent-brief contract's required sections), never generated prose, and
  refuses to stage without the required sections present — the CLI's refusal
  posture, mirrored.
- **One write path.** The web surface rides the same `stageRun` /
  `planDecision('arm')` core seam the CLI uses; server routes are thin
  carriers. No parallel mutation path, no route that bypasses the record
  layer's legality checks.
- **Attribution.** A staged or armed act is attributable to a named human in
  the commit record; absent a resolvable identity the surface refuses rather
  than guesses, exactly as the CLI does.
- **Design inside the run.** A ux-researcher memo and two designer candidates
  (decorrelated across model families where adapters allow) land before the
  plan; G1 approves the plan and selects the candidate in one decision. Both
  roles are in-run prototypes: nothing from this run generalizes into
  `roles/`, `contracts/`, or the registry — the role set stays closed.
- **Existing visual vocabulary.** Reuse FleetView's tokens, chips, and
  inbox/portfolio/run-detail idioms; the staged state renders inside existing
  views — no parallel "queue" app.

## Out of scope

- Tracker/driver integration of any kind: fetch, import, task-source registry
  drivers, write-back. Those are future carriers, deliberately absent here.
- The GitHub decision grammar (#119) and signing work (#123, #127).
- Changes to the role set, contracts, or orchestrator derivation table —
  design roles stay hand-dispatched (v0 style) inside this run.
- LLM drafting of brief content on any surface (ADR-6 territory), and its
  cost accounting.

## Profile

standard
