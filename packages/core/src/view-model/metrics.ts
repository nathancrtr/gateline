// Metrics (I8): computed from state.yaml git history plus the burden field —
// no scribe, no store (rule R1). Latency is readiness-commit → decision-commit;
// approval rate carries the >90% over-triggering flag from FRONTEND.md §4.4.
//
// Gate figures come twice (docs/MULTI-REPO.md §9.4, decision P11, #499): per
// repository, and pooled across the set as a total. A pooled rate hides a
// repository whose gate over-triggers and can flag one that does not, so the
// flag is judged per repository, and the total carries it only when one
// repository is all it pools.
import { describeArtifact } from '../record/artifact.ts'
import { type Burden, GATE_IDS, type GateId, gateUndecided, ROUND_CAP } from '../record/schema.ts'
import { displayNameOf, type RunRef, type RunSource, type StateCommit } from '../sources/source.ts'
import { readEachRepository, type UnreadableRepository } from './portfolio.ts'

export interface GateDecisionRecord {
  /** The repository's id (docs/MULTI-REPO.md §6): what URLs, logs and copies carry. */
  source: string
  /** The repository's display name (§6.2, #497): presentation only, from `displayNameOf`. */
  sourceName: string
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

/**
 * The fewest decisions a rate is computed from (FRONTEND.md §4 principle 4:
 * the heuristic needs a sample, not two lucky approvals). Below it a row has
 * its counts and no rate, so no 0% or 100% is ever read off two decisions.
 */
export const RATE_MIN_DECISIONS = 5

export interface GateMetrics {
  gate: GateId
  decisions: number
  approvals: number
  /** Approvals over decisions; null below `RATE_MIN_DECISIONS` decisions, including none. */
  approvalRate: number | null
  /**
   * Sustained approval above 90% over a rated sample. Judged per repository:
   * on the pooled total (`Metrics.perGate`) it is false whenever the total
   * pools several repositories, and equals the one repository's flag when it
   * pools one.
   */
  overTriggering: boolean
  burdenMix: Record<Burden, number>
  burdenUnrecorded: number
  medianLatencySeconds: number | null
}

export interface RunMetricsSummary {
  /** The repository's id (docs/MULTI-REPO.md §6): what URLs, logs and copies carry. */
  source: string
  /** The repository's display name (§6.2, #497): presentation only, from `displayNameOf`. */
  sourceName: string
  slug: string
  rounds: { taskId: string; rounds: number }[]
  budget: { limit: number | null; spent: number | null; everUpdated: boolean }
}

/** One repository's gate figures: the same figures as the total, from its decisions alone. */
export interface RepositoryGateMetrics {
  /** The repository's id (docs/MULTI-REPO.md §6): what URLs, logs and copies carry. */
  source: string
  /** The repository's display name (§6.2, #497): presentation only, from `displayNameOf`. */
  sourceName: string
  /** One entry per gate, in `GATE_IDS` order, as in `Metrics.perGate`. */
  perGate: GateMetrics[]
}

export interface Metrics {
  decisions: GateDecisionRecord[]
  /** The total: every readable repository's decisions pooled, one entry per gate. */
  perGate: GateMetrics[]
  /**
   * The same figures per repository (#499), one entry per readable
   * repository in the order they are listed, including a repository with no
   * decisions. A repository in `unreadable` has no entry.
   */
  perRepository: RepositoryGateMetrics[]
  /** The fewest decisions a rate is computed from (`RATE_MIN_DECISIONS`). */
  rateMinDecisions: number
  runs: RunMetricsSummary[]
  /** The review-round cap the `rounds` counts are read against (record `ROUND_CAP`). */
  roundCap: number
  /**
   * Repositories left out because reading them failed (docs/MULTI-REPO.md
   * §10), in the order they are listed. Their decisions and runs are absent
   * from every figure above, so a reader must know they are missing.
   */
  unreadable: UnreadableRepository[]
}

const GATE_TRIGGERS: Record<GateId, (artifacts: string[]) => string[]> = {
  G0: () => ['spec.md'],
  G1: () => ['plan.md', 'tasks'],
  G2: (a) => [...a.filter((p) => describeArtifact(p).kind === 'review-report'), 'verification-report.md'],
  G3: () => ['release-plan.md'],
}

/**
 * Walk a run's state.yaml history (newest→oldest) and emit one record per
 * gate decision: the first commit at which the gate stops being undecided.
 * A caller that has already walked the history passes it in.
 */
export async function collectRunDecisions(
  source: RunSource,
  ref: RunRef,
  walked?: StateCommit[],
): Promise<GateDecisionRecord[]> {
  const history = walked ?? (await source.stateHistory(ref))
  if (history.length === 0) return []
  const artifacts = await source.listArtifacts(ref)
  const records: GateDecisionRecord[] = []
  const sourceName = displayNameOf(source)

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
      sourceName,
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
  // One repository's history per boundary (§10): one that cannot be read is
  // named in `unreadable`, and the figures are computed from the rest.
  const { read, unreadable } = await readEachRepository(sources, async (source) => {
    const decisions: GateDecisionRecord[] = []
    const runs: RunMetricsSummary[] = []
    for (const ref of await source.listRuns()) {
      const history = await source.stateHistory(ref)
      decisions.push(...(await collectRunDecisions(source, ref, history)))
      const { state } = await source.readState(ref)
      if (!state) continue
      const spentValues = history.map((h) => h.state?.budget?.cost_spent_usd ?? null).filter((v) => v !== null)
      runs.push({
        source: source.id,
        sourceName: displayNameOf(source),
        slug: ref.slug,
        rounds: state.tasks.map((t) => ({ taskId: t.id, rounds: t.review_rounds })),
        budget: {
          limit: state.budget?.cost_limit_usd ?? null,
          spent: state.budget?.cost_spent_usd ?? null,
          everUpdated: new Set(spentValues).size > 1 || (spentValues[0] ?? 0) > 0,
        },
      })
    }
    return { decisions, runs }
  })
  const decisions = read.flatMap(({ value }) => value.decisions)
  const runs = read.flatMap(({ value }) => value.runs)

  // Bucketed from the one walk above: each repository's decisions are the
  // ones its own read returned, so no history is read twice.
  const perRepository: RepositoryGateMetrics[] = read.map(({ source, value }) => ({
    source: source.id,
    sourceName: displayNameOf(source),
    perGate: GATE_IDS.map((gate) => gateMetrics(gate, value.decisions, true)),
  }))
  // The total is judged only when it is one repository's figure under
  // another name; a pooled rate is never flagged (MULTI-REPO.md §9.4).
  const judgeTotal = perRepository.length <= 1
  const perGate = GATE_IDS.map((gate) => gateMetrics(gate, decisions, judgeTotal))

  return { decisions, perGate, perRepository, rateMinDecisions: RATE_MIN_DECISIONS, runs, roundCap: ROUND_CAP, unreadable }
}

/** One gate's figures over `decisions`; `judge` says whether the over-triggering flag may be raised. */
function gateMetrics(gate: GateId, decisions: GateDecisionRecord[], judge: boolean): GateMetrics {
  const ofGate = decisions.filter((d) => d.gate === gate)
  const approvals = ofGate.filter((d) => d.approved).length
  const latencies = ofGate.map((d) => d.latencySeconds).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const burdenMix: Record<Burden, number> = { confirmation: 0, 'light-correction': 0, 'heavy-correction': 0 }
  let burdenUnrecorded = 0
  for (const d of ofGate) {
    if (d.burden) burdenMix[d.burden]++
    else burdenUnrecorded++
  }
  // The heuristic needs a sample, not two lucky approvals: below it there is no rate to read.
  const rate = ofGate.length >= RATE_MIN_DECISIONS ? approvals / ofGate.length : null
  return {
    gate,
    decisions: ofGate.length,
    approvals,
    approvalRate: rate,
    overTriggering: judge && rate !== null && rate > 0.9,
    burdenMix,
    burdenUnrecorded,
    medianLatencySeconds: latencies.length ? latencies[Math.floor(latencies.length / 2)]! : null,
  }
}
