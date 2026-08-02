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
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, CLOSURES, CLOSURE_MEANINGS, type Closure, type ClosureRecord } from '../api.ts'

/** What a closure is *not*: closing never touches the branch or the artifacts. */
const KEEPS_THE_RECORD = 'The branch, the run directory, and every artifact stay exactly where they are — closing decides the run, it does not delete it.'

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

  return (
    <div className="mb-6 rounded-md border border-line bg-inset px-3.5 py-3" data-closure-record>
      <p className="text-[13px] font-semibold text-ink">
        Run closed — {closure?.as ?? 'no disposition recorded'}
      </p>
      <p className="mt-1 text-xs text-muted">
        {closure?.as ? CLOSURE_MEANINGS[closure.as as Closure] : 'The record says the run is closed but not why; that state is malformed.'}
      </p>
      {closure?.reason && <p className="mt-2 text-[13px] leading-[1.6] text-ink">{closure.reason}</p>}
      <p className="mt-2 font-mono text-[11.5px] text-faint">
        {closure?.by ? `closed by ${closure.by}` : 'closed by someone unrecorded'}
        {closure?.at ? ` · ${closure.at}` : ''}
      </p>
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
              className="rounded-full border border-accent bg-accent px-4 py-[7px] text-sm font-semibold text-on-solid transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
    <div className="mt-7 rounded-md border border-line bg-inset px-3.5 py-3" data-close-run>
      <p className="text-[13px] font-semibold text-ink">Close {slug}</p>
      <p className="mt-1 text-xs leading-[1.6] text-muted">
        The run stops here and leaves the inbox. {KEEPS_THE_RECORD}
      </p>
      {flash && <p className="mt-2 text-xs font-semibold text-bad">{flash}</p>}

      <fieldset className="mt-3">
        <legend className="mb-[9px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
          Why does it end here? (recorded with the closure)
        </legend>
        <div className="flex flex-col gap-2">
          {CLOSURES.map((o) => (
            <label
              key={o}
              className={`flex cursor-pointer items-baseline gap-2 rounded-[5px] border px-3 py-2 text-sm transition-colors ${
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
        className="mt-3 w-full resize-y rounded-[5px] border border-line bg-surface px-[11px] py-[9px] text-sm placeholder:text-faint"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!closure || !reason.trim() || mutation.isPending}
          data-decide="close-confirm"
          className="rounded-full border border-bad bg-bad px-4 py-[7px] text-sm font-semibold text-on-solid transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mutation.isPending ? 'Committing…' : closure ? `Close as ${closure}` : 'Close run'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-line bg-surface px-4 py-[7px] text-sm font-semibold text-muted transition-all hover:border-accent hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
