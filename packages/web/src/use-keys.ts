// Keyboard model (plan §4): the whole gate loop without the pointer.
//   inbox: j/k move · enter open
//   run:   a approve · x decline · 1/2/3 burden · e next artifact · esc back
// Keys never fire while typing in an input/textarea.
import { useEffect } from 'react'

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
