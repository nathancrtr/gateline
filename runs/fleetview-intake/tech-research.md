# Tech Research: Upstream task intake — run initiation architecture

<!-- Produced by the architect-style technical researcher (P6 extension trial,
     run fleetview-intake); consumed by the synthesis step and the G1 human.
     Mirrors contracts/ux-research.md discipline: numbered findings, one line
     plus source each; a URL for external practice, file:line for this repo.
     An uncited finding is an opinion. -->

## Scope

The technical architecture of run initiation: how a task travels from an upstream source (tracker item, UI form, CLI utterance) to a valid `run/<slug>` branch carrying `intent-brief.md` and `state.yaml`, and how task sources are abstracted so no tracker's concepts leak into core or contracts. Surveyed: agent-execution products' ingestion surfaces (GitHub Copilot coding agent, OpenAI Codex cloud, Devin, Cursor background agents, Claude Code GitHub Actions), tracker-integration and driver-abstraction patterns (Renovate, Backstage), event-intake reliability practice (GitHub webhooks, Stripe idempotency), staged-execution semantics (Terraform Cloud, GitHub environments), and auth for hosted single-operator deployments (Cloudflare Access). Status write-back is out of scope; it is noted only where an intake choice forecloses or enables it.

## Patterns

### P1 — The tracker item is the intake trigger, not the intake payload
Copilot coding agent starts from "assign the issue to Copilot"; Codex from an `@codex` mention; Claude Code Actions from `@claude` — the agent then reads the item and repo itself rather than trusting a forwarded payload. Source: https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent, https://developers.openai.com/codex/cloud, https://code.claude.com/docs/en/github-actions

### P2 — One utterance plus minimal structured bindings
Ingestion payloads across the category are a free-text prompt plus a few optional structured fields (repo, base branch, extra instructions) — Copilot's optional prompt field on assignment, Cursor's `@Cursor [repo=...] <prompt>`; this matches the brief's v0-cockpit benchmark. Source: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github, https://cursor.com/docs/integrations/slack

### P3 — Idempotent creation keyed on caller-supplied identity
Devin's create-session API takes `idempotent: true` and answers with `is_new_session`; Stripe's idempotency keys make POST retries safe by replaying the first result for 24h and erroring on parameter mismatch. Source: https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session, https://docs.stripe.com/api/idempotent_requests

### P4 — Dedup events on the provider's delivery identity; assume at-least-once
GitHub stamps every delivery with an `X-GitHub-Delivery` GUID that survives redelivery; sound consumers store it and treat duplicates as part of the contract, not a provider bug. Source: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks, https://www.hooklistener.com/learn/webhook-idempotency-and-deduplication

### P5 — Hybrid push + poll: webhooks for latency, polling for reconciliation
Because webhooks are lossy and unordered, mature integrations pair them with a periodic poll that backfills gaps; this repo already runs exactly that shape for freshness (webhook fast path over an interval-poll fallback). Source: https://www.merge.dev/blog/webhooks-vs-polling; frontend/packages/server/src/webhook.ts:1-3, docs/DEPLOY.md:154

### P6 — Task sources as drivers behind one narrow interface
Renovate is platform-neutral via a single `Platform` interface (`lib/modules/platform/types.ts`) with per-platform modules for GitHub/GitLab/Gitea/Azure/etc. — the multi-tracker analogue of this repo's own seams: `registry/models.yaml` (models) and `RunSource` (repos), whose header states "nothing above it may know which driver it is talking to". Source: https://docs.renovatebot.com/modules/platform/; registry/models.yaml:1-6, frontend/packages/core/src/source.ts:1-3

### P7 — Scaffold generation is template rendering, not judgment
Backstage's scaffolder mints new components from declarative templates (parameters + steps) with a dry-run mode; the mechanical half of intake — rendering `state.yaml` and the brief skeleton — is the same shape, and this repo's templates already exist as `contracts/*`. Source: https://backstage.io/docs/features/software-templates/; contracts/intent-brief.md:1-4, docs/ORCHESTRATOR.md:59 (init classified "Mechanical")

### P8 — Staged-but-not-armed: creation and execution are separate acts
Terraform Cloud separates plan from "Confirm & Apply" (speculative plans *cannot* be applied); GitHub environments pause jobs on required reviewers; Copilot-agent-created PRs are drafts whose Actions workflows wait for a human "Approve and run" by default. Source: https://www.terraform.io/cloud-docs/run/ui, https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment, https://github.blog/changelog/2026-03-13-optionally-skip-approval-for-copilot-coding-agent-actions-workflows/

### P9 — The initiator cannot approve the result
Copilot coding agent enforces that the requester of an agent PR cannot be its approving reviewer, and the agent can never approve or merge its own work — the industry form of this repo's provenance invariant (gates written only by the named human). Source: https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/; contracts/state.yaml:7-9

### P10 — Headless access via service tokens under the access proxy
Cloudflare Access issues Client-ID/Secret service tokens for non-interactive callers (CLI, automation) against a Service-Auth policy — the standard way a terminal reaches an Access-protected instance like the live deployment, which deliberately has no auth of its own. Source: https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/; docs/DEPLOY.md:19-29

### P11 — Machine intake authenticates by signature, and the route doesn't exist unarmed
The repo's own webhook is the model: HMAC-verified against the raw body, constant-time compare, and when no secret is configured the endpoint is never registered at all. Source: frontend/packages/server/src/webhook.ts:15-21, frontend/packages/server/src/webhook.ts:41-46

## Anti-patterns

### A1 — Creation is arming (push = dispatch = spend)
Today any pushed `run/<slug>` branch whose phase is `spec` with no `spec.md` derives an immediate analyst dispatch (D6), and the engine ticks runs seen even as remote-tracking refs only — so a half-authored or accidental push starts spending money with no confirm step. Detect: no state between "branch exists" and "producer dispatched". Evidence: frontend/packages/orchestrator/src/derive.ts:15 (D6), frontend/packages/orchestrator/src/engine.ts:105-121

### A2 — Unauthenticated intake endpoints
An unsigned run-creation route on a hosted instance lets anyone who can reach the port mint work (and, per A1, spend); the repo already refuses this shape for its read-side webhook. Detect: any intake route reachable without a signature or the access proxy. Evidence: frontend/packages/server/src/webhook.ts:38-40, docs/DEPLOY.md:19-21

### A3 — Tracker concepts hard-wired into core or contracts
Baking GitHub's nouns (issue number, labels, assignee) into `contracts/*` or `@agentic/core` types forecloses the pluggable-source constraint — the Dependabot (GitHub-only, config-not-driver) trap versus Renovate's platform interface. Detect: grep core/contracts for tracker-specific fields. Evidence: runs/fleetview-intake/intent-brief.md:39-43; https://docs.renovatebot.com/modules/platform/

### A4 — Acting on webhook payload content instead of re-fetching state
Payloads arrive unordered, duplicated, and (if verification is sloppy) forgeable; GitHub's own guidance is to verify and treat events as hints. The repo's webhook already discards the payload and re-derives from git — intake must keep that property. Detect: any code path that builds a run from `payload.*` fields rather than from a fresh fetch of the source of truth. Evidence: https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks; frontend/packages/server/src/webhook.ts:89 (`_payload` unused)

### A5 — A second control plane beside git
An intake queue held in server memory or a database (pending requests, draft briefs) violates "git is the only store" and "state.yaml is the entire control plane — there is no orchestrator API, config channel, or command queue to keep consistent with it". Detect: intake state that does not survive a server restart from git alone. Evidence: docs/ORCHESTRATOR.md:179-181 (§4.5), docs/ORCHESTRATOR.md:168-170

### A6 — Machine-authored intent passing as human-authored
Auto-generating `intent-brief.md` from an issue body (or letting a model "improve" it) and committing it under intake machinery breaks the contract's "Author: a human" and the brief's provenance constraint — and an agent that can file tracker items could then self-initiate. Detect: intent-brief commits authored by the bot identity. Evidence: contracts/intent-brief.md:3, runs/fleetview-intake/intent-brief.md:50-52

### A7 — Non-idempotent minting: one task, two runs
Retried webhook deliveries or a double-submitted form minting `run/fix-login` and `run/fix-login-2` for the same upstream item; the industry answer is creation keyed on an idempotency identity with an "already exists" reply. Detect: two run branches citing the same source item. Evidence: https://docs.stripe.com/api/idempotent_requests, https://docs.devin.ai/api-reference/v1/sessions/create-a-new-devin-session

### A8 — Run creation implemented outside the shared seam
Per-surface creation logic (server route shells out to git; CLI reimplements the scaffold) is how derivations drift — the same reasoning that rejected a second implementation of the readiness rules. Detect: more than one code path that writes a new run branch. Evidence: docs/ORCHESTRATOR.md:358-366 (§9, "two implementations ... is how they drift")

## Recommendations

- **REC1** (from P8, A1, A5): The spec must define a two-state intake lifecycle — **staged** (run branch exists with valid scaffold; the orchestrator derives rest) and **armed** (dispatch derivable) — with the arming act a human act recorded in git, not a server-side flag. The existing vocabulary already contains a rest state (`phase: paused` rests via D2, resume is a human decision), but whatever value is chosen is a `contracts/state.yaml` enum amendment first, never an improvised state (frontend/packages/orchestrator/src/derive.ts:10-11, docs/ORCHESTRATOR.md:325-327).
- **REC2** (from P3, P4, A7): Run creation must be idempotent: every intake request carries an identity (upstream item ref, or a client key for free-form requests); replays return the existing run with an "already existed" indication rather than minting a sibling. The dedup primitive already exists — branch creation from the zero OID resolves races at the ref (docs/ORCHESTRATOR.md:203-205).
- **REC3** (from P6, A3): Task sources are drivers behind one narrow interface, enumerated in a registry-style committed config (the `registry/models.yaml` posture applied to upstream integrations); core and contracts carry only neutral fields — source id, external ref, title, body, URL. Swapping or adding a tracker must be a driver plus a registry entry, never a core or contract edit. *Write-back note:* requiring the neutral external ref to be recorded in the born run (brief header or state) is what keeps the out-of-scope return path buildable later without re-architecture.
- **REC4** (from P1, P9, A4, A6): Upstream items are triggers and raw material, never finished intent. The intake flow may pre-fill a draft brief from a fetched (not payload-forwarded) item, but a named human confirms and owns the brief before the run arms, and the confirming commit must carry human identity — the bot identity is reserved for bookkeeping (contracts/state.yaml:5-9). No path may run event → armed run without that human act.
- **REC5** (from P7, A8): Exactly one creation seam, in core alongside `RunSource` (which today has no run-creation capability — frontend/packages/core/src/source.ts:40-64), consumed by UI, CLI, and any future source driver. Scaffold rendering is mechanical from `contracts/*` templates — no model invocation is needed to mint a valid staged run (docs/ORCHESTRATOR.md:59).
- **REC6** (from P2): The intake payload contract is one free-text utterance plus minimal optional bindings (slug suggestion, source ref, budget ceiling) — parity with the v0 cockpit benchmark (runs/fleetview-intake/intent-brief.md:47-49). Anything demanding a filled-out form before staging fails the benchmark; anything demanding less than the brief's four sections before *arming* fails the contract (contracts/intent-brief.md:3).
- **REC7** (from P10, P11, A2): Every intake path must be authenticated before it exists: UI inherits the access proxy; CLI and automation use the proxy's service-token mechanism and/or a signed route in the webhook's arm-only-when-secret-set pattern; an unauthenticated creation endpoint must be structurally impossible, not merely discouraged.
- **REC8** (from P5, A4): If event-driven intake from trackers is specified (even as future work), it must be trigger-shaped — verify signature, dedup on delivery id, re-fetch the item, stage (never arm) — with polling reconciliation as the documented fallback for missed events.

## Open questions

1. **What counts as "human-authored" when intent originates upstream?** If a human wrote the GitHub issue, is importing its body verbatim a human-authored brief — or must a named operator distinct from the intake machinery (and possibly from the issue author) confirm it? Determines how much A6 constrains pre-filling, and closes or leaves open the agent-files-an-issue self-initiation loophole (runs/fleetview-intake/intent-brief.md:50-52).
2. **Where does the staged state live?** Reusing `phase: paused` with a new reason, a new pre-`spec` phase value, or keeping drafts off `run/*` refs entirely (e.g., a draft namespace) are all contract-visible choices with different blast radii on the readiness table, D-table, and FleetView inbox — a maintainer call before the spec fixes REC1's mechanism.
3. **May staging itself be automated?** Whether a webhook/label event may mint a *staged* run unattended (appearing in the inbox for a human to arm), or whether even staging requires a human act — a noise/abuse tradeoff REC4 deliberately leaves open.
4. **Slug authority and collision policy.** Who mints `<slug>` — the human, or derivation from the source item — and what happens on collision with an existing or historical run; interacts with REC2's idempotency identity.
