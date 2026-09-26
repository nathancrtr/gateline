// Landing a `file:line` address on its line in the Record reader (#441,
// docs/SEAM.md §12: "reach the artifact behind any quoted slice in one click,
// landing on the line with its fold open").
//
// The reader stamps each block element of a markdown artifact with the file
// lines it spans (`data-line`, `data-line-end`, from `Markdown`'s `line`
// prop), in the artifact's own 1-based numbering: the numbering core's
// quotations carry in `at.line`. An address asks for `?anchor=L<n>`; the
// reader resolves it here rather than through an element id, because many
// blocks can start on one line (a list, its first item, the item's
// paragraph) and an id names only one element, and because `def-R<n>` ids
// already live on headings.
//
// The landing rule: the innermost block whose line range contains the line.
// A quoted line inside a multi-line paragraph or list lands on the block that
// holds it. A line that no block holds (a blank line, a template comment the
// reader drops) lands on the next block below it. A line past the last block
// lands nowhere, and the artifact opens at its top as before.

/** The anchor a line address carries. */
export const lineAnchor = (line: number): string => `L${line}`

/** The line an anchor names, or null when it is not a line anchor (a `def-<id>` heading, say). */
export function lineOfAnchor(anchor: string): number | null {
  const m = /^L([1-9]\d*)$/.exec(anchor)
  return m ? Number(m[1]) : null
}

/** A stamped block's span: the first and last file lines it renders. */
export interface LineSpan {
  start: number
  end: number
}

/**
 * Which block, of `spans` in document order, a line lands on: its index, or
 * -1. Document order puts an ancestor before its descendants, so the last
 * span containing the line is the innermost one.
 */
export function landingIndex(spans: readonly LineSpan[], line: number): number {
  let inside = -1
  let below = -1
  for (const [i, s] of spans.entries()) {
    if (s.start <= line && line <= s.end) inside = i
    else if (below === -1 && s.start > line) below = i
  }
  return inside !== -1 ? inside : below
}
