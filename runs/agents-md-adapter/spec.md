# Specification: AGENTS.md render target

## Context
`scripts/render-agents.py` currently renders `roles/*.md` into two adapters
(`adapters/claude-code/`, `adapters/copilot-cli/`), each producing one file per role
with a YAML frontmatter block (`name`, `description`, `tools`, `model`) plus the role
body, guarded by `render-agents.py --check` in CI. Two mismatches between the brief
and the renderer as it exists today shape the requirements below:

1. `render_agent()` unconditionally writes a `model: <value>` frontmatter line and
   requires a `model_map` lookup to succeed — but the brief puts model/vendor
   fields out of scope for this adapter's output. The shared renderer will need to
   treat the model line as adapter-optional, not just the new manifest.
2. `main()` assumes one output file per role (`out_dir / filename.format(role=role)`)
   — a single-root-file AGENTS.md dialect doesn't fit that loop unmodified. Which
   shape applies is exactly the survey the brief asks for before committing.

`roles/orchestrator.md` has no `dispatch`/`capabilities` frontmatter and is excluded
from both existing manifests' `roles` lists; the same exclusion applies here since
`render_agent()` raises on a role missing those keys.

## Requirements

### R1 — New adapter renders all seven dispatchable roles via the existing script
A new `adapters/<adapter-id>/manifest.json` lets `scripts/render-agents.py` produce
AGENTS.md-dialect output for analyst, architect, implementer, reviewer, verifier,
ops, and historian, with zero lines changed in `roles/*.md` or `contracts/*`.
**Acceptance criteria:**
- [ ] AC1.1 — `python3 scripts/render-agents.py` runs clean and writes output for all
  7 roles listed in the new manifest's `roles` array.
- [ ] AC1.2 — `git diff --stat -- roles/ contracts/` is empty after the adapter lands.

### R2 — Output shape matches a surveyed, evidenced dialect choice
Before the output shape is fixed, the run records which AGENTS.md dialect
(single root file vs. per-agent definition files) real consumers actually parse,
citing named tools/sources, and the manifest's `output_dir`/`filename` match that
finding.
**Acceptance criteria:**
- [ ] AC2.1 — `runs/agents-md-adapter/plan.md` contains a dialect-survey section
  naming at least one concrete AGENTS.md-reading consumer and how it locates/parses
  the file, with a citation (URL or repo reference) per claim.
- [ ] AC2.2 — The chosen `output_dir`/`filename` in the new manifest is the shape
  documented in that section (e.g., single `AGENTS.md` at repo root vs. one file per
  role under a directory).

### R3 — Capability narrowing survives in prose where the format can't enforce it
AGENTS.md has no tool-allowlist field, so for every role the rendered output states,
in plain language, the capability set that role is scoped to per its `roles/<role>.md`
frontmatter (`read`, `search`, `write-artifacts`, `edit-code`, `shell`) rather than
omitting it.
**Acceptance criteria:**
- [ ] AC3.1 — Each of the 7 rendered outputs contains a human-readable statement of
  that role's capability list, checkable by grepping the rendered text for each
  capability named in the corresponding `roles/<role>.md` frontmatter.
- [ ] AC3.2 — No rendered output lists a capability absent from that role's
  `roles/<role>.md` frontmatter (narrow-only, never wider).

### R4 — Provenance header parity
Rendered AGENTS.md output carries the same do-not-hand-edit provenance convention as
the two existing adapters.
**Acceptance criteria:**
- [ ] AC4.1 — Every rendered file (or, for a single-root-file dialect, the one
  rendered file) contains a header stating it is rendered from `roles/*.md` by
  `scripts/render-agents.py` and must not be hand-edited, matching the existing
  `HEADER` template's intent.

### R5 — CI staleness coverage with no new script or workflow
`render-agents.py --check` — the same invocation already wired into
`.github/workflows/render-check.yml` — catches drift in the new adapter's output
with no additional script or CI job.
**Acceptance criteria:**
- [ ] AC5.1 — Hand-edit a byte of the new adapter's rendered output, then run
  `python3 scripts/render-agents.py --check`: exit code 1, file listed under STALE.
- [ ] AC5.2 — Run `python3 scripts/render-agents.py` (no flag), then `--check` again:
  exit code 0.

### R6 — No model or vendor field in rendered output
Model/vendor binding stays exclusively in `registry/models.yaml` and the two
existing adapters; the new adapter's rendered output contains no model name, vendor
name, or `model`/`vendor` frontmatter key.
**Acceptance criteria:**
- [ ] AC6.1 — `grep -Ei "^model:|^vendor:|sonnet|haiku|fable|claude|gpt|gemini"` over
  every rendered AGENTS.md output for this adapter returns no matches.

### R7 — Existing adapters and script constraints are unaffected
Adding this render target changes no rendered output for `claude-code` or
`copilot-cli`, and `scripts/render-agents.py` remains stdlib-only and Python
3.9-compatible for all adapters, not just the new one.
**Acceptance criteria:**
- [ ] AC7.1 — `git diff --stat -- .claude/agents/ .github/agents/` is empty after the
  work lands.
- [ ] AC7.2 — `scripts/render-agents.py` imports nothing beyond the Python 3.9
  standard library (no third-party or 3.10+-only syntax).

## Assumptions
- **ASSUMPTION:** the brief never names the new adapter's directory → resolved as
  `adapters/agents-md/` because it names the convention, not a specific runtime,
  matching the naming pattern of `claude-code`/`copilot-cli` (runtime/convention id,
  not a product name).
- **ASSUMPTION:** the brief doesn't name which roles render → resolved as the same
  seven non-orchestrator roles the two existing adapters already render, because
  `roles/orchestrator.md` lacks the `dispatch`/`capabilities` frontmatter
  `render_agent()` requires and would error if included.
- **ASSUMPTION:** the brief doesn't say where the dialect survey (R2) is recorded →
  resolved as a section in the Architect's `plan.md` for this run, because that's
  the pipeline's existing artifact for design rationale (ADR-style entries already
  appear there per `docs/DESIGN.md`), not a new artifact type.
- **ASSUMPTION:** prose-stated narrowing (R3) cannot be runtime-enforced by any
  AGENTS.md-reading tool → resolved as an accepted residual risk this run, because
  the brief explicitly excludes headless dispatch through this adapter from scope,
  so no runtime actually executes under these unenforced boundaries yet.
- **ASSUMPTION:** the brief doesn't say whether `scripts/render-agents.py` itself may
  change → resolved as in-scope for editing (R6, R2/R7), because the brief's "zero
  lines changed" restriction names only `roles/` and `contracts/`, not the shared
  script, and R6/R2 are unreachable without it (see Context mismatches 1 and 2).

## Out of scope
- Orchestrated/headless dispatch through AGENTS.md-only runtimes; no `headless`
  manifest section this run.
- Any change to `adapters/claude-code/` or `adapters/copilot-cli/` beyond incidental
  manifest-schema reuse (e.g., adding a shared optional key both could ignore).
- A model or vendor binding field in the rendered output (R6).
- Publishing or announcing the adapter.
- A new GitHub Actions workflow file — the existing `render-check.yml` invocation
  covers the new target per R5.
