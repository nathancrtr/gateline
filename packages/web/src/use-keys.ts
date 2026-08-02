// Keyboard model (plan §4): the whole gate loop without the pointer.
//   inbox: j/k move · enter open
//   run:   a approve · x decline · 1/2/3 burden · e next artifact · esc back
// Keys never fire while typing in an input/textarea.
import { useEffect } from 'react'

/**
 * One advertised key: what to press, and what it does (#284).
 *
 * The loop above shipped complete and unmentioned — no pixel of the UI named a
 * single shortcut, which for the operator audience is the best feature nobody
 * finds. It is advertised now, and the rule that keeps the advertisement honest
 * is that a hint list is written beside the `useKeys` call it describes, never
 * in a registry of its own: `inbox.tsx` owns `j/k/enter`, `run.tsx` owns
 * `e/esc`, `decide.tsx` owns `a/x/1-2-3`. A key that moves house takes its hint
 * with it because they are the same edit.
 *
 * `chips.tsx` renders these — quiet mono, the register of "The repo is the
 * database." — and the run page's decide keys are hinted only while the card is
 * idle, because inside a form the same keys are literal characters.
 */
export type KeyHint = readonly [key: string, verb: string]

export function useKeys(handlers: Record<string, (e: KeyboardEvent) => void>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key !== 'Escape') return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const handler = handlers[e.key]
      if (handler) {
        e.preventDefault()
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handlers, enabled])
}
