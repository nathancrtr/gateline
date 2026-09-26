// The vocabulary of representations (#414): each of SEAM.md §5's eleven kinds
// renders its signal, and refuses its "must never" where that is testable.
//
// Layer 2 of `vitest.config.ts`'s map — static markup, no DOM. What the
// signal looks like on the page is the browser's to judge and the geometry
// sweep's to keep in bounds; what is asserted here is that the kind carries
// the classes and shape its row of the table names, and that the cheap
// invariants throw.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type FunctionComponent, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import {
  Address,
  artifactHref,
  Count,
  Diagnostic,
  FieldRow,
  Fold,
  Instruction,
  isName,
  KindLabel,
  LinkOut,
  Name,
  QuotedPassage,
  QuotedWord,
  Withheld,
} from '../src/components/vocabulary.tsx'
import { ref } from './artifact-refs.helper.ts'

/** `createElement` for the vocabulary: their children are typed as a required
 *  prop (a string, for most kinds), which the element's third argument fills. */
function el(type: (props: never) => ReactNode, props: object | null, ...children: ReactNode[]) {
  return createElement(type as unknown as FunctionComponent<object>, props, ...children)
}

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(el(QueryClientProvider, { client }, el(MemoryRouter, null, node)))
}

/** The markup's text, as a reader sees it: tags dropped, entities decoded. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')

/** The class list of the first element carrying `attr`. */
function classesOf(html: string, attr: string): string[] {
  const tag = html.match(new RegExp(`<[a-z]+[^>]*\\b${attr}\\b[^>]*>`))?.[0]
  const cls = tag?.match(/class="([^"]*)"/)?.[1]
  if (cls === undefined) throw new Error(`no element with ${attr} in ${html}`)
  return cls.split(/\s+/)
}

describe('artifactHref — the one link into the Record reader', () => {
  it('encodes the path and appends an anchor only when given', () => {
    expect(artifactHref('local', 'a-run', 'tasks/01-x.yaml')).toBe('/runs/local/a-run?tab=record&artifact=tasks%2F01-x.yaml')
    expect(artifactHref('local', 'a-run', 'spec.md', 'def-R2')).toBe('/runs/local/a-run?tab=record&artifact=spec.md&anchor=def-R2')
  })
})

describe('Address — code face, muted; link blue only as a link', () => {
  it('plain: code face in the muted step, no border, no truncation', () => {
    const cls = classesOf(render(el(Address, null, 'review-02.md')), 'data-address')
    expect(cls).toEqual(expect.arrayContaining(['font-mono', 'text-faint']))
    expect(cls.some((c) => c.startsWith('border'))).toBe(false)
    expect(cls).not.toContain('truncate')
    expect(cls).not.toContain('text-accent')
  })

  it('as a link: an in-app route in link blue, underlined, and never ↗', () => {
    const html = render(el(Address, { to: artifactHref('local', 'a-run', 'plan.md') }, 'plan.md'))
    expect(html).toMatch(/^<a /)
    expect(html).toContain('href="/runs/local/a-run?tab=record&amp;artifact=plan.md"')
    expect(classesOf(html, 'data-address')).toEqual(expect.arrayContaining(['font-mono', 'text-accent', 'underline']))
    expect(html).not.toContain('target=')
    expect(html).not.toContain('↗')
  })

  it('takes the surface’s code size', () => {
    expect(classesOf(render(el(Address, { size: 'xs' }, 'a.md')), 'data-address')).toContain('text-[10.5px]')
    expect(classesOf(render(el(Address, { size: 'md' }, 'a.md')), 'data-address')).toContain('text-[11.5px]')
  })
})

describe('Name — code face, ink, semibold when leading; never a path', () => {
  it('is ink in the code face, and semibold only when it leads', () => {
    const plain = classesOf(render(el(Name, null, '04-fixture-label')), 'data-name')
    expect(plain).toEqual(expect.arrayContaining(['font-mono', 'text-ink']))
    expect(plain).not.toContain('font-semibold')
    expect(classesOf(render(el(Name, { lead: true }, 'R2')), 'data-name')).toContain('font-semibold')
  })

  it('is never set in the Address treatment', () => {
    const cls = classesOf(render(el(Name, { lead: true }, 'ADR-3')), 'data-name')
    expect(cls).not.toContain('text-faint')
    expect(cls).not.toContain('text-muted')
    expect(cls).not.toContain('text-accent')
  })

  it('accepts the record’s grammar tokens, dotted criterion ids included', () => {
    for (const id of ['R2', 'AC2.1', 'ADR-12', 'F3', 'E4', '06-pages-workflow', 'G2', 'a ↔ b']) expect(isName(id)).toBe(true)
  })

  it('rejects a slash or a file extension, and throws on one in dev', () => {
    for (const bad of ['tasks/01-x.yaml', 'review-02.md', 'runs/a-run', 'state.yaml']) expect(isName(bad)).toBe(false)
    expect(() => render(el(Name, null, 'tasks/01-x.yaml'))).toThrow(/never contains a slash/)
    expect(() => render(el(Name, null, 'spec.md'))).toThrow(/never contains a slash or an extension/)
  })
})

describe('KindLabel — UI face, sentence case, ink; never a filename', () => {
  it('is the UI face in ink by default', () => {
    const cls = classesOf(render(el(KindLabel, null, 'Rollback trigger')), 'data-kind-label')
    expect(cls).toEqual(expect.arrayContaining(['font-ui', 'text-ink']))
    expect(cls).not.toContain('font-mono')
  })

  it('throws on a filename in dev', () => {
    expect(() => render(el(KindLabel, null, 'verification-report.md'))).toThrow(/never a filename/)
    expect(() => render(el(KindLabel, null, 'tasks/06-x'))).toThrow(/never a filename/)
  })
})

describe('QuotedWord — the impression; the chip border is its alone', () => {
  it('is a bordered code-face token, printed as the record spells it', () => {
    const html = render(el(QuotedWord, { tone: 'warn' }, 'request-changes'))
    const cls = classesOf(html, 'data-quoted-word')
    expect(cls).toEqual(expect.arrayContaining(['border', 'font-mono', 'font-semibold', 'border-warn-line', 'bg-warn-bg', 'text-warn']))
    expect(html).toContain('>request-changes</span>')
  })

  it('takes colour only from the quartet, and plain otherwise', () => {
    expect(classesOf(render(el(QuotedWord, null, 'minor')), 'data-quoted-word')).toEqual(
      expect.arrayContaining(['border-line', 'bg-inset', 'text-muted']),
    )
  })

  it('is the only vocabulary kind wearing a chip border', () => {
    const others = [
      render(el(Address, null, 'a.md')),
      render(el(Address, { to: '/x' }, 'a.md')),
      render(el(Name, { lead: true }, 'R1')),
      render(el(KindLabel, null, 'Label')),
      render(el(Count, { n: 2, one: 'finding', many: 'findings' })),
    ]
    for (const html of others) expect(html).not.toMatch(/class="[^"]*\bborder\b/)
  })
})

describe('QuotedPassage — the one boxed thing: a hairline box on the surface', () => {
  it('is a hairline box on the surface', () => {
    const html = render(el(QuotedPassage, { 'data-p': true }, 'words'))
    expect(classesOf(html, 'data-p')).toEqual(expect.arrayContaining(['border', 'border-line', 'bg-surface', 'px-3', 'py-2']))
  })

  it('takes the caution tint only as a named tone, never another colour', () => {
    const cls = classesOf(render(el(QuotedPassage, { tone: 'caution', 'data-p': true }, 'no')), 'data-p')
    expect(cls).toEqual(expect.arrayContaining(['border-warn-line', 'bg-warn-bg']))
  })

  it('renders as a list item when it is one of a list', () => {
    expect(render(el(QuotedPassage, { as: 'li' }, 'x'))).toMatch(/^<li /)
  })
})

describe('FieldRow — a label as written, a value verbatim, one signal in two forms', () => {
  it('on the surface: a boxed passage, the label in the UI face, the value in a prose slot', () => {
    const html = render(el(FieldRow, { label: 'Traces to', 'data-field': 'traces-to' }, 'R2'))
    expect(html).toMatch(/^<li /)
    expect(classesOf(html, 'data-field')).toEqual(expect.arrayContaining(['border', 'border-line', 'bg-surface']))
    expect(classesOf(html, 'data-kind-label')).toEqual(expect.arrayContaining(['font-ui', 'text-[11px]', 'text-muted']))
    expect(html).toContain('<div class="prose-card min-w-0 flex-1">R2</div>')
  })

  it('carries the caution tint onto the box and the value together', () => {
    const html = render(el(FieldRow, { label: 'Rollback exercised', tone: 'caution', 'data-field': 'x' }, 'no'))
    expect(classesOf(html, 'data-field')).toEqual(expect.arrayContaining(['border-warn-line', 'bg-warn-bg']))
    expect(html).toContain('font-medium text-warn')
  })

  it('nested inside a finding: the same row unboxed, as a dt/dd pair', () => {
    const html = render(createElement('dl', null, el(FieldRow, { nested: true, label: 'Where', 'data-field': 'w' }, 'src/a.ts:3')))
    expect(classesOf(html, 'data-field')).not.toContain('border')
    expect(html).toMatch(/<dt class="[^"]*font-ui[^"]*text-muted[^"]*"[^>]*>Where<\/dt>/)
    expect(html).toContain('<dd class="min-w-0 flex-1 text-muted">src/a.ts:3</dd>')
  })
})

describe('Count — UI face, tabular figures, no colour', () => {
  it('adjoins its noun, singular and plural', () => {
    expect(render(el(Count, { n: 1, one: 'finding', many: 'findings' }))).toContain('>1 finding<')
    expect(render(el(Count, { n: 3, one: 'finding', many: 'findings' }))).toContain('>3 findings<')
  })

  it('states a ratio only against a cap the caller names', () => {
    expect(render(el(Count, { n: 3, of: 3, one: 'round', many: 'rounds' }))).toContain('>rounds 3/3<')
  })

  it('takes no colour and is never a percentage', () => {
    const html = render(el(Count, { n: 5, one: 'x', many: 'xs' }))
    expect(classesOf(html, 'data-count')).toEqual(['font-ui', 'tabular-nums'])
    expect(html).not.toContain('%')
    expect(() => render(el(Count, { n: 0.83, one: 'x', many: 'xs' }))).toThrow(/whole number/)
  })
})

describe('Fold — ▸, the heading, the count; opens in place', () => {
  it('starts folded to its heading and count, the body not in the page', () => {
    const html = render(el(Fold, { heading: 'Blast radius', count: 4, 'data-f': 'b' }, 'THE BODY'))
    expect(html).toContain('▸')
    expect(html).toContain('>Blast radius<')
    expect(html).toContain('>4<')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('data-open="false"')
    expect(html).not.toContain('THE BODY')
  })

  it('opens in place, verbatim, when the caller says it must not start closed', () => {
    const html = render(el(Fold, { heading: 'Section', defaultOpen: true }, 'THE BODY'))
    expect(html).toContain('▾')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('THE BODY')
  })
})

describe('LinkOut — link blue, ↗, a new tab; the only ↗ in the vocabulary', () => {
  it('opens the host’s page in a new tab and carries the arrow', () => {
    const html = render(el(LinkOut, { href: 'https://example.test/pr/1' }, 'PR'))
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('PR ↗')
    expect(classesOf(html, 'data-link-out')).toContain('text-accent')
  })

  it('renders nothing when no target resolves', () => {
    expect(render(el(LinkOut, { href: null }, 'PR'))).toBe('')
    expect(render(el(LinkOut, { href: '' }, 'PR'))).toBe('')
  })

  it('is the only kind that renders ↗', () => {
    const others = [
      render(el(Address, { to: '/x' }, 'a.md')),
      render(el(Withheld, { view: 'Coverage', reason: { grammar: 'a section headed', token: '## X', lookedIn: ref('plan.md') }, src: 's', slug: 'r' })),
      render(el(Fold, { heading: 'H' }, 'b')),
      render(el(Instruction, null, 'Do the thing.')),
    ]
    for (const html of others) expect(html).not.toContain('↗')
  })
})

describe('Withheld — a caution field naming the grammar, one link', () => {
  const plan = ref('plan.md')

  it('is the caution field, never the declined red', () => {
    const cls = classesOf(render(el(Withheld, { view: 'Coverage', reason: { grammar: 'a plan', lookedIn: null }, src: 's', slug: 'r', 'data-w': true })), 'data-w')
    expect(cls).toEqual(expect.arrayContaining(['border-warn-line', 'bg-warn-bg', 'text-warn']))
    expect(cls.some((c) => c.includes('bad'))).toBe(false)
  })

  it('composes the sentence from the structured reason: view, grammar, token in the code face, the kind looked in (#424)', () => {
    const html = render(
      el(Withheld, { view: 'Coverage', reason: { grammar: 'a section headed', token: '## Requirement → task mapping', lookedIn: plan }, src: 'local', slug: 'a-run' }),
    )
    expect(html).toContain(
      'Coverage withheld — looked for a section headed <span class="font-mono">## Requirement → task mapping</span> in the plan. <a',
    )
  })

  it('links once, to the artifact looked in, named by its kind — never by filename', () => {
    const html = render(el(Withheld, { view: 'Coverage', reason: { grammar: 'a section headed', token: '## X', lookedIn: plan }, src: 'local', slug: 'a-run' }))
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toMatch(/<a [^>]*href="\/runs\/local\/a-run\?tab=record&amp;artifact=plan\.md"[^>]*>Open the plan<\/a>/)
    expect(textOf(html)).not.toContain('plan.md')
  })

  it('names a work item by its id, a Name in the code face', () => {
    const html = render(
      el(Withheld, {
        view: 'Surface view',
        reason: { grammar: 'a list under the key', token: 'file_contact_surface:', lookedIn: ref('tasks/01-core.yaml') },
        src: 'local',
        slug: 'a-run',
      }),
    )
    expect(textOf(html)).toBe(
      'Surface view withheld — looked for a list under the key file_contact_surface: in work item 01-core. Open the work item',
    )
    expect(html).toContain('data-name="true">01-core</span>')
  })

  it('says the record has none, and links nothing, when there is nothing to open', () => {
    const html = render(el(Withheld, { view: 'Parallel safety', reason: { grammar: 'a work item', lookedIn: null }, src: 's', slug: 'r' }))
    expect(textOf(html)).toBe('Parallel safety withheld — looked for a work item, and the record has none.')
    expect(html).not.toContain('<a ')
  })

  it('puts the reader’s remedy after the reason, and drops the link where the reader is already on the artifact', () => {
    const html = render(
      el(Withheld, {
        view: 'Evidence citations',
        reason: { grammar: 'an evidence block headed', token: '### E<k> — AC<n>.<m>', lookedIn: ref('verification-report.md') },
        src: 's',
        slug: 'r',
        after: 'The report is below.',
        link: false,
      }),
    )
    expect(textOf(html)).toBe(
      'Evidence citations withheld — looked for an evidence block headed ### E<k> — AC<n>.<m> in the verification report. The report is below.',
    )
    expect(html).not.toContain('<a ')
  })
})

describe('Diagnostic — the machine’s word as <pre>, under what produced it', () => {
  it('keeps whitespace in a <pre> in ink, labelled in the UI face', () => {
    const html = render(el(Diagnostic, { producer: 'YAML parser' }, 'phase: [this is\n        ^'))
    expect(html).toMatch(/<p class="font-ui[^"]*">YAML parser<\/p><pre class="[^"]*font-mono[^"]*text-ink[^"]*">/)
    expect(html).toContain('phase: [this is\n        ^')
  })

  it('inline, still code face and still labelled', () => {
    const html = render(el(Diagnostic, { producer: 'engine', inline: true }, 'bounced'))
    expect(html).toContain('>engine</span> <code class="font-mono text-ink">bounced</code>')
  })
})

describe('Instruction — the cockpit’s own voice: UI face, unboxed, never in quotes', () => {
  it('is the UI face with no box', () => {
    const cls = classesOf(render(el(Instruction, null, 'Read both sides, then unblock.')), 'data-instruction')
    expect(cls).toContain('font-ui')
    expect(cls.some((c) => c.startsWith('border') || c.startsWith('bg-'))).toBe(false)
  })

  it('throws in dev on a sentence wrapped in quote marks', () => {
    expect(() => render(el(Instruction, null, '“the reviewer said so”'))).toThrow(/never in quotes/)
    expect(() => render(el(Instruction, null, '"quoted"'))).toThrow(/never in quotes/)
  })
})
