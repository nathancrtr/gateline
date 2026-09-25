// G3's packet (#403): the release plan, read for what "Ship it?" asks.
//
// Every gate but G3 had a composed surface. G3 fell through to the generic
// card — the question, the buttons, and one `release-plan.md` chip between
// them — because until #260 the plan had no contract to parse against. It has
// one now: `contracts/release-plan.md` fixes four bold preamble fields
// (`**Change released:**`, `**Environment:**`, `**Rollback trigger:**`,
// `**Rollback exercised:**`), an ordered Release steps list, and the five H2
// sections validation already requires.
//
// "Ship it?" is really a question about the irreversible step and whether
// the way back has been tried, and the contract says so ("Name any step that
// is irreversible; that is what the approver is really being asked about").
// So the packet leads with the two rollback facts, states CI health beside
// the change and its environment, lists the steps as the ordered acts they
// are, and carries the two audit-time sections for when they are needed.
//
// Presence, not verdicts — the line evidence.ts and g1.ts hold. Every value
// here is the record's own words. `**Rollback exercised:** no` is reported as
// the word `no`, which the view may set apart, but nothing here computes a
// risk, grades the plan, or calls a release unsafe. A step is marked
// irreversible only when the plan's own text says the word.
//
// Contracts are forkable. When a field the grammar fixes is absent, the
// fields view withholds itself and names the line it looked for; when the
// steps are not a numbered list, the steps view does the same. The rest of
// the packet still renders what it can, and the plan's own markdown is one
// click away either way.
import { splitSections } from '../record/sections.ts'

export interface ReleaseStep {
  /** The list number as written, e.g. 1 for `1. Tag the merge commit`. */
  n: number
  /** The step's text, verbatim, continuation lines joined with a space. */
  text: string
  /** The step's own text says "irreversible" — the record's word, not a judgement. */
  irreversible: boolean
}

export interface ReleasePacket {
  /** `release-plan.md` is in the record. Everything below is null or empty when it is not. */
  hasPlan: boolean
  /** `**Change released:**` value, verbatim. */
  changeReleased: string | null
  /** `**Environment:**` value, verbatim. */
  environment: string | null
  /** `**Rollback trigger:**` value, verbatim. */
  rollbackTrigger: string | null
  /** `**Rollback exercised:**` value, verbatim. */
  rollbackExercised: string | null
  /**
   * The first word of the exercised value, lower-cased, when it is `yes` or
   * `no` — the contract's two answers. Null otherwise: the value is shown as
   * written and nothing is inferred from it.
   */
  exercisedWord: 'yes' | 'no' | null
  /** The `## CI health` body, verbatim, trimmed. */
  ciHealth: string | null
  /** The `## Release steps` numbered list, in order. Empty when withheld. */
  steps: ReleaseStep[]
  /** The `## Rollback plan` body, verbatim, with the two field lines removed. */
  rollbackPlan: string | null
  /** The `## Verification after release` body, verbatim. */
  verificationAfter: string | null
  /** The `## Blast radius` body, verbatim. */
  blastRadius: string | null
  /** Why the fields view must withhold itself, or null. */
  fieldsWithheld: string | null
  /** Why the steps view must withhold itself, or null. */
  stepsWithheld: string | null
}

const FIELD = /^\*\*([^*]+?):\*\*\s*(.*)$/
const STEP = /^\s*(\d+)[.)]\s+(.*\S)\s*$/
const CONTINUATION = /^\s{2,}(\S.*)$/

const EMPTY: ReleasePacket = {
  hasPlan: false,
  changeReleased: null,
  environment: null,
  rollbackTrigger: null,
  rollbackExercised: null,
  exercisedWord: null,
  ciHealth: null,
  steps: [],
  rollbackPlan: null,
  verificationAfter: null,
  blastRadius: null,
  fieldsWithheld: null,
  stepsWithheld: null,
}

/**
 * The bold-label fields in a block of lines, keyed by label as written, and
 * the line indices each one occupied. A value soft-wraps the way markdown
 * prose does — the contract's budget puts one fact per field, not one line —
 * so it runs on over the following lines until a blank line or the next
 * field, joined with a space. A label that appears twice keeps its first
 * value: the record's first word on the matter, and the parser never chooses
 * between two.
 */
function fields(lines: string[]): { values: Map<string, string>; consumed: Set<number> } {
  const values = new Map<string, string>()
  const consumed = new Set<number>()
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD.exec(lines[i]!.trim())
    if (!m) continue
    const parts = [m[2]!.trim()]
    let j = i + 1
    while (j < lines.length && lines[j]!.trim() !== '' && !FIELD.test(lines[j]!.trim())) {
      parts.push(lines[j]!.trim())
      j++
    }
    if (!values.has(m[1]!)) values.set(m[1]!, parts.join(' ').trim())
    for (let k = i; k < j; k++) consumed.add(k)
    i = j - 1
  }
  return { values, consumed }
}

/** The numbered list in the Release steps body, one act per item. */
export function parseReleaseSteps(body: string): { steps: ReleaseStep[]; withheld: string | null } {
  // Prose between or around the items is not a deviation the view refuses
  // over: the list is what it renders, and the section is one click away.
  const steps: ReleaseStep[] = []
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue
    const m = STEP.exec(line)
    if (m) {
      steps.push({ n: Number(m[1]), text: m[2]!, irreversible: false })
      continue
    }
    const c = CONTINUATION.exec(line)
    if (c && steps.length > 0) {
      const last = steps[steps.length - 1]!
      last.text = `${last.text} ${c[1]}`
    }
  }
  for (const s of steps) s.irreversible = /\birreversible\b/i.test(s.text)
  if (steps.length === 0) {
    return { steps: [], withheld: 'Release steps is not a numbered list — the contract fixes one act per numbered item.' }
  }
  return { steps, withheld: null }
}

/** Compose G3's packet from the release plan alone. */
export function buildReleasePacket(input: { plan: string | null }): ReleasePacket {
  if (input.plan === null) return { ...EMPTY }
  const sections = splitSections(input.plan)
  const body = (heading: string): string | null => {
    const s = sections.find((x) => x.depth === 2 && x.heading === heading)
    return s ? s.body.trim() : null
  }
  const preamble = sections.find((s) => s.heading === null || s.depth === 1)
  const top = fields((preamble?.body ?? '').split('\n')).values
  const rollbackBody = body('Rollback plan')
  const rollbackLines = (rollbackBody ?? '').split('\n')
  const inRollback = fields(rollbackLines)

  const changeReleased = top.get('Change released') ?? null
  const environment = top.get('Environment') ?? null
  const rollbackTrigger = inRollback.values.get('Rollback trigger') ?? top.get('Rollback trigger') ?? null
  const rollbackExercised = inRollback.values.get('Rollback exercised') ?? top.get('Rollback exercised') ?? null

  const missing = [
    changeReleased === null && '**Change released:**',
    environment === null && '**Environment:**',
    rollbackTrigger === null && '**Rollback trigger:**',
    rollbackExercised === null && '**Rollback exercised:**',
  ].filter((x): x is string => typeof x === 'string')
  const fieldsWithheld =
    missing.length === 0
      ? null
      : `no ${missing.join(', ')} line — the contract fixes ${missing.length === 1 ? 'it' : 'them'} as bold-label lines.`

  const firstWord = rollbackExercised?.trim().split(/\s+/)[0]?.replace(/[^a-z]/gi, '').toLowerCase() ?? ''
  const exercisedWord = firstWord === 'yes' || firstWord === 'no' ? firstWord : null

  const stepsBody = body('Release steps')
  const parsed = stepsBody === null ? { steps: [], withheld: 'no Release steps section.' } : parseReleaseSteps(stepsBody)

  // The rollback prose, with the two fields lifted out — every line each one
  // occupied — so the fields are not said twice on the card. Byte-identical
  // otherwise.
  const rollbackPlan =
    rollbackBody === null
      ? null
      : rollbackLines
          .filter((_, i) => !inRollback.consumed.has(i))
          .join('\n')
          .trim()

  return {
    hasPlan: true,
    changeReleased,
    environment,
    rollbackTrigger,
    rollbackExercised,
    exercisedWord,
    ciHealth: body('CI health'),
    steps: parsed.steps,
    rollbackPlan,
    verificationAfter: body('Verification after release'),
    blastRadius: body('Blast radius'),
    fieldsWithheld,
    stepsWithheld: parsed.withheld,
  }
}
