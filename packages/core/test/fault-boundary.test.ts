// #496, docs/MULTI-REPO.md §10: a repository that cannot be read is named
// and left out, and the others load. Repositories are read side by side,
// under a bound, and the results keep the order the repositories are listed
// in whatever order the reads finish. Expected values are literals.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildPortfolio,
  computeMetrics,
  type InboxItem,
  LocalGitSource,
  oneLineError,
  REPOSITORIES_AT_ONCE,
  type RunRef,
  type RunSource,
  type RunSummary,
} from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A source that lists the given slugs after `delayMs`, or throws `error`. Only what the portfolio reads is filled in. */
function fakeSource(id: string, displayName: string, slugs: string[], opts: { delayMs?: number; error?: string } = {}): RunSource {
  return {
    id,
    displayName,
    listRuns: async (): Promise<RunRef[]> => {
      await sleep(opts.delayMs ?? 0)
      if (opts.error) throw new Error(opts.error)
      return slugs.map((slug) => ({ source: id, slug, ref: `run/${slug}`, kind: 'branch', branch: `run/${slug}` }))
    },
  } as unknown as RunSource
}

/** A summary carrying only what these tests read; every run the same age, so the portfolio's sort keeps listing order. */
const summarize = async (source: RunSource, ref: RunRef): Promise<{ summary: RunSummary; items: InboxItem[] }> => ({
  summary: { source: source.id, slug: ref.slug, updatedAt: 100 } as RunSummary,
  items: [{ source: source.id, slug: ref.slug, since: 100 } as InboxItem],
})

const rows = (runs: RunSummary[]) => runs.map((r) => `${r.source} ${r.slug}`)

describe('buildPortfolio across repositories', () => {
  it('leaves out a repository that throws, names it, and keeps the others in order', async () => {
    const sources = [
      // The first is the slowest, so a result kept in completion order would put it last.
      fakeSource('github.com/acme/billing', 'billing', ['csv-export', 'refunds'], { delayMs: 40 }),
      fakeSource('github.com/acme/ledger', 'Ledger', ['x'], { error: 'git for-each-ref failed: fatal: bad object refs/heads/run/x\nsecond line' }),
      fakeSource('gitlab.example.com/ops/infra', 'infra', ['rotate-keys']),
    ]
    const portfolio = await buildPortfolio(sources, { summarize })
    expect(rows(portfolio.runs)).toEqual([
      'github.com/acme/billing csv-export',
      'github.com/acme/billing refunds',
      'gitlab.example.com/ops/infra rotate-keys',
    ])
    expect(portfolio.inbox.map((i) => `${i.source} ${i.slug}`)).toEqual([
      'github.com/acme/billing csv-export',
      'github.com/acme/billing refunds',
      'gitlab.example.com/ops/infra rotate-keys',
    ])
    expect(portfolio.unreadable).toEqual([
      { source: 'github.com/acme/ledger', sourceName: 'Ledger', error: 'git for-each-ref failed: fatal: bad object refs/heads/run/x' },
    ])
  })

  it('a repository whose run cannot be summarized is left out whole', async () => {
    const sources = [fakeSource('github.com/acme/billing', 'billing', ['csv-export']), fakeSource('github.com/acme/ledger', 'ledger', ['a', 'b'])]
    const portfolio = await buildPortfolio(sources, {
      summarize: async (source, ref) => {
        if (ref.slug === 'b') throw new Error('git show failed: fatal: unable to read 1234abcd')
        return summarize(source, ref)
      },
    })
    expect(rows(portfolio.runs)).toEqual(['github.com/acme/billing csv-export'])
    expect(portfolio.unreadable).toEqual([
      { source: 'github.com/acme/ledger', sourceName: 'ledger', error: 'git show failed: fatal: unable to read 1234abcd' },
    ])
  })

  it('when every repository throws, the rows are empty and every one is named', async () => {
    const sources = [
      fakeSource('github.com/acme/billing', 'billing', [], { error: 'one' }),
      fakeSource('github.com/acme/ledger', 'ledger', [], { error: 'two', delayMs: 20 }),
      fakeSource('local/scratch', 'scratch', [], { error: 'three' }),
    ]
    expect(await buildPortfolio(sources, { summarize })).toEqual({
      runs: [],
      inbox: [],
      unreadable: [
        { source: 'github.com/acme/billing', sourceName: 'billing', error: 'one' },
        { source: 'github.com/acme/ledger', sourceName: 'ledger', error: 'two' },
        { source: 'local/scratch', sourceName: 'scratch', error: 'three' },
      ],
    })
  })

  it('reads at most four repositories at once, and keeps their order', async () => {
    expect(REPOSITORIES_AT_ONCE).toBe(4)
    let inFlight = 0
    let most = 0
    const counting = (n: number): RunSource =>
      ({
        id: `github.com/acme/r${n}`,
        listRuns: async (): Promise<RunRef[]> => {
          inFlight++
          most = Math.max(most, inFlight)
          // Later repositories answer sooner, so completion order is reversed.
          await sleep(5 + (10 - n) * 3)
          inFlight--
          return [{ source: `github.com/acme/r${n}`, slug: 'only', ref: 'run/only', kind: 'branch', branch: 'run/only' }]
        },
      }) as unknown as RunSource
    const sources = Array.from({ length: 10 }, (_, i) => counting(i))
    const portfolio = await buildPortfolio(sources, { summarize })
    expect(most).toBe(4)
    expect(rows(portfolio.runs)).toEqual([
      'github.com/acme/r0 only',
      'github.com/acme/r1 only',
      'github.com/acme/r2 only',
      'github.com/acme/r3 only',
      'github.com/acme/r4 only',
      'github.com/acme/r5 only',
      'github.com/acme/r6 only',
      'github.com/acme/r7 only',
      'github.com/acme/r8 only',
      'github.com/acme/r9 only',
    ])
  })
})

describe('oneLineError', () => {
  it('keeps the first line that says something', () => {
    expect(oneLineError(new Error('\n  fatal: not a git repository  \nhint: more'))).toBe('fatal: not a git repository')
    expect(oneLineError('plain words')).toBe('plain words')
    expect(oneLineError(new Error(''))).toBe('reading it failed, with no message')
    expect(oneLineError(new Error('x'.repeat(400)))).toBe(`${'x'.repeat(299)}…`)
  })
})

describe('computeMetrics across repositories', () => {
  let fx: FixtureContext
  let billing: LocalGitSource
  let infra: LocalGitSource

  beforeAll(async () => {
    fx = await makeFixture()
    billing = new LocalGitSource('github.com/acme/billing', fx.repo.dir, { displayName: 'billing' })
    infra = new LocalGitSource('gitlab.example.com/ops/infra', fx.repo.dir, { displayName: 'infra' })
  })
  afterAll(async () => {
    await dropFixture(fx)
  })

  const broken = fakeSource('github.com/acme/ledger', 'ledger', [], { error: 'fatal: not a git repository (or any of the parent directories): .git' })

  it('leaves out a repository that throws and computes the rest as if it were not listed', async () => {
    const without = await computeMetrics([billing, infra])
    const withBroken = await computeMetrics([billing, broken, infra])
    expect(without.unreadable).toEqual([])
    expect(withBroken.unreadable).toEqual([
      { source: 'github.com/acme/ledger', sourceName: 'ledger', error: 'fatal: not a git repository (or any of the parent directories): .git' },
    ])
    expect({ ...withBroken, unreadable: [] }).toEqual(without)
    // Both readable repositories are in the figures, in listing order.
    expect([...new Set(withBroken.runs.map((r) => r.source))]).toEqual(['github.com/acme/billing', 'gitlab.example.com/ops/infra'])
    expect(withBroken.decisions.length).toBeGreaterThan(0)
  })

  it('when every repository throws, the figures are empty and every one is named', async () => {
    const metrics = await computeMetrics([
      fakeSource('github.com/acme/billing', 'billing', [], { error: 'one' }),
      fakeSource('github.com/acme/ledger', 'ledger', [], { error: 'two' }),
      fakeSource('local/scratch', 'scratch', [], { error: 'three' }),
    ])
    expect(metrics.decisions).toEqual([])
    expect(metrics.runs).toEqual([])
    expect(metrics.perGate.map((g) => g.decisions)).toEqual([0, 0, 0, 0])
    expect(metrics.unreadable).toEqual([
      { source: 'github.com/acme/billing', sourceName: 'billing', error: 'one' },
      { source: 'github.com/acme/ledger', sourceName: 'ledger', error: 'two' },
      { source: 'local/scratch', sourceName: 'scratch', error: 'three' },
    ])
  })
})
