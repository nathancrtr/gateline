import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LexRef, lexiconRehype, useLexicon } from './lexicon.tsx'

// Inside a LexiconProvider (#163), R/AC/ADR ids resolve in place; elsewhere
// this stays a plain renderer. `sourcePath` (the run-relative artifact path)
// lets the lexicon stage treat definition sites differently from citations.
export function Markdown({ children, sourcePath, unwrapped }: { children: string; sourcePath?: string; unwrapped?: boolean }) {
  const lex = useLexicon()
  const rehypePlugins = useMemo(() => (lex ? [lexiconRehype(lex.pattern, sourcePath)] : []), [lex, sourcePath])
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
