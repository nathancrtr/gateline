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

// Marking the landing (#449). The scroll puts the block at the top of the
// window only when the artifact is long enough to scroll that far; a short
// one stops at its end, with the target on screen and nothing saying which it
// is. So the reader marks it, in its own voice and not the record's: a rule in
// the gutter beside the block, outside the text, in the ink. The record's
// words are never tinted by a condition they do not state (docs/SEAM.md §5),
// and a landing is not a gate state, so the mark spends no hue. The yellow
// stays the focus ring's and the gate on the table's (packages/web/DESIGN.md,
// settled decision 4).

/** How far left of the artifact's column the mark sits, in px: inside the reader's padding at every width. */
export const LANDING_GUTTER = 12

/** A box, in the viewport coordinates `getBoundingClientRect` reports. */
export interface Rect {
  top: number
  left: number
  height: number
}

/**
 * Where the mark sits, in the coordinates of the reader's `<article>` (its
 * containing block): level with the landed block and as tall, at one gutter
 * position for every block, so a nested list item's mark lines up with a
 * heading's.
 */
export function landingMark(block: Rect, column: Pick<Rect, 'left'>, article: Pick<Rect, 'top' | 'left'>): Rect {
  return { top: block.top - article.top, left: column.left - article.left - LANDING_GUTTER, height: block.height }
}
