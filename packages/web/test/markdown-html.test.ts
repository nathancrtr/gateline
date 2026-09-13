// An HTML comment in an artifact is a drafting note, not prose (run-record.png
// showed one leaking into the rendered page verbatim). `react-markdown` without
// `rehype-raw` already refuses to execute raw HTML, but it still emits the raw
// bytes as visible text unless `skipHtml` is set — this locks that down.
//
// Renders through `renderToStaticMarkup`, which needs no DOM: the markup is
// what the assertion is about.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../src/components/markdown.tsx'

describe('Markdown drops raw HTML instead of printing it (skipHtml)', () => {
  it('renders the paragraph and omits the comment text', () => {
    const body = '<!-- Drafted from the founder\'s notes -->\n\nThe actual paragraph.'
    const markup = renderToStaticMarkup(createElement(Markdown, null, body))
    expect(markup).toContain('The actual paragraph.')
    expect(markup).not.toContain('Drafted from the founder')
    expect(markup).not.toContain('<!--')
  })
})
