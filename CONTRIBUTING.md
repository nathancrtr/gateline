# Contributing

Thanks for your interest in gateline. Here is the honest state of things.

## Code contributions: not yet

gateline is currently **maintainer-authored by policy**, not by accident. Settling a
contribution policy (CLA or DCO) is a deliberate prerequisite to accepting
outside code, because it preserves licensing options that matter for the
project's long-term health. Until that lands, pull requests from outside the
maintainer will be read with gratitude and closed without merging — file the
substance as an issue instead, and it will be credited if it becomes a change.

## Issues: very much yes

The most valuable contributions right now:

- **Integration reports.** You ran `integrate.py init` on a real repo — what
  broke, what surprised you, what the Integrator's profile got wrong. This is
  the feedback the framework is explicitly designed to absorb.
- **Run evidence.** You drove a pipeline run and an agent misbehaved, a
  contract was ambiguous, or a gate presented badly. Note which artifact was
  malformed and which role produced it.
- **Design findings.** Places where DESIGN.md's principles conflict with what
  you observed in practice.

One thing to know about how fixes land here: framework fixes are routed by
kind. Agent misbehavior goes to the role spec (`roles/*.md`); a malformed or
ambiguous handoff goes to the contract (`contracts/*`); a model or vendor
change goes to `registry/models.yaml`. Issues that identify the layer save a
round-trip.

## Working in this repo

- `.claude/agents/` and `.github/agents/` are rendered files — never hand-edit
  them. Edit the source role spec or adapter manifest, then run
  `python3 scripts/render-agents.py` (CI fails stale renders).
- Tests: `pytest scripts/test_integrate.py` for the integration tool,
  `npm test` in `frontend/` for Gatehouse and the orchestrator (Node ≥ 24),
  `pytest apps/wordfreq` for pipeline-run output.
- Everything that vendors into host repos stays stdlib-only, Python
  3.9-compatible.
- No vendor or model name may appear in `roles/` or `contracts/`; concrete
  model IDs live only in `registry/models.yaml`.
- Completed runs under `runs/` are historical records — never retro-edit them.
