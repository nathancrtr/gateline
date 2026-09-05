// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
//
// Since the seeded redesign (docs/GATEHOUSE-DESIGN.md) every status is an
// *impression*: a name plus its code in one ink, told apart by texture —
// filled for a decision taken, hollow for pending, struck for declined,
// hatched for bounced, dotted for a state not reached or a run at rest, and
// dashed in the red for the position a run stands at. There is no hue per
// phase and no ok/warn/bad tint: the seed's ledger leaves one ink on the
// page, and the word carries the difference.
import { Fragment, useEffect, useRef } from 'react'
import { PROFILE_GATES, type ClosureRecord, type GateId, type InboxItem, type Profile, type RunSummary } from '../api.ts'
import { gateCardState } from '../gate-state.ts'
import { gateNote, noteRung, phaseSpine, type GateCell, type PhaseCell, type SpineNoteRung } from '../spine.ts'
import type { KeyHint } from '../use-keys.ts'

/**
 * The keyboard loop, said out loud (#284).
 *
 * Quiet by construction: mono, 10.5px, muted verbs — the register of the
 * rack's "The repo is the database.", deliberately below every other line on
 * the surface it sits on. The keys themselves are `<kbd>` in a hairline box,
 * the one place the component spends contrast.
 *
 * Callers decide *when* — most importantly `decide.tsx`, which shows its hints
 * only while the card is idle, since inside a form `a` and `1` are characters.
 */
export function KeyHints({ hints, className = '' }: { hints: readonly KeyHint[]; className?: string }) {
  if (hints.length === 0) return null
  return (
    <p data-key-hints className={`font-mono text-[10.5px] leading-[1.7] text-muted ${className}`}>
      {hints.map(([key, verb], i) => (
        <Fragment key={key}>
          {i > 0 && (
            <span aria-hidden="true" className="px-[5px] opacity-60">
              ·
            </span>
          )}
          <kbd className="border border-line px-[4px] py-px font-mono text-[10px] text-muted">{key}</kbd> {verb}
        </Fragment>
      ))}
    </p>
  )
}

/** The impression itself. `tone` is a texture, never a hue. */
export function Imp({
  children,
  tone = '',
  className = '',
  title,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: '' | 'fill' | 'dot' | 'struck' | 'hatch' | 'cur' | 'mark' | 'stamped' | 'fill stamped' }) {
  const tones = tone
    .split(' ')
    .filter(Boolean)
    .map((t) => `imp-${t}`)
    .join(' ')
  return (
    <span {...rest} title={title} className={`imp ${tones} ${className}`}>
      {children}
    </span>
  )
}

export function PhaseChip({
  phase,
  pausedReason,
  closure,
}: {
  phase: string
  pausedReason?: string | null
  /** The closure record when phase is `closed` — the chip reads as its disposition (#200). */
  closure?: ClosureRecord | null
}) {
  // A closed run is labelled by its disposition, not by the word "closed": the
  // phase exists precisely so the record says why.
  if (phase === 'closed') {
    return (
      <Imp data-phase-chip tone="struck">
        closed · {closure?.as ?? 'no disposition'}
      </Imp>
    )
  }
  // Rest states — staged, paused — are dotted: the run is standing, not moving.
  if (phase === 'paused' && pausedReason === 'staged') {
    return (
      <Imp data-phase-chip tone="dot">
        staged
      </Imp>
    )
  }
  if (phase === 'paused') {
    return (
      <Imp data-phase-chip tone="dot">
        paused{pausedReason ? ` · ${pausedReason}` : ''}
      </Imp>
    )
  }
  if (phase === 'done') {
    return (
      <Imp data-phase-chip tone="fill">
        done
      </Imp>
    )
  }
  // A phase the vocabulary does not know is a fact about the record, not a
  // position: hatched, in the red, like a bounced packet.
  if (phase === 'unknown') {
    return (
      <Imp data-phase-chip tone="hatch" className="text-warn">
        unknown
      </Imp>
    )
  }
  // A phase in flight is the plain mark. The red dashed "position" tone is
  // reserved for the spine, where the sequence gives it something to be the
  // position *in*; a column of them in the portfolio was a column of alarms.
  return <Imp data-phase-chip>{phase}</Imp>
}

export function KindChip({ item }: { item: InboxItem }) {
  if (item.kind === 'gate') {
    // A bounced packet is hatched: on the table, offering no decision (R3).
    // An in-flight one is dotted — at rest, waiting on a machine — and not a
    // fault (#159); the reviewable one is the plain mark.
    const state = gateCardState(item)
    return (
      <Imp tone={state === 'bounced' ? 'hatch' : state === 'inflight' ? 'dot' : ''}>
        {item.gate} · gate
      </Imp>
    )
  }
  if (item.kind === 'staged') {
    return <Imp tone="dot">staged</Imp>
  }
  const glyph = { escalation: '⚑', 'round-cap': '⟲', paused: '', malformed: '⚠' }[item.kind] ?? ''
  return (
    <Imp tone={item.kind === 'malformed' ? 'hatch' : ''}>
      {glyph ? `${glyph} ` : ''}
      {item.kind}
    </Imp>
  )
}

/** The clock glyph is a mark, not a letter, so it takes a word space rather
 *  than the letter-spacing 2px gave it (#285/7). The ≥3-day threshold it
 *  appears at is unchanged. */
const AGE_GLYPH = 'mr-[4px]'

export function AgeBadge({ label, urgent, stale }: { label: string; urgent: boolean; stale?: boolean }) {
  if (stale) {
    return (
      <span className="shrink-0 font-mono text-[12.5px] font-semibold leading-none tabular-nums text-warn" title="waiting since">
        <span className={AGE_GLYPH}>⏱</span>
        {label}
      </span>
    )
  }
  return (
    <span className={`shrink-0 font-mono text-[12.5px] leading-none tabular-nums ${urgent ? 'font-semibold text-ink' : 'text-muted'}`} title="waiting since">
      {urgent && <span className={AGE_GLYPH}>⏱</span>}
      {label}
    </span>
  )
}

const GATE_GLYPH = { approved: '✓', declined: '✕', pending: '·' } as const

/** One gate cell of the G0–G3 ledger strip. */
export function GateCell({ id, cell }: { id: GateId; cell: RunSummary['gates'][GateId] }) {
  const state = cell.approved ? 'approved' : cell.decided ? 'declined' : 'pending'
  const tone = state === 'approved' ? 'fill' : state === 'declined' ? 'struck' : ''
  const title = cell.decided ? `${id} ${cell.approved ? 'approved' : 'declined'} by ${cell.by}${cell.at ? ` · ${cell.at}` : ''}` : `${id} pending`
  return (
    <Imp tone={tone} title={title}>
      {id} {GATE_GLYPH[state]}
    </Imp>
  )
}

export function GateLedger({ gates, profile = 'full' }: { gates: RunSummary['gates']; profile?: Profile }) {
  return (
    <span className="inline-flex gap-[4px]">
      {PROFILE_GATES[profile].map((g) => (
        <GateCell key={g} id={g} cell={gates[g]} />
      ))}
    </span>
  )
}

/**
 * The run header's phase spine (#254) — the profile's phases left to right with
 * its gates as the transitions between them. `spine.ts` decides the shape; this
 * decides how each cell reads.
 *
 * It never wraps (#295): connectors compress to their 8px minimum; below
 * `noteRung` the notes are demoted to the cell's tooltip and the gaps close;
 * past that it crops and scrolls with the gate on the table in view.
 */
export function PhaseSpine({ summary, items }: { summary: RunSummary; items?: InboxItem[] }) {
  const spine = phaseSpine(summary)
  const rung = noteRung(spine)
  // A gate whose packet was bounced is on the table but offers no approval
  // (core's readiness rule R3); the cell must not tell the reader otherwise.
  const bounced = new Set(
    (items ?? []).filter((i) => i.kind === 'gate' && !i.reviewable && i.gate !== null).map((i) => i.gate as GateId),
  )
  const pending = spine.cells.find((c) => c.kind === 'gate' && c.state === 'pending')
  const focus = pending?.kind === 'gate' ? pending.gate : (spine.position ?? null)
  const ref = useScrollIntoView(focus)
  return (
    <div className="@container w-full">
      <ol
        ref={ref}
        data-spine
        data-rest={spine.rest ?? undefined}
        data-spine-rung={rung}
        className={`flex w-full items-start overflow-x-auto overscroll-x-contain ${NOTE_RUNG_ROW[rung]}`}
      >
        {spine.cells.map((cell, i) => (
          <Fragment key={cell.kind === 'phase' ? `p-${cell.phase}` : `g-${cell.gate}`}>
            {i > 0 && <li aria-hidden="true" className="mt-[11px] h-px min-w-[8px] max-w-[72px] flex-1 bg-line" />}
            {cell.kind === 'phase' ? (
              <SpinePhase cell={cell} atRest={spine.rest !== null} noteClass={NOTE_RUNG_NOTE[rung]} />
            ) : (
              <SpineGate cell={cell} bounced={bounced.has(cell.gate)} noteClass={NOTE_RUNG_NOTE[rung]} />
            )}
          </Fragment>
        ))}
      </ol>
    </div>
  )
}

/**
 * Keeps the cell the run is standing at inside the crop when the spine has to
 * scroll. Scrolling the row itself rather than calling `scrollIntoView` — that
 * would take the page with it, and the reader did not ask to be moved.
 */
function useScrollIntoView(focus: string | null) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const row = ref.current
    if (!row || focus === null) return
    const center = () => {
      if (row.scrollWidth <= row.clientWidth) return
      const target =
        row.querySelector<HTMLElement>('[data-spine-gate][data-state="pending"]') ??
        row.querySelector<HTMLElement>('[data-spine-phase][data-state="current"]')
      if (!target) return
      const box = target.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      row.scrollLeft += box.left - rowBox.left - (row.clientWidth - box.width) / 2
    }
    center()
    if (typeof ResizeObserver === 'undefined') return
    let last = row.clientWidth
    const observer = new ResizeObserver(() => {
      if (row.clientWidth === last) return
      last = row.clientWidth
      center()
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [focus])
  return ref
}

// One rung, two effects, both needing the literal width in the stylesheet:
// above it the notes are in the open and the row is gapped as #254 drew it;
// below it the notes go to the tooltip and the gap closes. Written out rather
// than composed, because Tailwind only emits classes it can see whole.
const NOTE_RUNG_NOTE: Record<SpineNoteRung, string> = {
  500: 'hidden @min-[500px]:block',
  580: 'hidden @min-[580px]:block',
  660: 'hidden @min-[660px]:block',
  740: 'hidden @min-[740px]:block',
  820: 'hidden @min-[820px]:block',
  900: 'hidden @min-[900px]:block',
  980: 'hidden @min-[980px]:block',
}

const NOTE_RUNG_ROW: Record<SpineNoteRung, string> = {
  500: 'gap-x-0 @min-[500px]:gap-x-1.5',
  580: 'gap-x-0 @min-[580px]:gap-x-1.5',
  660: 'gap-x-0 @min-[660px]:gap-x-1.5',
  740: 'gap-x-0 @min-[740px]:gap-x-1.5',
  820: 'gap-x-0 @min-[820px]:gap-x-1.5',
  900: 'gap-x-0 @min-[900px]:gap-x-1.5',
  980: 'gap-x-0 @min-[980px]:gap-x-1.5',
}

function SpinePhase({ cell, atRest, noteClass }: { cell: PhaseCell; atRest: boolean; noteClass: string }) {
  // At rest the run still stands somewhere; the cell goes dotted to say it is
  // standing there rather than moving through, and the phase chip beside the
  // spine names the reason.
  const tone = cell.state === 'current' ? (atRest ? 'dot' : 'cur') : cell.state === 'future' ? 'dot' : ''
  return (
    <li data-spine-phase={cell.phase} data-state={cell.state} className="flex shrink-0 flex-col items-center gap-[4px]">
      <Imp tone={tone}>{cell.phase}</Imp>
      {/* The gutter the gate notes sit in. It goes with them, so a spine with
          no notes in the open is not 24px of empty header. */}
      <span aria-hidden="true" className={`h-[24px] ${noteClass}`} />
    </li>
  )
}

const GATE_STATE_TONE: Record<GateCell['state'], 'fill' | 'struck' | 'cur' | 'dot'> = {
  approved: 'fill',
  declined: 'struck',
  pending: 'cur',
  future: 'dot',
}

const GATE_STATE_GLYPH: Record<GateCell['state'], string> = { approved: '✓', declined: '✕', pending: '●', future: '·' }
const GATE_STATE_WORD: Record<GateCell['state'], string> = {
  approved: 'approved',
  declined: 'declined',
  pending: 'pending your decision',
  future: 'not yet reached',
}

/**
 * A bounced gate is up but offers no decision: the packet is present and fails
 * its contract, so core hands the reader a bounce view rather than an approval
 * (readiness rule R3). "Pending your decision" is the one thing the cell must
 * not say there, since the card below it is already saying the opposite.
 */
const GATE_BOUNCED_WORD = 'on the table — packet bounced'

/** One gate, as the transition it is. Its question is what `G2` alone cannot
 *  say, so it is the accessible name and the hover text — never inferred,
 *  always the fixed GATE_QUESTIONS string for the profile it is asked in. */
function SpineGate({ cell, bounced, noteClass }: { cell: GateCell; bounced: boolean; noteClass: string }) {
  const decided = cell.by !== null || cell.at !== null
  const provenance = decided ? `${cell.by ?? '—'}${cell.at ? ` · ${String(cell.at).slice(0, 10)}` : ''}` : null
  const note = gateNote(cell)
  const word = bounced && cell.state === 'pending' ? GATE_BOUNCED_WORD : GATE_STATE_WORD[cell.state]
  const label = `${cell.gate} — ${cell.question} — ${word}${provenance ? ` by ${provenance}` : ''}`
  const tone = bounced && cell.state === 'pending' ? 'hatch' : GATE_STATE_TONE[cell.state]
  return (
    <li data-spine-gate={cell.gate} data-state={cell.state} className="flex shrink-0 flex-col items-center gap-[4px]">
      <Imp tone={tone} title={label}>
        <span aria-hidden="true">
          {cell.gate} {GATE_STATE_GLYPH[cell.state]}
        </span>
        <span className="sr-only">{label}</span>
      </Imp>
      <span
        aria-hidden="true"
        className={`h-[24px] whitespace-nowrap text-center font-mono text-[10.5px] leading-[12px] text-muted ${noteClass}`}
      >
        {note?.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {line}
          </Fragment>
        ))}
      </span>
    </li>
  )
}

export function ValidationBadge({ ok, missing }: { ok: boolean; missing?: string[] }) {
  if (ok) return <span className="font-mono text-[11px] text-ink" title="contract sections present">✓</span>
  return (
    <span className="font-mono text-[11px] font-semibold text-warn" title={`missing: ${(missing ?? []).join(', ')}`}>
      ✕
    </span>
  )
}

export function BudgetMeter({ limit, spent }: { limit: number | null; spent: number | null }) {
  if (limit === null) return <span className="text-xs italic text-muted">no budget</span>
  const used = spent ?? 0
  const over = used > limit
  const pct = Math.min(100, (used / limit) * 100)
  // Nothing spent, so there is nothing to meter: the word alone (#285/5).
  if (used === 0) {
    return (
      <span className="font-mono text-[11.5px] tabular-nums text-muted" title={`$0.00 of $${limit.toFixed(2)}`}>
        unmetered
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-end gap-[3px]" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-[7px] w-[90px] overflow-hidden border border-line">
        <span className={`block h-full ${over ? 'bg-mark' : 'bg-ink'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`font-mono text-[11.5px] tabular-nums ${over ? 'font-semibold text-warn' : 'text-muted'}`}>
        ${used.toFixed(0)} / ${limit.toFixed(0)}
        {over ? ' · over' : ''}
      </span>
    </span>
  )
}
