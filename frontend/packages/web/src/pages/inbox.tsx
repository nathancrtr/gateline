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
  const q = params.toString()
  return `/runs/${item.source}/${item.slug}${q ? `?${q}` : ''}`
}

function InboxRow({ item, now, selected }: { item: InboxItem; now: number; selected: boolean }) {
  const age = formatAge(item.since, now)
  const urgent = item.since !== null && now - item.since > STALE_SECONDS
  return (
    <li>
      <Link
        to={itemHref(item)}
        className={`group flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 transition-colors hover:border-accent/40 ${
          selected ? 'border-accent ring-1 ring-accent' : 'border-line'
        }`}
        data-inbox-row
        aria-current={selected ? 'true' : undefined}
      >
        <KindChip item={item} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium group-hover:text-accent">{item.title}</span>
            <span className="shrink-0 font-mono text-xs text-faint">{item.source}/{item.slug}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{item.detail}</p>
          {!item.reviewable && item.kind === 'gate' && (
            <p className="mt-1 text-xs font-medium text-bad">Bounced — packet fails its contract; no approval offered.</p>
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

  if (isLoading) return <PageStatus text="Reading repositories…" />
  if (error) return <PageStatus text={`Could not load the inbox: ${(error as Error).message}`} bad />
  const now = data!.now

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-5 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
        <span className="text-xs text-muted">
          {items!.length === 0 ? 'nothing waiting' : `${items!.length} waiting · oldest first`}
          <span className="ml-3 hidden font-mono text-[11px] text-faint md:inline">j/k move · ↵ open</span>
        </span>
      </header>
      {items!.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
          <p className="text-sm font-medium">Inbox zero.</p>
          <p className="mt-1 text-xs text-muted">No gates ready, no escalations, no paused runs. The pipeline is either working or done.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
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
  return <p className={`py-16 text-center text-sm ${bad ? 'text-bad' : 'text-muted'}`}>{text}</p>
}
