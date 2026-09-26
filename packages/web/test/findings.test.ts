// The shared finding row (#296). Two things are worth holding still here, and
// neither is a style preference:
//
//  1. The title must carry a width *floor*. Every other item in the row is
//     `shrink-0`, so a title that can shrink to zero is the only thing the row
//     can squeeze — it keeps its place on the line and collapses into a sliver
//     rather than wrapping, which is exactly what `min-w-0` produced.
//  2. The round-cap panel must not list the review reports itself. The decide
//     card it renders inside already lists them, with verdicts.
//
// These render through `renderToStaticMarkup`, which needs no DOM: the markup
// is what the assertions are about.

import { parseReview } from '@gateline/core/view-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ReviewReport } from '../src/api.ts'
import { FindingCard } from '../src/components/findings.tsx'
import { RoundCapPanel } from '../src/components/rounds.tsx'
import { ref } from './artifact-refs.helper.ts'

const report = (path: string, body: string): ReviewReport => parseReview(path, body) as ReviewReport

const F1 = `### F1 — blocking — retry loop can double-apply a migration
- **Where:** \`src/migrate.py:88\`
- **Failure scenario:** a retried step runs the same ALTER twice
- **Requirement:** R2/AC2.1`

const F2 = `### F2 — minor — the dry-run banner prints after the plan
- **Where:** \`src/migrate.py:12\`
- **Failure scenario:** an operator skimming the output reads the plan as live`

const round = (n: number, findings: string) => `# Review Report: 01-core

**Verdict:** request-changes
**Round:** ${n} of 3
**Diff reviewed:** run branch tip

## Findings

${findings}

## Coverage
R1–R3 checked.
`

const REPORTS = [
  report('review-01.md', round(1, `${F1}\n\n${F2}`)),
  report('review-02.md', round(2, F1)),
  report('review-03.md', round(3, F1)),
]

const finding = REPORTS[0]!.findings[0]!

/** A finding the reviewer disposed of in the same file — the case that gives
 *  the card its fold control, and so the widest metadata to fit beside. */
const foldable = report(
  'review-02.md',
  round(2, `${F1}\n\n${F2}\n\n- **F2 — resolved (round 2):** the banner is the first line now.`),
).findings.find((f) => f.id === 'F2')!

/** The `class` of the one element the card marks as its title column. */
function titleClass(markup: string): string {
  const el = /<span([^>]*\bdata-finding-title\b[^>]*)>/.exec(markup)
  expect(el, 'the finding card must mark its title column').not.toBeNull()
  return /class="([^"]*)"/.exec(el![1]!)?.[1] ?? ''
}

/** The markup of the span that directly wraps the title — the group the title
 *  and the fold control have to share, so that they wrap as one unit. */
function titleGroup(markup: string): string {
  const title = markup.lastIndexOf('<span', markup.indexOf('data-finding-title'))
  expect(title, 'the finding card must mark its title column').toBeGreaterThan(-1)
  const start = markup.lastIndexOf('<span', title - 1)
  expect(start, 'the title must sit inside a group of its own').toBeGreaterThan(-1)
  let depth = 0
  for (const tag of markup.slice(start).matchAll(/<span\b|<\/span>/g)) {
    depth += tag[0] === '</span>' ? -1 : 1
    if (depth === 0) return markup.slice(start, start + tag.index + '</span>'.length)
  }
  throw new Error('unbalanced span markup')
}

describe('FindingCard title column (#296)', () => {
  it('gives the title a width floor instead of letting it shrink to nothing', () => {
    const cls = titleClass(renderToStaticMarkup(createElement(FindingCard, { finding })))
    // `min-w-0` is the defect, not the fix: it is what let the title compress
    // to one word per line beside a row of unshrinkable metadata.
    expect(cls).not.toMatch(/\bmin-w-0\b/)
    expect(cls).toMatch(/\bmin-w-\[/)
    // The floor is what makes flexbox break the line, so the title has to stay
    // a flex item that can take the whole width once it wraps.
    expect(cls).toMatch(/\bflex-1\b/)
  })

  it('keeps the floor on every surface, including the tightest caller', () => {
    // The round-cap caller adds a note pill and a rounds label to the same
    // row; the title's floor is the card's, not the caller's, so it holds.
    const withNote = renderToStaticMarkup(
      createElement(FindingCard, {
        finding,
        source: { task: '01-core', path: 'review-03.md' },
        note: createElement('span', { className: 'shrink-0' }, 'raised again'),
      }),
    )
    expect(titleClass(withNote)).toMatch(/\bmin-w-\[/)
    expect(titleClass(withNote)).not.toMatch(/\bmin-w-0\b/)
    // Verbatim, and still on the same card as its provenance.
    expect(withNote).toContain('retry loop can double-apply a migration')
    expect(withNote).toContain('review-03.md')
  })

  it('wraps the fold control with the title rather than stranding it', () => {
    // The floor makes the title drop to its own line; the disposition button
    // has to come with it. If the button were a sibling of the id and the
    // severity chip, the row could break between them and leave the button
    // alone under the metadata.
    expect(foldable.resolution?.state, 'the fixture must be foldable').toBe('resolved')
    const markup = renderToStaticMarkup(createElement(FindingCard, { finding: foldable, source: { task: '01-core', path: 'review-02.md' } }))
    expect(markup).toContain('<button')
    const group = titleGroup(markup)
    expect(group).toContain('data-finding-title')
    expect(group, 'the fold control shares the title’s wrapping group').toContain('<button')
    // The group is the item the outer row breaks on, so the floor is its own.
    const groupClass = /class="([^"]*)"/.exec(group)?.[1] ?? ''
    expect(groupClass).toMatch(/\bmin-w-\[/)
    expect(groupClass).toMatch(/\bflex-wrap\b/)
  })
})

function renderPanel(reports: ReviewReport[], task: string | null = null): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['reviews', 'local', 'round-cap'], { reports })
  // The run page's cache entry, whose refs name the report a withheld
  // comparison looked in (#424).
  client.setQueryData(['run', 'local', 'round-cap'], { artifactRefs: reports.map((r) => ref(r.path, r.task, r.rounds.at(-1)?.round ?? null)) })
  const tree: ReactNode = createElement(
    QueryClientProvider,
    { client },
    createElement(
      MemoryRouter,
      null,
      createElement(RoundCapPanel, { src: 'local', slug: 'round-cap', task }),
    ),
  )
  return renderToStaticMarkup(tree)
}

describe('RoundCapPanel report links (#296)', () => {
  it('leaves the report list to the decide card it renders inside', () => {
    const markup = renderPanel(REPORTS)
    // It did compare — this is the panel's normal state, not a fallback.
    expect(markup).toContain('Round 2 against round 3')
    expect(markup).not.toContain('The reports, in full')
    expect(markup).not.toContain('data-round-reports')
    // The report names still appear as each finding's provenance; what is gone
    // is the second, verdict-less row of links to them.
    expect(markup).not.toMatch(/<a[^>]*>review-01\.md<\/a>/)
  })

  it('keeps the report list when it withholds the comparison', () => {
    // One round: nothing to compare, and the decide card around it may carry
    // no chips at all, so this branch is the only escape hatch there is.
    const markup = renderPanel([REPORTS[0]!])
    // Composed in web from the structured reason (#424), with the one link
    // named by the contract's kind, never by filename.
    expect(markup).toContain('Round comparison withheld — looked for a second numbered round <span class="font-mono">**Round:** &lt;n of 3&gt;</span> in the review report.')
    expect(markup).toMatch(/<a [^>]*data-withheld-open[^>]*>Open the review report<\/a>/)
    expect(markup).toContain('data-round-reports')
    expect(markup).toMatch(/<a[^>]*>review-01\.md<\/a>/)
  })
})
