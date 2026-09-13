// The observation step of the tick: gather everything derivation needs into
// one immutable snapshot, read entirely from committed files at the run ref
// (§4.2's first invariant). deriveAction() is then a pure function over this
// snapshot — which is what makes one-test-per-row possible.

import {
  type BudgetLedgerEntry,
  type GateId,
  parseLedger,
  type RunState,
  type Validation,
  validateArtifact,
} from '@gateline/core/record'
import { BranchOrder, type CommitInfo, type RunRef, type RunSource, readBranchOrder, resolutionCommitsOf } from '@gateline/core/sources'
import { parse as parseYaml } from 'yaml'
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

/**
 * One fact, placed both ways: where its commit sits on the run branch, and
 * what clock stamped it (epoch seconds). Every recency question in the
 * derivation table is a comparison of two of these (#346).
 *
 * The branch is the authority — `state.yaml` commits and artifact landings are
 * linear on it, and no machine's clock can contradict a parent-child edge. The
 * timestamp is the fallback for a fact the branch cannot place: an observation
 * built by hand in a test, a source that offers no history, an escalation
 * resolved in a commit the run directory never saw.
 */
export interface Anchor {
  oid: string | null
  /** Epoch **seconds**, never milliseconds — `resolved_at` is divided on the way in. */
  time: number | null
}

/**
 * "`x` happened after `y`", read from the branch first and the clocks only
 * when the branch cannot say (#346). An unplaceable, untimed fact is not
 * evidence of anything, so it is not "after".
 */
export function after(order: BranchOrder, x: Anchor, y: Anchor): boolean {
  const byBranch = order.after(x.oid, y.oid)
  if (byBranch !== null) return byBranch
  return x.time !== null && y.time !== null && x.time > y.time
}

/** Whether an anchor names any fact at all. */
export const anchored = (a: Anchor): boolean => a.oid !== null || a.time !== null

const commitAnchor = (commit: CommitInfo | null | undefined, fallbackTime: number | null = null): Anchor => ({
  oid: commit?.oid ?? null,
  time: commit?.time ?? fallbackTime,
})

const isoSeconds = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms / 1000 : null
}

/** Where an artifact last landed. */
export const artifactAnchor = (obs: RunObservation, path: string | null | undefined): Anchor =>
  path ? { oid: obs.lastTouchedOid[path] ?? null, time: obs.lastTouched[path] ?? null } : { oid: null, time: null }

/** Where the newest commit that is not a `state.yaml` edit landed (#188). */
export const nonStateAnchor = (obs: RunObservation): Anchor => ({ oid: obs.lastNonStateOid, time: obs.lastNonStateCommit })

/**
 * Where escalation `index` was resolved: the commit in which `resolved` became
 * true, with the human's own `resolved_at` as the fallback clock.
 */
export const resolutionAnchor = (obs: RunObservation, index: number): Anchor =>
  commitAnchor(obs.resolutionCommits[index], isoSeconds(obs.state?.escalations[index]?.resolved_at))

/** Where ledger entry `index` was opened — the dispatch's own intent commit. */
export const ledgerOpenAnchor = (obs: RunObservation, index: number): Anchor =>
  commitAnchor(obs.ledgerCommits[index]?.open, isoSeconds(obs.ledger[index]?.at))

/** Where ledger entry `index` was closed — the commit that recorded its outcome. */
export const ledgerCloseAnchor = (obs: RunObservation, index: number): Anchor =>
  commitAnchor(obs.ledgerCommits[index]?.close, isoSeconds(obs.ledger[index]?.at))

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
  /** Run-relative path → oid of that same commit, for the branch-order comparisons (#346). */
  lastTouchedOid: Record<string, string | null>
  /**
   * Epoch seconds of the newest run-branch commit touching anything other
   * than `state.yaml` (#188) — the delta guard for D17's post-resolution
   * re-review: a resolution commit only ever edits state.yaml itself, so
   * without this a re-review round can dispatch against a byte-identical
   * range and burn a capped round for nothing.
   */
  lastNonStateCommit: number | null
  /** That same commit's oid (#346). */
  lastNonStateOid: string | null
  /**
   * The run branch's own order over its commits (#346) — what "after" means
   * once the three clocks that stamp these facts are allowed to disagree.
   */
  order: BranchOrder
  /**
   * Per escalation index, the state commit in which `resolved` became true, or
   * null when the history does not show the flip. This, not `resolved_at`, is
   * when a human resolved something: `resolved_at` is stamped by whichever
   * machine served the decision, and the documented topology puts that machine
   * somewhere else entirely (#346).
   */
  resolutionCommits: (CommitInfo | null)[]
  /**
   * Per ledger entry (same index as `ledger`), the state commits that opened
   * and closed it — the dispatch's intent commit and the one that recorded its
   * outcome. The landing cap counts by the first and rule D20 reads the
   * second, both by branch order rather than by the engine host's clock.
   */
  ledgerCommits: { open: CommitInfo | null; close: CommitInfo | null }[]
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
 * How a ledger entry is recognized across the history walk (#346). The engine
 * writes `at`, `role`, `task` and `round` when it opens an entry and never
 * edits them again, so together they name the same entry in every commit it
 * appears in — which is what lets the walk say where it opened and closed.
 */
const ledgerEntryKey = (e: LedgerEntry): string => `${e.at ?? ''}|${e.role}|${e.task ?? ''}|${e.round ?? ''}`

/** The inverse of `isOpenDispatch`: the outcome has landed, whatever it was. */
const isClosedEntry = (e: LedgerEntry): boolean => e.cost_usd !== null || e.failed

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
 *
 * "After" is branch order (#346): the entry's own intent commit against the
 * commit that landed the artifact. It is the *opening* commit that decides,
 * not the closing one — a dispatch that produced something opens before its
 * artifact lands and closes after it, so counting by the close would count
 * every successful dispatch as idle. The ledger's `at` and the artifact's
 * commit time remain the fallback for facts the branch cannot place.
 */
export function idleDispatchCounts(input: {
  ledger: LedgerEntry[]
  reviews: ReviewInfo[]
  taskFiles: Map<string, TaskFileInfo>
  lastTouched: Record<string, number | null>
  escalations: RunState['escalations']
  /** Branch order over the run's commits; absent → every comparison falls back to clocks. */
  order?: BranchOrder
  lastTouchedOid?: Record<string, string | null>
  /** Aligned with `ledger`. */
  ledgerCommits?: { open: CommitInfo | null; close: CommitInfo | null }[]
  /** Aligned with `escalations`. */
  resolutionCommits?: (CommitInfo | null)[]
}): Map<string, number> {
  const order = input.order ?? new BranchOrder()
  const oids = input.lastTouchedOid ?? {}
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
  // The floor is the latest of the two resetting facts, or null when neither
  // has happened — nothing to be newer than, so everything counts.
  const floors = new Map<string, Anchor | null>()
  const floorFor = (role: string, task: string | null, key: string): Anchor | null => {
    if (floors.has(key)) return floors.get(key)!
    let floor: Anchor | null = null
    const raise = (candidate: Anchor) => {
      if (!anchored(candidate)) return
      if (floor === null || after(order, candidate, floor)) floor = candidate
    }
    for (const path of expectedArtifacts(role, task)) raise({ oid: oids[path] ?? null, time: input.lastTouched[path] ?? null })
    const escalationKey = landingEscalationKey(role, task)
    input.escalations.forEach((e, i) => {
      if (!e.resolved || !e.reason.includes(escalationKey)) return
      raise(commitAnchor(input.resolutionCommits?.[i], isoSeconds(e.resolved_at)))
    })
    floors.set(key, floor)
    return floor
  }

  const counts = new Map<string, number>()
  input.ledger.forEach((entry, i) => {
    if (entry.cost_usd === null || entry.failed || entry.refused) return // closed ok only
    const opened = commitAnchor(input.ledgerCommits?.[i]?.open, isoSeconds(entry.at))
    if (!anchored(opened)) return
    const key = idleKey(entry.role, entry.task)
    const floor = floorFor(entry.role, entry.task, key)
    if (floor !== null && !after(order, opened, floor)) return
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return counts
}

export async function observeRun(source: RunSource, ref: RunRef, cfg: ObserveConfig = {}): Promise<RunObservation> {
  const { state, error } = await source.readState(ref)
  const artifacts = await source.listArtifacts(ref)

  const validations: Record<string, Validation> = {}
  const lastTouched: Record<string, number | null> = {}
  const lastTouchedOid: Record<string, string | null> = {}
  const interesting = artifacts.filter(
    (p) => ['spec.md', 'plan.md', 'verification-report.md', 'release-plan.md'].includes(p) || isTaskFile(p) || isReviewFile(p),
  )
  for (const path of interesting) {
    const content = (await source.readArtifact(ref, path)) ?? ''
    validations[path] = await validateArtifact(path, content, source.templates)
    const touched = await source.lastTouched(ref, [path])
    lastTouched[path] = touched?.time ?? null
    lastTouchedOid[path] = touched?.oid ?? null
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

  const ledger = parseLedger(state)
  const escalations = state?.escalations ?? []

  // History-derived facts, all from the one walk `stateHistory` pays for:
  // declines (which resume resets in the live entry), bounce counts (from the
  // orchestrator's own commit grammar), and — for #346 — where each escalation
  // was resolved and where each ledger entry opened and closed. Walking
  // newest→oldest, a fact's commit is the oldest one in its *trailing* run of
  // being true: keep overwriting while it holds, and settle it the moment an
  // older commit contradicts it.
  const declineEvents: RunObservation['declineEvents'] = {}
  const declineOids: Partial<Record<GateId, string>> = {}
  const bounceCounts: Record<string, number> = {}
  const ledgerCommits: RunObservation['ledgerCommits'] = ledger.map(() => ({ open: null, close: null }))
  const ledgerIndex = new Map<string, number>()
  ledger.forEach((e, i) => {
    ledgerIndex.set(ledgerEntryKey(e), i)
  })
  const closeSettled = new Set<number>()
  const history = await source.stateHistory(ref) // newest first
  // Where each escalation was resolved comes from core, so Gatehouse's
  // round-cap card and rule D4 read one definition (#346).
  const resolutionCommits = resolutionCommitsOf(history, escalations.length)
  // Where each artifact's bounce budget last reset (#348): the newest resolved
  // contract dispute naming it. "Newest" is branch order (#346): the walk below
  // runs newest-first, so a bounce commit seen before the dispute's resolution
  // commit is newer than the reset and counts; once the resolution commit is
  // reached, that artifact's budget is closed for everything older. A
  // resolution the branch cannot place (a hand-built history) falls back to
  // its `resolved_at` against the bounce commit's time.
  const disputeResolutionOids = new Map<string, string>()
  const disputeResolvedAt: Record<string, number> = {}
  escalations.forEach((esc, i) => {
    const named = esc.resolved ? CONTRACT_DISPUTE.exec(esc.reason) : null
    if (!named) return
    const artifact = named[1]!
    const commit = resolutionCommits[i]
    if (commit) {
      disputeResolutionOids.set(commit.oid, artifact)
      return
    }
    const at = esc.resolved_at ? Math.floor(Date.parse(esc.resolved_at) / 1000) : Number.NaN
    if (Number.isFinite(at) && at > (disputeResolvedAt[artifact] ?? Number.NEGATIVE_INFINITY)) disputeResolvedAt[artifact] = at
  })
  const budgetClosed = new Set<string>()
  for (const commit of history) {
    const resetFor = disputeResolutionOids.get(commit.oid)
    if (resetFor !== undefined) budgetClosed.add(resetFor)
    const bounce = /^state\([^)]+\):\s*bounced\s+(\S+)/.exec(commit.subject)
    if (bounce && !budgetClosed.has(bounce[1]!) && commit.time > (disputeResolvedAt[bounce[1]!] ?? Number.NEGATIVE_INFINITY))
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
    for (const e of parseLedger(commit.state)) {
      const i = ledgerIndex.get(ledgerEntryKey(e))
      if (i === undefined) continue
      ledgerCommits[i]!.open = commit // append-only: the oldest sighting wins
      if (closeSettled.has(i)) continue
      if (isClosedEntry(e)) ledgerCommits[i]!.close = commit
      else if (ledgerCommits[i]!.close !== null) closeSettled.add(i)
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
  const lastNonState = await source.lastTouchedExcept(ref, ['state.yaml'])

  // And one more, the cheapest of them: the log of the run directory, which is
  // the index that places all of the above on the branch (#346).
  const order = await readBranchOrder(source, ref)

  const openDispatches = ledger
    .filter((e) => e.cost_usd === null && !e.failed)
    .map((e) => ({ role: e.role, task: e.task, at: e.at }))
  const closedSum = ledger.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0)
  const ledgerSpentUsd = ledger.length > 0 ? closedSum : (state?.budget?.cost_spent_usd ?? 0)

  const idleDispatches = idleDispatchCounts({
    ledger,
    reviews,
    taskFiles,
    lastTouched,
    escalations,
    order,
    lastTouchedOid,
    ledgerCommits,
    resolutionCommits,
  })

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
    lastTouchedOid,
    lastNonStateCommit: lastNonState?.time ?? null,
    lastNonStateOid: lastNonState?.oid ?? null,
    order,
    resolutionCommits,
    ledgerCommits,
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

