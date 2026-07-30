# gateline — Design

**Status:** v0.2 — the design has been exercised end-to-end by three human-orchestrated
G0→G3 runs (`runs/wordfreq/`, `runs/mdtoc/`, `runs/dupefind/` — the shadow-agreement
evidence for the v1 trust ladder), and since then by orchestrator-driven runs against
the framework itself (`runs/creation-seam/`, `runs/web-staging/`, `runs/fleetview-design/`);
the gate frontend and the v1 orchestrator it describes in §7 are implemented (`packages/`)
**Audience:** senior engineers moving from single-stream AI pair-programming to multi-agent, semi-autonomous development

---

## 1. The shift this design makes

In the chatbot workflow you all know, the developer is the integration point: you hold
the plan in your head, feed the model context piece by piece, and validate every output
before it touches the repo. That works — but it caps throughput at one conversation, and
none of the intermediate reasoning survives the session.

This design moves the integration point out of anyone's head and into **durable, typed
artifacts committed to git**. Agents do not share a conversation; they share contracts.
Each role consumes specific artifacts, produces specific artifacts, and a human approves
at phase boundaries. The pipeline's state *is* the repo.

Three consequences fall out of that one decision:

1. **Any agent is replaceable mid-flight.** If an implementer produces garbage, you
   discard its branch and re-run the work item — the spec and plan it worked from are
   unchanged on disk. No conversation state is lost because no conversation state matters.
2. **Models and runtimes are swappable independently of roles.** A role spec says what
   the agent must consume, produce, and refuse to do. Which vendor's model executes it,
   and inside which harness, are bindings resolved at invocation time.
3. **The audit trail is free.** Every decision, review finding, and verification result
   is a file with git history. "Why did we build it this way?" has a `git log` answer.

## 2. Design principles

| # | Principle | What it rules out |
|---|-----------|-------------------|
| P1 | **Artifacts over conversation.** Agents hand off through typed files, never shared context. | Long-lived multi-agent chat rooms; "just paste the thread" |
| P2 | **Roles are contracts; models are bindings.** Role specs never name a vendor or model. | Hardcoding `claude-*` or `gpt-*` in a role definition |
| P3 | **Runtime-neutral core, thin adapters.** The `roles/`, `contracts/`, `registry/` trees are portable; each runtime gets a small adapter. | Designing around one CLI's features |
| P4 | **Human at phase gates.** Agents are autonomous *within* a phase; a named human approves transitions. | Unattended merge-to-main; unattended releases |
| P5 | **Decorrelate where it counts.** Reviewer and Verifier should bind to a *different vendor* than the Implementer whose work they check. | Same model grading its own homework |
| P6 | **Extend by adding roles, not tuning knobs.** New need → new role spec + contract. | Sprawling per-agent configuration surfaces |

P5 deserves a note: it is the strongest technical argument for the cross-vendor
requirement. Models from the same family share blind spots — an error the implementer's
model reliably makes is often an error the same model reliably fails to catch. Binding
review/verification to a different lineage decorrelates failure modes cheaply.

## 3. The role roster

The SDLC distills to eight operations: capture intent, decide approach, build, check
correctness, check quality, integrate/release, operate, and remember. We map them to
eight core roles. Remembering is distributed at write time — every role appends to the
decision log — and owned at read time by the Historian, which periodically reconciles
the surrounding prose (docs, changelog, tracker) with that record.

| Role | Mission (one line) | Capability profile | Consumes | Produces |
|------|--------------------|--------------------|----------|----------|
| **Orchestrator** | Decompose intent, route work, track pipeline state, escalate at gates | frontier-reasoning | intent, all state | `state.yaml`, dispatches |
| **Analyst** | Turn raw intent into a testable spec with acceptance criteria | balanced | intent brief | `spec.md` |
| **Architect** | Technical plan, interface contracts, work breakdown, ADRs | frontier-reasoning | `spec.md`, repo | `plan.md`, `tasks/*.yaml` |
| **Implementer** | Execute one work item on a branch; make the acceptance tests pass | balanced | one `task.yaml`, `plan.md` | branch + diff, task notes |
| **Reviewer** | Adversarial review of a diff against spec, plan, and standards | frontier-reasoning (≠ implementer vendor) | diff, `spec.md`, `plan.md` | `review-report.md` |
| **Verifier** | Independently exercise behavior end-to-end; author missing tests | balanced (≠ implementer vendor) | diff, `spec.md` | `verification-report.md` |
| **Ops** | CI/CD, environments, release plan, rollback plan | balanced | verified diff, infra | `release-plan.md` |
| **Historian** | Scheduled sweep: reconcile docs, changelog, and tracker with the run record | fast-cheap | run artifacts since last sweep, docs, tracker | `docs-delta.md` + doc edits |

Notes on the roster:

- **Orchestrator is a role, not a requirement.** In v0 operating mode a human plays it
  (see §7). Automating it is an upgrade, not a prerequisite.
- **Implementer is the only role that scales horizontally.** N implementers run in
  parallel on N independent work items; the Architect's job includes cutting tasks so
  their file-contact surfaces don't overlap.
- **Reviewer and Verifier are deliberately separate.** Review is reading (does this code
  say the right thing?); verification is running (does this system do the right thing?).
  Collapsing them recreates the rubber-stamp reviews we see in human teams.
- **Historian is the worked example of P6, and it landed as predicted:** when changelog
  and doc drift became painful, adding the role cost `roles/historian.md`, a
  `contracts/docs-delta.md` contract, and a registry binding — no change to any other
  role or contract. It differs from the gate roles in two deliberate ways: it is
  *scheduled*, not gate-driven (`orchestrator.yaml` `schedules:`; each sweep is a
  mini-run `runs/historian-<date>/` on its own branch), and its human approval is the
  sweep branch's review-and-merge rather than a numbered gate.

Full specs live in [`roles/`](../roles/) — one file per role, with mission, operating
instructions, definition of done, and explicit escalation triggers.

## 4. Workflow: phases and gates

```
            ┌──────────┐        ┌───────────┐        ┌──────────────────────┐        ┌─────────┐
  intent ──▶│ Analyst  │──G0───▶│ Architect │──G1───▶│ per task, in parallel │──G2───▶│  Ops    │──G3──▶ released
            │ → spec   │        │ → plan    │        │ Implementer → diff    │        │ → plan  │
            └──────────┘  ▲     │ → tasks   │  ▲     │ Reviewer   → report ⟲ │  ▲     └─────────┘  ▲
                          │     └───────────┘  │     │ Verifier   → report   │  │                  │
                        human               human    └──────────────────────┘ human             human
                       approves            approves        (loop ≤ 3)        merges           approves
```

| Gate | Question the human answers | Artifacts on the table |
|------|----------------------------|------------------------|
| **G0 — Spec** | "Is this what we actually want built?" | `intent-brief.md`, `spec.md` |
| **G1 — Plan** | "Is this how we'd want it built, cut into safe parallel pieces?" | `plan.md`, `tasks/*.yaml`, ADRs |
| **G2 — Change** | "Does the evidence support merging?" | diff, `review-report.md`, `verification-report.md` |
| **G3 — Release** | "Ship it?" | `release-plan.md`, rollback plan |

Rules that keep the loop safe:

- **Iteration cap.** Implementer ⇄ Reviewer cycles are capped at **3 rounds** per work
  item. Round 4 is an automatic escalation to the human with both sides' artifacts —
  agents arguing past three rounds are almost always stuck on an ambiguity in the spec,
  which is a G0/G1 defect, not an implementation defect.
- **Budget cap.** Each run carries a token/cost budget in `state.yaml`; exhaustion
  pauses the pipeline rather than degrading quality silently. In v1 every dispatch is
  metered automatically through the orchestrator's dispatch seam into
  `budget.ledger[]`, with a pre-flight cap check (ORCHESTRATOR.md §6) — the wordfreq
  pilot proved the earlier honor-system approach silently records nothing. *Remaining
  v0 gap:* in human-orchestrated mode the ledger entry after each dispatch is still
  hand-appended from harness usage output (WALKTHROUGH.md).
- **Gates are named humans, not "the team."** `state.yaml` records who approved what,
  when. This matters more as this generalizes up the org (Future Consideration #1).

### 4.1 Run profiles — ceremony scaled to the change

The pipeline above is one weight class: every run pays for a spec, a plan, an
adversarial review cycle, independent verification, and a release plan. That was
right for proving the design, but a two-line bug fix should not pay for it — and on
a real repository most work items are small. A **run profile** declares, per run,
which roles run and which gates exist. Three profiles, fixed sets, heaviest last:

| Profile | Roles that run | Gates | Phase sequence |
|---------|----------------|-------|----------------|
| `patch` | Implementer, Reviewer | G1, G2 | `plan → implement → integrate → done` |
| `standard` | Analyst, Architect, Implementer, Reviewer, Verifier | G0, G1, G2 | `spec → plan → implement → integrate → done` |
| `full` | all eight | G0, G1, G2, G3 | `spec → plan → implement → integrate → release → done` |

- **`patch`** — bug fixes and small bounded changes. The human authors the intent
  brief *and* a single work item (`tasks/01-*.yaml`) at init: the analyst/architect
  judgment being skipped is the human's to supply, not the engine's to improvise.
  G1 approves brief + work item together (the G0/G1 questions collapse into one
  "is this the change we want, scoped this way?"), then Implementer ⇄ Reviewer as
  usual, and G2 merges. No Verifier: wanting independent verification is itself
  evidence the change is `standard`-weight.
- **`standard`** — the workhorse for feature-sized changes that ship by merging.
  Everything up to and including G2; no Ops role and no G3, because for most repo
  work the merge *is* the release. Reach for `full` when deployment is a distinct,
  risky act needing a release and rollback plan.
- **`full`** — the complete pipeline above. The default: a run whose `state.yaml`
  carries no `profile:` field is a `full` run, so every existing run record and
  fixture keeps its meaning unchanged.

Mechanics and guardrails:

- **Declaration.** The profile is chosen in the intent brief (optional `Profile`
  line; absent → `full`) and recorded as `profile:` in `state.yaml` at run init —
  from then on `state.yaml` is authoritative. `gates:` carries exactly the
  profile's gates; a gate that doesn't exist for the profile is absent, never
  auto-approved.
- **Profiles are fixed sets, not knobs.** There is no per-run role toggle or
  gate toggle (P6, and the charter's flexibility-over-customizability). If a
  profile doesn't fit, pick the next heavier one.
- **Reduced profiles change the review baseline explicitly.** In `patch` there is
  no `spec.md`/`plan.md`; the intent brief and the work item are the standard the
  Reviewer reviews against, and the dispatch names them as such. Contracts are
  otherwise unchanged.
- **Upgrades are one-way and human-decided.** Scope growth discovered mid-run —
  an Implementer or Reviewer escalating "this exceeds the profile" (a plan-defect
  escalation in the existing grammar), or the human deciding at a gate — is
  resolved by the human editing `profile:` to a heavier value and resuming. The
  stateless reconciler then derives the backfill for free: under the heavier
  profile the missing artifacts (no `spec.md`, no G0 entry) make the run derive
  as needing the Analyst, exactly as if the run had started there. The upgrade
  edit adds the newly required gate entries (undecided); an absent entry parses
  as undecided anyway, so forgetting one degrades gracefully. Downgrading
  mid-run is forbidden — an engine that observes a profile lighter than the
  gates already decided escalates rather than guessing.

### 4.2 Closed vocabulary, open table — why the sets are fixed

The gate set and the profile set are closed vocabulary, not defaults. §4.1
states the rule ("fixed sets, not knobs"); this section records the reasoning,
because the pressure to make them configurable will recur — from adopters who
want one more gate, and from maintainers who fear having shipped one too few.

A run record is a set of claims. `profile: standard` claims exactly which gates
had to be decided, by name, before the run reached `done` — and that claim is
checkable only because the profile→gates mapping is fixed by the framework, not
by the deployment. Make the gate set configurable and every check degrades from
"were the required approvals given?" to "were the approvals this deployment
chose to require given?": the record stops being comparable across
repositories, and a reader must audit the configuration before the evidence
means anything. A control the adoptee can reconfigure certifies little. (The
pattern is familiar elsewhere: fixed-catalog compliance regimes versus
choose-your-own-commitments ones, and Kubernetes' conformance-certified core
versus its extension surface.)

The closed set is also what the machinery stands on:

- The v1 orchestrator is a stateless reconciler (ORCHESTRATOR.md): it derives
  the next action from files alone, which is tractable because the derivation
  table is exhaustive over a known gate vocabulary.
- Shadow replays of finished runs are comparable evidence for the trust ladder
  only if a gate means the same thing in every run they replay.
- The burden metric that gates autonomy (§7) averages over gate decisions; it
  is meaningless if G2 varies by deployment.
- Every gate is a claim on the scarcest resource in the design — attentive
  human judgment (the concision budgets in §5 exist to protect it). An open
  gate set inflates toward gates nobody attends, and a gate that is always
  approved is indistinguishable from no gate.

Roles are a different case, and the §3 roster hides a distinction worth making
explicit. Two kinds of role wear one name:

- **Evidence-bearing positions.** Implementer, Reviewer, Verifier, and the
  Orchestrator-as-emitter are positions the record's claims are *about*: the P5
  decorrelation claim is precisely "the parties that reviewed and verified were
  bound to a different vendor than the party that authored," and the record
  must name those positions for the claim to be stated at all. These are as
  closed as the gates.
- **Production roles.** Analyst, Architect, Ops, and Historian shape the
  quality of what lands on a gate's table, but no record-level claim depends on
  their identity: G0's meaning is "a named human approved this spec," not "an
  Analyst produced it." Here the roster is a curated realization, closed in
  this repository by governance (the AGENTS.md invariant: maintainer decision,
  recorded in an issue) rather than by anything structural — vocabulary growth
  stays maintainer-gated and versioned, never adopter-configured.

For host repositories adding roles through the overlay layer (INTEGRATION.md),
the extension rule that follows is: **open table, closed gates.** An
adopter-defined role may produce a contracted artifact that lands on an
*existing* gate's table as additional evidence; it may never mint, remove, or
substitute a gate. More roles mean richer gate decisions, not more gate
decisions. A host whose runs are not SDLC-shaped (the state contract's
core/extension split, INTEGRATION.md §4) may declare its own checkpoint
vocabulary, but those names live in the instance's declared namespace — never
`G<n>` — and carry whatever weight the instance assigns them; the framework's
profile claims are not available to them.

One more boundary, learned from practice: a role is a contract position —
defined by what it consumes, produces, and refuses to do, and by where it sits
relative to a gate — not a persona. A reusable prompt ("a designer to critique
this screen") that consumes nothing contracted and produces nothing contracted
is a useful *companion agent*, but it is not a role, and checking it into
`roles/` would dilute what membership there asserts. Companions belong in a
runner's native agent mechanism, outside the rendered set.

Last, the asymmetry that should govern any "did we forget a role or gate?"
worry. An omission is recoverable: adding a role costs three files (the
Historian precedent, §3), and adding a gate or profile is an additive, versioned
revision. Configurability is not recoverable: once adopters treat the
vocabulary as knobs, every deployment is a bespoke variant, and no later
release can restore comparable meaning. When in doubt, ship the smaller fixed
set.

## 5. Artifact contracts

Every handoff artifact has a template in [`contracts/`](../contracts/). Templates are
deliberately short — they specify *required sections*, not prose style. An artifact
missing a required section is malformed and the consuming agent's first duty is to
bounce it, not to guess.

Contracts also carry **budgets**: concision is a contract property, not a style hope.
The rules are uniform — never restate an artifact you can reference (requirement
numbers, file:line); evidence is pasted in full only for failures; no process
narrative. This matters three ways: verbose artifacts dilute the signal for their
model readers and beget verbose downstream artifacts (agents mirror the register they
read), they tax the gate humans who are the system's deliberate bottleneck, and they
are paid for repeatedly — once as output, then as input to every downstream reader.

| Artifact | Producer → Consumer | Contract |
|----------|--------------------|----------|
| `intent-brief.md` | Human → Analyst | problem, motivation, constraints, out-of-scope |
| `spec.md` | Analyst → Architect, Reviewer, Verifier | requirements (numbered), acceptance criteria (testable), out-of-scope |
| `plan.md` | Architect → Implementers, Reviewer | approach, interface contracts, ADRs, risk notes |
| `tasks/NN-slug.yaml` | Architect → one Implementer | scope, files expected to change, acceptance tests, dependencies |
| `review-report.md` | Reviewer → Implementer, gate G2 | verdict, findings (severity-ranked, file:line), what was checked |
| `verification-report.md` | Verifier → gate G2 | what was exercised, evidence (commands + output), gaps |
| `state.yaml` | Orchestrator → everyone | phase, task statuses, gate approvals, budgets |

A run's artifacts live under `runs/<slug>/`, committed on the run's branch. See
[`runs/README.md`](../runs/README.md) for the layout.

## 6. Model binding — the cross-vendor mechanism

Roles declare a **capability profile**, not a model. [`registry/models.yaml`](../registry/models.yaml)
resolves profiles to concrete vendor/model IDs, and binds each role to a profile (with
optional per-role vendor pins to enforce P5 decorrelation).

```
role spec ──capability_profile──▶ registry profile ──default/alternates──▶ vendor/model ID
```

Swapping vendors — because of pricing, a new release, or an org policy — is a one-file
change in the registry. No role spec, contract, or adapter changes. Profiles:

- `frontier-reasoning` — deepest available reasoning; used where judgment concentrates
  (architecture, review, orchestration). Cost-insensitive by design: these roles emit
  few tokens but their errors are the expensive ones.
- `balanced` — strong general capability at moderate cost; the workhorse tier
  (implementation, verification, analysis).
- `fast-cheap` — high-volume, low-stakes work (triage, formatting, summarizing state).
  No core role binds here yet; it exists for extension roles.

## 7. Operating modes: v0 → v1

**v0 — human-orchestrated (start here).** A human plays Orchestrator: writes the intent
brief, invokes each agent in sequence, moves `state.yaml` through phases, approves gates.
Every other role is an agent. This mode exists so the team builds a calibrated sense of
where agents are strong before granting routing autonomy — the same trust ladder you'd
apply to a new hire.

**v1 — agent-orchestrated.** The Orchestrator role is bound to a model and a scheduler
(cron, CI trigger, or long-running session). Humans interact only at gates. Promotion
criterion: the team has run enough v0 cycles that gate reviews have become
confirmations rather than corrections. The v1 design — a stateless reconciler over
`state.yaml` with an adapter-shaped dispatch seam and automated budget metering — is
specified in [ORCHESTRATOR.md](ORCHESTRATOR.md) and implemented in
[`packages/orchestrator`](../packages/orchestrator/) (runbook in
its README; WALKTHROUGH.md closes with the v1 form of the same pipeline). Autonomy
remains gated on the promotion criterion, measured by the frontend's burden metric.

The role specs are identical in both modes — only who executes `orchestrator.md` changes.

## 8. Runtime adapters

The core trees (`roles/`, `contracts/`, `registry/`) are runtime-neutral. An adapter
maps them onto a specific harness:

| Adapter | Status | What it maps |
|---------|--------|--------------|
| [`adapters/claude-code/`](../adapters/claude-code/) | **Built (the skeleton)** | role specs → `.claude/agents/*.md` subagents; runnable today by every operator |
| [`adapters/copilot-cli/`](../adapters/copilot-cli/) | **Built** | role specs → `.github/agents/*.agent.md` custom agents; also the adapter that fully honors P5 — Copilot CLI hosts Anthropic/OpenAI/Google models natively, so Reviewer/Verifier bind to a genuinely different vendor than Implementer |
| [`adapters/opencode/`](../adapters/opencode/) | **Built** | role specs → `.opencode/agents/*.md` agents, scoped by deny-by-default permission maps; the any-provider adapter — opencode spells models as `provider/model-id` across its full provider catalog (including local models), so any registry binding or P5 pin is expressible per role |
| *(orchestrated dispatch)* | **Resolved — no separate adapter tree** | v1's orchestrator is a framework component that consumes the adapters above through a `headless` section in each manifest (invocation template + usage-report parsing spec); a new runner still costs one manifest. See [ORCHESTRATOR.md](ORCHESTRATOR.md) §5 |

Adapter rule: an adapter may *narrow* a role (fewer tools, tighter permissions) but
never *widen* it. The role spec is the ceiling.

Adapter agent files are **rendered, not written**: `scripts/render-agents.py`
generates them from the role specs plus a per-adapter `manifest.json` (frontmatter
shape, abstract-capability→tool map, runner model spellings), and a CI check fails
stale renders. A new runner costs one manifest (~30 lines); the roles are never
restated per-runner.

## 9. Failure modes and mitigations

| Failure mode | Mitigation |
|--------------|------------|
| Correlated blind spots (implementer's bug invisible to same-family reviewer) | P5: vendor decorrelation pins in the registry |
| Infinite implement/review loops | 3-round cap → human escalation (§4) |
| Context contamination (agent B inherits agent A's mistaken assumptions) | P1: artifacts only; no shared conversations; each agent starts cold from files |
| Merge conflicts between parallel implementers | Architect must declare file-contact surfaces per task; overlapping tasks are serialized |
| Parallel implementers observe each other's mid-flight (broken) states in a shared working tree | Disjoint surfaces limit the damage (observed harmlessly in the wordfreq run); the v1 orchestrator isolates each parallel implementer in a per-task worktree with serial fold-back (ORCHESTRATOR.md §5.3). v0 human dispatch still shares one tree |
| Spec drift (implementation quietly diverges from spec) | Reviewer and Verifier receive `spec.md` directly, not the implementer's summary of it |
| Silent budget burn | Per-run budget in `state.yaml`; exhaustion pauses, never degrades |
| Malformed handoffs | Contracts define required sections; consumers bounce, never guess |

## 10. Requirements traceability

- **"Different models for different agents"** → §6 registry indirection; cross-vendor
  supported by design, exercised via per-role vendor pins and future adapters.
- **"Flexibility over customizability"** → P3 (swap runtimes), P6 (extend by adding
  roles), §6 (swap models); no per-agent tuning surface anywhere.

## 11. Roadmap to the Future Considerations

**Up the org chain (#1):** the pieces that become shared org infrastructure are exactly
the runtime-neutral ones — the registry becomes an org model-governance service, `roles/`
becomes a shared role library teams import and narrow, and gate approvals in `state.yaml`
become policy hooks (e.g., "G3 requires someone with release authority"). The design
keeps these as plain files precisely so that promotion is a lift, not a rewrite.

**Concrete pilot (#2):** run v0 mode against a real, bounded change in a production
repo: write an intent brief for a small feature, let Analyst→Architect→Implementer→
Reviewer→Verifier carry it to a PR, and measure gate-review burden. The concrete
plan — integration layout, gate mapping to the target's CI/CD, guardrails for a
production repo, phases, and metrics — is maintained outside this repository.

---

*Companion documents: [WALKTHROUGH.md](WALKTHROUGH.md) (run a toy task through the
pipeline today), [FRONTEND.md](FRONTEND.md) (human interfaces to the gates), 
[INTEGRATION.md](INTEGRATION.md) (importing the framework into a
host repo — design draft), [`roles/`](../roles/), [`contracts/`](../contracts/),
[`registry/models.yaml`](../registry/models.yaml).*
