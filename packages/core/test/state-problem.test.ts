// Why a run's state could not be read, as a fact (#435).
//
// The view sets a `parser` problem under "Run state parser", so only the
// parser's own message may travel as words. A state file that is absent, or
// one the source gave no reason about, used to arrive as a sentence core
// wrote (`state.yaml unreadable`) and render as if the parser had said it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deriveReadiness, type RunRef, type RunSource, stateProblem, summarizeRun } from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
let refs: Map<string, RunRef>

beforeAll(async () => {
  ctx = await makeFixture()
  refs = new Map((await ctx.source.listRuns()).map((r) => [r.slug, r]))
})
afterAll(() => dropFixture(ctx))

type Read = Awaited<ReturnType<RunSource['readState']>>

/** The fixture's source, with one run's state read replaced — every other read is the real one. */
function readingAs(read: Read): RunSource {
  return new Proxy(ctx.source, {
    get(target, key) {
      if (key === 'readState') return async () => read
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as RunSource
}

describe('stateProblem', () => {
  it('is null when the read yielded a state', async () => {
    const read = await ctx.source.readState(refs.get('g1-pending')!)
    expect(read.state).not.toBeNull()
    expect(stateProblem(read)).toBeNull()
  })

  it("a file the parser refused carries the parser's message verbatim, and nothing else as words", async () => {
    const read = await ctx.source.readState(refs.get('bad-state')!)
    expect(stateProblem(read)).toEqual({ kind: 'parser', diagnostic: read.error, ledger: expect.objectContaining({ kind: 'state', path: 'state.yaml' }) })
  })

  it("an absent file is absent — the source's sentence about it is not a diagnostic", () => {
    expect(stateProblem({ raw: null, state: null, error: 'state.yaml missing' })).toEqual({
      kind: 'absent',
      ledger: expect.objectContaining({ kind: 'state', path: 'state.yaml' }),
    })
  })

  it('a file with no state and no reason is unexplained, not given one', () => {
    expect(stateProblem({ raw: 'run: x\n', state: null, error: null })).toEqual({
      kind: 'unexplained',
      ledger: expect.objectContaining({ kind: 'state', path: 'state.yaml' }),
    })
  })
})

describe('no state and no parse error: the portfolio row and the inbox item state the fact (#435)', () => {
  const cases: [string, Read][] = [
    ['absent', { raw: null, state: null, error: 'state.yaml missing' }],
    ['unexplained', { raw: 'run: bad-state\n', state: null, error: null }],
  ]
  for (const [kind, read] of cases) {
    it(`${kind}: a kind, never a sentence core wrote`, async () => {
      const source = readingAs(read)
      const ref = refs.get('bad-state')!
      const { summary } = await summarizeRun(source, ref)
      expect(summary.unreadable).toMatchObject({ kind })
      expect(summary.unreadable).not.toHaveProperty('diagnostic')

      const { items } = await deriveReadiness(source, ref)
      const malformed = items.find((i) => i.kind === 'malformed')!
      expect(malformed.unreadable).toMatchObject({ kind })
      // `problems` is what the card and the CLI set as the parser's words.
      expect(malformed.problems).toEqual([])
      // The fallback sentence is gone from every field that reaches a view.
      expect(JSON.stringify({ summary, malformed })).not.toContain('state.yaml unreadable')
    })
  }

  it("parser: the portfolio row and the inbox item carry the same diagnostic, and problems holds it", async () => {
    const ref = refs.get('bad-state')!
    const { summary } = await summarizeRun(ctx.source, ref)
    const { items } = await deriveReadiness(ctx.source, ref)
    const malformed = items.find((i) => i.kind === 'malformed')!
    expect(summary.unreadable?.kind).toBe('parser')
    expect(malformed.unreadable).toEqual(summary.unreadable)
    expect(malformed.problems).toEqual([(summary.unreadable as { diagnostic: string }).diagnostic])
  })
})
