// Readiness: "needs a human" is a derived fact about files, never stored
// (rule R1). One rule per row of the plan's §2.3 table:
//
//   G0 ready     phase=spec       ∧ spec.md present ∧ well-formed ∧ ¬G0
//   G1 ready     phase=plan       ∧ plan.md + tasks/* present ∧ well-formed ∧ ¬G1
//   G2 ready     phase=implement∨integrate ∧ all tasks complete ∧ reviews +
//                verification-report.md present ∧ ¬G2
//   G3 ready     phase=release    ∧ release-plan.md present ∧ ¬G3
//   Escalation   any escalations[] entry with resolved: false
//   Round-cap    any task review_rounds ≥ 3 ∧ status not complete ∧ no
//                resolution made after the latest review grants it another
//                round (#342 — the engine's rule D4 reads the same fact, and
//                "after" is branch order in both, #346)
//   Paused       phase=paused ∧ paused_reason ∉ {staged, gate-declined}
//                ∧ nothing else already speaks for the run; the card's
//                instruction is the reason's (#96): budget-exhausted says
//                raise the limit, slug-landed says close — a bare "resume"
//                on either re-pauses on the next tick. `escalation` goes one
//                level further (#348) and reads the last resolved
//                escalation's own words, because that reason covers both
//                conditions that clear themselves and ones whose only exit is
//                a hand edit of an artifact, a `profile:` or a `phase:`. The
//                instruction itself is the cockpit's, composed in web from
//                `InboxItem.paused` (#433); core states which edit is owed.
//   Staged       phase=paused ∧ paused_reason = staged — awaiting arm, not resume/kill
//   Declined     phase=paused ∧ paused_reason = gate-declined — no item at all
//   Closed       phase=closed — no item at all, whatever else the record holds
//   In flight    a gate row, but its producing role holds an OPEN ledger entry
//                opened after the packet landed — non-reviewable, no problems
//
// The last three rows are #200. A `gate-declined` run is a DECIDED run: the
// human already answered the gate, and the card it used to show told them to
// "decline the pending gate to end the run" — the very thing they had just
// done. It stays visible in the portfolio; it stops claiming to need a
// decision.
//
// `closed` is the other half, and it answers what a decline could not say: the
// record now distinguishes a pause that awaits revival from a walk-away,
// because a closure carries a typed disposition
// (already-delivered | superseded | obsolete | abandoned). It short-circuits
// before every other rule, including escalations — a human who closed a run
// has answered everything inside it, and asking them to resolve an escalation
// on a run they ended would be asking them to repeat themselves in the same
// way the declined card once did.
//
// A gate whose packet is present but malformed yields a NON-reviewable item —
// the bounce view (rule R3) — never a reviewable card.
//
// The in-flight row is #159, and it is the same refusal for a different cause.
// Decline G0 with notes and resume: the gate re-opens, the engine re-dispatches
// the analyst with those notes (ORCHESTRATOR.md §4.2, rule D9), and until the
// new spec lands every clause of "G0 ready" is still true of the old one. The
// human who had just declined was shown their own superseded artifact with an
// Approve button on it, and reasonably read that as the correction channel
// having failed. The engine's knowledge is already committed — the dispatch
// opens a ledger entry under `budget.ledger` before the agent launches, which
// is what rule D12 rests on — so reading it here costs no new state and keeps
// R1 intact: files, plus the clock, and nothing else.
//
// It is aged rather than trusted forever. An open entry older than
// `ROLE_TIMEOUT_MS` is one the engine would already have killed and swept, so
// it means the engine is gone, not that an agent is working; the gate goes back
// to reviewable with the wait said out loud, because suppressing a gate on the
// word of a dead process is the worse failure.
//
// That in-flight comparison — the open entry against the packet's landing — is
// the one recency check here still read from clocks after #346. An open entry
// has no closing commit, and placing its *opening* commit on the branch means
// walking `stateHistory` (a read per state commit) on the common path, for
// every run, on every inbox render. The honest comparison is the open commit
// against the artifact landing, and it belongs here the day the source can
// answer it without that walk. Until then the clocks in question are the engine
// host's and its own dispatch checkout's — the same machine in the blessed
// topology — while the round-cap row below compares a *human's* clock with a
// committer's, which is where the skew actually bites.
//
// Three of the facts these rules read now live in `record/schema.ts` — which
// gate is pending (`pendingGateAt`), which role produces a gate's packet
// (`gateProducer`), and whether G2's evidence has landed (`g2PacketReady`).
// The write path reads the same three for a different purpose: it refuses a
// decision about any gate but the pending one (#344), refuses an approval
// while the producer is out (#351), and lets the PR-approval sync copy an
// Approve into G2 only once G2 is genuinely on the table. One definition each
// is what stops the card a human is shown and the write the API accepts from
// disagreeing.

import { describeArtifact } from '../record/artifact.ts'
import { isOpenDispatch, parseLedger, ROLE_TIMEOUT_MS } from '../record/ledger.ts'
import { readIntake } from '../record/scaffold.ts'
import {
  BUDGET_REASON,
  bestEffortEscalations,
  CLOSED_PHASE,
  DECLINED_REASON,
  ESCALATION_REASON,
  type Escalation,
  G2_COMPLETE_STATUSES,
  type GateId,
  g2PacketReady,
  gateProducer,
  PAUSED_REASONS,
  type Profile,
  pendingGate,
  ROUND_CAP,
  type RunState,
  STAGED_REASON,
  TASK_STATUSES,
} from '../record/schema.ts'
import { type Validation, validateArtifact } from '../record/validate.ts'
import { readBranchOrder, resolutionCommitsOf } from '../sources/branch-order.ts'
import type { CommitInfo } from '../sources/git.ts'
import type { RunRef, RunSource } from '../sources/source.ts'
import { type ArtifactRef, artifactRef } from './artifact-ref.ts'
import { describeEscalation } from './escalation.ts'
import { type StateProblem, stateProblem } from './state-problem.ts'
import { formatDuration } from './time.ts'

export const GATE_QUESTIONS: Record<GateId, string> = {
  G0: 'Is this what we actually want built?',
  G1: 'Is this how we’d want it built, cut into safe parallel pieces?',
  G2: 'Does the evidence support merging?',
  G3: 'Ship it?',
}

/** In a patch run G1 absorbs the G0 question — brief and work item are approved together. */
export const PATCH_G1_QUESTION = 'Is this the change we want, scoped this way?'

export type InboxKind = 'gate' | 'escalation' | 'round-cap' | 'paused' | 'staged' | 'malformed'

/**
 * What the producing role is doing while a gate waits (#159, #433): it holds
 * an open ledger entry opened after the packet landed. `lost` is the entry
 * aged past `ROLE_TIMEOUT_MS` — the engine would already have swept it, so
 * the wait is said, not obeyed, and the gate stays reviewable.
 */
export interface WaitingOn {
  role: string
  /** Epoch seconds: the dispatch's own `at`. */
  since: number
  /** The artifact the role is re-producing. */
  artifact: ArtifactRef
  lost: boolean
}

/**
 * One artifact that fails the gate's packet contract (R3, #433). The facts a
 * bounce view composes its line from; the view writes the sentence.
 */
export interface BounceFact {
  artifact: ArtifactRef
  /** Run-relative path: the Address. */
  path: string
  /** The contract's own name for the kind (`spec`, `work item`), or null. */
  contractName: string | null
  /** Required sections (markdown) or keys (YAML) absent, as the contract spells them. */
  missing: string[]
  /** What `missing` names: a markdown contract's sections, a YAML contract's keys. */
  unit: 'sections' | 'keys'
  /** The artifact is not in the run directory at all; `missing` is then empty. */
  absent: boolean
}

/**
 * An open escalation, as facts (#433). `reason` is the entry's own line,
 * verbatim — the engine's words, or the role's. What core used to add around
 * it (a composed title, the line reused as a row's detail) is gone; a view
 * composes its own line from `role` and `about`.
 */
export interface EscalationFact {
  /** Who escalated, per the reason line; else the entry's `from_role`; else null. */
  role: string | null
  /** What the escalation is about, when the reason line names it. */
  about: { task: string } | { gate: GateId } | null
  /** The report the reason line points at, when the record has it. */
  artifact: ArtifactRef | null
  /** The entry's `reason`, byte for byte. */
  reason: string
  /**
   * The line is a role's pointer and nothing more — `<role> escalated [task
   * <id>] — see <report>` (rule D17's template) — so the report is the
   * substance and the line is not (docs/SEAM.md §3). False for every other
   * line, including ones that merely mention a file: D23's `… acknowledge to
   * proceed (see plan.md's dated ADR)` carries an instruction, and D24's
   * `verifier escalated — a failure traces to the spec, plan, or gate
   * process, not the implementation; see verification-report.md` carries a
   * claim the report's own section need not restate — both are substance.
   */
  pointer: boolean
}

/**
 * The hand edit a pause for `escalation` is waiting on (#348), read from the
 * last resolved escalation's own words. Null when the words name none.
 */
export type HandEdit =
  | { kind: 'contract-dispute'; artifact: ArtifactRef }
  | { kind: 'profile-violation'; profile: Profile }
  | { kind: 'no-task-files' }
  | { kind: 'unknown-status'; task: string; status: string; known: string[] }

/** A paused run, as facts (#433). The instruction is the view's. */
export interface PausedFact {
  /** The recorded `paused_reason`, verbatim, or null when none is recorded. */
  reason: string | null
  /**
   * `reason` is not one of the engine's tokens (`PAUSED_REASONS`): a human's
   * free-text hold reason (approve-and-hold), to be quoted as a passage
   * rather than as a token.
   */
  freeText: boolean
  /**
   * The engine's own line for the pause, verbatim, when the record has it:
   * for `budget-exhausted`, the newest escalation rule DB wrote (it pauses on
   * *projected* spend, which the counts alone would misstate); for
   * `escalation`, the last resolved escalation's line. Null otherwise.
   */
  cause: string | null
  /** `budget.cost_spent_usd` and `budget.cost_limit_usd`, as recorded; null when the run has no budget. */
  budget: { spent: number | null; limit: number | null } | null
  /** For reason `escalation`: the hand edit owed, or null. */
  handEdit: HandEdit | null
}

/** A staged, unarmed run, as facts (#433). */
export interface StagedFact {
  /** `intake.staged_by`, else the author of the run's first commit (the staging commit), else null. */
  by: string | null
  /** Epoch seconds of the run's first commit (the staging commit), or null. */
  at: number | null
  profile: Profile
  /** `budget.cost_limit_usd`: what arming lets the run spend. Null = no ceiling. */
  budgetCeiling: number | null
}

/** A round-cap breach, as facts (#433). */
export interface RoundCapFact {
  task: string
  rounds: number
  cap: number
}

export interface InboxItem {
  kind: InboxKind
  gate: GateId | null
  source: string
  slug: string
  /**
   * Kept for one release (#411 step 8): sentences core composed for the inbox
   * row, which every surface then reused. Nothing in web or the CLI reads
   * them; views compose their own lines from the facts below.
   */
  title: string
  /** Kept for one release (#411 step 8) — see `title`. */
  detail: string
  /** kind=gate: the gate's question, from the profile's gate table. Null on every other kind. */
  question: string | null
  /** kind=gate: the producing role holding an open dispatch newer than the packet, or null. */
  waitingOn: WaitingOn | null
  /** kind=gate: true when `waitingOn` is in flight — the packet on the card is about to be replaced (#159). */
  superseded: boolean
  /** kind=gate: the packet's artifacts that fail their contract (R3), or null when none does. */
  bouncedBy: BounceFact[] | null
  /** kind=escalation: the entry as facts. */
  escalation: EscalationFact | null
  /** kind=paused: the pause as facts. */
  paused: PausedFact | null
  /** kind=staged: the staging as facts. */
  staged: StagedFact | null
  /** kind=round-cap: the breach as facts. */
  roundCap: RoundCapFact | null
  /**
   * kind=malformed: why no state came of `state.yaml`, as a fact (#435). Only
   * its `parser` case carries words, and they are the parser's; `problems`
   * holds the same diagnostic for the CLI and the bounce contract.
   */
  unreadable: StateProblem | null
  /** Epoch seconds when this began waiting (commit time of the trigger), or null. */
  since: number | null
  /**
   * False → the card offers no decision. Two causes, told apart by `problems`:
   * a non-empty `problems` is the bounce view (R3, the packet fails its
   * contract); an empty one alongside `inflight` is the producer being out
   * (#159).
   */
  reviewable: boolean
  problems: string[]
  /**
   * The gate's producing role holds an open ledger entry opened after the
   * packet landed: a new artifact is coming and this one is superseded (#159).
   * `since` is epoch seconds, the dispatch's own `at`. Null on every other
   * item, and on a gate whose producer is at rest.
   */
  inflight: { role: string; since: number } | null
  /**
   * Run-relative artifact paths that make up the card's packet.
   *
   * Kept for one release beside `packetRefs` (docs/SEAM.md §8.5): the wire
   * change is additive, and the views move off paths in their own changes.
   * New code reads `packetRefs`.
   */
  packet: string[]
  /**
   * The packet as references, one per `packet` path and in its order (#415).
   * Attached once, from `packet`, as `deriveReadiness` returns — so the two
   * can never disagree. Built from the path alone, so a review's `reviewOf`
   * is null; the run detail route resolves it against the run's reports.
   */
  packetRefs: ArtifactRef[]
  /** Escalation index into state.escalations, when kind=escalation. */
  escalationIndex: number | null
  /** kind=paused: the recorded reason, so the resume affordance can ask for what the reason needs (#96). */
  pausedReason?: string | null
  /** kind=paused: the run's current `budget.cost_limit_usd`, for a resume that must raise it (#96). */
  costLimitUsd?: number | null
}

export interface RunReadiness {
  items: InboxItem[]
  /** Validation results per artifact examined (path → validation). */
  validations: Record<string, Validation>
}

const isTaskFile = (p: string) => describeArtifact(p).kind === 'work-item'
const isReviewFile = (p: string) => describeArtifact(p).kind === 'review-report'
/** An item as it is derived, before its packet is given as references. */
type DerivedItem = Omit<InboxItem, 'packetRefs'>

function taskComplete(status: string): boolean {
  return G2_COMPLETE_STATUSES.has(status)
}

/**
 * When `role` was last dispatched and not yet closed, in epoch milliseconds, or
 * null if it is at rest. Only entries opened *after* the packet landed count: an
 * older open entry is the dispatch that produced the packet, left unclosed, and
 * reading it as a re-dispatch would suppress every gate the engine ever missed
 * closing. `packetAt` is epoch seconds, or null when no commit could be found
 * for the trigger — an unknown packet time is not evidence either way, so every
 * open entry counts there.
 */
function openDispatchAt(state: RunState, role: string, packetAt: number | null): number | null {
  const after = (packetAt ?? -Infinity) * 1000
  let newest: number | null = null
  for (const entry of parseLedger(state)) {
    if (entry.role !== role || !isOpenDispatch(entry) || entry.at === null) continue
    const at = Date.parse(entry.at)
    if (!Number.isFinite(at) || at <= after) continue
    if (newest === null || at > newest) newest = at
  }
  return newest
}

/**
 * The escalation reasons whose only exit is a hand edit (#348), matched on the
 * words the engine writes rather than on a rule id — the rule id is not in the
 * record, only the sentence is.
 *
 * These substrings are a contract with `orchestrator/src/derive.ts`, which
 * composes the reasons (rules D8, D21, D4). Core cannot import them: the
 * layering runs record → sources → view-model and nothing here points at the
 * orchestrator. So they are duplicated deliberately, kept to the most stable
 * fragment of each sentence, and noted at both ends — reword a reason there
 * and the card here quietly falls back to the generic line.
 */
const HAND_EDIT_ESCALATIONS = {
  /** D8: `<artifact> bounced N× and is still malformed — contract dispute …` */
  contractDispute: /^(\S+) bounced \d+× and is still malformed\b/,
  /** D21: `gate G1 is decided but does not exist in profile patch …` / `phase "release" does not exist in profile …` */
  profileViolation: /does not exist in profile\b/,
  /** D4: `phase is implement but the run has no task files …` */
  noTaskFiles: /has no task files\b/,
  /** D4: `task 01-core has status "wat" the derivation table has no rule for` */
  unknownStatus: /^task (\S+) has status "([^"]*)" the derivation table has no rule for\b/,
}

/**
 * The escalation whose resolution left the run paused: the newest resolved
 * one. A paused card with reason `escalation` only ever renders once every
 * escalation is resolved (an unresolved one speaks for itself, above), so the
 * thing the human still has to do is whatever that last one pointed at.
 */
function lastResolved(state: RunState): string | null {
  let reason: string | null = null
  let at = Number.NEGATIVE_INFINITY
  for (const esc of state.escalations) {
    if (!esc.resolved) continue
    const t = esc.resolved_at ? Date.parse(esc.resolved_at) : Number.NaN
    // Undated resolutions still count, in record order, so a hand-resolved
    // escalation is not silently ignored.
    const key = Number.isNaN(t) ? at : t
    if (key >= at) {
      at = key
      reason = esc.reason
    }
  }
  return reason
}

/**
 * Whether a human has already granted this task another round past the cap
 * (#342) — the readiness half of the engine's rule D4.
 *
 * The engine's round-cap escalation names the task as `task <id>:`, and a
 * resolution of it made after the latest review is what lets D4 stand down and
 * the loop dispatch round n+1. `since` is the commit that landed that review;
 * an unknown one is not evidence either way, so nothing counts.
 *
 * "After" is branch order, exactly as the engine reads it (#346): the commit
 * where `resolved` became true, against the review's own commit. Comparing
 * `resolved_at` — stamped by whichever machine served the human's decision —
 * with a committer's clock made this card and rule D4 disagree under a second
 * of skew, which is the one thing the two surfaces must never do. The clocks
 * remain the fallback for a run whose history could not be read.
 *
 * Reading the history costs a walk, so it happens only here, behind a cap
 * breach that most runs never have.
 */
async function grantedAnotherRound(
  source: RunSource,
  ref: RunRef,
  state: RunState,
  task: string,
  since: CommitInfo | null,
): Promise<boolean> {
  if (!since) return false
  const candidates = state.escalations
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.resolved && e.reason.includes(`task ${task}:`))
  if (candidates.length === 0) return false
  const [order, history] = await Promise.all([readBranchOrder(source, ref), source.stateHistory(ref)])
  const resolutionCommits = resolutionCommitsOf(history, state.escalations.length)
  return candidates.some(({ e, index }) => {
    const at = resolutionCommits[index]
    const byBranch = order.after(at?.oid ?? null, since.oid)
    if (byBranch !== null) return byBranch
    const stamped = e.resolved_at ? Date.parse(e.resolved_at) : Number.NaN
    return Number.isFinite(stamped) && stamped / 1000 > since.time
  })
}

/**
 * A paused run as facts (#96, #348, #433). The instruction that says what
 * clears the pause is the cockpit's, composed in web per reason; core states
 * the reason, the budget, and — for `escalation` — which hand edit is owed.
 *
 * `escalation` is the hardest reason (#348), because it does not name a
 * condition at all — only that a human is owed. Some of what it stands for
 * clears itself; some of it (a contract dispute, a profile violation, a
 * breakdown that never landed) has no exit but a hand edit, and there a
 * resume is a closed loop: resolving is an acknowledgment, the engine
 * re-derives from files nobody changed, and the run re-pauses within a tick.
 * So core reads the resolved escalation's own words and names the edit.
 */
export function pausedFacts(state: RunState): PausedFact {
  const budget = state.budget ? { spent: state.budget.cost_spent_usd, limit: state.budget.cost_limit_usd } : null
  const reason = state.paused_reason
  const cause =
    reason === BUDGET_REASON
      ? ([...state.escalations].reverse().find((e) => BUDGET_ESCALATION.test(e.reason))?.reason ?? null)
      : reason === ESCALATION_REASON
        ? lastResolved(state)
        : null
  return {
    reason,
    freeText: reason !== null && !(PAUSED_REASONS as readonly string[]).includes(reason),
    cause,
    budget,
    handEdit: reason === ESCALATION_REASON ? handEditOf(state) : null,
  }
}

/**
 * Rule DB's line (`projected spend $… (ledger $… + estimates) exceeds
 * cost_limit_usd $… — pausing rather than degrading`), matched on its most
 * stable fragment — the same deliberate duplication, with the same caveat, as
 * HAND_EDIT_ESCALATIONS above.
 */
const BUDGET_ESCALATION = /\bexceeds cost_limit_usd\b/

/** The hand edit the last resolved escalation names, or null (#348). */
function handEditOf(state: RunState): HandEdit | null {
  const reason = lastResolved(state)
  if (reason === null) return null
  const dispute = HAND_EDIT_ESCALATIONS.contractDispute.exec(reason)
  if (dispute) return { kind: 'contract-dispute', artifact: artifactRef(dispute[1]!) }
  if (HAND_EDIT_ESCALATIONS.profileViolation.test(reason)) return { kind: 'profile-violation', profile: state.profile }
  if (HAND_EDIT_ESCALATIONS.noTaskFiles.test(reason)) return { kind: 'no-task-files' }
  const status = HAND_EDIT_ESCALATIONS.unknownStatus.exec(reason)
  if (status) return { kind: 'unknown-status', task: status[1]!, status: status[2]!, known: [...TASK_STATUSES] }
  return null
}

/** The item's facts, all absent — each builder below sets its own kind's. */
const NO_FACTS = {
  question: null,
  waitingOn: null,
  superseded: false,
  bouncedBy: null,
  escalation: null,
  paused: null,
  staged: null,
  roundCap: null,
  unreadable: null,
} as const satisfies Partial<InboxItem>

/** `task <id>:` (the engine's round-cap and routing lines), `gate G<n> …` (D21). */
/**
 * The engine's stable shapes for naming a task (`orchestrator/src/derive.ts`,
 * the keys its own resolution checks match on — as stable as the engine can
 * make them):
 *   `task <id>:`                 D4 round cap, D23, the routing lines
 *   `<role> (<id>) failed …`     D20, a dispatch that failed twice
 *   `<role> on <id> returned …`  DL, the landing cap
 * and `gate G<n> …` for D21's gate half.
 */
const ABOUT_TASK = [/^task (\S+?):?\s/, /^\S+ \((\S+)\) failed\b/, /^\S+ on (\S+) returned\b/]
const ABOUT_GATE = /^gate (G[0-3])\b/
/** D17's template, and nothing else: a role pointing at its report. */
const ROLE_POINTER = /^\S+ escalated(?: task \S+)? — see (\S+\.md)$/

/** An open escalation's facts, from its entry and the run's artifacts (#433). Pure. */
export function escalationFact(reason: string, fromRole: string | null, artifacts: readonly string[]): EscalationFact {
  const origin = describeEscalation(reason, fromRole, artifacts)
  const pointed = ROLE_POINTER.exec(reason)?.[1] ?? null
  return {
    role: origin.role ?? fromRole ?? null,
    about: aboutOf(reason, origin.task),
    artifact: origin.artifact ? artifactRef(origin.artifact) : null,
    reason,
    pointer: pointed !== null && pointed === origin.artifact,
  }
}

/** What an escalation is about, when its reason line names it. */
function aboutOf(reason: string, task: string | null): EscalationFact['about'] {
  const named = task ?? ABOUT_TASK.map((re) => re.exec(reason)?.[1]).find((t) => t !== undefined) ?? null
  if (named !== null) return { task: named }
  const gate = ABOUT_GATE.exec(reason)?.[1] as GateId | undefined
  return gate ? { gate } : null
}

/**
 * Unresolved escalations as inbox items — shared by the well-formed path below
 * and the best-effort read of a malformed run's own `escalations:` key (#49),
 * so the two render identically. `escalationIndex` addresses `state.escalations`
 * for the write path, which still requires the whole file to parse: resolving
 * one of these on a run that is otherwise malformed meets the API's own
 * "run state is malformed" refusal, same as any other write to it would.
 */
function escalationItems(ref: RunRef, escalations: Escalation[], artifacts: readonly string[] = []): DerivedItem[] {
  const items: DerivedItem[] = []
  escalations.forEach((esc, i) => {
    if (esc.resolved) return
    const since = esc.at ? Math.floor(Date.parse(esc.at) / 1000) || null : null
    // Who is asking, not who wrote the entry (#407): the engine records
    // every escalation under its own identity, and the reason line names
    // the role that escalated. The human reads the asker; History keeps the
    // writer. The packet is the report the reason names, when the record
    // has it — `state.yaml` is the resolution's write target, not reading.
    const origin = describeEscalation(esc.reason, esc.from_role, artifacts)
    const fact = escalationFact(esc.reason, esc.from_role, artifacts)
    items.push({
      kind: 'escalation',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: `Escalation from ${fact.role ?? 'unknown role'}`,
      detail: esc.reason,
      ...NO_FACTS,
      escalation: fact,
      since,
      reviewable: true,
      problems: [],
      packet: origin.artifact ? [origin.artifact] : [],
      inflight: null,
      escalationIndex: i,
    })
  })
  return items
}

export async function deriveReadiness(source: RunSource, ref: RunRef): Promise<RunReadiness> {
  const { items, validations } = await deriveItems(source, ref)
  return { items: items.map((item) => ({ ...item, packetRefs: item.packet.map((p) => artifactRef(p)) })), validations }
}

async function deriveItems(source: RunSource, ref: RunRef): Promise<{ items: DerivedItem[]; validations: Record<string, Validation> }> {
  const items: DerivedItem[] = []
  const validations: Record<string, Validation> = {}
  const read = await source.readState(ref)
  const { state, error, raw } = read

  if (!state) {
    const touched = await source.lastTouched(ref, ['state.yaml'])
    const unreadable = stateProblem(read)
    items.push({
      kind: 'malformed',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: 'Malformed run state',
      // Kept for one release (#411 step 8); nothing reads it.
      detail: error ?? 'Malformed run state',
      ...NO_FACTS,
      unreadable,
      since: touched?.time ?? null,
      reviewable: false,
      // The parser's diagnostic only (#435): a sentence nobody parsed is not
      // one to set under the parser's name.
      problems: unreadable?.kind === 'parser' ? [unreadable.diagnostic] : [],
      packet: ['state.yaml'],
      inflight: null,
      escalationIndex: null,
    })
    // Best-effort (#49): the rest of the file failed the contract, but an
    // unresolved escalation is worth surfacing on its own — read
    // independently, never guessed at, and it changes nothing about the run
    // still being loudly malformed above.
    items.push(...escalationItems(ref, raw ? bestEffortEscalations(raw) : []))
    return { items, validations }
  }

  // A closed run needs nothing from anyone — including the escalations and
  // round caps below, which a closure answers wholesale rather than one by one.
  if (state.phase === CLOSED_PHASE) return { items, validations }

  const artifacts = await source.listArtifacts(ref)
  const has = (p: string) => artifacts.includes(p)
  const validate = async (path: string): Promise<Validation> => {
    const content = (await source.readArtifact(ref, path)) ?? ''
    const v = await validateArtifact(path, content, source.templates)
    validations[path] = v
    return v
  }

  // --- Escalations (surface regardless of phase; a stalled run burns calendar).
  items.push(...escalationItems(ref, state.escalations, artifacts))

  // --- Round-cap breaches.
  for (const task of state.tasks) {
    if (task.review_rounds >= ROUND_CAP && !taskComplete(task.status)) {
      const reviewFiles = artifacts.filter(isReviewFile)
      const touched = await source.lastTouched(ref, reviewFiles.length ? reviewFiles : ['state.yaml'])
      // The engine's own exit from the cap, read here so the two surfaces
      // agree (#342): a resolution newer than the latest review is a human
      // granting the loop another round, and rule D4 stands down on it. Asking
      // again on this card would ask for a decision that has been made — and
      // the loop is moving, so there is nothing to decide until the next
      // verdict past the cap lands and D4 raises it afresh.
      if (await grantedAnotherRound(source, ref, state, task.id, touched)) continue
      items.push({
        kind: 'round-cap',
        gate: null,
        source: ref.source,
        slug: ref.slug,
        title: `Round cap reached: ${task.id}`,
        detail: `${task.review_rounds} review rounds without convergence — usually a spec ambiguity, not an implementation defect`,
        ...NO_FACTS,
        roundCap: { task: task.id, rounds: task.review_rounds, cap: ROUND_CAP },
        since: touched?.time ?? null,
        reviewable: true,
        problems: [],
        packet: [...reviewFiles, ...(has('spec.md') ? ['spec.md'] : []), ...(has('plan.md') ? ['plan.md'] : [])],
        inflight: null,
        escalationIndex: null,
      })
    }
  }

  // --- Paused runs need a resume/kill decision — unless the rest state is
  // "staged" (ADR-4): a staged-but-unarmed run never had a resume/kill
  // choice to begin with, so it gets its own kind rather than a 'paused'
  // item whose only affordance (Resume) is a guaranteed DecisionError.
  if (state.phase === 'paused') {
    const touched = await source.lastTouched(ref, ['state.yaml'])
    if (state.paused_reason === STAGED_REASON) {
      // The staging commit is the run's first: `gateline new` mints the
      // branch with it, authored by the human who staged (commit authorship
      // is authoritative, scaffold.ts). `runHistory` is newest first; a
      // driver with no history to walk leaves both facts unknown.
      const genesis = source.runHistory ? ((await source.runHistory(ref)).at(-1) ?? null) : null
      items.push({
        kind: 'staged',
        gate: null,
        source: ref.source,
        slug: ref.slug,
        title: 'Run staged: awaiting arm',
        detail: 'Arm to start the run — dispatch begins and the budget starts metering',
        ...NO_FACTS,
        staged: {
          by: readIntake(state)?.staged_by ?? genesis?.author ?? null,
          at: genesis?.time ?? null,
          profile: state.profile,
          budgetCeiling: state.budget?.cost_limit_usd ?? null,
        },
        since: touched?.time ?? null,
        reviewable: true,
        problems: [],
        packet: ['state.yaml', 'intent-brief.md'],
        inflight: null,
        escalationIndex: null,
      })
      return { items, validations }
    }
    // A declined gate is an answered gate (#200). Offering "resume or decline"
    // to a human who already declined is asking them to repeat themselves.
    if (state.paused_reason === DECLINED_REASON) return { items, validations }
    // Nor does the run need a second card restating a need another item
    // already carries: a run paused *for* an escalation or a round cap is
    // unblocked by resolving that, which is the item already above.
    if (items.length > 0) return { items, validations }
    items.push({
      kind: 'paused',
      gate: null,
      source: ref.source,
      slug: ref.slug,
      title: `Run paused: ${state.paused_reason ?? 'no reason recorded'}`,
      // The instruction moved to web (#433); the kept field states the token.
      detail: `paused_reason: ${state.paused_reason ?? 'null'}`,
      ...NO_FACTS,
      paused: pausedFacts(state),
      since: touched?.time ?? null,
      reviewable: true,
      problems: [],
      packet: ['state.yaml'],
      inflight: null,
      escalationIndex: null,
      pausedReason: state.paused_reason,
      costLimitUsd: state.budget?.cost_limit_usd ?? null,
    })
    return { items, validations }
  }

  // --- The gate on the table for this phase, if its packet has landed.
  const gate = pendingGate(state)
  if (!gate) return { items, validations }

  const problems: string[] = []
  const bounces: BounceFact[] = []
  /** The brief is the packet's first half at G0 and patch G1; without it there is nothing to approve. */
  const briefAbsent = () => {
    problems.push('intent-brief.md missing from run directory')
    const artifact = artifactRef('intent-brief.md')
    bounces.push({ artifact, path: artifact.path, contractName: artifact.contractName, missing: [], unit: 'sections', absent: true })
  }
  let packet: string[] = []
  let trigger: string[] = []
  let ready = false

  if (gate === 'G0') {
    packet = ['intent-brief.md', 'spec.md']
    trigger = ['spec.md']
    ready = has('spec.md')
    if (ready && !has('intent-brief.md')) briefAbsent()
  } else if (gate === 'G1' && state.profile === 'patch') {
    // Patch: no plan.md — G1 approves the human-authored brief + work item together.
    const tasks = artifacts.filter(isTaskFile)
    packet = ['intent-brief.md', ...tasks]
    trigger = ['intent-brief.md', 'tasks']
    ready = tasks.length > 0
    if (ready && !has('intent-brief.md')) briefAbsent()
  } else if (gate === 'G1') {
    const tasks = artifacts.filter(isTaskFile)
    packet = ['plan.md', ...tasks]
    trigger = ['plan.md', 'tasks']
    ready = has('plan.md') && tasks.length > 0
  } else if (gate === 'G2') {
    // Patch: no verifier — the reviews are the whole G2 packet.
    const reviews = artifacts.filter(isReviewFile)
    const verification = state.profile === 'patch' ? [] : ['verification-report.md']
    packet = [...reviews, ...verification]
    trigger = [...reviews, ...verification]
    ready = g2PacketReady(state, artifacts)
  } else {
    packet = ['release-plan.md']
    trigger = ['release-plan.md']
    ready = has('release-plan.md')
  }

  if (!ready) return { items, validations } // agents still working; nothing to review

  for (const path of packet) {
    if (!has(path)) continue
    const v = await validate(path)
    if (v.ok) continue
    const unit = v.contract === 'work-item.yaml' ? 'keys' : 'sections'
    problems.push(`${path}: missing required ${unit} — ${v.missing.join(', ')}`)
    const artifact = artifactRef(path)
    bounces.push({ artifact, path, contractName: artifact.contractName, missing: [...v.missing], unit, absent: false })
  }

  const touched = await source.lastTouched(ref, trigger)

  // The producing role, if it is out (#159). Consulted only for a well-formed
  // packet: a bounced one already says the true thing — the artifacts fail
  // their contract — and `problems` is what tells the two refusals apart, so
  // the bounce view keeps the card unchanged.
  const producer = problems.length === 0 ? gateProducer(gate, state.profile) : null
  const openAt = producer ? openDispatchAt(state, producer.role, touched?.time ?? null) : null
  const openAgeMs = openAt === null ? 0 : Date.now() - openAt
  const inflight =
    openAt !== null && openAgeMs < ROLE_TIMEOUT_MS ? { role: producer!.role, since: Math.floor(openAt / 1000) } : null
  const waitingOn: WaitingOn | null =
    openAt === null
      ? null
      : { role: producer!.role, since: Math.floor(openAt / 1000), artifact: artifactRef(producer!.artifact), lost: inflight === null }

  // Kept for one release (#411 step 8); views compose from the facts.
  let detail: string
  if (problems.length) detail = 'Packet malformed — bounced, not reviewable'
  else if (inflight)
    detail =
      `${producer!.role} was re-dispatched after ${producer!.artifact} landed — a new one is pending, ` +
      `so the ${gate} packet on this card is superseded`
  else if (openAt !== null)
    detail =
      `${producer!.role} was re-dispatched ${formatDuration(openAgeMs / 1000)} ago and has not landed ` +
      `${producer!.artifact} — the engine ages out a lost dispatch; review what is here, or wait`
  else detail = `${ref.slug} is waiting on ${gate}`

  const question = state.profile === 'patch' && gate === 'G1' ? PATCH_G1_QUESTION : GATE_QUESTIONS[gate]
  items.push({
    kind: 'gate',
    gate,
    source: ref.source,
    slug: ref.slug,
    title: `${gate} — ${question}`,
    detail,
    ...NO_FACTS,
    question,
    waitingOn,
    superseded: inflight !== null,
    bouncedBy: bounces.length > 0 ? bounces : null,
    since: touched?.time ?? null,
    reviewable: problems.length === 0 && inflight === null,
    problems,
    packet,
    inflight,
    escalationIndex: null,
  })
  return { items, validations }
}
