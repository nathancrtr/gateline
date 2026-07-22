import { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { LexRef, lexiconRehype, useLexicon } from './lexicon.tsx'

// Inside a LexiconProvider (#163), R/AC/ADR ids resolve in place; elsewhere
// this stays a plain renderer.
export function Markdown({ children }: { children: string }) {
  const lex = useLexicon()
  const rehypePlugins = useMemo(() => (lex ? [lexiconRehype(lex.pattern)] : []), [lex])
  const components = useMemo(() => (lex ? ({ 'lex-ref': LexRef } as unknown as Components) : undefined), [lex])
  return (
    <div className="prose-artifact">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
