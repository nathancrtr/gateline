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

Subagents are **generated, never hand-edited**: the renderer builds
each one from its role spec (the body, verbatim — subagents start cold, so the role
spec doubles as the inlined instructions) plus this adapter's
[`manifest.json`](manifest.json) (frontmatter shape, tool map, model spellings).
After changing a role spec or the manifest, run `gateline render`;
CI (`render-check.yml`) fails any PR whose rendered files are stale, so drift is
structurally impossible. Supporting a new runner costs one manifest, not six
hand-adapted agent files.

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
  `state.yaml`. The v1 orchestrated adapter automates this. The wordfreq run showed
  the budget half of this fails silently in practice — nothing surfaces per-dispatch
  cost to the human — so treat `cost_spent_usd` as aspirational until metering exists.
- **Parallel implementers share one working tree.** They see each other's mid-flight,
  possibly-broken states (observed in the wordfreq run: task 03's agent hit task 02's
  transient import error). Disjoint file-contact surfaces kept it harmless, but the
  clean fix is dispatching each parallel implementer in its own git worktree and
  merging results — adopt if mid-flight interference causes a real failure.

## Usage

See [`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md) for a full toy run with
copy-pasteable dispatch prompts.
