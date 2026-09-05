// The observation step of the tick: gather everything derivation needs into
// one immutable snapshot, read entirely from committed files at the run ref
// (§4.2's first invariant). deriveAction() is then a pure function over this
// snapshot — which is what makes one-test-per-row possible.
import { parse as parseYaml } from 'yaml'
import {
  type BudgetLedgerEntry,
  type GateId,
  parseLedger,
  type RunState,
  type Validation,
  validateArtifact,
} from '@gateline/core/record'
import type { RunRef, RunSource } from '@gateline/core/sources'
import { CONTRACT_DISPUTE, GATE_PRODUCER, landingEscalationKey } from './derive.ts'
import { parseReviewReport, type ReviewInfo } from './review-report.ts'
import { parseVerificationReport, type VerificationInfo } from './verification-report.ts'

export interface TaskFileInfo {
  path: string
  surface: string[]
  dependsOn: string[]
}

/**
 * The budget ledger's entry, and its parser, now live in `@gateline/core/record`
 * (#159): Gatehouse's readiness derivation reads the same open entries to know a
 * gate's producer is in flight, and two parsers of one append-only list is how
 * the engine and the frontend come to disagree about what is running. Re-exported
 * under the engine's own names so every call site here reads as it always did.
 */
export type LedgerEntry = BudgetLedgerEntry
export { parseLedger }

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
  /** The verification report's overall verdict (#152), or null when the run has no report. */
  verification: VerificationInfo | null
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
  /**
   * Artifact → orchestrator bounce commits since the artifact's bounce budget
   * last reset, from the commit grammar.
   *
   * The budget is per dispute, not per lifetime (#348). Counting the whole
   * branch history made D8 a one-shot: a human who resolved the contract
   * dispute, repaired the artifact by hand and let the producer regenerate it
   * got no bounces at all the next time it came back malformed — the second
   * occurrence escalated on sight, with a reason quoting bounces from weeks
   * earlier. Resolving the D8 escalation for an artifact is what clears its
   * count, so each dispute starts the same two bounces the first one had.
   */
  bounceCounts: Record<string, number>
  ledger: LedgerEntry[]
  /** Ledger entries opened by a dispatch and not yet closed: in-flight work. */
  openDispatches: OpenDispatch[]
  /**
   * Per (role, task) — keyed by `idleKey` — how many dispatches closed ok and
   * landed nothing (#343): closed-ok ledger entries opened *after* the last
   * commit touching what that dispatch existed to produce — the gate's packet
   * artifact for a producer, the task's whole record for a task-scoped role.
   * Rule DL reads it before every dispatch, because half the derivation table
   * re-dispatches on the absence of an expected change and would otherwise
   * count nothing at all — an agent that returns ok and commits nothing is a
   * success to the close path and a no-op here, so the same dispatch re-derives
   * every tick until the budget stops it.
   *
   * The count resets on two facts: what it was to land moving (the role
   * produced), and a human resolving that (role, task)'s escalation — the same
   * "resolution newer than the standing fact" shape D17 and D20 read, so
   * resolve-and-resume does not walk straight back into the cap.
   */
  idleDispatches: Map<string, number>
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
/**
 * Statuses whose task holds its `file_contact_surface` against a parallel
 * launch: everything that is neither pending nor complete. `in-progress` stays
 * in the set even though D25 (#350) now returns it to `pending` when no ledger
 * entry stands behind it — the transition takes a tick, and a surface claimed
 * by a task mid-transition is not one another implementer may take.
 */
const WORKING_STATUSES = new Set(['dispatched', 'in-progress', 'in-review'])

/** How `idleDispatches` is keyed: one counter per (role, task) pair. */
export const idleKey = (role: string, task: string | null): string => `${role}|${task ?? ''}`

/**
 * The landing counters (#343), as a pure function of the facts they read — the
 * counting rule the engine's DL check depends on, exposed so it can be tested
 * without a repository.
 *
 * What a dispatch was sent to land is the gate's packet artifact for a producer
 * role, and the task's whole record — work item plus reviews — for a
 * task-scoped one. An entry counts when it closed ok — a failure is the failure
 * path's business (#147) and a refusal never ran (#155) — and was opened after
 * both of the facts that reset the count: the artifact last moving, and the
 * latest resolution of that (role, task)'s own landing escalation. A missing
 * artifact has no landing to be newer than, so every closed-ok entry counts,
 * which is the case the cap most needs to see.
 */
export function idleDispatchCounts(input: {
  ledger: LedgerEntry[]
  reviews: ReviewInfo[]
  taskFiles: Map<string, TaskFileInfo>
  lastTouched: Record<string, number | null>
  escalations: RunState['escalations']
}): Map<string, number> {
  const producerArtifact: Record<string, string> = {}
  for (const { role, artifact } of Object.values(GATE_PRODUCER)) producerArtifact[role] = artifact
  /**
   * A task-scoped role's landing shows up somewhere in that task's own record
   * — its work item, or a review report about it. Both, not just the one the
   * dispatching rule reads: an implementer's real product is code, which lives
   * outside the run directory and the observation therefore cannot see, so the
   * work item's response note and the reviewer's answer to that round are the
   * only marks it leaves here. Reading the work item alone would count a whole
   * v0-shaped round — code landed, reviewed, answered — as having produced
   * nothing, which is exactly what the dupefind replay shows.
   */
  const expectedArtifacts = (role: string, task: string | null): string[] => {
    if (task !== null) {
      const paths: string[] = []
      const item = input.taskFiles.get(task)?.path
      if (item) paths.push(item)
      for (const review of input.reviews) if (review.task === task) paths.push(review.path)
      return paths
    }
    const artifact = producerArtifact[role]
    return artifact ? [artifact] : []
  }
  const floors = new Map<string, number>()
  const floorFor = (role: string, task: string | null, key: string): number => {
    const cached = floors.get(key)
    if (cached !== undefined) return cached
    let landed: number | null = null
    for (const path of expectedArtifacts(role, task)) {
      const at = input.lastTouched[path] ?? null
      if (at !== null && (landed === null || at > landed)) landed = at
    }
    let floor = landed === null ? Number.NEGATIVE_INFINITY : landed * 1000
    const escalationKey = landingEscalationKey(role, task)
    for (const e of input.escalations) {
      if (!e.resolved || e.resolved_at === null || !e.reason.includes(escalationKey)) continue
      const at = Date.parse(e.resolved_at)
      if (Number.isFinite(at) && at > floor) floor = at
    }
    floors.set(key, floor)
    return floor
  }

  const counts = new Map<string, number>()
  for (const entry of input.ledger) {
    if (entry.at === null || entry.cost_usd === null || entry.failed || entry.refused) continue // closed ok only
    const at = Date.parse(entry.at)
    if (!Number.isFinite(at)) continue
    const key = idleKey(entry.role, entry.task)
    if (at <= floorFor(entry.role, entry.task, key)) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

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

  let verification: VerificationInfo | null = null
  if (artifacts.includes('verification-report.md')) {
    const content = (await source.readArtifact(ref, 'verification-report.md')) ?? ''
    verification = parseVerificationReport(content, lastTouched['verification-report.md'] ?? null)
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
  // Where each artifact's bounce budget last reset (#348): the newest resolved
  // contract dispute naming it. Recency is commit time against `resolved_at`,
  // the same shape D17 and D20 use — and the same wall-clock reading #346 is
  // revisiting for all three at once.
  const disputeResolvedAt: Record<string, number> = {}
  for (const esc of state?.escalations ?? []) {
    const named = esc.resolved ? CONTRACT_DISPUTE.exec(esc.reason) : null
    if (!named || !esc.resolved_at) continue
    const at = Math.floor(Date.parse(esc.resolved_at) / 1000)
    if (!Number.isFinite(at)) continue
    const artifact = named[1]!
    if (at > (disputeResolvedAt[artifact] ?? Number.NEGATIVE_INFINITY)) disputeResolvedAt[artifact] = at
  }
  const history = await source.stateHistory(ref) // newest first
  for (const commit of history) {
    const bounce = /^state\([^)]+\):\s*bounced\s+(\S+)/.exec(commit.subject)
    if (bounce && commit.time > (disputeResolvedAt[bounce[1]!] ?? Number.NEGATIVE_INFINITY))
      bounceCounts[bounce[1]!] = (bounceCounts[bounce[1]!] ?? 0) + 1
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

  const idleDispatches = idleDispatchCounts({ ledger, reviews, taskFiles, lastTouched, escalations: state?.escalations ?? [] })

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
    verification,
    lastTouched,
    lastNonStateCommit,
    declineEvents,
    bounceCounts,
    ledger,
    openDispatches,
    idleDispatches,
    ledgerSpentUsd,
    taskFiles,
    inFlightSurfaces,
    estimates: cfg.estimates ?? {},
    enforceBudget: cfg.enforceBudget ?? true,
  }
}

