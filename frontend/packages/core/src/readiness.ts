// Readiness: "needs a human" is a derived fact about files, never stored
// (rule R1). One rule per row of the plan's §2.3 table:
//
//   G0 ready     phase=spec       ∧ spec.md present ∧ well-formed ∧ ¬G0
//   G1 ready     phase=plan       ∧ plan.md + tasks/* present ∧ well-formed ∧ ¬G1
//   G2 ready     phase=implement∨integrate ∧ all tasks complete ∧ reviews +
//                verification-report.md present ∧ ¬G2
//   G3 ready     phase=release    ∧ release-plan.md present ∧ ¬G3
//   Escalation   any escalations[] entry with resolved: false
//   Round-cap    any task review_rounds ≥ 3 ∧ status not complete
//   Paused       phase=paused
//
// A gate whose packet is present but malformed yields a NON-reviewable item —
// the bounce view (rule R3) — never a reviewable card.
import { G2_COMPLETE_STATUSES, gateUndecided, GATE_PHASES, type GateId, type RunState } from './schema.ts'
import { validateArtifact, type Validation } from './validate.ts'
import type { RunRef, RunSource } from './source.ts'

export const GATE_QUESTIONS: Record<GateId, string> = {
  G0: 'Is this what we actually want built?',
  G1: 'Is this how we’d want it built, cut into safe parallel pieces?',
  G2: 'Does the evidence support merging?',
  G3: 'Ship it?',
}

export type InboxKind = 'gate' | 'escalation' | 'round-cap' | 'paused' | 'malformed'

export interface InboxItem {
  kind: InboxKind
  gate: GateId | null
  source: string
  slug: string
  title: string
  detail: string
  /** Epoch seconds when this began waiting (commit time of the trigger), or null. */
  since: number | null
  /** False → bounce view: packet exists but fails its contract (R3). */
  reviewable: boolean
  problems: string[]
  /** Run-relative artifact paths that make up the card's packet. */
  packet: string[]
  /** Escalation index into state.escalations, when kind=escalation. */
  escalationIndex: number | null
}

export interface RunReadiness {
  items: InboxItem[]
  /** Validation results per artifact examined (path → validation). */
  validations: Record<string, Validation>
}

const isReviewFile = (p: string) => /^review-\d+.*\.md$/.test(p)
const isTaskFile = (p: string) => p.startsWith('tasks/') && p.endsWith('.yaml')

function taskComplete(status: string): boolean {
  return G2_COMPLETE_STATUSES.has(status)
}

/** Which gate, if any, is on the table for the run's current phase. */
export function pendingGate(state: RunState): GateId | null {
  for (const gate of ['G0', 'G1', 'G2', 'G3'] as GateId[]) {
    if (GATE_PHASES[gate].includes(state.phase) && gateUndecided(state.gates[gate])) return gate
  }
  return null
}

export async function deriveReadiness(source: RunSource, ref: RunRef): Promise<RunReadiness> {
  const items: InboxItem[] = []
  const validations: Record<string, Validation> = {}
  const { state, error } = await source.readState(ref)

  if (!state) {
    const touched = await source.lastTouched(ref, ['state.yaml'])
    return {
      items: [
        {
          kind: 'malformed',
          gate: null,
          source: ref.source,
          slug: ref.slug,
          title: 'Malformed run state',
          detail: error ?? 'state.yaml unreadable',
          since: touched?.time ?? null,
          reviewable: false,
          problems: [error ?? 'state.yaml unreadable'],
          packet: ['state.yaml'],
          escalationIndex: null,
        },
      ],
      validations,
    }
  }

  const artifacts = await source.listArtifacts(ref)
  const has = (p: string) => artifacts.includes(p)
  const validate = async (path: string): Promise<Validation> => {
    const content = (await source.readArtifact(ref, path)) ?? ''
    const v = await validateArtifact(path, content, source.templates)
    validations[path] = v
    return v
  }

  // --- Escalations (surface regardless of phase; a stalled run burns calendar).
  state.escalations.forEach((esc, i) => {
    if (esc.resolved) return
    const since = esc.at ? Math.floor(Date.parse(esc.at) / 1000) || null : null
    items.push({
      kind: 'escalation',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: `Escalation from ${esc.from_role ?? 'unknown role'}`,
      detail: esc.reason,
      since,
      reviewable: true,
      problems: [],
      packet: ['state.yaml'],
      escalationIndex: i,
    })
  })

  // --- Round-cap breaches.
  for (const task of state.tasks) {
    if (task.review_rounds >= 3 && !taskComplete(task.status)) {
      const reviewFiles = artifacts.filter(isReviewFile)
      const touched = await source.lastTouched(ref, reviewFiles.length ? reviewFiles : ['state.yaml'])
      items.push({
        kind: 'round-cap',
        gate: null,
        source: ref.source,
        slug: ref.slug,
        title: `Round cap reached: ${task.id}`,
        detail: `${task.review_rounds} review rounds without convergence — usually a spec ambiguity, not an implementation defect`,
        since: touched?.time ?? null,
        reviewable: true,
        problems: [],
        packet: [...reviewFiles, ...(has('spec.md') ? ['spec.md'] : []), ...(has('plan.md') ? ['plan.md'] : [])],
        escalationIndex: null,
      })
    }
  }

  // --- Paused runs need a resume/kill decision.
  if (state.phase === 'paused') {
    const touched = await source.lastTouched(ref, ['state.yaml'])
    items.push({
      kind: 'paused',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: `Run paused: ${state.paused_reason ?? 'no reason recorded'}`,
      detail: 'Resume, or decline the pending gate to end the run',
      since: touched?.time ?? null,
      reviewable: true,
      problems: [],
      packet: ['state.yaml'],
      escalationIndex: null,
    })
    return { items, validations }
  }

  // --- The gate on the table for this phase, if its packet has landed.
  const gate = pendingGate(state)
  if (!gate) return { items, validations }

  const problems: string[] = []
  let packet: string[] = []
  let trigger: string[] = []
  let ready = false

  if (gate === 'G0') {
    packet = ['intent-brief.md', 'spec.md']
    trigger = ['spec.md']
    ready = has('spec.md')
    if (ready && !has('intent-brief.md')) problems.push('intent-brief.md missing from run directory')
  } else if (gate === 'G1') {
    const tasks = artifacts.filter(isTaskFile)
    packet = ['plan.md', ...tasks]
    trigger = ['plan.md', 'tasks']
    ready = has('plan.md') && tasks.length > 0
  } else if (gate === 'G2') {
    const reviews = artifacts.filter(isReviewFile)
    packet = [...reviews, 'verification-report.md']
    trigger = [...reviews, 'verification-report.md']
    const tasksComplete = state.tasks.length > 0 && state.tasks.every((t) => taskComplete(t.status))
    ready = tasksComplete && reviews.length > 0 && has('verification-report.md')
  } else {
    packet = ['release-plan.md']
    trigger = ['release-plan.md']
    ready = has('release-plan.md')
  }

  if (!ready) return { items, validations } // agents still working; nothing to review

  for (const path of packet) {
    if (!has(path)) continue
    const v = await validate(path)
    if (!v.ok) problems.push(`${path}: missing required ${v.contract === 'work-item.yaml' ? 'keys' : 'sections'} — ${v.missing.join(', ')}`)
  }

  const touched = await source.lastTouched(ref, trigger)
  items.push({
    kind: 'gate',
    gate,
    source: ref.source,
    slug: ref.slug,
    title: `${gate} — ${GATE_QUESTIONS[gate]}`,
    detail: problems.length ? 'Packet malformed — bounced, not reviewable' : `${ref.slug} is waiting on ${gate}`,
    since: touched?.time ?? null,
    reviewable: problems.length === 0,
    problems,
    packet,
    escalationIndex: null,
  })
  return { items, validations }
}
