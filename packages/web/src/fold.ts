/**
 * Decide-time versus audit-time sections (#217). The contract says which of
 * an artifact's sections are evidence rather than the thing being decided;
 * this splits the artifact at its H2s so the reader can fold those to their
 * heading plus a one-line count. Folding is never truncation: every word
 * stays in the record and one click away, verbatim.
 */

export interface Section {
  /** The H2 text, or null for whatever precedes the first H2. */
  heading: string | null
  /** The heading line itself, when there is one — rendered by the fold, not the body. */
  headingLine: string | null
  /** The section's body, without its heading line. */
  body: string
}

/** Split at H2 headings outside code fences, the same reading `extractSections` uses. */
export function splitSections(markdown: string): Section[] {
  const out: Section[] = []
  let current: Section = { heading: null, headingLine: null, body: '' }
  let inFence = false
  const lines = markdown.split('\n')
  const bodies: string[][] = [[]]
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const m = !inFence && /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      current.body = bodies[bodies.length - 1]!.join('\n')
      out.push(current)
      current = { heading: m[1]!, headingLine: line, body: '' }
      bodies.push([])
      continue
    }
    bodies[bodies.length - 1]!.push(line)
  }
  current.body = bodies[bodies.length - 1]!.join('\n')
  out.push(current)
  // The preamble is dropped only when it is empty: a report's verdict lines live there.
  return out.filter((s, i) => i > 0 || s.body.trim() !== '')
}

/** Heading match the way the validator matches them: case- and punctuation-insensitive. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function isAuditSection(heading: string, audit: readonly string[]): boolean {
  const key = normalize(heading)
  return audit.some((a) => normalize(a) === key)
}

/**
 * The count that stands in for a folded body: list items or table rows when
 * the section is a list or a table, paragraphs otherwise. Arithmetic over the
 * text, no reading of it.
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
      continue
    }
    if (inFence) continue
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) items++
    else if (/^\s*\|/.test(line) && !/^\s*\|[\s:|-]+\|?\s*$/.test(line)) rows++
    if (line.trim() === '') inParagraph = false
    else if (!inParagraph) {
      inParagraph = true
      paragraphs++
    }
  }
  if (rows > 1) return { n: rows - 1, unit: rows - 1 === 1 ? 'row' : 'rows' }
  if (items > 0) return { n: items, unit: items === 1 ? 'item' : 'items' }
  return { n: paragraphs, unit: paragraphs === 1 ? 'paragraph' : 'paragraphs' }
}
