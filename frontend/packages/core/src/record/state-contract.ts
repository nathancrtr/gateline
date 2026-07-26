// Contract-aware classification of a target repo's state contract (R4): the
// frontend's parse boundary decides once, from the repo's own
// contracts/state.yaml (and contracts/state-core.yaml as its fallback),
// whether a run's state.yaml should read against the compiled SDLC schema
// or a generic descriptor derived from the template itself — the same
// template-first rule already applied to work-item.yaml (R3), extended to
// state.yaml.
import { parse as parseYaml } from 'yaml'
import type { ContractTemplates } from './validate.ts'

export type StateContract =
  | { kind: 'sdlc' }
  | {
      kind: 'generic'
      /** Host-declared gate names, template order. */
      gateIds: string[]
      /** Top-level keys of the host's template — validateArtifact's required set. */
      requiredKeys: string[]
      branchRequired: boolean
    }

/** The compiled default: today's fixed SDLC shape (G0–G3, branch, budget, tasks). */
export const SDLC_STATE_CONTRACT: StateContract = Object.freeze({ kind: 'sdlc' })

/** A template carrying all three of these top-level keys is the SDLC extension. */
const SDLC_MARKERS = ['branch', 'budget', 'tasks'] as const

/** Parses `template` and returns it only when it is a plain object (never an array or scalar). */
function parseTemplateObject(template: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = parseYaml(template)
  } catch {
    return null
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  return null
}

function deriveGeneric(template: Record<string, unknown>): StateContract {
  const gates = template['gates'] as Record<string, unknown> | null | undefined
  return {
    kind: 'generic',
    gateIds: Object.keys(gates ?? {}),
    requiredKeys: Object.keys(template),
    branchRequired: 'branch' in template,
  }
}

/**
 * Pure classification of template text (null = file absent). Normative
 * table (plan "Interface contracts"):
 *   - state.yaml parses to an object with all of branch/budget/tasks -> sdlc
 *   - state.yaml parses to an object lacking any of those three -> generic,
 *     derived from state.yaml's own keys
 *   - state.yaml absent -> generic, derived from state-core.yaml the same way
 *   - both absent, or state.yaml unparseable -> sdlc (built-in fallback —
 *     bare fixture repos keep today's behavior)
 */
export function deriveStateContract(stateTemplate: string | null, coreTemplate: string | null): StateContract {
  if (stateTemplate !== null) {
    const parsed = parseTemplateObject(stateTemplate)
    if (parsed === null) return SDLC_STATE_CONTRACT
    if (SDLC_MARKERS.every((k) => k in parsed)) return SDLC_STATE_CONTRACT
    return deriveGeneric(parsed)
  }
  if (coreTemplate !== null) {
    const parsed = parseTemplateObject(coreTemplate)
    if (parsed !== null) return deriveGeneric(parsed)
  }
  return SDLC_STATE_CONTRACT
}

/** Reads contracts/state.yaml, then contracts/state-core.yaml, via the repo's templates. */
export async function resolveStateContract(templates: ContractTemplates): Promise<StateContract> {
  const stateTemplate = await templates.read('state.yaml')
  const coreTemplate = stateTemplate === null ? await templates.read('state-core.yaml') : null
  return deriveStateContract(stateTemplate, coreTemplate)
}
