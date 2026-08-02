// The portfolio's left-edge mark and its scroll cue (#297). Both decisions
// used to be implicit in JSX, where the one thing that could go wrong went
// wrong: the mark the page exists for sat in the last column of a table that
// is wider than its wrapper below 1000px, and the clipping was silent. What is
// under test is the precedence between the two kinds of "calls for you", and
// the arithmetic that decides whether a pane admits it is cut off.
import { describe, expect, it } from 'vitest'
import { needsYouMark, scrollCue } from '../src/pages/portfolio.tsx'

const run = (needsHuman: number, escalationsOpen: number) => ({ needsHuman, escalationsOpen })

describe('needsYouMark', () => {
  it('reads a run with readiness items as needing you, and counts them', () => {
    expect(needsYouMark(run(3, 0))).toEqual({ kind: 'needs', count: 3, label: '3 items need you' })
  })

  it('singularizes one item', () => {
    expect(needsYouMark(run(1, 0))).toEqual({ kind: 'needs', count: 1, label: '1 item needs you' })
  })

  it('keeps readiness ahead of escalations — an escalation that is already someone’s move is counted once', () => {
    expect(needsYouMark(run(2, 1)).kind).toBe('needs')
    expect(needsYouMark(run(2, 1)).count).toBe(2)
  })

  it('falls back to open escalations when nothing is ready for a decision', () => {
    expect(needsYouMark(run(0, 1))).toEqual({ kind: 'escalation', count: 1, label: '1 open escalation' })
    expect(needsYouMark(run(0, 2))).toEqual({ kind: 'escalation', count: 2, label: '2 open escalations' })
  })

  it('is quiet when the run asks nothing of you', () => {
    expect(needsYouMark(run(0, 0))).toEqual({ kind: 'quiet', count: 0, label: 'nothing needs you' })
  })
})

describe('scrollCue', () => {
  it('says nothing when the table fits its pane', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 744, clientWidth: 744 })).toEqual({ left: false, right: false })
  })

  // The measurement from the issue: a 1043px table in a 758px wrapper at a
  // 1000px viewport. Unscrolled, the cue must appear on the right before the
  // user touches anything — that is the whole defect.
  it('cues the right edge before any interaction when the table overflows', () => {
    expect(scrollCue({ scrollLeft: 0, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: false, right: true })
  })

  it('cues both edges mid-scroll', () => {
    expect(scrollCue({ scrollLeft: 120, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: true, right: true })
  })

  it('drops the right cue at the end of the scroll', () => {
    expect(scrollCue({ scrollLeft: 299, scrollWidth: 1043, clientWidth: 744 })).toEqual({ left: true, right: false })
  })

  it('tolerates a sub-pixel overhang rather than claiming a cut-off table', () => {
    expect(scrollCue({ scrollLeft: 0.5, scrollWidth: 744.6, clientWidth: 744 })).toEqual({ left: false, right: false })
  })
})
