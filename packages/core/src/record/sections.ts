// Where an artifact's sections begin and end (#217), read the way CommonMark
// reads fences and headings — the same reading `extractSections` validates
// with and Gatehouse folds with, so validation and rendering can never
// disagree about a heading. The earlier heuristic toggled a fence on any line
// starting with three backticks; a prose line beginning with a backtick run
// (runs/mdtoc/review-01.md has one) swallowed the rest of the file.

/** Tracks fenced code blocks per CommonMark: opener `{0,3}(`{3,}|~{3,})`, a
 *  backtick opener's info string may not contain a backtick, and a closer is
 *  the same character at least as long with nothing else on the line. */
export class FenceTracker {
  private open: { char: string; length: number } | null = null

  /** A fence is open: the next line is inside it (or closes it). */
  get isOpen(): boolean {
    return this.open !== null
  }

  /** Feed one line; returns true when the line is inside (or delimits) a fence. */
  feed(line: string): boolean {
    if (this.open) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1]![0] === this.open.char && close[1]!.length >= this.open.length) this.open = null
      return true
    }
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      this.open = { char: m[1]![0]!, length: m[1]!.length }
      return true
    }
    return false
  }
}

export interface Section {
  /** The heading text, or null for whatever precedes the first heading. */
  heading: string | null
  /** 1 or 2: an H1 (a review's appended round, say) opens a section too, so nothing hides under the previous H2. */
  depth: 1 | 2 | null
  /** The heading line itself, when there is one — rendered by whoever renders the heading. */
  headingLine: string | null
  /** The section's body, without its heading line. */
  body: string
  /**
   * The 1-based line of the artifact the section starts on: its heading line,
   * or line 1 for the preamble; a heading's body starts on the next line. It is
   * the numbering every `file:line` address uses, so a view that renders
   * section by section can still land on a quoted line (#441).
   */
  line: number
}

/**
 * Split at H1 and H2 headings outside fences. Re-joining
 * `headingLine + "\n" + body` over every section yields the artifact
 * byte-identical; an empty preamble is dropped.
 */
export function splitSections(markdown: string): Section[] {
  const out: Section[] = []
  const fences = new FenceTracker()
  let current: Section = { heading: null, depth: null, headingLine: null, body: '', line: 1 }
  let lines: string[] = []
  const flush = () => {
    current.body = lines.join('\n')
    out.push(current)
  }
  for (const [i, line] of markdown.split('\n').entries()) {
    const inFence = fences.feed(line)
    const m = !inFence && /^(#{1,2})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      flush()
      current = { heading: m[2]!, depth: m[1]!.length as 1 | 2, headingLine: line, body: '', line: i + 1 }
      lines = []
      continue
    }
    lines.push(line)
  }
  flush()
  return out.filter((s, i) => i > 0 || s.body.trim() !== '')
}

/** H2 headings outside fences — the required-section signal in every markdown contract. */
export function h2Headings(markdown: string): string[] {
  return splitSections(markdown)
    .filter((s) => s.depth === 2)
    .map((s) => s.heading!)
}
