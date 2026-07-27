# Specification: The writeState kill window wedges a run until a human hand-commits

## Context

A single mistimed process kill can wedge a run until a human repairs it with manual git surgery. That failure mode is real, grounded in the code and in the specific 2026-07-23 incident the brief describes.

`writeState`'s checked-out-branch path (`frontend/packages/core/src/sources/local-source.ts:350-367`) writes the mutated `state.yaml` into the worktree, then commits it as a second step. A kill between those two steps leaves the checkout dirty with no commit to explain it. Every later write on that branch reads the same dirty file and refuses with `dirty-worktree` (line 354), because the code has no way to tell its own abandoned write from a human's real in-progress edit — so it treats every dirty checkout the same way, forever.

The refusal message is thin: it names the file and the checkout path, not a remedy — matching the brief's account of manual, undocumented recovery. Restart-by-kill happens on every code update (docs/ORCHESTRATOR.md §13), so this window opens routinely, not rarely.

## Requirements

### R1 — Automatic recovery from an abandoned mid-write kill
A run whose checkout was left dirty by an engine kill between the working-tree write and its commit resumes making progress on its own, with no human hand-commit.

**Acceptance criteria:**
- [ ] AC1.1 — A test reproduces the kill window (the working-tree write to a checked-out branch's `state.yaml` lands, the following commit never runs) and then calls `writeState` again for that branch; the call returns `ok: true`, and `git status --porcelain` for that checkout is clean afterward.
- [ ] AC1.2 — Calling `writeState` a second time immediately after recovery also succeeds and leaves exactly the commits the two calls' mutations account for — no duplicate or orphaned commit from the recovery itself.

### R2 — A human's own edit is never silently discarded
Recovery only ever removes dirt it can attribute to the engine's own interrupted write; anything it cannot attribute that way is left exactly as the human left it, and the write still refuses.

**Acceptance criteria:**
- [ ] AC2.1 — The existing "refuses when the checked-out state file is dirty" case (`frontend/packages/core/test/write-path.test.ts`) — an unrelated hand edit appended to `state.yaml` — still returns `ok: false`, `reason: 'dirty-worktree'`, and the appended text is byte-identical on disk afterward.
- [ ] AC2.2 — A worktree dirtied by a human edit to `state.yaml` that could plausibly be mistaken for an abandoned engine write still refuses rather than guessing, and the edit's content is unchanged on disk after the refusal.

### R3 — A surviving dirty-worktree refusal names the run and the exact fix
When a `dirty-worktree` refusal is not self-healed, its message tells the operator which run it is and exactly what to type — not merely where the file is.

**Acceptance criteria:**
- [ ] AC3.1 — A `dirty-worktree` `WriteResult.message` includes the run's slug and at least one literal, copy-pasteable git command (scoped to the checkout path and the state file) that resolves the refusal, so an operator can act without reading source code first.

### R4 — The checkout stays reconciled with its branch throughout
The fix introduces no path where a checked-out branch's on-disk state silently diverges from its ref — the existing guarantee holds for both the recovery path and ordinary writes.

**Acceptance criteria:**
- [ ] AC4.1 — After a recovered write (R1) or an ordinary write through a checked-out branch, the checkout's `HEAD` matches the branch ref and `git status --porcelain` is empty — the existing "commits through the worktree when the branch is checked out (clean file)" test (`write-path.test.ts`) passes unmodified.

### R5 — No regression to the co-writer contract
The fix preserves compare-and-swap ref updates, comment-preserving YAML edits, and ISO-8601 timestamps on every write path it touches.

**Acceptance criteria:**
- [ ] AC5.1 — `npm test` and `npm run typecheck` in `frontend/` both pass, including every pre-existing case in `frontend/packages/core/test/write-path.test.ts` (CAS refusal, comment-preserving edits, the clean-checkout commit path).

## Assumptions

- **ASSUMPTION:** Issue #193 (named in the brief) proposes two candidate fixes and names files, but this environment has no access to fetch the issue body → resolved as: requirements state the required outcome (R1, R2) rather than a mechanism, leaving the choice between the issue's candidates (or a third design) to the Architect, recorded as an ADR — because *how* to prove a write is the engine's own is design work, and the analyst/architect split reserves that for the Architect.
- **ASSUMPTION:** The brief's constraint "any self-heal must prove the dirt is the engine's own abandoned write" doesn't name what counts as proof → resolved as: R1 and R2 are specified as observable outcomes (an abandoned engine write recovers; an edit that can't be attributed to the engine is never discarded), not a specific evidentiary mechanism, for the same reason as above.
- **ASSUMPTION:** The brief doesn't say whether recovery must reconstruct the exact content of the abandoned write, or whether discarding it and re-deriving the same action on a later tick is acceptable → resolved as: R1 requires only that the run resumes progress with no data loss visible to a human — not a specific finish-vs-discard strategy — because the orchestrator's derivation is already designed to be idempotent-to-rederive (docs/ORCHESTRATOR.md §4.2), so either strategy can satisfy it.
- **ASSUMPTION:** The brief's "any refusal that survives should name the run and print the exact remedy" reads broadly, but the Problem and Motivation sections describe only the `dirty-worktree` failure this kill window produces → resolved as: R3 scopes the named-run-plus-remedy requirement to `dirty-worktree` refusals only. Other `WriteFailure` reasons (`ref-moved`, `stale-checkout`, `no-identity`, `no-branch`) are unaffected by this run, because they are not the failure this kill window causes and the brief's own "Out of scope" list sends adjacent crash-window defects to separate runs.

## Out of scope

- Graceful drain and restart (#150) — this run makes the kill survivable, not avoided.
- Checkout teardown losing uncommitted work (#184) — a separate crash-window defect.
- The other four substrate bugs (#96, #97, #114, #115) — each gets its own run.
- Any change to gate grammar or to who may write `gates.*` — the orchestrator still never writes it.
- A general redesign of worktree lifecycle management.
- `stale-checkout`, `ref-moved`, `no-identity`, and `no-branch` refusal messages — R3 covers `dirty-worktree` only (see Assumptions).
- Changes outside `frontend/packages/core` (the brief pins the fix there).
