// #496 through the real routes: a repository that cannot be read is named in
// `unreadable` and the others load, with a 200 even when none can be read.
// The unreadable entries are literals; the readable rows are checked against
// the same routes serving those repositories with the broken one unlisted.
import { rm } from 'node:fs/promises'
import { LocalGitSource, type RunSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

let fixture: FixtureRepo
let billing: LocalGitSource
let infra: LocalGitSource

/** Lists nothing: every read of its runs fails the way a repository gone from disk does. */
const broken = (id: string, displayName: string, error: string): RunSource =>
  ({
    id,
    displayName,
    templates: { read: async () => null },
    listRuns: async () => {
      throw new Error(`${error}\nhint: a second line the list does not carry`)
    },
  }) as unknown as RunSource

const get = async (app: ReturnType<typeof createApp>, path: string) => {
  const res = await app.request(path)
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

beforeAll(() => {
  fixture = generateFixtureRepo(undefined, { name: 'billing' })
  // Two repositories over one generated clone: what matters here is which
  // repository each row is attributed to, not what the runs contain.
  billing = new LocalGitSource('github.com/acme/billing', fixture.dir, { displayName: 'billing' })
  infra = new LocalGitSource('gitlab.example.com/ops/infra', fixture.dir, { displayName: 'infra' })
})
afterAll(async () => {
  await rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const LEDGER = { source: 'github.com/acme/ledger', sourceName: 'Ledger', error: 'fatal: not a git repository: /srv/ledger/.git' }

describe('one repository that cannot be read', () => {
  const app = () => createApp({ sources: [billing, broken('github.com/acme/ledger', 'Ledger', 'fatal: not a git repository: /srv/ledger/.git'), infra] })
  const alone = () => createApp({ sources: [billing, infra] })

  for (const [path, rowsKey] of [
    ['/api/runs', 'runs'],
    ['/api/inbox', 'items'],
  ] as const) {
    it(`${path} names it and serves the others as if it were not listed`, async () => {
      const served = await get(app(), path)
      expect(served.status).toBe(200)
      expect(served.body.unreadable).toEqual([LEDGER])
      const reference = await get(alone(), path)
      expect(reference.body.unreadable).toEqual([])
      expect(served.body[rowsKey]).toEqual(reference.body[rowsKey])
      const sources = [...new Set((served.body[rowsKey] as { source: string }[]).map((r) => r.source))].sort()
      expect(sources).toEqual(['github.com/acme/billing', 'gitlab.example.com/ops/infra'])
    })
  }

  it('/api/metrics names it and computes the rest as if it were not listed', async () => {
    const served = await get(app(), '/api/metrics')
    expect(served.status).toBe(200)
    expect(served.body.unreadable).toEqual([LEDGER])
    const reference = await get(alone(), '/api/metrics')
    expect({ ...served.body, unreadable: [] }).toEqual(reference.body)
    // The per-repository gate figures (#499) cross the wire, one entry per
    // readable repository, and none for the one that could not be read.
    const breakdown = served.body.perRepository as { source: string; sourceName: string; perGate: { gate: string }[] }[]
    expect(breakdown.map((r) => [r.source, r.sourceName, r.perGate.map((g) => g.gate)])).toEqual([
      ['github.com/acme/billing', 'billing', ['G0', 'G1', 'G2', 'G3']],
      ['gitlab.example.com/ops/infra', 'infra', ['G0', 'G1', 'G2', 'G3']],
    ])
    expect(served.body.rateMinDecisions).toBe(5)
  })
})

describe('every repository unreadable', () => {
  const app = () =>
    createApp({
      sources: [
        broken('github.com/acme/billing', 'billing', 'one'),
        broken('github.com/acme/ledger', 'ledger', 'two'),
        broken('local/scratch', 'scratch', 'three'),
      ],
    })
  const ALL = [
    { source: 'github.com/acme/billing', sourceName: 'billing', error: 'one' },
    { source: 'github.com/acme/ledger', sourceName: 'ledger', error: 'two' },
    { source: 'local/scratch', sourceName: 'scratch', error: 'three' },
  ]

  it('is still a 200, with empty rows and every repository named', async () => {
    const runs = await get(app(), '/api/runs')
    expect(runs.status).toBe(200)
    expect(runs.body.runs).toEqual([])
    expect(runs.body.unreadable).toEqual(ALL)
    const inbox = await get(app(), '/api/inbox')
    expect(inbox.status).toBe(200)
    expect(inbox.body.items).toEqual([])
    expect(inbox.body.unreadable).toEqual(ALL)
    const metrics = await get(app(), '/api/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.body.decisions).toEqual([])
    expect(metrics.body.runs).toEqual([])
    expect(metrics.body.perRepository).toEqual([])
    expect(metrics.body.unreadable).toEqual(ALL)
  })
})
