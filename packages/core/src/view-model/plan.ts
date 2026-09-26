// The plan's Requirement → task mapping (#255), read back as rows.
//
// `contracts/plan.md` mandates the table and states outright that an uncovered
// requirement is a malformed plan. Gatehouse has held both sides of that check
// for as long as it has had a lexicon — the spec's `R<n>` set and the plan's
// mapping — and has never compared them. This module reads one side.
//
// Every field is a verbatim slice of plan.md: a cell is the author's own text,
// a task token is the token they wrote. Nothing is normalized into an id, and
// nothing is judged — whether a mapping is right is the G1 approver's call.
//
// Browser-safe leaf: zero imports, enforced by g1.test.ts, so a host can
// serve the parse as plain data to clients that must not bundle the core
// runtime (the seam lexicon.ts, review.ts and tasks.ts already use).

export interface MappingRow {
  /**
   * The Requirement cell, verbatim. Usually a bare `R<n>`; a cell naming
   * several ids or carrying prose stays exactly as written.
   */
  cell: string
  /** Requirement ids found in the cell, in order — the join key. */
  requirements: string[]
  /** Task tokens from the Task(s) cell, verbatim and in declared order. */
  tasks: string[]
  /** The whole row, verbatim. */
  text: string
  /** 1-based line of the row. */
  line: number
}

export interface RequirementMapping {
  rows: MappingRow[]
  /**
   * Why a structured reading must withhold itself, or null. Contracts are
   * forkable: a plan may legitimately carry another shape, and the honest move
   * is to name the shape looked for and fall back to the markdown, never to
   * report an empty mapping as full coverage.
   *
   * The grammar looked for, never a sentence (#424): `g1.ts` adds where it
   * looked, and each surface composes its own words. Written structurally —
   * this leaf imports nothing — so it is `withheld.ts`'s `WithheldGrammar`.
   */
  withheld: { grammar: string; token?: string } | null
}

/** The heading the contract fixes for the mapping, as the record spells it. */
const MAPPING_HEADING = '## Requirement → task mapping'

const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const FENCE = /^\s*(```|~~~)/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
const DIVIDER_CELL = /^:?-{2,}:?$/
const REQUIREMENT_ID = /\bR\d+\b/g

/** Heading text reduced to words, so a fork's punctuation does not matter. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Is this the mapping heading? `## Requirement → task mapping` is the shape the
 * contract fixes; a fork writing "Requirements to task mapping" means the same
 * section, and refusing to read it would withhold over punctuation. Anything
 * that does not name requirements, tasks and a mapping is a different section.
 */
function isMappingHeading(title: string): boolean {
  const words = normalize(title).split(' ')
  return words.some((w) => w.startsWith('requirement')) && words.some((w) => w.startsWith('task')) && words.includes('mapping')
}

function cellsOf(row: string): string[] {
  return TABLE_ROW.exec(row)![1]!.split('|').map((c) => c.trim())
}

const isDivider = (cells: string[]) => cells.length > 0 && cells.every((c) => DIVIDER_CELL.test(c.replace(/\s+/g, '')))

/**
 * Task tokens in a Task(s) cell. Authors separate them with commas, `+`, or
 * `and`; each token keeps its own text minus code-span backticks, which are
 * markdown punctuation rather than part of the name.
 */
function taskTokens(cell: string): string[] {
  return cell
    .split(/[,;+]|\band\b/)
    .map((t) => t.replace(/`/g, '').trim())
    .filter((t) => t !== '' && t !== '—' && t !== '-')
}

/**
 * Parse the mapping table out of a plan.
 *
 * The section is found by heading, and the first markdown table under it is the
 * mapping — the contract fixes one table there, and a plan carrying prose
 * between the heading and the table still reads.
 */
export function parseRequirementMapping(plan: string | null): RequirementMapping {
  if (plan === null) {
    return { rows: [], withheld: { grammar: 'a plan' } }
  }
  const lines = plan.split('\n')
  let inFence = false
  let depth: number | null = null
  let start = -1

  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) inFence = !inFence
    if (inFence) continue
    const heading = HEADING.exec(lines[i]!)
    if (!heading) continue
    if (depth === null) {
      if (isMappingHeading(heading[2]!)) {
        depth = heading[1]!.length
        start = i + 1
      }
      continue
    }
    // The section ends at the next heading of the same or higher level.
    if (heading[1]!.length <= depth) {
      lines.length = i
      break
    }
  }

  if (depth === null) {
    return { rows: [], withheld: { grammar: 'a section headed', token: MAPPING_HEADING } }
  }

  const rows: MappingRow[] = []
  inFence = false
  for (let i = start; i < lines.length; i++) {
    if (FENCE.test(lines[i]!)) inFence = !inFence
    if (inFence) continue
    const line = lines[i]!
    if (!TABLE_ROW.test(line)) continue
    const cells = cellsOf(line)
    if (isDivider(cells)) continue
    // The header row names its columns rather than a requirement; it carries no
    // requirement id, which is exactly what distinguishes it from a data row.
    const ids = [...(cells[0] ?? '').matchAll(REQUIREMENT_ID)].map((m) => m[0])
    if (ids.length === 0) continue
    rows.push({ cell: cells[0] ?? '', requirements: ids, tasks: taskTokens(cells[1] ?? ''), text: line.trim(), line: i + 1 })
  }

  return {
    rows,
    withheld: rows.length === 0 ? { grammar: 'a table row naming a requirement under', token: MAPPING_HEADING } : null,
  }
}
