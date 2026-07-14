# Review Report: 01-renderer-single-file-mode

<!-- Contract: produced by Reviewer; consumed by Implementer and gate G2.
     All sections required. Findings ranked most-severe first.
     BUDGET: one line + failure scenario per finding — no narrative. Reference
     the spec and diff (requirement numbers, file:line); never re-quote them. -->

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** f275c98 on run/agents-md-adapter, scoped to `scripts/render-agents.py`

## Findings

### F1 — minor — Unrecognized `render` value silently falls into the per-role branch
- **Where:** `scripts/render-agents.py:137`
- **Failure scenario:** manifest with `"render": "single_file"` (underscore typo)
  → per-role branch → `KeyError: 'tool_map'` traceback instead of a clear error
  (reproduced live). Worse variant, also constructed: same typo on a manifest
  that *does* carry `tool_map` and a `{role}`-less filename → each role's
  per-role render overwrites the same out_path, the file ends up as the last
  role's frontmatter render, and `--check` passes green on it.
- **Requirement:** none violated; the dispatch expression is exactly plan §2's,
  so any fix is a plan-level choice (e.g. reject unknown `render` values).
  Task 02's manifest is in-repo and reviewed, so no live exposure this run.

### F2 — minor — Error precedence in `render_agent()` changed: tool_map check now runs before the model lookup
- **Where:** `scripts/render-agents.py:71` vs `:73-82` (lookup moved below the
  `lines` construction)
- **Failure scenario:** manifest with `model_map`, a capability missing from
  `tool_map`, *and* an unmapped `capability_profile` → pre-diff reported "no
  model for profile ...", post-diff reports "capability ... missing from
  tool_map". Both SystemExit/exit-1; unobservable for both existing (complete)
  manifests. The pinned missing-profile SystemExit itself is byte-identical in
  message and trigger (verified live — see Coverage).
- **Requirement:** task scope "keep the existing missing-profile SystemExit
  exactly" — held for the exception and message; only inter-error ordering
  moved.

## Coverage

All checks below were executed live (real repo for parity/`--check`; a
throwaway copy of `scripts/` + `roles/` under `/tmp` with a synthetic
`render: single-file` manifest for the paths task 02 will exercise), not taken
from the implementer's notes.

- **R7 / AC7.1 (renderer half):** `python3 scripts/render-agents.py` then
  `git diff --stat -- .claude/agents/ .github/agents/` → empty; `--check` →
  exit 0 with only the two existing manifests present. Byte-parity clean.
  The per-role loop body was moved verbatim into `_sync()`
  (`scripts/render-agents.py:119-127`); compare/write/print behavior identical.
- **R7 / AC7.2:** imports are exactly `json`, `sys`, `pathlib.Path`
  (AST-verified); `ast.parse(..., feature_version=(3,9))` accepts the file; no
  new stdlib API calls beyond those already used pre-diff. Clean. (Local
  interpreter is 3.14, so 3.9 compat is syntax-verified, not run-verified — the
  plan's risk 5 note to the Verifier still applies.)
- **Task AC 4 (unchanged error path):** synthetic `model_map`-bearing manifest
  with unmapped `capability_profile` → SystemExit with the original message
  format. `capability_profile` required only when `model_map` present;
  `dispatch`/`capabilities` unconditionally required. Clean.
- **R1 (renderer half):** synthetic single-file manifest with the seven
  dispatchable roles renders end-to-end; `## <role>` sections appear in
  manifest order. Clean.
- **R3 machinery:** the generated `**Allowed capabilities**` line matches plan
  §2's shape byte-for-byte (em dash included) and, for all seven roles, its
  list equals the role's frontmatter `capabilities` exactly (programmatic
  compare) — narrow-only holds by construction. Clean.
- **R4:** `HEADER.format(role="*")` emitted first; renders as `roles/*.md` in
  the provenance comment. Clean.
- **R5 machinery:** single-file path routes through the same `_sync()`; live
  probe: hand-edit one byte → `--check` exit 1 with the file listed under
  STALE; re-render → `--check` exit 0. AC5.1/AC5.2 semantics hold. Clean.
- **R6 (script half):** single-file path never reads `model_map`/
  `model_overrides`/`capability_profile`/`tool_map`; no `model:`/`vendor:`
  lines in generated output (grep on rendered synthetic file empty). A manifest
  with `model_overrides` but no `model_map` ignores the overrides — exactly the
  plan §2 gate; noted, not a defect. Clean.
- **Error paths:** role missing `dispatch`/`capabilities` (orchestrator) →
  SystemExit in the existing style. Manifest missing `title`/`preamble` →
  KeyError, consistent with how all other required manifest keys
  (`output_dir`, `tool_map`) already fail — matches existing convention, not
  flagged. Empty `preamble` array → two consecutive blank lines after the
  title (cosmetic; plan §3 obliges task 02's manifest to carry real preamble
  content). Single trailing newline at EOF verified by byte inspection.
- **Not assessed:** the real agents-md manifest and committed AGENTS.md
  (task 02, by design); concurrency (none in scope); live behavior of an
  actual Python 3.9 interpreter.

## Boundary check

Declared surface: `scripts/render-agents.py` plus the task file's notes block.
The commit touches `scripts/render-agents.py`, an append-only notes block in
`runs/agents-md-adapter/tasks/01-renderer-single-file-mode.yaml` (no other
lines of the task file changed; `status:` untouched), and
`runs/agents-md-adapter/state.yaml` — the latter is orchestrator bookkeeping,
out of scope per dispatch. No edits to `roles/`, `contracts/`, or either
existing manifest (`git diff --stat` empty). **Inside boundary.**
