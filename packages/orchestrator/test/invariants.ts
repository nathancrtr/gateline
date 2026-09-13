// Invariants of the reconcile loop, checked against a run's committed state.
//
// These are the properties the audit (docs/ORCHESTRATOR.md §4.7) says must
// hold after every engine tick and every human decision, whatever order they
// interleave in. Each is a pure function of the record — the same discipline
// as derivation itself — so a test can assert them after any step, and a
// random walk can assert them after every step.

import type { RunState } from '@gateline/core/record'
import { PROFILE_GATES, PROFILE_PHASES, TERMINAL_PHASES } from '@gateline/core/record'
import { expect } from 'vitest'
import { parseLedger } from '../src/observe.ts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** I1 — at most one open ledger entry per (role, task, round): commit-then-launch's duplicate guard. */
export function assertNoDuplicateOpenDispatch(state: RunState): void {
  const open = parseLedger(state).filter((e) => e.cost_usd === null && !e.failed)
  const keys = open.map((e) => `${e.role}|${e.task ?? ''}|${e.round ?? ''}`)
  expect(new Set(keys).size, `duplicate open dispatch: ${keys.join(', ')}`).toBe(keys.length)
}

/** I2 — the phase is one the profile has, and only the profile's gates are ever decided (D21's promise). */
export function assertProfileInvariants(state: RunState): void {
  expect(PROFILE_PHASES[state.profile], `phase ${state.phase} outside profile ${state.profile}`).toContain(state.phase)
  for (const gate of ['G0', 'G1', 'G2', 'G3'] as const) {
    if (!PROFILE_GATES[state.profile].includes(gate)) {
      expect(state.gates[gate].by, `${gate} decided outside profile ${state.profile}`).toBeNull()
    }
  }
}

/** I3 — cost_spent_usd is the derived sum of the ledger (§6: a ledger, not a running total). */
export function assertSpendIsLedgerSum(state: RunState): void {
  const ledger = parseLedger(state)
  if (ledger.length === 0) return
  const sum = round2(ledger.reduce((s, e) => s + (e.cost_usd ?? 0), 0))
  expect(round2(state.budget?.cost_spent_usd ?? 0)).toBe(sum)
}

/** I4 — a paused run always says why; a run that is not paused never carries a stale reason. */
export function assertPauseReasonCoherent(state: RunState): void {
  if (state.phase === 'paused') expect(state.paused_reason, 'paused with no reason').not.toBeNull()
  else expect(state.paused_reason, `phase ${state.phase} with paused_reason ${state.paused_reason}`).toBeNull()
}

/**
 * I5 — an escalation is asked once per occurrence. Two entries with the same
 * reason are legal only when something happened between them: a ledger entry
 * opened, or (for the caller to check) a non-state commit landed. Here the
 * cheap half: no two *unresolved* entries share a reason.
 */
export function assertNoDuplicateOpenEscalation(state: RunState): void {
  const open = state.escalations.filter((e) => !e.resolved).map((e) => e.reason)
  expect(new Set(open).size, `duplicate unresolved escalations: ${open.join(' | ')}`).toBe(open.length)
}

/** I6 — a terminal run keeps its terminal phase: nothing the engine writes moves it. */
export function assertTerminalStays(before: RunState, after: RunState): void {
  if ((TERMINAL_PHASES as readonly string[]).includes(before.phase)) {
    expect(after.phase, `terminal run left ${before.phase} for ${after.phase}`).toBe(before.phase)
  }
}

/** Every per-state invariant at once, for a walk to call after each step. */
export function assertStateInvariants(state: RunState): void {
  assertNoDuplicateOpenDispatch(state)
  assertProfileInvariants(state)
  assertSpendIsLedgerSum(state)
  assertPauseReasonCoherent(state)
  assertNoDuplicateOpenEscalation(state)
}
