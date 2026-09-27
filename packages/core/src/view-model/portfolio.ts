// Portfolio rows (interaction I6) and the cross-source inbox: pure
// derivations over RunSource reads — nothing here is stored (rule R1).

import { bestEffortEscalations, type ClosureRecord, type GateEntry, type Profile, ROUND_CAP, type RunState } from '../record/schema.ts'
import { displayNameOf, type RunRef, type RunSource } from '../sources/source.ts'
import { deriveReadiness, type InboxItem } from './readiness.ts'
import { type StateProblem, stateProblem } from './state-problem.ts'

export interface GateLedgerCell {
  approved: boolean
  decided: boolean
  by: string | null
  at: string | null
}

export interface RunSummary {
  /** The repository's id (docs/MULTI-REPO.md §6): what URLs, logs and copies carry. */
  source: string
  /**
   * The repository's display name (§6.2): the config `name`, else the id's
   * last segment. Presentation only — what an interface shows where it names
   * the repository (#497). Filled from `displayNameOf`, so web never derives
   * it from the id.
   */
  sourceName: string
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
  /**
   * Unresolved entries under `escalations:`, as the record holds them. A
   * record count, not a needs-you count: a closed run keeps its unresolved
   * entries here (History still shows them), while `needs` is empty, because
   * a closure answers everything inside the run (readiness.ts). Every open
   * escalation on a run that is not closed is already one of `needs`.
   */
  escalationsOpen: number
  budget: { limit: number | null; spent: number | null }
  /** Epoch seconds of the last commit touching the run directory. */
  updatedAt: number | null
  /** How many items need a human: `needs.length`, kept for the CLI and older readers. */
  needsHuman: number
  /**
   * What the run is waiting on a human for (#452): one fact per inbox item,
   * most urgent first by `NEED_PRECEDENCE`, derivation order within a rank. A
   * surface that shows one mark for the run reads `needs[0]`; the count is the
   * length. Empty on a closed run, whatever its escalations say.
   */
  needs: NeedFact[]
  /**
   * Commits on the run branch origin lacks (#149) — unpushed writes the
   * viewer sees but origin consumers do not. Null when not knowable (no
   * origin tracking, remote-kind run).
   */
  aheadOfOrigin: number | null
  /** Commits origin has that the local branch lacks (#99); with aheadOfOrigin > 0 the branch has diverged. */
  behindOrigin: number | null
}

/**
 * One waiting item, reduced to what tells its kinds apart: the kind, the gate
 * it is about, and the two flags that split a gate into ready, bounced and
 * superseded (#159). The inbox item itself stays on `/api/inbox`.
 */
export type NeedFact = Pick<InboxItem, 'kind' | 'gate' | 'reviewable' | 'inflight'>

/**
 * Which waiting item speaks for the run when only one can (#452). Lower is
 * more urgent. The order is the one settled decision 8 of
 * `packages/web/DESIGN.md` gives colour — health, then the one ready
 * decision, then everything that is the machine's turn or at rest — and each
 * step has a reason in the record:
 *
 *  0. `malformed` — the record cannot be read. Nothing else about the run can
 *     be trusted, and the engine cannot act on it (DESIGN.md §5: consumers
 *     bounce, never guess).
 *  1. `escalation`, `round-cap` — the run is stopped. An unresolved escalation
 *     puts the engine at rest until a person answers (engine rule D3), and a round
 *     cap is the loop's own escalation to a human (DESIGN.md §4).
 *  2. a reviewable `gate` — the one decision ready to take; the run moves as
 *     soon as someone takes it.
 *  3. a gate that is bounced or superseded, `paused`, `staged` — the machine's
 *     turn, or a run at rest. A bounced packet is re-dispatched, a superseded
 *     one is about to be replaced, and a paused or staged run is standing.
 */
export const NEED_PRECEDENCE = ['malformed', 'stuck', 'ready-gate', 'at-rest'] as const
export type NeedRank = (typeof NEED_PRECEDENCE)[number]

/** A waiting item's rank in `NEED_PRECEDENCE`. Pure. */
export function needRank(need: NeedFact): NeedRank {
  switch (need.kind) {
    case 'malformed':
      return 'malformed'
    case 'escalation':
    case 'round-cap':
      return 'stuck'
    case 'gate':
      return need.reviewable ? 'ready-gate' : 'at-rest'
    case 'paused':
    case 'staged':
      return 'at-rest'
  }
}

/** The run's waiting items as facts, most urgent first. Stable within a rank. */
export function needsOf(items: readonly InboxItem[]): NeedFact[] {
  const rank = (n: NeedFact) => NEED_PRECEDENCE.indexOf(needRank(n))
  return items
    .map(({ kind, gate, reviewable, inflight }): NeedFact => ({ kind, gate, reviewable, inflight }))
    .sort((a, b) => rank(a) - rank(b))
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
  const [read, { items }, touched, aheadOfOrigin, behindOrigin] = await Promise.all([
    source.readState(ref),
    deriveReadiness(source, ref),
    source.lastTouched(ref, ['']),
    source.aheadOfOrigin?.(ref) ?? null,
    source.behindOrigin?.(ref) ?? null,
  ])
  const { state, raw } = read

  if (!state) {
    // Best-effort (#49): `escalations:` read on its own even though the rest
    // of the file fails the contract — the run stays loudly `unreadable`
    // below, this only keeps the one field a governance surface needs most
    // from silently reading as zero.
    const escalationsOpen = (raw ? bestEffortEscalations(raw) : []).filter((e) => !e.resolved).length
    return {
      summary: {
        source: ref.source,
        sourceName: displayNameOf(source),
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
        needs: needsOf(items),
        aheadOfOrigin,
        behindOrigin,
      },
      items,
    }
  }

  return {
    summary: {
      source: ref.source,
      sourceName: displayNameOf(source),
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
      needs: needsOf(items),
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

/**
 * A repository that could not be read (docs/MULTI-REPO.md §10). Its rows are
 * left out and it is named here instead, so one repository that cannot be
 * read does not take the others with it. Different from an unreadable run,
 * which is a row and an inbox item of kind `malformed`.
 */
export interface UnreadableRepository {
  /** The repository's id (§6). */
  source: string
  /** Its display name (§6.2): presentation only, from `displayNameOf`. */
  sourceName: string
  /** What went wrong, on one line. */
  error: string
}

export interface Portfolio {
  runs: RunSummary[]
  /** All items needing a human, oldest first — the inbox ordering. */
  inbox: InboxItem[]
  /** Repositories left out because reading them failed, in the order they are listed. */
  unreadable: UnreadableRepository[]
}

/**
 * How many runs are summarized at once. Each summary is a handful of git
 * processes; enough at once to stop waiting on them one by one, few enough
 * that a large portfolio does not start hundreds together.
 */
const SUMMARIZE_AT_ONCE = 8

/**
 * How many repositories are read at once (§10). Each one summarizes up to
 * `SUMMARIZE_AT_ONCE` runs at a time, so this multiplies: 4 × 8 keeps at
 * most 32 summaries in flight, four times what one repository costs. The
 * set is a handful at operator scale (§3), so 4 lets two to four
 * repositories load side by side, and a longer list waits its turn rather
 * than starting hundreds of git processes together.
 */
export const REPOSITORIES_AT_ONCE = 4

/** `fn` over `items`, at most `limit` running at a time, results in the order of `items`. */
export async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** An error as one line: its message's first non-blank line, trimmed and bounded. */
export function oneLineError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  const first = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  if (!first) return 'reading it failed, with no message'
  return first.length > 300 ? `${first.slice(0, 299)}…` : first
}

/**
 * `read` once per repository, `REPOSITORIES_AT_ONCE` at a time, with a fault
 * boundary between them: a repository whose read throws is named in
 * `unreadable` and the rest are returned. Both lists keep the order of
 * `sources`, whatever order the reads finish in.
 */
export async function readEachRepository<R>(
  sources: RunSource[],
  read: (source: RunSource) => Promise<R>,
): Promise<{ read: { source: RunSource; value: R }[]; unreadable: UnreadableRepository[] }> {
  const outcomes = await mapBounded(sources, REPOSITORIES_AT_ONCE, async (source) => {
    try {
      return { source, ok: true as const, value: await read(source) }
    } catch (e) {
      return { source, ok: false as const, error: oneLineError(e) }
    }
  })
  const out: { source: RunSource; value: R }[] = []
  const unreadable: UnreadableRepository[] = []
  for (const o of outcomes) {
    if (o.ok) out.push({ source: o.source, value: o.value })
    else unreadable.push({ source: o.source.id, sourceName: displayNameOf(o.source), error: o.error })
  }
  return { read: out, unreadable }
}

/**
 * How a portfolio gets its parts. A caller holding a cache passes its own
 * readers, so a run whose refs have not moved is not summarized again (#461).
 */
export interface PortfolioReaders {
  listRuns?: (source: RunSource) => Promise<RunRef[]>
  summarize?: (source: RunSource, ref: RunRef) => Promise<{ summary: RunSummary; items: InboxItem[] }>
}

export async function buildPortfolio(sources: RunSource[], readers: PortfolioReaders = {}): Promise<Portfolio> {
  const listRuns = readers.listRuns ?? ((source: RunSource) => source.listRuns())
  const summarize = readers.summarize ?? summarizeRun
  // The whole of a repository's reading is inside its boundary: a failure
  // listing its runs or summarizing one of them leaves the repository out,
  // since a run that cannot be summarized is a git failure, not a record one.
  // A record that cannot be parsed does not throw; it is a `malformed` row.
  const { read, unreadable } = await readEachRepository(sources, async (source) => {
    const refs = await listRuns(source)
    return mapBounded(refs, SUMMARIZE_AT_ONCE, (ref) => summarize(source, ref))
  })
  const runs: RunSummary[] = []
  const inbox: InboxItem[] = []
  for (const { value } of read) {
    for (const { summary, items } of value) {
      runs.push(summary)
      inbox.push(...items)
    }
  }
  // Oldest first; unknown ages sink to the end rather than jumping the queue.
  inbox.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))
  runs.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { runs, inbox, unreadable }
}

export function stateOf(state: RunState | null): RunState | null {
  return state
}
