// The decision affordances (plan §4). Approve captures burden in the act of
// deciding; decline requires a reason; escalations take a disposition note;
// paused runs resume. A CAS conflict (409) re-presents rather than retrying —
// the refusal is the designed outcome.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, api, type Burden, type GateId, type InboxItem } from '../api.ts'
import { useKeys } from '../use-keys.ts'

const BURDEN_OPTIONS: { value: Burden; key: string; label: string; hint: string }[] = [
  { value: 'confirmation', key: '1', label: 'Confirmation', hint: 'looked right as delivered' },
  { value: 'light-correction', key: '2', label: 'Light correction', hint: 'approved, notes attached' },
  { value: 'heavy-correction', key: '3', label: 'Heavy correction', hint: 'took real work to accept' },
]

type Mode = 'idle' | 'approve' | 'decline' | 'resolve'

export function DecidePanel({ item, primary = false }: { item: InboxItem; primary?: boolean }) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<Mode>('idle')
  const [burden, setBurden] = useState<Burden | null>(null)
  const [notes, setNotes] = useState('')
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

  const submitApprove = () => {
    if (!burden || !gate) return
    mutation.mutate({ ...base, action: 'approve', gate, burden, notes: notes.trim() || undefined })
  }
  const submitDecline = () => {
    if (!gate || !notes.trim()) return
    mutation.mutate({ ...base, action: 'decline', gate, notes: notes.trim() })
  }
  const submitResolve = () => {
    if (item.escalationIndex === null || !notes.trim()) return
    mutation.mutate({ ...base, action: 'resolve-escalation', escalationIndex: item.escalationIndex, notes: notes.trim() })
  }
  const submitResume = () => mutation.mutate({ ...base, action: 'resume' })

  if (flash?.kind === 'ok') return <Flash kind="ok" text={flash.text} />

  return (
    <div className="mt-3.5 border-t border-line pt-3.5" data-decide-panel>
      {flash && <Flash kind={flash.kind} text={flash.text} />}

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
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
          {item.kind === 'gate' && !item.reviewable && (
            <p className="text-[12.5px] font-semibold text-bad">Bounced — fix the artifacts (or the contract) and the card returns; no approval is offered for a malformed packet.</p>
          )}
          {item.kind === 'escalation' && (
            <Button primary onClick={() => setMode('resolve')} data-decide="resolve">
              Resolve…
            </Button>
          )}
          {item.kind === 'paused' && (
            <Button primary onClick={submitResume} disabled={mutation.isPending} data-decide="resume">
              {mutation.isPending ? 'Resuming…' : 'Resume run'}
            </Button>
          )}
          {item.kind === 'round-cap' && (
            <p className="text-xs text-muted">
              Read both sides, then unblock: decline the pending gate with direction, or edit the spec/plan and let the loop retry.
            </p>
          )}
        </div>
      )}

      {mode === 'approve' && (
        <div className="flex flex-col gap-3">
          <fieldset>
            <legend className="mb-[9px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">How much work was this review? (recorded with the approval)</legend>
            <div className="flex flex-wrap gap-2">
              {BURDEN_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer items-baseline gap-2 rounded-[5px] border px-3 py-2 text-sm transition-colors ${
                    burden === o.value ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line bg-inset hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name={`burden-${item.slug}-${gate}`}
                    className="sr-only"
                    checked={burden === o.value}
                    onChange={() => setBurden(o.value)}
                  />
                  <span className={`font-mono text-[11px] ${burden === o.value ? 'text-accent' : 'text-faint'}`}>{o.key}</span>
                  <span>
                    {o.label}
                    <span className="ml-1.5 text-xs font-normal text-muted">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <NotesField value={notes} onChange={setNotes} placeholder="Notes (optional) — recorded in the gate entry" />
          <div className="flex gap-2">
            <Button primary onClick={submitApprove} disabled={!burden || mutation.isPending} data-decide="approve-confirm">
              {mutation.isPending ? 'Committing…' : `Approve ${gate}`}
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
            placeholder="Why? Specific notes are the correction channel back to the producing role — required."
          />
          <div className="flex gap-2">
            <Button danger onClick={submitDecline} disabled={!notes.trim() || mutation.isPending} data-decide="decline-confirm">
              {mutation.isPending ? 'Committing…' : `Decline ${gate} and pause the run`}
            </Button>
            <Button onClick={() => setMode('idle')}>Cancel</Button>
          </div>
        </div>
      )}

      {mode === 'resolve' && (
        <div className="flex flex-col gap-3">
          <NotesField value={notes} onChange={setNotes} autoFocus placeholder="Disposition — what unblocks the run, recorded on the escalation. Required." />
          <div className="flex gap-2">
            <Button primary onClick={submitResolve} disabled={!notes.trim() || mutation.isPending} data-decide="resolve-confirm">
              {mutation.isPending ? 'Committing…' : 'Resolve escalation'}
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
  const tone = primary
    ? 'border-accent bg-accent text-on-solid shadow-[0_0_12px_var(--glow)] hover:opacity-90'
    : danger
      ? 'border-bad bg-bad text-on-solid hover:opacity-90'
      : 'border-line bg-inset text-muted hover:text-ink hover:border-accent'
  return (
    <button
      {...props}
      className={`rounded-full border px-4 py-[7px] text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    />
  )
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
      autoFocus={autoFocus}
      rows={2}
      className="w-full resize-y rounded-[5px] border border-line bg-inset px-[11px] py-[9px] text-sm placeholder:text-faint"
    />
  )
}

function Flash({ kind, text }: { kind: 'ok' | 'conflict' | 'error'; text: string }) {
  const tone = kind === 'ok' ? 'bg-ok-soft text-ok' : kind === 'conflict' ? 'bg-warn-soft text-warn' : 'bg-bad-soft text-bad'
  return (
    <p className={`mb-2 rounded-[5px] px-3 py-2 text-xs font-semibold ${tone}`} role="status">
      {text}
    </p>
  )
}
