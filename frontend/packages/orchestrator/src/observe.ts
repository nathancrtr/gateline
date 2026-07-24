// The observation step of the tick: gather everything derivation needs into
// one immutable snapshot, read entirely from committed files at the run ref
// (§4.2's first invariant). deriveAction() is then a pure function over this
// snapshot — which is what makes one-test-per-row possible.
import { parse as parseYaml } from 'yaml'
import { validateArtifact, type GateId, type RunRef, type RunSource, type RunState, type Validation } from '@agentic/core'
import { GATE_PRODUCER } from './derive.ts'
import { parseReviewReport, type ReviewInfo } from './review-report.ts'

export interface TaskFileInfo {
  path: string
  surface: string[]
  dependsOn: string[]
}

export interface LedgerEntry {
  at: string | null
  role: string
  task: string | null
  round: number | null
  adapter: string | null
  model: string | null
  tokens_in: number | null
  tokens_out: number | null
  cost_usd: number | null
  failed: boolean
}

export interface OpenDispatch {
  role: string
  task: string | null
  at: string | null
}

export interface RunObservation {
  slug: string
  state: RunState | null
  stateError: string | null
  artifacts: string[]
  /** Validation per contract-bound artifact present in the run. */
  validations: Record<string, Validation>
  reviews: ReviewInfo[]
  /** Run-relative path → newest commit epoch seconds touching it. */
  lastTouched: Record<string, number | null>
  /**
   * Epoch seconds of the newest run-branch commit touching anything other
   * than `state.yaml` (#188) — the delta guard for D17's post-resolution
   * re-review: a resolution commit only ever edits state.yaml itself, so
   * without this a re-review round can dispatch against a byte-identical
   * range and burn a capped round for nothing.
   */
  lastNonStateCommit: number | null
  /**
   * Most recent decline per gate, from state history (survives resume
   * resets). `redone` is true once the gate's packet artifact has landed
   * again after the decline — decided by commit ancestry when available,
   * commit time otherwise (same-second commits make wall clocks ambiguous).
   */
  declineEvents: Partial<Record<GateId, { at: number; notes: string | null; redone: boolean }>>
  /** Artifact → number of orchestrator bounce commits, from the commit grammar. */
  bounceCounts: Record<string, number>
  ledger: LedgerEntry[]
  /** Ledger entries opened by a dispatch and not yet closed: in-flight work. */
  openDispatches: OpenDispatch[]
  /** Sum of closed ledger cost, or cost_spent_usd when no ledger exists (v0 runs). */
  ledgerSpentUsd: number
  taskFiles: Map<string, TaskFileInfo>
  /** file_contact_surfaces of tasks currently being worked (not pending, not complete). */
  inFlightSurfaces: string[][]
  /** Static per-role estimates from the registry (resolved question 2). */
  estimates: Record<string, number>
  /**
   * Whether budget caps pause dispatch (#109). Orchestrator config injected
   * like `estimates`, defaulting on; when off, DB never fires — metering
   * (ledger, ledgerSpentUsd) is unconditional either way.
   */
  enforceBudget: boolean
}

export interface ObserveConfig {
  estimates?: Record<string, number>
  /** Budget caps pause dispatch (default true); metering happens regardless (#109). */
  enforceBudget?: boolean
  /** git merge-base --is-ancestor, for decline-vs-artifact ordering (D9). */
  isAncestor?: (maybeAncestor: string, of: string) => Promise<boolean>
}

const isTaskFile = (p: string) => p.startsWith('tasks/') && p.endsWith('.yaml')
const isReviewFile = (p: string) => /^review-\d+.*\.md$/.test(p)
const WORKING_STATUSES = new Set(['dispatched', 'in-progress', 'in-review'])

export async function observeRun(source: RunSource, ref: RunRef, cfg: ObserveConfig = {}): Promise<RunObservation> {
  const { state, error } = await source.readState(ref)
  const artifacts = await source.listArtifacts(ref)

  const validations: Record<string, Validation> = {}
  const lastTouched: Record<string, number | null> = {}
  const interesting = artifacts.filter(
    (p) => ['spec.md', 'plan.md', 'verification-report.md', 'release-plan.md'].includes(p) || isTaskFile(p) || isReviewFile(p),
  )
  for (const path of interesting) {
    const content = (await source.readArtifact(ref, path)) ?? ''
    validations[path] = await validateArtifact(path, content, source.templates)
    lastTouched[path] = (await source.lastTouched(ref, [path]))?.time ?? null
  }

  const reviews: ReviewInfo[] = []
  for (const path of artifacts.filter(isReviewFile)) {
    const content = (await source.readArtifact(ref, path)) ?? ''
    reviews.push(parseReviewReport(path, content, lastTouched[path] ?? null))
  }

  const taskFiles = new Map<string, TaskFileInfo>()
  for (const path of artifacts.filter(isTaskFile)) {
    const content = (await source.readArtifact(ref, path)) ?? ''
    let parsed: Record<string, unknown> = {}
    try {
      const raw = parseYaml(content)
      if (raw && typeof raw === 'object') parsed = raw as Record<string, unknown>
    } catch {
      /* malformed task files surface through validations */
    }
    const id = typeof parsed.id === 'string' ? parsed.id : path.replace(/^tasks\//, '').replace(/\.yaml$/, '')
    taskFiles.set(id, {
      path,
      surface: Array.isArray(parsed.file_contact_surface) ? parsed.file_contact_surface.map(String) : [],
      dependsOn: Array.isArray(parsed.depends_on) ? parsed.depends_on.map(String) : [],
    })
  }

  // History-derived facts: declines (which resume resets in the live entry)
  // and bounce counts (from the orchestrator's own commit grammar).
  const declineEvents: RunObservation['declineEvents'] = {}
  const declineOids: Partial<Record<GateId, string>> = {}
  const bounceCounts: Record<string, number> = {}
  const history = await source.stateHistory(ref) // newest first
  for (const commit of history) {
    const bounce = /^state\([^)]+\):\s*bounced\s+(\S+)/.exec(commit.subject)
    if (bounce) bounceCounts[bounce[1]!] = (bounceCounts[bounce[1]!] ?? 0) + 1
    if (!commit.state) continue
    for (const gate of ['G0', 'G1', 'G2', 'G3'] as GateId[]) {
      if (declineEvents[gate]) continue // newest wins; already found
      const entry = commit.state.gates[gate]
      if (!entry.approved && entry.by !== null) {
        declineEvents[gate] = { at: commit.time, notes: entry.notes, redone: false }
        declineOids[gate] = commit.oid
      }
    }
  }
  for (const gate of Object.keys(declineEvents) as GateId[]) {
    const decline = declineEvents[gate]!
    const touched = await source.lastTouched(ref, [GATE_PRODUCER[gate].artifact])
    if (!touched) continue
    const declineOid = declineOids[gate]!
    decline.redone = cfg.isAncestor
      ? touched.oid !== declineOid && (await cfg.isAncestor(declineOid, touched.oid))
      : touched.time > decline.at
  }

  // One extra git query, mirroring the per-path lastTouched calls above:
  // the newest commit touching anything in the run directory except
  // state.yaml itself (#188).
  const lastNonStateCommit = (await source.lastTouchedExcept(ref, ['state.yaml']))?.time ?? null

  const ledger = parseLedger(state)
  const openDispatches = ledger
    .filter((e) => e.cost_usd === null && !e.failed)
    .map((e) => ({ role: e.role, task: e.task, at: e.at }))
  const closedSum = ledger.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0)
  const ledgerSpentUsd = ledger.length > 0 ? closedSum : (state?.budget?.cost_spent_usd ?? 0)

  const inFlightSurfaces: string[][] = []
  for (const task of state?.tasks ?? []) {
    if (WORKING_STATUSES.has(task.status)) {
      const surface = taskFiles.get(task.id)?.surface ?? []
      if (surface.length) inFlightSurfaces.push(surface)
    }
  }

  return {
    slug: ref.slug,
    state,
    stateError: error,
    artifacts,
    validations,
    reviews,
    lastTouched,
    lastNonStateCommit,
    declineEvents,
    bounceCounts,
    ledger,
    openDispatches,
    ledgerSpentUsd,
    taskFiles,
    inFlightSurfaces,
    estimates: cfg.estimates ?? {},
    enforceBudget: cfg.enforceBudget ?? true,
  }
}

/** The ledger rides in budget's passthrough fields; parse it defensively. */
export function parseLedger(state: RunState | null): LedgerEntry[] {
  const raw = (state?.budget as Record<string, unknown> | null)?.ledger
  if (!Array.isArray(raw)) return []
  const entries: LedgerEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.role !== 'string') continue
    entries.push({
      at: typeof e.at === 'string' ? e.at : e.at instanceof Date ? e.at.toISOString() : null,
      role: e.role,
      task: typeof e.task === 'string' ? e.task : null,
      round: typeof e.round === 'number' ? e.round : null,
      adapter: typeof e.adapter === 'string' ? e.adapter : null,
      model: typeof e.model === 'string' ? e.model : null,
      tokens_in: typeof e.tokens_in === 'number' ? e.tokens_in : null,
      tokens_out: typeof e.tokens_out === 'number' ? e.tokens_out : null,
      cost_usd: typeof e.cost_usd === 'number' ? e.cost_usd : null,
      failed: e.failed === true,
    })
  }
  return entries
}
