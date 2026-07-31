# Human Interface Design — the Gate Frontend

**Status:** v0.2 — the architecture and implementation plan exists
([FRONTEND-PLAN.md](FRONTEND-PLAN.md)), and Stage C's *UX* has been pulled
forward as a local-first build (`packages/`): the decision inbox, portfolio,
gate cards with burden capture, the `gateline` CLI, metrics, and PR-approval
sync — all while refusing Stage C *infrastructure* (no hosting, no auth, no
store; reads address git refs, writes are CAS commits to `state.yaml`). The
staging logic below is unchanged: Stage A remains what a fresh adopter can run
with zero build, and the §6 promotion triggers still say when the hosted
multi-team Stage C is worth its weight.
**Prerequisite reading:** [DESIGN.md](DESIGN.md) (esp. §4 gates, §7 operating modes),
and the pilot plan (maintained outside this repository)

---

## 1. What "frontend" means for this system

The backend's central decision — pipeline state is durable, typed files in git — was
made for the agents. This document asks what it buys the *humans*. The frontend is not
a chat window onto the swarm; it is the set of surfaces through which humans perform
their contractual interactions with the pipeline. Enumerating those interactions from
`contracts/state.yaml` and the role specs gives the full requirements list:

| # | Interaction | Kind | Today (v0) |
|---|-------------|------|------------|
| I1 | Author an intent brief | input | write `intent-brief.md` by hand |
| I2 | Approve/decline gates G0–G3 | decision | read artifacts, edit `state.yaml` |
| I3 | Resolve escalations (round-cap, ambiguity, `unverifiable`) | decision | notice them, somehow |
| I4 | Resume/kill budget- or gate-paused runs | decision | edit `state.yaml` |
| I5 | Watch in-flight runs; steer/restart a bad dispatch | awareness | watch the harness session |
| I6 | Portfolio view across runs (later: across teams/repos) | awareness | `ls runs/` |
| I7 | Dispatch agents (v0 human orchestrator only) | operation | Claude Code session |
| I8 | Record retro metrics (gate burden, rounds, cost) | learning | write `retro.md` by hand |

Two structural observations drive everything below:

1. **This is an inbox-and-review-queue problem, not a chat problem.** I2–I4 are
   asynchronous decisions on packets of evidence, arriving from multiple concurrent
   runs, needing routing to a *named* human, and needing their outcome recorded
   durably. That is the shape of a code-review queue or an approvals inbox — a
   well-studied shape — not the shape of a conversation.
2. **The human is the system's deliberate bottleneck, so the frontend's metric is
   decision quality per human-minute.** The contracts already optimize the *content*
   for this (concision budgets, required sections, evidence-for-failures-only). The
   frontend's job is discovery, presentation, routing, and recording — it should never
   need to add content.

A useful lens from the human-in-the-loop literature is the three-tier gate model —
auto-approve / notify / block ([StackAI](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation),
[Cloudflare](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/)).
Our design already made those choices at the right altitude: agents are autonomous
*within* a phase (tier 1), `state.yaml` transitions are visible (tier 2), and G0–G3 +
escalations are hard blocks (tier 3). The frontend must preserve that economy — the
approval-fatigue literature is unambiguous that per-action approval collapses into
rubber-stamping (one documented team hit 200+ requests/day and a near-perfect approval
rate with no real oversight —
[Waxell](https://waxell.ai/blog/ai-agent-approval-workflows),
[aipatternbook](https://aipatternbook.com/approval-fatigue)). Four gates per run plus
risk-triggered escalations is the already-batched cadence; nothing in the frontend
should ever surface a finer-grained approval.

## 2. What we get for free from GitHub (the pilot case)

The pilot project's existing PR/CI/promotion machinery, mapped in the pilot plan §1,
covers the decision interactions unevenly well:

| Interaction | GitHub primitive | Fit |
|-------------|------------------|-----|
| **G2** | PR review: diff + committed `review-report.md` / `verification-report.md` on the run branch; branch protection + required reviewers; CODEOWNERS routing; CI checks as deterministic pre-gates (pre-commit, SonarQube) | **Excellent.** G2 *is* a PR review. Named-human approval, audit trail, and "CI green before human eyes" all come built in |
| **G3** | Environments with required reviewers / deployment protection rules; `workflow_dispatch` promotion | **Excellent.** The pilot already promotes to prod via on-demand workflows; adding a protected `prod` environment makes G3 a recorded GitHub approval |
| **G0/G1** | Open the run's PR as a **draft at run start**; spec/plan land as early commits; G0/G1 are reviews of docs-only diffs, with PR comments as the correction channel | **Good, with friction.** Reviewing "is this what we want?" as a file diff works (we do it for design docs today) but requirement-level commenting is clumsy, and approving a *commit range* isn't a first-class GitHub act — the gate record still lives in `state.yaml` |
| I1 intent | Jira ticket (the pilot already requires a ticket key on every change); issue forms elsewhere | **Good** — intake exists; the brief is a transcription step |
| I3 escalations | Nothing native. A PR comment or label can *carry* one, but nothing routes or ages it | **Poor** |
| I5/I6 monitoring | Agent HQ / mission control ([github.blog](https://github.blog/news-insights/company-news/welcome-home-agents/), [orchestration guide](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/)) — assign, steer, and track agents from web/VS Code/CLI/mobile | **Partial, and strategically misaligned** — see below |
| I8 metrics | PR timestamps give review latency; nothing knows about gate burden, rounds, or cost | **Poor** |

**The Agent HQ caveat.** GitHub's mission control is the platform's answer to exactly
our I5/I6 — and it manages *sessions of GitHub-integrated agents* (Copilot plus
vendor agents running in GitHub's harness). Our pipeline is artifact-driven and
harness-plural by principle (P2/P3): roles bind to models per the registry, and run
in whichever adapter the team chose. Committing our monitoring surface to Agent HQ
would couple us to one runtime exactly the way we refused to couple roles to one
vendor. Use it opportunistically (if a dispatch happens to run as a Copilot coding
agent, its session view is free); don't build on it as *the* frontend. The
harness-neutral thing to monitor is the thing we own: `state.yaml`.

**Rule that keeps GitHub-native workable: the gate record is written twice, but one
home is canonical.** A G2 approval exists as a PR review *and* as a `gates.G2` entry.
`state.yaml` stays canonical (it must — G0/G1 have no first-class GitHub act, and
portability demands it), and the sync is mechanical: a tiny CI job or CLI copies
PR-approval facts into `state.yaml`. Accepting untracked drift here would quietly
break the audit-trail property that justified files-in-git in the first place.

## 3. What other existing platforms cover cheaply

- **Chat (Slack) as the notification bus — never the decision surface.** Phase
  transitions, gate-ready packets, escalations, and budget pauses become webhook
  posts with links into the run. The ChatOps temptation to *approve from Slack* should
  be resisted at first: a decision made where the evidence isn't is how rubber-stamping
  starts, and the packet (spec, plan, diff, reports) doesn't render in a chat message.
  Revisit only for the lowest-stakes acks (e.g., resuming a budget pause).
- **Jira** stays the intent-intake and prioritization surface for the pilot (I1). The
  pipeline doesn't need its own backlog; `intent-brief.md` references the ticket.
- **The harness UIs are the orchestrator's cockpit (I7), and only that.** Claude Code
  (desktop workspaces with parallel sessions, agent teams —
  [docs](https://code.claude.com/docs/en/agent-teams)) is where the v0 human
  orchestrator dispatches and steers. This is genuinely good now — parallel-session
  management got first-class UI in 2026 — and we should ride it. Its limits define
  the dashboard's job, §5.
- **Purpose-built approval-inbox tooling** (LangChain's
  [Agent Inbox](https://github.com/langchain-ai/agent-inbox), HumanLayer,
  Microsoft Agent Framework's request/response interrupts —
  [Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop))
  validates the *pattern* — a Gmail-like queue of interrupts, each with
  accept/edit/reject/respond affordances configured per interrupt type. But each is
  coupled to its runtime's interrupt mechanism. Our "interrupt" is a file state
  (`phase` awaiting a gate; an `escalations[]` entry with `resolved: false`), so the
  pattern ports; the tooling doesn't. Borrow the UX, not the stack.

## 4. Design principles for the human side

Distilled from the review-at-scale literature and our own retro data; these are the
requirements a frontend will be judged against, whatever its form:

1. **Deterministic gates run before human attention is spent.** CI, linters, contract
   well-formedness ("required section missing → bounce") must fail *before* a gate
   packet reaches a person ([Rollbar](https://rollbar.com/blog/ai-pull-requests/),
   [Intercom](https://www.intercom.com/blog/ai-is-approving-our-pull-requests-heres-how-we-made-it-safe/)).
   We have this in contract form; the frontend must enforce it in queue form: a
   malformed packet never renders as reviewable.
2. **The gate card states: what, why, what changes, how it was verified, how to undo.**
   Our artifacts *are* this packet (spec ← brief; plan ← spec; diff + review +
   verification; release + rollback plan). The frontend renders the packet and the
   decision affordances — approve / approve-with-notes / decline-with-reason — and
   nothing else. Per-gate affordances differ (G0 wants "edit the spec" more than G2
   wants "edit the diff"), echoing Agent Inbox's per-interrupt config.
3. **Decisions are recorded with name, timestamp, and correction category as a side
   effect of deciding.** Gate burden (confirmation / light / heavy correction) is the
   pilot's headline metric and the v1 promotion criterion; if capturing it is a
   separate manual step it will silently not happen, exactly as `cost_spent_usd`
   didn't in the wordfreq run.
4. **Watch the approval rate.** Sustained >90% approvals at some gate means that gate
   is over-triggering (or reviews have gone reflexive) and its scope should move down
   the tier ladder ([Permit.io](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo),
   [Waxell](https://waxell.ai/blog/ai-agent-approval-workflows)). This is the
   trust-ladder mechanism from DESIGN.md §7 made measurable: gates don't disappear at
   v1, they get cheaper as their approval rates earn it.
5. **Escalations age visibly.** An unresolved escalation is a stalled run burning
   nothing but calendar; the queue must show age and route to a person, not a channel.
6. **Every rendered view is disposable.** The repo is the database. Any frontend that
   accretes state of its own (its own approval store, its own run status) has forked
   the source of truth and will drift, like `review_rounds` did across two files in
   the wordfreq run.
7. **A local view earns its place only by saying something the git host structurally
   cannot.** The test is not "does the host also do this?" — the host does almost
   everything also. It is whether the view depends on knowledge the host does not
   have: the run's profile, its gate packet, a work item's declared file-contact
   surface, the decision grammar in `state.yaml`. A view that passes renders here. A
   view that fails is a commodity re-implementation that will stay permanently worse,
   and it should link out instead.

### 4.1 Which views Gatehouse owns (#259)

Principle 7 was adopted to settle a concrete question: do the Diff and History views
belong in Gatehouse, or are they a second-rate copy of the host every adopter already
has open? **Decision: keep derived, gateline-specific views and retire the generic
ones.** Neither view is deleted before its replacement or its link-out exists.

Applying the test to what we had:

- **A unified-diff renderer fails.** It offers no syntax highlighting, no
  expand-context, no blame, and no review comments, and it never will.
- **A diff scoped to the task's `file_contact_surface`, with out-of-surface hunks
  called out, passes.** No host can compute it, because no host knows the work item.
  It makes the Reviewer's `Boundary check` section checkable. **Taken, in #269 and
  #270.** `view-model/tasks.ts` parses the work item, `view-model/surface-diff.ts`
  labels each changed file with the items that declared it, and the diff renders in
  those groups with the undeclared files leading. The labelling never filters:
  `declaredBy` is positional against the whole diff, so scoping is not truncation.
  Presence holds — the view states that a file falls under no declared surface, and
  says in as many words that whether that is a breach or an amendment the plan
  already carries is the Reviewer's section and the approver's call.
- **A commit log fails.** Time, subject, author, and short oid are the host's job.
- **`state.yaml`'s history as a decision ledger passes.** Phase transitions, gate
  approvals under the `G<N> approved by <name>` grammar, and the orchestrator's own
  verbs are concepts the host has no representation for.

Three facts about the current code set the real order of work, and two of them run
opposite to the intuition:

- The History view is **already half a ledger** — it marks phase transitions from each
  commit's `state.yaml`. The decision data is already built and served, in
  `collectRunDecisions` and `GET /api/runs/:src/:slug/decisions`, and History simply
  does not read it. Converting it is wiring, not a rebuild.
- The scoped diff was **further away than it looked**. `file_contact_surface` is
  written by `record/scaffold.ts` and required by `record/validate.ts`, and nothing
  parsed `tasks/*.yaml` into the view model. It needed a browser-safe core leaf
  first, the way typed review parsing did — which is why it landed as two issues,
  #269 for the leaf and #270 for the view.
- **The link-out could not be added naively.** `ensureDraftPr` lives in
  `core/src/sources/`, returns only `{ status, note }`, and discards the PR's
  identity. Nothing persists a PR number, so a PR URL is not committed state and the
  view model may not hold one without either a network call or a record-shape change.
  Deleting a view before the link exists strands the approver, so the link-out came
  first.

That last point forked, and one arm of it is a one-way door:

- **Link to the branch, not the PR** — derivable from `remote.origin.url` plus the
  run's branch, with no record change and no network call. The host's branch page
  surfaces the associated PR itself. **Taken, in #267.**
  `view-model/host-link.ts` is a pure function of the origin URL and the branch,
  `RunSource.originUrl()` supplies the former, and the run header renders the result.
  Nothing resolves that cannot be resolved without guessing: a non-github.com remote
  (Enterprise, GitLab and Gitea share one URL shape), a source with no origin, a
  local-only source, and a merged run whose branch is gone all yield no link, and the
  page keeps its local view.
- **Persist PR identity into the record** — makes it committed state and keeps
  derivation pure, but changes the record shape, which is a format-freeze decision.
  Still open, still #248.

Two costs are accepted explicitly rather than left to degrade:

- **The diff is contractually part of G2's packet** (DESIGN.md §4). It stays renderable
  in Gatehouse for that reason. Retiring the *generic* renderer is not the same as
  moving a gate artifact off-site.
- **Local-only sources have no PR to link to.** `resolveMode` supports them as a
  first-class tier, so every link-out affordance must degrade to the local view rather
  than to a dead end.

### 4.2 The run page's surfaces (#258)

The run page offers three surfaces, and they are named for what a human does, not for
where the bytes are kept. The bar they replaced — `Artifacts | Diff | History` — was a
filesystem listing standing in for the job at a gate.

- **Decide** — whatever is on the table, composed for the gate it belongs to. Present
  only while something needs a human, so a finished run is never offered an empty
  panel. The per-gate surfaces render inside it: the G2 packet (#256), and #255's and
  #257's when they land.
- **Record** — the artifact browser, and the change below it. The escape hatch, the
  fork fallback, and the answer to "show me the bytes": whatever a structured surface
  withholds itself over, the artifact it was reading is here in full.
- **History** — the decision ledger of §4.1.

Two consequences worth stating, because both were load-bearing before:

- **The change reads inside Record, not beside it.** It is not an artifact — nothing
  under `runs/<slug>/` produced it — so it sits under its own heading rather than in
  the file list, and it earns its place only as the surface-scoped view (principle 7).
  G2's packet still routes to it by the boundary fact, per §4.1.
- **A URL that names a retired tab still resolves, and is rewritten in place.**
  `?tab=artifacts` is the record, `?tab=diff` is the record with the change open, and
  a `?tab=decide` link that has aged out lands on the record. Links minted before the
  rename — the inbox's, the lexicon's, an approver's bookmark — keep working.

The page also had two layouts, forked on whether anything was pending, which is why
gate provenance and the vitals rows each existed in two shapes. That fork was a
symptom of not being able to predict what a state needs; #249 closed the gate and
profile vocabulary, so the prediction moved into the surface and one layout serves
both.

## 5. The dashboard question

**For one operator running one pipeline, a dashboard is overhead — Claude Code plus
GitHub already covers I1–I8 tolerably.** The honest version of the value curve: it
bends when (a) runs are concurrent, (b) gate duty is shared across humans, (c) more
than one repo hosts the framework. The pilot starts at none of those; the design
should assume all three arrive if the pilot succeeds.

What a custom frontend confers that Claude Code + GitHub cannot:

- **A portfolio view (I6).** N runs across M repos, each with phase, gate waits,
  escalations, budget state, task rollup — all derivable by parsing `runs/*/state.yaml`
  across repos. Neither a terminal session nor a PR list shows "what needs a human,
  everywhere, ranked by age."
- **A unified decision inbox (I2–I4)** with routing ("G2s for the pilot go to whoever owns
  that rotation"), SLA aging, and per-gate affordances — the Agent Inbox pattern over
  our file-based interrupts.
- **Metrics without a scribe (I8, principle 3).** Decision latency, gate burden,
  rounds, approval-rate trends, cost — captured because the decisions flow through the
  surface that records them.
- **Harness and vendor neutrality.** It renders `state.yaml`, so it is indifferent to
  which adapter ran the agents — the frontend analog of the registry (P2/P3), and the
  property Agent HQ can't offer.
- **A decision surface for humans who are not the orchestrator.** This is the deepest
  limitation of "manage the swarm in Claude Code": the harness session is a cockpit
  *occupied by one person*. Gate reviewers, escalation resolvers, and (Future
  Consideration #1) approvers up the org chart should not need terminal access to
  someone's live session to do their job — they need the packet, asynchronously, on
  any device. Claude Code is where work is *dispatched*; the frontend is where work is
  *judged*.

And what it must not do: orchestrate. Dispatching stays in the harness (v0: human in
Claude Code; v1: the Orchestrator role under a scheduler). The moment the dashboard
issues dispatches it becomes an adapter with a GUI — a second orchestrator to keep
consistent with the first. One deliberate exception is worth considering at v1:
rendering a **"resume/pause run" control** that writes `state.yaml`, because
pause/resume is state, not dispatch.

**The payoff of P1 is that this frontend is architecturally trivial.** Because the
backend put all state in typed files in git, the dashboard is a *renderer of the
repo*: a stateless read layer over `state.yaml` + artifacts, plus exactly one write
path — gate/escalation decisions committed back as `state.yaml` edits (via GitHub API
commits, so provenance is a signed commit by a named human). No database, no queue,
no sync protocol. Compare the build cost of that against any orchestration platform
and the "should we build" question mostly answers itself — *provided we stage it*.

## 6. Recommended shape: three stages with promotion criteria

Evidence-gated stages, in the same spirit as the pilot phases. Each stage is fully
usable; each promotion is triggered by felt pain, not anticipation.

**Stage A — GitHub-native + harness cockpit (the pilot runs on this; build ≈ 0).**
G2 = protected PR review; G3 = protected environment + `workflow_dispatch`; G0/G1 =
review on the run's draft PR, decision hand-recorded in `state.yaml`; Slack webhook
notifications for phase transitions and escalations (a ~20-line CI step); intent from
Jira. Orchestrator drives from Claude Code. Gate burden logged manually per
the pilot plan §6. *Purpose:* generate the evidence that says which frictions are real.

**Stage B — gate CLI + generated status page (build ≈ days, no server).**
Two small tools, both repo-resident:
1. `gateline` CLI: `status` (render runs' state), `approve G1 --notes …` /
   `decline` / `resolve-escalation` — writes the `state.yaml` entry with name (from
   git config), timestamp, and prompted correction-category, then commits;
   `resolve-escalation` also takes an optional `--disposition` naming a
   machine-actionable route (`re-review` | `return-to-implement` | `re-plan`,
   ORCHESTRATOR.md §4.2) the v1 orchestrator acts on. Kills the hand-editing error class and makes
   principle 3 real. Also the natural home for the PR-approval → `state.yaml` sync
   (§2).
2. A static dashboard: CI renders `runs/*/state.yaml` (across the repos that carry
   the framework) into a static site — portfolio table, per-run detail, inbox-ordered
   "needs a human" list with ages. Read-only; decisions still happen via PR review or
   the CLI. Hosted on GitHub Pages (org-private).
*Promotion trigger from A:* first time two runs are in flight at once, or the first
gate decision mis-recorded by hand.

**Stage C — live decision inbox (build ≈ weeks; only under multi-team demand).**
A small hosted app that adds what static rendering can't: authenticated decision
actions (the single write path, as API commits), routing/rotation for gate duty, SLA
aging and paging on stalled escalations, approval-rate and gate-burden trend charts,
cost meters fed by the automated metering that v1 requires anyway. This — not Stage
B — is where "a group of teams of humans" is served: approver pools, per-team
portfolio filters, org-level policy hooks ("G3 requires release authority") from
DESIGN.md §11. *Promotion trigger from B:* gate duty shared by ≥3 humans or framework
live in ≥3 repos, and Stage B's inbox demonstrably missing SLAs.

The staging protects the key property: at every stage the repo remains the only
database, so any stage can be abandoned without losing state, and the Stage C app is
replaceable mid-flight — the same replaceability argument DESIGN.md §1 makes for
agents.

## 7. Open questions for team review

1. **G0/G1 surface** — is draft-PR review of spec/plan commits acceptable ergonomics
   for the pilot, or do those gates need a rendered view (Stage B) from day one?
2. **Slack decision affordances** — hold the "never decide in chat" line strictly, or
   allow budget-resume (I4) as the one chat-actionable decision?
3. **Approval-rate policy** — adopt the >90%-means-over-triggering heuristic as a
   standing retro check per gate?
4. **Stage C build-vs-adapt** — if we reach Stage C, do we build the thin renderer or
   re-evaluate whatever Agent HQ/Agent Inbox-class tooling exists then? (The write
   path and `state.yaml` canonicality are non-negotiable either way.)
5. **Org identity** — when gate approver pools arrive (Future Consideration #1), is
   GitHub org/team membership the identity source, or does the registry grow an
   approvers section?

---

## Sources

- [GitHub — Introducing Agent HQ](https://github.blog/news-insights/company-news/welcome-home-agents/) and [How to orchestrate agents using mission control](https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/)
- [LangChain Agent Inbox](https://github.com/langchain-ai/agent-inbox); [LangChain — interrupt() for HITL agents](https://www.langchain.com/blog/making-it-easier-to-build-human-in-the-loop-agents-with-interrupt)
- [Microsoft Agent Framework — Human-in-the-loop workflows](https://learn.microsoft.com/en-us/agent-framework/workflows/human-in-the-loop); [Cloudflare — HITL patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/)
- [StackAI — Designing approval workflows](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation); [Permit.io — HITL best practices](https://www.permit.io/blog/human-in-the-loop-for-ai-agents-best-practices-frameworks-use-cases-and-demo)
- [Approval Fatigue — Encyclopedia of Agentic Coding Patterns](https://aipatternbook.com/approval-fatigue); [Waxell — AI agent approval workflows](https://waxell.ai/blog/ai-agent-approval-workflows)
- [Intercom — AI is approving our pull requests](https://www.intercom.com/blog/ai-is-approving-our-pull-requests-heres-how-we-made-it-safe/); [Rollbar — Auditing AI-written PRs without burning out](https://rollbar.com/blog/ai-pull-requests/)
- [Claude Code — Agent teams](https://code.claude.com/docs/en/agent-teams)
