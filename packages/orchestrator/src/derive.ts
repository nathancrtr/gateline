// The dispatch half of the readiness dual (docs/ORCHESTRATOR.md §4.2): the
// frontend's readiness table derives *needs a human* from files; this one
// derives *needs a dispatch*. A run deriving as neither is at rest — gate
// waits, unresolved escalations, and pauses are all rest states, which is why
// a stateless orchestrator can hold them indefinitely for free.
//
// One rule per row; each row has a test in test/derive.test.ts:
//
//   D0  state.yaml malformed                         → rest (frontend inbox owns it)
//   D1  phase done                                   → rest
//   D2  phase paused                                 → rest (resume is a human decision)
//   D3  unresolved escalation                        → rest (a human owns the run)
//   D4  task rounds ≥ cap, task not complete,
//       latest verdict not approve                   → escalate + pause round-cap
//   D5  gate approved but phase not advanced         → record phase advance
//   D6  producer artifact absent                     → dispatch the producing role
//   D7  producer artifact malformed, bounces < 2     → bounce (re-dispatch naming missing sections)
//   D8  same artifact bounced twice                  → escalate + pause (contract dispute)
//   D9  gate declined since artifact last landed     → re-dispatch producer with the decline notes
//   D10 artifact well-formed, gate undecided         → rest (the inbox surfaces it)
//   D11 eligible pending tasks                       → dispatch parallel implementer set (disjoint surfaces only)
//   D12 task dispatched / in-progress                → rest for that task (in flight; the heartbeat ages staleness)
//   D13 task in-review, no review for current round  → dispatch reviewer
//   D14 request-changes, implementer not responded   → dispatch implementer, round n+1, with the report
//   D15 request-changes, implementer responded       → dispatch reviewer (verify round)
//   D16 latest verdict approve                       → record task status review-approved
//   D17 reviewer verdict escalate                    → escalate + pause; the LATEST resolution
//       newer than the verdict routes by its disposition (#189, #190): `re-review` dispatches the
//       re-review round immediately, an explicit human override of the #188 zero-delta guard;
//       `return-to-implement` mirrors D14/D15's turn-taking off the resolution's timestamp;
//       `re-plan` sends the finding to the architect's amendment mode — see D22/D23; absent
//       disposition → legacy behavior, gated on a non-state.yaml commit newer than the
//       verdict (dispatch re-review) or rest naming the fix still to land (#188)
//   D18 all tasks review-approved+, no verification  → dispatch verifier
//   D19 phase implement, state lists no tasks        → record: seed tasks[] from tasks/*.yaml (the v0 human's mirror step)
//   D20 task failed (implementer failed twice); the naming escalation resolved
//       after the last failure → record status pending (a fresh round
//       supersedes); unresolved or stale → rest naming the frozen task
//   D21 profile invariant violated: a decided gate outside the run's profile
//       (mid-run downgrade), a phase outside the profile's sequence, or a
//       patch run with no work item                  → escalate + pause
//   D22 D17 resolution disposition `re-plan`, no amendment landed yet (#190) → dispatch the
//       architect in amendment mode, carrying the review report path and the resolution note;
//       an architect already in flight rests instead (D12 shape)
//   D23 D17 resolution disposition `re-plan`, amendment landed since resolved_at (plan.md or a
//       tasks/*.yaml touched newer, #190) → raise a fresh escalation naming `task <id>` and
//       pause for human acknowledgment; its resolution (typically `return-to-implement`) is
//       just another resolution matching that same `task <id>` text, so "latest matching
//       resolution" (D17) picks it up and routes through #189's machinery unchanged
//   DB  any dispatch would exceed the budget cap     → escalate + pause budget-exhausted
//       (skipped when budget enforcement is off, #109 — metering still happens)
//
// The whole table is parameterized by the run's profile (DESIGN.md §4.1):
// reduced profiles subset the gates (PROFILE_GATES), G2 advances to done
// rather than release, and in `patch` the plan phase has no producing role —
// the human authored the packet, so there is no one to dispatch or bounce to.
//
// The whole table is parameterized by the run's profile (DESIGN.md §4.1):
// reduced profiles subset the gates (PROFILE_GATES), G2 advances to done
// rather than release, and in `patch` the plan phase has no producing role —
// the human authored the packet, so there is no one to dispatch or bounce to.
//
// Two invariants govern every row (§4.2): each action is derivable from
// committed files alone, and each action is idempotent to re-derive — a tick
// interrupted anywhere converges on re-run. Note what is deliberately absent:
// no rule writes gates.* (§3, structural safety) and no rule judges artifact
// content — task status `verified` is a human/G2 judgment, never derived.
import { G2_COMPLETE_STATUSES, GATE_IDS, GATE_PHASES, PROFILE_GATES, PROFILE_PHASES, gateUndecided, phaseAfterGate, type GateId, type Phase } from '@gateline/core/record'
import type { RunObservation } from './observe.ts'

export const ROUND_CAP = 3
export const BOUNCE_CAP = 2
/** Conservative fallback when the registry carries no estimate for a role. */
export const DEFAULT_ESTIMATE_USD = 5

export const ROLES = ['analyst', 'architect', 'implementer', 'reviewer', 'verifier', 'ops'] as const
export type Role = (typeof ROLES)[number]

/** What each gate's packet producer is, for the producer-phase rules. */
export const GATE_PRODUCER: Record<GateId, { role: Role; artifact: string }> = {
  G0: { role: 'analyst', artifact: 'spec.md' },
  G1: { role: 'architect', artifact: 'plan.md' },
  G2: { role: 'verifier', artifact: 'verification-report.md' }, // G2's tail producer; tasks flow separately
  G3: { role: 'ops', artifact: 'release-plan.md' },
}

export type Bounce =
  | { kind: 'malformed'; artifact: string; missing: string[] }
  | { kind: 'gate-declined'; gate: GateId; notes: string | null }
  | { kind: 'review'; report: string }
  /**
   * Amendment-mode architect dispatch (#190, disposition `re-plan`): the
   * review report the finding lives in, the resolving human's note, and the
   * task whose surface may need widening — named so the reason-matching
   * convention (`task <id>`) that D17/D20 already key on stays intact when
   * the amendment lands and a fresh acknowledgment escalation is raised.
   */
  | { kind: 'amendment'; report: string; note: string; task: string }

export interface DispatchIntent {
  role: Role
  /** Task id for task-scoped roles (implementer, reviewer); null otherwise. */
  task: string | null
  /** Review round this dispatch participates in, when task-scoped. */
  round: number | null
  bounce: Bounce | null
  reason: string
}

export type Bookkeeping =
  | { field: 'phase'; to: Phase }
  | { field: 'task-status'; task: string; to: string }
  | { field: 'review-rounds'; task: string; to: number }
  | { field: 'seed-tasks'; ids: string[] }

export type DerivedAction =
  | { kind: 'rest'; rule: string; why: string }
  | { kind: 'dispatch'; rule: string; dispatches: DispatchIntent[]; why: string }
  | { kind: 'record'; rule: string; updates: Bookkeeping[]; why: string }
  | { kind: 'escalate'; rule: string; reason: string; pause: string | null; why: string }

const rest = (rule: string, why: string): DerivedAction => ({ kind: 'rest', rule, why })
const record = (rule: string, updates: Bookkeeping[], why: string): DerivedAction => ({ kind: 'record', rule, updates, why })
const escalate = (rule: string, reason: string, pause: string | null): DerivedAction => ({
  kind: 'escalate',
  rule,
  reason,
  pause,
  why: reason,
})

export function deriveAction(obs: RunObservation): DerivedAction {
  const { state } = obs
  if (!state) return rest('D0', `state.yaml malformed — a human owns it (${obs.stateError ?? 'unreadable'})`)
  if (state.phase === 'done') return rest('D1', 'run complete')
  // A closure is a human's decision that the run ends here (#200) — the engine
  // rests on it exactly as it rests on `done`, and ahead of the escalation and
  // round-cap checks below, which a closure answers wholesale.
  if (state.phase === 'closed')
    return rest('D1', `closed as ${state.closure?.as ?? 'unknown'} by ${state.closure?.by ?? 'a human'} — the run's record is final`)
  if (state.phase === 'paused')
    return rest('D2', `paused (${state.paused_reason ?? 'no reason recorded'}) — resume is a human decision`)
  if (state.escalations.some((e) => !e.resolved)) return rest('D3', 'unresolved escalation — the run has a human’s attention')

  for (const t of state.tasks) {
    if (t.review_rounds >= ROUND_CAP && !G2_COMPLETE_STATUSES.has(t.status)) {
      // An approve on the cap round IS convergence: the D16 rounds bookkeeping
      // lands one tick before the status transition, so a task can sit at
      // rounds == cap, still in-review, with an approve verdict already
      // delivered. Let implementPhase record the approval instead of
      // escalating out of that window.
      const verdicts = obs.reviews.find((r) => r.task === t.id)?.verdicts ?? []
      if (verdicts[verdicts.length - 1] === 'approve') continue
      return escalate('D4', `task ${t.id}: ${t.review_rounds} review rounds without convergence — usually a spec ambiguity`, 'round-cap')
    }
  }

  // Parsed states always carry a profile (absent → full); tolerate a
  // hand-built observation the same way the parser would.
  const profile = state.profile ?? 'full'

  // D21 — profile invariants. A decided gate outside the profile means the
  // profile was lightened under a decided ledger (upgrades are one-way); a
  // phase outside the profile's sequence is a state the table has no rules
  // for. Both are human problems — escalate, never guess.
  for (const gate of GATE_IDS) {
    if (!PROFILE_GATES[profile].includes(gate) && state.gates[gate].by !== null)
      return escalate(
        'D21',
        `gate ${gate} is decided but does not exist in profile ${profile} — profiles upgrade mid-run, never downgrade`,
        'escalation',
      )
  }
  if (!PROFILE_PHASES[profile].includes(state.phase))
    return escalate('D21', `phase "${state.phase}" does not exist in profile ${profile}`, 'escalation')

  // D5 — a gate decided approve while the phase still lists it (the frontend
  // normally advances in the same commit; converge when it didn't).
  for (const gate of PROFILE_GATES[profile]) {
    if (GATE_PHASES[gate].includes(state.phase) && state.gates[gate].approved) {
      const to = phaseAfterGate(gate, profile)
      return record('D5', [{ field: 'phase', to }], `${gate} approved — advance phase to ${to}`)
    }
  }

  switch (state.phase) {
    case 'spec':
      return producerPhase(obs, 'G0')
    case 'plan':
      return planPhase(obs)
    case 'implement':
    case 'integrate':
      return implementPhase(obs)
    case 'release':
      return producerPhase(obs, 'G3')
  }
  return rest('D0', `no rule for phase "${state.phase}" — honest failure, a human should look`)
}

/** Spec and release phases: one producing role, one packet artifact, one gate. */
function producerPhase(obs: RunObservation, gate: GateId): DerivedAction {
  const { role, artifact } = GATE_PRODUCER[gate]
  const inFlight = obs.openDispatches.find((d) => d.role === role)
  if (inFlight) return rest('D12', `${role} dispatched ${inFlight.at ?? ''} and not yet landed — in flight`)

  if (!obs.artifacts.includes(artifact))
    return gatedDispatch(obs, [{ role, task: null, round: null, bounce: null, reason: `${artifact} absent — dispatch ${role}` }], 'D6')

  const bounced = bounceOrEscalate(obs, role, artifact)
  if (bounced) return bounced

  const declined = declineRedispatch(obs, gate, role, artifact)
  if (declined) return declined

  return rest('D10', `${artifact} well-formed; ${gate} is on the table (the frontend inbox surfaces it)`)
}

/**
 * Plan phase. In `patch` (DESIGN.md §4.1) there is no analyst or architect —
 * the human authored the intent brief and a single work item at init, and G1
 * approves both. The engine dispatches no one: a malformed packet surfaces in
 * the inbox as a bounce card for the human (there is no producing role to
 * bounce to), and a decline is likewise the human's to address by editing.
 */
function planPhase(obs: RunObservation): DerivedAction {
  if (obs.state?.profile === 'patch') {
    const taskFiles = obs.artifacts.filter((p) => p.startsWith('tasks/') && p.endsWith('.yaml'))
    if (taskFiles.length === 0)
      return escalate('D21', 'patch run has no work item — the human authors tasks/01-*.yaml alongside the intent brief at init', 'escalation')
    return rest('D10', 'patch packet (intent brief + work item) is human-authored; G1 is on the table (the frontend inbox surfaces it)')
  }

  const inFlight = obs.openDispatches.find((d) => d.role === 'architect')
  if (inFlight) return rest('D12', 'architect dispatched and not yet landed — in flight')

  const taskFiles = obs.artifacts.filter((p) => p.startsWith('tasks/') && p.endsWith('.yaml'))
  if (!obs.artifacts.includes('plan.md') || taskFiles.length === 0)
    return gatedDispatch(
      obs,
      [{ role: 'architect', task: null, round: null, bounce: null, reason: 'plan.md or tasks/*.yaml absent — dispatch architect' }],
      'D6',
    )

  for (const path of ['plan.md', ...taskFiles]) {
    const bounced = bounceOrEscalate(obs, 'architect', path)
    if (bounced) return bounced
  }

  const declined = declineRedispatch(obs, 'G1', 'architect', 'plan.md')
  if (declined) return declined

  return rest('D10', 'plan and tasks well-formed; G1 is on the table (the frontend inbox surfaces it)')
}

/**
 * Implement/integrate: tasks flow through implement ⇄ review; when every task
 * is review-complete, the verifier produces the last G2 packet piece.
 */
function implementPhase(obs: RunObservation): DerivedAction {
  const { state } = obs
  if (!state) return rest('D0', 'unreachable: implementPhase without state')
  if (state.tasks.length === 0) {
    // D19 — the mirror step the v0 human performed by hand: tasks/*.yaml is
    // the G1-approved breakdown; state.tasks tracks each task's pipeline
    // status (and is review_rounds' only home). Seed it, pending, verbatim.
    const ids = [...obs.taskFiles.keys()].sort()
    if (ids.length > 0)
      return record('D19', [{ field: 'seed-tasks', ids }], `seed state.tasks from ${ids.length} task file(s) — the G1 breakdown`)
    return escalate('D4', 'phase is implement but the run has no task files — the G1 packet did not carry into state', 'escalation')
  }

  const updates: Bookkeeping[] = []
  const dispatches: DispatchIntent[] = []
  const launchingSurfaces: string[][] = []
  const frozen: string[] = []

  for (const task of state.tasks) {
    if (G2_COMPLETE_STATUSES.has(task.status)) continue

    const open = obs.openDispatches.find((d) => d.task === task.id)
    if (open || task.status === 'dispatched' || task.status === 'in-progress') continue // D12: in flight

    if (task.status === 'failed') {
      // D20 — the engine froze the task when its implementer failed twice
      // and the run escalated (#147). Mirror D17: the escalation entry's
      // resolution is the unblocking input. A resolution newer than the
      // last failed attempt means a human addressed the named condition —
      // return the task to pending so a fresh round supersedes the
      // failure. Until then the task rests with the human. The engine's
      // escalation reason always carries `(task-id)`, which is what the
      // match keys on (D17's reviewer reasons use `task <id>`, so the two
      // rules never claim each other's escalations).
      const lastFailure = Math.max(
        ...obs.ledger
          .filter((e) => e.failed && e.role === 'implementer' && e.task === task.id && e.at !== null)
          .map((e) => Date.parse(e.at!)),
      )
      const acknowledged = state.escalations.some(
        (e) =>
          e.resolved &&
          e.resolved_at !== null &&
          e.reason.includes(`(${task.id})`) &&
          (!Number.isFinite(lastFailure) || Date.parse(e.resolved_at) > lastFailure),
      )
      if (acknowledged)
        return record(
          'D20',
          [{ field: 'task-status', task: task.id, to: 'pending' }],
          `task ${task.id}: escalation resolved after the failure — return to pending for a fresh round`,
        )
      frozen.push(task.id)
      continue
    }

    if (task.status === 'pending') {
      const file = obs.taskFiles.get(task.id)
      const depsComplete = (file?.dependsOn ?? []).every((dep) => {
        const depTask = state.tasks.find((t) => t.id === dep)
        return depTask !== undefined && G2_COMPLETE_STATUSES.has(depTask.status)
      })
      if (!depsComplete) continue
      const surface = file?.surface ?? []
      const overlaps = (a: string[], b: string[]) => a.some((p) => b.includes(p))
      const busy = obs.inFlightSurfaces.concat(launchingSurfaces)
      // Serialize any overlap — and any undeclared surface while others run,
      // since an undeclared surface could touch anything (DESIGN.md §9).
      const blocked = busy.some((s) => overlaps(s, surface)) || (surface.length === 0 && busy.length > 0)
      if (blocked) continue
      launchingSurfaces.push(surface)
      dispatches.push({
        role: 'implementer',
        task: task.id,
        round: task.review_rounds + 1,
        bounce: null,
        reason: `task ${task.id} pending with dependencies complete`,
      })
      continue
    }

    if (task.status === 'in-review') {
      // review_rounds counts *delivered* verdicts (its only home is
      // state.yaml). delivered > recorded means the closing bookkeeping
      // hasn't landed; converge that first — one transition per tick.
      const review = obs.reviews.find((r) => r.task === task.id)
      const delivered = review?.verdicts.length ?? 0
      if (delivered === 0) {
        // D13 — the diff awaits its first review.
        dispatches.push({
          role: 'reviewer',
          task: task.id,
          round: task.review_rounds + 1,
          bounce: null,
          reason: `task ${task.id} in review, no verdict yet delivered`,
        })
        continue
      }
      if (delivered > task.review_rounds) {
        updates.push({ field: 'review-rounds', task: task.id, to: delivered })
        continue
      }
      const verdict = review!.verdicts[delivered - 1]!
      if (verdict === 'approve') {
        updates.push({ field: 'task-status', task: task.id, to: 'review-approved' })
        continue
      }
      if (verdict === 'escalate') {
        // An escalate verdict is a standing fact in an append-only artifact —
        // no later state edit can amend it, so the escalation entry's
        // resolution is the unblocking input. A resolution newer than the
        // verdict means a human addressed the named condition in the repo;
        // verify that by re-review instead of re-escalating every tick. A
        // human may resolve more than once (acknowledge, then later resolve
        // with a disposition) — only the LATEST matching resolution governs.
        const matching = state.escalations.filter(
          (e) =>
            e.resolved &&
            e.resolved_at !== null &&
            e.reason.includes(`task ${task.id}`) &&
            review!.lastTouched !== null &&
            Date.parse(e.resolved_at) / 1000 > review!.lastTouched,
        )
        if (matching.length === 0) return escalate('D17', `reviewer escalated task ${task.id} — see ${review!.path}`, 'escalation')
        const resolution = matching.reduce((latest, e) => (Date.parse(e.resolved_at!) > Date.parse(latest.resolved_at!) ? e : latest))

        // disposition `re-review` (#189) — an explicit human choice made at
        // resolve time, which is itself the judgment the #188 zero-delta
        // guard exists to protect when no human has looked. Bypass it.
        if (resolution.disposition === 're-review') {
          dispatches.push({
            role: 'reviewer',
            task: task.id,
            round: task.review_rounds + 1,
            bounce: null,
            reason: `task ${task.id}: escalation resolved with disposition re-review — dispatch re-review round (human override bypasses the #188 guard)`,
          })
          continue
        }

        // disposition `return-to-implement` (#189) — the human chose to send
        // the task back to the implementer rather than straight to
        // re-review. Whose turn is it? Mirrors D14/D15 below, but keyed off
        // the resolution's timestamp rather than the review's: the task
        // file's notes record the implementer's response, newer than the
        // resolution means responded.
        if (resolution.disposition === 'return-to-implement') {
          const taskPath = obs.taskFiles.get(task.id)?.path
          const taskTouched = taskPath ? (obs.lastTouched[taskPath] ?? null) : null
          const respondedToResolution = taskTouched !== null && taskTouched > Date.parse(resolution.resolved_at!) / 1000
          if (respondedToResolution) {
            dispatches.push({
              role: 'reviewer',
              task: task.id,
              round: task.review_rounds + 1,
              bounce: null,
              reason: `task ${task.id}: implementer responded after the return-to-implement disposition; dispatch verify round`,
            })
          } else {
            dispatches.push({
              role: 'implementer',
              task: task.id,
              round: task.review_rounds + 1,
              bounce: { kind: 'review', report: review!.path },
              reason: `task ${task.id}: escalation resolved with disposition return-to-implement — dispatch implementer with the review report`,
            })
          }
          continue
        }

        // disposition `re-plan` (#190) — the routed finding names a surface
        // or decomposition defect no task's file_contact_surface can absorb;
        // the human sends it to the architect's amendment mode rather than
        // the implementer. The architect is a run-wide resource, not a
        // per-task one (mirrors planPhase's architect dispatch), so this
        // branch returns immediately instead of batching with other tasks'
        // dispatches below — at most one architect amendment in flight.
        if (resolution.disposition === 're-plan') {
          const inFlight = obs.openDispatches.find((d) => d.role === 'architect')
          if (inFlight)
            return rest(
              'D12',
              `architect dispatched ${inFlight.at ?? ''} and not yet landed — in flight (task ${task.id} awaits the amendment)`,
            )

          const resolvedAtSec = Date.parse(resolution.resolved_at!) / 1000
          const touchedSince = (path: string | undefined) => {
            const t = path ? (obs.lastTouched[path] ?? null) : null
            return t !== null && t > resolvedAtSec
          }
          const amendmentLanded =
            touchedSince('plan.md') || [...obs.taskFiles.values()].some((f) => touchedSince(f.path))

          if (amendmentLanded)
            return escalate(
              'D23',
              `task ${task.id}: architect amendment landed for the re-plan disposition — acknowledge to proceed (see plan.md's dated ADR)`,
              'escalation',
            )

          return gatedDispatch(
            obs,
            [
              {
                role: 'architect',
                task: null,
                round: null,
                bounce: { kind: 'amendment', report: review!.path, note: resolution.resolution ?? '', task: task.id },
                reason: `task ${task.id}: escalation resolved with disposition re-plan — dispatch architect in amendment mode with the review report and resolution note`,
              },
            ],
            'D22',
          )
        }

        // No disposition — legacy behavior. The resolution note alone proves
        // nothing changed; it is a state.yaml edit the human could write
        // without touching the condition it names. Require a real commit
        // under the run directory, excluding state.yaml itself, newer than
        // the escalate verdict: that is the fix landing, not just the
        // acknowledgment. Without this a zero-delta resolve+resume dispatches
        // a re-review round against a byte-identical range, burning one of
        // the ROUND_CAP rounds for nothing (#188).
        const landed =
          obs.lastNonStateCommit !== null && review!.lastTouched !== null && obs.lastNonStateCommit > review!.lastTouched
        if (!landed)
          return rest(
            'D17',
            `task ${task.id}: escalation resolved but nothing has landed since the verdict — land the fix; the re-review dispatches on the tick after it does`,
          )
        dispatches.push({
          role: 'reviewer',
          task: task.id,
          round: task.review_rounds + 1,
          bounce: null,
          reason: `task ${task.id}: escalation resolved after the escalate verdict — dispatch re-review round`,
        })
        continue
      }
      // request-changes: whose turn? The task file's notes record the
      // implementer's response; newer than the review means responded.
      const taskPath = obs.taskFiles.get(task.id)?.path
      const taskTouched = taskPath ? (obs.lastTouched[taskPath] ?? null) : null
      const responded = taskTouched !== null && review!.lastTouched !== null && taskTouched > review!.lastTouched
      if (responded) {
        // D15 — the verify round. Round cap: a verify round past the cap is
        // caught by D4 above (rounds ≥ cap with the task incomplete).
        dispatches.push({
          role: 'reviewer',
          task: task.id,
          round: task.review_rounds + 1,
          bounce: null,
          reason: `task ${task.id}: implementer responded to round ${task.review_rounds}; dispatch verify round`,
        })
      } else {
        dispatches.push({
          role: 'implementer',
          task: task.id,
          round: task.review_rounds + 1,
          bounce: { kind: 'review', report: review!.path },
          reason: `task ${task.id}: round ${task.review_rounds} requested changes`,
        })
      }
      continue
    }
    // Unknown status (contract tolerates drift): no rule → leave it to a human.
    return escalate('D4', `task ${task.id} has status "${task.status}" the derivation table has no rule for`, 'escalation')
  }

  // Bookkeeping converges state before anything new launches (one transition per tick).
  if (updates.length > 0) return record('D16', updates, 'review verdicts landed — record the bookkeeping')
  if (dispatches.length > 0) return gatedDispatch(obs, dispatches, dispatches.every((d) => d.role === 'reviewer') ? 'D13' : 'D11')

  if (frozen.length > 0)
    return rest('D20', `task(s) ${frozen.join(', ')} failed and frozen — awaiting the naming escalation's resolution`)

  const allComplete = state.tasks.every((t) => G2_COMPLETE_STATUSES.has(t.status))
  if (!allComplete) return rest('D12', 'tasks in flight — nothing derivable until an artifact lands')

  // No verifier in `patch`: the reviews are the whole G2 packet (DESIGN.md §4.1).
  if (state.profile === 'patch')
    return rest('D10', 'all tasks review-complete; G2 is on the table (the frontend inbox surfaces it)')
  return producerPhase(obs, 'G2')
}

/** D7/D8 — malformed artifact: bounce twice, then it's a contract dispute. */
function bounceOrEscalate(obs: RunObservation, role: Role, artifact: string): DerivedAction | null {
  const v = obs.validations[artifact]
  if (!v || v.ok) return null
  const bounces = obs.bounceCounts[artifact] ?? 0
  if (bounces >= BOUNCE_CAP)
    return escalate('D8', `${artifact} bounced ${bounces}× and is still malformed — contract dispute, a human should look`, 'escalation')
  return gatedDispatch(
    obs,
    [
      {
        role,
        task: null,
        round: null,
        bounce: { kind: 'malformed', artifact, missing: v.missing },
        reason: `${artifact} missing required sections: ${v.missing.join(', ')}`,
      },
    ],
    'D7',
  )
}

/**
 * D9 — decline recovery (resolved question 5): a decline newer than the
 * artifact means the producer has not yet redone it; a human resume lands
 * here and the producer is re-dispatched with the decline notes.
 */
function declineRedispatch(obs: RunObservation, gate: GateId, role: Role, artifact: string): DerivedAction | null {
  const { state } = obs
  if (!state || !gateUndecided(state.gates[gate])) return null
  const decline = obs.declineEvents[gate]
  if (!decline || decline.redone) return null // producer already redid the artifact
  return gatedDispatch(
    obs,
    [
      {
        role,
        task: null,
        round: null,
        bounce: { kind: 'gate-declined', gate, notes: decline.notes },
        reason: `${gate} was declined after ${artifact} landed — re-dispatch ${role} with the decline notes`,
      },
    ],
    'D9',
  )
}

/**
 * DB — the pre-flight budget check wraps every dispatch decision (§6).
 * Skipped entirely when enforcement is off (#109): the cap stops pausing,
 * while the ledger and cost_spent_usd keep metering unconditionally.
 */
function gatedDispatch(obs: RunObservation, dispatches: DispatchIntent[], rule: string): DerivedAction {
  const limit = obs.enforceBudget ? (obs.state?.budget?.cost_limit_usd ?? null) : null
  if (limit !== null) {
    const est = (role: string) => obs.estimates[role] ?? DEFAULT_ESTIMATE_USD
    const openProjected = obs.openDispatches.reduce((sum, d) => sum + est(d.role), 0)
    const newProjected = dispatches.reduce((sum, d) => sum + est(d.role), 0)
    const projected = obs.ledgerSpentUsd + openProjected + newProjected
    if (projected > limit)
      return escalate(
        'DB',
        `projected spend $${projected.toFixed(2)} (ledger $${obs.ledgerSpentUsd.toFixed(2)} + estimates) exceeds cost_limit_usd $${limit} — pausing rather than degrading`,
        'budget-exhausted',
      )
  }
  return {
    kind: 'dispatch',
    rule,
    dispatches,
    why: dispatches.map((d) => d.reason).join('; '),
  }
}

/** One-line rendering for dry-run output and logs. */
export function formatAction(slug: string, action: DerivedAction): string {
  switch (action.kind) {
    case 'rest':
      return `${slug}: rest [${action.rule}] — ${action.why}`
    case 'dispatch':
      return `${slug}: dispatch [${action.rule}] ${action.dispatches
        .map((d) => `${d.role}${d.task ? `(${d.task}${d.round ? ` r${d.round}` : ''})` : ''}${d.bounce ? ' [bounce]' : ''}`)
        .join(' + ')} — ${action.why}`
    case 'record':
      return `${slug}: record [${action.rule}] ${action.updates
        .map((u) =>
          u.field === 'phase'
            ? `phase→${u.to}`
            : u.field === 'review-rounds'
              ? `${u.task} rounds→${u.to}`
              : u.field === 'seed-tasks'
                ? `seed tasks [${u.ids.join(', ')}]`
                : `${u.task}→${u.to}`,
        )
        .join(', ')} — ${action.why}`
    case 'escalate':
      return `${slug}: escalate [${action.rule}]${action.pause ? ` + pause(${action.pause})` : ''} — ${action.reason}`
  }
}
