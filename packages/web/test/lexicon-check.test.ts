// A criterion id's hover card shows its check on a line of its own, and the
// cited-ids list quotes the promise alone (criterion-check R4, R6). The
// lexicon hands both views a checked criterion's promise and check apart; the
// card renders the promise, then the check in a block element, and lifts its
// six-line clamp; the list drops the check. A criterion without a check reads
// through each view's unchanged path from its full text.
//
// Static markup, as g2-criterion-check.test.ts renders the G2 card: element
// structure and quoted words are what these tests pin. Where the check lands
// on screen, and whether the clamp cuts it, are browser facts tested in the
// e2e suite. The lexicon is core's own, built from a real spec, so a change to
// its grammar fails here rather than passing against a hand-built object.

import { buildLexicon, ID_PATTERN, type LexiconEntry } from '@gateline/core/view-model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { CitedObjects, LexiconProvider, LexRef, type RunLexicon } from '../src/components/lexicon.tsx'

/** AC1.1 carries a check that wraps onto a second line; AC1.2 has none. */
const SPEC = `# Specification: sample

## Requirements

### R1 — Snapshots
The generator writes a snapshot of every run.
**Acceptance criteria:**
- [ ] AC1.1 — The snapshot generator never opens a network port.
  Check: its script contains neither
  port-binding call the server makes.
- [ ] AC1.2 — The snapshot lists every run
  in the order the record gives them.
`

const LEXICON = buildLexicon({ spec: SPEC })
const entry = (id: string) => LEXICON.entries.find((e) => e.id === id) as LexiconEntry
const CHECKED = entry('AC1.1')
const PLAIN = entry('AC1.2')
const REQUIREMENT = entry('R1')

function runLexicon(): RunLexicon {
  const byId = new Map<string, LexiconEntry[]>()
  for (const e of LEXICON.entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e])
  return { src: 'local', slug: 'sample', pattern: ID_PATTERN, entries: LEXICON.entries, byId }
}

const withLexicon = (child: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(LexiconProvider, { value: runLexicon() }, child)))

/** One id's reference, its hover card inside. */
const hover = (id: string) => withLexicon(createElement(LexRef, null, id))

/** A plan that cites every id, so the list (which drops ids its own artifact
 *  defines) lists them all. */
const cited = () => withLexicon(createElement(CitedObjects, { content: 'Covers R1, AC1.1 and AC1.2.', path: 'plan.md' }))

/** The whole element whose open tag carries `hook`, from `from` on, nested
 *  same-name tags balanced. Null when no element carries the hook. */
function element(markup: string, hook: string, from = 0): string | null {
  const open = new RegExp(`<(\\w+)[^>]*\\s${hook}(?:="[^"]*")?[\\s>/]`, 'g')
  open.lastIndex = from
  const m = open.exec(markup)
  if (!m) return null
  const tag = m[1]!
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g')
  re.lastIndex = m.index
  let depth = 0
  for (let t = re.exec(markup); t; t = re.exec(markup)) {
    depth += t[1] ? -1 : 1
    if (depth === 0) return markup.slice(m.index, re.lastIndex)
  }
  return null
}

/** The markup between an element's open and close tags. */
const inner = (el: string) => el.slice(el.indexOf('>') + 1, el.lastIndexOf('</'))

/** An element's open tag. */
const openTag = (el: string) => el.slice(0, el.indexOf('>') + 1)

/** Text content: tags stripped, entities the renderer escapes restored. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** Each run of whitespace to one space, none at either end (plan.md, Lexicon entry). */
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The card's definition quote: the `.lex-card-def` element. */
function quoteOf(markup: string): string {
  const el = element(markup, 'class="lex-card-def[^"]*"')
  expect(el, 'the card renders a definition quote').not.toBeNull()
  return el!
}

/** One id's entry in the cited-ids list, and the quoted text beside its id. */
function listed(markup: string, id: string): { li: string; quote: string } {
  const at = markup.indexOf(`>${id}<`)
  expect(at, `the list cites ${id}`).toBeGreaterThan(-1)
  const li = element(markup, 'class="flex items-baseline gap-2"', markup.lastIndexOf('<li', at))
  expect(li, `the list renders ${id} as an entry`).not.toBeNull()
  const quote = element(li!, 'class="min-w-0 truncate text-muted"')
  expect(quote, `${id}'s entry quotes its text`).not.toBeNull()
  return { li: li!, quote: textOf(inner(quote!)) }
}

describe('the fixture', () => {
  it('holds one checked and one unchecked criterion', () => {
    // Guards the input, not the views: without a check on AC1.1 every
    // checked-path assertion below would be testing the unchecked path.
    expect(CHECKED.check).toBe('Check: its script contains neither port-binding call the server makes.')
    expect(CHECKED.promise).toBe('The snapshot generator never opens a network port.')
    expect('check' in PLAIN).toBe(false)
  })
})

describe('hover card: a criterion with a check (AC4.1, AC4.2)', () => {
  const quote = quoteOf(hover('AC1.1'))

  it('marks the quote as a criterion quotation', () => {
    expect(openTag(quote)).toMatch(/\sdata-criterion-quote[=\s>]/)
  })

  it('renders the promise, then the check in an element of its own', () => {
    const check = element(quote, 'data-criterion-check')
    expect(check, 'the check carries data-criterion-check').not.toBeNull()
    // The check element holds the check and nothing else, label first.
    expect(textOf(inner(check!))).toBe(CHECKED.check)
    // The promise comes first, before the check element opens.
    const before = textOf(inner(quote).slice(0, inner(quote).indexOf(check!)))
    expect(collapse(before)).toBe(CHECKED.promise)
  })

  it('displays the check as a block, so it starts a new line', () => {
    const check = element(quote, 'data-criterion-check')
    expect(check).not.toBeNull()
    expect(openTag(check!)).toMatch(/\sclass="(?:[^"]*\s)?block(?:\s[^"]*)?"/)
  })

  it('quotes word for word as the spec writes it: the quote text equals body, whitespace collapsed', () => {
    expect(collapse(textOf(inner(quote)))).toBe(collapse(CHECKED.body))
    // Whitespace separates the promise from its check, so the two do not run
    // together in the quote's text content.
    expect(textOf(inner(quote))).not.toContain('port.Check:')
  })

  it('lifts the six-line clamp, so the end of the check is never cut (ADR-3)', () => {
    expect(openTag(quote)).toMatch(/\sclass="lex-card-def lex-card-def-full"/)
  })
})

describe('hover card: a criterion without a check (AC4.3)', () => {
  const quote = quoteOf(hover('AC1.2'))

  it('has no check element', () => {
    expect(quote).not.toContain('data-criterion-check')
  })

  it('keeps the six-line clamp: the quote carries no modifier', () => {
    expect(openTag(quote)).toMatch(/\sclass="lex-card-def"/)
  })

  it('quotes body through the unchanged markdown path, marked as a criterion quotation', () => {
    expect(openTag(quote)).toMatch(/\sdata-criterion-quote[=\s>]/)
    expect(textOf(inner(quote))).toBe(PLAIN.body)
    // Today's path: one markdown render of `body`, a single paragraph.
    expect(inner(quote)).toBe(`<p>${PLAIN.body}</p>`)
  })
})

describe('hover card: a requirement (unchanged)', () => {
  it('quotes body through the unchanged path, clamp kept and no criterion hook', () => {
    const quote = quoteOf(hover('R1'))
    expect(openTag(quote)).toBe('<span class="lex-card-def">')
    expect(textOf(inner(quote))).toBe(REQUIREMENT.body)
  })
})

describe('cited-ids list: a criterion with a check (AC6.1)', () => {
  const { li, quote } = listed(cited(), 'AC1.1')

  it("shows none of the check: the entry's text lacks `Check:`", () => {
    expect(textOf(li)).not.toContain('Check:')
  })

  it('quotes the promise, whitespace collapsed', () => {
    expect(quote).toBe(collapse(CHECKED.promise!))
  })
})

describe('cited-ids list: a criterion without a check (AC6.2)', () => {
  it("shows the same text as today: the entry's text equals body", () => {
    expect(listed(cited(), 'AC1.2').quote).toBe(PLAIN.body)
  })
})
