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

export const PHASES = ['spec', 'plan', 'implement', 'integrate', 'release', 'done', 'paused'] as const
export type Phase = (typeof PHASES)[number]

export const PAUSED_REASONS = ['budget-exhausted', 'round-cap', 'escalation', 'gate-declined', 'staged'] as const
export type PausedReason = (typeof PAUSED_REASONS)[number]

/** A staged-but-unarmed run: `phase: paused` reused (ADR-1) rather than a new
 * phase value, so it needs no PROFILE_PHASES extension and no new derivation
 * row. Exported so callers never inline the literal twice. */
export const STAGED_REASON = 'staged' as const

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

/** Which phases a run of each profile can legitimately be in. */
export const PROFILE_PHASES: Record<Profile, Phase[]> = {
  patch: ['plan', 'implement', 'integrate', 'done', 'paused'],
  standard: ['spec', 'plan', 'implement', 'integrate', 'done', 'paused'],
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
