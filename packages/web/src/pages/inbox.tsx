// The default screen: everything that needs a human, everywhere, oldest first.

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatAge, type InboxItem } from '../api.ts'
import { AgeBadge, KeyHints, KindChip } from '../components/chips.tsx'
import { Count, isName, Name, QuotedWord } from '../components/vocabulary.tsx'
import { gateCardState } from '../gate-state.ts'
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
  return `/runs/${item.source}/${item.slug}${q ? `?${q}` : ''}`
}

/** A dollar figure as the header's budget meter prints one: two decimals. */
export const usd = (n: number) => `$${n.toFixed(2)}`

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

export function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
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
          {/* Title and slug follow one overflow rule (#280): each truncates
              inside the cell. */}
          <span className="flex flex-wrap items-baseline gap-[10px]">
            <span className="truncate text-[15px] font-semibold text-ink" data-inbox-title>
              {inboxTitle(item)}
            </span>
            <span className="min-w-0 truncate font-mono text-[12.5px] text-muted">
              {item.source}/{item.slug}
            </span>
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

interface KindFilter {
  label: string
  kind: KindFilterKey
  count: number
}

export function InboxPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(0)
  const [filter, setFilter] = useState<KindFilterKey>(null)
  const items = data?.items
  const keyHandlers = useMemo(
    () => ({
      j: () => setCursor((c) => Math.min((items?.length ?? 1) - 1, c + 1)),
      k: () => setCursor((c) => Math.max(0, c - 1)),
      Enter: () => {
        const item = items?.[cursor]
        if (item) void navigate(itemHref(item))
      },
    }),
    [items, cursor, navigate],
  )
  useKeys(keyHandlers, Boolean(items?.length))

  const filteredItems = useMemo(() => {
    if (!items) return null
    if (!filter) return items
    return items.filter((it) => it.kind === filter)
  }, [items, filter])

  // Build filter tab counts from the unfiltered list
  const filters: KindFilter[] = useMemo(() => {
    if (!items) return []
    const kinds: KindFilterKey[] = [null, 'gate', 'escalation', 'round-cap', 'paused', 'staged', 'malformed']
    return kinds.map((k) => ({
      label: k === null ? 'All' : k,
      kind: k,
      count: k === null ? items.length : items.filter((it) => it.kind === k).length,
    }))
  }, [items])

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

  return (
    <div className="mx-auto max-w-[1080px]">
      <h1 className="text-[20px] font-semibold leading-[1.25] text-ink">Inbox</h1>
      <p className="mt-1 text-[13px] text-muted">Pending human decisions across every run, oldest first.</p>

      {/* Kind filters: plain type, the active one underlined. Wraps at narrow
          widths; the gaps carry it (#280). */}
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
          <h2 className="text-[20px] font-semibold text-ink">Nothing is waiting on you.</h2>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] text-muted">
            The agents are reading, writing and reviewing on their own. Open the portfolio to look in on a run.
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-[14px] border-t border-ink">
            <li className="grid text-[11.5px] text-muted" style={{ gridTemplateColumns: INBOX_COLUMNS }} aria-hidden="true">
              <span className="py-1.5">kind</span>
              <span className="py-1.5">entry</span>
              <span className="py-1.5 text-right">waiting</span>
            </li>
            {filteredItems!.map((item, i) => (
              <InboxRow
                key={`${item.source}/${item.slug}/${item.kind}/${item.gate ?? item.escalationIndex ?? i}`}
                item={item}
                now={now}
                selected={i === cursor}
              />
            ))}
          </ul>
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
