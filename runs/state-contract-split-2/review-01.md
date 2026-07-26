# Review Report: 01-contracts-split

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit a92cf02 on branch run/state-contract-split-2 (HEAD 39c473b carries no later edits to either contract: `git diff a92cf02 HEAD -- contracts/` is empty)

## Findings

None — no blocking, major, or minor defects.

## Coverage

Every acceptance check on this task passed mechanically, and the manual union diff found nothing dropped from the pre-split contract.

- AC1.1 core required keys ✓ — parsed both files with the npm `yaml` package
  (Node 24; `yaml` installed fresh in a temp dir because `frontend/` has no
  node_modules in this tree). Output:
  `contracts/state-core.yaml => ["run","paused_reason","gates","escalations"]`,
  `contracts/state.yaml => ["run","branch","phase","paused_reason","budget","gates","tasks","escalations"]` — both exact matches.
- AC1.2 / AC6.2 forbidden strings ✓ — ran
  `grep -nE 'G0|G1|G2|G3|run/<slug>|budget:' contracts/state-core.yaml`:
  no output, exit status 1. Manual sweep of the core found no other gate name,
  no ticket-system name, and no business vocabulary; `runs/<slug>/state.yaml`
  does not match `run/<slug>`, and the extension pointer uses "cost-ledger
  block", avoiding `budget:`. A vendor/model-name grep (P2) also exits 1.
- AC2.1 extension declarations ✓ — branch convention (`contracts/state.yaml:31`),
  seven-value phase ladder (line 32), G0–G3 with the profile-gates rule (lines
  67-81), tasks mirror with status vocabulary and review_rounds note (lines
  83-94), budget ledger rules (lines 53-65), paused_reason vocabulary (line 40).
- AC2.2 union diff ✓ — `git diff a92cf02^ a92cf02 -- contracts/state.yaml` is
  exactly two hunks (18 added / 8 removed): the expanded header and the
  `profile:` comment-out. Every other line is byte-identical, so all pre-split
  fields, writer rules, and provenance notes survive verbatim in the extension;
  the core adds gate-name-free restatements (gate entry shape with burden
  vocabulary, ISO-8601 note, human-only gate writes, bot-identity bookkeeping
  verbs, escalations shape, pause signal) on top of, not instead of, them.
- ADR-5 profile conversion ✓ — the `profile:` line and its six-line comment are
  preserved with only a `# ` prefix added (`contracts/state.yaml:34-39`),
  mirroring the `intake:` convention; the eight concrete top-level keys parse
  exactly as required.
- Core scope judgment checked ✓ — the core's extension paragraph names the
  SDLC concepts descriptively (phase ladder, branch convention, cost ledger,
  task mirror) with no keys and no examples, which stays inside the scope's
  "mention only that extensions may add fields" allowance and AC6.2's bound
  that every example stay within run identity, gates, escalations, pause.
- Implementer-claim reproduction ✓ — the notes' claimed grep and parse results
  could not be taken on trust (no node_modules exists in this tree), so both
  were re-run independently; results match the claims.
- R3 / AC3.3 and ADR-6 ✓ — `git show a92cf02 --name-only` lists only the two
  contracts and the task file; no `runs/*/state.yaml` and no
  `scripts/copy-manifest.json` changes.
- Not assessed: frontend parse behavior (AC3.1, AC3.2, AC4.x, AC5.x — tasks
  02/03) and docs consistency (R7 — task 04); out of this task's scope.

## Boundary check

In surface. The declared file_contact_surface is `contracts/state-core.yaml`
and `contracts/state.yaml`; the commit's only other change appends the
implementer's round-1 notes to the task's own file
(`runs/state-contract-split-2/tasks/01-contracts-split.yaml`), the standard
reporting channel, not a boundary breach. The working tree at HEAD is clean.
