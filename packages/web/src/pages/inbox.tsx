// The default screen: everything that needs a human, everywhere, oldest first.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatAge, type InboxItem } from '../api.ts'
import { AgeBadge, KeyHints, KindChip } from '../components/chips.tsx'
import { useKeys, type KeyHint } from '../use-keys.ts'

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

function railClassFor(item: InboxItem): string {
  if (item.kind === 'gate' && !item.reviewable) return 'bg-bad'
  if (item.kind === 'gate') return 'bg-accent'
  if (item.kind === 'staged') return 'border-l-2 border-dashed border-[#c9bfa9]'
  if (item.kind === 'paused') return 'bg-warn'
  if (item.kind === 'escalation') return 'bg-info'
  if (item.kind === 'round-cap') return 'bg-[#946014]'
  if (item.kind === 'malformed') return 'bg-bad'
  return 'bg-faint'
}

function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  const stale = item.since !== null && now - item.since > STALE_DAYS
  const rail = railClassFor(item)
  const isBouncedGate = item.kind === 'gate' && !item.reviewable
  const isReviewableGate = item.kind === 'gate' && item.reviewable
  // Bounced rail gets the repeating hashed pattern (Candidate A signature)
  const railStyle = isBouncedGate
    ? { backgroundImage: `repeating-linear-gradient(180deg, var(--color-bad) 0 4px, transparent 4px 8px)` }
    : undefined
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        to={itemHref(item)}
        className={`grid items-stretch transition-colors hover:bg-[#fbf9f4] ${
          selected ? 'bg-accent-tint' : 'bg-surface'
        }`}
        style={{ gridTemplateColumns: '4px 132px 1fr 92px 120px' }}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <span
          className={`w-[4px] self-stretch ${rail}`}
          style={railStyle}
          aria-hidden="true"
        />
        <span className="flex flex-col items-center justify-center pt-5">
          <KindChip item={item} />
        </span>
        <span className="flex min-w-0 flex-col gap-[6px] px-[22px] py-[18px]">
          <span className="flex flex-wrap items-baseline gap-[10px]">
            {isReviewableGate && (
              <span
                className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-accent align-middle"
                aria-hidden="true"
              />
            )}
            <span className="truncate text-[16px] font-semibold tracking-[-0.005em] text-ink">
              {item.title}
            </span>
            <span className="shrink-0 font-mono text-[12.5px] text-muted">
              {item.source}/{item.slug}
            </span>
          </span>
          <p className="max-w-[78ch] truncate text-[14.5px] text-muted">
            {item.detail}
          </p>
          {isBouncedGate && (
            <p className="mt-1 rounded-sm border border-bad-line bg-bad-bg px-[10px] py-[7px] text-[13px] text-bad">
              <b className="font-semibold">Bounced</b> — packet fails its
              contract; no approval is offered.
            </p>
          )}
        </span>
        <span className="flex items-center justify-end border-l border-line pr-[22px]">
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
        <div className="rounded-lg border border-line bg-surface overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-stretch border-t border-line first:border-t-0"
        style={{ gridTemplateColumns: '4px 132px 1fr 120px' }}
            >
              <span className="skel w-[4px]" />
              <span className="flex items-center justify-center p-5">
                <span className="skel h-[22px] w-11" />
              </span>
              <span className="flex flex-col gap-[10px] px-[22px] py-[18px]">
                <span className="skel h-3.5 w-2/3" />
                <span className="skel h-3.5 w-1/2" />
              </span>
              <span className="border-l border-line" />
              <span className="flex items-center justify-end border-l border-line pr-[22px]">
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
      <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-accent-deep mb-[10px]">
        Pending human decisions · oldest first
      </div>
      <div className="flex items-baseline gap-[18px] flex-wrap">
        <h1 className="font-sans text-[54px] font-semibold leading-[1.04] tracking-[-0.02em] text-ink">
          Inbox
        </h1>
        <span className="font-sans text-[54px] font-medium leading-none text-accent tabular-nums tracking-[-0.02em]">
          {items!.length}
          <sup className="ml-2 font-sans text-[13px] font-medium text-muted align-super tracking-[0.02em]">
            waiting
          </sup>
        </span>
      </div>
      <p className="mt-[14px] max-w-[62ch] text-[15.5px] leading-[1.6] text-[#4d4742]">
        A reading-queue across every run on the agent pipeline. Scan for what
        needs you; open the run to read the artifact and decide. Nothing here
        expires, and nothing is racing.
      </p>

      {/* Kind filter tabs — Sentry-style grouping */}
      <div className="flex gap-[6px] mt-[30px] flex-wrap items-center">
        {filters.map((f, idx) => (
          <span key={f.label}>
            {idx > 0 && idx !== 1 && (
              <span className="inline-block w-px h-[18px] bg-line mx-[6px] align-middle" />
            )}
            <button
              className={`text-[13px] font-medium px-3 py-[7px] rounded-full border transition-colors ${
                filter === f.kind
                  ? 'bg-surface border-line-cool text-ink shadow-[var(--shadow-soft)]'
                  : 'bg-transparent border-transparent text-[#4d4742] hover:bg-raised'
              }`}
              onClick={() => {
                setFilter(f.kind)
                setCursor(0)
              }}
            >
              {f.label === 'All' ? 'All' : f.label}
              <span className="font-mono text-[11px] text-muted ml-[6px]">
                {f.count}
              </span>
            </button>
          </span>
        ))}
      </div>

      {filteredItems!.length === 0 ? (
        <div className="mt-6 rounded-lg border border-line bg-surface overflow-hidden">
          <div className="px-10 py-20 text-center">
            <span className="gate-sigil mb-3.5 block text-accent opacity-85" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="44" height="44">
                <rect x="3.5" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
                <rect x="17.9" y="3" width="2.6" height="18" rx="1.3" fill="currentColor" />
                <rect x="3.5" y="8.6" width="17" height="2.2" rx="1.1" fill="currentColor" />
              </svg>
            </span>
            <h2 className="font-sans text-[46px] font-semibold tracking-[-0.02em] text-ink">
              Inbox zero.
            </h2>
            <p className="mx-auto mt-2 max-w-[46ch] text-[15px] text-muted">
              Nothing is waiting on you. The agents are reading, writing, and
              reviewing on their own. Come back when a gate clears, or open the
              portfolio to look in on a run at your leisure.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-6 rounded-lg border border-line bg-surface overflow-hidden">
            {filteredItems!.map((item, i) => (
              <InboxRow
                key={`${item.source}/${item.slug}/${item.kind}/${item.gate ?? item.escalationIndex ?? i}`}
                item={item}
                now={now}
                selected={i === cursor}
              />
            ))}
          </ul>
          {/* Under the queue, not over it: the row cursor is visible before
              the hint explains what moves it, which is the order a reader
              works it out in anyway. Nothing to move through, no hint —
              `useKeys` is disabled on the same condition. */}
          <KeyHints hints={INBOX_HINTS} className="mt-2.5 text-right" />
        </>
      )}
    </div>
  )
}

export function PageStatus({ text, bad }: { text: string; bad?: boolean }) {
  return <p className={`py-16 text-center text-[13px] ${bad ? 'text-bad' : 'text-muted'}`}>{text}</p>
}
