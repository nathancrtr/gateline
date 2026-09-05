// The budget ledger's parser, which moved out of the orchestrator into
// core/record when Gatehouse started reading the same open entries (#159).
// `ledger.test.ts` is a different ledger entirely — commit subjects — which is
// why the type here is `BudgetLedgerEntry`.
import { describe, expect, it } from 'vitest'
import { isOpenDispatch, parseLedger, ROLE_TIMEOUT_MS } from '../src/record/ledger.ts'
import type { RunState } from '../src/record/schema.ts'

/** Only `budget` is read, so the rest of the state can stay a stub. */
const withLedger = (ledger: unknown): RunState =>
  ({ budget: { cost_limit_usd: 25, cost_spent_usd: 0, ledger } }) as unknown as RunState

describe('parseLedger', () => {
  it('reads a full entry as written', () => {
    const state = withLedger([
      {
        at: '2026-07-22T10:00:00Z',
        role: 'analyst',
        task: '01-core',
        round: 2,
        adapter: 'claude-code',
        model: 'a-model',
        tokens_in: 1200,
        tokens_out: 900,
        cost_usd: 0.42,
        failed: false,
        engine: 'workstation:4242',
      },
    ])
    expect(parseLedger(state)).toEqual([
      {
        at: '2026-07-22T10:00:00Z',
        role: 'analyst',
        task: '01-core',
        round: 2,
        adapter: 'claude-code',
        model: 'a-model',
        tokens_in: 1200,
        tokens_out: 900,
        cost_usd: 0.42,
        failed: false,
        refused: false,
        engine: 'workstation:4242',
      },
    ])
  })

  // #349: the stale sweep reads this to tell a crashed engine's orphan from
  // another engine's live job. An entry from before the key existed — or one a
  // human typed — has to parse to null rather than to a name nobody wrote, or
  // the sweep would wait out a role timeout for an engine that never existed.
  it('reads a missing or non-string engine name as null', () => {
    expect(parseLedger(withLedger([{ role: 'ops' }]))[0]!.engine).toBeNull()
    expect(parseLedger(withLedger([{ role: 'ops', engine: '' }]))[0]!.engine).toBeNull()
    expect(parseLedger(withLedger([{ role: 'ops', engine: 4242 }]))[0]!.engine).toBeNull()
  })

  it('degrades a wrong-typed field to null rather than throwing', () => {
    // The ledger rides in budget's passthrough fields, so a hand-edited entry
    // must lose one field, not the whole run.
    const [e] = parseLedger(withLedger([{ role: 'ops', at: 7, round: 'two', cost_usd: 'free' }]))
    expect(e).toMatchObject({ role: 'ops', at: null, round: null, cost_usd: null, failed: false })
  })

  it('reads a YAML timestamp that parsed as a Date', () => {
    const [e] = parseLedger(withLedger([{ role: 'ops', at: new Date('2026-07-22T10:00:00Z') }]))
    expect(e!.at).toBe('2026-07-22T10:00:00.000Z')
  })

  it('skips entries with no role, and non-objects', () => {
    expect(parseLedger(withLedger([{ cost_usd: 1 }, 'nope', null, { role: 'ops' }])).map((e) => e.role)).toEqual(['ops'])
  })

  it('is empty for a null state, an absent ledger, and a ledger that is not a list', () => {
    expect(parseLedger(null)).toEqual([])
    expect(parseLedger({} as RunState)).toEqual([])
    expect(parseLedger(withLedger(undefined))).toEqual([])
    expect(parseLedger(withLedger('[]'))).toEqual([])
  })
})

describe('isOpenDispatch', () => {
  const e = (over: Record<string, unknown>) => parseLedger(withLedger([{ role: 'analyst', ...over }]))[0]!

  it('is open with no cost and no failure — an agent believed to be running', () => {
    expect(isOpenDispatch(e({}))).toBe(true)
  })

  it('is closed once a cost lands, including a zero one', () => {
    expect(isOpenDispatch(e({ cost_usd: 0.42 }))).toBe(false)
    expect(isOpenDispatch(e({ cost_usd: 0 }))).toBe(false)
  })

  it('is closed when the dispatch is marked failed', () => {
    expect(isOpenDispatch(e({ failed: true }))).toBe(false)
  })
})

describe('ROLE_TIMEOUT_MS', () => {
  it('is the engine’s own role timeout, so a reader cannot outlive the killer (#159)', () => {
    // The engine's DEFAULT_ROLE_TIMEOUT_MS is this constant, imported. If that
    // number moves, it moves here — and this test is what says so out loud.
    expect(ROLE_TIMEOUT_MS).toBe(30 * 60 * 1000)
  })
})
