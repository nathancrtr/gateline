// The decide packets' quoting layer (#282) and their in-flight state (#299).
//
// Both defects are about what a packet says when it is not saying the words:
// #282 had it printing an artifact's markdown syntax as content, and #299 had
// it saying nothing at all while its read was in flight, in a shape identical
// to a gate that legitimately has no packet.
//
// These render through `renderToStaticMarkup`, which needs no DOM: what the
// assertions are about is the markup. The inputs are real artifacts run
// through core's own parsers, so a change to either grammar fails here rather
// than passing against a hand-built object.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { buildEvidenceRollup, buildLexicon, parseReview } from '@gateline/core/view-model'
import type { EvidenceRollup, ReviewReport } from '../src/api.ts'
import { G2Packet } from '../src/components/evidence.tsx'
import { FindingCard } from '../src/components/findings.tsx'
import { G1Packet } from '../src/components/g1.tsx'
import { RoundCapPanel } from '../src/components/rounds.tsx'

const SPEC = `# Specification: sample

## Requirements

### R1 — Core behavior
**Acceptance criteria:**
- [ ] AC1.1 — the documented output appears

### R2 — Error handling
**Acceptance criteria:**
- [ ] AC2.1 — malformed input exits non-zero
`

/** The shape a verifier actually writes: an `### E<k>` heading over a fenced
 *  command. E2's heading carries a word beyond the restatement, which is the
 *  case where the heading is the reviewer's and not the grammar's. */
const VERIFICATION = `# Verification Report: sample

## Results

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| AC1.1 | verified | see E1 |
| AC2.1 | verified | see E2 |

### E1 — AC1.1
\`\`\`
$ tool sample.txt
ok (3 records)
\`\`\`

### E2 — AC2.1 (rerun after the guard landed)
Run on a clean checkout of \`main\`.
\`\`\`
$ tool garbage.bin; echo exit=$?
error: not a text file
exit=1
\`\`\`
`

const ROLLUP = buildEvidenceRollup({
  lexicon: buildLexicon({ spec: SPEC }),
  verification: VERIFICATION,
}) as EvidenceRollup

function render(node: ReactNode, seed: (client: QueryClient) => void = () => {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed(client)
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)),
  )
}

const g2 = (seed: (client: QueryClient) => void) =>
  render(createElement(G2Packet, { src: 'local', slug: 'g2-pending', profile: 'full' as const }), seed)

const withRollup = (client: QueryClient) => client.setQueryData(['evidence', 'local', 'g2-pending'], ROLLUP)

describe('G2 packet evidence blocks (#282)', () => {
  const markup = g2(withRollup)

  it('renders the fenced command as a code block instead of printing its fences', () => {
    // The fence rows are the markdown's, not the verifier's. The Record reader
    // has always turned them into a code block; this is the packet catching up.
    expect(markup).toContain('$ tool sample.txt')
    expect(markup).not.toContain('```')
    expect(markup).not.toContain('~~~')
    expect(markup).toContain('<pre')
  })

  it('keeps every quoted word byte-identical', () => {
    // Verbatim is the rule that survives the fix: only the marks around the
    // words stop being content.
    expect(markup).toContain('ok (3 records)')
    expect(markup).toContain('error: not a text file')
    expect(markup).toContain('exit=1')
  })

  it('drops the block heading only when it restates the label and the criterion', () => {
    // `### E1 — AC1.1` says what the summary line and the criterion id above it
    // already say, in heading syntax. E2's heading says more, and the more is
    // the reviewer's own word — it stays, without its hashes.
    expect(markup).not.toContain('### E1')
    expect(markup).not.toContain('E1 — AC1.1')
    expect(markup).not.toContain('### E2')
    expect(markup).toContain('E2 — AC2.1 (rerun after the guard landed)')
  })

  it('renders prose between the heading and the fence as prose', () => {
    expect(markup).toContain('Run on a clean checkout of')
    // …with its inline code as code, not as a pair of backticks.
    expect(markup).toContain('<code')
    expect(markup).not.toContain('`main`')
    expect(markup).toContain('>main</code>')
  })

  it('quotes a block that fences nothing without inventing a code block', () => {
    // Contracts are forkable: a verifier may write the proof as prose. Nothing
    // here may drop it, and nothing may dress it up as a command.
    const rollup = buildEvidenceRollup({
      lexicon: buildLexicon({ spec: SPEC }),
      verification: `# Verification Report: sample

### E1 — AC1.1
Read the output by hand against the sample corpus; all three records matched.
`,
    }) as EvidenceRollup
    const prose = g2((client) => client.setQueryData(['evidence', 'local', 'g2-pending'], rollup))
    expect(prose).toContain('Read the output by hand against the sample corpus; all three records matched.')
    expect(prose).not.toContain('<pre')
  })

  it('leaves an unpaired asterisk run alone rather than eating a word', () => {
    // The quoting layer strips marks it can pair. An unpaired one is the
    // reviewer's own character and stays a character.
    const rollup = buildEvidenceRollup({
      lexicon: buildLexicon({ spec: SPEC }),
      verification: `# Verification Report: sample

### E1 — AC1.1
the **glob expanded to 3 files
`,
    }) as EvidenceRollup
    const odd = g2((client) => client.setQueryData(['evidence', 'local', 'g2-pending'], rollup))
    expect(odd).toContain('the **glob expanded to 3 files')
  })
})

const REPORT = `# Review Report: 01-core

**Verdict:** request-changes
**Round:** 1 of 3

## Findings

### F1 — blocking — retry loop can double-apply a migration
- **Where:** \`src/migrate.py:88\`
- **Failure scenario:** a retried step runs the same ALTER twice
- **Requirement:** R2/AC2.1

### F2 — minor — the dry-run banner prints after the plan
- **Where:** \`src/migrate.py:12\`

## Round 2

**Verdict:** request-changes
**Round:** 2 of 3

## Findings

- **F2 — stands (round 2):** the banner moved but still prints inside the plan block.
`

const parsed = parseReview('review-01.md', REPORT) as ReviewReport
const disposed = parsed.findings.find((f) => f.id === 'F2')!

describe('finding ROUND lines (#282)', () => {
  it('renders the disposition’s emphasis instead of echoing its asterisks', () => {
    expect(disposed.resolution?.state, 'the fixture must carry a disposition').toBe('stands')
    const markup = renderToStaticMarkup(createElement(FindingCard, { finding: disposed, defaultOpen: true }))
    expect(markup).not.toContain('**')
    expect(markup).toContain('<strong')
    expect(markup).toContain('F2 — stands (round 2):')
    // The bullet is the list's syntax; the words after it are the reviewer's.
    expect(markup).not.toContain('- <strong')
    expect(markup).toContain('the banner moved but still prints inside the plan block.')
  })

  it('renders a Where path as code rather than as a path wrapped in backticks', () => {
    const markup = renderToStaticMarkup(createElement(FindingCard, { finding: parsed.findings[0]! }))
    expect(markup).toContain('src/migrate.py:88')
    expect(markup).not.toContain('`')
  })
})

// ---------------------------------------------------------------------------
// #299 — nothing rendered while the read is in flight.

const PENDING_HOOK = 'data-packet-pending'

/** Every packet, in the state it reaches before its query resolves. A client
 *  with nothing seeded is exactly that state: `renderToStaticMarkup` does not
 *  fetch, so each query stays pending. */
const PENDING = {
  'G2 packet': { markup: g2(() => {}), frame: 'data-g2-packet', label: 'G2 packet — composed from the record' },
  'G1 packet': {
    markup: render(createElement(G1Packet, { src: 'local', slug: 'g1-pending' })),
    frame: 'data-g1-packet',
    label: 'G1 packet — composed from the record',
  },
  'round cap': {
    markup: render(createElement(RoundCapPanel, { src: 'local', slug: 'round-cap', task: null })),
    frame: 'data-round-cap',
    label: 'Rounds — composed from the record',
  },
}

describe('decide packets while their read is in flight (#299)', () => {
  for (const [name, { markup, frame, label }] of Object.entries(PENDING)) {
    it(`${name}: renders its frame and a sweep rather than nothing`, () => {
      // Rendering nothing put the card in a shape byte-identical to a G0 or G3
      // card, which legitimately has no packet at all — so the operator could
      // not tell "not here yet" from "there is none".
      expect(markup).toContain(frame)
      expect(markup).toContain(PENDING_HOOK)
      // The label does not depend on the read, so it is honest immediately.
      expect(markup).toContain(label)
    })

    it(`${name}: reserves height so the decide buttons below do not shift`, () => {
      // Three sweep lines, the same treatment every artifact read already got.
      expect(markup.match(/class="skel /g) ?? []).toHaveLength(3)
    })
  }

  it('renders no frame at all once the read says the record has no packet', () => {
    // The distinction the skeleton exists to draw only holds if the resolved
    // empty case still renders nothing.
    const markup = render(
      createElement(RoundCapPanel, { src: 'local', slug: 'round-cap', task: null }),
      (client) => client.setQueryData(['reviews', 'local', 'round-cap'], { reports: [] }),
    )
    expect(markup).toBe('')
  })

  it('replaces the sweep with the packet once the read resolves', () => {
    const markup = g2(withRollup)
    expect(markup).not.toContain(PENDING_HOOK)
    expect(markup).toContain('data-criterion="AC1.1"')
  })
})
