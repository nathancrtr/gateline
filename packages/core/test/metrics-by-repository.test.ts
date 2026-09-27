// Gate metrics per repository (#499; docs/MULTI-REPO.md §9.4, decision P11).
//
// What is pinned: each repository's gate figures are computed from its own
// decisions, beside the pooled total; the over-triggering flag is judged per
// repository and never on a total that pools several; a gate with fewer than
// five decisions has its counts and no rate; a repository that cannot be read
// has no entry; with one repository the breakdown is the total; and all of it
// comes from one walk of each run's history.
//
// The sources are fakes whose state histories are written out below, so
// every expected figure is a literal worked out by hand from them.
import { describe, expect, it } from 'vitest'
import {
  type Burden,
  computeMetrics,
  type GateId,
  type GateMetrics,
  RATE_MIN_DECISIONS,
  type RunRef,
  type RunSource,
  type RunState,
  type StateCommit,
} from '../src/index.ts'

/** One gate's decision in a fake run. */
interface Decided {
  approved: boolean
  burden: Burden | null
}

/** A run: the gates it decided. Gates it leaves out are undecided. */
type FakeRun = Partial<Record<GateId, Decided>>

const DECIDED_AT = 1_800_000_000
const UNDECIDED = { approved: false, by: null, at: null, burden: null, notes: null }

/** How often each method of a fake source was called, by source id and run. */
interface Calls {
  listRuns: string[]
  stateHistory: string[]
}

/**
 * A repository whose runs each have a one-commit state history deciding the
 * given gates. Every gate became ready `latency` seconds before its decision
 * (the trigger commit `lastTouched` reports).
 */
function fakeRepository(id: string, displayName: string, runs: FakeRun[], latency: number, calls: Calls): RunSource {
  const refs: RunRef[] = runs.map((_, i) => ({ source: id, slug: `run-${i + 1}`, ref: `run/run-${i + 1}`, kind: 'branch', branch: `run/run-${i + 1}` }))
  const stateOf = (slug: string): RunState => {
    const run = runs[Number(slug.slice(4)) - 1]!
    const gates = Object.fromEntries(
      (['G0', 'G1', 'G2', 'G3'] as const).map((g) => {
        const d = run[g]
        return [g, d ? { approved: d.approved, by: 'Pat Doe', at: '2027-01-15T08:00:00Z', burden: d.burden, notes: null } : UNDECIDED]
      }),
    )
    return { gates, tasks: [] } as unknown as RunState
  }
  return {
    id,
    displayName,
    listRuns: async () => {
      calls.listRuns.push(id)
      return refs
    },
    stateHistory: async (ref: RunRef): Promise<StateCommit[]> => {
      calls.stateHistory.push(`${id} ${ref.slug}`)
      return [{ oid: `${ref.slug}-tip`, time: DECIDED_AT, author: 'Pat Doe', email: 'pat@example.com', subject: 'G0 approved by Pat Doe', state: stateOf(ref.slug) }]
    },
    readState: async (ref: RunRef) => ({ state: stateOf(ref.slug) }),
    listArtifacts: async () => [],
    lastTouched: async () => ({ oid: 'trigger', time: DECIDED_AT - latency, author: 'agent', email: 'agent@example.com', subject: 'artifacts' }),
  } as unknown as RunSource
}

function unreadableRepository(id: string, displayName: string): RunSource {
  return {
    id,
    displayName,
    listRuns: async () => {
      throw new Error('fatal: not a git repository (or any of the parent directories): .git')
    },
  } as unknown as RunSource
}

const yes = (burden: Burden | null = 'confirmation'): Decided => ({ approved: true, burden })
const no = (burden: Burden | null = 'heavy-correction'): Decided => ({ approved: false, burden })

/**
 * billing: 10 runs. G0 approved in the first 5 (5 of 5); G1 approved in all
 * 10 (10 of 10). Every gate ready one minute before its decision.
 */
const billingRuns: FakeRun[] = Array.from({ length: 10 }, (_, i) => (i < 5 ? { G0: yes(), G1: yes() } : { G1: yes() }))

/**
 * infra: 10 runs. G0 decided in all 10: 7 approved (5 confirmations, 2 light
 * corrections), 3 declined (heavy corrections). G1 approved in the first 4
 * (4 of 4), the last one with no burden recorded. Every gate ready one hour
 * before its decision.
 */
const infraRuns: FakeRun[] = [
  { G0: yes(), G1: yes() },
  { G0: yes(), G1: yes() },
  { G0: yes(), G1: yes() },
  { G0: yes(), G1: yes(null) },
  { G0: yes() },
  { G0: yes('light-correction') },
  { G0: yes('light-correction') },
  { G0: no() },
  { G0: no() },
  { G0: no() },
]

const newCalls = (): Calls => ({ listRuns: [], stateHistory: [] })
const billing = (calls: Calls) => fakeRepository('github.com/acme/billing', 'billing', billingRuns, 60, calls)
const infra = (calls: Calls) => fakeRepository('gitlab.example.com/ops/infra', 'infra', infraRuns, 3600, calls)

const gate = (perGate: GateMetrics[], id: GateId) => perGate.find((g) => g.gate === id)!

describe('gate metrics per repository', () => {
  it('computes each repository from its own decisions beside the pooled total, and flags only a repository', async () => {
    const metrics = await computeMetrics([billing(newCalls()), infra(newCalls())])
    expect(RATE_MIN_DECISIONS).toBe(5)
    expect(metrics.rateMinDecisions).toBe(5)
    expect(metrics.perRepository.map((r) => [r.source, r.sourceName])).toEqual([
      ['github.com/acme/billing', 'billing'],
      ['gitlab.example.com/ops/infra', 'infra'],
    ])
    const [b, i] = metrics.perRepository

    // G0: billing 5 of 5, infra 7 of 10; the total 12 of 15 = 0.8.
    expect(gate(metrics.perGate, 'G0')).toEqual({
      gate: 'G0',
      decisions: 15,
      approvals: 12,
      approvalRate: 0.8,
      overTriggering: false,
      burdenMix: { confirmation: 10, 'light-correction': 2, 'heavy-correction': 3 },
      burdenUnrecorded: 0,
      // Five latencies of 60 and ten of 3600: the eighth, sorted, is 3600.
      medianLatencySeconds: 3600,
    })
    expect(gate(b!.perGate, 'G0')).toEqual({
      gate: 'G0',
      decisions: 5,
      approvals: 5,
      approvalRate: 1,
      overTriggering: true,
      burdenMix: { confirmation: 5, 'light-correction': 0, 'heavy-correction': 0 },
      burdenUnrecorded: 0,
      medianLatencySeconds: 60,
    })
    expect(gate(i!.perGate, 'G0')).toEqual({
      gate: 'G0',
      decisions: 10,
      approvals: 7,
      approvalRate: 0.7,
      overTriggering: false,
      burdenMix: { confirmation: 5, 'light-correction': 2, 'heavy-correction': 3 },
      burdenUnrecorded: 0,
      medianLatencySeconds: 3600,
    })

    // G1: billing 10 of 10, infra 4 of 4. The total, 14 of 14, is above 90%
    // and still carries no flag: it pools two repositories.
    expect(gate(metrics.perGate, 'G1')).toMatchObject({ decisions: 14, approvals: 14, approvalRate: 1, overTriggering: false })
    expect(gate(b!.perGate, 'G1')).toMatchObject({ decisions: 10, approvals: 10, approvalRate: 1, overTriggering: true })
  })

  it('gives a repository with four decisions its counts and no rate, and does not flag it', async () => {
    const metrics = await computeMetrics([billing(newCalls()), infra(newCalls())])
    expect(gate(metrics.perRepository[1]!.perGate, 'G1')).toEqual({
      gate: 'G1',
      decisions: 4,
      approvals: 4,
      approvalRate: null,
      overTriggering: false,
      burdenMix: { confirmation: 3, 'light-correction': 0, 'heavy-correction': 0 },
      burdenUnrecorded: 1,
      medianLatencySeconds: 3600,
    })
    // A gate no repository decided: no decisions, no rate, no flag.
    expect(gate(metrics.perRepository[0]!.perGate, 'G3')).toEqual({
      gate: 'G3',
      decisions: 0,
      approvals: 0,
      approvalRate: null,
      overTriggering: false,
      burdenMix: { confirmation: 0, 'light-correction': 0, 'heavy-correction': 0 },
      burdenUnrecorded: 0,
      medianLatencySeconds: null,
    })
  })

  it('leaves a repository that cannot be read out of the breakdown and the total', async () => {
    const metrics = await computeMetrics([billing(newCalls()), unreadableRepository('github.com/acme/ledger', 'ledger'), infra(newCalls())])
    expect(metrics.unreadable.map((u) => u.source)).toEqual(['github.com/acme/ledger'])
    expect(metrics.perRepository.map((r) => r.source)).toEqual(['github.com/acme/billing', 'gitlab.example.com/ops/infra'])
    expect(gate(metrics.perGate, 'G0')).toMatchObject({ decisions: 15, approvals: 12 })
  })

  it('with one repository, has one entry equal to the total, and the total carries its flag', async () => {
    const metrics = await computeMetrics([billing(newCalls())])
    expect(metrics.perRepository).toHaveLength(1)
    expect(metrics.perRepository[0]!.perGate).toEqual(metrics.perGate)
    expect(metrics.perGate.map((g) => [g.gate, g.decisions, g.approvals, g.approvalRate, g.overTriggering])).toEqual([
      ['G0', 5, 5, 1, true],
      ['G1', 10, 10, 1, true],
      ['G2', 0, 0, null, false],
      ['G3', 0, 0, null, false],
    ])
    // A repository that cannot be read beside it leaves the total one repository's figure, still flagged.
    const withBroken = await computeMetrics([billing(newCalls()), unreadableRepository('github.com/acme/ledger', 'ledger')])
    expect(withBroken.perRepository.map((r) => r.source)).toEqual(['github.com/acme/billing'])
    expect(gate(withBroken.perGate, 'G0').overTriggering).toBe(true)
  })

  it('walks each run’s history once, however many repositories there are', async () => {
    const calls = newCalls()
    await computeMetrics([billing(calls), infra(calls)])
    expect(calls.listRuns).toEqual(['github.com/acme/billing', 'gitlab.example.com/ops/infra'])
    expect(calls.stateHistory).toHaveLength(20)
    expect(new Set(calls.stateHistory).size).toBe(20)
  })
})
