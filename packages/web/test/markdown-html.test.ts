// An HTML comment in an artifact is a drafting note, not prose (run-record.png
// showed one leaking into the rendered page verbatim). `react-markdown` without
// `rehype-raw` already refuses to execute raw HTML; `rawAsText` drops a node
// that is only a comment and keeps every other raw node as text (#434).
//
// Renders through `renderToStaticMarkup`, which needs no DOM: the markup is
// what the assertion is about.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/markdown.tsx'

describe('Markdown drops an HTML comment instead of printing it', () => {
  it('renders the paragraph and omits the comment text', () => {
    const body = '<!-- Drafted from the founder\'s notes -->\n\nThe actual paragraph.'
    const markup = renderToStaticMarkup(createElement(Markdown, null, body))
    expect(markup).toContain('The actual paragraph.')
    expect(markup).not.toContain('Drafted from the founder')
    expect(markup).not.toContain('<!--')
  })
})

// #434: every other raw HTML node is the record's characters, and survives as
// text. These are real lines from committed work items that `skipHtml` used to
// eat with nothing shown.
describe('Markdown keeps raw HTML as the text it was written as', () => {
  const render = (body: string) => renderToStaticMarkup(createElement(Markdown, null, body))

  it('an inline element placeholder (fleetview-design 03-shell-masthead)', () => {
    const markup = render('`<main>` still renders <Outlet/> inside the shell.')
    expect(markup).toContain('<code>&lt;main&gt;</code>')
    expect(markup).toContain('still renders &lt;Outlet/&gt; inside the shell.')
  })

  it('an angle-bracket placeholder in a note (creation-seam 04-pr-ensure)', () => {
    const markup = render('ensure the PR for <branch> exists before arming')
    expect(markup).toContain('the PR for &lt;branch&gt; exists')
  })

  it('placeholders inside a path (gatehouse-demo)', () => {
    const markup = render('GET /api/runs/<src>/<slug>/artifact serves the bytes')
    expect(markup).toContain('/api/runs/&lt;src&gt;/&lt;slug&gt;/artifact')
  })

  it('a block of HTML stays as text, and a lone comment still goes', () => {
    const markup = render('<div class="x">kept</div>\n\n<!-- note -->\n\nafter')
    expect(markup).toContain('&lt;div class=&quot;x&quot;&gt;kept&lt;/div&gt;')
    expect(markup).not.toContain('note')
  })
})
