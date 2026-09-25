# Intent Brief: a public, read-only Gatehouse demo on gateline.dev

## Problem

The public site (`site/`, published to gateline.dev) documents the framework
well and shows the cockpit nowhere: the landing page mentions Gatehouse in two
sentences and carries no image. The one place a reader can see what an
approver reads and what a finished record looks like is the README's
screenshots. A reader who wants to open a run — click through the inbox, a
pending packet, the decision ledger of a finished run — has to clone the
repository, install the workspace, and run `gateline ui --demo`.

Tracked as #395.

## Motivation

- The product's central claim is that a named human reads a packet and stamps
  a decision at a fixed gate, and that the resulting record is the deliverable.
  That claim is far more legible as a screen than as prose.
- The record has two readers: the approver at a pending gate, and afterwards
  anyone who wants to know what was decided and by whom. A public read-only
  Gatehouse over a finished run is the second reader's surface, not marketing
  for it. This run is the first concrete build of that surface.
- The parts exist. `gateline ui --demo` renders the fixture repository
  (`@gateline/fixtures`) in every interesting state; core derives the
  view-model as a pure function of committed record; the web app reads
  everything through one JSON helper and one event stream. What is missing is
  a snapshot of those reads and a build of the web app that consumes it.
- Dogfooding: this run's own finished record is content for the demo it
  builds.

## Constraints

- **Static by construction.** Gatehouse has no authentication and exposes
  write, runner and webhook routes (DEPLOY.md, security model). The demo is a
  tree of pre-baked JSON responses plus the web bundle, served as files. No
  server, no port, no engine, nothing metered, at any point in the demo's
  life. A hosted mock server is explicitly not the shape.
- **The cockpit keeps no state of its own.** Decisions (approve, decline,
  resolve, stage, arm) return a refusal the existing UI already renders. No
  client-side pretend state.
- **Content: every finished run on `main` plus the fixture.** The real runs
  under `runs/` whose `state.yaml` reads `done` are the primary content — they
  are already public and are the evidence for the README's self-dogfooding
  claim. The fixture supplies the transient states a finished record cannot
  show (each gate pending, escalated, round-cap, paused, malformed artifacts).
  Fixture runs are visibly labelled as fixture data in the UI so illustration
  is never mistaken for evidence.
- **Built in the Pages workflow, on every PR.** `.github/workflows/site-pages.yml`
  generates the snapshot from the same fixture the Playwright suite uses and
  places it at `_site/demo/`. A UI change that breaks the snapshot fails the
  PR. The step runs on pull requests without deploying, like the rest of the
  site; the workflow will need full git history to see finished runs and
  `run/*` branches.
- **Publication is a separate switch.** Inclusion of `demo/` in the deployed
  tree is gated on a repository variable that defaults off. The build must be
  complete and verified while the variable is off; flipping it is a later,
  human decision recorded outside this run. GitHub Pages is public for a
  public repository, so privacy comes from not publishing, never from an
  unlinked path.
- **The snapshot generator is a script, not a CLI subcommand.** It lives with
  the server package, which owns the routes, and starts the server in-process
  over given sources. Promoting it to `gateline snapshot` is #58's call, not
  this run's.
- **Path and framing.** The demo lives at a path on the site (`/demo/`), not a
  separate domain or subdomain; Gatehouse is a component of gateline (#319).
  Site copy stays consumer-agnostic and makes no claim about any audit regime
  or standard; the demo shows what the framework does today.
- **Existing tooling only.** Vite, the existing router and the existing Pages
  workflow. `packages/framework` stays dependency-free (INTEGRATION.md §8);
  the demo build touches `web`, `server` and the workflow.
- **Deep links must work.** A run's URL in the demo is shareable; whatever
  makes that true on a static host (per-route `index.html` copies, or an
  equivalent) is in scope.

## Out of scope

- Flipping the publication variable, the landing-page link, and the final
  fixture-label and "no engine attached" copy. Those land in a follow-up once
  the maintainer chooses to publish.
- A hosted or mock API server of any kind, a preview host behind an
  authenticating proxy, and any change to `deploy/`.
- Publishing the workspace packages or an npx-runnable cockpit (#58, #57).
- Signing, digests, chaining or any change to the record format; the demo
  renders the record as it is.
- Redacting cost figures or approver names from real runs (already public in
  git). If prominence is a concern, note it for the follow-up rather than
  changing what the cockpit renders.
- Changes to roles, contracts, the registry, or the orchestrator.

## Profile

standard
