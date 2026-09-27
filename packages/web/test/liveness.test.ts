// Liveness by mode (#499; docs/MULTI-REPO.md §9.5), computed. The table,
// row by row, with literal inputs and expected values; the drift rule; and
// the words for a deferral's limit.
import { describe, expect, it } from 'vitest'
import type { EngineHealthEntry } from '../src/api.ts'
import { DEFERRAL_LIMIT_WORDS, driftOf, livenessOf, sharedStanding } from '../src/liveness.ts'

const entry = (over: Partial<EngineHealthEntry> = {}): EngineHealthEntry => ({ at: '2026-09-27T10:00:00Z', inFlight: 0, pushRejections: {}, stale: false, ...over })
const FRESH = entry()
const STALE = entry({ stale: true })
const ABSENT = null

describe('livenessOf, the table in §9.5', () => {
  it('dispatch, fresh: live — nothing is shown', () => expect(livenessOf('dispatch', FRESH)).toBe('live'))
  it('dispatch, stale: silent — the outage banner', () => expect(livenessOf('dispatch', STALE)).toBe('silent'))
  it('dispatch, absent: silent — the outage banner', () => expect(livenessOf('dispatch', ABSENT)).toBe('silent'))
  it('view or decide, absent: none — "No engine in this deployment"', () => {
    expect(livenessOf('view', ABSENT)).toBe('none')
    expect(livenessOf('decide', ABSENT)).toBe('none')
  })
  it('view or decide, fresh: outside — "An engine outside this deployment"', () => {
    expect(livenessOf('view', FRESH)).toBe('outside')
    expect(livenessOf('decide', FRESH)).toBe('outside')
  })
  it('view or decide, stale: none, and no banner', () => {
    expect(livenessOf('view', STALE)).toBe('none')
    expect(livenessOf('decide', STALE)).toBe('none')
  })
  it('a server that did not look (a driver with no local engine) reads as absent', () => {
    expect(livenessOf('dispatch', undefined)).toBe('silent')
    expect(livenessOf('decide', undefined)).toBe('none')
  })
  it('no mode stated keeps the rule from before modes: only a stale heartbeat is an outage', () => {
    expect(livenessOf(null, STALE)).toBe('silent')
    expect(livenessOf(null, FRESH)).toBe('unknown')
    expect(livenessOf(null, ABSENT)).toBe('unknown')
  })
})

describe('sharedStanding: a fact every repository shares is said once', () => {
  it('returns the pair when every readable repository has one mode and one engine state', () => {
    expect(sharedStanding([{ mode: 'decide', entry: null }, { mode: 'decide', entry: STALE }])).toEqual({ mode: 'decide', liveness: 'none' })
    expect(sharedStanding([{ mode: 'dispatch', entry: FRESH }, { mode: 'dispatch', entry: entry({ at: '2026-09-27T09:00:00Z' }) }])).toEqual({ mode: 'dispatch', liveness: 'live' })
  })
  it('is null when modes or states differ, or any engine is outside', () => {
    expect(sharedStanding([{ mode: 'decide', entry: null }, { mode: 'view', entry: null }])).toBeNull()
    expect(sharedStanding([{ mode: 'dispatch', entry: FRESH }, { mode: 'dispatch', entry: null }])).toBeNull()
    expect(sharedStanding([{ mode: 'decide', entry: FRESH }, { mode: 'decide', entry: FRESH }])).toBeNull()
  })
  it('leaves unreadable repositories out, and is null when none is left', () => {
    expect(sharedStanding([{ mode: 'decide', entry: null }, { mode: 'view', unreadable: 'gone', entry: null }])).toEqual({ mode: 'decide', liveness: 'none' })
    expect(sharedStanding([{ unreadable: 'gone', entry: null }])).toBeNull()
  })
})

describe('driftOf: the code checkout, once', () => {
  it('is null when no heartbeat reports drift', () => {
    expect(driftOf({ a: entry({ commit: 'x', codeHead: 'x' }), b: null })).toBeNull()
  })

  it('takes the newest heartbeat among those reporting drift, so two engines are one fact', () => {
    const older = entry({ at: '2026-09-27T10:00:00Z', commit: 'aaaaaaa', codeHead: 'bbbbbbb' })
    const newer = entry({ at: '2026-09-27T10:05:00Z', commit: 'aaaaaaa', codeHead: 'ccccccc' })
    const quiet = entry({ at: '2026-09-27T10:09:00Z', commit: 'ccccccc', codeHead: 'ccccccc' })
    expect(driftOf({ 'local/demo': older, 'local/website': newer, 'local/billing': quiet })).toBe(newer)
  })

  it('counts a paused monitor as drift', () => {
    const paused = entry({ codeState: 'paused', codeReason: 'dirty' })
    expect(driftOf({ a: paused })).toBe(paused)
  })
})

describe('the words for a deferral’s limit', () => {
  it('names each governor limit, and has no words for one it does not know', () => {
    expect(DEFERRAL_LIMIT_WORDS).toEqual({
      concurrency: 'the concurrency cap',
      turn: 'another repository’s turn for a slot',
      spend: 'the machine’s spend window',
      'repository-spend': 'the repository’s own spend ceiling',
    })
    expect(Object.hasOwn(DEFERRAL_LIMIT_WORDS, 'constructor')).toBe(false)
  })
})
