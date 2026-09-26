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

import { buildEvidenceRollup, buildLexicon, parseReview } from '@gateline/core/view-model'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ArtifactRef, EvidenceRollup, InboxItem, ReviewReport, RunDetailResponse } from '../src/api.ts'
import { G2Packet } from '../src/components/evidence.tsx'
import { FindingCard } from '../src/components/findings.tsx'
import { G1Packet } from '../src/components/g1.tsx'
import { RoundCapPanel } from '../src/components/rounds.tsx'
import { NeedsYouCard } from '../src/pages/run/decide-card.tsx'
import { ref } from './artifact-refs.helper.ts'

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

    it(`${name}: marks the frame busy without minting a second status region`, () => {
      // The packet renders inside the decide card, which already has a
      // role="status" for the commit result. A second one would make "the
      // card's status" ambiguous — to a screen reader, and to any query that
      // asks a card for its status.
      expect(markup).toContain('aria-busy="true"')
      expect(markup).not.toContain('role="status"')
      // A sweep has nothing to read, so it stays out of the tree entirely.
      expect(markup).toContain('aria-hidden="true"')
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

// ---------------------------------------------------------------------------
// #423 — the packet chip row becomes reference rows.
//
// Every decide card offered its artifacts as `imp` chips printing the path:
// `tasks/06-pages-workflow.yaml`, `review-04.md`, `release-plan.md`. A path is
// an Address, and an address never leads (docs/SEAM.md §2). Each row now says
// the kind, the record's name for the artifact, the verdict it states, and
// then the address — always in the DOM, shown on hover or focus.

const ARC_REPORT = `# Review Report: 02-errors

**Verdict:** request-changes
**Round:** 1 of 3

## Findings

### F1 — major — the exit code is swallowed
- **Where:** \`src/cli.py:40\`

## Round 2

**Verdict:** approve
**Round:** 2 of 3
`

const reviewsOf = (...reports: [string, string][]) => ({ reports: reports.map(([p, md]) => parseReview(p, md)) })

interface CardFixture {
  item: Partial<InboxItem> & { packet: string[] }
  refs: ArtifactRef[] | undefined
  artifacts?: ArtifactRef[]
  seed?: (client: QueryClient, slug: string) => void
}

function renderCard({ item, refs: packetRefs, artifacts, seed }: CardFixture): string {
  const slug = 'refs-run'
  const full: InboxItem = {
    kind: 'gate',
    gate: null,
    source: 'local',
    slug,
    title: 'A decision',
    detail: `${slug} is waiting`,
    since: null,
    reviewable: true,
    problems: [],
    inflight: null,
    escalationIndex: null,
    ...item,
    ...(packetRefs ? { packetRefs } : {}),
  } as InboxItem
  const all = artifacts ?? packetRefs ?? []
  const detail = {
    summary: { source: 'local', slug, profile: 'full', tasks: { roundCap: 3 } },
    items: [full],
    state: null,
    stateError: null,
    stateRaw: null,
    validations: {},
    artifacts: all.map((r) => r.path),
    artifactRefs: all,
    history: [],
    branchUrl: null,
    now: 0,
  } as unknown as RunDetailResponse
  return render(createElement(NeedsYouCard, { item: full, now: 0, detail }), (client) => seed?.(client, slug))
}

/** Each reference row, as its own slice of markup. */
function rows(markup: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of markup.matchAll(/<a [^>]*data-ref-row="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) out.set(m[1]!, m[2]!)
  return out
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const kindOf = (row: string) => /data-kind-label="?[^>]*>([^<]*)</.exec(row)?.[1]
const nameOf = (row: string) => /data-name="?[^>]*>([^<]*)</.exec(row)?.[1] ?? null
const verdictsOf = (row: string) => [...row.matchAll(/data-quoted-word="([^"]+)"/g)].map((m) => m[1])
const addressOf = (row: string) => /<span[^>]*data-address[^>]*>([^<]*)</.exec(row)?.[1]

/** Every `.imp` element's text on the card: none may be a path (#423 done-when). */
function impTexts(markup: string): string[] {
  return [...markup.matchAll(/<(\w+)[^>]*class="(?:[^"]*\s)?imp(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => text(m[2]!))
}

function expectNoPathImp(markup: string) {
  const imps = impTexts(markup)
  expect(imps.length, 'the eyebrow is still an impression').toBeGreaterThan(0)
  for (const t of imps) expect(t, `an .imp element carries a path: ${t}`).not.toMatch(/\/|\.(md|ya?ml|json)\b/)
}

const CARDS: Record<string, CardFixture> = {
  G1: {
    item: { gate: 'G1', packet: ['plan.md', 'tasks/01-core.yaml', 'tasks/02-errors.yaml'] },
    refs: [ref('plan.md'), ref('tasks/01-core.yaml'), ref('tasks/02-errors.yaml')],
  },
  G2: {
    item: { gate: 'G2', packet: ['verification-report.md', 'review-01.md', 'review-02.md'] },
    refs: [ref('verification-report.md'), ref('review-01.md', '01-core', 2), ref('review-02.md', '02-errors', 2)],
    seed: (client, slug) => client.setQueryData(['reviews', 'local', slug], reviewsOf(['review-01.md', REPORT], ['review-02.md', ARC_REPORT])),
  },
  G3: {
    item: { gate: 'G3', packet: ['release-plan.md'] },
    refs: [ref('release-plan.md')],
  },
  escalation: {
    item: { kind: 'escalation', packet: ['review-04.md'], escalationIndex: 0, title: 'reviewer escalated task 04-label' },
    refs: [ref('review-04.md', '04-label', 3)],
    seed: (client, slug) =>
      client.setQueryData(['escalation', 'local', slug, 0], {
        index: 0,
        reason: 'reviewer escalated task 04-label — see review-04.md',
        fromRole: 'reviewer',
        role: 'reviewer',
        task: '04-label',
        artifact: 'review-04.md',
        origin: 'role',
        // A composed packet, so the fixture does not depend on the shape of a
        // withheld reason (#424 changes it); the Report row is what is tested.
        section: {
          body: '',
          diffVerdict: 'request-changes',
          tracesTo: 'R2',
          fields: { 'Traces to': 'R2' },
          prose: 'The label is ambiguous.',
          options: ['amend R2', 'split the task'],
          line: 1,
        },
        reportVerdict: 'escalate',
        standingFindings: 2,
        withheld: null,
      }),
  },
  'round-cap': {
    item: { kind: 'round-cap', packet: ['review-01.md', 'review-02.md', 'review-03.md', 'spec.md', 'plan.md'] },
    refs: [
      ref('review-01.md', '01-core', 1),
      ref('review-02.md', '01-core', 2),
      ref('review-03.md', '01-core', 3),
      ref('spec.md'),
      ref('plan.md'),
    ],
  },
}

describe('decide card reference rows (#423)', () => {
  const markup = Object.fromEntries(Object.entries(CARDS).map(([k, f]) => [k, renderCard(f)]))

  for (const [name, fixture] of Object.entries(CARDS)) {
    it(`${name}: one row per packet ref, each with its address present and no path in an impression`, () => {
      const r = rows(markup[name]!)
      expect([...r.keys()]).toEqual(fixture.refs!.map((x) => x.path))
      for (const [path, row] of r) {
        // The address is always in the DOM, for copy and for a screen reader;
        // hover and focus only change whether it is painted.
        expect(addressOf(row)).toBe(path)
        // The address never leads: the kind label comes first.
        expect(row.indexOf('data-kind-label')).toBeLessThan(row.indexOf('data-address'))
        // A Name never carries a path.
        const n = nameOf(row)
        if (n !== null) expect(n).not.toMatch(/\/|\.(md|ya?ml)$/)
      }
      expectNoPathImp(markup[name]!)
    })
  }

  it('G1: the plan is its kind alone; a work item is named by its id', () => {
    const r = rows(markup.G1!)
    expect(kindOf(r.get('plan.md')!)).toBe('Plan')
    expect(nameOf(r.get('plan.md')!)).toBeNull()
    expect(kindOf(r.get('tasks/01-core.yaml')!)).toBe('Work item')
    expect(nameOf(r.get('tasks/01-core.yaml')!)).toBe('01-core')
    // The row is the link into the Record reader, as the chip was.
    expect(markup.G1!).toMatch(/<a [^>]*data-ref-row="tasks\/01-core\.yaml"[^>]*href="\/runs\/local\/refs-run\?tab=record&amp;artifact=tasks%2F01-core\.yaml"/)
  })

  it('G2: a review is named by the task it reviews and carries its verdict words, arc and all', () => {
    const r = rows(markup.G2!)
    expect(kindOf(r.get('verification-report.md')!)).toBe('Verification report')
    expect(nameOf(r.get('verification-report.md')!)).toBeNull()
    const first = r.get('review-01.md')!
    expect(kindOf(first)).toBe('Review report')
    expect(nameOf(first)).toBe('01-core')
    // One review per task in this packet, so no round is needed to tell them apart.
    expect(text(first)).not.toContain('round')
    // Both rounds said request-changes: the verdict in force, once.
    expect(verdictsOf(first)).toEqual(['request-changes'])
    // Rounds that disagree keep the arc the chip showed, as two record words.
    expect(verdictsOf(r.get('review-02.md')!)).toEqual(['request-changes', 'approve'])
    expect(nameOf(r.get('review-02.md')!)).toBe('02-errors')
  })

  it('G3: the release plan is its kind alone', () => {
    const r = rows(markup.G3!)
    expect(kindOf(r.get('release-plan.md')!)).toBe('Release plan')
    expect(nameOf(r.get('release-plan.md')!)).toBeNull()
    expect(verdictsOf(r.get('release-plan.md')!)).toEqual([])
  })

  it('escalation: the report row names its task, and the packet link says "Open the review report"', () => {
    const r = rows(markup.escalation!)
    expect(kindOf(r.get('review-04.md')!)).toBe('Review report')
    expect(nameOf(r.get('review-04.md')!)).toBe('04-label')
    const report = /data-escalation-report[\s\S]*$/.exec(markup.escalation!)![0]
    expect(report).toMatch(/<a [^>]*>Open the review report<\/a>/)
    // The filename follows the UI words as the Address, and is never the link text.
    expect(report).toMatch(/Open the review report<\/a><span[^>]*data-address[^>]*>review-04\.md</)
    expect(report).not.toMatch(/<a [^>]*>review-04\.md<\/a>/)
  })

  it('round-cap: reviews of one task are told apart by round', () => {
    const r = rows(markup['round-cap']!)
    for (const [path, round] of [['review-01.md', 1], ['review-02.md', 2], ['review-03.md', 3]] as const) {
      expect(kindOf(r.get(path)!)).toBe('Review report')
      expect(nameOf(r.get(path)!)).toBe('01-core')
      expect(text(r.get(path)!)).toContain(`round ${round}`)
    }
    expect(kindOf(r.get('spec.md')!)).toBe('Spec')
    // `G<n>` is never a name for a spec: a one-per-run kind has no name.
    expect(nameOf(r.get('spec.md')!)).toBeNull()
  })

  it('an older server with no packetRefs renders no rows and does not crash', () => {
    const html = renderCard({ ...CARDS.G1!, refs: undefined, artifacts: [] })
    expect(html).toContain('data-needs-card')
    expect(html).not.toContain('data-ref-row')
    expect(html).not.toContain('data-packet-refs')
    expectNoPathImp(html)
  })

  it('offers the ledger by kind, not by filename', () => {
    const html = renderCard({ item: { kind: 'paused', packet: ['state.yaml'] }, refs: [ref('state.yaml')] })
    const row = rows(html).get('state.yaml')!
    expect(kindOf(row)).toBe('Run state')
    expect(addressOf(row)).toBe('state.yaml')
  })
})
