// The Record surface over an older server (#415). `artifactRefs` is additive
// for one release (docs/SEAM.md §8.5), and under `up` a `self-update` rebuilds
// the page while the old server drains for minutes, so a new page meets a
// payload without refs. It must render, derive no kinds, and say why.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { RunDetailResponse } from '../src/api.ts'
import { RecordSurface } from '../src/pages/run/record.tsx'
import { refs } from './artifact-refs.helper.ts'

const PATHS = ['intent-brief.md', 'spec.md', 'state.yaml']

function detail(withRefs: boolean): RunDetailResponse {
  const base = {
    summary: { source: 'repo', slug: 'run', profile: 'full' },
    items: [],
    state: null,
    stateError: null,
    stateRaw: null,
    validations: {},
    artifacts: PATHS,
    history: [],
    branchUrl: null,
    now: 0,
  }
  return (withRefs ? { ...base, artifactRefs: refs(PATHS) } : base) as unknown as RunDetailResponse
}

const render = (d: RunDetailResponse) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(RecordSurface, { detail: d, selected: null, onSelect: () => {} }),
      ),
    ),
  )

describe('RecordSurface without artifactRefs', () => {
  it('renders, lists nothing it would have to guess, and asks for a restart', () => {
    const html = render(detail(false))
    expect(html).toContain('data-instruction')
    expect(html).toContain('This server is older than the page')
    expect(html).not.toContain('data-artifact-entry')
  })

  it('says nothing of the kind when the refs are there', () => {
    const html = render(detail(true))
    expect(html).not.toContain('This server is older than the page')
    expect(html).toContain('data-artifact-entry="spec.md"')
  })
})
