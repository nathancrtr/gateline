# Todo Catalog: historian-2026-07-12

Issue candidates mined from docs, run artifacts, and code — every row cites where the
work was promised or deferred. Each candidate has a ready issue title and body; none
are filed until the human approves. Existing issues #1–#6, #8, #11–#13, #17 already
cover their ground and are not duplicated (overlaps noted per row).

| ID | Candidate | Source | Suggested linkage |
|----|-----------|--------|-------------------|
| C1 | Finish the M1 shadow bar: two more shadow-agreement runs | ORCHESTRATOR.md §10 (N=3; wordfreq replay is 1/3) | replaces part of #9 |
| C2 | Verify live copilot-cli dispatch; replace static-estimate metering with real usage | ORCHESTRATOR.md §10 M3; copilot manifest `_comment_headless` | replaces part of #9/#10 |
| C3 | CI-triggered orchestrator variant (scheduled + event-dispatched workflows) | ORCHESTRATOR.md §10 "designed-for, not built" | — |
| C4 | Dispatch-guard posture for the orchestrator CLI | development experience: a bare `tick` against a repo with active runs dispatches immediately | — |
| C5 | Trailing-ledger-average dispatch estimates | ORCHESTRATOR.md §12 RQ2 "possible later upgrade" | — |
| C6 | Per-repo bot identities for org-level audit | ORCHESTRATOR.md §12 RQ4 "revisit with org-level audit" | part of #13 [icebox] |
| C7 | Hoist `@agentic/core` out of `frontend/` when a non-Node consumer appears | ORCHESTRATOR.md §9 "rejected for now… revisit" | — [icebox] |
| C8 | First tagged, versioned framework release | INTEGRATION.md §3/§11 (lockfile needs a real version to pin) | part of #8 and #12 |
| C9 | Renderer overlay support + path-relativity | INTEGRATION.md §4 "Renderer change required" | part of #8 |
| C10 | Decision pass over the docs' open-questions sections | FRONTEND.md §7, INTEGRATION.md §10 — some already implicitly decided | part of #14 |
| C11 | `GitHubSource` driver (remote-ready posture, second data source) | FRONTEND-PLAN.md §0/"later, out of scope now" | — [icebox] |
| C12 | `assigned_to` on escalation entries | FRONTEND-PLAN.md "deferred until a router exists" | — [icebox] |
| C13 | Watch: operators tripping on the session-restart requirement for new agents | wordfreq retro, G0 note | — [watch] |

## Draft issue bodies

### C1 — Finish the M1 shadow bar: two more shadow-agreement runs

> **Outcome:** The M1 exit criterion (ORCHESTRATOR.md §10, resolved question 3) is met: across **three** full v0 runs, `shadow` replay shows the engine's derived action matching the human orchestrator's actual action, with every disagreement dispositioned as an engine bug or a design finding.
>
> **Status:** 1/3 — the wordfreq replay is done (`frontend/packages/orchestrator/shadow-wordfreq.md`). Two more v0 runs need to be executed and replayed.
>
> **Why it matters:** M1 is the evidence layer under the autonomy gate; M2+ live now, but the shadow bar is what makes "the engine derives what a competent human does" a measured claim instead of a vibe.
>
> Part of the v1 trust ladder (successor to #9).

### C2 — Verify live copilot-cli dispatch; replace static-estimate metering with real usage

> **Outcome:** M3's exit criterion (ORCHESTRATOR.md §10) is demonstrated live: a run's Reviewer and Verifier execute on a different vendor than its Implementer via the copilot-cli headless dispatcher. If Copilot CLI exposes per-invocation usage, the manifest's `usage_report` moves from `static-estimate` to real parsing; if not, the static fallback is documented as permanent-for-now with the ledger consequences stated.
>
> **Status:** The dispatcher, router (`avoid_vendor_of`), and manifest exist and are tested against fakes; no live copilot-cli dispatch has been observed (adapter manifest `_comment_headless`).
>
> Part of the v1 trust ladder (successor to #9; metering residual of #10).

### C3 — CI-triggered orchestrator variant

> **Outcome:** The orchestrator's `tick` runs from scheduled + event-dispatched CI workflows (GitHub Actions first), so a repo can be reconciled without any resident process or operator machine.
>
> **Design position:** ORCHESTRATOR.md §10 — "Triggers are already an interface; a CI-triggered variant slots in without engine changes." Deliberately out of scope until local v1 has earned trust; this issue is the parking spot for that trigger condition.
>
> **Trigger to adopt:** local v1 completing real runs with majority-confirmation gate burden (the §7 promotion criterion).

### C4 — Dispatch-guard posture for the orchestrator CLI

> **Outcome:** A bare `tick`/`watch` against a repo with active runs cannot dispatch real agents by surprise. Options to evaluate: `--dry-run` as the no-flag default with `--live` opt-in; an explicit run allowlist (`--only <slug>`); or a confirmation prompt when a tick would launch N > 0 dispatches interactively.
>
> **Why:** every dispatch spends real money and writes bookkeeping commits to run branches. The engine is correct-by-design about *what* it does; this is about *when an operator intends it*. Observed during development: a casually-issued `tick` immediately dispatched agents onto two waiting runs.
>
> **Tension to resolve:** v1's whole point is unattended reconciliation, so the guard must not tax the sanctioned resident/cron form — this is CLI ergonomics, not engine policy.

### C5 — Trailing-ledger-average dispatch estimates

> **Outcome:** The pre-flight budget check can use a trailing average of the role's actual metered costs (from `budget.ledger[]` history across merged runs) instead of the registry's static `dispatch_estimates_usd`, falling back to static when history is thin.
>
> **Design position:** ORCHESTRATOR.md §12, resolved question 2 — static was chosen for v1, trailing averages named as the possible later upgrade. Adopt when static estimates demonstrably mis-gate (false budget pauses or blown caps).

### C6 — Per-repo bot identities for org-level audit

> **Outcome:** Orchestrator installs can be configured with per-repo (or per-team) bot identities so org-level audit can attribute machine writes to a deployment, not just "an orchestrator".
>
> **Design position:** ORCHESTRATOR.md §12, resolved question 4 — one identity per install for v1; revisit with org-level audit. Belongs to the Future Consideration #1 track (#13); icebox until that epic activates.

### C7 — Hoist `@agentic/core` when a non-Node consumer appears

> **Outcome:** `@agentic/core` moves from `frontend/packages/core` to a top-level shared package the moment something outside the frontend workspace needs it.
>
> **Design position:** ORCHESTRATOR.md §9 rejected the hoist "for now — a real restructure buying no capability today; revisit when a non-Node consumer of core appears." This issue is the tripwire; icebox until the trigger fires.

### C8 — First tagged, versioned framework release

> **Outcome:** A tagged release (version scheme decided, tag pushed, release notes) that `integrate.py`'s lockfile can pin and downstream consumers can name.
>
> **Why:** INTEGRATION.md §3 — "what travels is a tagged release, not a working copy"; §11 lists this first in v0 build phasing because the lockfile's `version` field "needs something real to pin before the first arms-length adoption." Also the concrete first artifact of open-source release readiness (#12).
>
> Part of #8 and #12.

### C9 — Renderer overlay support + path-relativity

> **Outcome:** `render-agents.py` composes each agent body as *role spec + `overlays/_all.md` + `overlays/<role>.md`* with marked splice boundaries, and resolves paths relative to its own location so the same script runs vendored in a host repo (INTEGRATION.md §4).
>
> **Why:** the prerequisite mechanical piece of the integration workflow — it makes the "policy written into one adapter" failure mode structurally impossible. Stdlib-only, Python 3.9+, as today.
>
> Part of #8.

### C10 — Decision pass over the docs' open-questions sections

> **Outcome:** FRONTEND.md §7 and INTEGRATION.md §10 no longer carry "open questions for team review" whose answers exist implicitly. Each question gets a recorded decision (or an explicit "still open because X"), in the docs' own resolved-questions style (ORCHESTRATOR.md §12 is the pattern).
>
> **Examples already implicitly decided:** FRONTEND Q1 (Stage B ergonomics from day one — the local-first build answered yes); INTEGRATION Q5 leans recommended-in-doc.
>
> Part of #14 (design-debt burn-down).

### C11 — `GitHubSource` driver

> **Outcome:** The frontend's `RunSource` interface gets a GitHub-API implementation, delivering the "local-first, remote-ready" posture's second half: the app reads/writes runs in repos it has no local clone of.
>
> **Design position:** FRONTEND-PLAN.md scoped it out of the local-first build ("later, out of scope now") with the driver seam built for it. Icebox until a concrete need (hosted deployment or a clone-less reviewer) appears.

### C12 — `assigned_to` on escalation entries

> **Outcome:** `contracts/state.yaml` escalation entries support an optional `assigned_to`, and the frontend inbox routes/filters on it.
>
> **Design position:** FRONTEND-PLAN.md deferred it "until a router exists" — i.e. until gate duty is shared across humans (FRONTEND.md Stage C trigger). Icebox with that trigger.

### C13 — Watch: session-restart trips for newly rendered agents

> **Outcome (watch item):** Evidence gathered on whether operators still trip on the requirement to restart a harness session after creating/editing rendered agents (wordfreq retro, G0 note; docs clarified in b7e97a5). If it recurs, the fix is likely a WALKTHROUGH callout or a render-script printout, not a code change.
