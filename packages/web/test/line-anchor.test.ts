// Line anchors in the Record reader (#441): a quotation's `file:line` address
// lands on the block holding that line, its fold opened.
//
// Three things are pinned. The landing rule itself (`landingIndex`). The
// stamping: a block's `data-line` is the artifact's line, not the slice's,
// when the reader renders a folded artifact section by section. And the join
// between the two numberings, over every spec and intent brief committed under
// `runs/`: core's `at.line` for each G0 quotation, resolved against the lines
// the reader's own renderer stamped, lands on a block whose text is that
// quotation's first line. A reader stamping the slice's numbering, or off by
// the heading line, lands on a neighbouring block and fails there. The mark
// that shows where it landed (#449) is placed by `landingMark`, pinned last.
//
// Static markup, no DOM (vitest.config.ts, layer 2): the markup is parsed
// back into stamped blocks by the small tag walker below.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildG0Packet, type Quotation } from '@gateline/core/view-model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/markdown.tsx'
import { LANDING_GUTTER, landingIndex, landingMark, lineAnchor, lineOfAnchor } from '../src/line-anchor.ts'
import { FoldedMarkdown } from '../src/pages/run/record.tsx'

interface Block {
  tag: string
  start: number
  end: number
  text: string
}

const VOID = new Set(['hr', 'br', 'img', 'input'])
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }

/** Every element carrying `data-line`, in document order, with the text it holds. */
function blocks(html: string): Block[] {
  const out: Block[] = []
  const open: (Block | null)[] = []
  for (const m of html.matchAll(/<(\/?)([a-z0-9-]+)([^>]*?)\/?>|([^<]+)/g)) {
    if (m[4] !== undefined) {
      const text = m[4].replace(/&([#a-z0-9]+);/g, (_, e: string) => ENTITIES[e] ?? `&${e};`)
      for (const b of open) if (b) b.text += text
      continue
    }
    const [, close, tag, attrs] = m
    if (close) {
      open.pop()
      continue
    }
    const start = /data-line="(\d+)"/.exec(attrs!)
    const end = /data-line-end="(\d+)"/.exec(attrs!)
    const block = start && end ? { tag: tag!, start: Number(start[1]), end: Number(end[1]), text: '' } : null
    if (block) out.push(block)
    if (!VOID.has(tag!)) open.push(block)
  }
  return out
}

const words = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? []

/** The words a quotation's first line renders as: link targets and markup dropped. */
const firstWords = (q: Quotation) =>
  words(
    q.text
      .split('\n')[0]!
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''),
  ).slice(0, 5)

const landsOn = (html: string, line: number): Block | undefined => {
  const all = blocks(html)
  return all[landingIndex(all, line)]
}

describe('the landing rule', () => {
  const spans = [
    { start: 3, end: 3 }, // a heading
    { start: 5, end: 9 }, // a list
    { start: 5, end: 6 }, // its first item
    { start: 5, end: 6 }, // the item's paragraph
    { start: 7, end: 9 }, // the second item
    { start: 12, end: 14 }, // a paragraph after a blank line or a comment
  ]

  it('lands on the innermost block holding the line', () => {
    expect(landingIndex(spans, 5)).toBe(3)
    expect(landingIndex(spans, 6)).toBe(3)
    expect(landingIndex(spans, 8)).toBe(4)
    expect(landingIndex(spans, 13)).toBe(5)
  })

  it('lands on the next block below a line no block holds, and nowhere past the last', () => {
    expect(landingIndex(spans, 1)).toBe(0)
    expect(landingIndex(spans, 10)).toBe(5)
    expect(landingIndex(spans, 15)).toBe(-1)
    expect(landingIndex([], 1)).toBe(-1)
  })

  it('reads L<n> as a line and leaves every other anchor to the element ids', () => {
    expect(lineAnchor(19)).toBe('L19')
    expect(lineOfAnchor('L19')).toBe(19)
    expect(lineOfAnchor('def-R2')).toBeNull()
    expect(lineOfAnchor('L0')).toBeNull()
    expect(lineOfAnchor('L')).toBeNull()
  })
})

describe('the landing mark (#449)', () => {
  // The reader's article at (100, 300); its column 40px in; blocks in page coordinates.
  const article = { top: 100, left: 300 }
  const column = { left: 340 }

  it('sits level with the landed block and as tall, in the article’s coordinates', () => {
    const mark = landingMark({ top: 460, left: 340, height: 52 }, column, article)
    expect(mark.top).toBe(360)
    expect(mark.height).toBe(52)
  })

  it('sits one gutter left of the column, wherever the block is indented', () => {
    const heading = landingMark({ top: 200, left: 340, height: 24 }, column, article)
    const nestedItem = landingMark({ top: 260, left: 384, height: 26 }, column, article)
    expect(heading.left).toBe(40 - LANDING_GUTTER)
    expect(nestedItem.left).toBe(heading.left)
  })
})

describe('Markdown stamps each block with the artifact lines it spans', () => {
  const md = '## Heading\nA paragraph\nthat wraps.\n\n- one\n- two\n  continued\n\n```\ncode\n```\n'

  it('offsets a slice by the line it starts on, blocks only', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { line: 40 } as Parameters<typeof Markdown>[0], md))
    expect(blocks(html).map((b) => [b.tag, b.start, b.end])).toEqual([
      ['h2', 40, 40],
      ['p', 41, 42],
      ['ul', 44, 46],
      ['li', 44, 44],
      ['li', 45, 46],
      ['pre', 48, 50],
    ])
    // Inline nodes carry positions too, and are not stamped.
    expect(html).not.toMatch(/<(code|strong|em|a)[^>]*data-line/)
  })

  it('stamps nothing outside the reader', () => {
    expect(renderToStaticMarkup(createElement(Markdown, null, md))).not.toContain('data-line')
  })

  it('a folded section is stamped from its body’s first line, and its heading from its own', () => {
    const content = '# Spec\n\n## Assumptions\n- a choice\n\n## Out of scope\nConcurrency;\ninternationalization.\n'
    const html = renderToStaticMarkup(createElement(FoldedMarkdown, { content, kind: 'spec', audit: ['Out of scope'] }))
    expect(html).toMatch(/<details[^>]*data-fold="Out of scope"/)
    expect(landsOn(html, 6)).toMatchObject({ tag: 'h2', text: 'Out of scope' })
    expect(landsOn(html, 8)).toMatchObject({ tag: 'p', start: 7, end: 8 })
    expect(landsOn(html, 4)).toMatchObject({ tag: 'li', start: 4, text: 'a choice' })
  })
})

describe('every G0 quotation in the committed runs lands on its own words', () => {
  const runs = resolve(import.meta.dirname, '../../../runs')
  const read = (p: string) => {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      return null
    }
  }
  const slugs = readdirSync(runs).filter((s) => statSync(join(runs, s)).isDirectory())

  it('over each spec (Out of scope folded) and brief (rendered whole)', () => {
    let checked = 0
    for (const slug of slugs) {
      const spec = read(join(runs, slug, 'spec.md'))
      const brief = read(join(runs, slug, 'intent-brief.md'))
      if (spec === null && brief === null) continue
      const packet = buildG0Packet({ spec, brief, audit: { spec: ['Out of scope'] } })
      const quotes: [string, string | null, Quotation][] = [
        ...packet.assumptions.map((q) => ['spec.md', spec, q] as [string, string | null, Quotation]),
        ...[packet.outOfScope?.body].map((q) => ['spec.md', spec, q] as [string, string | null, Quotation | undefined]),
        ...[packet.problem?.body, packet.constraints?.body, packet.briefOutOfScope?.body].map(
          (q) => ['intent-brief.md', brief, q] as [string, string | null, Quotation | undefined],
        ),
      ].filter((e): e is [string, string, Quotation] => e[1] !== null && e[2] != null)
      const html = {
        'spec.md': spec === null ? '' : renderToStaticMarkup(createElement(FoldedMarkdown, { content: spec, kind: 'spec', audit: ['Out of scope'] })),
        'intent-brief.md': brief === null ? '' : renderToStaticMarkup(createElement(FoldedMarkdown, { content: brief, kind: 'intent-brief', audit: [] })),
      } as Record<string, string>
      for (const [path, , q] of quotes) {
        const where = `runs/${slug}/${path}:${q.at.line}`
        const block = landsOn(html[path]!, q.at.line)
        expect(block, where).toBeDefined()
        expect(block!.start, where).toBeLessThanOrEqual(q.at.line)
        expect(words(block!.text).join(' '), where).toContain(firstWords(q).join(' '))
        checked++
      }
    }
    // The committed runs carry dozens of quotations; a walk that found none proves nothing.
    expect(checked).toBeGreaterThan(30)
  })
})
