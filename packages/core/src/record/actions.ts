// Decision actions: each produces (a) a comment-preserving mutation of the
// state.yaml document and (b) the structured commit message the audit trail
// and metrics reader depend on. Legality is checked against the current state
// before any write is attempted.
import type { Document } from 'yaml'
import {
  BUDGET_REASON,
  BURDENS,
  CLOSED_PHASE,
  CLOSURES,
  deriveResumePhase,
  DISPOSITIONS,
  gateUndecided,
  phaseAfterGate,
  PHASES,
  PROFILE_GATES,
  PROFILE_PHASES,
  STAGED_REASON,
  type Burden,
  type Closure,
  type Disposition,
  type GateId,
  type Phase,
  type RunState,
  type Identity,
  type StateDocMutation,
} from './schema.ts'

export type DecisionAction = 'approve' | 'decline' | 'resolve-escalation' | 'pause' | 'resume' | 'arm' | 'close' | 'reopen'

export interface DecisionInput {
  action: DecisionAction
  gate?: GateId
  /** Free-text notes; required (as the reason) for decline and resolve-escalation. */
  notes?: string
  /** Required for approve — captured in the act of deciding (principle 3). */
  burden?: Burden
  escalationIndex?: number
  /**
   * resolve-escalation: an optional machine-actionable route for the engine's
   * D17 rule (ORCHESTRATOR.md §4.2) — absent leaves today's guarded-re-review
   * default unchanged.
   */
  disposition?: Disposition
  /** approve: also move phase forward (the v0 human is the orchestrator). Default true. */
  advancePhase?: boolean
  /**
   * approve: sign the gate but pause the run in the same commit, instead of
   * advancing. This is the dispatch-safe way to approve when a human decision
   * still stands between this gate and the next phase's producer: a bare
   * `advancePhase: false` leaves the approved gate visible to the engine,
   * whose convergence rule advances the phase and dispatches anyway.
   */
  hold?: boolean
  /** hold: what the run is waiting on; recorded in paused_reason. Required with hold. */
  holdReason?: string
  /** pause: reason recorded in paused_reason. */
  pauseReason?: string
  /** resume: target phase; derived from the gate ledger when omitted. */
  resumePhase?: Phase
  /**
   * resume: a new `budget.cost_limit_usd`, written in the same commit as the
   * phase restore. Required when the run is paused `budget-exhausted` (#96):
   * the pause is a condition the engine recomputes from the ledger and the
   * limit, so a resume that changes neither re-pauses on the next tick and
   * burns two human decisions for nothing. Optional otherwise; must exceed
   * the current limit whenever given.
   */
  costLimitUsd?: number
  /**
   * close: why the run is ending short of `done` (#200). Required — a closure
   * with no disposition is the untyped terminal state the record can never be
   * re-derived out of.
   */
  closure?: Closure
}

export interface PlannedDecision {
  mutate: StateDocMutation
  message: string
  /** What the decision will do, for confirmation UIs. */
  summary: string
}

export class DecisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecisionError'
  }
}

const nowIso = () => new Date().toISOString()

export function planDecision(state: RunState, input: DecisionInput, who: Identity): PlannedDecision {
  const slug = state.run
  // A closed run is at rest by decision, not by circumstance. Every other verb
  // would edit a record a human declared final, so each is refused once here
  // and pointed at the one action that undoes a closure.
  if (state.phase === CLOSED_PHASE && input.action !== 'close' && input.action !== 'reopen')
    throw new DecisionError(
      `${slug} was closed as "${state.closure?.as ?? 'unknown'}" by ${state.closure?.by ?? 'someone'} — reopen it before deciding anything else`,
    )
  switch (input.action) {
    case 'approve': {
      const gate = requireGate(state, input)
      const entry = state.gates[gate]
      if (!gateUndecided(entry))
        throw new DecisionError(
          entry.approved ? `${gate} is already approved (by ${entry.by})` : `${gate} was declined by ${entry.by}; resume the run to re-open it`,
        )
      if (!input.burden || !BURDENS.includes(input.burden))
        throw new DecisionError(`approve requires a burden category (${BURDENS.join(' | ')}) — it is the pilot's headline metric`)
      const hold = input.hold === true
      const holdReason = input.holdReason?.trim()
      if (hold && !holdReason)
        throw new DecisionError('hold requires a reason — it names the decision the run is waiting on, and the inbox shows it')
      if (hold && input.advancePhase === false)
        throw new DecisionError('hold already implies not advancing — omit advancePhase')
      const advance = !hold && input.advancePhase !== false
      const nextPhase = phaseAfterGate(gate, state.profile)
      const at = nowIso()
      return {
        mutate: (doc: Document) => {
          doc.setIn(['gates', gate, 'approved'], true)
          doc.setIn(['gates', gate, 'by'], who.name)
          doc.setIn(['gates', gate, 'at'], at)
          doc.setIn(['gates', gate, 'notes'], input.notes ?? null)
          doc.setIn(['gates', gate, 'burden'], input.burden)
          if (advance) {
            doc.setIn(['phase'], nextPhase)
            doc.setIn(['paused_reason'], null)
          } else if (hold) {
            doc.setIn(['phase'], 'paused')
            doc.setIn(['paused_reason'], holdReason)
          }
        },
        message: `state(${slug}): ${gate} approved by ${who.name} [burden: ${input.burden}]${hold ? ` and held (${holdReason})` : ''}`,
        summary: `Approve ${gate}${advance ? ` and move ${slug} to phase "${nextPhase}"` : ''}${hold ? ` and hold ${slug} paused (${holdReason})` : ''}`,
      }
    }
    case 'decline': {
      const gate = requireGate(state, input)
      const entry = state.gates[gate]
      if (!gateUndecided(entry)) throw new DecisionError(`${gate} is already decided (by ${entry.by})`)
      const reason = input.notes?.trim()
      if (!reason) throw new DecisionError('decline requires a reason — it is the correction channel back to the producing role')
      const at = nowIso()
      return {
        mutate: (doc: Document) => {
          doc.setIn(['gates', gate, 'approved'], false)
          doc.setIn(['gates', gate, 'by'], who.name)
          doc.setIn(['gates', gate, 'at'], at)
          doc.setIn(['gates', gate, 'notes'], reason)
          doc.setIn(['phase'], 'paused')
          doc.setIn(['paused_reason'], 'gate-declined')
        },
        message: `state(${slug}): ${gate} declined by ${who.name}`,
        summary: `Decline ${gate} and pause ${slug} (gate-declined)`,
      }
    }
    case 'resolve-escalation': {
      const i = input.escalationIndex
      if (i === undefined || i < 0 || i >= state.escalations.length)
        throw new DecisionError(`escalation index ${i} out of range (run has ${state.escalations.length})`)
      if (state.escalations[i]!.resolved) throw new DecisionError(`escalation #${i} is already resolved`)
      const resolution = input.notes?.trim()
      if (!resolution) throw new DecisionError('resolving an escalation requires a disposition note')
      if (input.disposition !== undefined && !DISPOSITIONS.includes(input.disposition))
        throw new DecisionError(`disposition must be one of: ${DISPOSITIONS.join(' | ')}`)
      const at = nowIso()
      return {
        mutate: (doc: Document) => {
          doc.setIn(['escalations', i, 'resolved'], true)
          doc.setIn(['escalations', i, 'resolved_by'], who.name)
          doc.setIn(['escalations', i, 'resolved_at'], at)
          doc.setIn(['escalations', i, 'resolution'], resolution)
          if (input.disposition) doc.setIn(['escalations', i, 'disposition'], input.disposition)
        },
        message: `state(${slug}): escalation #${i} resolved by ${who.name}${input.disposition ? ` [disposition: ${input.disposition}]` : ''}`,
        summary: `Resolve escalation #${i}${input.disposition ? ` (disposition: ${input.disposition})` : ''}`,
      }
    }
    case 'pause': {
      if (state.phase === 'paused') throw new DecisionError('run is already paused')
      if (state.phase === 'done') throw new DecisionError('run is done; nothing to pause')
      const reason = input.pauseReason?.trim() || 'escalation'
      if (reason === STAGED_REASON) throw new DecisionError('staging is a birth state, not a pause reason')
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], 'paused')
          doc.setIn(['paused_reason'], reason)
        },
        message: `state(${slug}): paused by ${who.name} (${reason})`,
        summary: `Pause ${slug} (${reason})`,
      }
    }
    case 'resume': {
      if (state.phase !== 'paused') throw new DecisionError(`run is not paused (phase: ${state.phase})`)
      if (state.paused_reason === STAGED_REASON)
        throw new DecisionError(`run is staged, not paused mid-flight — use \`gateline arm ${slug}\``)
      const target = input.resumePhase ?? deriveResumePhase(state)
      if (!PHASES.includes(target) || target === 'paused') throw new DecisionError(`invalid resume phase: ${target}`)
      if (!PROFILE_PHASES[state.profile].includes(target))
        throw new DecisionError(`phase "${target}" does not exist in profile ${state.profile}`)
      // Resuming a gate-declined run re-opens the declined gate: the entry
      // resets to undecided so it can be re-decided (the approve path's
      // "resume the run to re-open it" made real). The decline stays in the
      // state file's git history — which is where the v1 orchestrator finds
      // the notes to bounce back to the producing role (resolved question 5).
      const reopen =
        state.paused_reason === 'gate-declined'
          ? PROFILE_GATES[state.profile].filter((g) => !state.gates[g].approved && state.gates[g].by !== null)
          : []
      // A budget pause is a condition, not an event (#96): the engine reads
      // {ledger, estimates, limit} and nothing a human says on the way back
      // changes any of them. The one resume that sticks raises the limit in
      // the same commit — so that is the only resume this path allows from
      // budget-exhausted, and the error names the alternative (close).
      const currentLimit = state.budget?.cost_limit_usd ?? null
      const raise = input.costLimitUsd
      if (raise !== undefined) {
        if (typeof raise !== 'number' || !Number.isFinite(raise) || raise <= 0)
          throw new DecisionError('cost_limit_usd must be a positive number of dollars')
        if (currentLimit !== null && raise <= currentLimit)
          throw new DecisionError(`cost_limit_usd is already $${currentLimit} — a new limit has to be higher, or the next tick re-pauses the run`)
      }
      if (state.paused_reason === BUDGET_REASON && raise === undefined)
        throw new DecisionError(
          `${slug} is paused budget-exhausted${currentLimit !== null ? ` at cost_limit_usd $${currentLimit}` : ' with no cost_limit_usd set'} — ` +
            'resuming without a higher limit re-pauses on the next tick. Pass a new cost_limit_usd, or close the run with a disposition',
        )
      const limitNote = raise !== undefined ? `cost_limit_usd ${currentLimit !== null ? `$${currentLimit}` : 'unset'} → $${raise}` : null
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], target)
          doc.setIn(['paused_reason'], null)
          if (raise !== undefined) doc.setIn(['budget', 'cost_limit_usd'], raise)
          for (const g of reopen) {
            doc.setIn(['gates', g, 'approved'], false)
            doc.setIn(['gates', g, 'by'], null)
            doc.setIn(['gates', g, 'at'], null)
            doc.setIn(['gates', g, 'notes'], null)
          }
        },
        message: `state(${slug}): resumed to ${target} by ${who.name}${reopen.length ? ` (${reopen.join(', ')} re-opened)` : ''}${limitNote ? ` (${limitNote})` : ''}`,
        summary: `Resume ${slug} at phase "${target}"${reopen.length ? `, re-opening ${reopen.join(', ')}` : ''}${limitNote ? `, ${limitNote}` : ''}`,
      }
    }
    case 'arm': {
      if (state.phase !== 'paused' || state.paused_reason !== STAGED_REASON)
        throw new DecisionError(
          state.phase !== 'paused' ? `run is not staged (phase: ${state.phase})` : `run is not staged (paused_reason: ${state.paused_reason ?? 'none'})`,
        )
      const target = deriveResumePhase(state)
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], target)
          doc.setIn(['paused_reason'], null)
        },
        message: `state(${slug}): armed by ${who.name}`,
        summary: `Arm ${slug} into phase "${target}"`,
      }
    }
    case 'close': {
      // `done` is not closable: a run that finished its pipeline already has
      // the record it earned, and overwriting the phase would trade "this
      // completed" for "someone stopped it" — the exact flattening the typed
      // disposition exists to prevent.
      if (state.phase === 'done')
        throw new DecisionError(`${slug} reached done — a completed run is already its own record; closing is for runs that stop short`)
      if (state.phase === CLOSED_PHASE)
        throw new DecisionError(`${slug} is already closed as "${state.closure?.as}" by ${state.closure?.by ?? 'someone'}`)
      const closure = input.closure
      if (!closure || !CLOSURES.includes(closure))
        throw new DecisionError(`close requires a disposition (${CLOSURES.join(' | ')}) — an untyped closure can never be re-derived into one`)
      const reason = input.notes?.trim()
      if (!reason) throw new DecisionError('close requires a reason — it is the comment on the disposition, and the only account of why the run ends here')
      const at = nowIso()
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], CLOSED_PHASE)
          doc.setIn(['paused_reason'], null)
          doc.setIn(['closure'], { as: closure, by: who.name, at, reason })
        },
        message: `state(${slug}): closed by ${who.name} [disposition: ${closure}]`,
        summary: `Close ${slug} as "${closure}"`,
      }
    }
    case 'reopen': {
      // Closing is a decision, not a deletion, so it is reversible — and the
      // reversal is a commit of its own, which is what keeps the audit trail
      // honest about a closure someone changed their mind about.
      if (state.phase !== CLOSED_PHASE) throw new DecisionError(`${slug} is not closed (phase: ${state.phase})`)
      const target = deriveResumePhase(state)
      const was = state.closure?.as ?? 'unknown'
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], target)
          doc.setIn(['paused_reason'], null)
          doc.setIn(['closure'], null)
        },
        message: `state(${slug}): reopened to ${target} by ${who.name} (was closed as ${was})`,
        summary: `Reopen ${slug} at phase "${target}"`,
      }
    }
  }
}

function requireGate(state: RunState, input: DecisionInput): GateId {
  if (!input.gate) throw new DecisionError(`${input.action} requires a gate (G0–G3)`)
  if (!PROFILE_GATES[state.profile].includes(input.gate))
    throw new DecisionError(`gate ${input.gate} does not exist in profile ${state.profile} (gates: ${PROFILE_GATES[state.profile].join(', ')})`)
  return input.gate
}
