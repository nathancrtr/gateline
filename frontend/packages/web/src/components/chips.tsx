// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
import { PROFILE_GATES, type GateId, type InboxItem, type Profile, type RunSummary } from '../api.ts'

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
  // A staged run is a rest state, not an interruption: hollow ring marker (no
  // glow — nothing is burning energy), accent tone, and its own `staged`
  // label rather than the `paused · <reason>` suffix. Every other paused
  // reason (budget, gate-declined, …) keeps the filled glowing dot below
  // unchanged (AC6.2 — form difference, not recolor).
  if (phase === 'paused' && pausedReason === 'staged') {
    return (
      <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-xs leading-none">
        <span className="inline-block h-[7px] w-[7px] rounded-full border-[1.5px] border-accent bg-transparent" />
        <span className="text-ink">staged</span>
      </span>
    )
  }
  const tone = PHASE_TONE[phase] ?? 'text-muted'
  return (
    <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-xs leading-none">
      <span className={`${tone} inline-block h-[7px] w-[7px] rounded-full bg-current shadow-[0_0_6px_currentColor]`} />
      <span className="text-ink">{phase}</span>
      {pausedReason ? <span className="text-muted">· {pausedReason}</span> : null}
    </span>
  )
}

export function KindChip({ item }: { item: InboxItem }) {
  if (item.kind === 'gate') {
    const bounced = !item.reviewable
    const tone = bounced
      ? 'border border-dashed border-bad bg-bad-soft text-bad line-through'
      : 'border border-accent bg-accent-soft text-accent'
    return (
      <span
        className={`inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full px-[9px] py-[3px] font-mono text-[11px] leading-none font-semibold tracking-[0.04em] ${tone}`}
      >
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current shadow-[0_0_6px_currentColor]" />
        {item.gate}
      </span>
    )
  }
  if (item.kind === 'staged') {
    // Outline pill, transparent fill, hollow marker — distinct in form (not
    // just color) from the solid PAUSE pill below (AC6.2).
    return (
      <span className="inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full border border-accent bg-transparent px-[11px] py-1 font-mono text-[11px] leading-none font-bold tracking-[0.04em] text-accent">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-current bg-transparent" />
        STAGED
      </span>
    )
  }
  const label = { escalation: 'ESC', 'round-cap': 'CAP', paused: 'PAUSE', malformed: 'BAD' }[item.kind]
  const tone = item.kind === 'paused' ? 'bg-warn text-on-solid' : 'bg-bad text-on-solid'
  return (
    <span
      className={`inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full border border-transparent px-[11px] py-1 font-mono text-[11px] leading-none font-bold tracking-[0.04em] ${tone}`}
    >
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  )
}

export function AgeBadge({ label, urgent }: { label: string; urgent: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-[4px] border bg-inset px-2 py-1 font-mono text-[11px] leading-none tabular-nums ${
        urgent ? 'border-bad font-bold text-bad' : 'border-line text-muted'
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
  const tone = cell.approved
    ? 'text-ok border-ok bg-ok-soft'
    : cell.decided
      ? 'text-bad border-bad bg-bad-soft'
      : 'text-faint border-line border-dashed bg-inset'
  const title = cell.decided ? `${id} ${cell.approved ? 'approved' : 'declined'} by ${cell.by}${cell.at ? ` · ${cell.at}` : ''}` : `${id} pending`
  return (
    <span
      className={`inline-flex h-[22px] w-[30px] items-center justify-center gap-0.5 rounded-[3px] border font-mono text-[11px] ${tone}`}
      title={title}
    >
      <span className="text-[8px] text-faint">{id.slice(1)}</span>
      {glyph}
    </span>
  )
}

export function GateLedger({ gates, profile = 'full' }: { gates: RunSummary['gates']; profile?: Profile }) {
  return (
    <span className="inline-flex gap-[3px]">
      {PROFILE_GATES[profile].map((g) => (
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
      <span className="h-[5px] w-16 overflow-hidden rounded-[3px] border border-line bg-inset">
        <span
          className={`block h-full ${over ? 'bg-bad' : used === 0 ? 'bg-faint' : 'bg-accent shadow-[0_0_6px_var(--glow)]'}`}
          style={{ width: `${used === 0 ? 4 : pct}%` }}
        />
      </span>
      <span className={`font-mono text-xs tabular-nums ${over ? 'font-bold text-bad' : 'text-muted'}`}>
        {used === 0 ? 'unmetered' : `$${used.toFixed(0)}/${limit.toFixed(0)}`}
      </span>
    </span>
  )
}
