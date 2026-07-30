// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
import { PROFILE_GATES, type GateId, type InboxItem, type Profile, type RunSummary } from '../api.ts'

const PHASE_TONE: Record<string, { chip: string; mark: string }> = {
  spec:       { chip: 'bg-[#f3eee5] text-[#6f5a3a] border-[#e2d6bd]', mark: 'bg-current' },
  plan:       { chip: 'bg-[#eef0f5] text-[#4a5170] border-[#d6dbe8]', mark: 'bg-current' },
  implement:  { chip: 'bg-accent-tint text-accent-deep border-[#e9d3c4]', mark: 'bg-current' },
  integrate:  { chip: 'bg-info-bg text-info border-info-line', mark: 'bg-current' },
  release:    { chip: 'bg-[#efe9f5] text-[#5a3a7a] border-[#dccfea]', mark: 'bg-current' },
  done:       { chip: 'bg-ok-bg text-ok border-ok-line', mark: 'border-[1.5px] border-current bg-transparent' },
  paused:     { chip: 'bg-warn-bg text-warn border-warn-line', mark: 'border-[1.5px] border-current bg-transparent rounded-[2px]' },
  staged:     { chip: 'bg-transparent text-[#6f5a3a] border-dashed border-[#c9bfa9]', mark: 'border-[1.5px] border-current bg-transparent' },
  unknown:    { chip: 'bg-bad-bg text-bad border-bad-line', mark: 'bg-current' },
}

export function PhaseChip({ phase, pausedReason }: { phase: string; pausedReason?: string | null }) {
  // staged is a rest state — hollow ring marker, dashed chip, its own label.
  if (phase === 'paused' && pausedReason === 'staged') {
    const t = PHASE_TONE.staged!
    return (
      <span data-phase-chip className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-md border px-[10px] py-[4px] text-[12.5px] font-semibold leading-none ${t.chip}`}>
        <span className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full ${t.mark}`} />
        <span>staged</span>
      </span>
    )
  }
  const t = PHASE_TONE[phase] ?? PHASE_TONE.unknown!
  return (
    <span data-phase-chip className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-md border px-[10px] py-[4px] text-[12.5px] font-semibold leading-none ${t.chip}`}>
      <span className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full opacity-90 ${t.mark}`} />
      <span>{phase}</span>
      {pausedReason ? <span className="opacity-80">· {pausedReason}</span> : null}
    </span>
  )
}

export function KindChip({ item }: { item: InboxItem }) {
  if (item.kind === 'gate') {
    const bounced = !item.reviewable
    const tone = bounced
      ? 'border border-dashed border-bad-line bg-bad-bg text-bad line-through'
      : 'border border-[#e9d3c4] bg-accent-tint text-accent-deep'
    return (
      <span
        className={`inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full px-[9px] py-[3px] font-mono text-[11px] leading-none font-semibold tracking-[0.04em] ${tone}`}
      >
        <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-current" />
        {item.gate}
      </span>
    )
  }
  if (item.kind === 'staged') {
    // Outline pill, transparent fill, hollow marker — distinct in form (not
    // just color) from the solid pills below (AC6.2). Keep uppercase STAGED
    // as a deliberate form distinction vs Candidate A's lowercase.
    return (
      <span className="inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full border-dashed border-[#c9bfa9] bg-transparent px-[11px] py-1 font-mono text-[11px] leading-none font-bold tracking-[0.04em] text-[#6f5a3a]">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full border border-current bg-transparent" />
        STAGED
      </span>
    )
  }
  const label = { escalation: 'escalation', 'round-cap': 'round-cap', paused: 'paused', malformed: 'malformed' }[item.kind]
  const toneMap: Record<string, { chip: string; glyph: string }> = {
    escalation: { chip: 'bg-info-bg text-info border-info-line', glyph: '⚑' },
    'round-cap': { chip: 'bg-warn-bg text-warn border-warn-line', glyph: '⟲3' },
    paused:      { chip: 'bg-warn-bg text-warn border-warn-line', glyph: '' },
    malformed:   { chip: 'bg-bad-bg text-bad border-bad-line', glyph: '⚠' },
  }
  const t = toneMap[item.kind] ?? toneMap.malformed!
  return (
    <span
      className={`inline-flex min-w-9 items-center justify-center gap-1.5 rounded-full border px-[11px] py-1 font-mono text-[11px] leading-none font-bold tracking-[0.04em] ${t.chip}`}
    >
      {t.glyph ? <span className="text-[13px]">{t.glyph}</span> : null}
      {label}
    </span>
  )
}

export function AgeBadge({ label, urgent, stale }: { label: string; urgent: boolean; stale?: boolean }) {
  if (stale) {
    return (
      <span className="shrink-0 font-mono text-[13px] font-bold leading-none tabular-nums text-bad" title="waiting since">
        <span className="mr-[2px]">⏱</span>{label}
      </span>
    )
  }
  return (
    <span className={`shrink-0 font-mono text-[13px] leading-none tabular-nums ${urgent ? 'font-semibold text-warn' : 'text-muted'}`} title="waiting since">
      {urgent && <span className="mr-[2px]">⏱</span>}{label}
    </span>
  )
}

/** One gate cell of the G0–G3 ledger strip. */
export function GateCell({ id, cell }: { id: GateId; cell: RunSummary['gates'][GateId] }) {
  const glyph = cell.approved ? '✓' : cell.decided ? '✕' : '·'
  const tone = cell.approved
    ? 'bg-ok-bg text-ok border-ok-line'
    : cell.decided
      ? 'bg-bad-bg text-bad border-bad-line border-dashed line-through'
      : 'bg-pend-bg text-[#6b6259] border-pend-line border-dashed'
  const title = cell.decided ? `${id} ${cell.approved ? 'approved' : 'declined'} by ${cell.by}${cell.at ? ` · ${cell.at}` : ''}` : `${id} pending`
  return (
    <span
      className={`inline-flex h-[34px] w-[34px] flex-col items-center justify-center gap-0.5 rounded-sm border font-mono leading-none ${tone}`}
      title={title}
    >
      <span className="text-[9px] font-semibold tracking-[0.04em] opacity-80">{id}</span>
      <span className="text-[14px] font-semibold">{glyph}</span>
    </span>
  )
}

export function GateLedger({ gates, profile = 'full' }: { gates: RunSummary['gates']; profile?: Profile }) {
  return (
    <span className="inline-flex gap-[5px]">
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
  if (limit === null) return <span className="text-xs text-faint italic">no budget</span>
  const used = spent ?? 0
  const over = used > limit
  const pct = Math.min(100, (used / limit) * 100)
  return (
    <span className="inline-flex flex-col items-end gap-[3px]" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-[5px] w-[90px] overflow-hidden rounded-full border border-line bg-raised">
        <span
          className={`block h-full rounded-full ${over ? 'bg-bad' : used === 0 ? 'bg-faint' : 'bg-accent'}`}
          style={{ width: `${used === 0 ? 4 : pct}%` }}
        />
      </span>
      <span className={`font-mono text-[11.5px] tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
        {used === 0 ? 'unmetered' : `$${used.toFixed(0)} / $${limit.toFixed(0)}${over ? ' · over' : ''}`}
      </span>
    </span>
  )
}
