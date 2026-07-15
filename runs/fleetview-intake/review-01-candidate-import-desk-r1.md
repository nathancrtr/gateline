# Review Report: 01-candidate-import-desk

**Verdict:** request-changes
**Round:** 1 of 3
**Diff reviewed:** 18e2c69 (18e2c69^..18e2c69), branch run/fleetview-intake

## Findings

### F1 — blocking — Flagged CLI transcript stages an LLM-drafted brief no human ever saw, as the canonical AC11.1 path
- **Where:** `runs/fleetview-intake/design/import-desk/cli-flagged-session.html:57-75`
- **Failure scenario:** Operator scripts `agentic new acme/widgets#482 --slug … --yes` with a drafting model configured. The transcript shows drafting run ($0.02), a preview of only source/slug/branch/budget (never the brief body), then the scaffold committed under the human's identity — the committed `intent-brief.md` contains machine-authored text zero humans reviewed, exactly tech A6's failure mode. The line "--yes: … preview above stands as the review" (line 73) is false: the brief content is not in the preview. IC-6 already provides the safe non-interactive shapes (`--brief-file` = the terraform plan-artifact analogue; `--no-draft`); the candidate rendered the unsafe combination as its AC11.1 exemplar and `design-candidate.md:35` indexes it as such.
- **Requirement:** spec R9/AC9.1 ("no straight fetch-and-commit path"), plan Approach flow step 3, ADR-6 ("never a zero-review compile-and-run"); tech A6/REC4.

### F2 — minor — Conflict-state guidance contradicts IC-3's idempotency identity
- **Where:** `runs/fleetview-intake/design/import-desk/error-states.html:96-97`
- **Failure scenario:** Two operators race staging `acme/widgets#482`; loser gets the conflict panel advising "retry with a different slug." Retrying the same `(source, ref)` under IC-3 yields `exists` (or `refused: slug-taken`) regardless of slug — the advice dead-ends, and reads as if a second run for the same upstream item is a supported outcome (tech A7's anti-pattern). Correct affordances are the two already present (refresh / open what landed); the copy should not offer a different-slug path.
- **Requirement:** plan IC-3/ADR-8; spec R6/AC6.1.

### F3 — minor — Non-interactive arm path is undesigned; standalone `agentic arm` prompts even in the "fully-flagged non-interactive" session
- **Where:** `runs/fleetview-intake/design/import-desk/cli-flagged-session.html:99-106` (typed-slug prompt inside the file framed as zero-prompt); IC-6 defines `agentic arm <slug>` with no confirm flag.
- **Failure scenario:** CI script pipes `agentic arm search-pagination` with no TTY → blocks on "Type the slug to confirm" or (per IC-6's non-TTY rule) refuses, with no `--yes`-equivalent designed for arm. `agentic new --arm` exists as an alternative, but the candidate's own added friction (disclosed at `design-candidate.md:216-222`) leaves scripted arming of an already-staged run unreachable and unaddressed in Ergonomics "deferred."
- **Requirement:** plan IC-6; spec R11 posture (flags-first, prompts only at a TTY).

### F4 — minor — Traceability claim "every field in every mockup has a `<label for>`" is false
- **Where:** `runs/fleetview-intake/design/import-desk/design-candidate.md:132-134` vs `import-desk.html:176,180,184,190` (brief textareas: `aria-label` + non-associated `<h3>`), `import-desk.html:197,205` (strip read-onlys: bare `<span class="label">`).
- **Failure scenario:** Implementer copies the h3+aria-label pattern; a later rename of a section heading leaves the aria-label stale, so visible and accessible names diverge (WCAG 2.5.3 label-in-name). AC12.1 itself still passes (visible heading + accessible name exist); the defect is the inaccurate claim the G2 human would otherwise rely on.
- **Requirement:** spec R12/AC12.1 (claim accuracy); contract Research traceability section.

### F5 — minor — Free-text mode's no-drafting-model behavior is undesigned and not listed as deferred
- **Where:** `runs/fleetview-intake/design/import-desk/no-drafting-model.html` (import mode only); `import-desk.html:244` ("Draft brief →" is the pane's sole primary action); IC-5 returns 501 from `POST /api/intake/draft` when no model is configured.
- **Failure scenario:** Keyless deployment, operator opens the Free text tab and clicks "Draft brief →" → 501; no sketched state says what the pane does (utterance lands verbatim in Problem? button hidden? error?). Ergonomics "Deferred" (`design-candidate.md:196-204`) does not name it, so the implementer invents behavior.
- **Requirement:** plan ADR-6 (degradation is structural, both capture modes); task must-cover "no-drafting-model degradation"; contract Ergonomics notes ("what is deferred and why").

## Coverage

Checked clean against spec/plan/task, by number:
- **Contract form:** all six `contracts/design-candidate.md` sections present; every mockup is single-file HTML, embedded styles, no `<script>`, no external assets (all anchors `href="#"`); opens from disk. Read length within budget.
- **AC1.1/AC1.2:** `entry-points.html` — filled-pill "+ New" above the nav (not a fourth peer item), present on both sidebar surfaces + `n` shortcut; 1 interaction from Inbox/Portfolio/Metrics. Clean.
- **AC2.1:** "Fill in manually" tab is a peer tab, not buried behind free text. Clean.
- **AC3.1/AC3.2:** first paint shows 2 required-looking fields; budget pre-filled ($25) with one-interaction override on web strip and CLI prompt (`[25]`, Enter accepts). Clean.
- **AC5.2:** IC-4 skeleton in `run-detail-stage-arm.html:108-121` and `cli-flagged-session.html:78-91` is character-identical (placeholders filled with the single running example) and matches plan IC-4 verbatim, comments included. Staging/arming commit-message grammar matches IC-4. Clean. (Note for task 03: IC-4's `gates: { G0/G1/G2/G3 all undecided }` shorthand is reproduced as literal file content — verbatim per the task binding, but not real YAML; the seam reference should pin the actual gates block.)
- **AC6.2:** exists (accent/informational) vs conflict (warn) vs upstream failure (bad) are tonally and structurally distinct on web; CLI exit codes 0/2/1 match IC-6, exists names the existing slug and stager. Clean apart from F2's copy defect.
- **AC7.1/AC7.2 (web):** staging strip preview (source ref, editable slug, branch, budget) sits ahead of the single "Stage run" control; free-text and manual tabs feed the same strip; no zero-confirm path on the web surface. Clean. Interactive CLI (AC11.2) previews before y/N. AC7.2 on the flagged CLI path is compromised only in the sense F1 describes (a confirm gesture exists; review of content does not).
- **AC9.1 (web):** drafted-note pill + editable four-section scaffold between fetch and stage. Clean; the CLI-side breach is F1.
- **AC11.2:** interactive transcript prompts for exactly the fields the flags supply, `$EDITOR` review, promptBurden idiom. Clean.
- **AC12.2:** two failed-submit examples (empty Motivation; invalid slug) with focus moved, `role="alert"`, message naming field + fix. Clean.
- **AC13.1:** three distinct shape languages by semantic weight, no shadows, no gradient readouts (flat two-tone budget bar); argued in Look-and-feel. Clean.
- **ADR-7:** reflected (empty-state copy, "draft preserved" in error states, no autosave).
- **Research traceability:** spot-checked every cited ux/tech P/A/REC number against the reports — citations match their content; deviations (ux P1, P2, REC1; tech REC7/P10) each argued in one line. F4 is the one inaccurate claim found.
- **Thesis distinguishability from candidate 02:** the thesis names and contrasts sibling "single-thread"; verifiable only once 02 lands — not assessed further.
- Not assessed: rendered-browser visual QA (contrast measurements deferred by the candidate itself and flagged to the Architect); AC2.2/AC4.x/AC5.1/AC6.1/AC7.3/AC8.x/AC9.2/AC10.1/AC14.1 are task-03/follow-on scope per the plan's split.

## Boundary check

Clean. The commit adds exactly 10 files, all inside `runs/fleetview-intake/design/import-desk/` (`design-candidate.md` + 9 `*.html`), matching the declared `file_contact_surface`. No code, contracts, roles, or other run artifacts touched.
