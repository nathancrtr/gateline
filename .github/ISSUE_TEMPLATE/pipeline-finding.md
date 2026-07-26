---
name: Pipeline finding
about: An agent misbehaved, a contract was ambiguous, or a gate presented badly during a run
labels: pipeline-finding
---

**Which layer** <!-- Framework fixes route by kind — pick one if you can: -->
- [ ] Role spec (`roles/*.md`) — an agent exceeded or misread its contract
- [ ] Contract (`contracts/*`) — a handoff artifact was malformed or ambiguous
- [ ] Registry (`registry/models.yaml`) — model binding or capability profile
- [ ] Integration (`scripts/integrate.py`, INTEGRATION.md workflow)
- [ ] Gatehouse / orchestrator (`frontend/`)
- [ ] Not sure

**What happened**
<!-- Which role, which artifact, what it did vs. what its contract says.
     Quote the artifact section if you can — redact anything private. -->

**The run context**
<!-- Runner and model binding; v0 (human-orchestrated) or v1; how the role
     was dispatched. -->
