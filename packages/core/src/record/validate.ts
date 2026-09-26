// Contract well-formedness (rule R3): required sections come from the target
// repo's own contracts/*.md templates at read time, so a fork that amends a
// contract validates against its own version. Built-in fallbacks cover repos
// that carry runs but no contracts/ tree.
import { parse as parseYaml } from 'yaml'
import { describeArtifact } from './artifact.ts'
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

/**
 * The `REQUIRED WHEN:` line of a contract header (#405): `<section>=<verdict>`
 * pairs separated by `;`, e.g. `REQUIRED WHEN: Escalation=escalate`. A section
 * so listed is required exactly when the report's verdict in force is that
 * word, and is otherwise not required — not forbidden: rounds and
 * re-verifications append and never overwrite, so a section an earlier round
 * wrote stays in the file as history. Keyed by normalized heading, like the
 * audience map, and read the same way: the template's own word, never a
 * UI's. Sections in this map are lifted out of the unconditional list a
 * template's H2s would otherwise imply.
 */
export function extractConditional(template: string): Record<string, string> {
  const out: Record<string, string> = {}
  const fences = new FenceTracker()
  for (const line of template.split('\n')) {
    if (fences.feed(line)) continue
    const m = /^\s*(?:<!--\s*)?REQUIRED WHEN:\s*(.+?)\s*(?:-->.*)?$/.exec(line)
    if (!m) continue
    for (const pair of m[1]!.split(';')) {
      const eq = pair.lastIndexOf('=')
      if (eq < 0) continue
      const name = normalize(pair.slice(0, eq))
      const verdict = pair.slice(eq + 1).trim().toLowerCase()
      if (name && verdict) out[name] = verdict
    }
  }
  return out
}

/** Built-in conditional sections, mirroring the `REQUIRED WHEN:` lines in contracts/ at the time of writing. */
export const BUILTIN_CONDITIONAL_SECTIONS: Record<string, Record<string, string>> = {
  'review-report.md': { Escalation: 'escalate' },
  'verification-report.md': { Escalation: 'escalate' },
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

/**
 * Map a run-relative artifact path to its contract template filename — the
 * `contract` half of `describeArtifact`, which is the one place a path's kind
 * is derived (#415). Null for a file checked for presence only (`retro.md`).
 */
export function contractFor(path: string): string | null {
  return describeArtifact(path).contract
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
  // Sections required only under one verdict (#405), keyed by normalized
  // heading, spelled as the template spells them for the message.
  let conditional: Record<string, string> = Object.fromEntries(
    Object.entries(BUILTIN_CONDITIONAL_SECTIONS[contract] ?? {}).map(([heading, verdict]) => [normalize(heading), verdict]),
  )
  let spelled: Record<string, string> = Object.fromEntries(
    Object.keys(BUILTIN_CONDITIONAL_SECTIONS[contract] ?? {}).map((heading) => [normalize(heading), heading]),
  )
  const template = await templates.read(contract)
  if (template) {
    const fromTemplate = extractSections(template)
    // The template's own word on conditions, or silence: a contract with no
    // `REQUIRED WHEN:` line requires every H2 it carries, unconditionally.
    conditional = extractConditional(template)
    spelled = Object.fromEntries(fromTemplate.map((s) => [normalize(s), s]))
    const unconditional = fromTemplate.filter((s) => !(normalize(s) in conditional))
    if (unconditional.length) required = unconditional
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
  // A section the contract requires under the verdict in force (#405): the
  // last verdict line's first word, since rounds append. A report with no
  // verdict line has no verdict in force and no conditional section is
  // required of it — the same leniency #152 gives the line itself.
  const inForce = verdictLines(content).at(-1)?.trim().split(/\s+/)[0]?.toLowerCase() ?? null
  for (const [key, verdict] of Object.entries(conditional)) {
    if (inForce === verdict && !have.has(key)) missing.push(`${spelled[key] ?? key} (required when Verdict is ${verdict})`)
  }
  return { contract, ok: missing.length === 0, missing, notes, audit }
}
