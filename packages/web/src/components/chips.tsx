// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
import { Fragment, useEffect, useRef } from 'react'
import { PROFILE_GATES, type ClosureRecord, type GateId, type InboxItem, type Profile, type RunSummary } from '../api.ts'
import { gateNote, noteRung, phaseSpine, type GateCell, type PhaseCell, type SpineNoteRung } from '../spine.ts'
import type { KeyHint } from '../use-keys.ts'

/**
 * The keyboard loop, said out loud (#284).
 *
 * Quiet by construction: mono, 10.5px, faint verbs — the register of the
 * sidebar's "The repo is the database.", deliberately below every other line on
 * the surface it sits on. It states keys and nothing else, so it can never grow
 * into a second voice arguing with the decision card.
 *
 * The keys themselves are `<kbd>` in a hairline box. That is the one place the
 * component spends contrast, and it earns it: without a frame `a approve · x
 * decline` reads as prose, and the reader has to work out which words are the
 * keystrokes.
 *
 * Callers decide *when* — most importantly `decide.tsx`, which shows its hints
 * only while the card is idle, since inside a form `a` and `1` are characters.
 */
export function KeyHints({ hints, className = '' }: { hints: readonly KeyHint[]; className?: string }) {
  if (hints.length === 0) return null
  return (
    <p data-key-hints className={`font-mono text-[10.5px] leading-[1.7] text-faint ${className}`}>
      {hints.map(([key, verb], i) => (
        <Fragment key={key}>
          {i > 0 && (
            <span aria-hidden="true" className="px-[5px] opacity-60">
              ·
            </span>
          )}
          <kbd className="rounded-[3px] border border-line bg-inset px-[4px] py-px font-mono text-[10px] text-muted">{key}</kbd>{' '}
          {verb}
        </Fragment>
      ))}
    </p>
  )
}

const PHASE_TONE: Record<string, { chip: string; mark: string }> = {
  spec:       { chip: 'bg-[#f3eee5] text-[#6f5a3a] border-[#e2d6bd]', mark: 'bg-current' },
  plan:       { chip: 'bg-[#eef0f5] text-[#4a5170] border-[#d6dbe8]', mark: 'bg-current' },
  implement:  { chip: 'bg-accent-tint text-accent-deep border-[#e9d3c4]', mark: 'bg-current' },
  integrate:  { chip: 'bg-info-bg text-info border-info-line', mark: 'bg-current' },
  release:    { chip: 'bg-[#efe9f5] text-[#5a3a7a] border-[#dccfea]', mark: 'bg-current' },
  done:       { chip: 'bg-ok-bg text-ok border-ok-line', mark: 'border-[1.5px] border-current bg-transparent' },
  paused:     { chip: 'bg-warn-bg text-warn border-warn-line', mark: 'border-[1.5px] border-current bg-transparent rounded-[2px]' },
  staged:     { chip: 'bg-transparent text-[#6f5a3a] border-dashed border-[#c9bfa9]', mark: 'border-[1.5px] border-current bg-transparent' },
  closed:     { chip: 'bg-[#eeecea] text-[#5f5a54] border-[#d6d1ca]', mark: 'border-[1.5px] border-current bg-transparent rotate-45 rounded-[1px]' },
  unknown:    { chip: 'bg-bad-bg text-bad border-bad-line', mark: 'bg-current' },
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
  // phase exists precisely so the record says why, and a chip reading "closed"
  // alone would put the untyped terminal state back on the screen.
  if (phase === 'closed') {
    const t = PHASE_TONE.closed!
    return (
      <span data-phase-chip className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-md border px-[10px] py-[4px] text-[12.5px] font-semibold leading-none ${t.chip}`}>
        <span className={`inline-block h-[9px] w-[9px] shrink-0 ${t.mark}`} />
        <span>closed</span>
        <span className="opacity-80">· {closure?.as ?? 'no disposition'}</span>
      </span>
    )
  }
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

/** The clock glyph is a mark, not a letter, so it takes a word space rather
 *  than the letter-spacing 2px gave it — set solid against "waiting" it read as
 *  one malformed token (#285/7). The ≥3-day threshold it appears at is
 *  unchanged. */
const AGE_GLYPH = 'mr-[4px]'

export function AgeBadge({ label, urgent, stale }: { label: string; urgent: boolean; stale?: boolean }) {
  if (stale) {
    return (
      <span className="shrink-0 font-mono text-[13px] font-bold leading-none tabular-nums text-bad" title="waiting since">
        <span className={AGE_GLYPH}>⏱</span>{label}
      </span>
    )
  }
  return (
    <span className={`shrink-0 font-mono text-[13px] leading-none tabular-nums ${urgent ? 'font-semibold text-warn' : 'text-muted'}`} title="waiting since">
      {urgent && <span className={AGE_GLYPH}>⏱</span>}{label}
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

/**
 * The run header's phase spine (#254) — the profile's phases left to right with
 * its gates as the transitions between them. `spine.ts` decides the shape; this
 * decides how each cell reads.
 *
 * It replaces a phase chip plus a detached four-box gate ledger, which between
 * them said where the run was without ever saying that gates are what move it
 * there. Because the sequence is now visible, the profile no longer has to be
 * spelled out: four phases and two gates *is* `patch`.
 *
 * The connectors are flex-grown rather than fixed, so the spine fills whatever
 * width it is given — a run header at 900px is a first-class layout, not a
 * degraded wide one.
 *
 * It never wraps (#295). #254 shipped it as a `flex-wrap` row, and in the
 * 800–1000px band a full profile spent its two widest cells — the 24px
 * provenance notes under approved gates — on a second line. That abandons the
 * one thing the spine is for: a wrapped sequence is not one shape, its wrap
 * point is an accident of label widths rather than anything about the run, and
 * the connectors, which mean "flows into", dangle at row ends meaning nothing.
 * So the row is `nowrap`, and it yields in this order:
 *
 *   1. connectors compress to their 8px minimum;
 *   2. below `noteRung` — the width at which this spine's notes provably fit —
 *      the notes are demoted to the cell's tooltip and the gaps close;
 *   3. past that, it crops and scrolls, with the gate on the table scrolled
 *      into view. A cropped sequence still reads as a sequence.
 *
 * Step 2 is a narrow-band behaviour, not a reversal of #254's decision to carry
 * provenance in the open — above the rung it is exactly as it was, and approver
 * and date stay reachable at every width through `title` and the accessible
 * name, which quote them verbatim.
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
      // The gate on the table first, then where the run stands: a comma
      // selector would hand back whichever came first in the row, and the
      // current phase always precedes the gate that closes it.
      const target =
        row.querySelector<HTMLElement>('[data-spine-gate][data-state="pending"]') ??
        row.querySelector<HTMLElement>('[data-spine-phase][data-state="current"]')
      if (!target) return
      const box = target.getBoundingClientRect()
      const rowBox = row.getBoundingClientRect()
      row.scrollLeft += box.left - rowBox.left - (row.clientWidth - box.width) / 2
    }
    center()
    // A window resize can crop what was in the open a moment ago; a resize is
    // not the reader scrolling, so re-centring on it is not taking the row away
    // from them.
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
// below it the notes go to the tooltip and the gap closes, so the connector
// touches the pills it joins and the sequence buys back ~100px before it has to
// crop. Written out rather than composed, because Tailwind only emits classes
// it can see whole in the source.
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

const PHASE_STATE_TONE: Record<PhaseCell['state'], string> = {
  past: 'border-line bg-surface text-muted',
  current: 'border-accent bg-accent-tint text-accent-deep font-semibold',
  future: 'border-dashed border-line bg-transparent text-faint',
}

function SpinePhase({ cell, atRest, noteClass }: { cell: PhaseCell; atRest: boolean; noteClass: string }) {
  // At rest the run still stands somewhere; the ring goes dashed to say it is
  // standing there rather than moving through, and the phase chip beside the
  // spine names the reason.
  const tone = cell.state === 'current' && atRest ? 'border-dashed border-warn-line bg-warn-bg text-warn font-semibold' : PHASE_STATE_TONE[cell.state]
  return (
    <li data-spine-phase={cell.phase} data-state={cell.state} className="flex shrink-0 flex-col items-center gap-[3px]">
      <span className={`inline-flex h-[22px] items-center rounded-full border px-2.5 text-[12px] leading-none ${tone}`}>{cell.phase}</span>
      {/* The gutter the gate notes sit in. It goes with them, so a spine with
          no notes in the open is not 24px of empty header. */}
      <span aria-hidden="true" className={`h-[24px] ${noteClass}`} />
    </li>
  )
}

const GATE_STATE_TONE: Record<GateCell['state'], string> = {
  approved: 'border-ok-line bg-ok-bg text-ok',
  declined: 'border-dashed border-bad-line bg-bad-bg text-bad',
  pending: 'border-accent bg-accent text-white font-bold',
  future: 'border-dashed border-line bg-transparent text-faint',
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
 *  say, so it is the accessible name and the hover text — never inferred, always
 *  the fixed GATE_QUESTIONS string for the profile it is asked in.
 *
 *  Below `noteRung` the note under the cell is hidden and this text is the only
 *  place provenance is shown — which is why it has always carried it verbatim. */
function SpineGate({ cell, bounced, noteClass }: { cell: GateCell; bounced: boolean; noteClass: string }) {
  const decided = cell.by !== null || cell.at !== null
  const provenance = decided ? `${cell.by ?? '—'}${cell.at ? ` · ${String(cell.at).slice(0, 10)}` : ''}` : null
  const note = gateNote(cell)
  const word = bounced && cell.state === 'pending' ? GATE_BOUNCED_WORD : GATE_STATE_WORD[cell.state]
  const label = `${cell.gate} — ${cell.question} — ${word}${provenance ? ` by ${provenance}` : ''}`
  return (
    <li data-spine-gate={cell.gate} data-state={cell.state} className="flex shrink-0 flex-col items-center gap-[3px]">
      <span
        title={label}
        className={`inline-flex h-[22px] items-center gap-1 rounded-full border px-2 font-mono leading-none ${GATE_STATE_TONE[cell.state]}`}
      >
        <span aria-hidden="true" className="text-[10.5px] font-semibold tracking-[0.04em]">
          {cell.gate}
        </span>
        <span aria-hidden="true" className="text-[11px]">
          {GATE_STATE_GLYPH[cell.state]}
        </span>
        <span className="sr-only">{label}</span>
      </span>
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
  // Nothing spent, so there is nothing to meter: the word alone (#285/5). The
  // bar used to draw anyway, and because a 0%-wide fill is invisible it was
  // floored at 4% — a tick that looks like a reading and is not one. The limit
  // it was standing in for is still here, in the same tooltip the metered bar
  // carries, and it comes back as a bar the moment a dispatch spends anything.
  if (used === 0) {
    return (
      <span className="font-mono text-[11.5px] tabular-nums text-muted" title={`$0.00 of $${limit.toFixed(2)}`}>
        unmetered
      </span>
    )
  }
  return (
    <span className="inline-flex flex-col items-end gap-[3px]" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-[5px] w-[90px] overflow-hidden rounded-full border border-line bg-raised">
        <span className={`block h-full rounded-full ${over ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`font-mono text-[11.5px] tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
        ${used.toFixed(0)} / ${limit.toFixed(0)}{over ? ' · over' : ''}
      </span>
    </span>
  )
}
