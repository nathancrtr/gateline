// Decision actions: each produces (a) a comment-preserving mutation of the
// state.yaml document and (b) the structured commit message the audit trail
// and metrics reader depend on. Legality is checked against the current state
// before any write is attempted.
import type { Document } from 'yaml'
import {
  BURDENS,
  deriveResumePhase,
  gateUndecided,
  phaseAfterGate,
  PHASES,
  PROFILE_GATES,
  PROFILE_PHASES,
  STAGED_REASON,
  type Burden,
  type GateId,
  type Phase,
  type RunState,
  type Identity,
  type StateDocMutation,
} from './schema.ts'

export type DecisionAction = 'approve' | 'decline' | 'resolve-escalation' | 'pause' | 'resume' | 'arm'

export interface DecisionInput {
  action: DecisionAction
  gate?: GateId
  /** Free-text notes; required (as the reason) for decline and resolve-escalation. */
  notes?: string
  /** Required for approve — captured in the act of deciding (principle 3). */
  burden?: Burden
  escalationIndex?: number
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
      const at = nowIso()
      return {
        mutate: (doc: Document) => {
          doc.setIn(['escalations', i, 'resolved'], true)
          doc.setIn(['escalations', i, 'resolved_by'], who.name)
          doc.setIn(['escalations', i, 'resolved_at'], at)
          doc.setIn(['escalations', i, 'resolution'], resolution)
        },
        message: `state(${slug}): escalation #${i} resolved by ${who.name}`,
        summary: `Resolve escalation #${i}`,
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
        throw new DecisionError(`run is staged, not paused mid-flight — use \`agentic arm ${slug}\``)
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
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], target)
          doc.setIn(['paused_reason'], null)
          for (const g of reopen) {
            doc.setIn(['gates', g, 'approved'], false)
            doc.setIn(['gates', g, 'by'], null)
            doc.setIn(['gates', g, 'at'], null)
            doc.setIn(['gates', g, 'notes'], null)
          }
        },
        message: `state(${slug}): resumed to ${target} by ${who.name}${reopen.length ? ` (${reopen.join(', ')} re-opened)` : ''}`,
        summary: `Resume ${slug} at phase "${target}"${reopen.length ? `, re-opening ${reopen.join(', ')}` : ''}`,
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
  }
}

function requireGate(state: RunState, input: DecisionInput): GateId {
  if (!input.gate) throw new DecisionError(`${input.action} requires a gate (G0–G3)`)
  if (!PROFILE_GATES[state.profile].includes(input.gate))
    throw new DecisionError(`gate ${input.gate} does not exist in profile ${state.profile} (gates: ${PROFILE_GATES[state.profile].join(', ')})`)
  return input.gate
}
