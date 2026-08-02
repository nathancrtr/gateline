# The v1 Orchestrator — Design

**Status:** v0.3 — implemented through the M0–M4 trust ladder in
[`packages/orchestrator`](../packages/orchestrator/) (see its
README for the runbook); the §12 open questions are resolved (2026-07-10, answers
folded into §3, §4, §6, §10)
**Prerequisite reading:** [DESIGN.md](DESIGN.md) §4 (gates and caps), §7 (operating
modes), §8 (adapters); [`roles/orchestrator.md`](../roles/orchestrator.md); the gate
frontend's FRONTEND.md and FRONTEND-PLAN.md §2–3 (readiness derivation and the write
path — on the `worktree-frontend-design` branch until it merges)

---

## 1. What v1 changes — and what it must not

DESIGN.md §7 defines the v0 → v1 transition as a change of *executor*, not of role:
"the role specs are identical in both modes — only who executes `orchestrator.md`
changes." That sentence is this document's charter. v1 succeeds when
`roles/orchestrator.md` is executed continuously, correctly, and cheaply without a
human — and every other property of the system is preserved bit-for-bit: gates held
by named humans, artifacts as the only interface between agents, `state.yaml`
canonical, budgets that pause rather than degrade.

The v1 orchestrator also arrives **second**. The gate frontend shipped first and
established the discipline for machines that touch `state.yaml`: comment-preserving
YAML edits, compare-and-swap ref updates, structured commit messages that the metrics
reader parses, ISO-8601 timestamps, `review_rounds` living in exactly one place.
FRONTEND-PLAN.md §11 even names the race this design must survive — "writing refs
under a live agent session races the orchestrator; CAS refusal + re-present is the
*designed* outcome." The orchestrator is therefore designed as a second well-behaved
co-writer joining an ecosystem with established rules, not a privileged process the
frontend must accommodate. A hard requirement follows:

> **v1 requires zero frontend changes.** The orchestrator honors the frontend's
> existing conventions (§7 lists them as a compatibility contract); anything the
> frontend could *additionally* render about v1 is deferred and optional.

## 2. Settled decisions

Four maintainer decisions, settled before this draft. Close-call alternatives are
noted where the choice was genuinely contested.

| Decision | Choice |
|---|---|
| Execution model | **Stateless reconciler.** The orchestrator wakes on triggers, reads `state.yaml` at the run branch tip, derives the next action from files alone, executes it, commits, and exits. No conversation state survives between wakes — the purest expression of P1, and a gate wait costs nothing (it is simply "no action derivable"). Rejected: a long-running harness session (accrues exactly the conversation state P1 exists to eliminate; undefined crash recovery; a session burning while humans deliberate at a gate). |
| Dispatch | **Adapter-shaped seam; one implementation first.** A runtime-neutral dispatch interface, implemented for the claude-code adapter first with copilot-cli as a fast-follow milestone — P5 decorrelation is designed in from day one and delivered incrementally. Rejected: single-harness-forever (bakes the P5 gap into the first autonomous mode) and cross-vendor-before-anything-works (delays the first trust-building loop). |
| Metering | **Designed here, enforced by the orchestrator.** Automated budget metering is DESIGN.md §4's stated v1 prerequisite, and the enforcement hook — who checks the cap and flips `phase: paused` — is naturally the process that performs every dispatch. Folding it in (§6) keeps the meter and its enforcer from drifting apart. |
| First deployment | **Single-user, this repo — the operator's laptop or their hosted cockpit machine.** v1 runs against this repository on a machine the operator owns: locally, or as a second process on the hosted single-user instance that serves Gatehouse ([DEPLOY.md](DEPLOY.md)), with gates decided in the hosted frontend. Humans remain at every gate either way — hosting changes where the process sleeps, not who decides. *Amended 2026-07-14 from "Local, this repo" so the M2 toy run proves the shape a production user actually runs; hosted mode adds hard ceilings (`--push`, `--require-budget`, `--spend-limit-usd`).* Host-repo delivery (repositories the operator does not own the machine for) is designed-for-but-later (§10). |

## 3. The judgment/mechanics split

INTEGRATION.md §2 introduced the framework's decomposition rule: split any workflow
along the judgment/mechanics line, make the mechanical half a tool and the judgment
half a model invocation. Applying it to `roles/orchestrator.md`'s own operating
instructions is clarifying:

| Operating instruction | Classification |
|---|---|
| Initialize `runs/<slug>/` and `state.yaml`; dispatch the Analyst | Mechanical |
| Validate artifacts against contracts (required sections); bounce naming the missing sections | Mechanical — the frontend's validator already implements exactly this, from the repo's own `contracts/*.md` |
| Assemble gate packets; halt until a named human approves | Mechanical — "halt" is free for a reconciler |
| Dispatch parallel Implementers only for non-overlapping file-contact surfaces | Mechanical — set intersection over declared surfaces |
| Enforce round and budget caps; pause and escalate | Mechanical — counters and sums |
| Summarize "where things stand" when escalating | **Judgment** |
| Detect that an intent brief is missing constraints not inferable from the repo | **Judgment** |

The role is almost entirely mechanical — unsurprising, since the spec itself forbids
content judgment ("you own sequencing, state, and escalation — never content").
Orchestration is the most mechanizable role in the roster, which is exactly what
makes it safe to automate first.

**The design: a deterministic engine executes the loop; the model binding is invoked
only at the enumerated judgment points** (single-shot invocations through the same
metered dispatch seam as everything else, bound per the registry — the
`frontier-reasoning` binding survives, it just fires rarely). What this rules out: a
model session driving every tick. Bounce-message composition stays **mechanical**
(named missing sections, no model pass for tone) until evidence shows otherwise —
resolved question 1.

Why engine-first, beyond cost:

- **Structural safety.** The engine has *no code path* that writes
  `gates.*.approved`. "The orchestrator never approves a gate" stops being an
  instruction a model follows and becomes a property the code cannot violate.
- **Auditability.** Same state in, same action out. Every tick's decision is
  reproducible from the commit it read.
- **Honest failure.** A deterministic loop that meets a state it has no rule for
  escalates; a model in the same position improvises.

## 4. The reconcile loop

### 4.1 Triggers

All triggers funnel into the same tick; no trigger carries information (the state
does). Four sources:

1. **Ref watcher** — `.git/refs` + `packed-refs`, debounced (the same mechanism the
   frontend server uses for SSE freshness). Human decisions, agent artifact commits,
   and other orchestrators' writes all surface here.
2. **Dispatch completion** — a launched job exits.
3. **Heartbeat** — cron-style, default every few minutes: catches missed events, ages
   stale dispatches (§4.4), re-checks liveness.
4. **Manual** — `tick` on demand, and `tick --dry-run` (shadow mode, §10).

### 4.2 The tick

For each active run: read `state.yaml` at the run branch tip → check invariants →
derive the next action → execute it → record it with a CAS commit → done. At most
one state transition per run per tick; a transition may carry several dispatches
(parallel Implementers launch as one set).

The derivation rules are the dual of the frontend's readiness table
(FRONTEND-PLAN.md §2.3): that table derives *needs a human* from files; this one
derives *needs a dispatch*. A run deriving as neither is at rest — gate waits,
unresolved escalations, and pauses are all rest states, which is why a stateless
orchestrator can hold them indefinitely for free.

Approving a gate arms the next phase's dispatch on the very next tick, so when a
human decision still stands between a gate and the next producer (e.g. selecting
one of several design candidates before the Architect plans against it), the
approval must not advance the phase — and merely skipping the advance is not
enough, because the convergence rule sees the signed gate and advances anyway.
The decision vocabulary therefore includes **approve-and-hold**: sign the gate and
set `phase: paused` with a `paused_reason` naming the awaited decision, in the
same commit. The held run is an ordinary rest state; resume releases it into the
phase the gate ledger implies. The full table is authored at
implementation time (one test per row, like the frontend's); its shape:

| State observed | Action |
|---|---|
| Phase entered, producing role not yet dispatched | Dispatch the role |
| Role's artifact present but malformed | Bounce: re-dispatch the producer naming the missing sections |
| Artifact well-formed, gate not decided | Rest (the frontend inbox surfaces it) |
| Gate approved | Advance phase; dispatch the next role |
| Gate declined | Rest as `paused: gate-declined`; a human resume re-dispatches the producing role with the decline notes as bounce input (resolved question 5) |
| Task diff ready, `review_rounds` < 3 | Dispatch Reviewer (P5-constrained, §5.3) |
| Review requests changes, rounds < 3 | Dispatch Implementer, round n+1 |
| Round cap hit, or two bounces of the same artifact | Escalate; pause the run |
| Review verdict `escalate` | Escalate; pause. Resolving the escalation *after* the verdict landed routes by the LATEST matching resolution's optional `disposition` (issues #189, #190): `re-review` dispatches the re-review round immediately — an explicit human override of the #188 zero-delta guard; `return-to-implement` sends the task back to the implementer with the review report, or on to a verify round if the implementer already responded (whose-turn logic keyed off the resolution's timestamp, mirroring the request-changes row above); `re-plan` sends the finding to the architect's amendment mode (see the next row); no disposition named falls back to the legacy behavior — a re-review round only once a real commit (anything other than `state.yaml`) has also landed newer than the verdict, else rest naming the fix that still needs to land (issue #188) |
| Disposition `re-plan` | Dispatch the architect in amendment mode, carrying the review report path and the resolution note (rule D22) — an architect already in flight rests instead, same as any other in-flight producer. Once the amendment lands (`plan.md` or a `tasks/*.yaml` touched newer than the resolution), the engine raises a *fresh* escalation naming `task <id>` and pauses for human acknowledgment (rule D23, issue #190) rather than acting on the widened surface unattended — the architect proposes, the human still disposes. That acknowledgment escalation's own resolution (typically `return-to-implement`) is just another resolution matching the same `task <id>` text, so the LATEST-matching-resolution rule above picks it up and routes through the ordinary machinery unchanged |
| Implementer dispatch fails | Return the task to `pending` for its one retry; a second failure marks the task `failed` (nothing reads it as in-flight), escalates, and pauses. Resolving the escalation *after* the last failed attempt returns the task to `pending` — a fresh round supersedes the failure (issue #147) |
| Budget pre-flight fails (§6) | Pause `budget-exhausted`; escalate |

Two invariants govern every row: each action is derivable from committed files
alone, and each action is **idempotent to re-derive** — a tick interrupted anywhere
converges on re-run.

The whole table is parameterized by the run's **profile** (DESIGN.md §4.1,
issue #4): reduced profiles subset the gates, G2 advances to `done` rather than
`release`, and in `patch` the plan phase has no producing role — the human
authored the brief and work item, so there is no one to dispatch or bounce to,
and the reviews alone are G2's packet. A profile invariant violation — a decided
gate outside the profile (mid-run downgrade), a phase outside the profile's
sequence, or a patch run with no work item — escalates (rule D21): honest
failure, never a guess. Upgrading mid-run needs no special engine handling: the
human edits `profile:` heavier and resumes, and the missing artifacts under the
new profile derive as ordinary dispatches.

A consequence of statelessness worth naming: an escalation is a *pointer to a
condition* in the committed files, and marking it resolved is an acknowledgment,
not a change. When the condition is one a human can edit away (raise
`cost_limit_usd`, repair the branch), the engine re-derives quiet on the next tick
only once that edit lands — a resolution alone re-escalates, which is the engine
nagging, not a bug. The `escalate` verdict is the exception: it stands in an
append-only review report no one may amend, so there the resolution itself is the
input — the engine reads its timestamp and answers with a re-review round rather
than a repeat escalation (issue #142). But a resolution is only ever a `state.yaml`
edit, and marking one resolved costs nothing to type truthfully or not — so the
engine also requires a real commit under the run directory, excluding `state.yaml`
itself, newer than the escalate verdict before it will spend a re-review round:
resolved with no such commit rests, naming the fix that still needs to land rather
than burning one of the capped rounds against a byte-identical range (issue #188).
That guard is the *default* absent an instruction otherwise — a human resolving
the escalation may instead name a `disposition` (issue #189), a machine-actionable
route captured in the same resolve decision as the free-text note: `re-review`
tells the engine the condition is addressed and to verify now, bypassing the
guard as an explicit override (the human's judgment stands in for the commit
check); `return-to-implement` routes the task back to the implementer with the
review report first — or straight to a verify round, if the implementer already
responded since the resolution landed — mirroring the request-changes
turn-taking but keyed off the resolution's timestamp rather than the review's;
`re-plan` names a surface or decomposition defect no task's `file_contact_surface`
can absorb (issue #190) and sends it to the architect instead — dispatched in
amendment mode with the review report path and the resolution note (rule D22),
same in-flight/budget-gated dispatch path as any other producer. The architect
may widen a task's `file_contact_surface` in amendment mode (roles/architect.md),
but the widening does not take effect silently: once it lands (`plan.md` or a
`tasks/*.yaml` touched newer than the resolution), the engine raises a *fresh*
escalation naming `task <id>` and pauses (rule D23) rather than resuming
unattended — the agent proposes, the named human still disposes. Resolving that
acknowledgment escalation (typically `return-to-implement`) is, to the engine,
just one more resolution whose reason happens to match the same `task <id>`
text, so the "latest matching resolution" rule immediately above composes
correctly without any special case: it becomes the new latest match and routes
through the ordinary `return-to-implement`/`re-review` machinery unchanged.
When more than one resolution matches (a human may acknowledge, then later
resolve with a disposition), only the latest one's disposition governs. A
twice-failed implementer task is the same shape as the disposition-less
default: the failed ledger entries are append-only facts, so the resolution's
timestamp is the input — resolved after the last failure, the task returns to
`pending` for a fresh round (issue #147).

### 4.3 Writes: the same discipline as the frontend

Read at tip; comment-preserving edit (the `yaml` document API, not
re-serialization); blob/tree/commit via plumbing; `update-ref` compare-and-swap.
CAS refusal (a human decided mid-tick, an agent committed) → discard, re-tick. Two
additions specific to a machine writer:

- **Distinct identity.** Orchestrator commits are authored by a dedicated bot
  identity — one per orchestrator install, not per repo (resolved question 4) —
  never a person's `git config`. Gate entries are written only by named
  humans (AGENTS.md convention); provenance must make machine bookkeeping and human
  decisions distinguishable at a glance.
- **Reserved grammar.** Commit messages follow the frontend's structured form —
  `state(<slug>): <verb> …` — with the orchestrator using its own verbs
  (`dispatched`, `bounced`, `advanced`, `escalated`, `paused`, `metered`,
  `harvested`) and never the human decision grammar (`G2 approved by <name> …`),
  which the metrics reader treats as authoritative for decisions.

When the resolved deployment mode pushes at all, both writers carry their
commits to origin themselves. The engine pushes with each bookkeeping commit
(`--push`, #103), and zero-config frontend sources push human decisions in the
same write whenever the repo has an origin (#149) — a decision that only
landed locally would otherwise wait on the engine's next commit to reach
origin, and an engine at rest never commits, so the viewer and origin consumers
would silently see different runs. Any residual divergence is surfaced, not
hidden: run summaries carry an ahead-of-origin commit count, shown as an
"unpushed" badge in Gatehouse. Under the **local-only** topology
(docs/TOPOLOGY.md §3.6) neither writer pushes, and origin is never fetched
either — both writers still commit locally, exactly as above, but the
push/fetch half of this section does not apply.

### 4.4 Dispatch protocol: commit-then-launch

1. Derive a dispatch → **commit the intent first** (task/phase status →
   `dispatched`, ledger entry opened) via CAS.
2. On CAS success, launch the job.
3. On completion, the agent's artifacts are on the run branch: a shell-ful role
   (implementer, reviewer, verifier, ops) commits its own work; a shell-less role
   (analyst, architect — no adapter maps their capabilities to a git-capable tool,
   #182) never attempts to, and the engine harvest-commits the run-scoped
   working-tree diff for it instead, under the bot identity and the `harvested`
   verb — the same harvest also runs as a defense-in-depth backstop for any
   non-isolated role that simply didn't commit. This happens before the checkout
   is force-removed once the run's last in-flight job settles, which is what
   rescues the artifacts from that teardown. The orchestrator then commits the
   closing bookkeeping — status, rounds, spend.

The CAS on step 1 is the duplicate-dispatch guard: two orchestrator instances, or a
tick racing its own heartbeat, serialize on the ref update — the loser re-reads,
sees `dispatched`, and rests. A crash between steps 1 and 2 leaves a `dispatched`
entry with no living job and no artifact; the heartbeat detects exactly that
signature and re-dispatches — agents are disposable by design (DESIGN.md §1), so a
lost dispatch costs a retry, never corruption. Job handles (PIDs, harness session
ids) are deliberately **not** committed: they are host-specific ephemera, treated as
cache — the loop must always be able to reconstruct reality by probing, because git
is the only store (the frontend's R1, inherited).

### 4.5 Pause and resume

`phase: paused` — written by a human (frontend, CLI, hand edit) or by the
orchestrator itself (caps) — means: no new dispatches. In-flight jobs run to
completion and their artifacts land harmlessly on the run branch; only
`budget-exhausted` kills in-flight work. Resume is a human writing `phase` back (the
frontend's resume control already derives the phase from the gate ledger); the
watcher turns that commit into a tick. **`state.yaml` is the entire control plane,
in both directions** — there is no orchestrator API, config channel, or command
queue to keep consistent with it.

#### Closing a run (#200)

Pausing says "not now." Closing says "not at all." A run that stops short of `done`
reaches `phase: closed` and carries a `closure` block naming a typed disposition:
`already-delivered`, `superseded`, `obsolete`, or `abandoned`, plus a required
reason and the named human who decided it.

The disposition is typed rather than free text because the distinction lives in the
human's head at closing time and nowhere in the record. A run whose work shipped by
another path succeeded; recording that in the same state as a run someone walked
away from would flatten it into "gave up" in the one place the project treats as its
audit trail. An untyped closure can never be re-derived into these categories later.

Three rules follow from it:

* **The engine never closes a run.** Closing is a human decision, so `closure` joins
  `gates.*` on the list of things the orchestrator only reads. The engine's own
  terminal move is still `pause`, which asks for a human rather than answering for
  one.
* **A closed run rests under D1**, ahead of the escalation and round-cap rules. A
  closure answers everything inside the run at once, so a closed run with an open
  escalation raises nothing — asking a human to resolve an escalation on a run they
  just ended would be asking them to repeat themselves.
* **Closing decides a run; it deletes nothing.** The branch, the run directory, and
  every artifact stay put, per the "completed runs are historical records"
  invariant. `gateline reopen` undoes a closure in a commit of its own, returning
  the run to the phase its gate ledger derives.

### 4.6 Scheduled roles: the Historian sweep

Some roles are periodic, not gate-driven — the Historian (DESIGN.md §3) sweeps the
interval since its last run and reconciles docs, changelog, and tracker with the run
record. The orchestrator derives these dispatches the same way it derives everything
else: from committed files, on the same tick.

Schedules live in **`orchestrator.yaml` at the repository root**, read at the
default-branch tip like the registry. This is committed project policy, not a runtime
command channel — any orchestrator instance pointed at the repo derives the same
sweeps, and changing the cadence is a reviewed commit:

```yaml
schedules:
  historian:
    every: 7d            # <n>d | <n>h | <n>m
    cost_limit_usd: 5    # pre-flight cap for one sweep dispatch
    enabled: true
```

A due sweep is dispatched as a **mini-run**: `runs/<role>-<date>/` on branch
`run/<role>-<date>`, seeded by commit-then-launch (§4.4 — the branch is created from
the zero OID, so two instances racing a schedule resolve at the ref). The seed commit
carries `sweep.yaml`, the sweep's one-entry ledger: the closing commit meters real
usage into it through the same dispatch seam as every run dispatch (§6). Deliberately
absent: `state.yaml` — runs are recognized by their state file, so sweeps stay out of
the derivation table, the readiness table, and the frontend inbox entirely. The human
surface is the branch itself: review the `docs-delta.md` and the applied doc edits,
merge to approve (P4). The merged marker's `at` is what makes the next sweep's
interval derivable.

The schedule rules mirror the D-table's discipline (one test per row, S0–S4 + SB in
`schedule.ts`): a schedule rests while a sweep for its role is open — dispatched,
failed, or awaiting review — so sweeps never pile up on an unmerged predecessor, and
a role's estimate exceeding its schedule's cap is a config defect that skips with a
warning rather than dispatching (pause-don't-degrade, applied to schedules).

## 5. The dispatch seam

### 5.1 Interface

```
dispatch(run_ref, role, inputs: artifact paths, task?, round?, constraints?) → job
```

Completion yields exit status, a normalized usage record (§6), and the artifacts the
agent committed. Nothing above the seam knows which harness ran — the seam is to
runtimes what the registry is to models.

### 5.2 Adapters grow a `headless` manifest section

Each adapter's `manifest.json` — today the source for rendering agent files — gains
a `headless` section: the invocation template (command, how the agent and model are
named, output format flags) and the usage-report parsing spec. The adapter rule
stands (narrow, never widen), and a new runner still costs one manifest. This
**resolves DESIGN.md §8's reserved `adapters/orchestrated/` row**: v1 needs no
separate orchestrated adapter tree, because the orchestrator is a framework
component that *consumes* adapters through their manifests (amendment list, §8).

### 5.3 Implementations

- **claude-code (M2):** headless invocation of the already-rendered subagents
  (print-mode runs with JSON output, which carries per-invocation usage — the
  metering hook for free).
- **copilot-cli (M3):** the P5-completing dispatcher. With two vendors live, the
  registry's `avoid_vendor_of` pins stop being advisory: the seam *refuses* to bind
  Reviewer or Verifier to the Implementer's vendor, closing the "P5 only partially
  honored" limitation the claude-code adapter README documents today.
- **Parallel Implementers run in per-task worktrees** (the wordfreq retro fix:
  task 03 observed task 02's mid-flight broken state in the shared tree). Each
  implementer works its task in isolation; the orchestrator folds results back into
  the run branch serially — mechanical while file-contact surfaces are disjoint,
  which the Architect already guarantees; an actual conflict escalates as a plan
  defect.

### 5.4 Dispatch prompts are templates, not compositions

Rendered agents already inline their role spec (they start cold); the dispatch
prompt carries only run-specific bindings — slug, artifact paths, task id, round,
and on a bounce, the named missing sections. WALKTHROUGH.md's copy-pasteable
dispatch prompts are the template source. No model composes prompts: one more
judgment point removed by construction.

## 6. Budget metering — the v1 prerequisite, designed in

The wordfreq run proved that a human-maintained running total silently stays zero;
DESIGN.md §4 names automated metering a v1 prerequisite because every increase in
autonomy multiplies the cost of a missing meter. The design:

- **The metering point is the seam.** Every model invocation in v1 — role
  dispatches *and* the orchestrator's own judgment calls (§3) — flows through
  `dispatch()`, so per-dispatch usage capture covers all spend with no second
  mechanism. Harness-plural by construction: each adapter's `headless` manifest
  section says how to read its usage output, normalized to one record shape.
- **The record is a ledger, not a running total.**
  `budget.ledger[]` in `state.yaml`:
  `{at, role, task, round, adapter, model, tokens_in, tokens_out, cost_usd}`.
  `cost_spent_usd` becomes the derived sum, updated in the same closing commit as
  the dispatch bookkeeping. Append-only facts survive races and audits; running
  totals don't.
- **Prices live in the registry.** `registry/models.yaml` gains a `pricing:` map
  (model ID → $/Mtok in/out). The registry is already the only file where model IDs
  exist, so it is the only correct home for their prices — illustrative values,
  org-pinned like the IDs themselves.
- **Enforcement is pre-flight.** Before any dispatch: ledger sum + the registry's
  static per-role estimate (`dispatch_estimates_usd`; resolved question 2 — static
  for v1, trailing ledger averages a possible later upgrade) against
  `cost_limit_usd`; projected exceedance → pause `budget-exhausted` + escalation.
  Pause-don't-degrade, unchanged.
- **Enforcement is a switch; metering is not** (#109). `--no-budget-enforcement`
  disables the cap pauses — per-run, `--require-budget`, and `--spend-limit-usd`
  alike — for operators whose harness bills flat-rate, where dollar caps don't
  map to marginal cost. The ledger, `cost_spent_usd`, and token counts record
  regardless: pause-don't-degrade governs enforcement, not measurement. Default
  is on, and an opted-out orchestrator says so loudly at startup.
- **v0 benefits immediately.** The ledger contract lands first (M0); a human
  orchestrator appends a ledger entry from harness usage output — a smaller, more
  concrete ask than maintaining a total, and exactly the shape v1 automates. The
  frontend already renders budget fields "honestly, including never-updated"; a
  populated ledger upgrades that view with zero frontend changes.

## 7. Humans: gates, escalations, and the frontend contract

`state.yaml` commits are the only channel between the orchestrator and humans, in
both directions. Humans speak through it via the frontend and the `gateline` CLI
(gate decisions, escalation resolutions, pause/resume); the orchestrator speaks
through it by advancing state that the frontend's readiness rules recognize as
"needs a human." I3 — escalations, "notice them, somehow" — is completed by this
design: the orchestrator writes `escalations[]` entries promptly and the frontend
inbox already ages and routes them. Push notifications (a Slack webhook on
escalation and gate-ready commits) remain the FRONTEND.md Stage-A add-on: out of
scope here, trivially attachable to the same commits later.

**The co-writer contract** — the six conventions that make "zero frontend changes"
true, stated once so implementation and review can check against them:

1. All writes are CAS ref updates; refusal is normal and handled by re-deriving.
2. YAML edits preserve comments and formatting (document API, never
   re-serialization).
3. Timestamps are ISO-8601.
4. Commit messages use the structured grammar; the human decision grammar is
   reserved for humans, and the orchestrator authors as a distinct bot identity.
5. `review_rounds` lives in `state.yaml` and nowhere else.
6. Phase, status, and pause values stay within the contract enums the readiness
   table recognizes; new states go through a contract amendment first, never
   improvisation (the wordfreq `review-approved` lesson).

Deferred frontend nice-to-haves — explicitly *not* required for v1: a clarifying
clause in the frontend README that R2's "exactly one write path" scopes to the human
surfaces (the orchestrator being the sanctioned machine writer); rendering the
dispatch/ledger timeline in run detail; cost-per-role in metrics (I8). All are
renderers over data this design already commits to git — additive, whenever wanted.

## 8. Contract, registry, and doc amendments

Small and explicit, in the FRONTEND-PLAN §7 pattern; these are M0:

1. `contracts/state.yaml` — document the task status enum including `dispatched`
   and the wordfreq-improvised `review-approved`; add optional `budget.ledger[]`;
   note the commit-message grammar and the bot-identity rule.
2. `registry/models.yaml` — add the `pricing:` map.
3. `docs/DESIGN.md` — §7 points here; §8's `adapters/orchestrated/` row is replaced
   by the resolution in §5.2 (orchestrator component + per-adapter `headless`
   manifest sections).
4. `adapters/*/manifest.json` — `headless` section (schema settled at
   implementation).
5. `README.md` — repo-map row for the orchestrator component when it lands.

## 9. Implementation home

The engine's hard mechanics — run discovery, schema parsing, contract validation,
readiness derivation, comment-preserving CAS writes — are already implemented,
tested, and golden-filed once, in `@gateline/core` (`packages/core` on the
frontend branch). **The orchestrator becomes a sibling package in that workspace,
`packages/orchestrator`, consuming core** and adding what is genuinely new:
the derivation rules' dispatch half, the seam, the metering normalizer, the triggers.

- This does not violate the frontend's R2: R2 governs the human surfaces (web, CLI,
  server — which stay dispatch-free); the orchestrator is the sanctioned dispatcher,
  a sibling *consumer* of the same library, behind the same rules about what it may
  write.
- It is additive-only — no existing frontend surface changes — so it remains
  compatible with holding further frontend work still.
- Rejected: an independent implementation (Python, stdlib, like the renderer). It
  would re-implement exactly the mechanics whose risks FRONTEND-PLAN §11 catalogs
  (YAML round-trip fidelity, CAS, readiness drift), and two implementations of the
  readiness rules is how they drift — the frontend's own risk table says so.
- Rejected for now: hoisting core out of `frontend/` into a top-level shared
  package. A real restructure buying no capability today; revisit when a non-Node
  consumer of core appears.

## 10. Trust ladder: milestones with promotion criteria

DESIGN.md §7's promotion criterion — gate reviews have become confirmations rather
than corrections — gates *autonomy*, not design. The milestones front-load
trust-building and measurement, and defer autonomy until it is earned. The frontend
supplies the measurement for free: the burden field it records on every gate
decision is precisely the "confirmation vs correction" signal, so the promotion bar
is now checkable from metrics rather than vibes.

| # | Milestone | Contents | Exit criterion |
|---|---|---|---|
| M0 | Contracts land | §8 amendments; ledger usable by hand in v0 | Amendments merged; a v0 run carries a hand-recorded ledger entry |
| M1 | Shadow mode | Engine + derivation rules; `tick --dry-run` prints each run's derived next action; no writes, no dispatches | Across at least **three** full v0 runs (resolved question 3: N=3), the engine's derived action matches what the human orchestrator actually did; every disagreement is dispositioned as an engine bug or a design finding |
| M2 | Autonomous loop, one vendor | Dispatch seam + claude-code headless dispatcher; commit-then-launch; metering + pre-flight cap; watcher + heartbeat | A toy run completes G0→G3 in this repo with humans acting only at gates and escalations; the ledger is populated automatically; a mid-run human pause is honored |
| M3 | Cross-vendor dispatch | copilot-cli headless dispatcher; `avoid_vendor_of` enforced at dispatch time | A run's Reviewer and Verifier demonstrably execute on a different vendor than its Implementer |
| M4 | Hardening | Crash-recovery drill; per-task worktree isolation; trigger packaging (cron/launchd template); WALKTHROUGH v1 section | Killing the orchestrator mid-dispatch and restarting converges with no duplicate dispatch; a second operator can run v1 cold from the docs |

**The autonomy gate:** M2 does not begin until the §7 promotion criterion is
credibly met — sustained majority-`confirmation` burden across v0 gate decisions.
M0–M1 are design and spike work, sanctioned early (they sharpen v0 rather than
bypass it: M0 gives v0 a real ledger, M1's shadow disagreements are free design
review).

**Host-repo deployment is designed-for, not built.** Triggers are already an
interface; a CI-triggered variant (scheduled + event-dispatched workflows) slots in
without engine changes, and delivery into host repos rides INTEGRATION.md's
vendored-release mechanism once both land. Out of scope until local v1 has earned
trust on this repo.

## 11. Failure modes

Extends DESIGN.md §9 for the autonomous mode:

| Failure mode | Mitigation |
|---|---|
| Duplicate dispatch (two instances, crash-restart, racing ticks) | Commit-then-launch: intent is a CAS commit; heartbeat probes liveness before re-dispatching |
| Orchestrator races a human decision | CAS refusal → re-tick; both writers already treat refusal as the designed outcome |
| Runaway spend | Every model invocation flows through the metered seam; pre-flight cap; pause-don't-degrade |
| Runaway *resource* use (the host, not the budget) | Dispatch concurrency cap across all runs (default 2; `--max-concurrent-dispatches`, `0` disables). Each dispatch carries an agent process, a cold dependency install, and a full suite run, so concurrency — not cost — is what exhausts the machine. Unlike a budget ceiling this never escalates: no human decision unblocks it and it clears itself as jobs finish, so a capped dispatch is deferred (rule `MC`), written nowhere, and re-derived on a later tick |
| A run continuing past its own merge (slug reuse, #213) | A slug is used once. `runs/<slug>/` on the default branch means the run has shipped, so its record there is the durable one: the source classifies an identical record as historical — by ancestry for a merge commit, by record identity for a squash or rebase merge, which leaves no ancestry to find — and the engine refuses to dispatch or advance a branch that kept committing after its merge (rule `LR`), pausing it `slug-landed` for a human. Neither a ceiling to raise nor a condition that clears itself: the remaining work needs a fresh slug. Staging refuses the slug outright |
| Hung or stuck dispatch job | Per-role wall-clock timeout (default 30 min; `--role-timeout`) → kill the harness's whole process group, re-dispatch once, then escalate. The group kill matters: a surviving child would keep spending and hold the stdio pipes open, delaying the closing commit |
| Engine rules drift from frontend readiness rules | One library (`@gateline/core`) hosts both derivations; the readiness table remains the shared spec with one test per row |
| Machine writes masquerade as human decisions | Distinct bot author identity; reserved decision grammar; no code path writes `gates.*` |
| Vendor or model outage mid-run | Dispatch failure → one retry → escalate and pause. Falling back to a registry alternate is a human decision — a silent model swap would invalidate the P5 reasoning recorded for the run |
| Orchestrator host dies | All state is in git; restart anywhere, probe, converge — the process table is the only unpersisted state and is treated as cache |

## 12. Resolved questions (maintainer review, 2026-07-10)

The v0.1 draft posed five open questions; all are settled and folded into the
sections above. Recorded here so the reasoning survives:

1. **Judgment-point inventory** — bounce-message composition stays mechanical
   (named missing sections); a model pass for tone waits for evidence that the
   mechanical form fails (§3).
2. **Pre-flight estimates** — static per-role estimates in the registry
   (`dispatch_estimates_usd` in `registry/models.yaml`) for v1; trailing ledger
   averages are a possible later upgrade (§6).
3. **Shadow-mode bar** — N = 3 full v0 runs of agreement to exit M1 (§10).
4. **Bot identity** — one identity per orchestrator install (§4.3); per-repo
   identities revisit with org-level audit, Future Consideration #1.
5. **Decline recovery** — a human `resume` after `gate-declined` automatically
   re-dispatches the producing role with the decline notes as bounce input
   (§4.2); re-open-and-wait was rejected as an idle state a human must remember
   to unstick.

## 13. Merge-update lifecycle (self-supersede)

An orchestrator process loads its own code once, at start, from the checkout
it runs in. A `git pull` that lands after that — a human merging a framework
fix under a running engine — does nothing on its own; the running process
keeps executing the code it already has in memory. This section is the
mechanism (#141) that turns that staleness into a bounded, self-detected
process replacement instead of a silent drift nobody notices.

**Deployment model.** The blessed topology (#100/#112, [TOPOLOGY.md](TOPOLOGY.md)
§3.1) is one checkout, co-located: the server, the engine, and the CLI are one
process (`gateline up`) reading and writing one clone, with the globally
installed `gateline` binary `npm link`ed to that checkout's
`packages/cli`. There is exactly one blessed tree per deployment, so
"update the code" reduces to "advance that one checkout" — no fleet of
processes to reconcile against each other.

**What is monitored.** Not a configured run source — the *code tree*, the git
checkout that owns the running module's own source, resolved from
`import.meta.url` (`resolveCodeRepo` in `@gateline/core`). Under the co-located
default this is the same clone the engine reconciles runs against; under a
host-repo setup (INTEGRATION.md) it need not be, and it is the code tree's
staleness that matters here. When the running module isn't inside a git
checkout at all — installed from a published package, or (as on the hosted
Fly recipe, DEPLOY.md) baked into a container image with no `.git` above it
— `resolveCodeRepo` returns null, no monitor is constructed, and this whole
section is inert: there is nothing to watch.

**Operator flow.** `git pull` in the checkout — by hand, or via `gateline
upgrade` (below) — is the only input; the engine never pulls on its own.
`CodeTreeMonitor` notices at the next tick boundary (heartbeat or startup,
the same gating `syncFromRemote` uses, §4.2), and once a clean fast-forward is
confirmed the loop drains in-flight work and exits `75`. Under a supervisor
that exit is restarted immediately onto the fresh code, with no manual step.
Without one — a bare local `gateline up` — the process just stops; the
operator restarts it by hand, at their convenience, since the code is already
pulled and nothing is lost by waiting.

**States.** `CodeTreeMonitor.check()` recomputes state from the working tree
at every boundary check; the debounce (below) is the only state carried
between calls:

| State | Meaning | Loop behavior |
|---|---|---|
| `fresh` | On-disk `HEAD` equals the commit the process started on | Ticks normally |
| `superseded-pending` | Clean fast-forward of the default branch, observed for the first time | Tick bodies idle; heartbeat keeps writing |
| `supersede-confirmed` | The same fast-forward observed on a second consecutive boundary check (the debounce) | `onSupersede` fires once, after the confirming heartbeat write; the process drains and exits `75` |
| `paused` | Dirty tree, a rebase/merge in progress, non-fast-forward movement, or the checkout switched off the default branch (including detached HEAD) | Tick bodies idle; recovers to `fresh`/`superseded-pending` once the tree returns clean |

A heartbeat never reports `supersede-confirmed` itself — by the time a
confirmed check is written the process is already draining toward exit, so
the written `codeState` collapses it into `superseded-pending` ("pending
restart" is the only steady state left to describe).

**Guardrails.**
- Only a clean fast-forward of the default branch counts as an update.
  Anything else — dirty tree, in-progress rebase/merge, branch switch,
  detached HEAD, or history that isn't a fast-forward of the commit the
  process started on — is `paused`, not superseded, and the engine never
  dispatches on mixed code.
- **Debounce.** A fast-forward must be observed on two consecutive boundary
  checks before it is confirmed, so a heartbeat racing a `git pull` still in
  progress reads `superseded-pending` once rather than firing early on a
  half-updated tree.
- **`paused` is deliberate idling, not a silent hang.** The heartbeat keeps
  writing while paused (`codeState: 'paused'`, plus `codeReason` carrying the
  monitor's specific cause), and Gatehouse's drift chip renders that reason —
  which branch, which conflict — rather than a generic message, as a distinct,
  stronger-tone pill beside the engine outage banner; a paused engine reads
  differently from a dead one, and points at the actual fix.

**What stays human-owned.** The engine never calls `git pull`; the update
input is always an operator action (a manual pull, or `gateline upgrade`).
Resolving a paused code tree — finishing the rebase, cleaning the working
tree, switching back to the default branch — and restarting afterward are
both human acts. None of this touches the gate grammar in §4.3 or §7: gate
entries are still written only by named humans, and the orchestrator's own
commit verbs are unaffected. Self-supersede lives entirely in process
lifecycle, never in `state.yaml`.

**Exit code.** `SUPERSEDE_EXIT_CODE = 75` — `EX_TEMPFAIL` from
`<sysexits.h>`, "temporary failure, please retry." It is a deliberately
ordinary code, chosen for supervisor compatibility: launchd's `KeepAlive`
restarts on a nonzero exit by default, and systemd's
`RestartForceExitStatus=75` makes a unit restart on this specific code the
same way it would on a crash. `gateline-orchestrator watch` and `gateline up`
both wire this exit in; a `tick`-driven deployment (§4.1, trigger 4) doesn't
need it — a one-shot tick already exits after a single pass regardless. A
launchd example plist for this deployment is deliberately deferred (tracked
on #141); `packages/orchestrator/README.md`'s trigger-packaging
section carries one for `tick`, which doesn't need updating for this.

**`gateline upgrade`.** Convenience over the same mechanism, not a second one:
refuses on a dirty tree, `git pull --ff-only`, then `npm install` — and,
when the workspace carries the web app, `npm run build`: the server serves
`packages/web/dist`, the one part of the tree that does not run from
source — in the workspace (`packages/` under the resolved code repo,
`frontend/` in a pre-rename checkout (#133), falling back to the repo
root, or skipped if none carries a `package.json`) when `HEAD` moved, printing `upgraded <old7>..<new7>` (or
`already up to date at <head7>`). It does not itself restart a running engine — the monitor's own
tick-boundary check is what notices the moved `HEAD` and drives the exit, on
whatever cadence the heartbeat runs.

---

*Companion documents: [DESIGN.md](DESIGN.md) (architecture and operating modes),
FRONTEND.md / FRONTEND-PLAN.md (the co-writer whose conventions §7 inherits),
[INTEGRATION.md](INTEGRATION.md) (how v1 eventually travels to host repos),
[`roles/orchestrator.md`](../roles/orchestrator.md) (the unchanged contract this
design executes).*
