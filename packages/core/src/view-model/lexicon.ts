// The run lexicon (#163): R/AC/ADR definitions extracted verbatim from a
// run's own spec.md and plan.md. Grammar per contracts/spec.md and
// contracts/plan.md (normative since #162): `### R<n> — <short name>`
// headings, `AC<n>.<m> — <criterion>` list items, and
// `### ADR-<n>[ (<qualifier>)]: <decision>` headings (the qualifier form
// carries amendments). Derived at read time, never stored; a definition is
// the exact artifact bytes, never a paraphrase. This module is a
// browser-safe leaf — zero imports, enforced by lexicon.test.ts — so hosts
// serve entries and ID_PATTERN as plain data to clients that must not
// bundle the core runtime (see web/src/api.ts).

export type LexiconKind = 'requirement' | 'criterion' | 'decision'

export interface LexiconEntry {
  /** 'R5' | 'AC10.2' | 'ADR-8' */
  id: string
  kind: LexiconKind
  /** Heading title for requirements/decisions; '' for criteria. */
  shortName: string
  /** Verbatim definition block: the heading or list item through the end of
   * its body. A requirement's block stops before its acceptance-criteria
   * list — criteria are first-class entries of their own, and a card that
   * repeats them renders the same content twice. */
  definition: string
  /** What a human-facing card or footnote shows under a header that already
   * names the id: the definition minus its defining marker — and for
   * decisions, just the `**Choice:**` line (the decision in force; the
   * Rejected/Consequences argument stays behind the click-through). Falls
   * back to the full block body when no Choice bullet exists. Derived by
   * elision only — never rewording. */
  body: string
  /** Run-relative path of the defining artifact ('spec.md' | 'plan.md'). */
  artifact: string
  /** 1-based line where the definition starts. */
  line: number
  /** Parenthetical heading qualifier, e.g. 'amended 2026-07-13, G1 decline'. */
  qualifier?: string
}

export interface Lexicon {
  /** Every definition in document order. Duplicate ids (an ADR and its
   * amendment) are all kept; resolveId picks the last — the one in force. */
  entries: LexiconEntry[]
}

/** The id-reference grammar, exported as a regex source string so it can
 * travel over an API as data. Always instantiate with the 'g' flag. */
export const ID_PATTERN = String.raw`\b(?:R\d+|AC\d+\.\d+|ADR-\d+)\b`

const ANY_HEADING = /^#{1,6}\s/
const R_HEADING = /^#{1,6}\s*R(\d+)\s+—\s+(.+?)\s*$/
const ADR_HEADING = /^#{1,6}\s*ADR-(\d+)(?:\s*\(([^)]+)\))?:\s*(.+?)\s*$/
const AC_ITEM = /^\s*[-*]\s*(?:\[[ xX]\]\s*)?(AC\d+\.\d+)\s+—\s*(.*)$/
const AC_LABEL = /^\s*\*\*Acceptance criteria:?\*\*/i
const CHOICE_ITEM = /^\s*[-*]\s*\*\*Choice:?\*\*\s*(.*)$/i
const LIST_ITEM = /^\s*[-*]\s/
const FENCE = /^\s*(```|~~~)/

interface Line {
  text: string
  /** 1-based. */
  n: number
  inFence: boolean
}

function toLines(text: string): Line[] {
  let inFence = false
  return text.split('\n').map((raw, i) => {
    if (FENCE.test(raw)) inFence = !inFence
    return { text: raw, n: i + 1, inFence }
  })
}

/** The block from `start` up to (not including) the next heading outside a
 * fence — or an earlier `stop` line — trailing blank lines trimmed.
 * Verbatim — no reflow, no rewording. */
function blockFrom(lines: Line[], start: number, stop?: (text: string) => boolean): string {
  let end = start + 1
  while (
    end < lines.length &&
    (lines[end]!.inFence || (!ANY_HEADING.test(lines[end]!.text) && !(stop && stop(lines[end]!.text))))
  )
    end++
  while (end > start + 1 && lines[end - 1]!.text.trim() === '') end--
  return lines
    .slice(start, end)
    .map((l) => l.text)
    .join('\n')
}

/** A block's body: everything after its first (defining) line. */
function bodyOf(block: string): string {
  return block.split('\n').slice(1).join('\n').trim()
}

/** A list item plus its wrapped continuation lines (ends at a blank line,
 * a heading, or the next list item). */
function itemFrom(lines: Line[], start: number): string {
  let end = start + 1
  while (
    end < lines.length &&
    lines[end]!.text.trim() !== '' &&
    (lines[end]!.inFence || (!ANY_HEADING.test(lines[end]!.text) && !LIST_ITEM.test(lines[end]!.text)))
  )
    end++
  return lines
    .slice(start, end)
    .map((l) => l.text)
    .join('\n')
}

/** Extract the lexicon from a run's artifacts. Absent or unparsable input
 * degrades to fewer entries, never an error — references to missing
 * definitions surface as unresolved at the rendering layer. */
export function buildLexicon(input: { spec?: string | null; plan?: string | null }): Lexicon {
  const entries: LexiconEntry[] = []

  if (input.spec) {
    const lines = toLines(input.spec)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.inFence) continue
      const r = R_HEADING.exec(line.text)
      if (r) {
        const definition = blockFrom(lines, i, (t) => AC_LABEL.test(t) || AC_ITEM.test(t))
        entries.push({
          id: `R${r[1]}`,
          kind: 'requirement',
          shortName: r[2]!,
          definition,
          body: bodyOf(definition),
          artifact: 'spec.md',
          line: line.n,
        })
        continue
      }
      const ac = AC_ITEM.exec(line.text)
      if (ac) {
        const definition = itemFrom(lines, i)
        // A criterion is one wrapped sentence; its body joins the
        // continuation lines back into it (elision of markers, no rewording).
        const body = [ac[2]!, ...definition.split('\n').slice(1).map((l) => l.trim())].join(' ').trim()
        entries.push({
          id: ac[1]!,
          kind: 'criterion',
          shortName: '',
          definition,
          body,
          artifact: 'spec.md',
          line: line.n,
        })
      }
    }
  }

  if (input.plan) {
    const lines = toLines(input.plan)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.inFence) continue
      const adr = ADR_HEADING.exec(line.text)
      if (adr) {
        const definition = blockFrom(lines, i)
        // A decision's card body is its Choice line; the argument lives at
        // the definition. Fall back to the full body when the block does not
        // follow the contract's Choice/Rejected/Consequences shape.
        let body = bodyOf(definition)
        const end = i + definition.split('\n').length
        for (let j = i + 1; j < end; j++) {
          const c = CHOICE_ITEM.exec(lines[j]!.text)
          if (c && !lines[j]!.inFence) {
            const item = itemFrom(lines, j)
            body = [c[1]!, ...item.split('\n').slice(1).map((l) => l.trim())].join(' ').trim()
            break
          }
        }
        entries.push({
          id: `ADR-${adr[1]}`,
          kind: 'decision',
          shortName: adr[3]!,
          definition,
          body,
          artifact: 'plan.md',
          line: line.n,
          ...(adr[2] ? { qualifier: adr[2] } : {}),
        })
      }
    }
  }

  return { entries }
}

/** The definition in force for an id: the last one in document order, so an
 * amended ADR supersedes the original it follows. */
export function resolveId(lexicon: Lexicon, id: string): LexiconEntry | undefined {
  for (let i = lexicon.entries.length - 1; i >= 0; i--) if (lexicon.entries[i]!.id === id) return lexicon.entries[i]
  return undefined
}

/** Every id cited in a text — unique, in first-appearance order. Fenced
 * blocks are scanned too: evidence blocks cite criteria from inside fences. */
export function scanIds(text: string): string[] {
  const re = new RegExp(ID_PATTERN, 'g')
  const seen = new Set<string>()
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** 'AC10.2' → 'R10': the requirement a criterion belongs to by numbering. */
export function criterionRequirement(id: string): string {
  return `R${id.slice(2).split('.')[0]}`
}
