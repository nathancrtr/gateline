// Typed mirror of contracts/state.yaml. Parsing is deliberately tolerant of
// unknown keys (contracts evolve) but strict about the shape the frontend
// depends on: a state file that fails here surfaces as a malformed run —
// visible, never guessed around (the contracts' bounce rule applied to us).
import { parse as parseYaml, type Document } from 'yaml'
import { z } from 'zod'

export type StateDocMutation = (doc: Document) => void

/** Who a state.yaml write is committed as — the named human or the bot. */
export interface Identity {
  name: string
  email: string
}

export const PHASES = ['spec', 'plan', 'implement', 'integrate', 'release', 'done', 'paused', 'closed'] as const
export type Phase = (typeof PHASES)[number]

/** Phases from which nothing further derives: the run's record is final. */
export const TERMINAL_PHASES = ['done', 'closed'] as const

export const PAUSED_REASONS = ['budget-exhausted', 'round-cap', 'escalation', 'gate-declined', 'staged', 'slug-landed'] as const
export type PausedReason = (typeof PAUSED_REASONS)[number]

/** A staged-but-unarmed run: `phase: paused` reused (ADR-1) rather than a new
 * phase value, so it needs no PROFILE_PHASES extension and no new derivation
 * row. Exported so callers never inline the literal twice. */
export const STAGED_REASON = 'staged' as const

/** A run at rest because a human declined its gate — a decided run, not a
 * pending one (#200). Exported so no caller inlines the literal twice. */
export const DECLINED_REASON = 'gate-declined' as const

/** A run the orchestrator paused because its next dispatch would exceed
 * `budget.cost_limit_usd` (or, under `--require-budget`, because it has none).
 * A condition, not an event (#96): the deriver recomputes it from the same
 * facts every tick, so the only resume that sticks is one that changes a
 * fact — a higher limit, written in the same commit. */
export const BUDGET_REASON = 'budget-exhausted' as const

/** A run the orchestrator paused because `runs/<slug>/` already shipped on the
 * default branch and the branch kept going (#213, rule LR). Nothing clears it:
 * the remaining work needs a fresh slug, and this run a closing disposition. */
export const LANDED_REASON = 'slug-landed' as const

/** A run the orchestrator paused alongside an escalation it raised. The reason
 * says only that a human is owed; what actually clears the pause is whatever
 * the escalation's own text names, which is where the paused card's
 * instruction comes from (#348). */
export const ESCALATION_REASON = 'escalation' as const

/**
 * A run a human closed out before it reached `done` (#200) — a real phase, not
 * another `paused_reason`.
 *
 * `staged` took the `paused_reason` route (ADR-1) and that was right: staging
 * says only *that* the run is at rest. A closure also has to say *why*, and
 * #263 proved a reason field cannot carry both — it holds one fact at a time,
 * and a disposition hung off it would encode paused-ness and why-closed in one
 * enum. The disposition is a property of a closed run, so the run gets a phase
 * and the phase gets a record.
 */
export const CLOSED_PHASE = 'closed' as const

/**
 * Why a run was closed. Typed rather than free text because the distinction
 * lives in the human's head at closing time and nowhere in the record: a
 * disposition-less terminal state can never be re-derived into these
 * categories later.
 *
 * `already-delivered` is emphatically not `abandoned`. A run whose work shipped
 * by another path succeeded; recording that as the state four walked-away runs
 * share would flatten it into "gave up" in the one place the project treats as
 * its audit trail.
 */
export const CLOSURES = ['already-delivered', 'superseded', 'obsolete', 'abandoned'] as const
export type Closure = (typeof CLOSURES)[number]

/** What each disposition asserts, for the surfaces that have room to say it. */
export const CLOSURE_MEANINGS: Record<Closure, string> = {
  'already-delivered': 'the work shipped by another path; this record closes to match reality',
  superseded: 'later work overtook it; nothing here is wanted anymore',
  obsolete: 'the need itself went away',
  abandoned: 'a deliberate walk-away mid-flight',
}

export const GATE_IDS = ['G0', 'G1', 'G2', 'G3'] as const
export type GateId = (typeof GATE_IDS)[number]

// Run profiles (DESIGN.md §4.1): ceremony scaled to the change. Fixed sets,
// not knobs — each profile declares which gates exist and which phases the
// run passes through. A state.yaml with no `profile:` field is a `full` run,
// so every pre-profile run record keeps its meaning unchanged.
export const PROFILES = ['patch', 'standard', 'full'] as const
export type Profile = (typeof PROFILES)[number]

/** Which gates exist per profile. A gate absent from the profile is absent, never auto-approved. */
export const PROFILE_GATES: Record<Profile, GateId[]> = {
  patch: ['G1', 'G2'],
  standard: ['G0', 'G1', 'G2'],
  full: ['G0', 'G1', 'G2', 'G3'],
}

/**
 * Which phases a run of each profile can legitimately be in. `paused` and
 * `closed` are rest states every profile can reach, not steps in the sequence —
 * the spine filters both out rather than drawing them as positions.
 */
export const PROFILE_PHASES: Record<Profile, Phase[]> = {
  patch: ['plan', 'implement', 'integrate', 'done', 'paused', 'closed'],
  standard: ['spec', 'plan', 'implement', 'integrate', 'done', 'paused', 'closed'],
  full: [...PHASES],
}

export const BURDENS = ['confirmation', 'light-correction', 'heavy-correction'] as const
export type Burden = (typeof BURDENS)[number]

// A resolve-escalation decision may name a machine-actionable route for the
// engine's D17 rule (ORCHESTRATOR.md §4.2): `re-review` re-dispatches the
// reviewer immediately (a human override of the #188 zero-delta guard);
// `return-to-implement` sends the task back to the implementer with the
// review report first; `re-plan` (#190) sends the finding to the architect's
// amendment mode — the fix is a surface/decomposition defect no task can
// absorb — and, once the amendment lands, the engine raises a fresh
// escalation for the human to acknowledge before work resumes. Absent → the
// engine's legacy guarded-re-review default.
export const DISPOSITIONS = ['re-review', 'return-to-implement', 're-plan'] as const
export type Disposition = (typeof DISPOSITIONS)[number]

// Task statuses from contracts/state.yaml. A task is "complete for G2"
// once review has approved it — verification presence is checked separately
// via verification-report.md, so review-approved and later all count.
// `dispatched` is the v1 orchestrator's commit-then-launch bookkeeping state:
// a producer was launched but has not yet committed its artifact. `failed`
// is the engine's frozen state after an implementer failed twice and the
// run escalated; the orchestrator returns it to pending once the naming
// escalation is resolved (derivation rule D20).
export const TASK_STATUSES = ['pending', 'dispatched', 'failed', 'in-progress', 'in-review', 'review-approved', 'verified', 'done'] as const
export const G2_COMPLETE_STATUSES = new Set(['review-approved', 'verified', 'done'])

/**
 * The review-round cap (DESIGN.md §4): a task whose `review_rounds` reaches
 * this without converging escalates to the human instead of being reviewed
 * again. One home, so the orchestrator's rule, the readiness item, and every
 * surface that draws `n/cap` or colours a task red agree by construction
 * (#314). Display layers read it off the view model rather than importing it.
 */
export const ROUND_CAP = 3

/** The `yaml` core schema parses unquoted dates as strings; normalize anything else. */
const yamlScalarToString = z
  .union([z.string(), z.number(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : String(v)))

const gateEntrySchema = z
  .object({
    approved: z.boolean(),
    by: yamlScalarToString.nullish().transform((v) => v ?? null),
    at: yamlScalarToString.nullish().transform((v) => v ?? null),
    notes: yamlScalarToString.nullish().transform((v) => v ?? null),
    burden: z.enum(BURDENS).nullish().transform((v) => v ?? null),
  })
  .passthrough()

const taskEntrySchema = z
  .object({
    id: z.string(),
    status: z.string(), // tolerate vocabulary drift; display layer maps known statuses
    review_rounds: z.number().int().nonnegative().nullish().transform((v) => v ?? 0),
  })
  .passthrough()

const escalationSchema = z
  .object({
    at: yamlScalarToString.nullish().transform((v) => v ?? null),
    from_role: z.string().nullish().transform((v) => v ?? null),
    reason: z.string(),
    resolved: z.boolean(),
    resolved_by: z.string().nullish().transform((v) => v ?? null),
    resolved_at: yamlScalarToString.nullish().transform((v) => v ?? null),
    resolution: z.string().nullish().transform((v) => v ?? null),
    disposition: z.enum(DISPOSITIONS).nullish().transform((v) => v ?? null),
  })
  .passthrough()

// Written once, when a human closes the run; the counterpart of a gate entry
// for a decision about the whole run rather than one artifact.
const closureSchema = z
  .object({
    as: z.enum(CLOSURES),
    by: yamlScalarToString.nullish().transform((v) => v ?? null),
    at: yamlScalarToString.nullish().transform((v) => v ?? null),
    reason: yamlScalarToString.nullish().transform((v) => v ?? null),
  })
  .passthrough()

const budgetSchema = z
  .object({
    cost_limit_usd: z.number().nullish().transform((v) => v ?? null),
    cost_spent_usd: z.number().nullish().transform((v) => v ?? null),
  })
  .passthrough()

/** An absent gate entry parses as undecided — it can never masquerade as approved. */
const undecidedGate = () => gateEntrySchema.parse({ approved: false })

export const runStateSchema = z
  .object({
    run: z.string(),
    branch: z.string(),
    phase: z.enum(PHASES),
    profile: z
      .enum(PROFILES)
      .nullish()
      .transform((v) => v ?? ('full' as Profile)),
    paused_reason: z.string().nullish().transform((v) => v ?? null),
    closure: closureSchema.nullish().transform((v) => v ?? null),
    budget: budgetSchema.nullish().transform((v) => v ?? null),
    gates: z.object({
      G0: gateEntrySchema.optional(),
      G1: gateEntrySchema,
      G2: gateEntrySchema,
      G3: gateEntrySchema.optional(),
    }),
    tasks: z.array(taskEntrySchema).nullish().transform((v) => v ?? []),
    escalations: z.array(escalationSchema).nullish().transform((v) => v ?? []),
  })
  .passthrough()
  .superRefine((s, ctx) => {
    // Strictness scaled to the profile: the gates the profile declares must be
    // present in the file; only gates outside the profile may be absent.
    for (const gate of PROFILE_GATES[s.profile]) {
      if (s.gates[gate] === undefined)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gates', gate], message: `required by profile ${s.profile}` })
    }
    // A closed run without its closure record is malformed, not "closed for
    // some reason": the disposition is the whole point of the phase, and a
    // reader that guessed one would invent the fact the record exists to keep.
    if (s.phase === CLOSED_PHASE && !s.closure)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['closure'], message: `required when phase is ${CLOSED_PHASE}` })
  })
  .transform((s) => ({
    ...s,
    // Normalize to all four entries so consumers keep a total gates record;
    // profile-aware consumers filter through PROFILE_GATES, never this shape.
    gates: {
      G0: s.gates.G0 ?? undecidedGate(),
      G1: s.gates.G1,
      G2: s.gates.G2,
      G3: s.gates.G3 ?? undecidedGate(),
    },
  }))

export type GateEntry = z.infer<typeof gateEntrySchema>
export type TaskEntry = z.infer<typeof taskEntrySchema>
export type ClosureRecord = z.infer<typeof closureSchema>
export type Escalation = z.infer<typeof escalationSchema>
export type RunState = z.infer<typeof runStateSchema>

export interface StateParseResult {
  state: RunState | null
  /** Human-readable reason the state file is malformed, or null when it parsed. */
  error: string | null
}

export function parseRunState(text: string): StateParseResult {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (e) {
    return { state: null, error: `state.yaml is not valid YAML: ${(e as Error).message}` }
  }
  const result = runStateSchema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { state: null, error: `state.yaml does not match the contract: ${issues}` }
  }
  return { state: result.data, error: null }
}

/** Gate awaiting a decision: neither approved nor decided-by-anyone yet. */
export function gateUndecided(g: GateEntry): boolean {
  return !g.approved && g.by === null
}

/** The phase a run enters when a gate is approved (v0 orchestrator convention, full profile). */
export const PHASE_AFTER_GATE: Record<GateId, Phase> = {
  G0: 'plan',
  G1: 'implement',
  G2: 'release',
  G3: 'done',
}

/**
 * Profile-aware phase advance: in reduced profiles the run ends at G2 —
 * the merge is the release — so G2 advances to done, not release.
 */
export function phaseAfterGate(gate: GateId, profile: Profile): Phase {
  if (gate === 'G2' && profile !== 'full') return 'done'
  return PHASE_AFTER_GATE[gate]
}

/** The phase in which each gate's decision is on the table. */
export const GATE_PHASES: Record<GateId, Phase[]> = {
  G0: ['spec'],
  G1: ['plan'],
  G2: ['implement', 'integrate'],
  G3: ['release'],
}

/**
 * Where a paused run should resume, derived from the gate ledger (never
 * stored). Walks only the profile's gates: the run resumes into the phase
 * whose gate is the first not yet approved.
 */
export function deriveResumePhase(state: RunState): Phase {
  for (const gate of PROFILE_GATES[state.profile]) {
    if (!state.gates[gate].approved) return GATE_PHASES[gate][0]!
  }
  return 'done'
}

/**
 * Which gate, if any, is on the table when the run stands at `phase`.
 *
 * The frontier is the profile's first un-approved gate: every gate before it
 * is signed, so it is the only gate a decision can honestly be about. It is on
 * the table when `phase` is one of the phases that gate is decided in and
 * nobody has decided it yet — a declined gate is a *decided* gate until a
 * resume re-opens it.
 *
 * One definition, two readers. The readiness rules draw a gate card from it
 * (`view-model/readiness.ts`) and `planDecision` refuses a decision that is not
 * about it (#344). Two implementations of "pending" is how the card a human is
 * shown and the write the API accepts drift apart.
 */
export function pendingGateAt(state: RunState, phase: Phase): GateId | null {
  for (const gate of PROFILE_GATES[state.profile]) {
    if (state.gates[gate].approved) continue
    return GATE_PHASES[gate].includes(phase) && gateUndecided(state.gates[gate]) ? gate : null
  }
  return null
}

/** Which gate, if any, is on the table for the run's current phase. */
export function pendingGate(state: RunState): GateId | null {
  return pendingGateAt(state, state.phase)
}

/**
 * The phase a gate decision is judged against: the run's own, or the one its
 * gate ledger derives when that is further along.
 *
 * Two records need the ledger's answer rather than the phase field's. A paused
 * or closed run holds no position in the sequence at all, and yet the ordinary
 * reason a run is paused is a question about the very packet its pending gate
 * covers — which a human answers by deciding that gate. And a phase can simply
 * lag its own ledger for a while: an `advancePhase: false` approval signs the
 * gate without moving the phase, and the engine's convergence rule (D5) writes
 * the advance on its next tick. A gate signed but not yet walked past is a
 * record mid-transition, not a run that skipped anything.
 *
 * A phase *ahead* of the ledger is the opposite case and keeps its own value,
 * so the decision is judged where the record actually claims to be — refusing
 * is the safe direction when those two disagree that way.
 */
export function decisionPhase(state: RunState): Phase {
  const derived = deriveResumePhase(state)
  const sequence: Phase[] = PROFILE_PHASES[state.profile].filter((p) => p !== 'paused' && p !== CLOSED_PHASE)
  const here = sequence.indexOf(state.phase)
  if (here < 0) return derived // paused or closed: no position of its own
  return sequence.indexOf(derived) > here ? derived : state.phase
}

/**
 * The role whose artifact a gate's packet waits on, and the artifact it lands.
 *
 * The record layer's half of the engine's `GATE_PRODUCER`
 * (orchestrator/src/derive.ts), and profile-aware where that table is not:
 * `patch` G1 has no producer at all — the human authored the brief and the work
 * item, so there is no one out and nothing to supersede — and `patch` G2 ends
 * at the reviewer, since a patch run has no verifier (DESIGN.md §4.1).
 *
 * It lives here rather than in the view model because two readings need it and
 * they must not drift: the gate card withholds itself while the producer is out
 * (#159) and `planDecision` refuses the approval for the same reason (#351).
 */
export function gateProducer(gate: GateId, profile: Profile): { role: string; artifact: string } | null {
  switch (gate) {
    case 'G0':
      return { role: 'analyst', artifact: 'spec.md' }
    case 'G1':
      return profile === 'patch' ? null : { role: 'architect', artifact: 'plan.md' }
    case 'G2':
      return profile === 'patch'
        ? { role: 'reviewer', artifact: 'a review report' }
        : { role: 'verifier', artifact: 'verification-report.md' }
    case 'G3':
      return { role: 'ops', artifact: 'release-plan.md' }
  }
}

/** A review report, as the contract names one: `review-<nn>[-suffix].md`. */
export function isReviewFile(path: string): boolean {
  return /^review-\d+.*\.md$/.test(path)
}

/**
 * Is the evidence G2 decides on complete — every task carried to
 * review-approved or beyond, at least one review report, and, outside `patch`
 * (which has no verifier), the verification report?
 *
 * Shared by the gate card and the PR-approval sync so the two agree by
 * construction (#344). The sync copies a reviewer's Approve on the draft PR
 * into G2, and a copy made before this packet exists is an approval of nothing.
 */
export function g2PacketReady(state: RunState, artifacts: string[]): boolean {
  const tasksComplete = state.tasks.length > 0 && state.tasks.every((t) => G2_COMPLETE_STATUSES.has(t.status))
  const verification = state.profile === 'patch' || artifacts.includes('verification-report.md')
  return tasksComplete && artifacts.some(isReviewFile) && verification
}
