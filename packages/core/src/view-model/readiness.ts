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
//   Paused       phase=paused ∧ paused_reason ∉ {staged, gate-declined}
//                ∧ nothing else already speaks for the run; the card's
//                instruction is the reason's (#96): budget-exhausted says
//                raise the limit, slug-landed says close — a bare "resume"
//                on either re-pauses on the next tick
//   Staged       phase=paused ∧ paused_reason = staged — awaiting arm, not resume/kill
//   Declined     phase=paused ∧ paused_reason = gate-declined — no item at all
//   Closed       phase=closed — no item at all, whatever else the record holds
//   In flight    a gate row, but its producing role holds an OPEN ledger entry
//                opened after the packet landed — non-reviewable, no problems
//
// The last three rows are #200. A `gate-declined` run is a DECIDED run: the
// human already answered the gate, and the card it used to show told them to
// "decline the pending gate to end the run" — the very thing they had just
// done. It stays visible in the portfolio; it stops claiming to need a
// decision.
//
// `closed` is the other half, and it answers what a decline could not say: the
// record now distinguishes a pause that awaits revival from a walk-away,
// because a closure carries a typed disposition
// (already-delivered | superseded | obsolete | abandoned). It short-circuits
// before every other rule, including escalations — a human who closed a run
// has answered everything inside it, and asking them to resolve an escalation
// on a run they ended would be asking them to repeat themselves in the same
// way the declined card once did.
//
// A gate whose packet is present but malformed yields a NON-reviewable item —
// the bounce view (rule R3) — never a reviewable card.
//
// The in-flight row is #159, and it is the same refusal for a different cause.
// Decline G0 with notes and resume: the gate re-opens, the engine re-dispatches
// the analyst with those notes (ORCHESTRATOR.md §4.2, rule D9), and until the
// new spec lands every clause of "G0 ready" is still true of the old one. The
// human who had just declined was shown their own superseded artifact with an
// Approve button on it, and reasonably read that as the correction channel
// having failed. The engine's knowledge is already committed — the dispatch
// opens a ledger entry under `budget.ledger` before the agent launches, which
// is what rule D12 rests on — so reading it here costs no new state and keeps
// R1 intact: files, plus the clock, and nothing else.
//
// It is aged rather than trusted forever. An open entry older than
// `ROLE_TIMEOUT_MS` is one the engine would already have killed and swept, so
// it means the engine is gone, not that an agent is working; the gate goes back
// to reviewable with the wait said out loud, because suppressing a gate on the
// word of a dead process is the worse failure.
//
// Three of the facts these rules read now live in `record/schema.ts` — which
// gate is pending (`pendingGateAt`), which role produces a gate's packet
// (`gateProducer`), and whether G2's evidence has landed (`g2PacketReady`).
// The write path reads the same three for a different purpose: it refuses a
// decision about any gate but the pending one (#344), refuses an approval
// while the producer is out (#351), and lets the PR-approval sync copy an
// Approve into G2 only once G2 is genuinely on the table. One definition each
// is what stops the card a human is shown and the write the API accepts from
// disagreeing.
import {
  BUDGET_REASON,
  CLOSED_PHASE,
  DECLINED_REASON,
  LANDED_REASON,
  G2_COMPLETE_STATUSES,
  g2PacketReady,
  gateProducer,
  isReviewFile,
  pendingGate,
  ROUND_CAP,
  STAGED_REASON,
  type GateId,
  type RunState,
} from '../record/schema.ts'
import { isOpenDispatch, parseLedger, ROLE_TIMEOUT_MS } from '../record/ledger.ts'
import { validateArtifact, type Validation } from '../record/validate.ts'
import type { RunRef, RunSource } from '../sources/source.ts'
import { formatDuration } from './time.ts'

export const GATE_QUESTIONS: Record<GateId, string> = {
  G0: 'Is this what we actually want built?',
  G1: 'Is this how we’d want it built, cut into safe parallel pieces?',
  G2: 'Does the evidence support merging?',
  G3: 'Ship it?',
}

/** In a patch run G1 absorbs the G0 question — brief and work item are approved together. */
export const PATCH_G1_QUESTION = 'Is this the change we want, scoped this way?'

export type InboxKind = 'gate' | 'escalation' | 'round-cap' | 'paused' | 'staged' | 'malformed'

export interface InboxItem {
  kind: InboxKind
  gate: GateId | null
  source: string
  slug: string
  title: string
  detail: string
  /** Epoch seconds when this began waiting (commit time of the trigger), or null. */
  since: number | null
  /**
   * False → the card offers no decision. Two causes, told apart by `problems`:
   * a non-empty `problems` is the bounce view (R3, the packet fails its
   * contract); an empty one alongside `inflight` is the producer being out
   * (#159).
   */
  reviewable: boolean
  problems: string[]
  /**
   * The gate's producing role holds an open ledger entry opened after the
   * packet landed: a new artifact is coming and this one is superseded (#159).
   * `since` is epoch seconds, the dispatch's own `at`. Null on every other
   * item, and on a gate whose producer is at rest.
   */
  inflight: { role: string; since: number } | null
  /** Run-relative artifact paths that make up the card's packet. */
  packet: string[]
  /** Escalation index into state.escalations, when kind=escalation. */
  escalationIndex: number | null
  /** kind=paused: the recorded reason, so the resume affordance can ask for what the reason needs (#96). */
  pausedReason?: string | null
  /** kind=paused: the run's current `budget.cost_limit_usd`, for a resume that must raise it (#96). */
  costLimitUsd?: number | null
}

export interface RunReadiness {
  items: InboxItem[]
  /** Validation results per artifact examined (path → validation). */
  validations: Record<string, Validation>
}

const isTaskFile = (p: string) => p.startsWith('tasks/') && p.endsWith('.yaml')

function taskComplete(status: string): boolean {
  return G2_COMPLETE_STATUSES.has(status)
}

/**
 * When `role` was last dispatched and not yet closed, in epoch milliseconds, or
 * null if it is at rest. Only entries opened *after* the packet landed count: an
 * older open entry is the dispatch that produced the packet, left unclosed, and
 * reading it as a re-dispatch would suppress every gate the engine ever missed
 * closing. `packetAt` is epoch seconds, or null when no commit could be found
 * for the trigger — an unknown packet time is not evidence either way, so every
 * open entry counts there.
 */
function openDispatchAt(state: RunState, role: string, packetAt: number | null): number | null {
  const after = (packetAt ?? -Infinity) * 1000
  let newest: number | null = null
  for (const entry of parseLedger(state)) {
    if (entry.role !== role || !isOpenDispatch(entry) || entry.at === null) continue
    const at = Date.parse(entry.at)
    if (!Number.isFinite(at) || at <= after) continue
    if (newest === null || at > newest) newest = at
  }
  return newest
}

/**
 * What actually clears the pause (#96). The old card said "resume or decline"
 * for every reason, and for the two reasons the orchestrator itself writes
 * that advice was a closed loop: a budget pause is recomputed from the
 * ledger and the limit, a landed-slug pause from the default branch, and a
 * resume that changes neither re-pauses seconds later — each cycle costing
 * two decisions and one more escalation entry.
 */
export function pausedInstruction(state: RunState): string {
  const limit = state.budget?.cost_limit_usd ?? null
  switch (state.paused_reason) {
    case BUDGET_REASON:
      return limit !== null
        ? `Spend reached cost_limit_usd $${limit}. Resume with a higher limit, or close the run with a disposition — resuming without raising the limit re-pauses on the next tick`
        : 'This orchestrator requires a per-run cost_limit_usd and the run has none. Resume with a limit, or close the run with a disposition'
    case LANDED_REASON:
      return `runs/${state.run}/ already shipped on the default branch and this branch moved on after the merge. Close the run with a disposition (already-delivered) and carry any remaining work on a fresh slug — resuming re-pauses on the next tick`
    default:
      return 'Resume the run, or close it with a disposition saying why it ends here'
  }
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
          inflight: null,
          escalationIndex: null,
        },
      ],
      validations,
    }
  }

  // A closed run needs nothing from anyone — including the escalations and
  // round caps below, which a closure answers wholesale rather than one by one.
  if (state.phase === CLOSED_PHASE) return { items, validations }

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
      inflight: null,
      escalationIndex: i,
    })
  })

  // --- Round-cap breaches.
  for (const task of state.tasks) {
    if (task.review_rounds >= ROUND_CAP && !taskComplete(task.status)) {
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
        inflight: null,
        escalationIndex: null,
      })
    }
  }

  // --- Paused runs need a resume/kill decision — unless the rest state is
  // "staged" (ADR-4): a staged-but-unarmed run never had a resume/kill
  // choice to begin with, so it gets its own kind rather than a 'paused'
  // item whose only affordance (Resume) is a guaranteed DecisionError.
  if (state.phase === 'paused') {
    const touched = await source.lastTouched(ref, ['state.yaml'])
    if (state.paused_reason === STAGED_REASON) {
      items.push({
        kind: 'staged',
        gate: null,
        source: ref.source,
        slug: ref.slug,
        title: 'Run staged: awaiting arm',
        detail: 'Arm to start the run — dispatch begins and the budget starts metering',
        since: touched?.time ?? null,
        reviewable: true,
        problems: [],
        packet: ['state.yaml', 'intent-brief.md'],
        inflight: null,
        escalationIndex: null,
      })
      return { items, validations }
    }
    // A declined gate is an answered gate (#200). Offering "resume or decline"
    // to a human who already declined is asking them to repeat themselves.
    if (state.paused_reason === DECLINED_REASON) return { items, validations }
    // Nor does the run need a second card restating a need another item
    // already carries: a run paused *for* an escalation or a round cap is
    // unblocked by resolving that, which is the item already above.
    if (items.length > 0) return { items, validations }
    items.push({
      kind: 'paused',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: `Run paused: ${state.paused_reason ?? 'no reason recorded'}`,
      detail: pausedInstruction(state),
      since: touched?.time ?? null,
      reviewable: true,
      problems: [],
      packet: ['state.yaml'],
      inflight: null,
      escalationIndex: null,
      pausedReason: state.paused_reason,
      costLimitUsd: state.budget?.cost_limit_usd ?? null,
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
  } else if (gate === 'G1' && state.profile === 'patch') {
    // Patch: no plan.md — G1 approves the human-authored brief + work item together.
    const tasks = artifacts.filter(isTaskFile)
    packet = ['intent-brief.md', ...tasks]
    trigger = ['intent-brief.md', 'tasks']
    ready = tasks.length > 0
    if (ready && !has('intent-brief.md')) problems.push('intent-brief.md missing from run directory')
  } else if (gate === 'G1') {
    const tasks = artifacts.filter(isTaskFile)
    packet = ['plan.md', ...tasks]
    trigger = ['plan.md', 'tasks']
    ready = has('plan.md') && tasks.length > 0
  } else if (gate === 'G2') {
    // Patch: no verifier — the reviews are the whole G2 packet.
    const reviews = artifacts.filter(isReviewFile)
    const verification = state.profile === 'patch' ? [] : ['verification-report.md']
    packet = [...reviews, ...verification]
    trigger = [...reviews, ...verification]
    ready = g2PacketReady(state, artifacts)
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

  // The producing role, if it is out (#159). Consulted only for a well-formed
  // packet: a bounced one already says the true thing — the artifacts fail
  // their contract — and `problems` is what tells the two refusals apart, so
  // the bounce view keeps the card unchanged.
  const producer = problems.length === 0 ? gateProducer(gate, state.profile) : null
  const openAt = producer ? openDispatchAt(state, producer.role, touched?.time ?? null) : null
  const openAgeMs = openAt === null ? 0 : Date.now() - openAt
  const inflight =
    openAt !== null && openAgeMs < ROLE_TIMEOUT_MS ? { role: producer!.role, since: Math.floor(openAt / 1000) } : null

  let detail: string
  if (problems.length) detail = 'Packet malformed — bounced, not reviewable'
  else if (inflight)
    detail =
      `${producer!.role} was re-dispatched after ${producer!.artifact} landed — a new one is pending, ` +
      `so the ${gate} packet on this card is superseded`
  else if (openAt !== null)
    detail =
      `${producer!.role} was re-dispatched ${formatDuration(openAgeMs / 1000)} ago and has not landed ` +
      `${producer!.artifact} — the engine ages out a lost dispatch; review what is here, or wait`
  else detail = `${ref.slug} is waiting on ${gate}`

  items.push({
    kind: 'gate',
    gate,
    source: ref.source,
    slug: ref.slug,
    title: `${gate} — ${state.profile === 'patch' && gate === 'G1' ? PATCH_G1_QUESTION : GATE_QUESTIONS[gate]}`,
    detail,
    since: touched?.time ?? null,
    reviewable: problems.length === 0 && inflight === null,
    problems,
    packet,
    inflight,
    escalationIndex: null,
  })
  return { items, validations }
}
