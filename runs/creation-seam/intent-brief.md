# Intent Brief: Run-creation seam — `agentic new` / `agentic arm`

<!-- Authored by Nathan Carter (via cockpit session, 2026-07-21). Implements the
     seam+CLI subset selected in the fleetview-intake partial selection
     (run/fleetview-intake, 2026-07-16); design input:
     runs/fleetview-intake/design/seam-reference.md (see its retro's caveats). -->

## Profile

standard

## Problem

There is no run-creation seam anywhere in the stack. Starting a run means
hand-authoring `runs/<slug>/intent-brief.md` and `state.yaml` on a fresh
`run/<slug>` branch and pushing it — multi-step, error-prone, and the single
largest source of intake friction keeping real work out of the pipeline (and
therefore keeping the burden/approval-rate metrics starved of data). The
`fleetview-intake` design run specified the fix — one creation seam in core, a
staged→armed lifecycle, thin carriers — and its G2-held seam reference is the
design of record, but no code exists: no `stageRun` on `RunSource`, no
`agentic new`/`arm`, no staged-run rendering. Separately, #118 records that no
component opens the run's draft PR, so the documented G2 PR-sync path silently
never fires for runs nobody hand-opened a PR for.

## Motivation

This is the first slice of the sequenced intake path (analysis of 2026-07-21):
intake is a transcription seam, not a surface. Landing it (a) makes run
creation a seconds-long act from the terminal, (b) unblocks the dogfood
discipline — every framework change of at least patch weight runs as a run —
which is what feeds the UX feedback loop, and (c) mints the staged-run record
that later evidence-chain work (#121, #125) anchors on. It is also the first
run executed under the `standard` profile (#156) — its own dispatch history is
acceptance evidence for profiles.

## Constraints

- Plan against current `main` (run profiles #156 merged): the seam reference's
  ADR-2 (`staged` as a new phase-enum value) predates profiles and must be
  re-decided against `PROFILE_PHASES`/D21; prefer existing vocabulary — a new
  enum value needs a contract amendment plus derivation/readiness rows, and a
  `paused`-based staged rest state may be sufficient. Record the choice as an
  ADR either way.
- Exactly one creation seam, in core beside `RunSource` (seam reference R5):
  a pure scaffold planner plus a create-only CAS staging write. The CLI is a
  thin carrier; no server route in this run.
- `agentic new` is flags-first non-interactive with an interactive TTY
  fallback (R11); `--profile patch|standard|full` selects the run profile and,
  for `patch`, scaffolds the single work-item stub the author fills in.
- Staging and arming are separate human acts recorded in git (R7); nothing
  dispatches from a staged run. `agentic arm` rides the existing decision
  write path — never a parallel mutation.
- Every intake path is authenticated (R8): refuse to stage without a
  resolvable identity, with a named error, exactly like the existing `decide()`
  refusal.
- The staged scaffold's `state.yaml` matches the contract skeleton exactly;
  the committed brief is human-authored or human-confirmed, never
  machine-authored-as-human (R9).
- Draft-PR ensure (#118): decide and record the one-seam answer. The working
  decision from the analysis — the engine ensures the draft PR on first
  arm/dispatch (idempotent; covers hand-made, CLI-made, and future
  GitHub-made runs; skips with a logged note when there is no remote or
  token) — the architect may amend with rationale. Closing #118 is in scope.
- No vendor lock-in on task sources: this run may hard-wire nothing about
  GitHub Issues. The pluggable-driver registry and the GitHub trigger carrier
  are follow-on scope; leave the seam shaped so they plug in (R4 isolation).

## Out of scope

- Any web capture surface (withdrawn in the fleetview-intake partial
  selection; FleetView renders staged runs and at most an arm control — even
  that rendering can be a follow-on).
- The GitHub trigger carrier (`/queue`/label → staged run) and the task-source
  driver registry implementation.
- The GitHub decision grammar (#119) and anything signing-related (#123,
  #127) — the arm act must simply not foreclose them.
- LLM drafting of briefs from tracker items (seam reference ADR-6) — the
  degraded verbatim path is enough until a drafting model binding exists.
- Write-back to upstream trackers.
