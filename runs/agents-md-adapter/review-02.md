# Review Report: 02-agents-md-manifest-and-output

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** escalate
**Round:** 1 of 3
**Diff reviewed:** 4b7231a on run/agents-md-adapter, scoped to `adapters/agents-md/manifest.json`, `AGENTS.md`, and the task file's notes block

## Findings

### F1 — blocking — AC6.1 (R6) fails on the committed AGENTS.md: the spec's own grep matches
- **Where:** `AGENTS.md:360` (source: `roles/historian.md:48`, included byte-verbatim per plan ADR-3)
- **Failure scenario:** run spec AC6.1 exactly as written —
  `grep -Ei '^model:|^vendor:|sonnet|haiku|fable|claude|gpt|gemini' AGENTS.md` →
  one match: the historian body's reference to the `.claude/agents/` path
  (substring `claude`). Reproduced live at 4b7231a. The Verifier's AC6.1 run
  fails; CI-guarded rendered output ships a vendor-name substring R6 forbids.
- **Requirement:** spec R6/AC6.1. **Why escalate, not request-changes:** no fix
  exists inside this task's surface — editing `roles/historian.md` violates
  R1/AC1.2 ("zero lines changed in roles/"), and transforming body text
  violates ADR-3 (byte-verbatim, review-approved in task 01). Plan Risk 3's
  mitigation premise ("roles are already vendor-clean by invariant P2") is
  factually false, so the defect traces to the plan. Resolution options for the
  Architect/gate human: (i) amend spec AC6.1 to scope the grep to
  adapter-generated content (header, title, preamble, generated lines) —
  mirroring the scoping precedent plan §3 already established for AC3.1/AC3.2;
  (ii) land a framework-side rewording of `roles/historian.md:48` (e.g. "the
  runtime adapters' rendered output directories") as its own change with
  re-render, then re-render here; or (iii) record an explicit G2 waiver. Not
  the implementer's call.

### F2 — major — Implementer's evidence claim "All ACs pass except AC1.1" is false
- **Where:** `runs/agents-md-adapter/tasks/02-agents-md-manifest-and-output.yaml:51-52`
- **Failure scenario:** the notes assert every AC other than AC1.1 passes;
  AC6.1 run as written fails (F1). A G2 human trusting the notes approves an
  R6 violation without ever seeing the grep hit. The AC6.1 evidence was either
  not executed or its match discarded.
- **Requirement:** task acceptance test AC6.1; run-record accuracy.

### F3 — major — Preamble clause (b) is inaccurate about the file's own structure
- **Where:** `adapters/agents-md/manifest.json` preamble → `AGENTS.md:10`
- **Failure scenario:** the preamble instructs consumers "Each `##` section
  below is one dispatchable role"; the file has 33 `##` headings, only 7 of
  which are roles. An LLM consumer following that instruction enumerates
  "Dispatch", "Rules", "Escalate when", "Report back" as dispatchable roles;
  an outline-scoping consumer extracting the `## reviewer` section gets only
  the two generated lines, because the body's `# Reviewer` H1 (higher-level
  heading) terminates the H2 section before the role text — the role's rules
  are silently dropped from a "dispatch as reviewer" context. (Mechanical
  variant PLAUSIBLE — no surveyed consumer parses by outline; the LLM-reader
  variant is concrete: the preamble is an instruction and it is false.)
- **Requirement:** plan §3(b) mandates the *content* (role adoption is
  dispatch-conditional), not the literal phrase; ADR-3's structure makes the
  literal phrase wrong. In-surface fix: reword to identify roles precisely,
  e.g. "each of the seven role sections, headed `## <role-name>` (analyst,
  architect, implementer, reviewer, verifier, ops, historian)". Since §3(b)'s
  own wording conflicts with ADR-3, the Architect should bless the reword in
  the same amendment as F1.

### F4 — minor — Preamble says "see the header below"; the provenance header is above
- **Where:** `adapters/agents-md/manifest.json` preamble → `AGENTS.md:8` vs `AGENTS.md:1-2`
- **Failure scenario:** a reader told the do-not-edit header is below scans
  down, finds none, and concludes the note is stale. One-word manifest fix
  ("above") + re-render.

## Ruling on the logged AC1.1 deviation

**Accepted as evidence substitution.** Spec AC1.1 (the binding criterion)
requires only that the render runs clean and writes output for all 7 roles in
the manifest's `roles` array — no heading-count clause. The task file's literal
`grep -c '^## ' == 7` was authored on a structural assumption ADR-3
(review-approved in task 01) had already invalidated; the count of 33 is a
direct consequence of the approved design, not a build defect. The implementer's
scoped substitute (`grep -cE '^## (analyst|...|historian)$'` → 7) was
independently reproduced, and role coverage/order verified against the manifest.
The deviation was correctly logged, correctly not "fixed" by heading demotion,
and the task file left unedited — all right calls. Note, however, that the same
structural fact the deviation exposes makes the preamble's own claim false —
that half is a real artifact defect (F3), not an evidence-wording problem.

## Coverage

All checks executed live at 4b7231a (worktree HEAD == diff commit), not taken
from the implementer's notes.

- **R1 / AC1.1 (spec form):** `python3 scripts/render-agents.py` runs clean;
  all 7 roles render as `## <role>` sections in manifest order; scoped grep → 7.
  Clean (see ruling above).
- **R1 AC1.2 / R7 AC7.1 (byte parity):** re-render at HEAD →
  `git status --short` empty; `git diff --stat -- roles/ contracts/
  .claude/agents/ .github/agents/` empty. The committed AGENTS.md is
  byte-identical to a fresh render of the approved task-01 renderer. Clean.
- **R2 / AC2.2:** manifest `output_dir: "."`, `filename: "AGENTS.md"` — exactly
  the plan §1 schema / ADR-1 single-root-file shape. Clean.
- **R3 / AC3.1+AC3.2:** for all seven roles, the rendered
  `**Allowed capabilities**` list programmatically equals the role's
  frontmatter `capabilities` (compared per role); exactly 7 such lines exist in
  the file, so the plan §3 grep scoping holds — narrow-only by construction.
  Clean.
- **R4 / AC4.1:** `AGENTS.md:1-2` is `HEADER.format(role="*")` — the existing
  DO-NOT-EDIT template with `roles/*.md`. Clean.
- **R5 / AC5.1+AC5.2:** live probe — appended one byte to AGENTS.md → `--check`
  exit 1 with `AGENTS.md` listed under STALE; re-render → `--check` exit 0;
  working tree restored (diff empty). Same workflow invocation, no new
  script/job. Clean.
- **R6, adapter-authored content:** title, preamble, and generated lines
  contain no vendor/model term (grep scoped to `AGENTS.md:1-25` clean), no line
  starts `model:`/`vendor:`, other adapters' output paths not named, capability
  vocabulary not enumerated in the preamble, `_comment_scope` key present in
  the manifest and absent from rendered output. The **only** AC6.1 hit is
  role-body-sourced (F1).
- **Manifest schema:** keys are exactly plan §1's plus the task-welcomed
  `_comment` key; `tools_style`/`tool_map`/`model_map`/`model_overrides`/
  `model_vendors`/`extra_frontmatter`/`headless` all absent as required. Clean.
- **Dispatch lines:** rendered `**Dispatch:**` text equals frontmatter
  `dispatch` (spot-checked analyst, historian). Clean.
- **Not assessed:** live behavior of AGENTS.md-reading consumers (out of scope
  — no headless dispatch this run); Python 3.9 interpreter execution (plan
  risk 5, Verifier's item); renderer internals (task 01, review-01 approved).

## Boundary check

Declared surface: `adapters/agents-md/manifest.json`, `AGENTS.md`, plus the
task file's notes block per dispatch. The commit touches exactly those —
manifest (new), AGENTS.md (new), an append-only notes block in
`runs/agents-md-adapter/tasks/02-agents-md-manifest-and-output.yaml` (no other
line of the task file changed; `status:` and `acceptance_tests:` untouched) —
plus `runs/agents-md-adapter/state.yaml`, which is orchestrator bookkeeping,
out of scope per dispatch. No edits to `roles/`, `contracts/`,
`scripts/`, or either existing adapter. **Inside boundary.**
