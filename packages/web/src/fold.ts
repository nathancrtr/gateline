/**
 * Decide-time versus audit-time sections (#217). The contract says which of
 * an artifact's sections are evidence rather than the thing being decided;
 * the reader folds those to their heading plus a one-line count. Folding is
 * never truncation: every word stays in the record and one click away,
 * verbatim. The split itself lives in core (`splitSections`), the same
 * reading validation uses, so the two never disagree about a heading.
 */

/** Heading match the way the validator matches them: case- and punctuation-insensitive. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Is this heading one the contract marks audit-time? Exact after
 * normalization, or the same heading with a round qualifier appended the way
 * an appended review round spells it (`## Coverage (round 2)`), so both
 * rounds of one file fold the same way.
 */
export function isAuditSection(heading: string, audit: readonly string[]): boolean {
  const key = normalize(heading)
  return audit.some((a) => {
    const n = normalize(a)
    return key === n || new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} round \\d+$`).test(key)
  })
}

/**
 * The count that stands in for a folded body: table rows when the section is
 * a table, list items when a list, paragraphs otherwise — where a paragraph
 * is a run of non-blank prose lines, not a rule, a comment, or a table line.
 * Arithmetic over the text, no reading of it.
 */
export function itemCount(body: string): { n: number; unit: string } {
  let inFence = false
  let items = 0
  let rows = 0
  let paragraphs = 0
  let inParagraph = false
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      inParagraph = false
      continue
    }
    if (inFence) continue
    const isItem = /^\s*([-*+]|\d+\.)\s+/.test(line)
    const isTable = /^\s*\|/.test(line)
    const isRule = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    const isComment = /^\s*<!--/.test(line)
    if (isItem) items++
    else if (isTable && !/^\s*\|[\s:|-]+\|?\s*$/.test(line)) rows++
    if (line.trim() === '' || isRule || isComment || isTable) inParagraph = false
    else if (!inParagraph) {
      inParagraph = true
      paragraphs++
    }
  }
  if (rows > 1) return { n: rows - 1, unit: rows - 1 === 1 ? 'row' : 'rows' }
  if (items > 0) return { n: items, unit: items === 1 ? 'item' : 'items' }
  return { n: paragraphs, unit: paragraphs === 1 ? 'paragraph' : 'paragraphs' }
}
