// A spec criterion's check starts a line of its own in the Record reader, as
// it does in the file (R5). Markdown folds a criterion's lines into one
// paragraph, so a check written on the line under its promise would run on
// from the promise's last word. This stage finds that line in the rendered
// list item and wraps it in a block. It reads the rendered tree only — the
// lexicon splits the same criterion for the cards, by the same rule (a
// continuation line beginning `Check:`, case-sensitive), and the browser test
// compares the two so they cannot drift apart unseen.
//
// Type-only imports: this module ships in the browser bundle.

import type { ArtifactKind } from '../api.ts'

export interface HNode {
  type: string
  tagName?: string
  value?: string
  children?: HNode[]
  properties?: Record<string, unknown>
}

/** A criterion's list item opens with its id and a dash — the test `lexiconRehype` uses. */
const CRITERION = /^\s*(AC\d+\.\d+)\s+—/

/** A line break followed directly by the label. The first line never matches: it has no break before it. */
const CHECK_LINE = /\n(?=Check:)/

/** Where an item's inline run ends: a nested list, or any other block a tight item holds. */
const BLOCK = new Set(['ul', 'ol', 'p', 'pre', 'blockquote', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'])

const textOf = (node: HNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')

const isElement = (node: HNode | undefined, tag: string) => node?.type === 'element' && node.tagName === tag

/** Wrap the item's check, if it has one. An item without one keeps every node as it was. */
function wrapCheck(li: HNode): void {
  // A loose list wraps the item's text in a paragraph; a tight one leaves it inline.
  const holder = li.children?.find((c) => isElement(c, 'p')) ?? li
  const inline = holder.children ?? []
  let end = inline.findIndex((c) => c.type === 'element' && BLOCK.has(c.tagName ?? ''))
  if (end === -1) end = inline.length
  // Only direct text children are searched, so code, links and nested lists are skipped.
  const at = inline.findIndex((c, i) => i < end && c.type === 'text' && CHECK_LINE.test(c.value ?? ''))
  if (at === -1) return
  // The line end the hast converter inserts before a nested block is not the check's words.
  while (end > at + 1 && inline[end - 1]!.type === 'text' && /^\s*$/.test(inline[end - 1]!.value ?? '')) end--
  const value = inline[at]!.value!
  const split = value.search(CHECK_LINE) + 1
  const check: HNode = {
    type: 'element',
    tagName: 'span',
    properties: { dataCriterionCheck: '', className: ['block'] },
    children: [{ type: 'text', value: value.slice(split) }, ...inline.slice(at + 1, end)],
  }
  holder.children = [...inline.slice(0, at), { type: 'text', value: value.slice(0, split) }, check, ...inline.slice(end)]
}

/** A rehype plugin. It acts only on a spec, the one artifact whose list items define criteria. */
export const criterionCheckRehype = (sourceKind?: ArtifactKind) => () => (tree: HNode) => {
  if (sourceKind !== 'spec') return
  const walk = (node: HNode) => {
    if (isElement(node, 'li') && CRITERION.test(textOf(node))) wrapCheck(node)
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
}
