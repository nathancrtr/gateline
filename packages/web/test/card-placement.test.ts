// Where a lexicon card opens (#311): inward, never past the pane that clips it.
import { describe, expect, it } from 'vitest'
import { cardPlacement, CARD_WIDTH } from '../src/components/lexicon.tsx'

const pane = { left: 216, right: 776 } // the Record reader at an 800px viewport

describe('cardPlacement', () => {
  it('a reference with room to its right opens where it always did', () => {
    expect(cardPlacement(230, pane)).toEqual({ left: 0, maxWidth: CARD_WIDTH })
  })

  it('a reference near the right edge opens leftward, exactly as far as the pane requires', () => {
    // The measured case from the issue: card at x=468 would reach 884 against a pane ending at 776.
    const { left, maxWidth } = cardPlacement(468, pane)
    expect(maxWidth).toBe(CARD_WIDTH)
    expect(468 + left + maxWidth).toBe(pane.right - 8)
    expect(left).toBeLessThan(0)
  })

  it('a reference hard against the left edge is nudged in by the gutter', () => {
    expect(cardPlacement(pane.left, pane).left).toBe(8)
  })

  it('a pane narrower than the card narrows the card instead of clipping it', () => {
    const narrow = { left: 0, right: 300 }
    const { left, maxWidth } = cardPlacement(250, narrow)
    expect(maxWidth).toBe(300 - 16)
    expect(250 + left).toBe(8)
  })
})
