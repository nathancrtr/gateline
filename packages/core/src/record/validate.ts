// Contract well-formedness (rule R3): required sections come from the target
// repo's own contracts/*.md templates at read time, so a fork that amends a
// contract validates against its own version. Built-in fallbacks cover repos
// that carry runs but no contracts/ tree.
import { parse as parseYaml } from 'yaml'
import { FenceTracker, h2Headings } from './sections.ts'

export interface Validation {
  /** Which contract this artifact was checked against, or null (no contract → presence-only). */
  contract: string | null
  ok: boolean
  /** Missing required section headings (markdown) or top-level keys (yaml). */
  missing: string[]
  /** Non-fatal notes (e.g. fell back to built-in template). */
  notes: string[]
  /**
   * Audit-time sections (#217), as the contract spells them: evidence the
   * approver reads when trust is in question rather than at every gate pass.
   * A viewer folds them to their heading; nothing else changes. Absent or
   * empty when the contract carries no `AUDIENCE:` line — a contract that
   * says nothing about audience renders exactly as before.
   */
  audit?: string[]
}

export type Audience = 'decide' | 'audit'

/**
 * The `AUDIENCE:` line of a contract header (#217): `<section>=<audience>`
 * pairs separated by `;`, e.g. `AUDIENCE: Coverage=audit; Boundary check=audit`.
 * Sections not listed are decide-time. Contract meaning, versioned with the
 * grammar — which is why it lives in the contract and not in a UI setting.
 * Keyed by normalized heading, so a fork that respells a heading still folds.
 */
export function extractAudience(template: string): Record<string, Audience> {
  const out: Record<string, Audience> = {}
  const fences = new FenceTracker()
  for (const line of template.split('\n')) {
    if (fences.feed(line)) continue // a fenced example of the grammar is an example
    const m = /^\s*(?:<!--\s*)?AUDIENCE:\s*(.+?)\s*(?:-->.*)?$/.exec(line)
    if (!m) continue
    // Pairs split on `;`, so a heading cannot itself contain one — a limit
    // the contracts accept rather than a grammar to escape.
    for (const pair of m[1]!.split(';')) {
      const eq = pair.lastIndexOf('=')
      if (eq < 0) continue
      const name = normalize(pair.slice(0, eq))
      const audience = pair.slice(eq + 1).trim().toLowerCase()
      if (name && (audience === 'decide' || audience === 'audit')) out[name] = audience
    }
  }
  return out
}

/** Built-in audit-time sections, mirroring the `AUDIENCE:` lines in contracts/ at the time of writing. */
export const BUILTIN_AUDIT_SECTIONS: Record<string, string[]> = {
  'review-report.md': ['Coverage', 'Boundary check'],
  'spec.md': ['Out of scope'],
}

/** H2 headings are the required-section signal in every markdown contract. */
export function extractSections(markdown: string): string[] {
  return h2Headings(markdown)
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Required section headings absent from `content` (normalize-insensitive,
 * fenced-code-block headings ignored via `extractSections`). The single
 * section-completeness truth shared by the CLI and the server (AC2.2) —
 * narrower than `validateArtifact` because callers here already hold the
 * resolved required-section list (e.g. the staging route also serves it to
 * the form) rather than re-reading a template per call. */
export function missingSections(content: string, required: string[]): string[] {
  const have = new Set(extractSections(content).map(normalize))
  return required.filter((s) => !have.has(normalize(s)))
}

/** The verification report's overall verdict vocabulary (#152). */
export const VERIFICATION_VERDICTS = ['pass', 'fail', 'escalate'] as const
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number]

/**
 * Every `**Verdict:** <text>` line outside a code fence, verbatim after the
 * label, in order (#152). One parser for the orchestrator and Gatehouse, so
 * the two can never disagree about what a report says. A re-verification
 * appended to the report adds a line; the LAST one is the verdict in force,
 * the same reading the reviewer's rounds get.
 */
export function verdictLines(markdown: string): string[] {
  const out: string[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence) continue
    const m = /^\*{2}Verdict:\*{2}\s*(.*?)\s*$/.exec(line)
    if (m) out.push(m[1]!)
  }
  return out
}

/** The verdict word a line carries, or null when the line is anything but exactly one of the three. */
export function verificationVerdict(line: string | null | undefined): VerificationVerdict | null {
  const word = line?.trim().toLowerCase()
  return word && (VERIFICATION_VERDICTS as readonly string[]).includes(word) ? (word as VerificationVerdict) : null
}

/** Built-in section lists, mirroring contracts/ at the time of writing. */
export const BUILTIN_SECTIONS: Record<string, string[]> = {
  'intent-brief.md': ['Problem', 'Motivation', 'Constraints', 'Out of scope'],
  'spec.md': ['Context', 'Requirements', 'Assumptions', 'Out of scope'],
  'plan.md': ['Approach', 'Interface contracts', 'Decisions (ADRs)', 'Requirement → task mapping', 'Risks'],
  'review-report.md': ['Findings', 'Coverage', 'Boundary check'],
  'verification-report.md': ['Results', 'Beyond the happy path', 'Gaps'],
  'release-plan.md': ['CI health', 'Release steps', 'Rollback plan', 'Verification after release', 'Blast radius'],
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
  // G3's packet is checkable as of #260. Before that it was bare presence: a
  // release plan of one sentence passed exactly as one carrying a rollback,
  // and G3 was the one gate no structured surface could be built for.
  if (base === 'release-plan.md') return 'release-plan.md'
  if (base === 'state.yaml') return 'state.yaml'
  if (path.startsWith('tasks/') && base.endsWith('.yaml')) return 'work-item.yaml'
  return null // e.g. retro.md — presence-only, and human-authored
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
  let audit = BUILTIN_AUDIT_SECTIONS[contract] ?? []
  const template = await templates.read(contract)
  if (template) {
    const fromTemplate = extractSections(template)
    if (fromTemplate.length) required = fromTemplate
    // The template's own word on audience, or silence: a contract with no
    // `AUDIENCE:` line folds nothing, whatever the built-in list says.
    const audience = extractAudience(template)
    audit = fromTemplate.filter((s) => audience[normalize(s)] === 'audit')
  } else {
    notes.push('no contracts/ in repo; used built-in sections')
  }
  const have = new Set(extractSections(content).map(normalize))
  const missing = required.filter((s) => !have.has(normalize(s)))
  // A verdict line that is present but not one of the three words is a
  // deviation from the grammar, and bounces like one (#152). Absence is not:
  // every report written before the line exists is a finished run's record.
  if (contract === 'verification-report.md') {
    const last = verdictLines(content).at(-1)
    if (last !== undefined && verificationVerdict(last) === null) missing.push('Verdict: pass | fail | escalate')
  }
  return { contract, ok: missing.length === 0, missing, notes, audit }
}
