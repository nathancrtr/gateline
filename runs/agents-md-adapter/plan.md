# Technical Plan: AGENTS.md render target

<!-- Contract: produced by Architect; consumed by Implementers, Reviewer.
     Gate: G1. All sections required. Accompanied by tasks/*.yaml. -->

## Approach

Add a third adapter, `adapters/agents-md/manifest.json`, and teach the shared
renderer a second render mode. The dialect survey below (R2) finds that the
AGENTS.md convention is a *repo-context* convention — one Markdown file per
directory scope, located by fixed filename — not a per-agent registry, so the
output is a single `AGENTS.md` at the repo root containing all seven dispatchable
roles as sections.

`scripts/render-agents.py` gains a manifest-selected `"render": "single-file"`
mode that concatenates a provenance header (R4), an adapter-supplied preamble,
and one section per role: a generated dispatch line, a generated
capability-narrowing statement built verbatim from the role's frontmatter (R3),
and the role body included byte-verbatim. The existing per-role frontmatter mode
is untouched except that the `model:` line becomes conditional on the manifest
declaring model bindings (spec context note 1); both existing manifests declare
them, so their output is byte-identical (R7). The new manifest carries no model,
vendor, tool-map, or headless keys at all (R6, out-of-scope list). Because
`main()` already globs `adapters/*/manifest.json` and the new mode reuses the
same compare/write/stale logic, `--check` in the existing workflow covers the
new output with no new script or job (R5).

Two tasks: (01) the renderer change, (02) the manifest plus the committed
rendered output. Their file-contact surfaces are disjoint, but 02 functionally
depends on 01 (a `render: single-file` manifest crashes the current renderer),
so they run sequentially, 01 → 02.

## Dialect survey (R2)

**Question:** do real AGENTS.md consumers parse a single root file or per-agent
definition files?

**Evidence** (named consumers and how each locates/parses the file; all claims
as of this model's knowledge cutoff, January 2026 — see limits below):

| Consumer | Locate/parse behavior | Citation |
|----------|----------------------|----------|
| OpenAI Codex (CLI, cloud, IDE) | Reads the file literally named `AGENTS.md`; walks from the working directory up to the repo root, and nested `AGENTS.md` files deeper in a monorepo take precedence for files beneath them. Content is freeform Markdown injected as context — no schema, no frontmatter. | https://agents.md ; https://github.com/openai/codex (README / docs, AGENTS.md support) |
| GitHub Copilot coding agent | Supports `AGENTS.md` as repository custom instructions; the nearest `AGENTS.md` in the directory tree applies, with a single root file as the common case. | https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot |
| Cursor | Reads a root `AGENTS.md` as plain-Markdown project instructions (added 2025 alongside its own rules format). | https://docs.cursor.com/context/rules |
| Google Jules | Reads `AGENTS.md` in the target repo as agent instructions. | https://jules.google (docs) |
| Gemini CLI | Context file is configurable (`contextFileName`); pointing it at `AGENTS.md` is the documented interop path. | https://github.com/google-gemini/gemini-cli (configuration docs) |
| Convention steward | agents.md defines exactly one dialect: a Markdown file named `AGENTS.md`, "a README for agents", per directory scope; it maintains the consumer list (Aider, Devin, Factory, Zed, and others). No per-agent multi-file dialect is defined. | https://agents.md |

**Finding:** every named consumer discovers the file by its fixed name within a
directory scope. The only multi-file variant in the convention is *nested
directory scoping* (monorepos), never *one file per agent*. Per-agent definition
files exist only as runtime-proprietary dialects (`.claude/agents/*.md`,
`.github/agents/*.agent.md`) — both already covered by existing adapters. A
per-role directory of AGENTS.md-style files would be discovered by **zero**
surveyed consumers.

**Evidence limits and residual uncertainty (for the G1 human):** this run has no
web access; the table rests on the convention as publicly documented through the
knowledge cutoff plus this repo's intent brief (which attributes stewardship to
the Agentic AI Foundation). The convention moved fast through 2025. Before or at
G1, a one-minute spot-check of https://agents.md is warranted to confirm (a) no
per-agent/registry dialect has since been added, and (b) the consumer claims
above still hold. ADR-1 depends on this finding; if it flips, only the manifest's
`output_dir`/`filename` and the single-file mode choice change, not the
capability-prose or provenance design.

## Interface contracts

### 1. Manifest schema — `adapters/agents-md/manifest.json`

```json
{
  "adapter": "agents-md",
  "render": "single-file",
  "output_dir": ".",
  "filename": "AGENTS.md",
  "roles": ["analyst", "architect", "implementer", "reviewer",
            "verifier", "ops", "historian"],
  "title": "Agent roles",
  "preamble": ["<line>", "<line>", "..."]
}
```

- `render` — new optional key across all manifests; absent means `"per-role"`
  (current behavior). Existing manifests are not edited.
- `title` / `preamble` — adapter-owned prose; `preamble` is a JSON array of
  strings joined with `"\n"` (stdlib-friendly multi-line). Content constraints in
  §3 below.
- Deliberately absent: `tools_style`, `tool_map`, `model_map`, `model_overrides`,
  `model_vendors`, `extra_frontmatter`, `headless`. The single-file path must not
  require or read any of them (R6; out-of-scope: no headless section).

### 2. Renderer — `scripts/render-agents.py`

- `parse_role(path)`, `parse_list(value)`, `render_tools(...)` — unchanged.
- `render_agent(role, manifest) -> str` — one change: the model lookup and the
  `model: %s` frontmatter line are emitted **only when `"model_map" in
  manifest`**; when present, the existing missing-profile `SystemExit` is
  preserved. Both existing manifests define `model_map`, so their rendered bytes
  are identical (AC7.1).
- **New** `render_single_file(manifest) -> str` — returns, in order:
  1. Provenance header: `HEADER.format(role="*")` — i.e. the existing template
     reading `RENDERED from roles/*.md by scripts/render-agents.py - DO NOT
     EDIT...` (AC4.1).
  2. `# {title}` and the joined `preamble`.
  3. For each role in `manifest["roles"]` order, a section shaped exactly:

     ```
     ## {role}

     **Dispatch:** {front["dispatch"]}

     **Allowed capabilities** (from `roles/{role}.md` frontmatter; this list is exhaustive — the role must not use any capability not named here): {", ".join(parse_list(front["capabilities"]))}

     {body, rstripped, byte-verbatim}
     ```

  Required frontmatter keys in this mode: `dispatch`, `capabilities`
  (`SystemExit` in the existing style if missing). `capability_profile` is not
  required and not read — no model semantics in this path.
- `main()` — dispatches on `manifest.get("render", "per-role")`. Single-file
  mode computes one `out_path = REPO / manifest["output_dir"] /
  manifest["filename"]` (no `.format(role=...)`) and feeds it through the same
  compare / write / stale-list logic the per-role loop uses, so `--check`
  semantics (AC5.1/AC5.2) hold with no new code path for staleness. Factor the
  shared compare/write/stale step into one helper if that avoids duplication;
  either way behavior is as today.
- No new imports; no syntax newer than Python 3.9 (AC7.2).

### 3. Rendered-output content constraints

- The `title`, `preamble`, and generated lines must not contain (case-
  insensitive) `sonnet`, `haiku`, `fable`, `claude`, `gpt`, or `gemini`, and no
  line may begin `model:` or `vendor:` (AC6.1). Consequence: the preamble may
  not name the other adapters' output paths (`.claude/agents` would trip the
  grep); say "the runtime-specific adapters" instead.
- Within a role's section, capability tokens (`read`, `search`,
  `write-artifacts`, `edit-code`, `shell`) as a *stated capability list* appear
  only on the generated **Allowed capabilities** line, built verbatim from that
  role's frontmatter — so AC3.2 (narrow-only) holds by construction. The
  preamble must not enumerate the full capability vocabulary. Verification note:
  AC3.1/AC3.2 greps scope to the `**Allowed capabilities**` lines, since role
  bodies naturally use words like "read" and "search" in prose.
- The preamble must state: (a) this file renders `roles/*.md` into the AGENTS.md
  convention; (b) each `##` section is one dispatchable role — an agent adopts a
  role's instructions only when explicitly dispatched as that role, and an agent
  not dispatched as a role treats this file as reference documentation; (c) each
  role's Allowed-capabilities line is a ceiling — a runtime executing a role
  must not use capabilities outside it, even though AGENTS.md has no
  machine-enforceable allowlist field (R3 rationale, spec assumption 4).

## Decisions (ADRs)

### ADR-1: Single root `AGENTS.md`, not per-agent files
- **Choice:** render all seven roles into one `AGENTS.md` at the repo root
  (`output_dir: "."`, `filename: "AGENTS.md"`), per the dialect survey above.
- **Rejected:** one file per role under a directory (e.g. `agents/<role>.md`) —
  it mirrors the existing per-role loop and the other two adapters, but no
  surveyed AGENTS.md consumer enumerates a directory of agent files; the output
  would be discoverable by nothing, failing the adapter's entire purpose
  (intent: meet runtimes at the convention they already read).
- **Consequences:** the renderer needs a single-file mode (ADR-2); the repo root
  gains a rendered file under `--check` guard; all-roles-in-one-file means
  ambient-context consumers see every persona (risk 2).

### ADR-2: Extend the shared renderer with a manifest-selected `render` mode
- **Choice:** add `"render": "single-file"` handling to
  `scripts/render-agents.py`; make the frontmatter `model:` line conditional on
  `model_map` presence; keep one glob-driven `main()` so the existing `--check`
  invocation covers the new target.
- **Rejected:** a separate render script for this adapter — directly violates
  R5's "no new script or CI job" and forks the provenance/staleness machinery.
  Also rejected: shoehorning the per-role loop (render seven fragments,
  concatenate outside the loop) — the loop's per-role `out_path` compare/write
  can't express one output for N roles without contortions worse than a clean
  mode branch.
- **Consequences:** `render` becomes a reserved optional manifest key for all
  adapters (absent = current behavior; existing manifests untouched). The
  renderer change lands before the manifest (task 02 depends on 01), since a
  `single-file` manifest crashes today's `render_agent()` (`model_overrides`
  indexing, `{role}`-less filename).

### ADR-3: Role bodies verbatim; generated preamble carries dispatch + capabilities
- **Choice:** include each role body byte-verbatim (no YAML frontmatter block —
  AGENTS.md is plain Markdown — and no heading demotion), prefixed by a
  generated `## <role>` heading, dispatch line, and Allowed-capabilities line.
- **Rejected:** demoting body headings one level (`#` → `##`) for a clean
  single-document outline — requires fence-aware Markdown transformation in a
  stdlib-only script and risks silently altering role text; every surveyed
  consumer treats the file as freeform prose, so repeated H1s cost nothing.
  Also rejected: omitting the generated capability line and relying on role
  prose — role bodies never enumerate their own capability frontmatter, so R3
  would silently fail.
- **Consequences:** the file contains multiple H1s (one per role body) under the
  generated `##` section headings; AC3.1/AC3.2 checks anchor on the generated
  `**Allowed capabilities**` lines.

### ADR-4: Adapter prose lives in the manifest, mechanics in the script
- **Choice:** `title` and `preamble` are manifest keys; the script contributes
  only the header and the per-role generated lines.
- **Rejected:** hardcoding the AGENTS.md preamble in `render-agents.py` — puts
  adapter-specific prose in the shared runtime-neutral script, and every wording
  tweak becomes a script change instead of an adapter change.
- **Consequences:** the AC6.1 content constraints (§3) bind the manifest author
  (task 02), not the script; the JSON-array-of-lines idiom is mildly awkward but
  keeps the renderer stdlib/JSON-only.

## Requirement → task mapping

| Requirement | Task(s) |
|-------------|---------|
| R1 | 01, 02 |
| R2 | this plan (Dialect survey, ADR-1 — AC2.1); 02 (AC2.2) |
| R3 | 01 (generation logic), 02 (rendered evidence) |
| R4 | 01 (header emission), 02 (rendered evidence) |
| R5 | 01 (single-file path reuses `--check` machinery), 02 (AC5.1/AC5.2 evidence) |
| R6 | 01 (no model semantics in single-file path), 02 (manifest omits bindings; AC6.1) |
| R7 | 01 (AC7.1 byte-parity, AC7.2) |

## Risks

1. **Survey is knowledge-cutoff-based, not live-verified.** No web access this
   run; if the convention added a per-agent dialect after the cutoff, ADR-1 is
   wrong. Early signal: the G1 human's spot-check of https://agents.md
   (explicitly requested above). Blast radius if wrong: manifest
   `output_dir`/`filename` + render mode; capability/provenance design survives.
2. **Ambient-context misread.** Any AGENTS.md consumer pointed at *this* repo
   ingests all seven personas as ambient instructions. Mitigation: preamble
   clause (b) in §3 makes role adoption dispatch-conditional. Early signal:
   role-confused agent behavior in future runs on AGENTS.md-reading tools;
   route as a role/contract finding if seen.
3. **AC6.1 is substring-brittle.** Any future preamble or role-body edit
   containing `claude`/`gemini`/etc. (e.g. citing `.claude/agents/`) trips the
   grep. Mitigation: §3 constraint; roles are already vendor-clean by invariant
   P2. Early signal: the Verifier's AC6.1 grep.
4. **Renderer refactor drifts existing bytes (R7).** The `model:`-conditional
   change or a compare/write refactor could perturb `.claude/agents/` or
   `.github/agents/` output. Early signal: task 01's acceptance step —
   re-render + `git diff --stat` on both directories must be empty before 01
   merges.
5. **Environment probe limitation.** This Architect session has no shell
   (`read, search, write-artifacts` only), so interpreter availability/version
   was not executed, only read: the Python 3.9/stdlib constraint is carried
   forward from the script's own docstring (wordfreq ADR-8) and CI's
   `ubuntu-latest` system `python3`. Binding constraint on both tasks: no new
   imports, no post-3.9 syntax; the Verifier should run the script under the
   operator's `python3` as part of AC1.1/AC5.x evidence.
