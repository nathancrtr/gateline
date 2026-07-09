# Framework Integration Workflow — Design

**Status:** v0.1 — draft for team review; nothing here is implemented yet
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

## 3. Distribution mechanism

How should framework files travel into a host repo?

| Mechanism | Verdict | Why |
|-----------|---------|-----|
| **Vendored copy + lockfile** | **Recommended** | Works in private/offline repos; divergence is *expected* (the sandbox is a lab, not a dependency) and the lockfile makes it visible instead of silent; upgrade is a real 3-way merge (§6) |
| Git submodule | Rejected | Couples host clones to framework repo access; role specs must be readable in-tree by agents that start cold; submodule UX taxes every operator |
| Git subtree | Rejected for now | Better than submodule, but merges core and project layers into one history; revisit if lockfile bookkeeping proves painful |
| Package registry (pip/npm) | Rejected for now | Infrastructure the team doesn't need at 1–3 repos; the natural v2 once the core is org-shared (Future Consideration #1) |
| Runner plugin (e.g., a Claude Code plugin) | Adapter-layer option only | Could bundle one runner's rendered agents for install ergonomics, but the core must stay runtime-neutral files (P3); never the primary channel |

The Phase 0 decision — copy, don't submodule — was right. What was missing is the
lockfile: `.agentic/framework-lock.json` recording the source repo, source commit,
framework version, the adapters rendered, and a **per-file checksum of every
core-layer file**. Checksums are what turn "someone edited a copy" from silent drift
into a detectable state with two sanctioned resolutions: move the change to an
overlay, or record the file as a deliberate fork (the lock gains a `forks:` entry,
which becomes the review agenda at upgrade time).

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

**Renderer change required:** `render-agents.py` composes each agent body as
*role spec + `overlays/_all.md` + `overlays/<role>.md`* (in that order, with marked
splice boundaries), and resolves paths relative to its own location so the same
script runs vendored. Policy text lives only in overlays; manifests stay pure
mapping (tool aliases, model spellings, frontmatter shape) — this makes the Phase 0
layering mistake structurally impossible rather than remembered.

**Contract extensions:** v0 keeps contracts as direct copies and treats any local
edit as a lock-recorded fork. The pilot needed exactly one field added to one
contract; that pressure doesn't yet justify a compose step for contracts. If two or
three hosts fork the same contract the same way, that's the signal to either promote
the change upstream or give contracts the same overlay treatment as roles. (An
upstreamed middle ground worth considering at that point: an optional
`## Project fields` section in each contract template, so common extensions aren't
forks at all.)

## 5. The workflow

Four stages; the first and last are the tool, the middle two are the framework's own
run pattern. Everything lands as **one scaffold PR** in the host repo.

### Stage 0 — `integrate.py init` (mechanical, minutes)

Run from a framework checkout, pointed at the target:

```
python3 <framework>/scripts/integrate.py init <target-repo> [--prefix .agentic] [--adapters auto]
```

- Detects runners present (`.claude/`, `.github/`, …) and selects adapters
  (`--adapters` overrides).
- Copies core, seeds registry/manifests/overlay stubs, writes the lockfile, renders
  agents, wires the render-staleness CI check.
- Writes provenance: an `.agentic/README.md` pointing back to the source repo, a
  NOTICE, and — if the host has a header-sweep tool — the exclusion configuration,
  with the standing rule stated in every rendered agent: *if tooling demands a host
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
  protection, deploy-on-merge) mapped onto G0–G3, including any deploy weight a
  merge already carries.
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

- **Static:** renders are current (`--check`), lockfile checksums hold, provenance
  notices present, header-sweep exclusions effective (if applicable), overlay stubs
  non-empty.
- **Smoke:** dispatch the Analyst on a canned dummy intent brief shipped with the
  framework, then verify the produced spec against the contract's required sections.
  In v0 the dispatch itself is manual (open the runner, paste the printed prompt);
  `validate --smoke-report runs/000-integration/` checks the artifact. Headless
  dispatch is a v1 nicety, not a blocker.

Integration is *done* when validate passes for someone other than the operator who
ran init.

## 6. Upgrades and flowback

`integrate.py upgrade`, run from a newer framework checkout:

1. Read the lock's source commit; that checkout's history supplies the **base** —
   so core files get a true 3-way merge (base, upstream, local) rather than a
   clobber-and-pray.
2. Unforked core files: replaced. Forked files: merged, conflicts surfaced. Seeded
   and project layers: untouched, with new upstream keys/sections reported as notes.
3. Re-render, re-run `validate` static checks, bump the lock.

Flowback stays deliberately manual: retros in host repos produce framework patches
by hand, as today. What the lockfile adds is the census — *which* repos run *which*
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
| Genuinely new project roles (P6) | Not generated | Adding a role is a team decision; the workflow leaves room but doesn't presume |

## 8. Ergonomics target

The whole operator surface, from zero to gate-ready, should be:

```
python3 ~/repos/agentic-sandbox/scripts/integrate.py init ~/repos/my-app
cd ~/repos/my-app        # dispatch the Integrator with the prompt init printed
python3 .agentic/scripts/integrate.py validate
# open the scaffold PR
```

Two tool invocations, one agent dispatch, one PR. The tool travels into
`.agentic/scripts/`, so the host never needs the framework checkout again except to
upgrade. Stdlib-only Python 3.9+, same constraint as the renderer and for the same
reason: host machines' interpreters vary, and the integration tool is precisely the
thing that runs *before* the environment probe has fixed anything.

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

## 10. Open questions for team review

1. **Contract extensions** — is the v0 fork-and-record stance (§4) acceptable, or do
   we want the `## Project fields` extension point in contract templates from day one?
2. **Integrator scope** — should it also draft the host's *pilot plan* (phases,
   ticket-selection criteria, metrics), or stop at profile + overlays? Phase 0
   suggests the plan wants human authorship with the profile as input.
3. **Runs location default** — in-repo `runs/` unless the host's compliance posture
   objects, or sidecar-by-default? The profile captures the inputs either way.
4. **Smoke brief** — one universal dummy intent brief, or per-domain variants
   (service, pipeline, CLI)?
5. **Re-integration of the pilot host** — do we replace its hand-built scaffold with
   a tool-built one as the dogfood test (recommended, §11), or leave it and dogfood
   on the next adopter?

## 11. Build phasing

- **v0:** renderer overlay support + path-relativity; `integrate.py init|validate`
  (static checks only); lockfile; `roles/integrator.md` +
  `contracts/integration-profile.md`; canned smoke brief. Acceptance test: re-run
  integration against the pilot host and diff the result against its hand-built
  scaffold — the deltas are either tool bugs or hand-integration mistakes, and both
  are worth finding.
- **v1:** `upgrade` with true 3-way merge; smoke-report checking in validate;
  headless smoke dispatch where a runner supports it.

---

*Companion documents: [DESIGN.md](DESIGN.md) (the architecture this workflow
distributes), [WALKTHROUGH.md](WALKTHROUGH.md) (what a host repo runs after
integrating).*
