# Adapter: Claude Code

Maps the runtime-neutral role specs onto Claude Code subagents so every operator can
run the pipeline from their terminal today. This is the skeleton's **v0** runtime:
the human drives the main session as Orchestrator and dispatches role subagents.

## The mapping

| Role spec | Subagent | Model binding (via registry profile) | Tool narrowing |
|-----------|----------|--------------------------------------|----------------|
| `roles/analyst.md` | `.claude/agents/analyst.md` | balanced → `sonnet` | read + write (artifacts only, by instruction) |
| `roles/architect.md` | `.claude/agents/architect.md` | frontier-reasoning → `fable` | read + write (artifacts only, by instruction) |
| `roles/implementer.md` | `.claude/agents/implementer.md` | balanced → `sonnet` | full edit + bash |
| `roles/reviewer.md` | `.claude/agents/reviewer.md` | frontier-reasoning → `fable` | read + git via bash; writes report only |
| `roles/verifier.md` | `.claude/agents/verifier.md` | balanced → `sonnet` | full edit + bash (tests only, by instruction) |
| `roles/ops.md` | `.claude/agents/ops.md` | balanced → `sonnet` | edit + bash (pipeline/config only, by instruction) |
| `roles/orchestrator.md` | **you** (v0) | — | the main Claude Code session, driven by a human |

Each subagent body is a condensed, self-contained rendering of its role spec (subagents
start cold, so instructions are inlined) and points back to `roles/<role>.md` as the
authoritative source. **If you change a role spec, re-render the subagent** — the role
spec is the source of truth; drift between them is a bug.

## Honest limitations of this adapter

- **P5 decorrelation is only partially honored.** The registry pins Reviewer/Verifier
  away from the Implementer's *vendor*, but this harness runs one vendor. The interim
  fallback is different model lineages (`fable` reviews `sonnet` output). Full
  decorrelation requires a second adapter wrapping another vendor's CLI for the
  Reviewer role — see [`adapters/copilot-cli/`](../copilot-cli/), which hosts
  Anthropic/OpenAI/Google models natively and binds Reviewer/Verifier to a genuinely
  different vendor than Implementer.
- **Tool narrowing is coarse.** `tools:` frontmatter restricts which tools a subagent
  has, but path-level rules ("write only under `runs/<slug>/`", "tests only") are
  enforced by instruction, and belt-and-braces by gate review. Hooks
  (PreToolUse path checks) can harden this later if instruction-level compliance
  proves insufficient in practice.
- **The round cap and budget are enforced by you** (as v0 Orchestrator) via
  `state.yaml`. The v1 orchestrated adapter automates this.

## Usage

See [`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md) for a full toy run with
copy-pasteable dispatch prompts.
