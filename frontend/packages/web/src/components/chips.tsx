// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
import type { GateId, InboxItem, RunSummary } from '../api.ts'

const PHASE_TONE: Record<string, string> = {
  spec: 'text-accent',
  plan: 'text-accent',
  implement: 'text-warn',
  integrate: 'text-warn',
  release: 'text-accent',
  done: 'text-ok',
  paused: 'text-bad',
  unknown: 'text-bad',
}

export function PhaseChip({ phase, pausedReason }: { phase: string; pausedReason?: string | null }) {
  const tone = PHASE_TONE[phase] ?? 'text-muted'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium">
      <span className={`${tone} text-[9px] leading-none`}>●</span>
      <span>{phase}</span>
      {pausedReason ? <span className="text-muted">· {pausedReason}</span> : null}
    </span>
  )
}

export function KindChip({ item }: { item: InboxItem }) {
  if (item.kind === 'gate')
    return (
      <span className="inline-flex min-w-9 items-center justify-center rounded-md bg-accent-soft px-2 py-0.5 font-mono text-xs font-semibold text-accent">
        {item.gate}
      </span>
    )
  const label = { escalation: 'ESC', 'round-cap': 'CAP', paused: 'PAUSE', malformed: 'BAD' }[item.kind]
  const tone =
    item.kind === 'malformed'
      ? 'bg-bad-soft text-bad'
      : item.kind === 'paused'
        ? 'bg-warn-soft text-warn'
        : 'bg-bad-soft text-bad'
  return (
    <span className={`inline-flex min-w-9 items-center justify-center rounded-md px-2 py-0.5 font-mono text-xs font-semibold ${tone}`}>
      {label}
    </span>
  )
}

export function AgeBadge({ label, urgent }: { label: string; urgent: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs tabular-nums ${
        urgent ? 'bg-bad-soft font-semibold text-bad' : 'bg-raised text-muted'
      }`}
      title="waiting since"
    >
      {label}
    </span>
  )
}

/** One gate cell of the G0–G3 ledger strip. */
export function GateCell({ id, cell }: { id: GateId; cell: RunSummary['gates'][GateId] }) {
  const glyph = cell.approved ? '✓' : cell.decided ? '✕' : '·'
  const tone = cell.approved ? 'text-ok border-ok/30' : cell.decided ? 'text-bad border-bad/30' : 'text-faint border-line'
  const title = cell.decided ? `${id} ${cell.approved ? 'approved' : 'declined'} by ${cell.by}${cell.at ? ` · ${cell.at}` : ''}` : `${id} pending`
  return (
    <span
      className={`inline-flex h-6 w-9 items-center justify-center gap-0.5 rounded border bg-surface font-mono text-[11px] ${tone}`}
      title={title}
    >
      <span className="text-[9px] text-faint">{id.slice(1)}</span>
      {glyph}
    </span>
  )
}

export function GateLedger({ gates }: { gates: RunSummary['gates'] }) {
  return (
    <span className="inline-flex gap-1">
      {(['G0', 'G1', 'G2', 'G3'] as const).map((g) => (
        <GateCell key={g} id={g} cell={gates[g]} />
      ))}
    </span>
  )
}

export function ValidationBadge({ ok, missing }: { ok: boolean; missing?: string[] }) {
  if (ok) return <span className="font-mono text-[11px] text-ok" title="contract sections present">✓</span>
  return (
    <span className="font-mono text-[11px] font-semibold text-bad" title={`missing: ${(missing ?? []).join(', ')}`}>
      ✕
    </span>
  )
}

export function BudgetMeter({ limit, spent }: { limit: number | null; spent: number | null }) {
  if (limit === null) return <span className="text-xs text-faint">no budget</span>
  const used = spent ?? 0
  const over = used > limit
  const pct = Math.min(100, (used / limit) * 100)
  return (
    <span className="inline-flex items-center gap-2" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-raised">
        <span className={`block h-full rounded-full ${over ? 'bg-bad' : used === 0 ? 'bg-faint' : 'bg-accent'}`} style={{ width: `${used === 0 ? 4 : pct}%` }} />
      </span>
      <span className={`font-mono text-xs tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
        {used === 0 ? 'unmetered' : `$${used.toFixed(0)}/${limit.toFixed(0)}`}
      </span>
    </span>
  )
}
