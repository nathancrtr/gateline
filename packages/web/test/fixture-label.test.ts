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
})

describe('FixtureLabel', () => {
  it('renders the data hook and visible text', () => {
    const html = renderToStaticMarkup(createElement(FixtureLabel))
    expect(html).toContain('data-fixture-label')
    expect(html).toContain('fixture data')
  })
})
