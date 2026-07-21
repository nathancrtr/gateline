// Contract well-formedness (rule R3): required sections come from the target
// repo's own contracts/*.md templates at read time, so a fork that amends a
// contract validates against its own version. Built-in fallbacks cover repos
// that carry runs but no contracts/ tree.
import { parse as parseYaml } from 'yaml'

export interface Validation {
  /** Which contract this artifact was checked against, or null (no contract → presence-only). */
  contract: string | null
  ok: boolean
  /** Missing required section headings (markdown) or top-level keys (yaml). */
  missing: string[]
  /** Non-fatal notes (e.g. fell back to built-in template). */
  notes: string[]
}

/** H2 headings are the required-section signal in every markdown contract. */
export function extractSections(markdown: string): string[] {
  const sections: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) sections.push(m[1]!)
  }
  return sections
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Built-in section lists, mirroring contracts/ at the time of writing. */
export const BUILTIN_SECTIONS: Record<string, string[]> = {
  'intent-brief.md': ['Problem', 'Motivation', 'Constraints', 'Out of scope'],
  'spec.md': ['Context', 'Requirements', 'Assumptions', 'Out of scope'],
  'plan.md': ['Approach', 'Interface contracts', 'Decisions (ADRs)', 'Requirement → task mapping', 'Risks'],
  'review-report.md': ['Findings', 'Coverage', 'Boundary check'],
  'verification-report.md': ['Results', 'Beyond the happy path', 'Gaps'],
}

export const BUILTIN_WORK_ITEM_KEYS = [
  'id',
  'title',
  'requirements',
  'scope',
  'file_contact_surface',
  'acceptance_tests',
  'depends_on',
  'status',
  'notes',
]

/** Map a run-relative artifact path to its contract template filename. */
export function contractFor(path: string): string | null {
  const base = path.split('/').pop()!
  if (base === 'intent-brief.md') return 'intent-brief.md'
  if (base === 'spec.md') return 'spec.md'
  if (base === 'plan.md') return 'plan.md'
  if (/^review-\d+.*\.md$/.test(base)) return 'review-report.md'
  if (base === 'verification-report.md') return 'verification-report.md'
  if (base === 'state.yaml') return 'state.yaml'
  if (path.startsWith('tasks/') && base.endsWith('.yaml')) return 'work-item.yaml'
  return null // e.g. release-plan.md, retro.md — presence-only today
}

export interface ContractTemplates {
  /** Raw template text by contract filename, read from the target repo. */
  read(name: string): Promise<string | null>
}

export async function validateArtifact(
  path: string,
  content: string,
  templates: ContractTemplates,
): Promise<Validation> {
  const contract = contractFor(path)
  if (contract === null) return { contract: null, ok: true, missing: [], notes: [] }
  const notes: string[] = []

  if (contract === 'work-item.yaml') {
    let required = BUILTIN_WORK_ITEM_KEYS
    const template = await templates.read(contract)
    if (template) {
      try {
        const parsed = parseYaml(template)
        if (parsed && typeof parsed === 'object') required = Object.keys(parsed)
      } catch {
        notes.push('contract template unparseable; used built-in keys')
      }
    } else {
      notes.push('no contracts/ in repo; used built-in keys')
    }
    let keys: string[] = []
    try {
      const parsed = parseYaml(content)
      if (parsed && typeof parsed === 'object') keys = Object.keys(parsed)
      else return { contract, ok: false, missing: required, notes }
    } catch (e) {
      return { contract, ok: false, missing: [], notes: [...notes, `not valid YAML: ${(e as Error).message}`] }
    }
    const have = new Set(keys)
    const missing = required.filter((k) => !have.has(k))
    return { contract, ok: missing.length === 0, missing, notes }
  }

  if (contract === 'state.yaml') {
    // state.yaml is validated by schema.ts (parseRunState); here it's presence-only.
    return { contract, ok: true, missing: [], notes }
  }

  // Markdown contracts: required H2s from the repo's template, else built-in.
  let required = BUILTIN_SECTIONS[contract] ?? []
  const template = await templates.read(contract)
  if (template) {
    const fromTemplate = extractSections(template)
    if (fromTemplate.length) required = fromTemplate
  } else {
    notes.push('no contracts/ in repo; used built-in sections')
  }
  const have = new Set(extractSections(content).map(normalize))
  const missing = required.filter((s) => !have.has(normalize(s)))
  return { contract, ok: missing.length === 0, missing, notes }
}
