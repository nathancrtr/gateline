# Adapter: GitHub Copilot CLI

Maps the runtime-neutral role specs onto GitHub Copilot CLI custom agents so an
operator can drive the pipeline from `copilot` instead of Claude Code. Same **v0**
runtime as the Claude Code adapter: a human drives the main session as Orchestrator
and dispatches role agents one handoff at a time.

## The mapping

| Role spec | Agent profile | Model binding (via registry profile) | Tool narrowing |
|-----------|----------------|----------------------------------------|----------------|
| `roles/analyst.md` | `.github/agents/analyst.agent.md` | balanced → `claude-sonnet-5` | `read, search, edit` (artifacts only, by instruction) |
| `roles/architect.md` | `.github/agents/architect.agent.md` | frontier-reasoning → `claude-fable-5` | `read, search, edit` (artifacts only, by instruction) |
| `roles/implementer.md` | `.github/agents/implementer.agent.md` | balanced → `claude-sonnet-5` | `read, search, edit, execute` |
| `roles/reviewer.md` | `.github/agents/reviewer.agent.md` | frontier-reasoning, avoid vendor of implementer → `gpt-5.4` | `read, search, edit, execute` (git via execute; writes report only, by instruction) |
| `roles/verifier.md` | `.github/agents/verifier.agent.md` | balanced, avoid vendor of implementer → `gemini-3-flash` | `read, search, edit, execute` (tests only, by instruction) |
| `roles/ops.md` | `.github/agents/ops.agent.md` | balanced → `claude-sonnet-5` | `read, search, edit, execute` (pipeline/config only, by instruction) |
| `roles/orchestrator.md` | **you** (v0) | — | the main `copilot` session, driven by a human |

Each agent profile body is a condensed, self-contained rendering of its role spec
(custom agents start cold, so instructions are inlined) and points back to
`roles/<role>.md` as the authoritative source. **If you change a role spec, re-render
the agent profile** — the role spec is the source of truth; drift between them is a
bug.

Model identifiers above are **illustrative**, same convention as
[`registry/models.yaml`](../../registry/models.yaml): pin to whatever Copilot CLI's
`/model` list currently offers and re-verify pricing/limits when you do. Copilot CLI
model strings don't take vendor prefixes (unlike the registry's `anthropic/…` /
`openai/…` / `google/…` entries) — the adapter drops the prefix when it writes the
`model:` frontmatter field.

## Tool alias mapping

Copilot CLI's tool aliases are coarser than Claude Code's per-tool list. This
adapter's narrowing:

| Claude Code tool | Copilot CLI alias |
|-------------------|--------------------|
| `Read`, `Grep`, `Glob` | `read`, `search` |
| `Write`, `Edit` | `edit` |
| `Bash` | `execute` |

No agent profile lists `agent` (subagent delegation) or `web` — narrowing never
widens a role past what its spec grants, and none of these roles are specced to
delegate further or browse the web.

Every profile also sets `disable-model-invocation: true` and `user-invocable: true`.
Copilot CLI can otherwise auto-select a custom agent by keyword inference from a
prompt; this pipeline's roles are dispatched deliberately, at a specific phase, by
the human playing Orchestrator (P4) — silent auto-dispatch would let, say, a
"reviewer" fire on an unrelated question. Turning inference off makes explicit
dispatch (`/agent`, naming the agent, or `copilot --agent <name> --prompt '...'`) the
only path in, matching how the Claude Code adapter is actually used in v0 mode.

## Honest limitations and advantages of this adapter

- **P5 decorrelation is fully honored here, unlike the Claude Code adapter.** Copilot
  CLI natively hosts Anthropic, OpenAI, and Google models behind one interface, so
  Reviewer and Verifier can bind to genuinely different vendors than the Implementer
  (see the mapping table) — real cross-vendor decorrelation, not same-vendor,
  different-lineage as a fallback. If your team runs Copilot CLI as the primary
  driver, this is the adapter that satisfies the "different models for different
  agents" requirement most literally.
- **Custom agent profiles are a newer Copilot CLI surface** (`.github/agents/*.agent.md`).
  Behavior — especially `disable-model-invocation`, `tools` alias resolution, and
  non-interactive `--agent` dispatch — should be spot-checked against your installed
  Copilot CLI version before relying on it for a real run; verify with
  `copilot --agent analyst --prompt '...'` against the toy walkthrough before trusting
  it for a real one.
- **Tool narrowing is coarse and instruction-enforced**, same caveat as the Claude
  Code adapter: path-level rules ("write only under `runs/<slug>/`", "tests only")
  live in the profile body, not in a hard permission boundary. Belt-and-braces is
  gate review.
- **The round cap and budget are enforced by you** (as v0 Orchestrator) via
  `state.yaml`, identically to the Claude Code adapter.
- **User-level overrides.** Copilot CLI resolves an agent of the same name in
  `~/.copilot/agents/` *over* the project's `.github/agents/` copy. If a role behaves
  unexpectedly, check for a stray personal override before assuming the project
  profile is wrong.

## Usage

Interactive dispatch mirrors the Claude Code walkthrough
([`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md)) one-for-one — wherever it says
"use the **analyst** subagent for run `runs/wordfreq`," say the same thing to
`copilot`, or run non-interactively:

```bash
copilot --agent analyst --prompt "run runs/wordfreq"
copilot --agent architect --prompt "run runs/wordfreq"
copilot --agent implementer --prompt "task runs/wordfreq/tasks/01-<name>.yaml"
copilot --agent reviewer --prompt "task runs/wordfreq/tasks/01-<name>.yaml, diff run/wordfreq"
copilot --agent verifier --prompt "run runs/wordfreq, verify current branch"
copilot --agent ops --prompt "run runs/wordfreq"
```

Gate approvals, round-cap tracking, and `state.yaml` bookkeeping are still the human
Orchestrator's job, same as v0 under Claude Code.
