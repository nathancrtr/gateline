// The default screen: everything that needs a human, everywhere, oldest first.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { api, formatAge, type InboxItem } from '../api.ts'
import { AgeBadge, KindChip } from '../components/chips.tsx'
import { useKeys } from '../use-keys.ts'

const STALE_SECONDS = 3 * 86_400 // aging turns urgent at 3 days

export function itemHref(item: InboxItem): string {
  const params = new URLSearchParams()
  if (item.kind === 'gate' && item.gate) params.set('decide', item.gate)
  else if (item.kind === 'escalation' && item.escalationIndex !== null) params.set('decide', `esc-${item.escalationIndex}`)
  else if (item.kind === 'paused') params.set('decide', 'paused')
  else if (item.kind === 'staged') params.set('decide', 'staged')
  const q = params.toString()
  return `/runs/${item.source}/${item.slug}${q ? `?${q}` : ''}`
}

function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  return (
    <li className="border-b border-line last:border-b-0">
      <Link
        to={itemHref(item)}
        className={`group flex items-center gap-3 border-l-[3px] px-3.5 py-3 transition-colors hover:bg-raised ${
          selected ? 'border-l-accent bg-accent-soft' : 'border-l-transparent'
        }`}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <KindChip item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`truncate text-[13.5px] font-medium ${selected ? 'text-accent' : ''}`}>{item.title}</span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{item.source}/{item.slug}</span>
          </div>
          <p className="mt-0.5 max-w-[78ch] truncate text-xs text-muted">{item.detail}</p>
          {!item.reviewable && item.kind === 'gate' && (
            <p className="mt-1 text-xs font-semibold text-bad">Bounced — packet fails its contract; no approval offered.</p>
          )}
        </div>
        <AgeBadge label={age} urgent={urgent} />
      </Link>
    </li>
  )
}

export function InboxPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['inbox'], queryFn: api.inbox })
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(0)
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

  if (isLoading)
    return (
      <div className="mx-auto max-w-3xl">
        <ul className="overflow-hidden rounded-[5px] border border-line bg-surface">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
              <span className="skel h-[22px] w-11 shrink-0 rounded-full" />
              <span className="skel h-3.5 flex-1" />
              <span className="skel h-4 w-9 shrink-0" />
            </li>
          ))}
        </ul>
        <PageStatus text="Reading repositories…" />
      </div>
    )
  if (error) return <PageStatus text={`Could not load the inbox: ${(error as Error).message}`} bad />
  const now = data!.now

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-[22px] flex items-end gap-4 border-b border-line pb-3.5">
        <h1 className="font-mono text-xl leading-none font-semibold uppercase tracking-[0.14em]">Inbox</h1>
        <span className="ml-auto text-right text-xs text-muted">
          {items!.length === 0 ? 'nothing waiting' : `${items!.length} waiting · oldest first`}
          <span className="ml-2.5 hidden font-mono text-[11px] text-faint md:inline">j/k move · ↵ open</span>
        </span>
      </header>
      {items!.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <span className="mb-3 block font-mono text-lg tracking-[0.2em] text-accent">— ·· —</span>
          <p className="text-[15px] font-semibold">Inbox zero.</p>
          <p className="mt-1.5 text-xs text-muted">No gates ready, no escalations, no paused runs. The pipeline is either working or done.</p>
        </div>
      ) : (
        <ul className="overflow-hidden rounded-[5px] border border-line bg-surface">
          {items!.map((item, i) => (
            <InboxRow
              key={`${item.source}/${item.slug}/${item.kind}/${item.gate ?? item.escalationIndex ?? i}`}
              item={item}
              now={now}
              selected={i === cursor}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

export function PageStatus({ text, bad }: { text: string; bad?: boolean }) {
  return <p className={`py-16 text-center text-[13px] ${bad ? 'text-bad' : 'text-muted'}`}>{text}</p>
}
