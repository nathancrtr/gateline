// The decision affordances (plan §4). Approve captures burden in the act of
// deciding; decline requires a reason; escalations take a disposition note;
// paused runs resume. A CAS conflict (409) re-presents rather than retrying —
// the refusal is the designed outcome.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { ApiError, api, type Burden, type Disposition, type GateId, type InboxItem, type Profile } from '../api.ts'
import { type KeyHint, useKeys } from '../use-keys.ts'
import { KeyHints } from './chips.tsx'

/**
 * The two cards whose only affordance is a sentence (#285/6).
 *
 * They live here, with the buttons they stand in for, and are rendered by the
 * card in its description slot — because that sentence *is* the card's job, and
 * the card foot is where an affordance goes, not where the instruction goes. A
 * round cap and a bounce have no button to put there, and the foot demoted the
 * one thing either card had to say into right-aligned small print beside the
 * evidence chips. #296 removed the round-cap panel's duplicate report row,
 * which left this sentence as that card's only instruction and settled the
 * question: promote it, do not restyle it.
 */
export const BOUNCED_INSTRUCTION =
  'Bounced — fix the artifacts (or the contract) and the card returns; no approval is offered for a malformed packet.'

/**
 * What actually clears a round cap (#342). The old sentence told the human to
 * "decline the pending gate with direction", and on a run paused at the cap
 * there is no gate card to decline — the only exits were hand edits of
 * `review_rounds` or of the task's status. Resolving the escalation is now the
 * exit the engine reads, so the card says that instead.
 */
export const ROUND_CAP_INSTRUCTION =
  'Read both sides, then unblock: resolve the escalation — with a disposition to route the round — and resume. One more round follows, and the next verdict past the cap asks again.'

/**
 * The third card with no button (#159), and the one that has to say why it has
 * none the most carefully: nothing is wrong here. The producing role is out
 * with a fresh dispatch — the usual cause is the decline you just made — so the
 * packet on screen is the superseded one, and the card returns on its own when
 * the replacement lands. The role and the artifact are in the item's `detail`,
 * in the run's own words; this sentence is what to do about it.
 */
export const INFLIGHT_INSTRUCTION =
  'Superseded — the producing role is in flight, so no approval is offered for this packet; the card returns when the new one lands.'

/**
 * What the keyboard can do to *this* card, in the words the card uses (#284).
 *
 * Derived from the same two facts the handlers below branch on, so a card that
 * cannot be approved never advertises `a`. Kinds whose only affordance is a
 * button — paused, staged — and kinds with no affordance at all get nothing;
 * the run page's own `e`/`esc` hints carry those, and a hint list that says
 * only what the page already said is noise.
 */
export function decideHints(item: InboxItem): KeyHint[] {
  if (item.kind === 'gate' && item.reviewable) {
    return [
      ['a', 'approve'],
      ['x', 'decline'],
      ['1/2/3', 'burden'],
    ]
  }
  if (item.kind === 'escalation') return [['a', 'resolve']]
  return []
}

const BURDEN_OPTIONS: { value: Burden; key: string; label: string; hint: string }[] = [
  { value: 'confirmation', key: '1', label: 'Confirmation', hint: 'looked right as delivered' },
  { value: 'light-correction', key: '2', label: 'Light correction', hint: 'approved, notes attached' },
  { value: 'heavy-correction', key: '3', label: 'Heavy correction', hint: 'took real work to accept' },
]

/**
 * Where a decline sends the run back to (#253). Closed since #249 froze the
 * gates and the role positions, so the panel can name the destination instead
 * of hedging about "the producing role".
 *
 * A patch run is the case most worth saying out loud: it has no Architect to
 * bounce to, because the human supplied that judgment at init by authoring the
 * brief and the work item themselves (DESIGN.md §4.1).
 */
function declineDestination(gate: GateId | null, profile: Profile): string | null {
  switch (gate) {
    case 'G0':
      return 'the Analyst'
    case 'G1':
      return profile === 'patch' ? 'the brief and work item you wrote' : 'the Architect'
    case 'G2':
      return 'the Implementer and Reviewer loop'
    case 'G3':
      return 'Ops'
    default:
      return null
  }
}

const DISPOSITION_OPTIONS: { value: Disposition; label: string; hint: string }[] = [
  { value: 're-review', label: 'Re-review', hint: 'the named condition is addressed; verify now' },
  { value: 'return-to-implement', label: 'Return to implement', hint: 'dispatch the implementer with the review report first' },
  { value: 're-plan', label: 'Re-plan', hint: 'the fix needs the architect: amend the plan/task surfaces first' },
]

type Mode = 'idle' | 'approve' | 'decline' | 'resolve' | 'arm' | 'resume'

export function DecidePanel({
  item,
  profile,
  primary = false,
  sentHere = false,
  chips = null,
  pageHints = [],
}: {
  item: InboxItem
  /** The run's profile — decides where a decline sends the run (#253). */
  profile: Profile
  primary?: boolean
  /** Arrived here from an inbox link naming this decision (#216). */
  sentHere?: boolean
  chips?: React.ReactNode
  /**
   * The run page's own keys (#284), hinted here rather than at the page foot
   * whenever this card is the primary one — so the whole loop reads as one
   * line, and so it disappears together the moment a form opens and the keys
   * stop meaning what the line says.
   */
  pageHints?: readonly KeyHint[]
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('idle')
  const [burden, setBurden] = useState<Burden | null>(null)
  const [notes, setNotes] = useState('')
  const [disposition, setDisposition] = useState<Disposition | null>(null)
  const [hold, setHold] = useState(false)
  const [holdReason, setHoldReason] = useState('')
  // Resume from budget-exhausted has to carry a higher limit (#96); the
  // field starts at the current one so the human edits a number, not a blank.
  const [costLimit, setCostLimit] = useState(item.costLimitUsd != null ? String(item.costLimitUsd) : '')
  const [flash, setFlash] = useState<{ kind: 'ok' | 'conflict' | 'error'; text: string } | null>(null)

  // Keyboard loop for the page's primary card: a approve · x decline ·
  // 1/2/3 burden · esc back to idle.
  const keyHandlers = useMemo(
    () => ({
      a: () => {
        if (item.kind === 'gate' && item.reviewable) setMode('approve')
        else if (item.kind === 'escalation') setMode('resolve')
      },
      x: () => {
        if (item.kind === 'gate' && item.reviewable) setMode('decline')
      },
      '1': () => setBurden('confirmation'),
      '2': () => setBurden('light-correction'),
      '3': () => setBurden('heavy-correction'),
      Escape: () => setMode('idle'),
    }),
    [item.kind, item.reviewable],
  )
  useKeys(keyHandlers, primary)

  // Arriving from an inbox link opens the form for the kinds that have exactly
  // one, non-destructive one (#216). Gates are deliberately excluded: opening
  // either their approve or their decline form would presume an outcome the
  // human has not chosen. `paused` is excluded too — its single affordance
  // submits on click rather than opening a form, and a link must never arm a
  // write. Those kinds get focus (handled by the card) and nothing more.
  useEffect(() => {
    if (!sentHere) return
    if (item.kind === 'escalation') setMode('resolve')
    else if (item.kind === 'staged') setMode('arm')
  }, [sentHere, item.kind])

  // Let page-level Escape (back to inbox) yield while a decision is open.
  useEffect(() => {
    if (mode !== 'idle') {
      document.body.dataset.deciding = 'true'
      return () => {
        delete document.body.dataset.deciding
      }
    }
  }, [mode])

  const mutation = useMutation({
    mutationFn: api.decide,
    onSuccess: (result) => {
      setFlash({ kind: 'ok', text: `${result.summary} — committed ${result.commit?.slice(0, 10)}${result.note ? ` (${result.note})` : ''}` })
      setMode('idle')
      setBurden(null)
      setNotes('')
      setDisposition(null)
      setHold(false)
      setHoldReason('')
      void queryClient.invalidateQueries()
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setFlash({ kind: 'conflict', text: `The run moved while you were deciding — re-read and decide again. (${e.message})` })
        void queryClient.invalidateQueries()
      } else {
        setFlash({ kind: 'error', text: (e as Error).message })
      }
    },
  })

  const base = { source: item.source, slug: item.slug }
  const gate = item.gate as GateId | null
  const destination = declineDestination(gate, profile)

  const submitApprove = () => {
    if (!burden || !gate) return
    if (hold && !holdReason.trim()) return
    mutation.mutate({
      ...base,
      action: 'approve',
      gate,
      burden,
      notes: notes.trim() || undefined,
      hold: hold || undefined,
      holdReason: hold ? holdReason.trim() : undefined,
    })
  }
  const submitDecline = () => {
    if (!gate || !notes.trim()) return
    mutation.mutate({ ...base, action: 'decline', gate, notes: notes.trim() })
  }
  const submitResolve = () => {
    if (item.escalationIndex === null || !notes.trim()) return
    mutation.mutate({
      ...base,
      action: 'resolve-escalation',
      escalationIndex: item.escalationIndex,
      notes: notes.trim(),
      disposition: disposition ?? undefined,
    })
  }
  // A budget pause is a condition the engine recomputes from the ledger and
  // the limit (#96): a bare resume re-pauses on the next tick, so from that
  // reason the button opens a form and the form's only field is the limit.
  const budgetPaused = item.kind === 'paused' && item.pausedReason === 'budget-exhausted'
  const parsedLimit = Number(costLimit)
  const limitRaised = Number.isFinite(parsedLimit) && parsedLimit > 0 && (item.costLimitUsd == null || parsedLimit > item.costLimitUsd)
  const submitResume = () => mutation.mutate({ ...base, action: 'resume' })
  const submitResumeWithLimit = () => {
    if (!limitRaised) return
    mutation.mutate({ ...base, action: 'resume', costLimitUsd: parsedLimit })
  }
  // A staged run has never flown — arming, never resuming, is what starts it
  // (AC6.1). This is the only path in this component that issues 'arm', and
  // the staged branch below is the only one that can reach it.
  const submitArm = () => mutation.mutate({ ...base, action: 'arm' })

  if (flash?.kind === 'ok') return <Flash kind="ok" text={flash.text} />

  // Idle mode shares one footer row with the card's packet chips — evidence on
  // the left, the decision affordance on the right. Expanded modes keep the
  // chips row and open the form below it at full width.
  const chipRow = chips ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div> : null
  // Only the card the keyboard actually drives says so, and only while it is
  // idle: `useKeys` above is enabled on `primary`, and in every other mode `a`,
  // `x` and the digits are characters someone is typing (#284).
  const hints = primary ? [...decideHints(item), ...pageHints] : []

  return (
    <div className="mt-3 border-t border-line pt-3" data-decide-panel>
      {flash && <Flash kind={flash.kind} text={flash.text} />}

      {mode === 'idle' && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
          {chipRow}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {item.kind === 'gate' && item.reviewable && (
              <>
                <Button primary onClick={() => setMode('approve')} data-decide="approve">
                  Approve…
                </Button>
                <Button onClick={() => setMode('decline')} data-decide="decline">
                  Decline…
                </Button>
              </>
            )}
            {item.kind === 'escalation' && (
              <Button primary onClick={() => setMode('resolve')} data-decide="resolve">
                Resolve…
              </Button>
            )}
            {item.kind === 'paused' && budgetPaused && (
              <Button primary onClick={() => setMode('resume')} data-decide="resume">
                Raise the limit and resume…
              </Button>
            )}
            {item.kind === 'paused' && !budgetPaused && (
              <Button primary onClick={submitResume} disabled={mutation.isPending} data-decide="resume">
                {mutation.isPending ? 'Resuming…' : 'Resume run'}
              </Button>
            )}
            {item.kind === 'staged' && (
              <Button primary onClick={() => setMode('arm')} data-decide="arm">
                Arm run…
              </Button>
            )}
          </div>
        </div>
      )}

      {mode === 'idle' && <KeyHints hints={hints} className="mt-2.5" />}

      {mode !== 'idle' && chipRow && <div className="mb-3">{chipRow}</div>}

      {mode === 'approve' && (
        <div className="flex flex-col gap-3">
          <fieldset>
            <legend className="mb-[9px] text-[12px] text-muted">How much work was this review? (recorded with the approval)</legend>
            <div className="flex flex-wrap gap-2">
              {BURDEN_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-baseline gap-2 border px-3 py-2 text-sm ${
                    burden === o.value ? 'border-ink bg-accent-tint font-semibold text-ink' : 'border-line hover:border-ink'
                  }`}
                >
                  <input
                    type="radio"
                    name={`burden-${item.slug}-${gate}`}
                    className="sr-only"
                    checked={burden === o.value}
                    onChange={() => setBurden(o.value)}
                  />
                  <span className="font-mono text-[11px] text-muted">{o.key}</span>
                  <span>
                    {o.label}
                    <span className="ml-1.5 text-xs font-normal text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <NotesField value={notes} onChange={setNotes} placeholder="Notes (optional) — recorded in the gate entry" />
          <label className="flex cursor-pointer items-baseline gap-2 text-sm text-muted">
            <input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} data-decide="hold" />
            <span>
              Approve and hold — sign the gate but pause the run in the same commit, so nothing dispatches until you resume.
              <span className="ml-1 text-xs text-faint">Use when a decision of yours still stands between this gate and the next phase.</span>
            </span>
          </label>
          {hold && (
            <NotesField
              value={holdReason}
              onChange={setHoldReason}
              autoFocus
              placeholder="What is the run waiting on? Recorded as the pause reason — required."
            />
          )}
          <div className="flex gap-2">
            <Button primary onClick={submitApprove} disabled={!burden || (hold && !holdReason.trim()) || mutation.isPending} data-decide="approve-confirm">
              {mutation.isPending ? 'Committing…' : hold ? `Approve ${gate} and hold` : `Approve ${gate}`}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'decline' && (
        <div className="flex flex-col gap-3">
          <NotesField
            value={notes}
            onChange={setNotes}
            autoFocus
            placeholder={
              destination
                ? `Why? Specific notes are the correction channel back to ${destination} — required.`
                : 'Why? Specific notes are the correction channel back to the producing role — required.'
            }
          />
          <div className="flex gap-2">
            <Button danger onClick={submitDecline} disabled={!notes.trim() || mutation.isPending} data-decide="decline-confirm">
              {mutation.isPending
                ? 'Committing…'
                : destination
                  ? `Decline ${gate} — pause, and back to ${destination}`
                  : `Decline ${gate} and pause the run`}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'resolve' && (
        <div className="flex flex-col gap-3">
          <NotesField value={notes} onChange={setNotes} autoFocus placeholder="Disposition — what unblocks the run, recorded on the escalation. Required." />
          <fieldset>
            <legend className="mb-[9px] text-[12px] text-muted">
              Route the run on resolve (optional — unset leaves the engine's default)
            </legend>
            <div className="flex flex-wrap gap-2">
              {DISPOSITION_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-baseline gap-2 border px-3 py-2 text-sm ${
                    disposition === o.value ? 'border-ink bg-accent-tint font-semibold text-ink' : 'border-line hover:border-ink'
                  }`}
                >
                  <input
                    type="radio"
                    name={`disposition-${item.slug}-${item.escalationIndex}`}
                    className="sr-only"
                    checked={disposition === o.value}
                    onChange={() => setDisposition(o.value)}
                  />
                  <span>
                    {o.label}
                    <span className="ml-1.5 text-xs font-normal text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button primary onClick={submitResolve} disabled={!notes.trim() || mutation.isPending} data-decide="resolve-confirm">
              {mutation.isPending ? 'Committing…' : 'Resolve escalation'}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'resume' && (
        <div className="flex flex-col gap-3">
          <p className="border-t border-b border-line py-[9px] text-sm leading-[1.6] text-muted">
            <b className="text-ink">{item.slug}</b> stopped because its next dispatch would exceed{' '}
            {item.costLimitUsd != null ? (
              <>
                <code className="font-mono">cost_limit_usd</code> ${item.costLimitUsd}
              </>
            ) : (
              <>
                a per-run limit it does not have
              </>
            )}
            . The engine recomputes that from the ledger on every tick, so resuming at the same limit re-pauses at once. The new limit
            is written in the same commit as the resume.
          </p>
          <label className="flex items-baseline gap-2 text-sm">
            <span className="text-[12px] text-muted">New cost_limit_usd</span>
            <input
              type="number"
              min={0}
              step={1}
              value={costLimit}
              onChange={(e) => setCostLimit(e.target.value)}
              // biome-ignore lint/a11y/noAutofocus: the decision panel opens because the approver chose to raise the limit; focus belongs on the field they came here to fill in.
              autoFocus
              data-decide="cost-limit"
              className="input-well w-32 px-[11px] py-[7px] font-mono text-sm tabular-nums"
            />
            {item.costLimitUsd != null && !limitRaised && costLimit !== '' && (
              <span className="text-xs text-bad">must be above ${item.costLimitUsd}</span>
            )}
          </label>
          <div className="flex gap-2">
            <Button primary onClick={submitResumeWithLimit} disabled={!limitRaised || mutation.isPending} data-decide="resume-confirm">
              {mutation.isPending ? 'Committing…' : `Resume ${item.slug} at $${Number.isFinite(parsedLimit) ? parsedLimit : '…'}`}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'arm' && (
        <div className="flex flex-col gap-3">
          <p className="border-t border-b border-line py-[9px] text-sm leading-[1.6] text-muted">
            Arming moves <b className="text-ink">{item.slug}</b> out of staged rest: dispatch begins and the budget starts
            metering. The orchestrator picks it up on its next tick. This is the act that spends — staging spent nothing.
          </p>
          <div className="flex gap-2">
            <Button primary onClick={submitArm} disabled={mutation.isPending} data-decide="arm-confirm">
              {mutation.isPending ? 'Committing…' : `Arm ${item.slug}`}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Button({
  primary,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  const tone = primary ? '' : danger ? 'btn-danger' : 'btn-quiet'
  return <button {...props} className={`btn ${tone}`} />
}

function NotesField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // biome-ignore lint/a11y/noAutofocus: callers opt in deliberately (decline/hold/resolve notes) — the field the approver is about to type into.
      autoFocus={autoFocus}
      rows={2}
      className="input-well w-full resize-y px-[11px] py-[9px] text-sm placeholder:text-muted"
    />
  )
}

function Flash({ kind, text }: { kind: 'ok' | 'conflict' | 'error'; text: string }) {
  const tone = kind === 'ok' ? 'border-ink text-ink' : 'border-mark text-warn'
  return (
    <p className={`mb-2 border-t border-b py-2 text-xs font-semibold ${tone}`} role="status">
      {text}
    </p>
  )
}
