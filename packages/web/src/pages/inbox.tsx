// The default screen: everything that needs a human, everywhere, oldest first.

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, formatAge, type InboxItem } from '../api.ts'
import { expandedOf, type InboxEntry, type InboxStop, inboxEntries, inboxStops, isExpanded, toggleExpanded } from '../collapse.ts'
import { AgeBadge, KeyHints, KindChip } from '../components/chips.tsx'
import { RunName, shownName, useDocumentTitle } from '../components/repository.tsx'
import { GroupHeadingContent, GroupToggle, inScope, ScopeHeading, ScopeLine, UnknownScopeNotice, useScope } from '../components/scope.tsx'
import { UnreadableRepositoriesNotice } from '../components/unreadable-repositories.tsx'
import { Count, isName, Name, QuotedWord } from '../components/vocabulary.tsx'
import { gateCardState } from '../gate-state.ts'
import { usd } from '../money.ts'
import { runPath } from '../run-path.ts'
import { groupRows, scopeTitle } from '../scope.ts'
import { type KeyHint, useKeys } from '../use-keys.ts'

const STALE_SECONDS = 3 * 86_400 // aging turns urgent at 3 days
const STALE_DAYS = 7 * 86_400 // aging turns stale at 7 days

/** The reading queue's own loop, advertised under the queue (#284). Written
 *  beside the handlers below so the two cannot drift; `enter` is spelled the
 *  way a keyboard is labelled rather than the way `KeyboardEvent` spells it. */
const INBOX_HINTS: KeyHint[] = [
  ['j', 'down'],
  ['k', 'up'],
  ['enter', 'open'],
]

type KindFilterKey = InboxItem['kind'] | null

export function itemHref(item: InboxItem): string {
  const params = new URLSearchParams()
  if (item.kind === 'gate' && item.gate) params.set('decide', item.gate)
  else if (item.kind === 'escalation' && item.escalationIndex !== null) params.set('decide', `esc-${item.escalationIndex}`)
  else if (item.kind === 'paused') params.set('decide', 'paused')
  else if (item.kind === 'staged') params.set('decide', 'staged')
  const q = params.toString()
  return runPath(item.source, item.slug, q)
}

/**
 * A Name inside a line set larger than the code face's own sizes: the row's
 * title, the card's heading. `0.9em` keeps it in proportion with the words
 * around it; the class is the surface's type scale, which is what
 * `className` on a vocabulary component is for.
 */
export const IN_LINE_NAME = 'text-[0.9em]!'

/** A record id as a Name when it can be one; anything else (a path) is not a label and is left out. */
export function NameOrNothing({ id, className }: { id: string | null | undefined; className?: string }) {
  return id && isName(id) ? <Name className={className}>{id}</Name> : null
}

/**
 * Whether this item came from a server built before the facts (#433). The
 * wire type makes them optional for exactly this: during `self-update` a new
 * Gatehouse can be served by an old server, whose items carry only `title`
 * and `detail`. An absent fact is `undefined` — core sends `null` for "none"
 * — and such an item renders the kept sentences as it did before, for the
 * one release they are kept (#411 step 8). Delete with `title` and `detail`.
 */
export function predatesFacts(item: InboxItem): boolean {
  switch (item.kind) {
    case 'gate':
      return item.question === undefined || item.bouncedBy === undefined
    case 'escalation':
      return item.escalation === undefined
    case 'round-cap':
      return item.roundCap === undefined
    case 'paused':
      return item.paused === undefined
    case 'staged':
      return item.staged === undefined
    case 'malformed':
      return item.question === undefined
  }
}

/** What an escalation is about, in the row's and the card's words: a task or a gate, both Names. */
export function aboutWords(about: { task: string } | { gate: string }, lead: string): ReactNode {
  if ('task' in about)
    return isName(about.task) ? (
      <>
        {lead} task <Name>{about.task}</Name>
      </>
    ) : null
  return (
    <>
      {lead} gate <Name>{about.gate}</Name>
    </>
  )
}

/**
 * The row's title, composed here from the item's facts (#433). Core used to
 * send a sentence — `Escalation from reviewer`, `Run paused: budget-exhausted`
 * — that the row, the card and the terminal all reused; each now says its own
 * line. A gate id, a role, a task and a profile are the record's Names; a
 * pause reason is its Quoted word, after a UI word — unless it is a human's
 * free-text hold reason, which is a passage and goes on the line below.
 */
export function inboxTitle(item: InboxItem): ReactNode {
  if (predatesFacts(item)) return item.title
  switch (item.kind) {
    case 'gate':
      return (
        <>
          <Name className={IN_LINE_NAME}>{item.gate ?? ''}</Name> — {item.question}
        </>
      )
    case 'escalation': {
      const role = item.escalation?.role ?? null
      return role && isName(role) ? (
        <>
          Escalation from <Name className={IN_LINE_NAME}>{role}</Name>
        </>
      ) : (
        'Escalation'
      )
    }
    case 'round-cap':
      return item.roundCap ? (
        <>
          Round cap reached on <NameOrNothing id={item.roundCap.task} className={IN_LINE_NAME} />
        </>
      ) : (
        'Round cap reached'
      )
    case 'paused':
      return item.paused?.reason && !item.paused.freeText ? (
        <>
          Run paused <QuotedWord className="align-[0.15em]">{item.paused.reason}</QuotedWord>
        </>
      ) : item.paused?.reason ? (
        'Run paused'
      ) : (
        'Run paused, no reason recorded'
      )
    case 'staged':
      return 'Run staged, awaiting arm'
    case 'malformed':
      return 'Malformed run state'
  }
}

/**
 * The record's own words when they are the row's second line: an escalation's
 * reason that is its substance, a human's hold reason. Verbatim, and the row
 * marks the line so a reader of the markup knows it is the record speaking
 * (docs/SEAM.md §4, Substance) — a filename inside it is the record's word,
 * not a label. Returned as a plain string so the line holds a text node and
 * no element: a clipped inline child still measures its full width, which
 * the geometry sweep reads as text painting into the time column (#280).
 */
export function inboxRecordWords(item: InboxItem): string | null {
  if (predatesFacts(item)) return null
  if (item.kind === 'escalation' && item.escalation && !item.escalation.pointer) return item.escalation.reason
  if (item.kind === 'paused' && item.paused?.freeText && item.paused.reason) return item.paused.reason
  return null
}

/**
 * The row's second line, from the facts (#433), or null when the title has
 * said it all. What a queue reader needs to triage without opening the run:
 * what an escalation says (or, when its line only points at a report, what it
 * is about), how far a round cap went, what a budget pause spent, who staged
 * a run and on what terms. Bounce and supersession keep their own lines
 * below, which say why no approval is offered.
 */
export function inboxLine(item: InboxItem, now: number): ReactNode {
  if (predatesFacts(item)) return item.detail || null
  switch (item.kind) {
    case 'gate': {
      const waiting = item.waitingOn
      if (!waiting?.lost || !isName(waiting.role)) return null
      return (
        <>
          The <Name>{waiting.role}</Name> was re-dispatched {formatAge(waiting.since, now)} ago and has not landed the{' '}
          {waiting.artifact.contractName ?? 'artifact'}
        </>
      )
    }
    case 'escalation': {
      const esc = item.escalation
      if (!esc) return null
      // The issue dropped the pointer, never the substance: an engine's line
      // is the whole packet, and it is what tells one failure from the next.
      if (!esc.pointer) return esc.reason
      return esc.about ? aboutWords(esc.about, 'about') : null
    }
    case 'round-cap':
      return item.roundCap ? (
        <>
          <Count n={item.roundCap.rounds} of={item.roundCap.cap} one="review round" many="review rounds" /> without convergence
        </>
      ) : null
    case 'paused': {
      const paused = item.paused
      if (paused?.freeText && paused.reason) return paused.reason
      const budget = paused?.budget
      if (paused?.reason !== 'budget-exhausted' || !budget) return null
      // Two counts and no causal claim: the engine pauses on *projected*
      // spend, and the card quotes its own line saying so.
      return (
        <>
          {budget.spent !== null && <>{usd(budget.spent)} spent · </>}
          {budget.limit === null ? 'no limit' : `limit ${usd(budget.limit)}`}
        </>
      )
    }
    case 'staged': {
      const staged = item.staged
      if (!staged) return null
      // The one element leads, and the rest is text: a truncating line whose
      // Name sat mid-line would be clipped past the cell at 800px (#280).
      return (
        <>
          <Name>{staged.profile}</Name> profile · {staged.budgetCeiling === null ? 'no budget ceiling' : `budget ceiling ${usd(staged.budgetCeiling)}`}
          {staged.by ? ` · staged by ${staged.by}` : ''}
        </>
      )
    }
    case 'malformed':
      return null
  }
}

/**
 * The row's columns: the kind impression, the text cell, the time column.
 * `minmax(0, 1fr)` is what lets the text cell shrink below its content so
 * truncation engages rather than painting across the column beside it
 * (#280). The coloured rail that used to lead the row is gone with the
 * redesign: kind is the impression's own word, and a row on a ledger is
 * separated by its rule, not by a stripe.
 */
const INBOX_COLUMNS = '150px minmax(0, 1fr) 96px'

export function InboxRow({
  item,
  now,
  selected,
  showRepository,
  announceRepository = false,
}: {
  item: InboxItem
  now: number
  selected: boolean
  /**
   * Whether the row names the run's repository: false when the set has one,
   * when the page is scoped to one (docs/MULTI-REPO.md §6.2), and under a
   * group heading, which names it for every row below it (#498).
   */
  showRepository: boolean
  /** Under a group heading: the name leaves the screen but stays for a screen reader, whose list of links carries no headings. */
  announceRepository?: boolean
}) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  const stale = item.since !== null && now - item.since > STALE_DAYS
  const gateState = gateCardState(item)
  const isBouncedGate = gateState === 'bounced'
  const isInflightGate = gateState === 'inflight'
  const line = inboxLine(item, now)
  const recordWords = inboxRecordWords(item) !== null
  return (
    <li className="border-b border-line">
      <Link
        to={itemHref(item)}
        className={`grid items-start hover:bg-inset ${selected ? 'bg-accent-tint' : ''}`}
        style={{ gridTemplateColumns: INBOX_COLUMNS }}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <span className="flex items-start pt-[13px]">
          <KindChip item={item} />
        </span>
        <span className="flex min-w-0 flex-col gap-[3px] py-[11px] pr-[14px]" data-inbox-text>
          {/* Title and run name follow one overflow rule (#280): each
              truncates inside the cell. The run name is `billing /
              add-export` (#497): the repository before the slug, in the
              slug's own secondary style, and the slug alone when the set has
              one repository. */}
          <span className="flex flex-wrap items-baseline gap-[10px]">
            <span className="truncate text-[15px] font-semibold text-ink" data-inbox-title>
              {inboxTitle(item)}
            </span>
            <RunName
              className="min-w-0 truncate font-mono text-[12.5px] text-muted"
              source={item.source}
              sourceName={item.sourceName}
              slug={item.slug}
              showRepository={showRepository}
              announceRepository={announceRepository}
              clipped
            />
          </span>
          {line && (
            <p className="max-w-[var(--measure)] truncate text-[13.5px] text-muted" data-inbox-line data-record-words={recordWords || undefined}>
              {line}
            </p>
          )}
          {isBouncedGate && (
            <p className="mt-1 text-[13px] text-ink">
              <b className="font-semibold">Bounced</b> — packet fails its contract; no approval is offered.
            </p>
          )}
          {isInflightGate && item.inflight && (
            <p data-inbox-inflight className="mt-1 text-[13px] text-muted">
              <b className="font-semibold text-ink">Superseded</b> — the {item.inflight.role} is in flight; no approval is
              offered until the new packet lands.
            </p>
          )}
        </span>
        {/* A plain right-aligned time column, no full-height divider: a rule
            turned any tight fit into something that read as broken (#280). */}
        <span className="flex items-start justify-end pt-[14px]" data-inbox-age>
          <AgeBadge label={age} urgent={urgent} stale={stale} />
        </span>
      </Link>
    </li>
  )
}

/**
 * One repository's unreadable runs, shown as one row (#499; docs/MULTI-REPO.md
 * §9.3, decision P10, provisional). The row is a disclosure: a button whose
 * `aria-expanded` says whether the rows it stands for are shown, and the rows
 * themselves, ordinary inbox rows, revealed beneath it in place. Its state is
 * the page's `?expand=` parameter, so an open row can be linked and survives
 * a reload.
 *
 * The row says what it is in the cockpit's voice, composed here from core's
 * facts (docs/SEAM.md §2): how many runs, in which repository, and — so the
 * arithmetic of the page stays visible — how many of the page's entries it
 * stands for: every count on the page, the kind filters, the footer and the
 * rail, counts each of them. Its sentence wraps rather than truncates, so the
 * count and the repository survive a phone's width. It takes the place, the kind mark and the age
 * of the oldest run it stands for.
 *
 * A screen reader hears the button as "24 runs in website have unreadable
 * state. Stands for 24 of the 41 entries. Show them,
 * collapsed", and the revealed rows as a list named for them.
 */
export function CollapsedRow({
  entry,
  now,
  open,
  selected,
  showRepository,
  onToggle,
  renderRow,
  of,
}: {
  entry: Extract<InboxEntry, { kind: 'collapsed' }>
  now: number
  open: boolean
  selected: boolean
  /** As on an item row: false under a one-repository scope and under a group heading, which name the repository already. */
  showRepository: boolean
  onToggle: () => void
  renderRow: (item: InboxItem) => ReactNode
  /** The entries the page lists, which the row states it is part of. */
  of: number
}) {
  const oldest = entry.items[0]!
  const count = entry.items.length
  const age = formatAge(oldest.since, now)
  const urgent = oldest.since !== null && now - oldest.since > STALE_SECONDS
  const stale = oldest.since !== null && now - oldest.since > STALE_DAYS
  const name = shownName(entry.source, entry.sourceName)
  const listId = `collapsed-${entry.source.replace(/[^A-Za-z0-9_-]/g, '-')}`
  return (
    <li className={open ? '' : 'border-b border-line'} data-inbox-collapsed={entry.source} data-collapsed-count={count}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={onToggle}
        className={`grid w-full items-start text-left hover:bg-inset ${open ? 'border-b border-line' : ''} ${selected ? 'bg-accent-tint' : ''}`}
        style={{ gridTemplateColumns: INBOX_COLUMNS }}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <span className="flex items-start pt-[13px]">
          <KindChip item={oldest} />
        </span>
        <span className="flex min-w-0 flex-col gap-[3px] py-[11px] pr-[14px]" data-inbox-text>
          <span className="text-[15px] font-semibold break-words text-ink" data-inbox-title data-collapsed-title>
            {count} runs{' '}
            {showRepository ? (
              <>
                in{' '}
                <span className="inline-block max-w-[20ch] truncate align-bottom font-normal text-muted" title={entry.source} data-repository-name>
                  {name}
                </span>{' '}
              </>
            ) : (
              <span className="sr-only">in {name} </span>
            )}
            have unreadable state
          </span>
          <span className="text-[13.5px] text-muted" data-collapsed-line>
            Stands for {count} of the {of} entries.{' '}
            <span className="text-accent underline underline-offset-2" data-collapsed-toggle>
              {open ? 'Hide them' : 'Show them'}
            </span>
          </span>
        </span>
        <span className="flex items-start justify-end pt-[14px]" data-inbox-age>
          <AgeBadge label={age} urgent={urgent} stale={stale} />
        </span>
      </button>
      {open && (
        <ul id={listId} aria-label={`${count} runs in ${name} with unreadable state`} data-collapsed-rows={entry.source}>
          {entry.items.map(renderRow)}
          {/* The disclosure ends where its rows do, and says so: the rows are
              ordinary rows, and without this nothing marks where they stop
              and the queue resumes. It closes the row too, for a reader who
              has scrolled past its top. */}
          <li className="border-b border-line">
            <button
              type="button"
              onClick={onToggle}
              className="grid w-full items-start py-2 text-left font-ui text-[12.5px] text-muted hover:bg-inset"
              style={{ gridTemplateColumns: INBOX_COLUMNS }}
              data-collapsed-end
            >
              <span />
              <span>
                End of the {count} runs in {name}.{' '}
                <span className="text-accent underline underline-offset-2">Hide them</span>
              </span>
            </button>
          </li>
        </ul>
      )}
    </li>
  )
}

interface KindFilter {
  label: string
  kind: KindFilterKey
  count: number
}

export function InboxPage() {
  const { data, isLoading: inboxLoading, error } = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  // The rows wait for the set, its names and the scope too (#498), so a row
  // never gains or loses its repository after it first paints.
  const scope = useScope()
  const isLoading = inboxLoading || !scope.ready
  useDocumentTitle(scopeTitle('Inbox', scope.scope))
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [cursor, setCursor] = useState(0)
  const [filter, setFilter] = useState<KindFilterKey>(null)
  const expanded = useMemo(() => expandedOf(params), [params])
  const toggle = useCallback((source: string) => setParams(toggleExpanded(params, source)), [params, setParams])
  // The scope narrows the rows before anything else reads them: the kind
  // filters count what is in scope, and the cursor walks it.
  const scoped = useMemo(() => (data ? inScope(data.items, scope.scope) : undefined), [data, scope.scope])
  const filteredItems = useMemo(() => {
    if (!scoped) return null
    if (!filter) return scoped
    return scoped.filter((it) => it.kind === filter)
  }, [scoped, filter])
  // Grouped, each repository's rows keep the queue's order, oldest first,
  // and the cursor walks the rows in the order they are drawn.
  const groups = useMemo(
    () => (filteredItems && scope.grouped ? groupRows(filteredItems, scope.set) : null),
    [filteredItems, scope.grouped, scope.set],
  )
  // One repository's unreadable runs show as one row (#499, §9.3): which
  // repositories collapse is core's rule, sent as `collapsed`; the entries
  // place each row where its oldest run sat, within each group when grouped.
  // Every count on the page is taken from the items above, never from these.
  const collapsed = data?.collapsed
  const groupEntries = useMemo(() => (groups ? groups.map((g) => inboxEntries(g.rows, collapsed)) : null), [groups, collapsed])
  const entries = useMemo(() => (filteredItems ? inboxEntries(filteredItems, collapsed) : []), [filteredItems, collapsed])
  // Where the keyboard cursor can stop, in the order rows are drawn: a
  // collapsed row is one stop, and an open one is followed by its rows.
  const stops = useMemo(
    () => (groupEntries ? groupEntries.flatMap((e) => inboxStops(e, expanded)) : inboxStops(entries, expanded)),
    [groupEntries, entries, expanded],
  )
  const keyHandlers = useMemo(
    () => ({
      j: () => setCursor((c) => Math.min(stops.length - 1, c + 1)),
      k: () => setCursor((c) => Math.max(0, c - 1)),
      Enter: () => {
        const stop = stops[cursor]
        if (stop?.kind === 'item') void navigate(itemHref(stop.item))
        else if (stop?.kind === 'collapsed') toggle(stop.source)
      },
    }),
    [stops, cursor, navigate, toggle],
  )
  useKeys(keyHandlers, stops.length > 0)
  const selectedStop: InboxStop | undefined = stops[cursor]

  // Build filter tab counts from the scope's rows, before the kind filter
  const filters: KindFilter[] = useMemo(() => {
    if (!scoped) return []
    const kinds: KindFilterKey[] = [null, 'gate', 'escalation', 'round-cap', 'paused', 'staged', 'malformed']
    return kinds.map((k) => ({
      label: k === null ? 'All' : k,
      kind: k,
      count: k === null ? scoped.length : scoped.filter((it) => it.kind === k).length,
    }))
  }, [scoped])

  if (isLoading)
    return (
      <div className="mx-auto max-w-[1080px]">
        <div className="border-t border-ink">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid items-stretch border-b border-line" style={{ gridTemplateColumns: INBOX_COLUMNS }}>
              <span className="flex items-center py-[13px]">
                <span className="skel h-[21px] w-16" />
              </span>
              <span className="flex min-w-0 flex-col gap-[8px] py-[13px]">
                <span className="skel h-3.5 w-2/3" />
                <span className="skel h-3.5 w-1/2" />
              </span>
              <span className="flex items-center justify-end py-[13px]">
                <span className="skel h-4 w-9" />
              </span>
            </div>
          ))}
        </div>
        <PageStatus text="Reading repositories…" />
      </div>
    )
  if (error) return <PageStatus text={`Could not load the inbox: ${(error as Error).message}`} bad />
  const now = data!.now
  const one = scope.scope.kind === 'one'
  // A row names its repository only on a joined, ungrouped page over several:
  // under a scope the page heading names it once, and under a group heading
  // the heading does (docs/MULTI-REPO.md §9.2, D7).
  const showRepository = scope.several && !one && !scope.grouped
  const unreadableInView = (data!.unreadable ?? []).some((u) => scope.scope.kind !== 'one' || u.source.toLowerCase() === scope.scope.repository.id.toLowerCase())
  const row = (item: InboxItem, i: number) => (
    <InboxRow
      key={`${item.source}/${item.slug}/${item.kind}/${item.gate ?? item.escalationIndex ?? i}`}
      item={item}
      now={now}
      selected={selectedStop?.kind === 'item' && selectedStop.item === item}
      showRepository={showRepository}
      announceRepository={scope.grouped}
    />
  )
  // `of` is the entries the row is counted among: the page's, or its group's.
  const entry = (of: number) => (e: InboxEntry, i: number) =>
    e.kind === 'item' ? (
      row(e.item, i)
    ) : (
      <CollapsedRow
        key={`collapsed/${e.source}`}
        entry={e}
        now={now}
        open={isExpanded(expanded, e.source)}
        selected={selectedStop?.kind === 'collapsed' && selectedStop.source === e.source}
        showRepository={showRepository}
        onToggle={() => toggle(e.source)}
        renderRow={(item) => row(item, 0)}
        of={of}
      />
    )

  return (
    <div className="mx-auto max-w-[1080px]">
      <ScopeHeading scope={scope.scope} />
      <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Inbox</h1>
      <p className="mt-1 text-[13px] text-muted">
        {one ? 'Pending human decisions in this repository, oldest first.' : 'Pending human decisions across every run, oldest first.'}
      </p>
      <ScopeLine scope={scope.scope} outside={scope.scoped === null ? null : scope.total - scope.scoped} path="/" />
      <UnknownScopeNotice scope={scope.scope} />
      <UnreadableRepositoriesNotice unreadable={data!.unreadable} scope={scope.scope} rows="decisions" />

      {/* Kind filters: plain type, the active one underlined. Wraps at narrow
          widths; the gaps carry it (#280). The grouping toggle ends the line,
          in the same type, because it too rearranges the list below rather
          than going anywhere. */}
      <div className="mt-[22px] flex flex-wrap items-center gap-x-[18px] gap-y-2 font-ui text-[12.5px] font-medium" data-inbox-filters>
        {filters.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`pb-[3px] ${filter === f.kind ? 'text-ink shadow-[inset_0_-1.5px_0_var(--color-ink)]' : 'text-muted hover:text-ink'}`}
            onClick={() => {
              setFilter(f.kind)
              setCursor(0)
            }}
          >
            {f.label} <span className="tabular-nums">{f.count}</span>
          </button>
        ))}
        <span className="ml-auto">
          <GroupToggle state={scope} />
        </span>
      </div>

      {filteredItems!.length === 0 ? (
        <div className="mt-[14px] border-t border-ink px-2 py-16 text-center">
          <span className="gate-sigil mb-3 block" aria-hidden="true">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="36" height="36">
              <rect x="3.5" y="3" width="2.6" height="18" fill="currentColor" />
              <rect x="17.9" y="3" width="2.6" height="18" fill="currentColor" />
              <rect x="3.5" y="8.6" width="17" height="2.2" fill="currentColor" />
            </svg>
          </span>
          <h2 className="text-[20px] font-semibold text-ink">
            {/* With a repository that could not be read in view, "nothing is
                waiting" is not known; the heading says only what is. */}
            {unreadableInView
              ? one
                ? 'This repository could not be read.'
                : 'Nothing is waiting on you in the repositories that could be read.'
              : one
                ? 'Nothing is waiting on you in this repository.'
                : 'Nothing is waiting on you.'}
          </h2>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] text-muted">
            The agents are reading, writing and reviewing on their own. Open the portfolio to look in on a run.
          </p>
        </div>
      ) : (
        <>
          {groups ? (
            // Grouped (#498): one section per repository of the set, in the
            // order every page and the CLI list them, each opening on the ink
            // rule a section opens on, under a heading that names the
            // repository, its id and its count. A repository with nothing
            // here keeps its heading, and its count says so.
            <div className="mt-[14px] border-t border-ink" data-inbox-groups>
              <div className="grid text-[11.5px] text-muted" style={{ gridTemplateColumns: INBOX_COLUMNS }} aria-hidden="true">
                <span className="py-1.5">kind</span>
                <span className="py-1.5">entry</span>
                <span className="py-1.5 text-right">waiting</span>
              </div>
              {groups.map((g, gi) => (
                <section key={g.repository.id} className="border-t border-ink" aria-label={g.repository.name} data-inbox-group={g.repository.id}>
                  <h2 className="py-2.5">
                    <GroupHeadingContent group={g} counts={<Count n={g.rows.length} one="entry" many="entries" />} />
                  </h2>
                  {g.rows.length > 0 && <ul className="border-t border-line">{groupEntries![gi]!.map(entry(g.rows.length))}</ul>}
                </section>
              ))}
            </div>
          ) : (
            <ul className="mt-[14px] border-t border-ink">
              <li className="grid text-[11.5px] text-muted" style={{ gridTemplateColumns: INBOX_COLUMNS }} aria-hidden="true">
                <span className="py-1.5">kind</span>
                <span className="py-1.5">entry</span>
                <span className="py-1.5 text-right">waiting</span>
              </li>
              {entries.map(entry(filteredItems!.length))}
            </ul>
          )}
          <div className="flex items-baseline justify-between pt-2 text-[12px] text-muted">
            <span className="tabular-nums">
              {filteredItems!.length} {filteredItems!.length === 1 ? 'entry' : 'entries'}
            </span>
            {/* Under the queue, not over it: the row cursor is visible before
                the hint explains what moves it. */}
            <KeyHints hints={INBOX_HINTS} />
          </div>
        </>
      )}
    </div>
  )
}

export function PageStatus({ text, bad }: { text: string; bad?: boolean }) {
  return <p className={`py-16 text-center text-[13px] ${bad ? 'text-bad' : 'text-muted'}`}>{text}</p>
}
