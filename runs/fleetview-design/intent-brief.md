# Intent Brief: Gate-frontend look-and-feel redesign (fleetview-design)

<!-- Drafted from the founder's 2026-07-14 brief by the orchestrating session;
     G0 approval adopts it as the human-authored input. -->

## Problem

The gate frontend's web UI (`frontend/packages/web`: inbox, run detail, portfolio,
metrics, plus shared components) is functionally complete but visually generic — it
is immediately recognizable as an unedited AI-generated interface, with the
characteristic traits of generic "slop" AI apps: default component styling, uniform
treatment of every surface, no typographic or spatial identity.

## Motivation

The single-user hosted instance is approaching release, and this UI is the first
thing any design partner or prospect sees. The product's pitch is credible,
audit-grade evidence; an interface that signals low care undermines that pitch at
first contact. If we don't do this, we launch on looks we would not hire.

## Constraints

- Three complete design candidates, each with a distinct look and feel, delivered
  as static mockups per `contracts/design-candidate.md` — no production code in the
  design phase. The founder picks one (or a hybrid) at G1; only the winner is
  implemented.
- Candidates diverge freely: no seed aesthetic. The bounds are the UX research
  report's anti-patterns and the ergonomics floor in the designer role, nothing
  else.
- Design candidates are grounded in a UX research pass (`contracts/ux-research.md`)
  covering current practice and the concrete traits of generic AI-generated UI to
  avoid.
- The winning design is implemented in the existing stack (React 19, Tailwind 4,
  Vite); changing the build stack requires an ADR at G1.
- Server API and data model unchanged; this is presentation-layer work.

## Out of scope

- CLI output formatting/voice, and any non-web surface.
- New features, and information-architecture changes beyond what the chosen look
  and feel requires.
- Marketing/landing pages; this run is product UI only.
- Orchestrator behavior and `@agentic/core`/server logic (a home for theme tokens
  is allowed).
