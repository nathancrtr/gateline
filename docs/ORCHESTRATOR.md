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

DESIGN.md §7 defines the v0 → v1 transition as a change of *executor*: "the role specs
are identical in both modes — only who executes `orchestrator.md` changes." That
sentence is this document's charter. v1 succeeds when `roles/orchestrator.md` is
executed continuously, correctly, and cheaply without a human — and every other
property of the system is preserved bit-for-bit: gates held by named humans, artifacts
as the only interface between agents, `state.yaml` canonical, budgets that pause.

The v1 orchestrator also arrives **second**. The gate frontend shipped first and
established the discipline for machines that touch `state.yaml`: comment-preserving
YAML edits, compare-and-swap ref updates, structured commit messages that the metrics
reader parses, ISO-8601 timestamps, `review_rounds` living in exactly one place.
FRONTEND-PLAN.md §11 even names the race this design must survive — "writing refs
under a live agent session races the orchestrator; CAS refusal + re-present is the
*designed* outcome." The orchestrator is therefore designed as a second well-behaved
co-writer joining an ecosystem with established rules. A hard requirement follows:

> **v1 requires zero frontend changes.** The orchestrator honors the frontend's
> existing conventions (§7 lists them as a compatibility contract); anything the
> frontend could *additionally* render about v1 is deferred and optional.

## 2. Settled decisions

Four maintainer decisions, settled before this draft. Close-call alternatives are
noted where the choice was contested.

| Decision | Choice |
|---|---|
| Execution model | **Stateless reconciler.** The orchestrator wakes on triggers, reads `state.yaml` at the run branch tip, derives the next action from files alone, executes it, commits, and exits. No conversation state survives between wakes — the purest expression of P1, and a gate wait costs nothing (it is simply "no action derivable"). Rejected: a long-running harness session (accrues the conversation state P1 exists to eliminate; undefined crash recovery; a session burning while humans deliberate at a gate). |
| Dispatch | **Adapter-shaped seam; one implementation first.** A runtime-neutral dispatch interface, implemented for the claude-code adapter first with copilot-cli as a fast-follow milestone — P5 decorrelation is designed in from day one and delivered incrementally. Rejected: single-harness-forever (bakes the P5 gap into the first autonomous mode) and cross-vendor-before-anything-works (delays the first trust-building loop). |
| Metering | **Designed here, enforced by the orchestrator.** Automated budget metering is DESIGN.md §4's stated v1 prerequisite, and the enforcement hook — who checks the cap and flips `phase: paused` — is naturally the process that performs every dispatch. Folding it in (§6) keeps the meter and its enforcer from drifting apart. |
| First deployment | **Single-user, this repo — the operator's laptop or their hosted cockpit machine.** v1 runs against this repository on a machine the operator owns: locally, or as a second process on the hosted single-user instance that serves Gatehouse ([DEPLOY.md](DEPLOY.md)), with gates decided in the hosted frontend. Humans remain at every gate either way — hosting changes only where the process sleeps, and who decides is unaffected. *Amended 2026-07-14 from "Local, this repo" so the M2 toy run proves the shape a production user actually runs; hosted mode adds hard ceilings (`--push`, `--require-budget`, `--spend-limit-usd`).* Host-repo delivery (repositories the operator does not own the machine for) is designed-for-but-later (§10). |

## 3. The judgment/mechanics split

INTEGRATION.md §2 introduced the framework's decomposition rule: split any workflow
along the judgment/mechanics line, make the mechanical half a tool and the judgment
half a model invocation. Applying it to `roles/orchestrator.md`'s own operating
instructions is clarifying:

| Operating instruction | Classification |
|---|---|
| Initialize `runs/<slug>/` and `state.yaml`; dispatch the Analyst | Mechanical |
| Validate artifacts against contracts (required sections); bounce naming the missing sections | Mechanical — the frontend's validator already implements this, from the repo's own `contracts/*.md` |
| Assemble gate packets; halt until a named human approves | Mechanical — "halt" is free for a reconciler |
| Dispatch parallel Implementers only for non-overlapping file-contact surfaces | Mechanical — set intersection over declared surfaces |
| Enforce round and budget caps; pause and escalate | Mechanical — counters and sums |
| Summarize "where things stand" when escalating | **Judgment** |
| Detect that an intent brief is missing constraints not inferable from the repo | **Judgment** |

The role is almost entirely mechanical — unsurprising, since the spec itself forbids
content judgment ("you own sequencing, state, and escalation — never content").
Orchestration is the most mechanizable role in the roster, which is what
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
| Gate declined | Rest as `paused: gate-declined`; a human resume re-dispatches the producing role with the decline notes as bounce input (resolved question 5). The re-dispatch opens a ledger entry, and the frontend reads that open entry as the in-flight signal (#159): while it stands, the gate card renders superseded, so the human who just declined is not shown their own old artifact with an Approve button. It is the same fact rule D12 rests on, read by the other surface — one constant for the role timeout keeps the two from disagreeing about when a dispatch has been lost |
| Task diff ready, `review_rounds` < 3 | Dispatch Reviewer (P5-constrained, §5.3) |
| Review requests changes, rounds < 3 | Dispatch Implementer, round n+1 |
| Round cap hit, or two bounces of the same artifact | Escalate; pause the run. The cap has an exit in the grammar (issue #342): resolving *that* escalation after the latest delivered verdict grants the loop one more round, and rule D4 stands down for that task — the implement rules then dispatch round n+1, or the resolution's optional `disposition` routes it (`re-review`, `return-to-implement`, `re-plan`) through the same helper the escalate-verdict row below uses. The next verdict past the cap lands after the resolution again, so the engine asks again for each extra round. Readiness reads the same fact — through the same helper — so the inbox card disappears while the granted round runs The bounce budget counts per dispute (#348): only bounces newer than the most recently resolved contract dispute over *that* artifact count, so an artifact a human repaired by hand and a producer later regenerated malformed gets the same two bounces the first occurrence had. The pause is `escalation`, whose only exit here is a hand edit — the paused card reads the resolved escalation's own words and names that edit, the way `budget-exhausted` names the limit (#96) |
| Review verdict `escalate` | Escalate; pause. Resolving the escalation *after* the verdict landed — after in the record's own order (see below) — routes by the LATEST matching resolution's optional `disposition` (issues #189, #190): `re-review` dispatches the re-review round immediately — an explicit human override of the #188 zero-delta guard; `return-to-implement` sends the task back to the implementer with the review report, or on to a verify round if the implementer already responded (whose-turn logic keyed off the resolution's own commit, mirroring the request-changes row above); `re-plan` sends the finding to the architect's amendment mode (see the next row); no disposition named falls back to the legacy behavior — a re-review round only once a real commit (anything other than `state.yaml`) has also landed after the verdict, else rest naming the fix that still needs to land (issue #188) |
| Disposition `re-plan` | Dispatch the architect in amendment mode, carrying the review report path and the resolution note (rule D22) — an architect already in flight rests instead, same as any other in-flight producer. Once the amendment lands (`plan.md` or a `tasks/*.yaml` touched after the resolution's commit), the engine raises a *fresh* escalation naming `task <id>` and pauses for human acknowledgment (rule D23, issue #190) — the architect proposes, the human still disposes. That acknowledgment escalation's own resolution (typically `return-to-implement`) is just another resolution matching the same `task <id>` text, so the LATEST-matching-resolution rule above picks it up and routes through the ordinary machinery unchanged |
| Verification verdict `escalate` (rule D24, #152) | Escalate; pause. The verifier's own channel, mirroring the reviewer's: `**Verdict:** escalate` on the verification report means a failure traces to the spec, the plan, or the gate process. A resolution landing after the report returns the packet to the table for the G2 human, failed rows and all — there is no round to re-run, so no disposition routing applies. `pass` and `fail` never pause: `fail` is the G2 human's to weigh, and the gate surface quotes the report's verdict and its non-verified rows so a non-clean report never reads as a clean pass. Reports that predate the verdict line behave as before |
| Implementer dispatch fails | Return the task to `pending` for its one retry; a second failure marks the task `failed` (nothing reads it as in-flight), escalates, and pauses. Resolving the escalation *after* the last failed attempt returns the task to `pending` — a fresh round supersedes the failure (issue #147). The escalation is worded from the facts: a fatal first failure says so, and `failed twice` only when the ledger shows two (#114) |
| A role returns ok and lands nothing (#343) | Rule DL, the landing cap — `BOUNCE_CAP`'s twin. Half this table re-dispatches on the *absence* of an expected change and counts nothing, so an agent that returns `ok` without committing (an analyst that reads the decline notes and concludes the spec already answers them; a reviewer that times out without writing) is a success to the close path and a no-op to derivation, re-dispatched every tick until `cost_limit_usd` trips. The ledger already carries what is needed: per (role, task), the dispatches that closed ok and were opened after the artifact they existed to land last moved. For a producer that artifact is the gate's packet; for a task-scoped role it is the task's whole record — its work item and the reviews of it — because an implementer's real product is code, which lives outside the run directory and the observation cannot see, so the response note and the reviewer's answer to that round are the marks the round leaves here. At `LANDING_CAP` of them the engine escalates and pauses, naming the role, the count and the artifact. Two facts reset the count — the artifact moving, and a human resolving that escalation — so resolve-and-resume does not walk straight back into the cap. The check sits inside the one gated dispatch path, ahead of the budget pre-flight: raising the limit is the wrong answer to a role that is not producing |
| Task status `in-progress` with no open ledger entry (#350) | Record the task back to `pending` (rule D25). The engine never writes `in-progress` — the contract lists it for v0 and hand-written records — and reading it as in flight made it a rest nothing could age: no dispatch behind it, no gate waiting on it, and readiness showing a run that needs nothing. With no open entry there is no work to be in the middle of, so the loop takes the task back |
| Dispatch refused before spawn (#154, #155) | A refusal is not a failure: the ledger entry closes at `$0` with `refused: true`, counts toward no retry, and raises no escalation. The run branch held by a checkout the orchestrator does not own is caught earlier still — probed before the intent commit (rule `CH`) and deferred like the resource cap, nothing written, re-derived once the checkout is released; the heartbeat carries the condition, remedy first |
| The same refusal twice in a row (#347, rule `RF`) | Defer. A refusal costs nothing and counts toward nothing, which is right for a one-off and unbounded for a condition that stands: the next tick derives the same dispatch, and the ledger and the branch grow by one entry and one commit per tick. So after two consecutive refusals of the same (role, task, round), with no success or real failure closed after them, the dispatch is held back like the resource cap — nothing written, the heartbeat carrying the condition and the last refusal's words. Deferred because every pre-spawn refusal is a fact about the host, never about the run: no edit a human could make to `state.yaml` would clear it, so escalating would ask for a decision that changes none of the inputs the rule reads (the #96/#97 dead loop). It clears itself two ways — a dispatch that lands anything but a refusal resets the count, and one probe dispatch goes through per window, since nothing in the record will ever say the host is well again |
| Budget pre-flight fails (§6) | Pause `budget-exhausted`; escalate. The pause is a *condition* recomputed from the ledger and the limit, so the only resume that sticks is one that raises `cost_limit_usd` in the same commit — the frontend, the CLI and the decision planner all require it from this reason (#96). A standing condition that re-fires with the same words after its escalation was resolved re-pauses without appending a second escalation (#96) |
| Host window exceeded (§6, rule `HB`) | Defer, like the resource cap: nothing is written, the run re-derives once the window has rolled, and the heartbeat carries the held-back runs for Gatehouse's engine chip (#97) |

Every "after" in that table means **branch order**, not a clock (issue #346). The
commit where a human's resolution landed, against the commit that landed the
verdict it answers; a dispatch's own intent commit, against the artifact it was
sent to produce. Three machines stamp those facts — the one that served the
human's decision (`resolved_at`), the committer that landed the artifact, and
the engine host that wrote the ledger entry — and a hosted engine with a laptop
CLI is the documented topology (DEPLOY.md §2), so seconds of skew used to flip
these comparisons in both directions: a genuine resolution reading older than
the verdict re-escalated and re-paused forever, and one reading newer than a
commit it preceded routed a round that should not run. `state.yaml` commits and
artifact landings are linear on the run branch, so one log of the run directory
places every fact these rules compare, and no clock can contradict a
parent-child edge. Timestamps keep their honest jobs: what a card shows a human,
and the fallback for a fact the branch cannot place. Gatehouse's round-cap card
reads the resolution's commit through the same helper the engine does, so the
two surfaces cannot disagree about whether a round was granted.

Two invariants govern every row: each action is derivable from committed files
alone, and each action is **idempotent to re-derive** — a tick interrupted anywhere
converges on re-run.

The whole table is parameterized by the run's **profile**
(DESIGN.md §4.1, issue #4): reduced profiles subset the gates and drop the `release`
phase, so G2 advances to `done`; in `patch` the plan phase has no producing role —
the human authored the brief and work item, so there is no one to dispatch or bounce
to, and the reviews alone are G2's packet. A profile invariant violation — a decided
gate outside the profile (mid-run downgrade), a phase outside the profile's
sequence, or a patch run with no work item — escalates (rule D21): honest failure,
never a guess. Upgrading mid-run needs no special engine handling: the human edits
`profile:` heavier and resumes, and the missing artifacts under the new profile
derive as ordinary dispatches.

A consequence of statelessness worth naming: an escalation is a *pointer to a
condition* in the committed files, and marking it resolved is only an acknowledgment.
When the condition is one a human can edit away (raise `cost_limit_usd`, repair the
branch), the engine re-derives quiet on the next tick only once that edit lands — a
resolution alone re-escalates, which is the engine nagging as designed. The `escalate`
verdict is the exception: it stands in an append-only review report no one may amend,
so there the resolution itself is the input — the engine reads its timestamp and
answers with a re-review round (issue #142). But a resolution is only ever a
`state.yaml` edit, and marking one resolved costs nothing to type truthfully or not —
so the engine also requires a real commit under the run directory, excluding
`state.yaml` itself, newer than the escalate verdict before it will spend a re-review
round: resolved with no such commit rests, naming the fix that still needs to land
(issue #188). That guard is the *default* absent an instruction otherwise — a human
resolving the escalation may instead name a `disposition` (issue #189), a
machine-actionable route captured in the same resolve decision as the free-text note:
`re-review` tells the engine the condition is addressed and to verify now, bypassing
the guard as an explicit override (the human's judgment stands in for the commit
check); `return-to-implement` routes the task back to the implementer with the review
report first — or straight to a verify round, if the implementer already responded
since the resolution landed — mirroring the request-changes turn-taking but keyed off
the resolution's own timestamp; `re-plan` names a surface or decomposition defect no
task's `file_contact_surface` can absorb (issue #190) and sends it to the architect
instead — dispatched in amendment mode with the review report path and the resolution
note (rule D22), same in-flight/budget-gated dispatch path as any other producer. The
architect may widen a task's `file_contact_surface` in amendment mode
(roles/architect.md), but the widening does not take effect silently: once it lands
(`plan.md` or a `tasks/*.yaml` touched newer than the resolution), the engine raises a
*fresh* escalation naming `task <id>` and pauses (rule D23): the agent proposes, the
named human still disposes. Resolving that acknowledgment escalation (typically
`return-to-implement`) is, to the engine, just one more resolution whose reason
happens to match the same `task <id>` text, so the "latest matching resolution" rule
immediately above composes correctly without any special case: it becomes the new
latest match and routes through the ordinary `return-to-implement`/`re-review`
machinery unchanged. When more than one resolution matches (a human may acknowledge,
then later resolve with a disposition), only the latest one's disposition governs. A
twice-failed implementer task is the same shape as the disposition-less default: the
failed ledger entries are append-only facts, so the resolution's timestamp is the
input — resolved after the last failure, the task returns to `pending` for a fresh
round (issue #147).

### 4.3 Writes: the same discipline as the frontend

Read at tip; comment-preserving edit (the `yaml` document API); blob/tree/commit via
plumbing; `update-ref` compare-and-swap. CAS refusal (a human decided mid-tick, an
agent committed) → discard, re-tick. Two additions specific to a machine writer:

- **Distinct identity.** Orchestrator commits are authored by a dedicated bot
  identity — one per orchestrator install (resolved question 4) — never a
  person's `git config`. Gate entries are written only by named humans (AGENTS.md
  convention); provenance must make machine bookkeeping and human decisions
  distinguishable at a glance.
- **Reserved grammar.** Commit messages follow the frontend's structured form —
  `state(<slug>): <verb> …` — with the orchestrator using its own verbs
  (`dispatched`, `bounced`, `advanced`, `escalated`, `paused`, `metered`,
  `harvested`) and never the human decision grammar (`G2 approved by <name> …`),
  which the metrics reader treats as authoritative for decisions.

When the resolved deployment mode pushes at all, both writers carry their commits to
origin themselves. The engine pushes with each bookkeeping commit (`--push`, #103),
and zero-config frontend sources push human decisions in the same write whenever the
repo has an origin (#149) — a decision that only landed locally would otherwise wait
on the engine's next commit to reach origin, and an engine at rest never commits, so
the viewer and origin consumers would silently see different runs. Any residual
divergence is surfaced: run summaries carry an ahead-of-origin commit count, shown as
an "unpushed" badge in Gatehouse. Under the **local-only** topology (docs/TOPOLOGY.md
§3.6) neither writer pushes, and origin is never fetched either — both writers still
commit locally, as above, but the push/fetch half of this section does not apply.

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
   rescues the artifacts from that teardown. An isolated implementer (§5.3) gets
   the same rescue on its own path: the fold harvests the task's worktree before
   it rebases, scoped to the task's declared file-contact surface. The
   orchestrator then commits the closing bookkeeping — status, rounds, spend.

The CAS on step 1 is the duplicate-dispatch guard for the *commit*: two orchestrator
instances, or a tick racing its own heartbeat, serialize on the ref update — the
loser re-reads, sees `dispatched`, and rests. A crash between steps 1 and 2 leaves a
`dispatched` entry with no living job and no artifact; the heartbeat detects
that signature and re-dispatches — agents are disposable by design (DESIGN.md §1), so
a lost dispatch costs a retry, never corruption. Job handles (PIDs, harness session
ids) are deliberately **not** committed: they are host-specific ephemera, treated as
cache — the loop must always be able to reconstruct reality by probing, because git
is the only store (the frontend's R1, inherited).

The CAS does not guard the *job*, and until #349 nothing did. "No living job" was
read from one process's own table, so a second engine against the same runs — the
topology TOPOLOGY.md §3.1 forbids — read the first engine's live dispatches as
orphans after five minutes of a thirty-minute role timeout and re-dispatched them:
two agents on one task. The entry therefore carries one durable fact about its
writer: `engine: <hostname>:<pid>`, a new optional key documented in
`contracts/state.yaml`. That is not a job handle and does not break the rule above —
it identifies the *process*, which outlives every job it launches and is the thing a
later reader can actually probe. What the sweep guarantees:

* **Its own entries, and entries that name no engine at all** (pre-#349, or
  hand-written) age after `staleMs` — five minutes by default. Unchanged.
* **An entry whose named process is gone from this machine** ages after `staleMs`
  too. This is what makes a restart converge: a crashed engine, or the §13
  self-supersede exit, leaves a pid that no longer exists, and the replacement
  process — a different pid on the same host — probes it with signal 0 and claims
  the entry inside one stale window.
* **An entry whose named process is still running here, or that names another
  machine** (which this one cannot probe — the same machine-local boundary
  `engine-health.json` draws) ages only after `roleTimeoutMs + staleMs`. Past the
  role timeout no live job can be behind it whoever opened it, because that is when
  its own engine kills it. Until then the sweep leaves it alone and says so in the
  log, which is also the clearest signal available that two engines are pointed at
  one set of runs.

Pid reuse is the acknowledged gap: a recycled pid reads as alive, and the entry waits
out the whole role timeout. That is the safe direction — late recovery, never a double
dispatch — and it costs nothing on the blessed topology, where there is one engine per
machine.

### 4.5 Pause and resume

`phase: paused` — written by a human (frontend, CLI, hand edit) or by the orchestrator
itself (caps) — means: no new dispatches. In-flight jobs run to completion and their
artifacts land harmlessly on the run branch, whatever the reason; a budget pause stops
the *next* dispatch, never the one already paid for. And the engine never un-closes a
run: a dispatch that closes after a human closed the run meters its usage and finishes
its own task's bookkeeping, and writes nothing about the run itself — no escalation,
no `phase`, no `paused_reason`. The task status is the dispatch's own record, and a
task left at `dispatched` with nothing in flight would strand a reopened run, so it is
handed back the way it would be on a live run. Resume is a human writing `phase` back
(the frontend's resume control already derives the phase from the gate ledger); the
watcher turns that commit into a tick. **`state.yaml` is the entire control plane, in
both directions** — there is no orchestrator API, config channel, or command queue to
keep consistent with it.

That sentence cuts both ways (#96). A pause the orchestrator wrote for a condition it
recomputes every tick — `budget-exhausted` from the ledger and `cost_limit_usd`,
`slug-landed` from the default branch — cannot be resumed out of by a human
disposition alone, because the disposition changes no fact the rule reads: the next
tick re-derives the same pause, and each cycle costs two decisions and one more
escalation entry. So the resume from `budget-exhausted` *carries the budget decision*:
a new `cost_limit_usd`, higher than the current one, written in the same CAS commit as
the phase restore, and refused without it. The human changes the fact. `slug-landed`
has no fact to change — the run cannot become un-merged — so its card says the one
thing that works: close the run with a disposition and carry the remaining work on a
fresh slug. And the pause card's instruction follows the reason.

#### Closing a run (#200)

Pausing says "not now." Closing says "not at all." A run that stops short of `done`
reaches `phase: closed` and carries a `closure` block naming a typed disposition:
`already-delivered`, `superseded`, `obsolete`, or `abandoned`, plus a required
reason and the named human who decided it.

The disposition is typed because the distinction lives in the human's head at closing
time and nowhere in the record. A run whose work shipped by another path succeeded;
recording that in the same state as a run someone walked away from would flatten it
into "gave up" in the one place the project treats as its audit trail. An untyped
closure can never be re-derived into these categories later.

Three rules follow from it:

* **The engine never closes a run.** Closing is a human decision, so `closure` joins
  `gates.*` on the list of things the orchestrator only reads. The engine's own
  terminal move is still `pause`, which asks for a human.
* **A closed run rests under D1**, ahead of the escalation and round-cap rules. A
  closure answers everything inside the run at once, so a closed run with an open
  escalation raises nothing — asking a human to resolve an escalation on a run they
  just ended would be asking them to repeat themselves.
* **Closing decides a run; it deletes nothing.** The branch, the run directory, and
  every artifact stay put, per the "completed runs are historical records"
  invariant. `gateline reopen` undoes a closure in a commit of its own, returning
  the run to the phase its gate ledger derives.

### 4.6 Scheduled roles: the Historian sweep

Some roles run on a schedule — the Historian (DESIGN.md §3) sweeps the interval since
its last run and reconciles docs, changelog, and tracker with the run record. The
orchestrator derives these dispatches the same way it derives everything else: from
committed files, on the same tick.

Schedules live in **`orchestrator.yaml` at the repository root**, read at the
default-branch tip like the registry. This is committed project policy — any
orchestrator instance pointed at the repo derives the same sweeps, and changing the
cadence is a reviewed commit:

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
failed, or awaiting review — so sweeps never pile up on an unmerged predecessor, and a
role's estimate exceeding its schedule's cap is a config defect that skips with a
warning (pause-don't-degrade, applied to schedules).

### 4.7 Invariants of the loop

The tick is a state machine: the record is the state, the rules and the human
verbs are the transitions, and two writers interleave on one branch under CAS.
The 2026-09-04 audit wrote that machine down and walked every rest state to its
exit; these are the properties it must keep, checked mechanically by
`packages/orchestrator/test/invariants.ts` and pinned, one property per test, by
`liveness-audit.test.ts` — where a property the loop does not yet have is a
reproduction marked `it.fails`, which passes today because the bug is there and
flips the day a fix lands.

- **I1 Single dispatch.** At most one open ledger entry per (role, task,
  round). Commit-then-launch's promise (§4.4).
- **I2 Profile.** The phase is one the profile has, and only the profile's
  gates are ever decided (D21).
- **I3 Ledger sum.** `cost_spent_usd` is the sum of `ledger[].cost_usd` (§6).
- **I4 Pause coherence.** A paused run says why; an unpaused run carries no
  reason.
- **I5 Ask once.** No two unresolved escalations share a reason, and a resolved
  reason recurs only after a new fact — a dispatch opened, a non-state commit
  landed (#96).
- **I6 Terminal.** A run in `done` or `closed` is never moved by the engine.
- **I7 Exit.** Every rest state the engine writes has an exit in the decision
  grammar that changes a fact the resting rule reads, or the surface says
  plainly that the exit is a hand edit (#96, #97 were the first two breaches
  found; the audit lists the rest).
- **I8 Bounded spend without a human.** Between two human decisions the number
  of paid dispatches is bounded by the profile and the task count, never by the
  budget alone.
- **I9 Recency is branch order.** Every "did X happen after Y" the loop asks is
  answered from the run branch — the commit where the fact landed — and never by
  subtracting two timestamps (#346). This is what makes I5 and I7 hold across
  machines: a resolution whose `resolved_at` reads older than the verdict it
  answers still counts, so the escalation does not recur (I5) and the rest state
  it created has its exit (I7). Clocks remain for display, and as the fallback
  for a fact the branch cannot place.

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
- **The fold harvests before it discards** (#184). A task worktree is removed the
  moment its fold finishes, so anything the implementer left uncommitted there
  dies with it, tracked or untracked alike. The fold therefore commits whatever
  is uncommitted inside the task's declared file-contact surface onto the task
  branch first, under the bot identity and the `harvested` verb, reading the
  surface entries as git pathspecs. This is §4.4's harvest-commit applied to the
  isolated path, with the surface standing in for the role's artifact list.
  Whatever the harvest did not take is handled two ways, and neither is silent:
  - Tracked paths outside the surface are discarded, because they stop the
    rebase from starting and are by definition not the task's product (#224).
  - Untracked paths outside the surface are left for the worktree removal to
    take.

  The fold's result names both, and that result is what the dispatch outcome and
  any escalation quote.

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
  Pause-don't-degrade, unchanged. Resuming from that pause requires a higher
  `cost_limit_usd` in the same commit (§4.5, #96).
- **The host ceiling is a rolling-window rate** (#97). `--spend-limit-usd`
  bounds what the deployment spends per rolling window (`--spend-window`,
  default 24 hours): closed ledger entries opened inside the window at their
  real cost, plus every open entry at its estimate, across every active run.
  A lifetime sum was the first shape, and it ratcheted: ledgers only grow and
  a run leaves the sum only when its branch lands, so a static cap was reached
  once and never left — the host was bricked by its own history, and the
  binding number lived in a process flag no run's `state.yaml` could reach.
  A window clears itself, which changes the guard's kind: rule `HB` *defers* a
  dispatch that would cross it — nothing written, the run re-derived once the window
  has moved — as the resource cap does. The heartbeat carries the held-back runs
  (`deferrals`), and Gatehouse shows them on the engine chip, at the level the
  condition lives.
- **A refusal meters nothing** (#155). A dispatch that never spawned a process
  — a held checkout, a preflight error — closes its ledger entry at `$0`, marked
  `refused`, so `cost_spent_usd` carries no fictional spend. Only a dispatch
  that launched and was lost (crash, timeout, aged out) meters the static
  estimate, because tokens may have burned.
- **Enforcement is a switch; metering is not** (#109). `--no-budget-enforcement`
  disables the cap pauses — per-run, `--require-budget`, and `--spend-limit-usd`
  alike — for operators whose harness bills flat-rate, where dollar caps don't map
  to marginal cost. The ledger, `cost_spent_usd`, and token counts record
  regardless: pause-don't-degrade governs enforcement. Default is on, and an
  opted-out orchestrator says so loudly at startup.
- **v0 benefits immediately.** The ledger contract lands first (M0); a human
  orchestrator appends a ledger entry from harness usage output — a smaller, more
  concrete ask than maintaining a total, and the shape v1 automates. The
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
7. A gate decision is legal only for the gate on the table — the profile's first
   un-approved gate, and only while the run stands in one of the phases that
   gate is decided in (a paused run is judged by the phase a resume would
   restore). Gatehouse offered nothing else; since #344 the CLI and the API
   refuse it too, and the PR-approval sync obeys the same rule, so an early
   Approve on the draft PR never lands in an undecided G2. An approval
   that can be written out of order is one a verifier cannot trust.

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
`packages/orchestrator`, consuming core** and adding what is new:
the derivation rules' dispatch half, the seam, the metering normalizer, the triggers.

- This does not violate the frontend's R2: R2 governs the human surfaces (web, CLI,
  server — which stay dispatch-free); the orchestrator is the sanctioned dispatcher,
  a sibling *consumer* of the same library, behind the same rules about what it may
  write.
- It is additive-only — no existing frontend surface changes — so it remains
  compatible with holding further frontend work still.
- Rejected: an independent implementation (Python, stdlib, like the renderer). It
  would re-implement the mechanics whose risks FRONTEND-PLAN §11 catalogs
  (YAML round-trip fidelity, CAS, readiness drift), and two implementations of the
  readiness rules is how they drift — the frontend's own risk table says so.
- Rejected for now: hoisting core out of `frontend/` into a top-level shared
  package. A real restructure buying no capability today; revisit when a non-Node
  consumer of core appears.

## 10. Trust ladder: milestones with promotion criteria

DESIGN.md §7's promotion criterion — gate reviews that have become confirmations —
gates *autonomy*. The milestones front-load trust-building and measurement, and
defer autonomy until it is earned. The frontend supplies the measurement for free:
the burden field it records on every gate decision is the "confirmation vs
correction" signal, so the promotion bar is now checkable from metrics.

| # | Milestone | Contents | Exit criterion |
|---|---|---|---|
| M0 | Contracts land | §8 amendments; ledger usable by hand in v0 | Amendments merged; a v0 run carries a hand-recorded ledger entry |
| M1 | Shadow mode | Engine + derivation rules; `tick --dry-run` prints each run's derived next action; no writes, no dispatches | Across at least **three** full v0 runs (resolved question 3: N=3), the engine's derived action matches what the human orchestrator actually did; every disagreement is dispositioned as an engine bug or a design finding |
| M2 | Autonomous loop, one vendor | Dispatch seam + claude-code headless dispatcher; commit-then-launch; metering + pre-flight cap; watcher + heartbeat | A toy run completes G0→G3 in this repo with humans acting only at gates and escalations; the ledger is populated automatically; a mid-run human pause is honored |
| M3 | Cross-vendor dispatch | copilot-cli headless dispatcher; `avoid_vendor_of` enforced at dispatch time | A run's Reviewer and Verifier demonstrably execute on a different vendor than its Implementer |
| M4 | Hardening | Crash-recovery drill; per-task worktree isolation; trigger packaging (cron/launchd template); WALKTHROUGH v1 section | Killing the orchestrator mid-dispatch and restarting converges with no duplicate dispatch; a second operator can run v1 cold from the docs |

**The autonomy gate:** M2 does not begin until the §7 promotion criterion is credibly
met — sustained majority-`confirmation` burden across v0 gate decisions. M0–M1 are
design and spike work, sanctioned early (they sharpen v0: M0 gives v0 a real ledger,
and M1's shadow disagreements are free design review).

**Host-repo deployment is designed for; it isn't built yet.** Triggers are already an
interface; a CI-triggered variant (scheduled + event-dispatched workflows) slots in
without engine changes, and delivery into host repos rides INTEGRATION.md's
vendored-release mechanism once both land. Out of scope until local v1 has earned
trust on this repo.

## 11. Failure modes

Extends DESIGN.md §9 for the autonomous mode:

| Failure mode | Mitigation |
|---|---|
| Duplicate dispatch (two instances, crash-restart, racing ticks) | Commit-then-launch: the intent is a CAS commit, which serializes the *commit* — racing ticks lose it and rest. The *job* is guarded separately (§4.4, #349): the entry names the process that opened it, so the stale sweep ages its own entries, unnamed ones, and entries whose named pid is gone from this machine after `staleMs`, and everything else — another live engine here, or any engine on a host this one cannot probe — only after `roleTimeoutMs + staleMs`, past which no live job can still be behind it. A crash or a §13 self-supersede restart therefore recovers inside one stale window, while a second engine against the same runs no longer ages the first one's live dispatches out from under it. It stays a forbidden topology (TOPOLOGY.md §3.1) that nothing enforces; the sweep now logs it and leaves it alone |
| Orchestrator races a human decision | CAS refusal → re-tick; both writers already treat refusal as the designed outcome |
| Runaway spend | Every model invocation flows through the metered seam; pre-flight cap; pause-don't-degrade. Resume from the budget pause carries a higher limit or is refused (#96); the host ceiling is a per-window rate that defers the dispatch (#97) |
| Run branch held by a human's checkout (#154) | The workspace preflight refuses to dispatch into a checkout the orchestrator does not manage — an agent there would race the human's edits. Deterministic and environmental, so it is neither the role's failure nor a retry's business: rule `CH` probes for it before the intent commit and defers (written nowhere, re-derived once released), and the rare refusal that slips past the probe closes its ledger entry at `$0`, `refused`, counting toward nothing (#155). Counting toward nothing also means nothing stops it repeating, so any pre-spawn refusal that stands — this one, a broken framework root, a dispatcher that will not spawn — is bounded by rule `RF` after two in a row: deferred like `CH`, re-probed once a window, never escalated, since no edit to the run's record could clear a condition of the host (#347) |
| Runaway *resource* use on the host | Dispatch concurrency cap across all runs (default 2; `--max-concurrent-dispatches`, `0` disables). Each dispatch carries an agent process, a cold dependency install, and a full suite run, so concurrency is what exhausts the machine. Unlike a budget ceiling this never escalates: no human decision unblocks it and it clears itself as jobs finish, so a capped dispatch is deferred (rule `MC`), written nowhere, and re-derived on a later tick |
| A run continuing past its own merge (slug reuse, #213) | A slug is used once. `runs/<slug>/` on the default branch means the run has shipped, so its record there is the durable one: the source classifies an identical record as historical — by ancestry for a merge commit, by record identity for a squash or rebase merge, which leaves no ancestry to find — and the engine refuses to dispatch or advance a branch that kept committing after its merge (rule `LR`), pausing it `slug-landed` for a human. Neither a ceiling to raise nor a condition that clears itself: the remaining work needs a fresh slug. Staging refuses the slug outright |
| Agent returns without producing (#343) | A dispatch that closes `ok` and commits nothing is invisible to derivation, which re-derives the same dispatch on the next tick. Rule DL bounds it the way `BOUNCE_CAP` bounds a malformed artifact: `LANDING_CAP` closed-ok dispatches for the same (role, task) with the expected artifact untouched since escalate and pause, naming the role and what it did not land. A task-scoped role's record is read whole — work item plus reviews — so a round that landed code and no response note still counts as having produced something. The artifact moving, or a human resolving that escalation, resets the count |
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

An orchestrator process loads its own code once, at start, from the checkout it runs
in. A `git pull` that lands after that — a human merging a framework fix under a
running engine — does nothing on its own; the running process keeps executing the code
it already has in memory. This section is the mechanism (#141) that turns that
staleness into a bounded, self-detected process replacement.

**Deployment model.** The blessed topology (#100/#112, [TOPOLOGY.md](TOPOLOGY.md)
§3.1) is one checkout, co-located: the server, the engine, and the CLI are one
process (`gateline up`) reading and writing one clone, with the globally
installed `gateline` binary `npm link`ed to that checkout's
`packages/cli`. There is exactly one blessed tree per deployment, so
"update the code" reduces to "advance that one checkout" — no fleet of
processes to reconcile against each other.

**What is monitored.** The *code tree*: the git checkout that owns the running
module's own source, resolved from `import.meta.url` (`resolveCodeRepo` in
`@gateline/core`). Under the co-located default this is the same clone the engine
reconciles runs against; under a host-repo setup (INTEGRATION.md) it need not be,
and it is the code tree's staleness that matters here. When the running module isn't
inside a git checkout at all — installed from a published package, or (as on the
hosted Fly recipe, DEPLOY.md) baked into a container image with no `.git` above it —
`resolveCodeRepo` returns null, no monitor is constructed, and this whole section is
inert: there is nothing to watch.

**Operator flow.** `git pull` in the checkout — by hand, or via `gateline
self-update` (below) — is the only input; the engine never pulls on its own.
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
- Only a clean fast-forward of the default branch counts as an update. Anything else —
  dirty tree, in-progress rebase/merge, branch switch, detached HEAD, or history that
  isn't a fast-forward of the commit the process started on — is `paused`, and the
  engine never dispatches on mixed code.
- **Debounce.** A fast-forward must be observed on two consecutive boundary checks
  before it is confirmed, so a heartbeat racing a `git pull` still in progress reads
  `superseded-pending` once and fires nothing on a half-updated tree.
- **`paused` is deliberate idling: no silent hang.** The heartbeat keeps writing
  while paused (`codeState: 'paused'`, plus `codeReason` carrying the monitor's
  specific cause), and Gatehouse's drift chip renders that reason — which branch,
  which conflict — as a distinct, stronger-tone pill beside the engine outage
  banner; a paused engine reads differently from a dead one, and points at the
  actual fix.

**What stays human-owned.** The engine never calls `git pull`; the update
input is always an operator action (a manual pull, or `gateline self-update`).
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

**`gateline self-update`.** Convenience layered over the same mechanism:
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
