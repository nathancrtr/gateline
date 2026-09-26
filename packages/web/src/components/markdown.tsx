import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactKind } from '../api.ts'
import { LexRef, lexiconRehype, useLexicon } from './lexicon.tsx'

interface HNode {
  type: string
  value?: string
  children?: HNode[]
}

const COMMENT = /^\s*<!--[\s\S]*-->\s*$/

/**
 * Raw HTML in the record is the record's characters, not markup to obey or
 * drop (#434, the byte-identity rule). `react-markdown` never executes it —
 * there is no `rehype-raw` — and `skipHtml` used to delete it, which silently
 * ate every `<placeholder>` an agent wrote: a scope saying "`<main>` still
 * renders `<Outlet/>`" read "still renders ;", a note lost its `<branch>`.
 * Each raw node becomes the text it was, so the words survive as written and
 * the lexicon stage after this one still resolves ids inside them.
 *
 * The one exception is an HTML comment standing alone as the node: a
 * drafting note or a contract's header (`<!-- AUDIENCE: … -->`), which the
 * artifact's author wrote not to be read as prose (markdown-html.test.ts).
 */
export const rawAsText = () => (tree: HNode) => {
  const walk = (node: HNode) => {
    if (!node.children) return
    const out: HNode[] = []
    for (const child of node.children) {
      if (child.type === 'raw') {
        if (!COMMENT.test(child.value ?? '')) out.push({ type: 'text', value: child.value ?? '' })
        continue
      }
      walk(child)
      out.push(child)
    }
    node.children = out
  }
  walk(tree)
}

/** The blocks a line address can land on (#441). Inline nodes carry positions too, but a line is found by the block holding it. */
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'tr', 'hr'])

interface Positioned {
  type: string
  tagName?: string
  properties?: Record<string, unknown>
  position?: { start: { line: number }; end: { line: number } }
  children?: Positioned[]
}

/**
 * Stamp each block with the artifact lines it spans (`data-line`,
 * `data-line-end`), for the reader's line anchors (`line-anchor.ts`). The
 * markdown handed to one render may be a slice of the artifact — the reader
 * renders a folded artifact section by section — so `first` is the artifact
 * line the slice starts on, and a node's 1-based position in the slice is
 * offset by it. Attributes rather than ids: several blocks start on one line,
 * and headings already carry `def-<id>` ids.
 */
export const stampLines = (first: number) => () => (tree: Positioned) => {
  const walk = (node: Positioned) => {
    if (node.type === 'element' && BLOCKS.has(node.tagName ?? '') && node.position) {
      node.properties ??= {}
      node.properties.dataLine = node.position.start.line + first - 1
      node.properties.dataLineEnd = node.position.end.line + first - 1
    }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
}

// Inside a LexiconProvider (#163), R/AC/ADR ids resolve in place; elsewhere
// this stays a plain renderer. `sourceKind` (the artifact's kind, off its
// ArtifactRef) lets the lexicon stage treat definition sites differently from
// citations. `line`, given only by the Record reader, is the artifact line
// `children` starts on; its blocks are then stamped for line anchors.
export function Markdown({ children, sourceKind, unwrapped, line }: { children: string; sourceKind?: ArtifactKind; unwrapped?: boolean; line?: number }) {
  const lex = useLexicon()
  const rehypePlugins = useMemo(() => {
    const plugins = lex ? [rawAsText, lexiconRehype(lex.pattern, sourceKind)] : [rawAsText]
    return line === undefined ? plugins : [stampLines(line), ...plugins]
  }, [lex, sourceKind, line])
  const components = useMemo(() => (lex ? ({ 'lex-ref': LexRef } as unknown as Components) : undefined), [lex])
  const rendered = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
      {children}
    </ReactMarkdown>
  )
  // `unwrapped`: the caller supplies the one `.prose-artifact` wrapper — a
  // folded artifact (#217) renders its sections through several calls but is
  // still one artifact, and one wrapper is what every reader of the DOM expects.
  return unwrapped ? rendered : <div className="prose-artifact">{rendered}</div>
}
