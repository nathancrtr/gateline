// Decision actions: each produces (a) a comment-preserving mutation of the
// state.yaml document and (b) the structured commit message the audit trail
// and metrics reader depend on. Legality is checked against the current state
// before any write is attempted.
import type { Document } from 'yaml'
import {
  BURDENS,
  deriveResumePhase,
  gateUndecided,
  PHASE_AFTER_GATE,
  PHASES,
  type Burden,
  type GateId,
  type Phase,
  type RunState,
} from './schema.ts'
import type { Identity, StateDocMutation } from './source.ts'

export type DecisionAction = 'approve' | 'decline' | 'resolve-escalation' | 'pause' | 'resume'

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
      const gate = requireGate(input)
      const entry = state.gates[gate]
      if (!gateUndecided(entry))
        throw new DecisionError(
          entry.approved ? `${gate} is already approved (by ${entry.by})` : `${gate} was declined by ${entry.by}; resume the run to re-open it`,
        )
      if (!input.burden || !BURDENS.includes(input.burden))
        throw new DecisionError(`approve requires a burden category (${BURDENS.join(' | ')}) — it is the pilot's headline metric`)
      const advance = input.advancePhase !== false
      const nextPhase = PHASE_AFTER_GATE[gate]
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
          }
        },
        message: `state(${slug}): ${gate} approved by ${who.name} [burden: ${input.burden}]`,
        summary: `Approve ${gate}${advance ? ` and move ${slug} to phase "${nextPhase}"` : ''}`,
      }
    }
    case 'decline': {
      const gate = requireGate(input)
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
      const target = input.resumePhase ?? deriveResumePhase(state)
      if (!PHASES.includes(target) || target === 'paused') throw new DecisionError(`invalid resume phase: ${target}`)
      return {
        mutate: (doc: Document) => {
          doc.setIn(['phase'], target)
          doc.setIn(['paused_reason'], null)
        },
        message: `state(${slug}): resumed to ${target} by ${who.name}`,
        summary: `Resume ${slug} at phase "${target}"`,
      }
    }
  }
}

function requireGate(input: DecisionInput): GateId {
  if (!input.gate) throw new DecisionError(`${input.action} requires a gate (G0–G3)`)
  return input.gate
}
