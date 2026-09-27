// A criterion id's hover card shows its check on a line of its own, and the
// cited-ids list quotes the promise alone (criterion-check R4, R6). The
// lexicon hands both views a checked criterion's promise and check apart; the
// card renders the promise, then the check in a block element, and lifts its
// six-line clamp; the list drops the check. A criterion without a check reads
// through each view's unchanged path from its full text.
//
// Static markup, as g2-criterion-check.test.ts renders the G2 card: element
// structure and quoted words are what these tests pin. Where the check lands
// on screen is a browser fact tested in the e2e suite. The rule that lifts the
// clamp is pinned here as Tailwind compiles it, because the e2e suite's demo
// criterion is too short for a six-line cut to show. The lexicon is core's
// own, built from a real spec, so a change to its grammar fails here rather
// than passing against a hand-built object.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLexicon, ID_PATTERN, type LexiconEntry } from '@gateline/core/view-model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { CitedObjects, LexiconProvider, LexRef, type RunLexicon } from '../src/components/lexicon.tsx'

/** AC1.1 carries a check; its promise and check each run past 110
 *  characters and wrap, so a quote cut short loses words. AC1.2 has no check.
 *  AC1.3 writes markdown in both halves, so a half printed as plain text shows. */
const SPEC = `# Specification: sample

## Requirements

### R1 — Snapshots
The generator writes a snapshot of every run.
**Acceptance criteria:**
- [ ] AC1.1 — The snapshot generator never opens a network port, not while it
  reads the record and not while it writes the pages it renders from it.
  Check: its script contains neither port-binding call the server makes, and no
  module it imports reaches for a socket of any kind at all.
- [ ] AC1.2 — The snapshot lists every run
  in the order the record gives them.
- [ ] AC1.3 — The snapshot names its **source** commit.
  Check: the page footer holds the \`git rev-parse\` output.
`

const LEXICON = buildLexicon({ spec: SPEC })
const entry = (id: string) => LEXICON.entries.find((e) => e.id === id) as LexiconEntry
const CHECKED = entry('AC1.1')
const PLAIN = entry('AC1.2')
const MARKDOWN = entry('AC1.3')
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

/** A class or inline style inside a quote that would cut its text short. */
const CUT = /\sclass="(?:[^"]*\s)?(?:truncate|line-clamp-\d+|text-ellipsis|overflow-hidden|max-h-\S+)(?:\s[^"]*)?"|\sstyle="/

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
    expect(CHECKED.check).toBe(
      'Check: its script contains neither port-binding call the server makes, and no module it imports reaches for a socket of any kind at all.',
    )
    expect(CHECKED.promise).toBe(
      'The snapshot generator never opens a network port, not while it reads the record and not while it writes the pages it renders from it.',
    )
    expect(CHECKED.promise!.length).toBeGreaterThan(110)
    expect(CHECKED.check!.length).toBeGreaterThan(110)
    expect('check' in PLAIN).toBe(false)
    expect(MARKDOWN.promise).toBe('The snapshot names its **source** commit.')
    expect(MARKDOWN.check).toBe('Check: the page footer holds the `git rev-parse` output.')
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
    expect(textOf(inner(quote))).not.toContain(`${CHECKED.promise}${CHECKED.check}`)
  })

  it('lifts the six-line clamp, so the end of the check is never cut (ADR-3)', () => {
    expect(openTag(quote)).toMatch(/\sclass="lex-card-def lex-card-def-full"/)
  })

  it('cuts neither half short inside the quote', () => {
    expect(inner(quote)).not.toMatch(CUT)
  })
})

describe('hover card: a checked criterion written in markdown (AC4.1)', () => {
  const quote = quoteOf(hover('AC1.3'))
  const check = element(quote, 'data-criterion-check')

  it('renders the promise through markdown', () => {
    expect(check).not.toBeNull()
    const promise = inner(quote).slice(0, inner(quote).indexOf(check!))
    expect(promise).toContain('<p>The snapshot names its <strong>source</strong> commit.</p>')
  })

  it('renders the check through markdown', () => {
    expect(inner(check!)).toBe('<p>Check: the page footer holds the <code>git rev-parse</code> output.</p>')
  })

  it('cuts neither half short inside the quote', () => {
    expect(inner(quote)).not.toMatch(CUT)
  })
})

describe('stylesheet: the clamp modifier (ADR-3)', async () => {
  // styles.css compiled as the build compiles it, `@import 'tailwindcss'`
  // resolved to the installed package. The modifier and the base rule share a
  // specificity, so the one written later wins.
  const src = fileURLToPath(new URL('../src/styles.css', import.meta.url))
  const require = createRequire(import.meta.url)
  const compiler = await compile(readFileSync(src, 'utf8'), {
    base: dirname(src),
    loadStylesheet: async (id) => {
      const path = require.resolve(id === 'tailwindcss' ? 'tailwindcss/index.css' : id)
      return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
    },
  })
  const css = compiler.build([])
  /** The declarations of the top-level rule for exactly `selector`, and where it sits. */
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`)
    expect(at, `styles.css compiles a ${selector} rule`).toBeGreaterThan(-1)
    return { at, body: css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)) }
  }

  it('the base quote is clamped to six lines', () => {
    expect(rule('.lex-card-def').body).toMatch(/-webkit-line-clamp:\s*6;/)
  })

  it('the modifier unsets the clamp and lets the text show', () => {
    const { body } = rule('.lex-card-def-full')
    expect(body).toMatch(/-webkit-line-clamp:\s*unset;/)
    expect(body).toMatch(/overflow:\s*visible;/)
    expect(body).toMatch(/display:\s*block;/)
  })

  it('the modifier comes after the base rule, so it wins', () => {
    expect(rule('.lex-card-def-full').at).toBeGreaterThan(rule('.lex-card-def').at)
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
