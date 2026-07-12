# Review Report: integration-hardening (docs/INTEGRATION.md v0.2)

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** c3a821f..202e6e5 docs/INTEGRATION.md (whole doc in scope)

Design-document review: "failure scenario" below means a concrete situation in
which the design as written produces a wrong outcome, a contradiction, or an
unexecutable step.

## Findings

### F1 — blocking — partial adoption is declared first-class but every workflow stage assumes full SDLC adoption; the doc contradicts its own centerpiece correction
- **Where:** `docs/INTEGRATION.md:74-81,167-181` (partial adoption, prefix lesson) vs `:234` (init signature), `:270-272` (gate mapping "onto G0–G3"), `:297-302` (validate: "overlay stubs non-empty", "dispatch the Analyst"), `:176-181` (field layout)
- **Failure scenario:** A third host replays integration #2's minimal adoption via the tool. `init <target> [--prefix] [--adapters]` has no flag to select a copy-manifest subset, and `--prefix` cannot express the field's endorsed layout (core files at repo root, prefix holding metadata only — `--prefix .` puts the lock at root too). Stage 1's profile contract requires gate mapping onto G0–G3, which §4 says doesn't apply to this host → the profile is malformed by its own contract discipline. Stage 3 fails a compliant host on "overlay stubs non-empty" (no roles taken → no overlays) and cannot run the smoke check ("dispatch the Analyst" — no Analyst was adopted; §10 Q4 gestures at smoke-brief variants but never at the hard-coded Analyst assumption). Net: the tool as specced cannot produce, and validate cannot pass, the one integration the doc holds up as evidence.
- **Requirement:** internal consistency §2/§4 vs §5

### F2 — major — §8's ergonomics claim ("the host never needs the framework source again except to upgrade") is contradicted by §3's two-channel model and §5 Stage 3
- **Where:** `docs/INTEGRATION.md:367-369` vs `:134-138` (toolchain runs from the pinned release, permanently) and `:308-313` (Stage 3 frontend read check)
- **Failure scenario:** Operator follows §8's four-line surface on a host machine with only the vendored `.agentic/` tree: Stage 3's frontend read check requires launching `agentic status` from the framework checkout/release under Node ≥ 24 — a third invocation §8's snippet omits and a standing dependency §8's sentence denies. Under the two-channel model the framework release is a permanent operational dependency (frontend, orchestrator), not an upgrade-time-only one. Also unstated: whether the read check is part of `validate` or a separate operator step — `validate` is stdlib-only Python and cannot itself run a Node toolchain it doesn't ship.
- **Requirement:** internal consistency §3 vs §5 vs §8

### F3 — major — `upgrade`'s base-retrieval mechanism cannot be executed from the distribution artifacts the doc itself mandates
- **Where:** `docs/INTEGRATION.md:319-324` vs `:230-232` (run from "a tagged checkout or its release tarball") and `:89` (vendored copy chosen because it "works in private/offline repos")
- **Failure scenario:** Host lock pins commit `<hash>`; operator runs `upgrade` from a release tarball — tarballs carry no git history, so "fetching that ref" to supply the 3-way base is impossible; an offline/private host can't fetch it from anywhere. "Re-pins to a tag on the way through" is unexecutable for commit-pinned locks (no tag points at or is guaranteed to contain the pinned commit); if it means "writes the new target tag", step 3's "bump the lock" already says that — the parenthetical is redundant or impossible. Meanwhile §4 records the field practice that solves the base problem for forked files without any fetch (upstream copies of forked files kept under the prefix, `:170-171`), and §6 doesn't fold it in.
- **Requirement:** executability §6

### F4 — major — "validate checks the mode matches the host's posture" has no mechanism: nothing records or detects the provenance mode
- **Where:** `docs/INTEGRATION.md:388` (§9 row), `:241-249` (two modes), `:234` (init signature has no mode flag), `:96-98` (lock fields don't include mode)
- **Failure scenario:** Private host whose root carries an unrelated MIT LICENSE for a published sub-component: `init` has no `--provenance-mode` input and no stated detection rule, and the lock is not specified to record the mode chosen — so `validate` has nothing to compare "the host's posture" against. The check the failure-mode table calls mechanical is unimplementable as written.
- **Requirement:** executability §5/§9

### F5 — major — the lockfile's normative reference is an artifact the doc's audience cannot see, and the doc never specifies the lock schema
- **Where:** `docs/INTEGRATION.md:427-429` ("integration #2's hand-written instance is the reference"), `:96-98,156` (four-field prose list), `:77-81` (taken subset), `:172-174` (instance-layer note)
- **Failure scenario:** The declared audience — "whoever builds the tooling", eventually arms-length adopters of an Apache-2.0 framework — implements the lock from §3/§4's prose ("source, version, checksums, forks"). The taken-subset record (§2), the instance-layer note (§4), and the provenance mode (F4) have no specified field; the reference instance lives outside this repository and the consumer-agnostic posture forbids pointing at it. Three sections' checks depend on lock content the doc never defines in-repo.
- **Requirement:** executability §3/§11; project posture (consumer-agnostic)

### F6 — major — footer cites INTEGRATION-PLAN.md as an existing companion ("the build plan that executes this design"); no such file exists anywhere in the repo or its history
- **Where:** `docs/INTEGRATION.md:445`
- **Failure scenario:** Reader follows the link → nothing. A v0.2 doc that opens by carefully separating shipped from unbuilt (`:3-10`) closes by asserting an artifact that is in flight at best — exactly the done-vs-in-flight confusion the status header exists to prevent.
- **Requirement:** evidence claims; internal consistency

### F7 — minor — §3 and §11 give conflicting sequencing directives for the first tag
- **Where:** `docs/INTEGRATION.md:108-109` ("The first tagged release is therefore the head of the build queue") vs `:418-421` ("the state-contract split (§4) is upstream of everything below … cutting a tag *before* it lands would ship the about-to-fork shape")
- **Failure scenario:** Builder acts on §3's urgency framing ("the debt is live") and cuts the tag first → v1.0 freezes the pre-split state schema, which §11 explicitly forbids. The cross-reference to §11 lets a careful reader resolve it, hence minor — but §3's sentence should say "head of the build queue *behind the split*".

### F8 — minor — Stage 3's frontend read check pass criterion ("renders without bounces") is unsatisfiable pre-split for exactly the host class that motivated it, and the gating is unstated
- **Where:** `docs/INTEGRATION.md:309-310` vs `:385` (§9: pre-split, foreign-schema runs "render loudly as bounced")
- **Failure scenario:** Non-SDLC host with instance gate vocabulary runs Stage 3 before the state-contract split lands: the compiled-in schema bounces its runs by design, so the check can never pass. Consistent only via §11's sequencing (tool ships post-split), which Stage 3 never states as a precondition.

### F9 — minor — copy-manifest × lock × upgrade interactions unspecified
- **Where:** `docs/INTEGRATION.md:96-98` ("every core-layer file") vs `:79-81` (taken subset); `:325-326` (upgrade notes cover seeded keys only); `:170-171` (fork vs retained upstream copy)
- **Failure scenario:** (a) §3's "checksum of every core-layer file" predates partial adoption — validate must check only the taken subset, unstated. (b) A newer release adds files to the copy manifest: upgrade's behavior toward a partial adopter (offer? ignore? note?) is undefined. (c) A host holds both a forked file and its retained upstream copy — which one validate checksums against is unspecified.

### F10 — minor — "the frontend's R3 rule" is cited twice but R3 is defined in FRONTEND-PLAN.md / frontend/README.md, not in FRONTEND.md, which is where this doc's header and footer send readers
- **Where:** `docs/INTEGRATION.md:130-131,385` vs citation targets `:8,443`
- **Failure scenario:** Reader opens FRONTEND.md to find R3; the label does not appear there. Contrast the precise "ORCHESTRATOR.md §5" citation at `:305-306`.

### F11 — minor — omission: scheduled/self-dispatching runs, a mode integration #2 exposed, appear nowhere in the workflow or the profile
- **Where:** `docs/INTEGRATION.md:257-281` (Integrator profile sections), `:390-414` (§10)
- **Failure scenario:** A single-operator host runs standing agent work on a schedule — isolated sessions with no dispatching operator session above them writing run state. The integration profile has no section for the host's dispatch reality (interactive vs scheduled), so the Integrator has no contract slot to record it and validate has nothing to check. PLAUSIBLE as an in-scope gap: arguably orchestrator territory, but the profile is where a host's operating reality is supposed to land.

## Coverage

Checked and found clean:

- **Consumer-agnosticism:** the doc names no downstream organization anywhere; the pilot host and integration #2 are referenced only by role, external artifacts flagged as "maintained outside this repository". Vendor name ("Claude Code plugin", §3) appears only in `docs/`, which P2 permits (P2 restricts `roles/` and `contracts/`).
- **Evidence and sequencing claims verified against the repo:** `run/state-contract-split` and `run/ee-boundary` branches exist — both "active run" claims are accurate, neither is stated as landed; the escalation best-effort mitigation (§9) also has a corresponding run branch; orchestrator live dispatch is correctly stated as pending verification (`:306-307`); ORCHESTRATOR.md §5 is indeed "The dispatch seam"; `frontend/package.json` requires Node ≥ 24 as claimed; `agentic status --repo` exists in the CLI; `frontend/packages/orchestrator` exists as claimed.
- **Field-evidence fidelity:** the doc's characterization of integration #2 — minimal core set at repo root, prefix as metadata-only, hand-written lock with checksums and a recorded state-contract fork, dual-mode provenance pattern, instance-added capability and gate vocabulary rendering unvalidated, instance roles fitting the role-spec format unchanged, frontend read surfaces generalizing with zero code changes except the compiled-in state schema, an open escalation hidden behind the schema error — all match the retro and lock artifacts (consulted read-only, outside this repository). Every framework-general retro finding I could map is folded into v0.2 or tracked; I found no misrepresented evidence.
- **Invariant consistency:** stdlib-only Python 3.9+ for `integrate.py` matches the renderer invariant; rendered-files-never-hand-edited carried into the host layering table; maintainer-mediated flowback with host-confidential redaction matches the project posture (maintainer-only authorship, Apache-2.0); adapters-as-mapping-only strengthens rather than widens the adapter ceiling; P3/P6 citations match DESIGN.md's principles as stated.
- **Layering model (§4 table), failure-mode table rows 1–8, §7 generated-vs-copied table:** internally coherent for the full-adoption case; §7's new frontend/orchestrator row is consistent with §3.
- Not assessed: FRONTEND-PLAN.md staging milestones in detail; the orchestrator co-writer contract beyond the §5 dispatch-seam citation (INTEGRATION.md touches neither).

## Boundary check

The doc stays within its declared scope — integration workflow, distribution,
layering, tooling — and cross-references companion docs rather than redesigning
them, with one mild leak: the §9 "escalations parsed best-effort" row (`:386`)
specifies frontend parsing behavior that belongs to FRONTEND-PLAN.md's design
surface; as an integration failure-mode row it should cite the frontend fix, not
specify it. Noted, not a separate finding. No changes outside `docs/INTEGRATION.md`
in the reviewed range.
