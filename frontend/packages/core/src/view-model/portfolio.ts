// Portfolio rows (interaction I6) and the cross-source inbox: pure
// derivations over RunSource reads — nothing here is stored (rule R1).
import { deriveReadiness, type InboxItem } from './readiness.ts'
import type { GateEntry, Profile, RunState } from '../record/schema.ts'
import type { RunRef, RunSource } from '../sources/source.ts'

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
  malformed: string | null
  /** Run profile (DESIGN.md §4.1); display layers filter the gate ledger through PROFILE_GATES. */
  profile: Profile
  gates: Record<'G0' | 'G1' | 'G2' | 'G3', GateLedgerCell>
  tasks: { total: number; done: number; maxRounds: number }
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
  const { state, error } = await source.readState(ref)
  const { items } = await deriveReadiness(source, ref)
  const touched = await source.lastTouched(ref, [''])
  const aheadOfOrigin = (await source.aheadOfOrigin?.(ref)) ?? null

  if (!state) {
    return {
      summary: {
        source: ref.source,
        slug: ref.slug,
        ref: ref.ref,
        kind: ref.kind,
        phase: 'unknown',
        pausedReason: null,
        malformed: error ?? 'state.yaml unreadable',
        profile: 'full',
        gates: emptyLedger(),
        tasks: { total: 0, done: 0, maxRounds: 0 },
        escalationsOpen: 0,
        budget: { limit: null, spent: null },
        updatedAt: touched?.time ?? null,
        needsHuman: items.length,
        aheadOfOrigin,
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
      malformed: null,
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
      },
      escalationsOpen: state.escalations.filter((e) => !e.resolved).length,
      budget: { limit: state.budget?.cost_limit_usd ?? null, spent: state.budget?.cost_spent_usd ?? null },
      updatedAt: touched?.time ?? null,
      needsHuman: items.length,
      aheadOfOrigin,
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
