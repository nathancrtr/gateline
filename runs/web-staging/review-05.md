# Review Report: 05-web-staged-state-arm

**Verdict:** approve
**Round:** 1 of 3
**Diff reviewed:** commit 66b2fae (branch run/web-staging)

## Findings

### F1 — minor — api.ts's ADR-6 exception comment is now stale: it scopes the record-subpath value-import to "that one page" (new-run.tsx), but run.tsx:12 now value-imports `readIntake` from `@agentic/core/record`
- **Where:** `frontend/packages/web/src/api.ts:3-7` (vs `frontend/packages/web/src/pages/run.tsx:12`)
- **Failure scenario:** a maintainer auditing the browser-bundle ceiling trusts the comment, checks only new-run.tsx, and misses run.tsx's core import; no runtime failure (the record layer is browser-safe and already bundled under genesis-preview). api.ts is outside this task's file_contact_surface, so the fix needs routing to a task that owns it — a one-line comment amendment.
- **Requirement:** plan ADR-6 (consequence: the api.ts comment tracks the exception; the choice text sanctions value imports "only for the preview")

### F2 — minor, PLAUSIBLE — genesis line can mislabel a squash-merge commit as the genesis commit for merged runs
- **Where:** `frontend/packages/web/src/pages/run.tsx:71` (`detail.history[detail.history.length - 1]`)
- **Failure scenario:** a run staged via the seam is later squash-merged; served at the default branch, `stateHistory` sees one state.yaml-touching commit (the squash), so the header reads "genesis \<squashOid\> · \<mergeDate\>" — wrong oid and date. With a true merge commit the original genesis survives and the line is correct, hence PLAUSIBLE; display-only either way.
- **Requirement:** genesis-preview mockups 04/05 (genesis line = the staging commit)

### Deviation ruling (flagged by implementer — not a finding)
The STAGED kind-chip's `bg-transparent` fill vs the genesis-preview mockup's `background:var(--accent-soft)` (`04-staged-rest.html` `.k-staged`): **accepted**. The plan's "Web rendering seams" section and the task scope both say "transparent fill" verbatim; ADR-7 binds the candidate's mockups only where the plan is silent, and here it is not. AC6.2's distinctness is carried by form (outline pill, hollow marker, own label) and holds without the tint. Same ruling covers the pill using the kchip base metrics (font-weight 700, 11px/4px padding) instead of `.k-staged`'s overrides (600, 9px/3px). If the G2 human prefers the mockup's literal swatch, `bg-accent-soft` is an existing token and a one-class polish change, not a defect.

## Coverage

Checked clean: **R5/AC5.1** — the Arm control submits `{ action: 'arm' }` through the existing `api.decide` mutation (`POST /api/decisions`); no new endpoint, no new mutation path; the commit-message shape is core `planDecision`'s existing behavior. **R5/AC5.2** — arm errors ride the pre-existing onError: 409 → conflict flash with re-present posture plus cache invalidation, other `ApiError`s → error flash showing the server message verbatim; no silent no-op path. **R6/AC6.1** — the staged idle branch in decide.tsx offers exactly one affordance (`data-decide="arm"` → confirm → `arm-confirm`); `submitResume` is reachable only from the `kind === 'paused'` branch, and the kinds are mutually exclusive union members (ADR-4), so no code path can issue `resume` for a staged item; keyboard handlers (`a`/`x`) do nothing for staged. **R6/AC6.2** — PhaseChip's staged treatment (hollow no-glow ring, `staged` label) differs in form from the filled glowing dot; every other phase and paused reason falls through the unchanged original body; both PhaseChip call sites (portfolio.tsx:113, run.tsx:71) already pass `pausedReason`, so portfolio row and run-detail header inherit it; KindChip's outline STAGED pill is form-distinct from the solid PAUSE pill, whose lookup/tone code is untouched. **R7/AC7.2** — pages acquire the staged treatment only through the shared chips/DecidePanel; the genesis line is the ADR-7-sanctioned genesis-preview delta, rendered from data already in the payload (`readIntake` on `detail.state`, oldest history entry — `stateHistory` is uncapped and newest-first, so the last entry is the staging commit on a run branch); order and content match mockups 04/05, including rendering for already-armed runs. Candidate selection honored: gates.G1.notes names genesis-preview; two-voices' run.tsx-untouched variant correctly not taken. Confirm-step copy paraphrases the mockup and keeps its load-bearing sentences; the mockup's commit-message preview (`armrec`) is omitted, which the task's narrower confirm-step cut permits (DecidePanel has no identity data) — noted for the G2 human, not a defect. Wording guards: both spec greps (AC2.3, AC3.2) run over the full diff return zero matches. Verified in a detached worktree at 66b2fae: `npm run typecheck` clean, `npm run build` succeeds. Full `npm test`: one loaded run showed 3 failures in orchestrator/CLI timing-sensitive tests; a clean re-run passed 366/366 with the identical tree — load flakiness, not this diff (which touches only unit-test-less web source). Not assessed: live e2e of stage→arm (task 06's surface); readiness-item emission (task 02's surface, inspected only for interface conformance).

## Boundary check

Clean. The diff touches exactly the four declared files (chips.tsx, decide.tsx, inbox.tsx, run.tsx) plus the task yaml, whose change is an append to `notes:` only (`status: pending` untouched). No changes outside `file_contact_surface`. The one boundary-adjacent effect is F1: the diff makes an out-of-surface file's comment stale without touching it.
