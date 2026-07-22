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

export const PAUSED_REASONS = ['budget-exhausted', 'round-cap', 'escalation', 'gate-declined'] as const
export type PausedReason = (typeof PAUSED_REASONS)[number]

export const GATE_IDS = ['G0', 'G1', 'G2', 'G3'] as const
export type GateId = (typeof GATE_IDS)[number]

export const BURDENS = ['confirmation', 'light-correction', 'heavy-correction'] as const
export type Burden = (typeof BURDENS)[number]

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
  })
  .passthrough()

const budgetSchema = z
  .object({
    cost_limit_usd: z.number().nullish().transform((v) => v ?? null),
    cost_spent_usd: z.number().nullish().transform((v) => v ?? null),
  })
  .passthrough()

export const runStateSchema = z
  .object({
    run: z.string(),
    branch: z.string(),
    phase: z.enum(PHASES),
    paused_reason: z.string().nullish().transform((v) => v ?? null),
    budget: budgetSchema.nullish().transform((v) => v ?? null),
    gates: z.object({
      G0: gateEntrySchema,
      G1: gateEntrySchema,
      G2: gateEntrySchema,
      G3: gateEntrySchema,
    }),
    tasks: z.array(taskEntrySchema).nullish().transform((v) => v ?? []),
    escalations: z.array(escalationSchema).nullish().transform((v) => v ?? []),
  })
  .passthrough()

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

/** The phase a run enters when a gate is approved (v0 orchestrator convention). */
export const PHASE_AFTER_GATE: Record<GateId, Phase> = {
  G0: 'plan',
  G1: 'implement',
  G2: 'release',
  G3: 'done',
}

/** The phase in which each gate's decision is on the table. */
export const GATE_PHASES: Record<GateId, Phase[]> = {
  G0: ['spec'],
  G1: ['plan'],
  G2: ['implement', 'integrate'],
  G3: ['release'],
}

/** Where a paused run should resume, derived from the gate ledger (never stored). */
export function deriveResumePhase(state: RunState): Phase {
  if (gateUndecided(state.gates.G0) || !state.gates.G0.approved) return 'spec'
  if (gateUndecided(state.gates.G1) || !state.gates.G1.approved) return 'plan'
  if (gateUndecided(state.gates.G2) || !state.gates.G2.approved) return 'implement'
  if (gateUndecided(state.gates.G3) || !state.gates.G3.approved) return 'release'
  return 'done'
}
