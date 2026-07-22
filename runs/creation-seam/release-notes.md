# Release notes: run-creation seam (`agentic new` / `agentic arm`)

This run adds the single core seam for minting a run, plus the human-facing
CLI carriers over it, and closes out the long-standing draft-PR gap.

## What shipped

- **`agentic new`** — a thin, flags-first CLI carrier that stages a new run:
  slug/title/profile/brief content in, a two-blob genesis commit
  (`intent-brief.md` + `state.yaml`) out. Non-interactive by default, with an
  interactive TTY fallback (drafted brief for edit + explicit confirm) for
  missing required content. The brief is always human-authored or
  human-confirmed — `agentic new` never invents Problem/Motivation/Constraints
  prose.
- **`stageRun` seam** — the one place in the stack that mints a run branch: a
  pure scaffold planner (`planRunScaffold`, in `@agentic/core`'s record layer)
  paired with a create-only, compare-and-swap staging write on
  `RunSource`/`LocalGitSource`. Fails closed on an already-taken branch,
  refuses without a resolvable git identity, and is idempotent under a
  repeated call with the same staging identity (same slug or client key).
- **Staged rest state** — a staged-but-unarmed run is `phase: paused` with
  `paused_reason: staged`, chosen so the existing derivation table already
  rests it (no dispatch, no false escalation) with no new phase value or
  per-profile wiring. `agentic arm <slug>` is the one path that starts it,
  riding the existing decision-write path (a new `arm` action, attributed to
  the arming human, one commit).
- **Draft-PR ensure** — a best-effort, never-throwing check (`ensureDraftPr`)
  that opens a run's draft PR on first arm or first dispatch if one doesn't
  already exist, idempotently, regardless of whether the branch was hand-made
  or CLI-made. Degrades to a logged skip when there's no remote or no usable
  `gh` auth, rather than failing the arm/dispatch.

## Contract changes

`contracts/state.yaml` gains comment-only documentation: the `staged` value
in the `paused_reason` vocabulary, the two new human-decision grammar lines
(`staged by <name> [client-key: <key>]`, `armed by <name>`), and a commented
example of the optional `intake:` block (source-agnostic staging provenance,
written once at staging and never edited after). No structural change to the
illustrative document.

Closes #118
