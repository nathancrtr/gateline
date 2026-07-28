# Framework Integration Workflow — Design

**Status:** v0.2 — updated against the field evidence this draft predicted. Since
v0.1: the design's lockfile and forks mechanisms were hand-executed by a second
integration — a non-SDLC, single-operator ops host (its integration retro is
maintained outside this repository; framework-general findings are tracked as
issues here) — and two framework components that postdate the draft shipped:
the gate frontend ([FRONTEND.md](FRONTEND.md), `frontend/`) and the v1
orchestrator ([ORCHESTRATOR.md](ORCHESTRATOR.md)). A v0 of the tooling now
ships: `integrate.py init|validate|fork`, the copy manifest, the normative lock
schema, and renderer overlay splicing (`scripts/`, tested by
`scripts/test_integrate.py`); the tagged release, instance-vocabulary
validation (open question 6), and `upgrade` remain open — §11 tracks them, and
[INTEGRATION-PLAN.md](INTEGRATION-PLAN.md) sequences the build. A round-1
adversarial review of this revision is applied
(`runs/integration-hardening/review-01.md`).
**Audience:** operators adopting the framework in a host repository, and whoever builds the tooling
**Prerequisite reading:** [DESIGN.md](DESIGN.md); the production pilot's Phase 0 notes (maintained outside this repository)

---

## 1. The problem

Adopting the framework in a host repository is currently a hand procedure: copy the
portable trees, edit the registry, invent project policy, hand-write provenance
notices, manually probe the environment, manually check that a teammate can dispatch
an agent. The pilot's Phase 0 executed exactly this, and its retro is a catalog of
what hand-integration costs:

1. **No version record.** A copied tree doesn't say which framework commit it came
   from. Upgrades become archaeology; "which repos have the fix from the last retro?"
   has no answer.
2. **Invisible divergence.** Project-specific needs (a new field in the intent-brief
   contract) were met by editing the copies in place. Nothing distinguishes a
   deliberate local change from drift, so nothing can merge upstream improvements
   past it.
3. **Policy landed in the wrong layer first.** Project guardrails were initially
   written into one runner's adapter; a second runner would have rendered agents
   *without* them. The fix — a project-level overlay layer the renderer splices into
   every adapter — was invented mid-flight and exists only in that host repo.
4. **Provenance was handled reactively.** Host repos may stamp their own
   copyright/license headers via automated sweeps. Framework-derived files must be
   excluded and carry a provenance notice instead — a boundary discovered the hard
   way, then enforced by hand.
5. **The environment probe and the exit check were manual.** "Can a second teammate
   dispatch the Analyst and get a well-formed spec?" is the right acceptance
   criterion for an integration, and nothing runs it.

Every one of these recurs for the next host repo. Integration should be a **product
surface of the framework** — designed, versioned, and validated — not a procedure in
one operator's head.

The prediction has since been tested: a second integration hand-executed *this
design* (lockfile, forks mechanism, provenance split) against a non-SDLC host.
The mechanisms held — the fork entry and checksums worked exactly as specified —
and the retro added cost categories v0.1 missed, folded in below: deciding which
files are core-layer is itself judgment the tool must encode (§2), provenance for
private non-redistributing hosts (§5), vocabulary the renderer can't validate
(§4), and a core contract that forced a fork in the first hour (§4).

## 2. What integration actually is

Decompose the Phase 0 work and it splits cleanly along the framework's own
judgment/mechanics line:

| Mechanical (deterministic, same every time) | Judgment (project-specific, agent-shaped) |
|---|---|
| Copy portable trees under a prefix | Probe the environment (interpreters, package tooling traps, hook health) |
| Record the source version | Map the host's existing gates (CI, deploy-on-merge, branch protection) onto G0–G3 |
| Seed registry + adapter manifests | Draft project overlays: guardrails, path bindings, commit conventions |
| Render adapter agents; wire the staleness CI check | Choose model bindings from the org's approved list; assess P5 decorrelation feasibility |
| Write provenance notices and header-sweep exclusions | Extend contracts (e.g., a required ticket-reference field) |
| Run well-formedness checks | Decide the validation envelope (what's locally provable vs. `unverifiable`) |

This split is the design. The mechanical half becomes a **tool** (`integrate.py`,
stdlib-only like the renderer). The judgment half becomes a **role with a contract
and a human gate** — the framework onboards itself the same way it builds software.
Integration is a run.

One correction from integration #2: the "copy portable trees" row is not purely
mechanical as written, because *which files are core-layer* is currently implicit.
Hand-writing the lockfile meant deciding, file by file, what counts as a framework
copy versus an instance-local file that merely follows framework conventions. The
tool must own that boundary: the framework ships an explicit **copy manifest**
(the list of core-layer files a release offers, from which a host takes what it
needs), and `init` records the taken subset in the lock — partial adoption is a
first-class outcome, not an anomaly (§4).

## 3. Distribution mechanism

How should framework files travel into a host repo?

| Mechanism | Verdict | Why |
|-----------|---------|-----|
| **Vendored copy + lockfile** | **Recommended** | Works in private/offline repos; divergence is *expected* — host-local policy is a legitimate layer, not an error — and the lockfile makes it visible instead of silent; upgrade is a real 3-way merge (§6) |
| Git submodule | Rejected | Couples host clones to framework repo access; role specs must be readable in-tree by agents that start cold; submodule UX taxes every operator |
| Git subtree | Rejected for now | Better than submodule, but merges core and project layers into one history; revisit if lockfile bookkeeping proves painful |
| Package registry (pip/npm) | Rejected for now, **for the core trees** | Infrastructure not needed at 1–3 repos; the natural v2 once the repo is public — the project posture already names "published package releases" as an eventual adoption channel, and the runnable components (below) are the artifacts that will want it first |
| Runner plugin (e.g., a Claude Code plugin) | Adapter-layer option only | Could bundle one runner's rendered agents for install ergonomics, but the core must stay runtime-neutral files (P3); never the primary channel |

The Phase 0 decision — copy, don't submodule — was right. What was missing is the
lockfile, `.agentic/framework-lock.json`. Its schema is normative *here* — and
ships as a JSON Schema beside `integrate.py` — because the field instances live in
private hosts this repository cannot point at:

- `source` — repo; pinned ref (a tag once releases exist, a bare commit before);
  framework version
- `integrated_at`; `method` (tool version, or hand-executed for pre-tool instances)
- `adapters_rendered`
- `taken[]` — the copy-manifest subset this host adopted (§2)
- `files{}` — **per-file checksum of every taken core-layer file**
- `forks{}` — per forked file: the base checksum it diverged from, the reason,
  and a `review_at_upgrade` flag
- `instance_layer` — the host-original trees that follow framework conventions
  but are not copies (a host's own roles and contracts, e.g.)
- `provenance_mode` — `redistribute | private` (§5); what validate checks the
  notices against

Checksums are what turn "someone edited a copy" from silent drift
into a detectable state with two sanctioned resolutions: move the change to an
overlay, or record the file as a deliberate fork (the lock gains a `forks:` entry,
which becomes the review agenda at upgrade time). Forked files keep their
**pristine upstream copy** under the prefix — field practice at integration #2,
now design: the retained copy is the fork's recorded base, `validate` checksums
the fork against *it* rather than against upstream HEAD, and `upgrade` uses it as
the 3-way merge base with no network fetch (§6).

One more thing the lock pins down: **what travels is a tagged release, not a
working copy.** The framework is a dependency with downstream consumers, not a lab
whose copies drift by nature — consumers integrate against a version they can name,
and the upstream owes them the tagging discipline that implies (§11). This debt is
now overdue rather than theoretical: no tag exists, so integration #2 had to pin a
bare commit hash and record the missing release as a retro item. The first tagged
release therefore sits at the head of the build queue, immediately *behind* the
state-contract split (§11's sequencing note — tagging first would freeze the
about-to-fork schema), and the first `upgrade` must accept commit-pinned locks
(§6).

### Vendored trees are not the only channel

v0.1 assumed everything that travels is a file copy. Two framework components
that shipped since are **runnable tools, not portable trees**, and they
deliberately do not vendor:

- **The gate frontend** (`frontend/`: the web UI, `agentic` CLI, and server) and
  **the v1 orchestrator** (`frontend/packages/orchestrator`) run *from the
  framework checkout or release*, pointed at host repos via `--repo` / the
  multi-repo config. They are operators' instruments over host state, not host
  files; a Node ≥ 24 workspace has no business being checked into every adopting
  repo, and copying it would recreate the drift problem the lockfile exists to
  solve.
- The evidence that this works: pointed read-only at integration #2's non-SDLC
  host, every frontend read surface — discovery, run enumeration, CLI, inbox, API,
  bounce discipline — generalized with **zero code changes**. The single boundary
  was the compiled-in run-state schema, which rejected the host's legitimately
  forked `state.yaml`; the fix (a generic state core + SDLC extension, with state
  validated against the host's own `contracts/state.yaml` per the frontend's R3
  rule, `frontend/README.md`) is sequenced as an active run.

Distribution is therefore **two channels pinned by one lock**: core trees vendor
into the host; the toolchain runs from the same pinned release against the host.
`framework-lock.json` records the release once, and both channels answer to it —
"which framework version manages this repo?" has one answer whether the asker is
`upgrade` or an operator launching the frontend.

## 4. The layering model

Three layers with strict edit rules, all under one prefix in the host repo:

```
host-repo/
├── .agentic/
│   ├── roles/               # CORE — copied verbatim, never edited in host
│   ├── contracts/           # CORE — ditto (forks allowed but lock-recorded)
│   ├── scripts/             # CORE — renderer + integrate.py travel with the copy
│   ├── registry/models.yaml # SEEDED — template on init, then project-owned
│   ├── adapters/*/manifest.json # SEEDED — per-runner, then project-owned
│   ├── overlays/            # PROJECT — the only writable policy surface
│   │   ├── _all.md          #   spliced into every rendered agent
│   │   └── <role>.md        #   spliced into that role's rendered agent
│   ├── runs/                # WORKING — pipeline runs, as in the sandbox
│   └── framework-lock.json  # metadata: source, version, checksums, forks
├── .claude/agents/          # RENDERED — generated, never hand-edited
└── .github/agents/          # RENDERED — ditto (if that runner is present)
```

| Layer | Edit rule | Upgrade behavior |
|-------|-----------|------------------|
| Core | Never edit; extend via overlays or record a fork | Replaced by upgrade (3-way merged if forked) |
| Seeded | Project-owned after init | Never touched by upgrade; new upstream keys surfaced as a diff note |
| Project (overlays) | Freely edited; this is where the project lives | Never touched by upgrade |
| Rendered | Never hand-edited (CI-enforced, as today) | Re-rendered after upgrade |

**What the field did with this model.** Integration #2 adopted a *minimal core
set* — the renderer, the render-staleness CI check, and the one contract its runs
consume — placed at the host's repo root rather than under the prefix, with
`.agentic/` holding only metadata (the lock, upstream copies of forked files, the
framework license text). Its own roles, contracts, registry, and adapter manifest
are instance-local originals that follow framework conventions, recorded in the
lock as an instance-layer note rather than as copies. Two lessons folded into the
design: (a) **partial adoption is the normal case** — the copy manifest (§2) is a
menu, and the lock records the subset taken; (b) the prefix question is real —
in-tree paths (`roles/`, `contracts/`) are what rendered agents and the renderer
already expect, and a host whose *own* content is framework-shaped may
legitimately keep the prefix for metadata only. `init` keeps `--prefix` as the
knob; the lock, not the directory layout, is the authoritative record of what is
core versus instance.

**Renderer change required:** `render-agents.py` composes each agent body as
*role spec + `overlays/_all.md` + `overlays/<role>.md`* (in that order, with marked
splice boundaries), and resolves paths relative to its own location so the same
script runs vendored. Policy text lives only in overlays; manifests stay pure
mapping (tool aliases, model spellings, frontmatter shape) — this makes the Phase 0
layering mistake structurally impossible rather than remembered. Overlay
splicing and path-relativity are now built into `render-agents.py` (a
comment-only stub splices nothing, so a repo with no overlays renders
byte-identical); instance-vocabulary validation remains open (question 6).

**Vocabulary is part of the layering, and today nothing validates it.**
Integration #2 added a capability (`web`) to its manifest's `tool_map` and
instance gate names (`publish`, `none`) to its state files; both rendered without
complaint — which means a *typo'd* capability or gate name in any host also
renders without complaint. The overlay design must give instance-added vocabulary
a declared home: manifests (or an overlay header) enumerate the capabilities and
gate names the instance adds, and the renderer validates against the union of
framework-declared and instance-declared vocabulary, failing on anything else.
"Instance-added" and "misspelled" must be distinguishable states.

The *semantics* of that declaration are now decided (DESIGN.md §4.2): an
instance may declare added capabilities and added roles; it may never add,
remove, or rename the framework's gates or profiles. Instance checkpoint names
(integration #2's `publish`) are legitimate for non-SDLC hosts, but they live in
the instance's declared namespace — never `G<n>` — and carry whatever weight the
instance assigns them; framework profile claims are not available to them. What
remains open is the declaration syntax (question 6).

**Contract extensions:** v0 keeps contracts as direct copies and treats any local
edit as a lock-recorded fork. The pilot needed exactly one field added to one
contract; that pressure doesn't yet justify a compose step for contracts. If two or
three hosts fork the same contract the same way, that's the signal to either promote
the change upstream or give contracts the same overlay treatment as roles. (An
upstreamed middle ground worth considering at that point: an optional
`## Project fields` section in each contract template, so common extensions aren't
forks at all.)

The fork-and-record stance has now met its worst case, and the resolution route
worked as designed: integration #2's brief-shaped runs could not be described by
`contracts/state.yaml` — the SDLC phase ladder, the fixed G0–G3 gate block, and
the tasks mirror don't apply — so the host forked the core state contract in its
first hour and recorded it. A fork of the *state* contract is qualitatively worse
than a fork of an artifact template: state is what the frontend, the orchestrator,
and `validate` all read. The upstream fix is sequenced as an active run: split
`contracts/state.yaml` into a generic core (run identity, gates-as-map,
escalations, pause) and an SDLC extension (branch convention, G0–G3, tasks,
budget), so non-SDLC hosts extend instead of forking. Related template SDLC-isms
surfaced by the same retro (the `writes_code` role-spec key) are tracked as
issues; none forced a fork.

## 5. The workflow

Four stages; the first and last are the tool, the middle two are the framework's own
run pattern. Everything lands as **one scaffold PR** in the host repo.

### Stage 0 — `integrate.py init` (mechanical, minutes)

Run from a pinned framework release — a tagged checkout or its release tarball,
never someone's working copy — pointed at the target:

```
python3 <framework-release>/scripts/integrate.py init <target-repo> \
    [--take all|sdlc|<file list>] [--layout prefixed|root] [--prefix .agentic] \
    [--provenance redistribute|private] [--adapters auto]
```

- Detects runners present (`.claude/`, `.github/`, …) and selects adapters
  (`--adapters` overrides).
- `--take` selects the copy-manifest subset (§2): `all` (default), `sdlc` (the
  role/contract set for software delivery), or an explicit file list — the
  minimal-adoption path integration #2 took by hand. The taken subset is recorded
  in the lock; everything downstream (overlay stubs, validate, smoke) scopes to it.
- `--layout` chooses between the prefixed tree (§4 diagram) and the field's
  endorsed root layout: core files at the conventional in-tree paths (`roles/`,
  `contracts/`, `scripts/`) with `--prefix` holding metadata only (lock, retained
  upstream copies, framework license). Rendered agents and the renderer expect the
  in-tree paths either way; the lock, not the layout, is the record of what is core.
- Copies the taken subset, seeds registry/manifests, seeds overlay stubs for the
  taken roles only, writes the lockfile, renders agents, wires the
  render-staleness CI check.
- Writes provenance in one of **two modes** — v0.1 assumed only the first. The
  mode is an explicit `init` input (`--provenance`, no default: the operator must
  state the host's posture) and is recorded in the lock, which is what gives
  `validate` something to check the notices against:
  - *Redistributing host* (the host's own tree is open source): repo-root
    LICENSE/NOTICE additions naming the framework and its Apache-2.0 terms.
  - *Private, non-redistributing host*: the host cannot take a repo-root
    Apache LICENSE without mislicensing its own proprietary content. Provenance
    lands instead as a NOTICE section enumerating the framework-derived files
    (by reference to the lock), with the Apache-2.0 text kept at
    `.agentic/LICENSE.framework.md`. Integration #2 invented this pattern by
    hand; `init` templates it.
  - In both modes: an `.agentic/README.md` pointing back to the source repo, and —
    if the host has a header-sweep tool — the exclusion configuration, with the
    standing rule stated in every rendered agent: *if tooling demands a host
    header on a framework file, escalate; never comply.*
- Idempotent: re-running refreshes core and rendered layers, never touches seeded or
  project layers.

### Stage 1 — the integration run (judgment, agent-executed)

`init` leaves a ready dispatch: an **Integrator** role (a P6 addition — one role
spec, one contract, nothing else changes) operating in `runs/000-integration/`. It
consumes the freshly scaffolded tree plus the host repo, and produces
`integration-profile.md` per a new `contracts/integration-profile.md`:

- **Environment probe** — interpreters and versions, package-tooling traps, hook
  health on pristine main, what can and cannot run locally. (Both prior runs hit
  environment surprises at implement time; this makes the probe a required artifact
  at integration time.)
- **Gate mapping** — the host's existing machine-enforced gates (CI, SAST, branch
  protection, deploy-on-merge) mapped onto the gate set the host actually adopts:
  G0–G3 for SDLC hosts, the host's own gate map otherwise (integration #2 runs
  `publish`-gated and ungated briefs; forcing those onto G0–G3 would make the
  profile malformed by its own contract). Include any deploy weight a merge
  already carries.
- **Conventions map** — where the host's conventions actually live, and whether
  agents in fresh clones/worktrees can read them (a gitignored conventions file is a
  probe *finding*, with a remediation proposal).
- **Guardrail register** — the host-specific hard rules (no infra mutation, secret
  and sensitive-data handling in artifacts, header policy), each traced to a probe
  finding or host policy.
- **Decorrelation assessment** — which vendors are actually reachable in this org,
  and whether P5 is satisfiable or must be recorded as a known weakening.
- **Runs-location decision input** — in-repo `runs/` vs. sidecar repo, with the
  host's compliance posture stated.
- **Dispatch reality** — which operating modes the host actually runs:
  interactive operator sessions, scheduled/self-dispatching runs (a scheduled
  session with no dispatcher above it writes its own run state — gate entries
  stay human-only regardless), or the autonomous orchestrator. Integration #2
  runs standing briefs on a scheduler; a profile with no slot for that reality
  can't record the host's most load-bearing operational fact.

The Integrator then **drafts the project layer directly** — `overlays/_all.md`,
per-role overlays, registry bindings, any contract fork — since those files are
exactly the profile's conclusions made executable.

### Stage 2 — Gate GI (human)

The scaffold PR review, G0-shaped: *"Is this how agents should behave in this
house?"* On the table: `integration-profile.md`, the overlays, the registry, the
lockfile. A named human approves, recorded in the profile like any gate.

### Stage 3 — `integrate.py validate` (mechanical again)

The Phase 0 exit criterion, made executable and cheap enough that the *second*
teammate runs it too:

- **Static:** renders are current (`--check`), lockfile checksums hold for the
  taken subset, provenance notices match the lock's recorded mode, header-sweep
  exclusions effective (if applicable), overlay stubs non-empty for the taken
  roles, instance vocabulary declared (§4), and the host's run state parses
  against the host's *own* `contracts/state.yaml`.
- **Smoke:** dispatch the entry role of the taken set — the Analyst for SDLC
  adopters, the host's own first role otherwise — on a canned brief shipped with
  the framework (or, for non-SDLC adopters, the host's own brief template), then
  verify the produced artifact against its contract's required sections. In v0
  the dispatch itself is manual (open the runner, paste the printed prompt);
  `validate --smoke-report runs/000-integration/` checks the artifact. Headless
  dispatch is no longer hypothetical — the orchestrator's dispatch seam
  (ORCHESTRATOR.md §5) is the implementation validate will ride once live dispatch
  is verified — but it stays a v1 nicety, not a blocker.
- **Frontend read check (new since v0.1; an operator step, not part of
  `validate`):** point the gate frontend at the host — `agentic status --repo
  <host>` from the framework checkout — and confirm the smoke run renders without
  bounces. `validate` (stdlib Python) prints the command; it does not run a Node
  toolchain it doesn't ship. Precondition: the state-contract split — until it
  lands, a host with instance gate vocabulary bounces by design and the check's
  pass criterion applies only to SDLC-shaped hosts. This one command exercises
  the full read path (discovery, state parse, contract validation) end-to-end,
  and it is exactly the check that caught the state-schema boundary at
  integration #2.

Integration is *done* when validate passes for someone other than the operator who
ran init.

## 6. Upgrades and flowback

`integrate.py upgrade`, run from a newer pinned framework release:

1. Establish the **base** for 3-way merges from the retained upstream copies the
   lock records (§3) — no network fetch, so `upgrade` runs from a release tarball
   in a private/offline host. When run from a git checkout instead, fetching the
   lock's pinned ref is a cross-check, not a dependency. (Locks written before
   the first tagged release pin a bare commit; `upgrade` reads either form and
   records the new release's tag when it bumps the lock.)
2. Unforked taken files: replaced. Forked files: merged against their recorded
   base, conflicts surfaced. Seeded and project layers: untouched, with new
   upstream keys/sections reported as notes. Files a newer release *adds* to the
   copy manifest are offered to a partial adopter as notes, never auto-copied.
3. Re-render, re-run `validate` static checks, bump the lock.

Flowback stays deliberately manual and **maintainer-mediated**: retros in host
repos produce framework patches authored by the maintainer, as today — hosts do
not push upstream (assume maintainer-only authorship until a contribution policy
exists). And it is a rule of the path, not a courtesy, that host-confidential
content never travels upstream: a retro lesson is redacted to its
framework-general observation before it leaves the host. What the lockfile adds is the census — *which* repos run *which*
version, so a retro lesson can say exactly who needs the upgrade. When a third repo
adopts and the core wants to become org-shared infrastructure (Future
Consideration #1), this lock/upgrade machinery is the substrate that promotion
builds on; nothing here needs to be undone.

## 7. Generated vs. copied

The brief's open question — does integration include *generating* project-specific
agent/contract/context definitions? Answer: yes for the project layer, never for the
core, and the generation is gated agent work, not templating.

| Artifact | Produced by | Rationale |
|----------|------------|-----------|
| Roles, contracts, scripts (core) | Copied verbatim | A generated role spec is a day-one invisible fork of the framework |
| Registry bindings, adapter manifests | Seeded template → project-owned | Mapping, not judgment; small and stable |
| Overlays (`_all.md`, per-role) | **Generated by the Integrator**, human-gated | Pure judgment: they encode the probe's conclusions |
| `integration-profile.md` | **Generated by the Integrator** | The judgment artifact itself |
| Provenance, README, CI wiring | Templated by the tool | Mechanical |
| Genuinely new project roles (P6) | Not generated | Adding a role is a team decision; the workflow leaves room but doesn't presume. Integration #2's experience: four instance roles fit the role-spec format with zero schema changes — the format travels even where the SDLC content doesn't |
| Gate frontend, orchestrator | **Neither copied nor generated** — run from the pinned framework release against the host (§3) | Runnable tools, not portable trees; vendoring a Node workspace recreates the drift problem |

## 8. Ergonomics target

The whole operator surface, from zero to gate-ready, should be:

```
python3 <framework-release>/scripts/integrate.py init ~/repos/my-app
cd ~/repos/my-app        # dispatch the Integrator with the prompt init printed
python3 .agentic/scripts/integrate.py validate
# open the scaffold PR
```

Two tool invocations, one agent dispatch, one PR. The tool travels into
`.agentic/scripts/`, so the **host repo** is self-sufficient: nothing checked into
it depends on the framework source except at `upgrade` time. The **operator's
cockpit** is a different matter under the two-channel model (§3): the gate
frontend and the orchestrator run from the framework checkout/release for as long
as the operator uses them — a standing instrument on the operator's machine, not
a dependency of the host tree — and Stage 3's frontend read check is an operator
step from that checkout. Everything that travels into the host stays stdlib-only
Python 3.9+, same constraint as the renderer and for the same reason: host
machines' interpreters vary, and the integration tool is precisely the thing that
runs *before* the environment probe has fixed anything.

## 9. Failure modes and mitigations

| Failure mode | Mitigation |
|--------------|------------|
| Core edited in place (invisible divergence) | Lock checksums flag it; resolutions are overlay-move or recorded fork |
| Policy written into one adapter, missing from the next | Overlays are the only writable policy surface; manifests carry mapping only |
| Host headers stamped onto framework files | init writes exclusions + notices; validate checks; agents instructed to escalate, never comply |
| Host conventions unreadable to cold-start agents (e.g., gitignored) | Probe checks readability from a fresh clone; profile requires a committed conventions source |
| Stale rendered agents | Render-staleness CI seeded by init (as in this repo) |
| Smoke run passes, real run fails | validate is necessary, not sufficient; the first real run stays supervised (the pilot's Phase 1 discipline is unchanged) |
| Version drift across adopting repos | Lockfile census; upgrade is cheap enough to actually run |
| Integrator hallucinates policy the host doesn't have | Every guardrail in the profile must trace to a probe finding or a cited host policy; untraceable rules are malformed (consumer bounces, per contract discipline) |
| Framework tooling's compiled-in schema rejects a compliant host's runs | State validated against the host's own `contracts/state.yaml` per the frontend's R3 rule (`frontend/README.md`; state-contract split, active run); until it lands, foreign-schema runs render loudly as bounced, never silently wrong |
| Open escalation invisible behind a schema error | Frontend fix, sequenced as an active run: escalation entries stay readable even when full state validation fails |
| Typo'd capability or gate name renders silently | Declared instance vocabulary (§4); renderer fails on anything outside the declared union |
| Private host mislicensed by a repo-root Apache LICENSE | Dual provenance modes in `init` (§5); validate checks the mode matches the host's posture |

## 10. Open questions for team review

1. **Contract extensions** — *partially resolved by events.* The state contract's
   answer is the core/extension split (§4, active run). Still open for the markdown
   artifact contracts: fork-and-record, or the `## Project fields` extension point
   from day one?
2. **Integrator scope** — should it also draft the host's *pilot plan* (phases,
   ticket-selection criteria, metrics), or stop at profile + overlays? Phase 0
   suggests the plan wants human authorship with the profile as input.
3. **Runs location default** — in-repo `runs/` unless the host's compliance posture
   objects, or sidecar-by-default? The profile captures the inputs either way.
4. **Smoke brief** — one universal dummy intent brief, or per-domain variants
   (service, pipeline, CLI)? Integration #2 adds a datapoint: a non-SDLC host's
   runs are brief-shaped, so a smoke brief that assumes the G0–G3 ladder wouldn't
   exercise what that host actually runs.
5. **Re-integration of the hand-built hosts** — two hand-built scaffolds now exist
   (the pilot host and integration #2). Replaying the tool against each and
   diffing is the recommended acceptance test (§11); do we also *adopt* the
   tool-built result in those repos, or leave their scaffolds as-is?
6. **Vocabulary declaration syntax** — *semantics resolved* (DESIGN.md §4.2:
   capabilities and roles may be instance-added; gates and profiles may not,
   and instance checkpoints are namespaced apart from `G<n>`). Still open:
   where do the declarations live — the adapter manifest, an overlay header, or
   a dedicated vocabulary file the renderer and `validate` both read?
7. **Fleet registration** — should `init` also register the host in the operator's
   frontend/orchestrator multi-repo config, or is pointing the toolchain at the
   host a deliberately separate operator step?

## 11. Build phasing

Sequencing note: the state-contract split (§4) is upstream of everything below —
the lock's copy manifest, `validate`'s state checks, and the frontend read check
all want the split schema, and cutting a tag *before* it lands would ship the
about-to-fork shape as v1.0's frozen interface.

- **v0:** a first **versioned, tagged release** of the framework — the lockfile's
  `version` field needs something real to pin before the first arms-length
  adoption (both existing integrations pin bare commits; the debt is live);
  renderer overlay support + path-relativity; `integrate.py init|validate`
  (static checks only); the lockfile per §3's normative schema, shipped as a JSON
  Schema beside the tool (the format is field-tested — two hand-written instances
  exist — but §3 is the reference, not any private host's file);
  `roles/integrator.md` + `contracts/integration-profile.md`; canned smoke brief. Release contents are
  Apache-2.0 by construction; once the commercial-boundary convention lands
  (active run), release tooling additionally excludes `ee/` paths. Acceptance
  test: re-run integration against each hand-built host and diff the result
  against its scaffold — the deltas are either tool bugs or hand-integration
  mistakes, and both are worth finding.
- **v1:** `upgrade` with true 3-way merge (accepting commit-pinned first-generation
  locks, §6); smoke-report checking in validate; headless smoke dispatch through
  the orchestrator's dispatch seam where a runner supports it.

---

*Companion documents: [DESIGN.md](DESIGN.md) (the architecture this workflow
distributes), [WALKTHROUGH.md](WALKTHROUGH.md) (what a host repo runs after
integrating), [FRONTEND.md](FRONTEND.md) and [ORCHESTRATOR.md](ORCHESTRATOR.md)
(the runnable channel §3 distributes alongside the trees),
[INTEGRATION-PLAN.md](INTEGRATION-PLAN.md) (the build plan that executes this
design).*
