// The run-page polish batch (#285), item by item.
//
// Nine small defects share one thing: each is a view saying something twice, or
// saying a non-value as if it were a value. That makes them testable at layer 1
// and 2 of `vitest.config.ts`'s map even though every one of them was *found*
// by eye — the fix is always "this string is not rendered" or "this string is",
// and neither needs layout. What is left over for the browser, and was checked
// there, is whether the result reads well; what is left over for
// `e2e/geometry.spec.ts` is whether it still fits.
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { G1Packet as G1PacketData, InboxItem, RunSummary } from '../src/api.ts'
import { AgeBadge, BudgetMeter, PhaseSpine } from '../src/components/chips.tsx'
import { BOUNCED_INSTRUCTION, DecidePanel, ROUND_CAP_INSTRUCTION } from '../src/components/decide.tsx'
import { G1Packet } from '../src/components/g1.tsx'
import {
  artifactRank,
  burdenPillNeeded,
  cardInstruction,
  contractBadgeName,
  maxRoundsLabel,
  orderArtifacts,
  visibleProblems,
} from '../src/pages/run.tsx'

const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: 'G2',
    escalationIndex: null,
    reviewable: true,
    title: 'G2 — Does the evidence support merging?',
    detail: 'a-run is waiting on G2',
    since: 1,
    packet: [],
    problems: [],
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
  it('drops the problem that is the description again, byte for byte', () => {
    const malformed = item({ kind: 'malformed', gate: null, title: 'Malformed run state', detail: PARSE_ERROR, problems: [PARSE_ERROR] })
    expect(visibleProblems(malformed)).toEqual([])
  })

  it('keeps a bounced gate’s problems, which name sections the description does not', () => {
    const bounced = item({
      reviewable: false,
      detail: 'Packet malformed — bounced, not reviewable',
      problems: ['spec.md: missing required sections — Requirements, Assumptions'],
    })
    expect(visibleProblems(bounced)).toEqual(['spec.md: missing required sections — Requirements, Assumptions'])
  })

  it('is byte equality, not containment — a problem that merely overlaps still renders', () => {
    const overlapping = item({ detail: 'Packet malformed', problems: ['Packet malformed — and one more thing'] })
    expect(visibleProblems(overlapping)).toHaveLength(1)
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

describe('3 · the contract badge stops echoing the filename', () => {
  it('says nothing extra when the contract is the file’s own name', () => {
    expect(contractBadgeName('verification-report.md', 'verification-report.md')).toBe('')
    expect(contractBadgeName('state.yaml', 'state.yaml')).toBe('')
  })

  it('names the contract when it is a different file, which the path did not say', () => {
    expect(contractBadgeName('review-01.md', 'review-report.md')).toBe('review-report.md ')
    expect(contractBadgeName('tasks/01-core.yaml', 'work-item.yaml')).toBe('work-item.yaml ')
  })

  it('has nothing to name for a presence-only artifact', () => {
    expect(contractBadgeName('retro.md', null)).toBe('')
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
    expect(orderArtifacts(alphabetical)).toEqual([
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
    const ordered = orderArtifacts(['state.yaml', 'release-plan.md', 'verification-report.md'])
    expect(ordered).toEqual(['verification-report.md', 'release-plan.md', 'state.yaml'])
  })

  it('lands an artifact the framework has no position for between the phases and the ledger', () => {
    expect(artifactRank('retro.md')).toBeGreaterThan(artifactRank('release-plan.md'))
    expect(artifactRank('retro.md')).toBeLessThan(artifactRank('state.yaml'))
  })

  it('sorts numbered siblings by name, which is their own order', () => {
    expect(orderArtifacts(['tasks/03-cli.yaml', 'tasks/01-core.yaml', 'tasks/02-errors.yaml'])).toEqual([
      'tasks/01-core.yaml',
      'tasks/02-errors.yaml',
      'tasks/03-cli.yaml',
    ])
  })

  it('does not mutate the list it was handed', () => {
    const given = ['state.yaml', 'spec.md']
    orderArtifacts(given)
    expect(given).toEqual(['state.yaml', 'spec.md'])
  })
})

describe('5 · a non-value reads as one', () => {
  it('shows an em dash for a run with no tasks to have a round count of', () => {
    expect(maxRoundsLabel({ total: 0, done: 0, maxRounds: 0 })).toBe('—')
  })

  it('prints a true zero, which is what the portfolio column does with the same run', () => {
    expect(maxRoundsLabel({ total: 3, done: 0, maxRounds: 0 })).toBe('0')
    expect(maxRoundsLabel({ total: 1, done: 0, maxRounds: 3 })).toBe('3')
  })
})

describe('5 · an unmetered budget is a word, not a meter', () => {
  it('draws no bar when nothing has been spent', () => {
    const html = renderToStaticMarkup(createElement(BudgetMeter, { limit: 25, spent: 0 }))
    expect(html).toContain('unmetered')
    expect(html).not.toContain('width')
    // The limit the bar stood for is still reachable.
    expect(html).toContain('$0.00 of $25.00')
  })

  it('draws the bar again the moment a dispatch spends something', () => {
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
    tasks: { total: 0, done: 0, maxRounds: 0 },
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
