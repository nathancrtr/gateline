// Run-lexicon rendering (#163): R/AC/ADR ids in artifact views resolve where
// they stand. Grammar and definitions arrive as DATA from
// GET /api/runs/:src/:slug/lexicon — a value import from core would pull the
// node runtime into the browser bundle (see api.ts). Definition text renders
// verbatim, never paraphrased or generated: the hover card is a lens on the
// exact bytes under approval, so no gloss can misinform a decision the
// record then attributes to the approver.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type LexiconEntry } from '../api.ts'

export interface RunLexicon {
  src: string
  slug: string
  pattern: string
  entries: LexiconEntry[]
  /** All definitions per id, document order — amendments after originals. */
  byId: Map<string, LexiconEntry[]>
}

const LexiconContext = createContext<RunLexicon | null>(null)
export const LexiconProvider = LexiconContext.Provider
export const useLexicon = () => useContext(LexiconContext)

export function useRunLexicon(src: string | undefined, slug: string | undefined): RunLexicon | null {
  const { data } = useQuery({
    queryKey: ['lexicon', src, slug],
    queryFn: () => api.lexicon(src!, slug!),
    enabled: Boolean(src && slug),
  })
  return useMemo(() => {
    if (!data || !src || !slug) return null
    const byId = new Map<string, LexiconEntry[]>()
    for (const e of data.entries) {
      const defs = byId.get(e.id) ?? []
      defs.push(e)
      byId.set(e.id, defs)
    }
    return { src, slug, pattern: data.pattern, entries: data.entries, byId }
  }, [data, src, slug])
}

/** Definition anchors land on the defining heading; criteria (list items,
 * no heading of their own) land on their requirement's heading. */
const anchorFor = (id: string) => `def-${id.startsWith('AC') ? `R${id.slice(2).split('.')[0]}` : id}`

const KIND_LABEL: Record<LexiconEntry['kind'], string> = {
  requirement: 'requirement',
  criterion: 'acceptance criterion',
  decision: 'decision',
}

// ---------------------------------------------------------------------------
// Rehype stage: wrap id references in text, anchor definition headings.

interface HNode {
  type: string
  tagName?: string
  value?: string
  children?: HNode[]
  properties?: Record<string, unknown>
}

/** Never wrap inside code (styling noise), links (nested interactivity), or
 * an already-wrapped reference. */
const SKIP = new Set(['code', 'pre', 'a', 'lex-ref'])

const textOf = (node: HNode): string =>
  node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join('')

/** One id occurrence to leave unwrapped: the definition site itself — a card
 * that covers its own definition with a copy of itself reads as a bug. */
interface SkipOnce {
  id: string
  used: boolean
}

function splitText(value: string, re: RegExp, skip?: SkipOnce): HNode[] | null {
  re.lastIndex = 0
  const out: HNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    if (skip && !skip.used && m[0] === skip.id) {
      skip.used = true
      continue
    }
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    out.push({ type: 'element', tagName: 'lex-ref', properties: {}, children: [{ type: 'text', value: m[0] }] })
    last = m.index + m[0].length
  }
  if (out.length === 0) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

interface WalkOpts {
  re: RegExp
  /** This render is the artifact that defines criteria (spec.md). */
  definesCriteria: boolean
  /** This render is an artifact that defines R/ADR headings (spec.md / plan.md). */
  definesHeadings: boolean
}

function walk(node: HNode, opts: WalkOpts, skip?: SkipOnce): void {
  if (node.type === 'element' && SKIP.has(node.tagName ?? '')) return
  if (node.type === 'element' && /^h[1-6]$/.test(node.tagName ?? '')) {
    const m = /^\s*(R\d+|ADR-\d+|E\d+)\b/.exec(textOf(node))
    if (m) {
      ;(node.properties ??= {}).id = `def-${m[1]}`
      if (opts.definesHeadings) skip = { id: m[1]!, used: false }
    }
  }
  if (opts.definesCriteria && node.type === 'element' && node.tagName === 'li') {
    const m = /^\s*(AC\d+\.\d+)\s+—/.exec(textOf(node))
    if (m) skip = { id: m[1]!, used: false }
  }
  if (!node.children) return
  const next: HNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const parts = splitText(child.value, opts.re, skip)
      if (parts) {
        next.push(...parts)
        continue
      }
    }
    walk(child, opts, skip)
    next.push(child)
  }
  node.children = next
}

/** A rehype plugin parameterized by the served grammar. `sourcePath` scopes
 * definition-site suppression to the artifacts that actually define ids —
 * a report bullet that happens to start with `AC1.1 —` is a citation and
 * keeps its card. */
export const lexiconRehype = (pattern: string, sourcePath?: string) => () => (tree: HNode) => {
  const base = sourcePath?.split('/').pop() ?? ''
  walk(tree, {
    re: new RegExp(pattern, 'g'),
    definesCriteria: base === 'spec.md',
    definesHeadings: base === 'spec.md' || base === 'plan.md',
  })
}

// ---------------------------------------------------------------------------
// The reference itself: dotted id, hover/focus opens the verbatim card.

export function LexRef({ children }: { children?: ReactNode }) {
  const lex = useLexicon()
  const id = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : ''
  if (!lex || !id) return <>{children}</>
  const defs = lex.byId.get(id)
  const entry = defs?.at(-1)
  return (
    <span className={`lex-ref ${entry ? '' : 'lex-ref-missing'}`} tabIndex={0}>
      {id}
      <span className="lex-card" role="tooltip">
        <span className="lex-card-head">
          <span className="font-mono font-semibold">{id}</span>
          {entry ? (
            <span className="text-muted">
              {KIND_LABEL[entry.kind]}
              {entry.shortName ? ` — ${entry.shortName}` : ''}
            </span>
          ) : (
            <span className="font-medium text-warn">not defined in this run's spec/plan</span>
          )}
        </span>
        {entry?.qualifier && <span className="lex-card-qualifier">({entry.qualifier})</span>}
        {defs && defs.length > 1 && (
          <span className="lex-card-qualifier">
            supersedes {defs.length - 1} earlier definition{defs.length > 2 ? 's' : ''}
          </span>
        )}
        {entry && entry.body && (
          <span className="lex-card-def">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
          </span>
        )}
        {entry && (
          <Link
            className="lex-card-jump"
            to={`/runs/${lex.src}/${lex.slug}?tab=artifacts&artifact=${encodeURIComponent(entry.artifact)}&anchor=${anchorFor(id)}`}
          >
            {entry.artifact}:{entry.line} — jump to definition ↗
          </Link>
        )}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Plain prose that cites ids: needs-you card titles and details (#252).

/**
 * Wrap every id the run's lexicon can resolve in a `LexRef`, leaving the rest
 * of the string untouched. Used for prose that is not markdown and so never
 * passes through the rehype stage — an escalation reason, a gate question, a
 * round-cap detail line.
 *
 * Unlike the artifact renderer this wraps **only resolvable ids**. An artifact
 * view is a reading surface where "cited but defined nowhere" is a finding
 * worth showing; a decision card is not the place to introduce a warning about
 * a citation the human did not write, so an unresolvable id stays plain text.
 */
export function CitedText({ children }: { children: string }) {
  const lex = useLexicon()
  if (!lex) return <>{children}</>
  const re = new RegExp(lex.pattern, 'g')
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(children))) {
    if (!lex.byId.has(m[0])) continue
    if (m.index > last) parts.push(children.slice(last, m.index))
    parts.push(<LexRef key={key++}>{m[0]}</LexRef>)
    last = m.index + m[0].length
  }
  if (parts.length === 0) return <>{children}</>
  if (last < children.length) parts.push(children.slice(last))
  return <>{parts}</>
}

// ---------------------------------------------------------------------------
// Cited-objects strip: the artifact's reference surface, compressed.

/** [1,2,3,5] with fmt R → 'R1–R3, R5'. */
function ranges(nums: number[], fmt: (n: number) => string): string[] {
  const sorted = [...new Set(nums)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    out.push(j > i ? `${fmt(sorted[i]!)}–${fmt(sorted[j]!)}` : fmt(sorted[i]!))
    i = j + 1
  }
  return out
}

export function CitedObjects({ content, path }: { content: string; path: string }) {
  const lex = useLexicon()
  const cited = useMemo(() => {
    if (!lex) return []
    const re = new RegExp(lex.pattern, 'g')
    const seen = new Set<string>()
    const ids: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(content))) {
      if (!seen.has(m[0])) {
        seen.add(m[0])
        ids.push(m[0])
      }
    }
    // An id defined in this very artifact is a definition here, not a citation.
    return ids.filter((id) => {
      const defs = lex.byId.get(id)
      return !defs || defs.some((d) => d.artifact !== path)
    })
  }, [lex, content, path])

  if (!lex || cited.length === 0) return null

  const rs = cited.filter((id) => /^R\d+$/.test(id)).map((id) => Number(id.slice(1)))
  const acs = cited
    .filter((id) => id.startsWith('AC'))
    .sort((a, b) => {
      const [am, an] = a.slice(2).split('.').map(Number)
      const [bm, bn] = b.slice(2).split('.').map(Number)
      return am! - bm! || an! - bn!
    })
  const adrs = cited.filter((id) => id.startsWith('ADR')).map((id) => Number(id.slice(4)))
  const summary = [
    ...(rs.length ? [ranges(rs, (n) => `R${n}`).join(', ')] : []),
    ...(acs.length ? [acs.length > 6 ? `${acs.length} ACs` : acs.join(', ')] : []),
    ...(adrs.length ? [ranges(adrs, (n) => `ADR-${n}`).join(', ')] : []),
  ].join(' · ')

  return (
    <details className="lex-cited">
      <summary>Cites {summary}</summary>
      <ul>
        {cited.map((id) => {
          const entry = lex.byId.get(id)?.at(-1)
          return (
            <li key={id} className="flex items-baseline gap-2">
              <span className={`shrink-0 font-mono text-[11px] font-semibold ${entry ? 'text-accent' : 'text-warn'}`}>{id}</span>
              {entry ? (
                <>
                  <span className="min-w-0 truncate text-muted">{entry.shortName || entry.body.replace(/\s+/g, ' ')}</span>
                  <Link
                    className="ml-auto shrink-0 font-mono text-[11px] text-accent underline underline-offset-2"
                    to={`/runs/${lex.src}/${lex.slug}?tab=artifacts&artifact=${encodeURIComponent(entry.artifact)}&anchor=${anchorFor(id)}`}
                  >
                    {entry.artifact}:{entry.line}
                  </Link>
                </>
              ) : (
                <span className="text-warn">not defined in this run's spec/plan</span>
              )}
            </li>
          )
        })}
      </ul>
    </details>
  )
}
