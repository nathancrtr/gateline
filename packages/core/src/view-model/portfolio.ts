// Portfolio rows (interaction I6) and the cross-source inbox: pure
// derivations over RunSource reads — nothing here is stored (rule R1).

import { bestEffortEscalations, type ClosureRecord, type GateEntry, type Profile, ROUND_CAP, type RunState } from '../record/schema.ts'
import type { RunRef, RunSource } from '../sources/source.ts'
import { deriveReadiness, type InboxItem } from './readiness.ts'
import { type StateProblem, stateProblem } from './state-problem.ts'

export interface GateLedgerCell {
  approved: boolean
  decided: boolean
  by: string | null
  at: string | null
}

export interface RunSummary {
  source: string
  slug: string
  ref: string
  kind: RunRef['kind']
  phase: string
  pausedReason: string | null
  /**
   * Why the run was closed (#200), when it was. Carried on the summary rather
   * than looked up per surface: every layer that renders `phase: closed` needs
   * the disposition in the same breath, since "closed" alone is the untyped
   * state the phase exists to avoid.
   */
  closure: ClosureRecord | null
  /**
   * Why no state could be read from `state.yaml`, as a fact (#435): the run
   * state parser's diagnostic when it refused the file, or which other case
   * it was. Null when the state parsed.
   */
  unreadable: StateProblem | null
  /** Run profile (DESIGN.md §4.1); display layers filter the gate ledger through PROFILE_GATES. */
  profile: Profile
  gates: Record<'G0' | 'G1' | 'G2' | 'G3', GateLedgerCell>
  /**
   * `maxRounds` is the highest `review_rounds` any task has reached — an
   * observation. `roundCap` is the rule it is judged against (record
   * `ROUND_CAP`). They ride together so a surface can draw `n/cap` without
   * retyping the cap, and so the label never calls the observation a limit
   * (#314).
   */
  tasks: { total: number; done: number; maxRounds: number; roundCap: number }
  escalationsOpen: number
  budget: { limit: number | null; spent: number | null }
  /** Epoch seconds of the last commit touching the run directory. */
  updatedAt: number | null
  needsHuman: number
  /**
   * Commits on the run branch origin lacks (#149) — unpushed writes the
   * viewer sees but origin consumers do not. Null when not knowable (no
   * origin tracking, remote-kind run).
   */
  aheadOfOrigin: number | null
  /** Commits origin has that the local branch lacks (#99); with aheadOfOrigin > 0 the branch has diverged. */
  behindOrigin: number | null
}

const cell = (g: GateEntry): GateLedgerCell => ({
  approved: g.approved,
  decided: g.approved || g.by !== null,
  by: g.by,
  at: g.at,
})

export async function summarizeRun(
  source: RunSource,
  ref: RunRef,
): Promise<{ summary: RunSummary; items: InboxItem[] }> {
  const read = await source.readState(ref)
  const { state, raw } = read
  const { items } = await deriveReadiness(source, ref)
  const touched = await source.lastTouched(ref, [''])
  const aheadOfOrigin = (await source.aheadOfOrigin?.(ref)) ?? null
  const behindOrigin = (await source.behindOrigin?.(ref)) ?? null

  if (!state) {
    // Best-effort (#49): `escalations:` read on its own even though the rest
    // of the file fails the contract — the run stays loudly `unreadable`
    // below, this only keeps the one field a governance surface needs most
    // from silently reading as zero.
    const escalationsOpen = (raw ? bestEffortEscalations(raw) : []).filter((e) => !e.resolved).length
    return {
      summary: {
        source: ref.source,
        slug: ref.slug,
        ref: ref.ref,
        kind: ref.kind,
        phase: 'unknown',
        pausedReason: null,
        closure: null,
        unreadable: stateProblem(read),
        profile: 'full',
        gates: emptyLedger(),
        tasks: { total: 0, done: 0, maxRounds: 0, roundCap: ROUND_CAP },
        escalationsOpen,
        budget: { limit: null, spent: null },
        updatedAt: touched?.time ?? null,
        needsHuman: items.length,
        aheadOfOrigin,
        behindOrigin,
      },
      items,
    }
  }

  return {
    summary: {
      source: ref.source,
      slug: ref.slug,
      ref: ref.ref,
      kind: ref.kind,
      phase: state.phase,
      pausedReason: state.paused_reason,
      closure: state.closure,
      unreadable: null,
      profile: state.profile,
      gates: {
        G0: cell(state.gates.G0),
        G1: cell(state.gates.G1),
        G2: cell(state.gates.G2),
        G3: cell(state.gates.G3),
      },
      tasks: {
        total: state.tasks.length,
        done: state.tasks.filter((t) => t.status === 'done').length,
        maxRounds: state.tasks.reduce((m, t) => Math.max(m, t.review_rounds), 0),
        roundCap: ROUND_CAP,
      },
      escalationsOpen: state.escalations.filter((e) => !e.resolved).length,
      budget: { limit: state.budget?.cost_limit_usd ?? null, spent: state.budget?.cost_spent_usd ?? null },
      updatedAt: touched?.time ?? null,
      needsHuman: items.length,
      aheadOfOrigin,
      behindOrigin,
    },
    items,
  }
}

function emptyLedger(): RunSummary['gates'] {
  const c: GateLedgerCell = { approved: false, decided: false, by: null, at: null }
  return { G0: { ...c }, G1: { ...c }, G2: { ...c }, G3: { ...c } }
}

export interface Portfolio {
  runs: RunSummary[]
  /** All items needing a human, oldest first — the inbox ordering. */
  inbox: InboxItem[]
}

export async function buildPortfolio(sources: RunSource[]): Promise<Portfolio> {
  const runs: RunSummary[] = []
  const inbox: InboxItem[] = []
  for (const source of sources) {
    for (const ref of await source.listRuns()) {
      const { summary, items } = await summarizeRun(source, ref)
      runs.push(summary)
      inbox.push(...items)
    }
  }
  // Oldest first; unknown ages sink to the end rather than jumping the queue.
  inbox.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))
  runs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { runs, inbox }
}

export function stateOf(state: RunState | null): RunState | null {
  return state
}
