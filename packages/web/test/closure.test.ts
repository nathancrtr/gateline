// What the closure record says (#200, #298). The block prints two things that
// look alike and are not: the stock meaning of the disposition, which is the
// same sentence on every run closed that way, and the operator's reason, which
// is the only line of human judgment in the record. What is under test is that
// the two never resolve into the same slot, and that a record missing either
// one says so instead of going blank.
import { describe, expect, it } from 'vitest'
import { CLOSURES, CLOSURE_MEANINGS, type Closure, type ClosureRecord } from '../src/api.ts'
import { closureRecordView } from '../src/components/close-run.tsx'

const record = (over: Partial<ClosureRecord> = {}): ClosureRecord =>
  ({
    as: 'already-delivered',
    by: 'operator',
    at: '2026-06-29T11:00:00Z',
    reason: 'The work landed by another path; this record closes to match reality.',
    ...over,
  }) as ClosureRecord

describe('the disposition carries its own gloss', () => {
  it.each(CLOSURES)('%s resolves to its name and the stock meaning, kept apart', (as: Closure) => {
    const view = closureRecordView(record({ as }))
    expect(view.disposition).toBe(as)
    expect(view.gloss).toBe(CLOSURE_MEANINGS[as])
    expect(view.malformed).toBeNull()
  })

  it('the gloss is vocabulary, not the record — it never lands in the reason slot', () => {
    const view = closureRecordView(record({ reason: null }))
    expect(view.gloss).toBe(CLOSURE_MEANINGS['already-delivered'])
    expect(view.reason).toBeNull()
  })

  // The fixture where the defect was visible: two near-identical sentences, one
  // above the other, nothing saying which was which. They are still both here —
  // nothing left the record — but they are now separate fields.
  it('a reason that echoes the gloss is still a distinct field', () => {
    const view = closureRecordView(record())
    expect(view.reason).toBe('The work landed by another path; this record closes to match reality.')
    expect(view.reason).not.toBe(view.gloss)
  })
})

describe('the operator’s reason is quoted, never paraphrased', () => {
  it('is byte-identical to the record, whitespace and all', () => {
    const reason = '  superseded by the #293 rewrite after the customer withdrew the request  '
    expect(closureRecordView(record({ reason })).reason).toBe(reason)
  })

  it.each([null, '', '   ', '\n'])('an empty reason (%j) is absence, not an empty line', (reason) => {
    expect(closureRecordView(record({ reason })).reason).toBeNull()
  })
})

describe('a closure the record cannot account for says so', () => {
  it('no closure at all: the malformed sentence is spoken, not glossed away', () => {
    const view = closureRecordView(null)
    expect(view.disposition).toBe('no disposition recorded')
    expect(view.gloss).toBeNull()
    expect(view.malformed).toBe('The record says the run is closed but not why; that state is malformed.')
    expect(view.reason).toBeNull()
    expect(view.provenance).toBe('closed by someone unrecorded')
  })

  it('a disposition outside the vocabulary gets no invented meaning', () => {
    const view = closureRecordView(record({ as: 'reorganised' as Closure }))
    expect(view.disposition).toBe('reorganised')
    expect(view.gloss).toBeNull()
    expect(view.malformed).not.toBeNull()
  })
})

describe('provenance', () => {
  it('names the closer and the moment', () => {
    expect(closureRecordView(record()).provenance).toBe('closed by operator · 2026-06-29T11:00:00Z')
  })

  it('drops the timestamp rather than printing an empty one', () => {
    expect(closureRecordView(record({ at: null })).provenance).toBe('closed by operator')
  })

  it('an unrecorded closer is stated', () => {
    expect(closureRecordView(record({ by: null })).provenance).toBe('closed by someone unrecorded · 2026-06-29T11:00:00Z')
  })
})
