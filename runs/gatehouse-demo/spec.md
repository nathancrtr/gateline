# Specification: a public, read-only Gatehouse demo on gateline.dev

<!-- AUDIENCE: Out of scope=audit -->

## Context

Gatehouse's only way to show a finished record today is a live process.
`gateline ui --demo` starts a local server over a generated fixture, and
reading a real finished run means cloning this repository and running it
locally. The public site at `site/` names Gatehouse in two sentences on its
landing page and shows no screen of it — the README's screenshots are the
reader's only image of it.

The parts this build assembles already exist, unconnected. `packages/fixtures`'s
`generateFixtureRepo` (`packages/fixtures/src/index.ts`) builds a repository in
every interesting run state. `packages/server/src/app.ts` derives every view as
JSON over `@gateline/core`. `packages/web/src/api.ts` reads all of it through
one `fetch` helper (`getJson`) and one `EventSource` (`packages/web/src/use-live.ts`).

`.github/workflows/site-pages.yml` already builds the site on every pull
request and deploys it on pushes to `main`. Its `actions/checkout@v4` step
takes the default shallow history, which cannot see a finished run's full
commits or any `run/*` branch.

Two of the read routes do not fit a plain static host as written.
`GET /api/runs/:src/:slug/artifact` selects its file by a query string
(`?path=...`), which a static file server resolves by path alone.
`GET /api/events` is a persistent stream, which a static host cannot serve at
all. Neither mismatch is named in the brief's constraints.

## Requirements

### R1 — Static snapshot generator
A script produces the demo's entire API surface as files, by running the
server's own logic in-process over a chosen set of sources, without binding a
port.

**Acceptance criteria:**
- [ ] AC1.1 — A new script under `packages/server` drives `createApp`'s routes
  (or an equivalent in-process request) and writes each response body to a
  file under a given output directory; grepping the script for `serve(` or
  `.listen(` (the port-binding calls `packages/server/src/main.ts` uses)
  returns no matches.
- [ ] AC1.2 — Running the script produces a file answering every GET route
  `packages/web/src/api.ts`'s `api` object calls: health, inbox, runs,
  metrics, and per run — detail, artifact (one resolvable response per
  artifact path that run's own artifact list contains), lexicon, evidence,
  g1, reviews, decisions, diff.
- [ ] AC1.3 — The script is not registered under `packages/cli` and does not
  appear in `gateline --help`.

### R2 — Content is exactly the real finished runs plus the fixture
The demo's inbox and portfolio list every run under `runs/` on `main` whose
`state.yaml` reads `phase: done`, plus every run `generateFixtureRepo()`
produces, and nothing else.

**Acceptance criteria:**
- [ ] AC2.1 — The generated `/api/runs` response's `runs` array contains one
  entry per `done` run on `main` (at spec time: `creation-seam`, `dupefind`,
  `local-only-mode`, `mdtoc`, `web-staging`, `wordfreq`,
  `writestate-kill-window`) plus one entry per run `generateFixtureRepo()`
  returns, and no others — no run whose `state.yaml` reads any other phase
  (including `closed`) appears.
- [ ] AC2.2 — Re-running the generator after another run reaches `phase: done`
  on `main` adds that run to the snapshot with no code change to the
  generator — selection reads `state.yaml`, it is never a hand-maintained
  list of slugs.

### R3 — Fixture runs are visibly labelled as fixture data
Every page rendering a fixture-sourced run carries a visible label
identifying it as fixture data; no real run carries that label.

**Acceptance criteria:**
- [ ] AC3.1 — Loading the demo's run-detail page for a fixture slug (e.g.
  `g2-pending`) shows an always-visible badge or banner naming it fixture
  data; the same page for a real finished run (e.g. `wordfreq`) shows no such
  label.
- [ ] AC3.2 — The label appears in the page's initial rendered markup, not
  only on hover.

### R4 — Static by construction
Nothing in the demo's life is a running server, and the routes that write,
dispatch, or receive a webhook are unreachable because they do not exist
anywhere the demo is served.

**Acceptance criteria:**
- [ ] AC4.1 — Serving the demo output directory with any plain static file
  server is sufficient to browse it; that directory contains no server
  process, no start script, and no file capable of handling
  `POST /api/decisions`, `POST /api/runs`, `POST /api/webhooks/github`, or
  `/api/runner/*`.
- [ ] AC4.2 — The demo's rendered pages establish no long-lived connection
  that retries indefinitely against a route the static host cannot serve —
  the live-invalidation `EventSource` (`packages/web/src/use-live.ts`) is
  disabled, or fails without reconnecting, when the app is built for the
  static demo.

### R5 — Mutating actions refuse; no client-side pretend state
Approve, decline, resolve-escalation, pause, resume, arm, and staging a new
run each render the same failure treatment the app already uses for a failed
write, and never change what is displayed.

**Acceptance criteria:**
- [ ] AC5.1 — Clicking "Approve" on a demo run's pending-gate card issues the
  same `POST /api/decisions` request the live app would; the static host has
  no such route, so the UI's existing failure path (the `ApiError` handling
  in `packages/web/src/api.ts`) renders, the gate's chip does not advance, and
  no spinner is left running.
- [ ] AC5.2 — Submitting `/portfolio/new`'s staging form against the demo
  fails the same way for `POST /api/runs`, and the inbox count is unchanged
  after the click.

### R6 — Deep links resolve directly
A shareable URL to a specific run loads on a fresh request to the static
host, not only through in-app navigation.

**Acceptance criteria:**
- [ ] AC6.1 — Building the demo tree and serving it with a plain static file
  server, a fresh HTTP GET (not a client-side route change) to `/demo/`,
  `/demo/portfolio`, `/demo/metrics`, and `/demo/runs/<src>/<slug>` for one
  real run and one fixture run each returns 200 and renders that route's
  content.
- [ ] AC6.2 — An unknown path under `/demo/` gets the site's existing 404
  handling (`site/404.html`), not a bare host-default 404 page.

### R7 — Built in the Pages workflow on every pull request
The demo snapshot and web build come from `.github/workflows/site-pages.yml`,
land at `_site/demo/`, and a change that breaks the demo fails the pull
request that introduced it.

**Acceptance criteria:**
- [ ] AC7.1 — The workflow's `build` job runs the snapshot generator (R1) and
  places its output plus the built web bundle at `_site/demo/` on both the
  existing `pull_request` and `push` triggers.
- [ ] AC7.2 — The job's `actions/checkout@v4` step for this build carries
  `fetch-depth: 0` (or equivalent) instead of today's default shallow clone.
- [ ] AC7.3 — A pull request whose diff makes any demo route fail to generate
  or a page fail to render against the snapshot fails this workflow's `build`
  job; a pull request with no such regression passes it.
- [ ] AC7.4 — The `pull_request` trigger's run takes no action reachable to
  `actions/deploy-pages`, matching the rest of the site's build-without-deploy
  behavior.

### R8 — Publication is gated behind one repository variable, default off
Whether `demo/` reaches the published site is controlled by a single
repository variable, defaulting off, independent of whether the build passes.

**Acceptance criteria:**
- [ ] AC8.1 — With the gating variable unset, the `push`-triggered run's
  `actions/upload-pages-artifact@v3` step uploads a tree with no `demo/`
  directory in it, even though the `build` job produced one.
- [ ] AC8.2 — Setting the variable to its documented "on" value, with no other
  code change, causes the next `push`-triggered run's uploaded artifact to
  include `demo/`.
- [ ] AC8.3 — This run's diff does not set the variable to "on."

### R9 — Path and framing
Once published, the demo is reached at a path under the existing site's
domain, and no new copy this run adds names a downstream organization or an
audit/compliance regime.

**Acceptance criteria:**
- [ ] AC9.1 — The assembled tree places the demo at `_site/demo/` alongside
  the rest of the site's pages — no new subdomain, no separate deploy target,
  no change under `deploy/`.
- [ ] AC9.2 — `python3 site/scripts/check-names.py` passes against this run's
  changes to `site/`, and no new copy in this run's diff names a specific
  downstream organization or terms like "audit," "compliance," or "regulator"
  outside text quoted verbatim from a finished run's own history.

## Assumptions

- **ASSUMPTION:** the brief names "existing tooling only" but the artifact
  route's query-string selection (`?path=...`) has no static-host equivalent
  → resolved as: making that route (and any other query-string route) work
  against pre-baked files is in scope for this run, because the brief already
  names exactly `web`, `server`, and the workflow as touched, and the artifact
  viewer is unusable in the demo otherwise. The claim that a static file
  server resolves by path only, ignoring the query string, is derived from
  general HTTP/static-hosting behavior, not verified against GitHub Pages
  directly — the Architect should confirm it before committing to a
  mechanism.
- **ASSUMPTION:** the brief describes the fixture's purpose with a partial
  list ("each gate pending, escalated, round-cap, paused, malformed
  artifacts") rather than an inclusion filter → resolved as: the demo embeds
  every run `generateFixtureRepo()` produces, including ones the brief's list
  does not name (e.g. `bad-state`, `forked-contract`), because the brief
  points at "the fixture" as a whole object supplying "the transient states a
  finished record cannot show," not a curated subset.
- **ASSUMPTION:** the brief doesn't name the gating repository variable (R8)
  → resolved as: this spec requires only that exactly one such variable
  exists and controls inclusion, not its name or type, because naming it is
  the Architect's call.
- **ASSUMPTION:** the brief is silent on the SSE freshness call
  (`GET /api/events`) having no static equivalent → resolved as: in scope to
  prevent an unbounded retry loop in every visitor's browser (R4.2), because
  the constraint that "no server ... [runs], at any point in the demo's life"
  implies the shipped app must not behave as though one might appear. That an
  `EventSource` reconnects indefinitely on error is derived from its
  specification, not exercised against a live static host in this analysis.

## Out of scope

- Everything `runs/gatehouse-demo/intent-brief.md`'s own Out of scope names:
  flipping the publication variable, the landing-page link, and the final
  fixture-label/"no engine attached" copy; a hosted or mock API server of any
  kind; publishing workspace packages or an npx-runnable cockpit; signing,
  digests, chaining, or any change to the record format; redacting cost
  figures or approver names; and changes to roles, contracts, the registry,
  or the orchestrator.
- Promoting the snapshot generator to a `gateline snapshot` CLI subcommand
  (#58's call).
- Any change to `packages/framework` (its dependency-free invariant,
  AGENTS.md) or to `deploy/`.
