# Agentic Development System — Design

**Status:** v0.1 — draft for team review
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
seven core roles (remembering is distributed — every role appends to the decision log).

| Role | Mission (one line) | Capability profile | Consumes | Produces |
|------|--------------------|--------------------|----------|----------|
| **Orchestrator** | Decompose intent, route work, track pipeline state, escalate at gates | frontier-reasoning | intent, all state | `state.yaml`, dispatches |
| **Analyst** | Turn raw intent into a testable spec with acceptance criteria | balanced | intent brief | `spec.md` |
| **Architect** | Technical plan, interface contracts, work breakdown, ADRs | frontier-reasoning | `spec.md`, repo | `plan.md`, `tasks/*.yaml` |
| **Implementer** | Execute one work item on a branch; make the acceptance tests pass | balanced | one `task.yaml`, `plan.md` | branch + diff, task notes |
| **Reviewer** | Adversarial review of a diff against spec, plan, and standards | frontier-reasoning (≠ implementer vendor) | diff, `spec.md`, `plan.md` | `review-report.md` |
| **Verifier** | Independently exercise behavior end-to-end; author missing tests | balanced (≠ implementer vendor) | diff, `spec.md` | `verification-report.md` |
| **Ops** | CI/CD, environments, release plan, rollback plan | balanced | verified diff, infra | `release-plan.md` |

Notes on the roster:

- **Orchestrator is a role, not a requirement.** In v0 operating mode a human plays it
  (see §7). Automating it is an upgrade, not a prerequisite.
- **Implementer is the only role that scales horizontally.** N implementers run in
  parallel on N independent work items; the Architect's job includes cutting tasks so
  their file-contact surfaces don't overlap.
- **Reviewer and Verifier are deliberately separate.** Review is reading (does this code
  say the right thing?); verification is running (does this system do the right thing?).
  Collapsing them recreates the rubber-stamp reviews we see in human teams.
- **A Historian/Docs role is the worked example of P6:** when changelog and doc drift
  become painful, add `roles/historian.md` and a `docs-delta.md` contract. Nothing else
  changes.

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
  pauses the pipeline rather than degrading quality silently. *Known v0 gap:* nothing
  meters spend automatically — the human orchestrator must update `cost_spent_usd`
  from harness usage output, and the wordfreq pilot showed that in practice this
  silently doesn't happen. Automated metering is a v1 prerequisite, not a nice-to-have.
- **Gates are named humans, not "the team."** `state.yaml` records who approved what,
  when. This matters more as this generalizes up the org (Future Consideration #1).

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
confirmations rather than corrections.

The role specs are identical in both modes — only who executes `orchestrator.md` changes.

## 8. Runtime adapters

The core trees (`roles/`, `contracts/`, `registry/`) are runtime-neutral. An adapter
maps them onto a specific harness:

| Adapter | Status | What it maps |
|---------|--------|--------------|
| [`adapters/claude-code/`](../adapters/claude-code/) | **Built (the skeleton)** | role specs → `.claude/agents/*.md` subagents; runnable today by every operator |
| [`adapters/copilot-cli/`](../adapters/copilot-cli/) | **Built** | role specs → `.github/agents/*.agent.md` custom agents; also the adapter that fully honors P5 — Copilot CLI hosts Anthropic/OpenAI/Google models natively, so Reviewer/Verifier bind to a genuinely different vendor than Implementer |
| `adapters/orchestrated/` | Future (v1) | role specs → programmatic agent SDK workers under a scheduler |

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
| Parallel implementers observe each other's mid-flight (broken) states in a shared working tree | Disjoint surfaces limit the damage (observed harmlessly in the wordfreq run); adapters should isolate parallel implementers in per-task worktrees |
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
