// The G2 card quotes a criterion's check on a line of its own (criterion-check
// R3). The lexicon hands the card a checked criterion's promise and check
// apart; the card quotes the promise, then the check in a block element, so
// the check's `Check:` label starts a line. A criterion without a check quotes
// its full text exactly as before.
//
// Static markup, as packet.test.ts renders the packets: the element structure
// and the quoted words are what these tests pin. Where the check lands on
// screen is a browser fact, tested in the e2e suite. The inputs are a real spec
// run through core's own lexicon and rollup, so a change to either grammar
// fails here rather than passing against a hand-built object.

import { buildEvidenceRollup, buildLexicon, ID_PATTERN, type LexiconEntry } from '@gateline/core/view-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { EvidenceRollup } from '../src/api.ts'
import { G2Packet } from '../src/components/evidence.tsx'
import { LexiconProvider, type RunLexicon } from '../src/components/lexicon.tsx'

/** AC1.1 carries a check that wraps onto a second line; AC1.2 has none. */
const SPEC = `# Specification: sample

## Requirements

### R1 — Snapshots
**Acceptance criteria:**
- [ ] AC1.1 — The snapshot generator never opens a network port.
  Check: its script contains neither
  port-binding call the server makes.
- [ ] AC1.2 — The snapshot lists every run
  in the order the record gives them.
`

/** The criterion view is withheld without a report in the verifier's grammar. */
const VERIFICATION = `# Verification Report: sample

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC1.2 | verified | see E2 |

### E1 — AC1.1
\`\`\`
$ grep -c listen scripts/snapshot.ts
0
\`\`\`

### E2 — AC1.2
\`\`\`
$ node scripts/snapshot.ts | head -2
run-a
run-b
\`\`\`
`

const LEXICON = buildLexicon({ spec: SPEC })
const entry = (id: string) => LEXICON.entries.find((e) => e.id === id) as LexiconEntry
const CHECKED = entry('AC1.1')
const PLAIN = entry('AC1.2')

function runLexicon(): RunLexicon {
  const byId = new Map<string, LexiconEntry[]>()
  for (const e of LEXICON.entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e])
  return { src: 'local', slug: 'g2-pending', pattern: ID_PATTERN, entries: LEXICON.entries, byId }
}

function renderG2(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['evidence', 'local', 'g2-pending'], buildEvidenceRollup({ lexicon: LEXICON, verification: VERIFICATION }) as EvidenceRollup)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        null,
        createElement(
          LexiconProvider,
          { value: runLexicon() },
          createElement(G2Packet, { src: 'local', slug: 'g2-pending', profile: 'full' as const }),
        ),
      ),
    ),
  )
}

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

/** One criterion's `<li>` on the card. */
function card(markup: string, id: string): string {
  const li = element(markup, `data-criterion="${id.replace('.', '\\.')}"`)
  expect(li, `the card renders ${id}`).not.toBeNull()
  return li!
}

describe('G2 card: a criterion with a check (AC3.1, AC3.2)', () => {
  it('the fixture criterion carries a check for the card to read', () => {
    // Guards the input, not the card: without a check here every assertion
    // below would be testing the unchecked path.
    expect(CHECKED.check).toBe('Check: its script contains neither port-binding call the server makes.')
    expect(CHECKED.promise).toBe('The snapshot generator never opens a network port.')
  })

  const li = card(renderG2(), 'AC1.1')
  const quote = element(li, 'data-criterion-quote')

  it('quotes the promise, then the check in an element of its own', () => {
    expect(quote, 'the quotation carries data-criterion-quote').not.toBeNull()
    const check = element(quote!, 'data-criterion-check')
    expect(check, 'the check carries data-criterion-check').not.toBeNull()
    // The check element holds the check and nothing else: its text is exactly
    // the lexicon's check, label first, and it has no child elements.
    expect(textOf(inner(check!))).toBe(CHECKED.check)
    expect(inner(check!)).not.toContain('<')
    // The promise comes first, before the check element opens.
    const before = textOf(inner(quote!).slice(0, inner(quote!).indexOf(check!)))
    expect(collapse(before)).toBe(CHECKED.promise)
  })

  it('displays the check as a block, so it starts a new line', () => {
    const check = element(quote ?? '', 'data-criterion-check')
    expect(check).not.toBeNull()
    expect(check!.slice(0, check!.indexOf('>'))).toMatch(/\sclass="(?:[^"]*\s)?block(?:\s[^"]*)?"/)
  })

  it('reads word for word as the spec writes it: the quote text equals body, whitespace collapsed', () => {
    expect(quote).not.toBeNull()
    expect(collapse(textOf(inner(quote!)))).toBe(collapse(CHECKED.body))
    // Whitespace separates the promise from its check, so the two do not run
    // together in the quote's text content.
    expect(textOf(inner(quote!))).not.toContain('port.Check:')
  })
})

describe('G2 card: a criterion without a check (AC3.3)', () => {
  const li = card(renderG2(), 'AC1.2')
  const quote = element(li, 'data-criterion-quote')

  it('the fixture criterion has no check', () => {
    expect('check' in PLAIN).toBe(false)
  })

  it('has no check element', () => {
    expect(li).not.toContain('data-criterion-check')
  })

  it('quotes the full text through the unchanged path: plain text equal to body', () => {
    expect(quote, 'the quotation carries data-criterion-quote').not.toBeNull()
    expect(collapse(textOf(inner(quote!)))).toBe(collapse(PLAIN.body))
    // Today's path puts `body` in the quotation span as its only child, the
    // wrapped line joined; no element is added inside it.
    expect(textOf(inner(quote!))).toBe(PLAIN.body)
    expect(inner(quote!)).not.toContain('<')
  })
})
