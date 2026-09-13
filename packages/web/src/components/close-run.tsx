// Closing a run, and the record a closure leaves behind (#200).
//
// Every other decision affordance in Gatehouse hangs off an inbox item, because
// every other decision answers a question the run is asking. Closing answers no
// question: it is the human deciding the run has stopped being worth asking
// about, and a run can reach that point with an empty inbox — mid-implement,
// mid-escalation, or parked for weeks. So this is a run-level affordance rather
// than a card, and it is reachable whenever the run is neither `done` nor
// already closed.
//
// The disposition is required and typed. Free text would have been cheaper here
// and unrecoverable later: which of these four a closure meant lives in the
// human's head at closing time and nowhere in the record, so a closure captured
// without one can never be re-derived into a category afterwards.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError, api, CLOSURE_MEANINGS, CLOSURES, type Closure, type ClosureRecord } from '../api.ts'

/** What a closure is *not*: closing never touches the branch or the artifacts. */
const KEEPS_THE_RECORD = 'The branch, the run directory, and every artifact stay exactly where they are — closing decides the run, it does not delete it.'

/** Stand-ins for the parts of a closure the record can be missing. Absence is
 *  stated rather than left blank, the way the provenance line already states an
 *  unrecorded closer: a silent gap reads as a UI that forgot. */
const NO_DISPOSITION = 'no disposition recorded'
const MALFORMED = 'The record says the run is closed but not why; that state is malformed.'
const NO_REASON = 'no reason recorded'

export interface ClosureRecordView {
  /** The disposition name, or the stand-in when the record carries none. */
  disposition: string
  /** The stock meaning of that disposition — a tooltip, never a line of its own. */
  gloss: string | null
  /** Said out loud only when there is no disposition to gloss. */
  malformed: string | null
  /** The operator's own words, byte-for-byte, or null when there are none. */
  reason: string | null
  /** Who closed it and when, in one line. */
  provenance: string
}

/** What the closure record states, resolved before any markup touches it (#298).
 *
 *  The split that matters is between vocabulary and record. The disposition name
 *  and its `CLOSURE_MEANINGS` gloss are vocabulary — the same four sentences on
 *  every closed run, and already on screen verbatim in the close form at the
 *  moment the choice is made. `reason` is the one line of human judgment in the
 *  whole record. Rendering them as adjacent unlabelled lines made them
 *  indistinguishable, so the gloss becomes a tooltip on the name it belongs to
 *  and the reason gets a label of its own. Nothing leaves the record; the gloss
 *  is still reachable on hover and to a screen reader.
 */
export function closureRecordView(closure: ClosureRecord | null): ClosureRecordView {
  const as = closure?.as ?? null
  const gloss = as !== null && as in CLOSURE_MEANINGS ? CLOSURE_MEANINGS[as as Closure] : null
  return {
    disposition: as ?? NO_DISPOSITION,
    gloss,
    malformed: gloss === null ? MALFORMED : null,
    // Trimmed to decide whether there is a reason at all; rendered untrimmed,
    // because the record's words are the record's words.
    reason: closure?.reason?.trim() ? closure.reason : null,
    provenance:
      (closure?.by ? `closed by ${closure.by}` : 'closed by someone unrecorded') + (closure?.at ? ` · ${closure.at}` : ''),
  }
}

export function ClosureRecordBlock({
  source,
  slug,
  closure,
}: {
  source: string
  slug: string
  closure: ClosureRecord | null
}) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: api.decide,
    onSuccess: () => {
      setConfirming(false)
      void queryClient.invalidateQueries()
    },
    onError: (e) => setFlash(e instanceof ApiError && e.status === 409 ? 'The run moved while you were deciding — re-read and try again.' : (e as Error).message),
  })

  const view = closureRecordView(closure)

  return (
    <div className="mb-6 border border-line bg-inset px-3.5 py-3" data-closure-record>
      <p className="text-[13px] font-semibold text-ink">
        Run closed —{' '}
        {view.gloss === null ? (
          view.disposition
        ) : (
          <span title={view.gloss} className="cursor-help underline decoration-dotted decoration-faint underline-offset-[3px]" data-closure-disposition>
            {view.disposition}
            <span className="sr-only"> — {view.gloss}</span>
          </span>
        )}
      </p>
      {view.malformed && <p className="mt-1 text-xs text-muted">{view.malformed}</p>}
      <dl className="mt-2 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[1.6]">
        <dt className="shrink-0 font-mono text-[10.5px] text-faint">
          Why <span aria-hidden="true">·</span>
        </dt>
        <dd className={`min-w-0 flex-1 ${view.reason === null ? 'text-faint' : 'text-ink'}`} data-closure-reason>
          {view.reason ?? NO_REASON}
        </dd>
      </dl>
      <p className="mt-2 font-mono text-[11.5px] text-faint">{view.provenance}</p>
      {flash && <p className="mt-2 text-xs font-semibold text-bad">{flash}</p>}
      <div className="mt-3">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Reopening returns the run to the phase its gate ledger derives, and the engine can dispatch it again.</span>
            <button
              type="button"
              onClick={() => mutation.mutate({ source, slug, action: 'reopen' })}
              disabled={mutation.isPending}
              data-decide="reopen-confirm"
              className="border border-accent bg-accent px-4 py-[7px] text-sm font-semibold text-on-solid hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {mutation.isPending ? 'Committing…' : `Reopen ${slug}`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink">
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            data-decide="reopen"
            className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink"
          >
            Reopen this run…
          </button>
        )}
      </div>
    </div>
  )
}

export function CloseRunPanel({ source, slug, phase }: { source: string; slug: string; phase: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [closure, setClosure] = useState<Closure | null>(null)
  const [reason, setReason] = useState('')
  const [flash, setFlash] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: api.decide,
    onSuccess: () => {
      setOpen(false)
      setClosure(null)
      setReason('')
      void queryClient.invalidateQueries()
    },
    onError: (e) => setFlash(e instanceof ApiError && e.status === 409 ? 'The run moved while you were deciding — re-read and decide again.' : (e as Error).message),
  })

  // A finished run is already its own record, and a closed one has this panel's
  // counterpart instead. Neither offers the affordance at all, rather than
  // offering a disabled one: a control you cannot use still reads as a control.
  if (phase === 'done' || phase === 'closed') return null

  const submit = () => {
    if (!closure || !reason.trim()) return
    mutation.mutate({ source, slug, action: 'close', closure, notes: reason.trim() })
  }

  if (!open) {
    return (
      <div className="mt-7 flex items-center justify-end" data-close-run>
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-decide="close"
          className="text-xs font-semibold text-muted underline underline-offset-2 hover:text-bad"
        >
          Close this run…
        </button>
      </div>
    )
  }

  return (
    <div className="mt-7 border border-line bg-inset px-3.5 py-3" data-close-run>
      <p className="text-[13px] font-semibold text-ink">Close {slug}</p>
      <p className="mt-1 text-xs leading-[1.6] text-muted">
        The run stops here and leaves the inbox. {KEEPS_THE_RECORD}
      </p>
      {flash && <p className="mt-2 text-xs font-semibold text-bad">{flash}</p>}

      <fieldset className="mt-3">
        <legend className="mb-[9px] font-mono text-[10.5px] font-semibold text-muted">
          Why does it end here? (recorded with the closure)
        </legend>
        <div className="flex flex-col gap-2">
          {CLOSURES.map((o) => (
            <label
              key={o}
              className={`flex cursor-pointer items-baseline gap-2 border px-3 py-2 text-sm ${
                closure === o ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line bg-surface hover:border-accent'
              }`}
            >
              <input type="radio" name={`closure-${slug}`} className="sr-only" checked={closure === o} onChange={() => setClosure(o)} />
              <span>
                {o}
                <span className="ml-1.5 text-xs font-normal text-muted">{CLOSURE_MEANINGS[o]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why? This is the comment on the disposition, and the only account of why the run ends here — required."
        rows={2}
        className="mt-3 w-full resize-y border border-line bg-surface px-[11px] py-[9px] text-sm placeholder:text-faint"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!closure || !reason.trim() || mutation.isPending}
          data-decide="close-confirm"
          className="border border-bad bg-bad px-4 py-[7px] text-sm font-semibold text-on-solid hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? 'Committing…' : closure ? `Close as ${closure}` : 'Close run'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="border border-line bg-surface px-4 py-[7px] text-sm font-semibold text-muted hover:border-accent hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
