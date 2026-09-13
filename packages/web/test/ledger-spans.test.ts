// Folding the decision ledger's engine spans (#283). What is under test is
// what could quietly become a verdict or lose a row: which rows fold, what the
// summary counts, and that nothing below the threshold changes shape.

import { parseLedgerSubject } from '@gateline/core/view-model'
import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../src/api.ts'
import { collapseEngineSpans, SPAN_MIN_ROWS } from '../src/ledger-spans.ts'

let n = 0
const row = (subject: string, phase: string | null = 'implement'): HistoryEntry => ({
  oid: `oid${n++}`,
  time: 1_700_000_000 - n,
  author: 'x',
  subject,
  phase,
  ledger: parseLedgerSubject(subject),
})
const human = (rest: string, phase?: string | null) => row(`state(toy): ${rest}`, phase)
const engine = (rest: string, phase?: string | null) => row(`state(toy): ${rest}`, phase)

describe('collapseEngineSpans', () => {
  it('folds a long engine span between two decisions into one summary, and keeps both decisions as rows', () => {
    const history = [
      human('G2 approved by operator [burden: confirmation]', 'integrate'),
      engine('metered verifier $4.09'),
      engine('dispatched verifier'),
      engine('advanced — 06-e2e rounds → 1'),
      engine('metered reviewer(06-e2e r1) $3.72'),
      engine('dispatched reviewer(06-e2e r1)'),
      engine('metered implementer(06-e2e r1) $6.25'),
      engine('dispatched implementer(06-e2e r1)'),
      human('G1 approved by operator [burden: confirmation]', 'plan'),
    ]
    const rows = collapseEngineSpans(history)
    expect(rows.map((r) => r.kind)).toEqual(['row', 'span', 'row'])
    const span = rows[1]!
    expect(span).toMatchObject({ kind: 'span', from: 1, to: 7, count: 7, meteredUsd: 14.06 })
    if (span.kind !== 'span') throw new Error('unreachable')
    expect(span.verbs).toEqual([
      ['metered', 3],
      ['dispatched', 3],
      ['advanced', 1],
    ])
  })

  it('leaves a span below the threshold as its rows, so short fixture histories are unchanged', () => {
    const history = [human('G2 approved by operator'), ...Array.from({ length: SPAN_MIN_ROWS - 1 }, () => engine('dispatched reviewer')), human('G1 approved by operator')]
    const rows = collapseEngineSpans(history)
    expect(rows.every((r) => r.kind === 'row')).toBe(true)
    expect(rows.map((r) => (r.kind === 'row' ? r.index : -1))).toEqual(history.map((_, i) => i))
  })

  it('folds at the threshold exactly, and a span at either end of the history folds too', () => {
    const history = [...Array.from({ length: SPAN_MIN_ROWS }, () => engine('dispatched reviewer')), human('armed by operator')]
    const rows = collapseEngineSpans(history)
    expect(rows.map((r) => r.kind)).toEqual(['span', 'row'])
    expect(rows[0]).toMatchObject({ from: 0, to: SPAN_MIN_ROWS - 1, meteredUsd: null })
  })

  it('a row that does not parse breaks a span rather than being swallowed into it', () => {
    const history = [
      ...Array.from({ length: SPAN_MIN_ROWS }, () => engine('dispatched reviewer')),
      row('manual recovery of state.yaml'),
      ...Array.from({ length: SPAN_MIN_ROWS }, () => engine('metered reviewer $1.00')),
    ]
    const rows = collapseEngineSpans(history)
    expect(rows.map((r) => r.kind)).toEqual(['span', 'row', 'span'])
    expect(rows[2]).toMatchObject({ meteredUsd: SPAN_MIN_ROWS })
  })

  it('names the phases the run entered inside the span, newest first, by the row renderer\'s own rule', () => {
    const history = [
      human('G2 approved by operator', 'integrate'),
      engine('advanced — 01 → review-approved', 'implement'),
      engine('metered reviewer $1.00', 'implement'),
      engine('dispatched reviewer', 'implement'),
      engine('advanced — seeded tasks', 'implement'),
      engine('advanced — plan landed', 'plan'),
      engine('dispatched architect', 'plan'),
      human('G0 approved by operator', 'spec'),
    ]
    const rows = collapseEngineSpans(history)
    expect(rows[1]).toMatchObject({ kind: 'span', entered: ['implement', 'plan'] })
  })
})
