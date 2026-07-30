// Metrics (I8): computed from state.yaml git history plus the burden field —
// no scribe, no store (rule R1). Latency is readiness-commit → decision-commit;
// approval rate carries the >90% over-triggering flag from FRONTEND.md §4.4.
import { GATE_IDS, gateUndecided, type Burden, type GateId } from '../record/schema.ts'
import type { RunRef, RunSource, StateCommit } from '../sources/source.ts'

export interface GateDecisionRecord {
  source: string
  slug: string
  gate: GateId
  approved: boolean
  by: string | null
  /** Epoch seconds of the commit that recorded the decision. */
  decidedAt: number
  /** Epoch seconds when the gate became ready (packet trigger commit), when known. */
  readyAt: number | null
  latencySeconds: number | null
  burden: Burden | null
  notes: string | null
}

export interface GateMetrics {
  gate: GateId
  decisions: number
  approvals: number
  approvalRate: number | null
  overTriggering: boolean
  burdenMix: Record<Burden, number>
  burdenUnrecorded: number
  medianLatencySeconds: number | null
}

export interface RunMetricsSummary {
  source: string
  slug: string
  rounds: { taskId: string; rounds: number }[]
  budget: { limit: number | null; spent: number | null; everUpdated: boolean }
}

export interface Metrics {
  decisions: GateDecisionRecord[]
  perGate: GateMetrics[]
  runs: RunMetricsSummary[]
}

const GATE_TRIGGERS: Record<GateId, (artifacts: string[]) => string[]> = {
  G0: () => ['spec.md'],
  G1: () => ['plan.md', 'tasks'],
  G2: (a) => [...a.filter((p) => /^review-\d+.*\.md$/.test(p)), 'verification-report.md'],
  G3: () => ['release-plan.md'],
}

/**
 * Walk a run's state.yaml history (newest→oldest) and emit one record per
 * gate decision: the first commit at which the gate stops being undecided.
 */
export async function collectRunDecisions(source: RunSource, ref: RunRef): Promise<GateDecisionRecord[]> {
  const history = await source.stateHistory(ref)
  if (history.length === 0) return []
  const artifacts = await source.listArtifacts(ref)
  const records: GateDecisionRecord[] = []

  for (const gate of GATE_IDS) {
    const decision = findDecision(history, gate)
    if (!decision) continue
    const entry = decision.state!.gates[gate]
    const trigger = GATE_TRIGGERS[gate](artifacts)
    const touched = await source.lastTouched(ref, trigger)
    // Readiness must precede the decision; a trigger commit after it means
    // the artifacts moved post-decision and the age would be negative noise.
    const readyAt = touched && touched.time <= decision.time ? touched.time : null
    records.push({
      source: ref.source,
      slug: ref.slug,
      gate,
      approved: entry.approved,
      by: entry.by,
      decidedAt: decision.time,
      readyAt,
      latencySeconds: readyAt === null ? null : decision.time - readyAt,
      burden: entry.burden,
      notes: entry.notes,
    })
  }
  return records
}

function findDecision(newestFirst: StateCommit[], gate: GateId): StateCommit | null {
  // Oldest commit where the gate is decided, provided it stays decided at tip.
  const tip = newestFirst[0]
  if (!tip?.state || gateUndecided(tip.state.gates[gate])) return null
  let decision: StateCommit | null = null
  for (const commit of newestFirst) {
    if (!commit.state) continue
    if (gateUndecided(commit.state.gates[gate])) break
    decision = commit
  }
  return decision
}

export async function computeMetrics(sources: RunSource[]): Promise<Metrics> {
  const decisions: GateDecisionRecord[] = []
  const runs: RunMetricsSummary[] = []

  for (const source of sources) {
    for (const ref of await source.listRuns()) {
      decisions.push(...(await collectRunDecisions(source, ref)))
      const { state } = await source.readState(ref)
      if (!state) continue
      const history = await source.stateHistory(ref)
      const spentValues = history.map((h) => h.state?.budget?.cost_spent_usd ?? null).filter((v) => v !== null)
      runs.push({
        source: source.id,
        slug: ref.slug,
        rounds: state.tasks.map((t) => ({ taskId: t.id, rounds: t.review_rounds })),
        budget: {
          limit: state.budget?.cost_limit_usd ?? null,
          spent: state.budget?.cost_spent_usd ?? null,
          everUpdated: new Set(spentValues).size > 1 || (spentValues[0] ?? 0) > 0,
        },
      })
    }
  }

  const perGate: GateMetrics[] = GATE_IDS.map((gate) => {
    const ofGate = decisions.filter((d) => d.gate === gate)
    const approvals = ofGate.filter((d) => d.approved).length
    const latencies = ofGate.map((d) => d.latencySeconds).filter((v): v is number => v !== null).sort((a, b) => a - b)
    const burdenMix: Record<Burden, number> = { confirmation: 0, 'light-correction': 0, 'heavy-correction': 0 }
    let burdenUnrecorded = 0
    for (const d of ofGate) {
      if (d.burden) burdenMix[d.burden]++
      else burdenUnrecorded++
    }
    const rate = ofGate.length ? approvals / ofGate.length : null
    return {
      gate,
      decisions: ofGate.length,
      approvals,
      approvalRate: rate,
      // The heuristic needs a sample, not two lucky approvals.
      overTriggering: rate !== null && ofGate.length >= 5 && rate > 0.9,
      burdenMix,
      burdenUnrecorded,
      medianLatencySeconds: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
    }
  })

  return { decisions, perGate, runs }
}
