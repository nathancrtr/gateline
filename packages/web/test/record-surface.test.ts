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

// The contract badge and the failure notice (#424): the contract is named by
// its kind, with its file as the Address after it, and the notice is said
// once — in the reader, beside the bytes it is about. The rail keeps the badge.
describe('the reader names a failed contract by kind, once', () => {
  const REVIEW = 'review-01.md'
  const validation = { contract: 'review-report.md', ok: false, missing: ['## Findings'], notes: [] }

  function renderFailing(): string {
    const d = {
      ...detail(true),
      artifacts: [...PATHS, REVIEW],
      artifactRefs: refs([...PATHS, REVIEW]),
      validations: { [REVIEW]: validation },
    } as unknown as RunDetailResponse
    const client = new QueryClient()
    client.setQueryData(['artifact', 'repo', 'run', REVIEW], { content: '# Review Report: 01-core\n\n**Verdict:** approve\n', validation })
    return renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(QueryClientProvider, { client }, createElement(RecordSurface, { detail: d, selected: REVIEW, onSelect: () => {} })),
      ),
    )
  }

  it('says the failure once, in the reader, naming the review report contract with its file after it', () => {
    const html = renderFailing()
    expect(html.match(/Fails its/g)).toHaveLength(1)
    const notice = html.match(/<p [^>]*data-contract-failure[^>]*>(.*?)<\/p>/)?.[1] ?? ''
    expect(notice.replace(/<[^>]+>/g, '')).toBe('Fails its review report contract review-report.md — missing: ## Findings')
    expect(notice).toMatch(/<span [^>]*data-address[^>]*>review-report\.md<\/span>/)
  })

  it('badges the reader by kind, the contract’s file as the Address beside it', () => {
    const badge = renderFailing().match(/<span [^>]*data-contract-badge[^>]*>(.*?)<\/span><\/div>/)?.[1] ?? ''
    expect(badge.replace(/<[^>]+>/g, '')).toBe('✕fails the review report contract review-report.md')
  })
})
