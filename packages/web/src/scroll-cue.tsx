import { useEffect, useState, type RefObject } from 'react'

/** Which edges of a horizontally scrollable pane have content beyond them. */
export interface ScrollCue {
  left: boolean
  right: boolean
}

/**
 * Whether a clipped pane should announce itself, and on which edge (#297).
 *
 * The overflow containment is right — it never escapes to the page body —
 * but a scroll the user cannot see is a scroll the user will not perform, and
 * the platform scrollbar stays hidden until they interact. One pixel of slack
 * absorbs sub-pixel layout so a pane that exactly fits does not claim to be
 * cut off.
 */
export function scrollCue(pane: { scrollLeft: number; scrollWidth: number; clientWidth: number }): ScrollCue {
  const slack = 1
  return {
    left: pane.scrollLeft > slack,
    right: pane.scrollWidth - pane.clientWidth - pane.scrollLeft > slack,
  }
}

/**
 * The cue, measured live off a pane: on scroll, and on any change to the
 * pane's or its content's size (a column appearing, a longer label, a
 * different artifact — each moves the boundary), never only on scroll. First
 * written for the portfolio table (#297); the Record reader shares it (#312).
 */
export function useScrollCue(ref: RefObject<HTMLElement | null>, deps: readonly unknown[] = []): ScrollCue {
  const [cue, setCue] = useState<ScrollCue>({ left: false, right: false })
  useEffect(() => {
    const pane = ref.current
    if (!pane) return
    const measure = () => {
      const next = scrollCue(pane)
      setCue((prev) => (prev.left === next.left && prev.right === next.right ? prev : next))
    }
    measure()
    pane.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    ro?.observe(pane)
    // The pane's own box does not change when its content overflows, so the
    // content is observed too — and re-observed when it is replaced, which is
    // how an artifact body arrives: fetched after the pane mounts, swapped in
    // for the loading skeleton the first observation saw.
    let content: Element | null = null
    const watchContent = () => {
      const next = pane.firstElementChild
      if (next === content) return
      if (content) ro?.unobserve(content)
      content = next
      if (content) ro?.observe(content)
      measure()
    }
    watchContent()
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watchContent)
    mo?.observe(pane, { childList: true, subtree: true })
    return () => {
      pane.removeEventListener('scroll', measure)
      ro?.disconnect()
      mo?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
  return cue
}

/**
 * The fade on a clipped edge. An overlay above the pane's content rather than
 * a background gradient, so a tinted block inside — a malformed run's row, a
 * code or evidence pane — cannot paint over it.
 */
export function EdgeFade({ edge, radius }: { edge: 'left' | 'right'; radius?: string }) {
  const dark = 'rgba(36, 32, 28, 0.13)'
  return (
    <div
      aria-hidden="true"
      data-scroll-cue={edge}
      className={`pointer-events-none absolute inset-y-px ${edge === 'left' ? 'left-px w-[30px]' : 'right-px w-[38px]'} ${radius ?? ''}`}
      style={{ background: `linear-gradient(to ${edge === 'left' ? 'right' : 'left'}, ${dark}, rgba(36, 32, 28, 0))` }}
    />
  )
}
