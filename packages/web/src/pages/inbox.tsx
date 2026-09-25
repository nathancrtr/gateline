// The default screen: everything that needs a human, everywhere, oldest first.

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatAge, type InboxItem } from '../api.ts'
import { AgeBadge, KeyHints, KindChip } from '../components/chips.tsx'
import { FixtureLabel, isFixtureSource } from '../components/fixture-label.tsx'
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

/**
 * The row's columns: the kind impression, the text cell, the time column.
 * `minmax(0, 1fr)` is what lets the text cell shrink below its content so
 * truncation engages rather than painting across the column beside it
 * (#280). The coloured rail that used to lead the row is gone with the
 * redesign: kind is the impression's own word, and a row on a ledger is
 * separated by its rule, not by a stripe.
 */
const INBOX_COLUMNS = '150px minmax(0, 1fr) 96px'

function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  const stale = item.since !== null && now - item.since > STALE_DAYS
  const gateState = gateCardState(item)
  const isBouncedGate = gateState === 'bounced'
  const isInflightGate = gateState === 'inflight'
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
            <span className="truncate text-[15px] font-semibold text-ink">{item.title}</span>
            <span className="min-w-0 truncate font-mono text-[12.5px] text-muted">
              {item.source}/{item.slug}
            </span>
            {isFixtureSource(item.source) && <FixtureLabel />}
          </span>
          <p className="max-w-[var(--measure)] truncate text-[13.5px] text-muted">{item.detail}</p>
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
      <div className="mt-[22px] flex flex-wrap items-center gap-x-[18px] gap-y-2 font-mono text-[12.5px] font-medium" data-inbox-filters>
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
