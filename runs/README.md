# runs/

One directory per pipeline run, on the run's branch (`run/<slug>`). The run directory
**is** the pipeline's state — no state lives anywhere else.

```
runs/<slug>/
├── state.yaml               # phase, gate ledger, budgets, task statuses (Orchestrator-owned)
├── intent-brief.md          # human-authored input
├── spec.md                  # Analyst  → gate G0
├── plan.md                  # Architect → gate G1
├── tasks/
│   └── NN-name.yaml         # one work item per Implementer (status + notes live here)
├── review-NN.md             # Reviewer, per task, per round
├── verification-report.md   # Verifier → gate G2
├── release-plan.md          # Ops → gate G3
└── retro.md                 # human observations after the run (feeds design iteration)
```

Historian sweeps are mini-runs with the same naming (`runs/historian-<date>/` on
branch `run/historian-<date>`) but a different shape — no `state.yaml`, no gates:

```
runs/historian-<date>/
├── sweep.yaml               # dispatch marker + one-entry ledger (orchestrator-owned)
└── docs-delta.md            # Historian → human review; merging the branch is the approval
```

Conventions:
- Artifacts are committed as they're produced — the audit trail is the git history.
- Templates for every artifact live in [`contracts/`](../contracts/); an artifact
  missing a required section is malformed and gets bounced, not guessed at.
- Gate approvals in `state.yaml` are written only by the named human approver.
- Merged run directories (sweeps included) are historical records — drift they
  evidence is fixed at the surface that drifted, never by editing the record.
