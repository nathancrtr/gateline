import { describe, expect, it } from 'vitest'
import { navEntryClass, RECORD_ENTRY_SHAPE } from '../src/pages/run.tsx'

// The Record picker's two shapes (#281). Below `lg` the rail becomes a wrapping
// strip above a full-width reader, and the artifact entries and the diff entry
// now share one class builder. The invariant worth pinning is that selection
// changes the mark and the tint and never the shape — the two entries were
// hand-copied literals before, which is how a narrow shape added to one would
// have missed the other.
describe('navEntryClass', () => {
  it('gives the selected and unselected entries the same shape', () => {
    expect(navEntryClass(true)).toContain(RECORD_ENTRY_SHAPE)
    expect(navEntryClass(false)).toContain(RECORD_ENTRY_SHAPE)
  })

  it('carries a narrow shape, so the picker is not stuck in the desktop rail', () => {
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:w-auto')
  })

  it('moves the selected mark from the left edge to the bottom edge in the strip', () => {
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:border-l-0')
    expect(RECORD_ENTRY_SHAPE).toContain('max-lg:border-b-2')
    expect(navEntryClass(true)).toContain('border-b-accent')
    expect(navEntryClass(false)).toContain('border-b-transparent')
  })
})
