// The Record reader starts a spec criterion's check on a line of its own (R5).
// Markdown folds a criterion's lines into one paragraph, so the check line
// ran on from the promise; `criterionCheckRehype` wraps it in a block span.
//
// Static markup of `Markdown` with no `LexiconProvider`: the step reads no
// lexicon, and without one it is the only stage that looks at `sourceKind`.
// Line placement itself needs a browser, and lives in the e2e suite.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import type { ArtifactKind } from '../src/api.ts'
import { Markdown, rawAsText } from '../src/components/markdown.tsx'

const render = (body: string, sourceKind?: ArtifactKind) =>
  renderToStaticMarkup(createElement(Markdown, { sourceKind } as Parameters<typeof Markdown>[0], body))

const OPEN = '<span data-criterion-check="" class="block">'

describe('a spec criterion with a check (AC5.1)', () => {
  it('wraps the brief\'s port example, leaving the promise outside', () => {
    const markup = render('- [ ] AC1.1 — The snapshot generator never opens a network port.\n  Check: its script contains neither port-binding call the server makes.\n', 'spec')
    expect(markup).toContain(`AC1.1 — The snapshot generator never opens a network port.\n${OPEN}Check: its script contains neither port-binding call the server makes.</span></li>`)
  })

  it('keeps all three lines of a wrapped check inside the one span', () => {
    const markup = render('- [ ] AC1.4 — The check keeps every line.\n  Check: a unit test on the example\n  finds its third line\n  ending the check.\n', 'spec')
    expect(markup).toContain(`AC1.4 — The check keeps every line.\n${OPEN}Check: a unit test on the example\nfinds its third line\nending the check.</span></li>`)
  })

  it('keeps an inline code span inside the check', () => {
    const markup = render('- [ ] AC2.4 — The lexicon still imports nothing.\n  Check: run `npm test` in `packages/` and see it pass.\n', 'spec')
    expect(markup).toContain(`AC2.4 — The lexicon still imports nothing.\n${OPEN}Check: run <code>npm test</code> in <code>packages/</code> and see it pass.</span></li>`)
  })

  it('stops before a nested list, in a tight item and in a loose one', () => {
    const tight = render('- AC3.1 — Tight promise.\n  Check: tight check.\n  - nested item\n', 'spec')
    expect(tight).toContain(`AC3.1 — Tight promise.\n${OPEN}Check: tight check.</span>\n<ul>\n<li>nested item</li>`)
    const loose = render('- AC3.1 — Loose promise.\n  Check: loose check.\n\n  - nested item\n\n- AC3.2 — Tight promise.\n', 'spec')
    expect(loose).toContain(`<p>AC3.1 — Loose promise.\n${OPEN}Check: loose check.</span></p>\n<ul>\n<li>nested item</li>`)
  })
})

describe('a spec with no check lines renders as before (AC5.2)', () => {
  const dupefind = readFileSync(new URL('../../../runs/dupefind/spec.md', import.meta.url), 'utf8')

  it('the dupefind spec renders the same as a spec as with no kind', () => {
    const asSpec = render(dupefind, 'spec')
    expect(asSpec).toContain('AC9.3 — The file parses without error')
    expect(asSpec).not.toContain('data-criterion-check')
    expect(asSpec).toBe(render(dupefind))
    // And the same as the pipeline before the step existed, so a step that
    // acted on every kind alike could not pass by changing both renders.
    const before = renderToStaticMarkup(
      createElement('div', { className: 'prose-artifact' }, createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rawAsText] }, dupefind)),
    )
    expect(asSpec).toBe(before)
  })
})

// Each expected string is the pre-change code's output, captured before the
// step was registered.
describe('a line starting Check: outside a spec criterion renders as before (AC5.3)', () => {
  it('a plan paragraph, and a plan bullet shaped like a criterion', () => {
    const body = 'The reader keeps this paragraph as one run.\nCheck: a plan line that starts with the label.\n\n- AC1.1 — A plan bullet shaped like a criterion.\n  Check: its label line stays in the run.\n'
    expect(render(body, 'plan')).toBe(
      '<div class="prose-artifact"><p>The reader keeps this paragraph as one run.\nCheck: a plan line that starts with the label.</p>\n<ul>\n<li>AC1.1 — A plan bullet shaped like a criterion.\nCheck: its label line stays in the run.</li>\n</ul></div>',
    )
  })

  it('a spec paragraph, and a spec bullet that is not a criterion', () => {
    const body = '## Assumptions\n\nA spec paragraph outside any criterion.\nCheck: this line starts with the label.\n\n- **ASSUMPTION:** A spec bullet that is not a criterion.\n  Check: its label line stays in the run.\n'
    expect(render(body, 'spec')).toBe(
      '<div class="prose-artifact"><h2>Assumptions</h2>\n<p>A spec paragraph outside any criterion.\nCheck: this line starts with the label.</p>\n<ul>\n<li><strong>ASSUMPTION:</strong> A spec bullet that is not a criterion.\nCheck: its label line stays in the run.</li>\n</ul></div>',
    )
  })

  it('a criterion with Check: in its first line and a lower-case check: second line', () => {
    const body = '- [ ] AC1.5 — The words Check: inside the first line start nothing.\n  check: a lower-case second line stays in the promise.\n'
    expect(render(body, 'spec')).toBe(
      '<div class="prose-artifact"><ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" disabled=""/> AC1.5 — The words Check: inside the first line start nothing.\ncheck: a lower-case second line stays in the promise.</li>\n</ul></div>',
    )
  })
})
