// Inbox and card lines composed from facts (#433, docs/SEAM.md §7).
//
// Core used to send each inbox item a `title` and a `detail` — sentences it
// composed for the inbox row, which the card then reprinted and defended
// itself against (`restatesWhatIsShown`). Core now states facts, and each
// surface composes its own line. What is pinned here, per item kind: the row's
// title and second line, the card's heading and fact lines, and that none of
// them carries a filename or a run path except inside an Address — the one
// place an address belongs (§2: "a filename is never a label").
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { ArtifactRef, InboxItem, RunDetailResponse } from '../src/api.ts'
import {
  ARM_INSTRUCTION,
  HAND_EDIT_INSTRUCTIONS,
  LOST_DISPATCH_INSTRUCTION,
  PAUSED_INSTRUCTIONS,
  pausedInstruction,
} from '../src/components/decide.tsx'
import { InboxRow, inboxLine, inboxTitle } from '../src/pages/inbox.tsx'
import { NeedsYouCard } from '../src/pages/run/decide-card.tsx'
import { ref } from './artifact-refs.helper.ts'
import { NO_FACTS } from './inbox-facts.helper.ts'

const NOW = 1_800_000_000
const HOUR = 3600

const item = (over: Partial<InboxItem>): InboxItem =>
  ({
    source: 'local',
    slug: 'a-run',
    kind: 'gate',
    gate: null,
    escalationIndex: null,
    inflight: null,
    reviewable: true,
    // The kept-for-one-release sentences, set to something no view may print:
    // a test that finds them on the page has found a reader of them.
    title: 'KEPT-TITLE runs/a-run/state.yaml',
    detail: 'KEPT-DETAIL see review-04.md',
    since: NOW - 3 * HOUR,
    packet: [],
    packetRefs: [],
    problems: [],
    ...NO_FACTS,
    ...(over as object),
  }) as InboxItem

const PARSE_ERROR =
  'state.yaml is not valid YAML: Implicit keys of flow sequence pairs need to be on a single line at line 3, column 9:\n\nphase: [this is\n        ^\n'

const bounce = (path: string, missing: string[]) => {
  const artifact = ref(path)
  return { artifact, path, contractName: artifact.contractName, missing, unit: 'sections' as const, absent: false }
}

/** One item per kind and gate state, carrying the facts core derives for the demo fixture of the same name. */
const ITEMS: Record<string, InboxItem> = {
  'g2-pending': item({ gate: 'G2', question: 'Does the evidence support merging?', packet: ['review-01.md'], packetRefs: [ref('review-01.md')] }),
  'malformed-release': item({
    gate: 'G3',
    question: 'Ship it?',
    reviewable: false,
    problems: ['release-plan.md: missing required sections — Rollback plan, CI health'],
    bouncedBy: [bounce('release-plan.md', ['Rollback plan', 'CI health'])],
    packet: ['release-plan.md'],
    packetRefs: [ref('release-plan.md')],
  }),
  'patch-g1-bounced': item({
    gate: 'G1',
    question: 'Is this the change we want, scoped this way?',
    reviewable: false,
    problems: ['intent-brief.md missing from run directory'],
    bouncedBy: [{ artifact: ref('intent-brief.md'), path: 'intent-brief.md', contractName: 'intent brief', missing: [], unit: 'sections', absent: true }],
  }),
  'g0-redispatched': item({
    gate: 'G0',
    question: 'Is this what we actually want built?',
    reviewable: false,
    inflight: { role: 'analyst', since: NOW - HOUR },
    waitingOn: { role: 'analyst', since: NOW - HOUR, artifact: ref('spec.md'), lost: false },
    superseded: true,
  }),
  'g0-lost-dispatch': item({
    gate: 'G0',
    question: 'Is this what we actually want built?',
    waitingOn: { role: 'analyst', since: NOW - 5 * HOUR, artifact: ref('spec.md'), lost: true },
  }),
  escalated: item({
    kind: 'escalation',
    escalationIndex: 0,
    escalation: {
      role: 'verifier',
      about: null,
      artifact: ref('verification-report.md'),
      reason: 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo',
      pointer: false,
    },
  }),
  'escalated-pointer': item({
    kind: 'escalation',
    escalationIndex: 0,
    packet: ['review-04.md'],
    packetRefs: [ref('review-04.md', '04-label', 3)],
    escalation: {
      role: 'reviewer',
      about: { task: '04-label' },
      artifact: ref('review-04.md'),
      reason: 'reviewer escalated task 04-label — see review-04.md',
      pointer: true,
    },
  }),
  'escalated-gate': item({
    kind: 'escalation',
    escalationIndex: 1,
    escalation: {
      role: 'orchestrator',
      about: { gate: 'G3' },
      artifact: null,
      reason: 'gate G3 is decided but does not exist in profile patch — profiles upgrade mid-run, never downgrade',
      pointer: false,
    },
  }),
  'round-cap': item({ kind: 'round-cap', roundCap: { task: '01-core', rounds: 3, cap: 3 } }),
  'paused-budget': item({
    kind: 'paused',
    pausedReason: 'budget-exhausted',
    costLimitUsd: 10,
    packet: ['state.yaml'],
    packetRefs: [ref('state.yaml')],
    paused: { freeText: false, cause: null, reason: 'budget-exhausted', budget: { spent: 10.4, limit: 10 }, handEdit: null },
  }),
  'paused-dispute': item({
    kind: 'paused',
    pausedReason: 'escalation',
    paused: { freeText: false, cause: null, reason: 'escalation', budget: { spent: 3, limit: 25 }, handEdit: { kind: 'contract-dispute', artifact: ref('plan.md') } },
  }),
  'paused-no-tasks': item({
    kind: 'paused',
    pausedReason: 'escalation',
    paused: { freeText: false, cause: null, reason: 'escalation', budget: null, handEdit: { kind: 'no-task-files' } },
  }),
  'paused-status': item({
    kind: 'paused',
    pausedReason: 'escalation',
    paused: {
      freeText: false,
      cause: null,
      reason: 'escalation',
      budget: null,
      handEdit: { kind: 'unknown-status', task: '01-core', status: 'wedged', known: ['pending', 'in-review', 'done'] },
    },
  }),
  'paused-landed': item({ kind: 'paused', pausedReason: 'slug-landed', paused: { freeText: false, cause: null, reason: 'slug-landed', budget: null, handEdit: null } }),
  staged: item({
    kind: 'staged',
    packet: ['state.yaml', 'intent-brief.md'],
    packetRefs: [ref('state.yaml'), ref('intent-brief.md')],
    staged: { by: 'Fixture Operator', at: NOW - 2 * HOUR, profile: 'standard', budgetCeiling: 25 },
  }),
  'escalated-d23': item({
    kind: 'escalation',
    escalationIndex: 2,
    escalation: { role: 'orchestrator', about: { task: '01-core' }, artifact: null, reason: "task 01-core: architect amendment landed for the re-plan disposition — acknowledge to proceed (see plan.md's dated ADR)", pointer: false },
  }),
  'paused-projected': item({
    kind: 'paused',
    pausedReason: 'budget-exhausted',
    costLimitUsd: 40,
    paused: { freeText: false, cause: 'projected spend $44.09 (ledger $36.09 + estimates) exceeds cost_limit_usd $40 — pausing rather than degrading', reason: 'budget-exhausted', budget: { spent: 36.09, limit: 40 }, handEdit: null },
  }),
  'paused-hold': item({
    kind: 'paused',
    pausedReason: 'waiting on the security review before G2',
    paused: { freeText: true, cause: null, reason: 'waiting on the security review before G2', budget: { spent: 3, limit: 25 }, handEdit: null },
  }),
  'bad-state': item({
    kind: 'malformed',
    reviewable: false,
    problems: [PARSE_ERROR],
    unreadable: { kind: 'parser', diagnostic: PARSE_ERROR, ledger: ref('state.yaml') },
    packet: ['state.yaml'],
    packetRefs: [ref('state.yaml')],
  }),
}

function render(node: ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, node)))
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;])/g, '$1')
    .trim()

/**
 * The markup with every Address removed, and the record's own words: the
 * parser's Diagnostic (SEAM §10 keeps it byte for byte, caret and all), and a
 * reason line quoted verbatim — Substance (§4), where a filename is the
 * record's word and not a label. What is left is every other voice on the
 * surface, and none of it may name a file.
 */
function outsideAddresses(html: string): string {
  return html
    .replace(/<(span|a)\b[^>]*\bdata-address\b[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<div\b[^>]*\bdata-diagnostic\b[^>]*>[\s\S]*?<\/pre><\/div>/g, ' ')
    .replace(/<p\b[^>]*\bdata-record-words\b[^>]*>[\s\S]*?<\/p>/g, ' ')
    .replace(/<div\b[^>]*\bdata-(?:escalation-reason|paused-cause|paused-hold)\b[^>]*>[\s\S]*?<\/div><\/div>/g, ' ')
}

const FILENAME = /\S\.(?:md|ya?ml|json)\b|runs\//

function row(entry: InboxItem): { title: string; line: string | null; html: string } {
  const line = inboxLine(entry, NOW)
  const titleHtml = render(createElement(Fragment, null, inboxTitle(entry)))
  const lineHtml = line === null ? '' : render(createElement(Fragment, null, line))
  return { title: text(titleHtml), line: line === null ? null : text(lineHtml), html: `${titleHtml}${lineHtml}` }
}

/** The whole row as the inbox renders it — so a stray `{item.detail}` anywhere in it fails the sentinel check. */
const inboxRow = (entry: InboxItem) => render(createElement('ul', null, createElement(InboxRow, { item: entry, now: NOW, selected: false })))

function card(entry: InboxItem): string {
  const refs: ArtifactRef[] = entry.packetRefs
  const detail = {
    summary: { source: 'local', slug: entry.slug, profile: 'full', tasks: { roundCap: 3 } },
    items: [entry],
    state: null,
    stateError: null,
    stateRaw: null,
    validations: {},
    artifacts: refs.map((r) => r.path),
    artifactRefs: refs,
    history: [],
    branchUrl: null,
    now: NOW,
  } as unknown as RunDetailResponse
  return render(createElement(NeedsYouCard, { item: entry, now: NOW, detail }))
}

const cardTitle = (html: string) => text(/<h2[^>]*data-card-title[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? '')

describe('inbox row lines, composed from facts (#433)', () => {
  it('a gate row is the gate and its question, with no second line when nothing is wrong', () => {
    expect(row(ITEMS['g2-pending']!)).toMatchObject({ title: 'G2 — Does the evidence support merging?', line: null })
    expect(row(ITEMS['malformed-release']!).title).toBe('G3 — Ship it?')
  })

  it('a lost dispatch says who was re-dispatched, how long ago, and what has not landed', () => {
    expect(row(ITEMS['g0-lost-dispatch']!).line).toBe('The analyst was re-dispatched 5h ago and has not landed the spec')
  })

  it('an escalation row names who escalated and about what — as Names, with no pointer and no filename', () => {
    // The verifier's own words are the substance: the row carries them, as main did.
    expect(row(ITEMS.escalated!)).toMatchObject({
      title: 'Escalation from verifier',
      line: 'AC2.1 unverifiable: sample input referenced by the spec does not exist in the repo',
    })
    const pointer = row(ITEMS['escalated-pointer']!)
    expect(pointer).toMatchObject({ title: 'Escalation from reviewer', line: 'about task 04-label' })
    expect(pointer.html).toMatch(/data-name[^>]*>reviewer</)
    expect(pointer.html).toMatch(/data-name[^>]*>04-label</)
    expect(pointer.html).not.toContain('review-04.md')
    // A gate named in a line is the line's; the gate-only case is D21, whose line is substance.
    expect(row(item({ kind: 'escalation', escalation: { role: 'reviewer', about: { gate: 'G2' }, artifact: null, reason: 'x', pointer: true } })).line).toBe(
      'about gate G2',
    )
  })

  it('an engine line that mentions a file is still the engine’s substance, and the row keeps it (D23)', () => {
    const d23 = row(ITEMS['escalated-d23']!)
    expect(d23.title).toBe('Escalation from orchestrator')
    expect(d23.line).toContain('acknowledge to proceed')
    expect(inboxRow(ITEMS['escalated-d23']!)).toMatch(/<p[^>]*data-record-words[^>]*>task 01-core: architect amendment/)
  })

  it('a round-cap row names the task and counts the rounds against the cap', () => {
    expect(row(ITEMS['round-cap']!)).toMatchObject({ title: 'Round cap reached on 01-core', line: 'review rounds 3/3 without convergence' })
  })

  it('a paused row is a UI word and the reason as the record spells it, quoted; a budget pause says what it spent', () => {
    const paused = row(ITEMS['paused-budget']!)
    expect(paused.title).toBe('Run paused budget-exhausted')
    expect(paused.html).toContain('data-quoted-word="budget-exhausted"')
    expect(paused.line).toBe('$10.40 spent · limit $10.00')
    expect(row(ITEMS['paused-landed']!)).toMatchObject({ title: 'Run paused slug-landed', line: null })
    expect(row(item({ kind: 'paused', paused: { freeText: false, cause: null, reason: null, budget: null, handEdit: null } })).title).toBe('Run paused, no reason recorded')
  })

  it('a human’s hold reason is a passage on the line, never a token chip in the title', () => {
    const hold = row(ITEMS['paused-hold']!)
    expect(hold).toMatchObject({ title: 'Run paused', line: 'waiting on the security review before G2' })
    expect(hold.html).not.toContain('data-quoted-word')
  })

  it('a staged row names who staged it, the profile, and the ceiling arming spends against', () => {
    expect(row(ITEMS.staged!)).toMatchObject({
      title: 'Run staged, awaiting arm',
      line: 'standard profile · budget ceiling $25.00 · staged by Fixture Operator',
    })
  })

  it('a malformed row is its title alone — the diagnostic is the card’s, where it keeps its caret', () => {
    expect(row(ITEMS['bad-state']!)).toMatchObject({ title: 'Malformed run state', line: null })
  })

  for (const [name, entry] of Object.entries(ITEMS)) {
    it(`${name}: the rendered row has no filename or run path outside an Address or the record's words, and none of the kept sentences`, () => {
      const html = inboxRow(entry)
      expect(html).toContain('data-inbox-title')
      expect(text(outsideAddresses(html))).not.toMatch(FILENAME)
      expect(html).not.toContain('KEPT-')
    })
  }
})

describe('decide card lines, composed from facts (#433)', () => {
  const markup = Object.fromEntries(Object.entries(ITEMS).map(([k, entry]) => [k, card(entry)]))

  it('the card heading is the row’s title at the card’s scale', () => {
    expect(cardTitle(markup['g2-pending']!)).toBe('G2 — Does the evidence support merging?')
    expect(cardTitle(markup.escalated!)).toBe('Escalation from verifier')
    expect(cardTitle(markup['paused-budget']!)).toBe('Run paused budget-exhausted')
    expect(cardTitle(markup.staged!)).toBe('Run staged, awaiting arm')
  })

  it('a bounce names the contract by kind, the file as its address, and the missing sections as Names', () => {
    const html = markup['malformed-release']!
    const line = /<p[^>]*data-bounce="release-plan.md"[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!
    expect(text(line)).toBe('Fails its release plan contract release-plan.md — missing required sections: Rollback plan, CI health')
    expect(line).toMatch(/data-address[^>]*>release-plan.md</)
    expect(line).toMatch(/data-name[^>]*>Rollback plan</)
    expect(text(markup['patch-g1-bounced']!)).toContain('The intent brief is missing from the run intent-brief.md')
  })

  it('a lost dispatch says so, then the cockpit says what to do', () => {
    const html = markup['g0-lost-dispatch']!
    expect(text(html)).toContain('The analyst was re-dispatched 5h ago and has not landed the spec.')
    expect(html).toContain(LOST_DISPATCH_INSTRUCTION)
  })

  it('an escalation whose reason is the substance quotes it; one that only points at the report does not', () => {
    const reason = /data-escalation-reason[^>]*>([\s\S]*?)<\/div><\/div>/.exec(markup.escalated!)?.[1] ?? ''
    expect(reason).toContain('Reason, as recorded')
    expect(text(reason)).toContain('unverifiable: sample input referenced by the spec does not exist in the repo')
    expect(markup['escalated-pointer']).not.toContain('data-escalation-reason')
    expect(text(markup['escalated-pointer']!)).toContain('About task 04-label')
    expect(text(markup['escalated-gate']!)).toContain('About gate G3')
    expect(markup['escalated-gate']).toMatch(/data-escalation-about[\s\S]*data-name[^>]*>G3</)
    expect(text(markup['escalated-gate']!)).toContain('does not exist in profile patch')
    // D23: the engine's instruction is on the card.
    expect(text(markup['escalated-d23']!)).toContain('acknowledge to proceed')
    expect(text(markup['escalated-d23']!)).toContain('About task 01-core')
  })

  it('a budget pause names the key the resume form writes as an Address, and says to raise it', () => {
    const html = markup['paused-budget']!
    expect(text(/data-paused-budget[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('$10.40 spent · limit $10.00, set by cost_limit_usd')
    expect(html).toMatch(/data-address[^>]*>cost_limit_usd</)
    expect(html).toContain(PAUSED_INSTRUCTIONS.budget)
  })

  it('a budget pause quotes the engine’s own line, which says the spend is projected', () => {
    const html = markup['paused-projected']!
    const cause = /data-paused-cause[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html)?.[1] ?? ''
    expect(cause).toContain('The engine’s reason, as recorded')
    expect(text(cause)).toContain('projected spend $44.09 (ledger $36.09 + estimates) exceeds cost_limit_usd $40')
    expect(text(/data-paused-budget[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('$36.09 spent · limit $40.00, set by cost_limit_usd')
  })

  it('a hold reason is quoted as a passage, and the instruction is the generic one', () => {
    const html = markup['paused-hold']!
    expect(cardTitle(html)).toBe('Run paused')
    expect(text(/data-paused-hold[^>]*>([\s\S]*?)<\/div><\/div>/.exec(html)![1]!)).toContain('waiting on the security review before G2')
    expect(html).not.toContain('data-quoted-word="waiting')
    expect(html).toContain(PAUSED_INSTRUCTIONS.generic)
  })

  it('a pause owed a hand edit names what the edit is on, and gives that edit’s instruction', () => {
    expect(markup['paused-dispute']).toMatch(/data-hand-edit="contract-dispute"[\s\S]*data-address[^>]*>plan.md</)
    expect(markup['paused-dispute']).toContain(HAND_EDIT_INSTRUCTIONS['contract-dispute'])
    expect(markup['paused-no-tasks']).toMatch(/data-address[^>]*>tasks\/\*\.yaml</)
    expect(markup['paused-status']).toContain('data-quoted-word="wedged"')
    expect(markup['paused-landed']).toContain(PAUSED_INSTRUCTIONS.landed)
  })

  it('a staged card states its terms — the profile as its Name, the ceiling as recorded — then says what arming does', () => {
    const html = markup.staged!
    expect(text(/data-staged-by[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!)).toBe('Staged by Fixture Operator 2h ago')
    const terms = /data-staged(?:="true")?>([\s\S]*?)<\/p>/.exec(html)![1]!
    expect(text(terms)).toBe('Profile standard · budget ceiling $25.00, set by cost_limit_usd')
    // The profile is an identifier (SEAM §4), the face the inbox row gives it; the ceiling is a figure, never a meter.
    expect(terms).toMatch(/data-name[^>]*>standard</)
    expect(terms).toMatch(/tabular-nums[^>]*data-budget-ceiling="25"[^>]*>\$25\.00</)
    expect(terms).toMatch(/data-address[^>]*>cost_limit_usd</)
    // The brief's passages load with the packet query; until then the card holds their place.
    expect(html).toContain('data-packet-pending')
    expect(html).toContain(ARM_INSTRUCTION)
    expect(text(html)).not.toContain('Rounds without convergence')
  })

  it('a malformed card shows the parser’s diagnostic under its producer', () => {
    expect(markup['bad-state']).toContain('data-diagnostic')
    expect(text(markup['bad-state']!)).toContain('Run state parser')
  })

  for (const [name, html] of Object.entries(markup)) {
    it(`${name}: no filename or run path outside an Address, and none of the kept sentences`, () => {
      expect(text(outsideAddresses(html))).not.toMatch(FILENAME)
      expect(html).not.toContain('KEPT-')
    })
  }
})

describe('pausedInstruction, the web constant per reason (#433)', () => {
  const paused = (over: Partial<NonNullable<InboxItem['paused']>>) => ({ reason: null, freeText: false, cause: null, budget: null, handEdit: null, ...over })

  it('asks for a higher limit, or for a limit where the run has none', () => {
    expect(pausedInstruction(paused({ reason: 'budget-exhausted', budget: { spent: 11, limit: 10 } }))).toBe(PAUSED_INSTRUCTIONS.budget)
    expect(pausedInstruction(paused({ reason: 'budget-exhausted', budget: { spent: 11, limit: null } }))).toBe(PAUSED_INSTRUCTIONS.budgetNoLimit)
  })

  it('closes a landed slug, names a hand edit, and otherwise offers resume or close', () => {
    expect(pausedInstruction(paused({ reason: 'slug-landed' }))).toBe(PAUSED_INSTRUCTIONS.landed)
    expect(pausedInstruction(paused({ reason: 'escalation', handEdit: { kind: 'no-task-files' } }))).toBe(HAND_EDIT_INSTRUCTIONS['no-task-files'])
    expect(pausedInstruction(paused({ reason: 'escalation' }))).toBe(PAUSED_INSTRUCTIONS.generic)
    expect(pausedInstruction(paused({ reason: 'round-cap' }))).toBe(PAUSED_INSTRUCTIONS.generic)
  })

  it('never tells the human to decline a gate, and never carries a path (#200, #433)', () => {
    for (const s of [...Object.values(PAUSED_INSTRUCTIONS), ...Object.values(HAND_EDIT_INSTRUCTIONS)]) {
      expect(s.toLowerCase()).not.toContain('decline')
      expect(s).not.toMatch(FILENAME)
    }
    for (const s of [PAUSED_INSTRUCTIONS.budget, PAUSED_INSTRUCTIONS.budgetNoLimit, PAUSED_INSTRUCTIONS.landed, PAUSED_INSTRUCTIONS.generic])
      expect(s.toLowerCase()).toContain('close')
  })
})

/**
 * Old server, new web (#433 review): during `self-update` a Gatehouse built
 * with the facts can be served by a server built before them. Its items carry
 * `title` and `detail` and no facts at all — absent, not null — and for the
 * one release the sentences are kept (#411 step 8) the views print those
 * rather than claiming "no reason recorded".
 */
describe('an item from a server that predates the facts (#433)', () => {
  const legacy = (over: Partial<InboxItem>): InboxItem => {
    const base = item(over) as Record<string, unknown>
    for (const k of ['question', 'waitingOn', 'superseded', 'bouncedBy', 'escalation', 'paused', 'staged', 'roundCap']) delete base[k]
    return base as unknown as InboxItem
  }

  it('a paused row and card print the kept title and detail, not a false "no reason recorded"', () => {
    const old = legacy({ kind: 'paused', title: 'Run paused: budget-exhausted', detail: 'Spend reached cost_limit_usd $10.' })
    expect(row(old)).toMatchObject({ title: 'Run paused: budget-exhausted', line: 'Spend reached cost_limit_usd $10.' })
    const html = card(old)
    expect(cardTitle(html)).toBe('Run paused: budget-exhausted')
    expect(html).toContain('data-kept-sentences')
    expect(text(html)).not.toContain('no reason recorded')
  })

  it('an escalation and a gate fall back the same way', () => {
    expect(row(legacy({ kind: 'escalation', title: 'Escalation from reviewer', detail: 'the reason' }))).toMatchObject({
      title: 'Escalation from reviewer',
      line: 'the reason',
    })
    expect(row(legacy({ gate: 'G2', title: 'G2 — Does the evidence support merging?', detail: 'a-run is waiting on G2' })).title).toBe(
      'G2 — Does the evidence support merging?',
    )
  })
})
