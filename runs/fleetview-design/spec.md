# Specification: FleetView gate-frontend look-and-feel redesign

## Context

`frontend/packages/web` (React 19 / Tailwind 4 / Vite) already defines a token system —
`--color-*` custom properties via `light-dark()`, one accent, semantic ok/warn/bad
(`src/styles.css:1-24`) — but every surface repeats the same `rounded-lg border
border-line bg-surface` card and identical spacing scale with no per-page variation
(`pages/portfolio.tsx:20`, `pages/metrics.tsx:68,192`, `components/diff-view.tsx:27`,
`pages/inbox.tsx:82`). That uniformity is exactly the anti-pattern class the brief
names, so the "generic" critique holds despite the token layer existing — this is a
layout/density/identity problem, not a missing-tokens problem. The `ux-researcher` and
`designer` roles and their contracts are already rendered on this branch and ready to
dispatch. Server API, data model, and the `frontend/README.md` R1–R3 invariants
(repo-is-the-database, one CAS write path, malformed packet never renders as
reviewable) are unchanged by this run; `frontend/e2e/smoke.spec.ts` and `npm test`
already exercise them and become this run's regression floor.

## Requirements

### R1 — Screen and state inventory
The surface in scope for research, the three candidates, and the eventual build is
fixed to these six screens, so no producer drifts wider or narrower.

| Screen id | Source | Required states beyond generic empty/loading/error |
|---|---|---|
| `inbox` | `pages/inbox.tsx` | full kind vocabulary — gate, escalation, round-cap, paused, bounced (`components/chips.tsx:27-45`, `pages/inbox.tsx:40-42`); "inbox zero" (`pages/inbox.tsx:81-85`) |
| `portfolio` | `pages/portfolio.tsx` | malformed-run row + needs/escalation badges (`pages/portfolio.tsx:42,60-70`); zero-runs state (not in current code — sketch one anyway, see R4) |
| `metrics` | `pages/metrics.tsx` | populated gate table + burden bar + rounds + budget honesty (`pages/metrics.tsx:61-222`); "no decisions yet" (`pages/metrics.tsx:46-50`) |
| `run-artifacts` | `pages/run.tsx`, `components/decide.tsx` | malformed run-state banner (`pages/run.tsx:78-84`); an open decide flow, e.g. approve mode with burden picker (`components/decide.tsx:130-166`); bounced no-approval message (`components/decide.tsx:109-111`); task board (`pages/run.tsx:179-195`) |
| `run-diff` | `components/diff-view.tsx`, `pages/run.tsx:255-261` | populated diff with add/del hunks; "no diff" and "run is merged" empties |
| `run-history` | `pages/run.tsx:263-280` | populated timeline with a phase-transition marker; "no state history" empty |

**Acceptance criteria:**
- [ ] AC1.1 — `runs/fleetview-design/ux-research.md` Scope names these four pages
  (inbox, run detail, portfolio, metrics) and shared components as the surveyed
  surface.
- [ ] AC1.2 — each `runs/fleetview-design/design/<candidate>/` directory contains one
  self-contained `.html` mockup per screen id above (six), each indexed by a line in
  that candidate's Mockups section.

### R2 — UX research report meets a concrete floor
**Acceptance criteria:**
- [ ] AC2.1 — `ux-research.md` has every section `contracts/ux-research.md` requires;
  missing a section bounces it, no grading.
- [ ] AC2.2 — ≥3 distinct external products or categories are cited by URL (role
  rule: "survey wide... not one reference product").
- [ ] AC2.3 — ≥4 anti-patterns (A1...), each a concrete, mockup-checkable trait, and
  together covering all four slop traits the brief names — default component
  styling, uniform treatment of every surface, no typographic identity, no spatial
  identity (`runs/fleetview-design/intent-brief.md:10-12`).
- [ ] AC2.4 — every P/A/REC entry cites a source (URL or `file:line`); zero uncited
  entries (spot-checked by the G1 human).
- [ ] AC2.5 — every REC traces to ≥1 P/A number and states a constraint or caution
  only — no named color value, font-family, or "should look like X" language
  (recommendations belong to the Designers, not the Researcher).

### R3 — Three distinct candidates delivered
**Acceptance criteria:**
- [ ] AC3.1 — exactly three `runs/fleetview-design/design/<candidate>/design-candidate.md`
  files exist, each with every section `contracts/design-candidate.md` requires.
- [ ] AC3.2 — the G1 gate notes record, for each candidate, that its thesis reads as
  distinguishable from every sibling's at a glance (designer role's "move if a
  sibling already occupies that direction" rule, checked again at the gate).

### R4 — Candidate completeness and floor
**Acceptance criteria:**
- [ ] AC4.1 — each candidate ships ≥6 self-contained `.html` files (R1) that open
  from `file://` with zero network requests — no `http://`, `https://`,
  `<script src=`, or `@import url(` anywhere in the mockup HTML.
- [ ] AC4.2 — every mockup sketches its screen's empty, loading, and error states
  plus the "required states" column from R1's table.
- [ ] AC4.3 — mockups use real content pulled from the repo (real run slugs, `G0`-`G3`
  ids, phases, artifact paths) — no `lorem`, `ipsum`, `foo`, or `bar` (case-insensitive)
  anywhere in the mockup HTML.
- [ ] AC4.4 — each candidate's Look-and-feel spec names a full type stack and scale,
  color tokens for both light and dark, a spacing/density rule, a motion policy, and
  component shapes, with no `TBD`/`TODO`/`XXX` placeholder text.
- [ ] AC4.5 — each candidate's Ergonomics notes state WCAG 2.1 AA contrast (4.5:1 body
  text, 3:1 large text/UI components) is met in both themes and that focus order is
  visible, or name the deferred gap and why.
- [ ] AC4.6 — each candidate's Research traceability section cites ≥1 P and ≥1
  A/REC number, and states in one line any REC it deviates from.

### R5 — Implemented winner: functional regression floor
**Acceptance criteria:**
- [ ] AC5.1 — `npx playwright test` (`frontend/e2e/smoke.spec.ts`) passes against the
  rebuilt UI without modifying its assertions — the `data-inbox-row`,
  `data-needs-card`, and `data-decide="..."` hooks and the R3 bounce/no-approval
  assertion (`smoke.spec.ts:47-53`) still hold.
- [ ] AC5.2 — `npm test` and `npm run typecheck`, run from `frontend/`, both pass.
- [ ] AC5.3 — the keyboard model (`frontend/README.md` "Keyboard model" table:
  `j`/`k`/`↵` on inbox, `a`/`x`/`1`/`2`/`3`/`esc` and `e` on the run page) is
  unchanged, verified by `smoke.spec.ts:72-83` plus a manual check of `j`/`k`/`↵`
  and `e`.
- [ ] AC5.4 — `git diff` for the implementation task touches only
  `frontend/packages/web` plus, if the winning candidate needs one, a single clearly
  named new shared token module; no edits to `frontend/packages/core`,
  `packages/server`, `packages/cli`, or `packages/orchestrator`.

### R6 — Implemented winner: fidelity and scope guardrails
**Acceptance criteria:**
- [ ] AC6.1 — the Reviewer/Verifier compares each of the six R1 screens as built
  against the G1-selected candidate's mockups and Look-and-feel spec and records
  match or deviation per screen.
- [ ] AC6.2 — `frontend/packages/web/package.json` still declares `react ^19`,
  `tailwindcss ^4`, and `vite ^7`, unless `plan.md` carries an ADR approved at G1 for
  a stack change.
- [ ] AC6.3 — no route is added to `app.tsx`/the router and no endpoint is added to
  `api.ts` beyond those already called today, other than the portfolio zero-runs
  render branch (R1) — confirmed by diff review.
- [ ] AC6.4 — the built app still holds `frontend/README.md` R1–R3 (repo is the only
  database, one CAS write path with 409 re-present, malformed packet never renders as
  reviewable) — verified by the AC5.1 suite plus a manual 409-conflict check (decide
  on a run whose branch moved underneath the open tab).

## Assumptions
- **ASSUMPTION:** the brief gives no numeric floor for research/candidate coverage →
  resolved as the thresholds in R2/R4 (≥3 external categories, ≥4 anti-patterns, ≥6
  mockups per candidate) because the role rules ("survey wide," "make each entry
  checkable") need a concrete floor for G0/G1 to hold producers to, and these numbers
  are the minimum that lets every named slop trait and every in-scope screen get at
  least one citation.
- **ASSUMPTION:** "all supported themes" (`contracts/design-candidate.md`) → resolved
  as the two color-scheme variants already wired in `styles.css:6-28` (light, dark,
  OS-driven via `light-dark()`) because the brief doesn't ask for a manual
  light/dark toggle and the app has none today; a candidate proposing one must flag
  it as ADR-worthy for the Architect rather than build it silently.
- **ASSUMPTION:** "screen" granularity for the run-detail page's three tabs →
  resolved as three separate screens (`run-artifacts`, `run-diff`, `run-history`)
  rather than one, because the tabs render materially different content (prose,
  code diff, timeline) and a single static mockup emulating JS tab-switching would
  be as much build risk as it saves.
- **ASSUMPTION:** Portfolio has no zero-runs empty state in the current code →
  resolved as requiring one sketched in every candidate and built as a static
  conditional render (no new filtering/sorting/interaction) because the ergonomics
  floor in the designer role applies regardless of what today's code happens to
  handle, and this is the one place the redesign adds rather than only restyles.

## Out of scope
- CLI output/voice and any non-web surface (`agentic-sandbox` intent-brief.md:39).
- New features or information-architecture changes beyond what the chosen
  look-and-feel requires, beyond the single portfolio empty-state exception in R1/R6.3.
- A manual in-app theme toggle or any other new settings UI (see Assumptions).
- Any change to request/response shapes in `api.ts` or the server.
- Marketing or landing pages — product UI only.
- Orchestrator behavior and `@agentic/core`/server logic, other than an allowed new
  home for shared theme tokens.
- Localization/i18n and automated visual-regression tooling — neither is asked for
  or present today.
