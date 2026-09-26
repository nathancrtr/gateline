// The run-page polish batch (#285), item by item.
//
// Nine small defects share one thing: each is a view saying something twice, or
// saying a non-value as if it were a value. That makes them testable at layer 1
// and 2 of `vitest.config.ts`'s map even though every one of them was *found*
// by eye — the fix is always "this string is not rendered" or "this string is",
// and neither needs layout. What is left over for the browser, and was checked
// there, is whether the result reads well; what is left over for
// `e2e/geometry.spec.ts` is whether it still fits.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { G1Packet as G1PacketData, InboxItem, RunSummary } from '../src/api.ts'
import { AgeBadge, BudgetMeter, PhaseSpine } from '../src/components/chips.tsx'
import { BOUNCED_INSTRUCTION, DecidePanel, ROUND_CAP_INSTRUCTION } from '../src/components/decide.tsx'
import { G1Packet } from '../src/components/g1.tsx'
import { CardFacts } from '../src/pages/run/decide-card.tsx'
import { burdenPillNeeded, cardInstruction, contractBadgeName, roundsLabel } from '../src/pages/run.tsx'
import { artifactRank, orderArtifacts } from '../src/record-rail.ts'
import { paths, ref, refs } from './artifact-refs.helper.ts'
import { NO_FACTS } from './inbox-facts.helper.ts'

const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: 'G2',
    escalationIndex: null,
    inflight: null,
    reviewable: true,
    title: 'G2 — Does the evidence support merging?',
    detail: 'a-run is waiting on G2',
    since: 1,
    packet: [],
    packetRefs: [],
    problems: [],
    ...NO_FACTS,
    question: 'Does the evidence support merging?',
    ...(over as object),
  }) as InboxItem

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)),
  )
}

/** The exact string core writes for a `bad-state` run — into `stateError`, into
 *  the card's `detail`, and into its one `problem`, all three the same object. */
const PARSE_ERROR =
  'state.yaml is not valid YAML: Implicit keys of flow sequence pairs need to be on a single line at line 3, column 9:\n\nphase: [this is\n        ^\n'

describe('1 · the malformed card says the parse error once', () => {
  // #433: the card no longer prints core's `detail` beside `problems`, so the
  // byte-equality filter that kept the two from doubling is gone with it. The
  // diagnostic renders once, whole, under the label of what produced it.
  it('renders the parser’s diagnostic once, byte for byte, in a <pre>', () => {
    const malformed = item({ kind: 'malformed', gate: null, title: 'Malformed run state', detail: PARSE_ERROR, problems: [PARSE_ERROR] })
    const html = render(createElement(CardFacts, { item: malformed, now: 2 }))
    const escaped = PARSE_ERROR.replace(/\n$/, '')
    expect(html.split('phase: [this is').length - 1).toBe(1)
    expect(html).toContain('<pre')
    expect(html).toContain(escaped.split('\n')[0])
    expect(html).toContain('Run state parser')
  })
})

describe('2 · the ledger states a burden once', () => {
  it('drops the pill when the commit subject already brackets the word', () => {
    expect(burdenPillNeeded('G1 approved by operator [burden: light-correction]', 'light-correction')).toBe(false)
    expect(burdenPillNeeded('G0 approved by operator [burden: confirmation]', 'confirmation')).toBe(false)
  })

  it('keeps it on a v0 subject, where the endpoint is the only source of the word', () => {
    expect(burdenPillNeeded('G2 approved by operator', 'heavy-correction')).toBe(true)
  })
})

describe('3 · the contract badge names the contract by kind, and stops echoing the filename', () => {
  it('names the kind, with no Address when the contract is the file’s own name', () => {
    expect(contractBadgeName('verification-report.md', 'verification-report.md', 'verification report')).toEqual({
      name: 'verification report',
      address: null,
    })
    expect(contractBadgeName('state.yaml', 'state.yaml', 'run state')).toEqual({ name: 'run state', address: null })
  })

  it('names the kind and follows it with the contract’s file when the path did not say it (#424)', () => {
    expect(contractBadgeName('review-01.md', 'review-report.md', 'review report')).toEqual({ name: 'review report', address: 'review-report.md' })
    expect(contractBadgeName('tasks/01-core.yaml', 'work-item.yaml', 'work item')).toEqual({ name: 'work item', address: 'work-item.yaml' })
  })

  it('never mints a name from the file when no reference names the kind', () => {
    expect(contractBadgeName('review-01.md', 'review-report.md', null)).toEqual({ name: null, address: 'review-report.md' })
  })

  it('has nothing to name for a presence-only artifact', () => {
    expect(contractBadgeName('retro.md', null, null)).toEqual({ name: null, address: null })
  })
})

describe('4 · the record reads in pipeline order', () => {
  it('puts the run’s narrative back in the order it happened', () => {
    const alphabetical = [
      'intent-brief.md',
      'plan.md',
      'review-01.md',
      'review-02.md',
      'spec.md',
      'state.yaml',
      'tasks/01-core.yaml',
      'tasks/02-errors.yaml',
      'verification-report.md',
    ]
    expect(paths(orderArtifacts(refs(alphabetical)))).toEqual([
      'intent-brief.md',
      'spec.md',
      'plan.md',
      'tasks/01-core.yaml',
      'tasks/02-errors.yaml',
      'review-01.md',
      'review-02.md',
      'verification-report.md',
      'state.yaml',
    ])
  })

  it('keeps the ledger last and the release plan after the verification it follows', () => {
    const ordered = orderArtifacts(refs(['state.yaml', 'release-plan.md', 'verification-report.md']))
    expect(paths(ordered)).toEqual(['verification-report.md', 'release-plan.md', 'state.yaml'])
  })

  it('lands an artifact the framework has no position for between the phases and the ledger', () => {
    expect(artifactRank(ref('retro.md'))).toBeGreaterThan(artifactRank(ref('release-plan.md')))
    expect(artifactRank(ref('retro.md'))).toBeLessThan(artifactRank(ref('state.yaml')))
  })

  it('sorts numbered siblings by name, which is their own order', () => {
    expect(paths(orderArtifacts(refs(['tasks/03-cli.yaml', 'tasks/01-core.yaml', 'tasks/02-errors.yaml'])))).toEqual([
      'tasks/01-core.yaml',
      'tasks/02-errors.yaml',
      'tasks/03-cli.yaml',
    ])
  })

  it('does not mutate the list it was handed', () => {
    const given = refs(['state.yaml', 'spec.md'])
    orderArtifacts(given)
    expect(paths(given)).toEqual(['state.yaml', 'spec.md'])
  })
})

describe('5 · a non-value reads as one', () => {
  it('shows an em dash for a run with no tasks to have a round count of', () => {
    expect(roundsLabel({ total: 0, done: 0, maxRounds: 0, roundCap: 3 })).toBe('—')
  })

  it('prints a true zero over the cap it is judged against, never the observation alone (#314)', () => {
    expect(roundsLabel({ total: 3, done: 0, maxRounds: 0, roundCap: 3 })).toBe('0/3')
    expect(roundsLabel({ total: 1, done: 0, maxRounds: 3, roundCap: 3 })).toBe('3/3')
    expect(roundsLabel({ total: 1, done: 0, maxRounds: 2, roundCap: 4 })).toBe('2/4')
  })
})

describe('5 · a zero-spend budget states the record, not a word of its own (#443)', () => {
  it('states $0 of the ceiling when nothing has been spent, never "unmetered"', () => {
    const html = renderToStaticMarkup(createElement(BudgetMeter, { limit: 25, spent: 0 }))
    expect(html).not.toContain('unmetered')
    expect(html).toContain('$0 / $25')
    // The limit is also reachable in the tooltip, at the same precision nonzero spend gets.
    expect(html).toContain('$0.00 of $25.00')
  })

  it('reads the same way for a staged run, whose spend is recorded as null rather than 0', () => {
    const html = renderToStaticMarkup(createElement(BudgetMeter, { limit: 18.5, spent: null }))
    expect(html).not.toContain('unmetered')
    expect(html).toContain('$0.00 of $18.50')
    expect(html).toContain('$0 / $19')
  })

  it('draws the bar the moment a dispatch spends something, same shape as zero spend', () => {
    const html = renderToStaticMarkup(createElement(BudgetMeter, { limit: 25, spent: 6.4 }))
    expect(html).toContain('width')
    expect(html).toContain('$6 / $25')
  })

  it('still says "no budget" when none is recorded', () => {
    expect(renderToStaticMarkup(createElement(BudgetMeter, { limit: null, spent: null }))).toContain('no budget')
  })
})

describe('6 · the instruction moves to the description slot', () => {
  it('is the round-cap card’s, and the bounce card’s, and nobody else’s', () => {
    expect(cardInstruction(item({ kind: 'round-cap', gate: null }))?.text).toBe(ROUND_CAP_INSTRUCTION)
    expect(cardInstruction(item({ reviewable: false }))?.text).toBe(BOUNCED_INSTRUCTION)
    expect(cardInstruction(item({}))).toBeNull()
    expect(cardInstruction(item({ kind: 'paused', gate: null }))).toBeNull()
  })

  it('no longer renders at the card foot, where the buttons go', () => {
    for (const over of [{ kind: 'round-cap' as const, gate: null }, { reviewable: false }]) {
      const html = render(createElement(DecidePanel, { item: item(over), profile: 'full' as const }))
      expect(html).not.toContain('Read both sides')
      expect(html).not.toContain('fix the artifacts')
    }
  })
})

describe('7 · the aging clock takes a space', () => {
  it('separates the glyph from the words it qualifies', () => {
    for (const props of [{ label: 'waiting 4d', urgent: true }, { label: '9d', urgent: true, stale: true }]) {
      const html = renderToStaticMarkup(createElement(AgeBadge, props))
      expect(html).toContain('⏱')
      expect(html).toContain('mr-[4px]')
      expect(html).not.toContain('mr-[2px]')
    }
  })

  it('shows no glyph below the three-day threshold, which is unchanged', () => {
    expect(renderToStaticMarkup(createElement(AgeBadge, { label: '2d', urgent: false }))).not.toContain('⏱')
  })
})

const PACKET: G1PacketData = {
  coverage: [
    { id: 'R1', shortName: 'Core behavior', defined: true, mapped: ['01-core'], unknownTasks: [], claimedBy: [] },
    { id: 'R2', shortName: 'Error handling', defined: true, mapped: ['02-errors'], unknownTasks: [], claimedBy: [] },
  ],
  unmappedTasks: ['03-cli'],
  mappingWithheld: null,
  tasksWithheld: null,
  overlaps: [],
  tasks: [],
} as unknown as G1PacketData

describe('8 · the coverage orphan is boxed with its group', () => {
  it('renders inside the ul, in the same boxed shape as the rest', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['g1', 'local', 'g1-pending'], PACKET)
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(MemoryRouter, null, createElement(G1Packet, { src: 'local', slug: 'g1-pending' })),
      ),
    )
    const list = /<ul[^>]*>(.*?)<\/ul>/s.exec(html)
    expect(list, 'the coverage list should be present').not.toBeNull()
    expect(list![1]).toContain('data-unmapped-tasks')
    expect(list![1]).toContain('no mapping row names: 03-cli')
    // Boxed like its siblings: the same border/background the neutral coverage
    // rows carry, rather than a bare paragraph in a section-label register.
    expect(html).toMatch(/<li[^>]*border[^>]*data-unmapped-tasks|data-unmapped-tasks[^>]*>/)
  })
})

const summary = (over: Partial<RunSummary> = {}): RunSummary =>
  ({
    source: 'local',
    slug: 'malformed-spec',
    ref: 'run/malformed-spec',
    kind: 'branch',
    phase: 'spec',
    profile: 'full',
    pausedReason: null,
    closure: null,
    budget: { limit: 25, spent: 0 },
    tasks: { total: 0, done: 0, maxRounds: 0, roundCap: 3 },
    updatedAt: null,
    aheadOfOrigin: null,
    behindOrigin: null,
    gates: {
      G0: { approved: false, decided: false, by: null, at: null, burden: null },
      G1: { approved: false, decided: false, by: null, at: null, burden: null },
      G2: { approved: false, decided: false, by: null, at: null, burden: null },
      G3: { approved: false, decided: false, by: null, at: null, burden: null },
    },
    ...(over as object),
  }) as unknown as RunSummary

describe('9 · a bounced gate’s spine cell stops claiming to be pending', () => {
  const titles = (items?: InboxItem[]) => {
    const html = renderToStaticMarkup(createElement(PhaseSpine, { summary: summary(), items }))
    return [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]!)
  }

  it('says the packet bounced when the run page hands it the inbox items', () => {
    const bounced = [item({ slug: 'malformed-spec', gate: 'G0', reviewable: false })]
    expect(titles(bounced).find((t) => t.startsWith('G0'))).toContain('on the table — packet bounced')
  })

  it('still says pending for a gate whose packet is fine', () => {
    expect(titles([item({ slug: 'malformed-spec', gate: 'G0', reviewable: true })]).find((t) => t.startsWith('G0'))).toContain(
      'pending your decision',
    )
  })

  it('falls back to pending when no items are passed, which is every other call site', () => {
    expect(titles().find((t) => t.startsWith('G0'))).toContain('pending your decision')
  })
})
