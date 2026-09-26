// Spec R3 / ADR-5: `isFixtureSource` is the client-side rule over
// `FIXTURE_SOURCE_ID`, and `FixtureLabel`'s markup carries the hook
// (`[data-fixture-label]`) task 05's e2e looks for, plus the always-visible
// text (AC3.2) — no jsdom needed, `renderToStaticMarkup` is enough (layer 2,
// `packages/vitest.config.ts`).
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FixtureLabel, isFixtureSource } from '../src/components/fixture-label.tsx'

describe('isFixtureSource', () => {
  it('is true for the fixture source id', () => {
    expect(isFixtureSource('fixture')).toBe(true)
  })

  it('is false for a real source id', () => {
    expect(isFixtureSource('gateline')).toBe(false)
  })

  it('is false for a source id that merely contains the fixture id as a substring', () => {
    expect(isFixtureSource('fixtures')).toBe(false)
  })
})

describe('FixtureLabel', () => {
  it('renders the data hook and visible text', () => {
    const html = renderToStaticMarkup(createElement(FixtureLabel))
    expect(html).toContain('data-fixture-label')
    expect(html).toContain('fixture data')
  })

  it('renders the text as a child node, not only inside the title attribute (AC3.2)', () => {
    const html = renderToStaticMarkup(createElement(FixtureLabel))
    // Strip every tag/attribute; if "fixture data" survives, it was in the
    // element's text content, not hover-only inside `title`.
    expect(html.replace(/<[^>]+>/g, '')).toBe('fixture data')
    expect(html).toMatch(/>fixture data</)
  })
})
