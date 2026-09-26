// The fixed status vocabulary: phases, gate states, inbox kinds, validation.
// Used identically everywhere — status is encoded in form, not just color.
//
// Since the 2026-09 redesign (docs/GATEHOUSE-DESIGN.md) every status is an
// *impression*: a name plus its code in one ink, told apart by texture —
// filled for a decision taken, hollow for pending, struck for declined,
// hatched for bounced, dotted for a state not reached or a run at rest,
// doubled for the phase the machine is working in, and filled in the yellow
// for the gate on the table, because that is where a human is wanted. There
// is no hue per phase: the word and the texture carry the difference.
//
// Colour means health, plus the one ready decision (packages/web/DESIGN.md,
// settled decision 8; #419). A decision ready to take is the signal blue,
// hollow — it is where the reader goes, and the row carrying it is a link. A
// run stuck until a person unblocks it is the caution ink, hollow. A record
// that cannot be read is hatched in the declined red. The machine's turn — a
// bounced packet the engine re-dispatches, a superseded one — and a run at
// rest stay dotted. An approved gate is filled in the approved green and a
// declined one struck in the red. The yellow stays on the spine's one gate on
// the table. That is tinting by a computed condition (docs/SEAM.md §5), so the
// words inside the mark always state the fact and the colour never says
// anything they do not.
import { Fragment, useEffect, useRef } from 'react'
import { type ClosureRecord, type GateId, type InboxItem, PROFILE_GATES, type Profile, type RunSummary } from '../api.ts'
import { gateCardState } from '../gate-state.ts'
import { type GateCell, gateNote, noteRung, type PhaseCell, phaseSpine, type SpineNoteRung } from '../spine.ts'
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
    <p data-key-hints className={`font-ui text-[10.5px] leading-[1.7] text-muted ${className}`}>
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

/** A tone the impression can take: textures, plus the state colours settled
 *  decision 8 spends (`go`, `warn`, `ok`, `mark`, and `cur` on the spine). */
export type ImpTone =
  | ''
  | 'fill'
  | 'dot'
  | 'struck'
  | 'struck mark'
  | 'hatch'
  | 'hatch mark'
  | 'cur'
  | 'here'
  | 'mark'
  | 'go'
  | 'warn'
  | 'ok'
  | 'stamped'
  | 'fill stamped'

/** The impression itself. `tone` is a texture, and a state colour only where
 *  the mapping in DESIGN.md names one. */
export function Imp({
  children,
  tone = '',
  className = '',
  title,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: ImpTone }) {
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
  // A phase the vocabulary does not know is a malformed record, not a
  // position: hatched, in the declined red, like a bounced packet. The red
  // is the mark tone, not a text utility — `.imp` sets its own colour.
  if (phase === 'unknown') {
    return (
      <Imp data-phase-chip tone="hatch mark">
        unknown
      </Imp>
    )
  }
  // A phase in flight is the plain mark. The doubled "here" tone is
  // reserved for the spine, where the sequence gives it something to be the
  // position *in*; a column of them in the portfolio was a column of alarms.
  return <Imp data-phase-chip>{phase}</Imp>
}

/**
 * The tone an inbox item's chip takes (settled decision 8). A reviewable gate
 * is the signal blue, hollow: a decision is ready to take, and the row is the
 * link to it. An escalation or a round cap is the caution ink, hollow: stuck
 * until a person unblocks it, and the glyphs ⚑ / ⟲ keep the two apart. A
 * malformed record is hatched in the declined red: it cannot be read. A
 * bounced packet (R3) is the machine's turn — the engine re-dispatches and no
 * approval is offered — so it is dotted, like an in-flight gate (#159), a
 * staged run and a paused one. Never the yellow, never red on a bounce.
 */
export function kindTone(item: InboxItem): ImpTone {
  switch (item.kind) {
    case 'gate': {
      const state = gateCardState(item)
      return state === 'reviewable' ? 'go' : 'dot'
    }
    case 'malformed':
      return 'hatch mark'
    case 'escalation':
    case 'round-cap':
      return 'warn'
    default:
      return 'dot'
  }
}

export function KindChip({ item }: { item: InboxItem }) {
  const tone = kindTone(item)
  if (item.kind === 'gate') {
    return <Imp tone={tone}>{item.gate} · gate</Imp>
  }
  const glyph = { escalation: '⚑', 'round-cap': '⟲', paused: '', staged: '', malformed: '⚠' }[item.kind] ?? ''
  return (
    <Imp tone={tone}>
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
      <span className="shrink-0 font-ui text-[12.5px] font-semibold leading-none tabular-nums text-warn" title="waiting since">
        <span className={AGE_GLYPH}>⏱</span>
        {label}
      </span>
    )
  }
  return (
    <span className={`shrink-0 font-ui text-[12.5px] leading-none tabular-nums ${urgent ? 'font-semibold text-ink' : 'text-muted'}`} title="waiting since">
      {urgent && <span className={AGE_GLYPH}>⏱</span>}
      {label}
    </span>
  )
}

const GATE_GLYPH = { approved: '✓', declined: '✕', pending: '·' } as const

/** The ledger's decided states in colour (settled decision 8): approved is the
 *  green fill, declined is struck in the red, and an undecided gate stays the
 *  plain mark — the glyph beside each says the same thing in a word's place. */
const LEDGER_TONE = { approved: 'ok', declined: 'struck mark', pending: '' } as const satisfies Record<string, ImpTone>

/** One gate cell of the G0–G3 ledger strip. */
export function GateChip({ id, cell }: { id: GateId; cell: RunSummary['gates'][GateId] }) {
  const state = cell.approved ? 'approved' : cell.decided ? 'declined' : 'pending'
  const tone = LEDGER_TONE[state]
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
        <GateChip key={g} id={g} cell={gates[g]} />
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
  // An in-flight one refuses the approval too, but nothing about it is wrong
  // (#159): it reads through `gateCardState` like every other surface, so the
  // spine does not hatch in the red what the card beside it says is at rest.
  const offTable = new Map<GateId, GateOffTable>()
  for (const i of items ?? []) {
    const state = gateCardState(i)
    if (i.gate === null || state === null || state === 'reviewable') continue
    offTable.set(i.gate as GateId, state === 'bounced' ? { state } : { state, role: i.inflight?.role ?? null })
  }
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
              <SpineGate cell={cell} offTable={offTable.get(cell.gate) ?? null} noteClass={NOTE_RUNG_NOTE[rung]} />
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
  // spine names the reason. In motion it is doubled, not yellow: the yellow
  // is the gate's, for the one cell that is waiting on a person.
  const tone = cell.state === 'current' ? (atRest ? 'dot' : 'here') : cell.state === 'future' ? 'dot' : ''
  return (
    <li data-spine-phase={cell.phase} data-state={cell.state} className="flex shrink-0 flex-col items-center gap-[4px]">
      <Imp tone={tone}>{cell.phase}</Imp>
      {/* The gutter the gate notes sit in. It goes with them, so a spine with
          no notes in the open is not 24px of empty header. */}
      <span aria-hidden="true" className={`h-[24px] ${noteClass}`} />
    </li>
  )
}

/** The spine's gate cells take the ledger's colours (settled decision 8), and
 *  the gate on the table keeps the yellow — the one cell on the page it is
 *  spent on besides the focus ring. */
export const GATE_STATE_TONE: Record<GateCell['state'], ImpTone> = {
  approved: 'ok',
  declined: 'struck mark',
  pending: 'cur',
  future: 'dot',
}

/** A spine gate cell's tone: the ledger's mapping, except that a pending gate
 *  offering no decision — its packet bounced, or superseded while the producer
 *  is out again — is dotted: it is the machine's turn, the same reading as the
 *  inbox chip, and the cell's words say which. */
export function spineGateTone(state: GateCell['state'], held: 'bounced' | 'inflight' | null): ImpTone {
  if (state === 'pending' && held !== null) return 'dot'
  return GATE_STATE_TONE[state]
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

/** A pending gate that offers no decision, and why: its packet bounced, or the
 *  producing role is out with a fresh dispatch and the packet is superseded. */
type GateOffTable = { state: 'bounced' } | { state: 'inflight'; role: string | null }

function inflightWord(role: string | null): string {
  return `on the table — superseded, waiting on ${role ?? 'the producing role'}`
}

/** One gate, as the transition it is. Its question is what `G2` alone cannot
 *  say, so it is the accessible name and the hover text — never inferred,
 *  always the fixed GATE_QUESTIONS string for the profile it is asked in. */
function SpineGate({ cell, offTable, noteClass }: { cell: GateCell; offTable: GateOffTable | null; noteClass: string }) {
  const decided = cell.by !== null || cell.at !== null
  const provenance = decided ? `${cell.by ?? '—'}${cell.at ? ` · ${String(cell.at).slice(0, 10)}` : ''}` : null
  const note = gateNote(cell)
  const held = cell.state === 'pending' ? offTable : null
  const word =
    held?.state === 'bounced' ? GATE_BOUNCED_WORD : held?.state === 'inflight' ? inflightWord(held.role) : GATE_STATE_WORD[cell.state]
  const label = `${cell.gate} — ${cell.question} — ${word}${provenance ? ` by ${provenance}` : ''}`
  const tone = spineGateTone(cell.state, held?.state ?? null)
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
        className={`h-[24px] whitespace-nowrap text-center font-ui text-[10.5px] leading-[12px] text-muted ${noteClass}`}
      >
        {note?.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: `note` is a fixed, pre-split set of display lines for one gate cell, never reordered.
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
    <span className="font-mono text-[11px] font-semibold text-bad" title={`missing: ${(missing ?? []).join(', ')}`}>
      ✕
    </span>
  )
}

// Whole dollars read as whole dollars; a fractional amount keeps its cents.
// A meter that always rounded to whole dollars is the label that made a
// staged $18.50 ceiling read "$19" — a second, smaller instance of the same
// contradiction #443 is about, between the header and the record's own
// number (#443 follow-up).
const label = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

export function BudgetMeter({ limit, spent }: { limit: number | null; spent: number | null }) {
  if (limit === null) return <span className="text-xs italic text-muted">no budget</span>
  const used = spent ?? 0
  const over = used > limit
  const pct = Math.min(100, (used / limit) * 100)
  // At zero spend the record still has a limit, so the meter states both
  // facts it has ($0 of the ceiling) rather than a word of its own. A staged
  // run — spent nothing by definition, since arming is where metering begins
  // — is the common case (#443); "unmetered" there contradicted a ceiling
  // stated one line away. The bar at 0% is honestly empty, not a floored
  // tick (that floor was removed in #313/#285), so no special case is needed.
  return (
    <span className="inline-flex flex-col items-end gap-[3px]" title={`$${used.toFixed(2)} of $${limit.toFixed(2)}`}>
      <span className="h-[7px] w-[90px] overflow-hidden border border-line">
        <span className={`block h-full ${over ? 'bg-mark' : 'bg-ink'}`} style={{ width: `${pct}%` }} />
      </span>
      <span className={`font-ui text-[11.5px] tabular-nums ${over ? 'font-semibold text-bad' : 'text-muted'}`}>
        {label(used)} / {label(limit)}
        {over ? ' · over' : ''}
      </span>
    </span>
  )
}
