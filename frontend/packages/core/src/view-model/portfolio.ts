// Portfolio rows (interaction I6) and the cross-source inbox: pure
// derivations over RunSource reads — nothing here is stored (rule R1).
import { deriveReadiness, type InboxItem } from './readiness.ts'
import type { GateEntry, GateId, Profile, RunState } from '../record/schema.ts'
import type { RunRef, RunSource } from '../sources/source.ts'

export interface GateLedgerCell {
  approved: boolean
  decided: boolean
  by: string | null
  at: string | null
}

/**
 * G0–G3 stay statically keyed (cli/web index them directly, and both are
 * outside this run's diff — plan ADR-3/ADR-4) while a generic host's own
 * gate names ride the same map under the string index. A generic summary
 * populates only its declared gate names — never a synthesized G0–G3 — so a
 * cli/web reader indexing `.G0` on a purely non-SDLC host's summary gets
 * `undefined`, a named debt deferred by ADR-6.
 */
export type GateLedgerMap = Record<GateId, GateLedgerCell> & Record<string, GateLedgerCell | undefined>

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
  gates: GateLedgerMap
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
  /** Commits origin has that the local branch lacks (#99); with aheadOfOrigin > 0 the branch has diverged. */
  behindOrigin: number | null
}

const cell = (g: GateEntry): GateLedgerCell => ({
  approved: g.approved,
  decided: g.approved || g.by !== null,
  by: g.by,
  at: g.at,
})

/** A declared generic gate absent from the file (undecided, never seen). */
const UNDECIDED_CELL: GateLedgerCell = { approved: false, decided: false, by: null, at: null }

export async function summarizeRun(
  source: RunSource,
  ref: RunRef,
): Promise<{ summary: RunSummary; items: InboxItem[] }> {
  const { state, error, generic } = await source.readState(ref)
  const { items } = await deriveReadiness(source, ref)
  const touched = await source.lastTouched(ref, [''])
  const aheadOfOrigin = (await source.aheadOfOrigin?.(ref)) ?? null
  const behindOrigin = (await source.behindOrigin?.(ref)) ?? null

  if (!state && generic) {
    return {
      summary: {
        source: ref.source,
        slug: ref.slug,
        ref: ref.ref,
        kind: ref.kind,
        phase: generic.phase ?? '—',
        pausedReason: generic.paused_reason,
        malformed: null,
        // Typed filler: GenericRunState carries no profile concept (ADR-6
        // consequence) — cli/web's PROFILE_GATES filtering is SDLC-only and
        // stays out of this run's diff.
        profile: 'full',
        gates: Object.fromEntries(generic.gateOrder.map((id) => [id, generic.gates[id] ? cell(generic.gates[id]!) : { ...UNDECIDED_CELL }])) as GateLedgerMap,
        tasks: { total: 0, done: 0, maxRounds: 0 },
        escalationsOpen: generic.escalations.filter((e) => !e.resolved).length,
        budget: { limit: null, spent: null },
        updatedAt: touched?.time ?? null,
        needsHuman: items.length,
        aheadOfOrigin,
        behindOrigin,
      },
      items,
    }
  }

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
