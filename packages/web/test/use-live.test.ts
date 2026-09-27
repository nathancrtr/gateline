// #496: a `change` event names what moved, and only the queries that read it
// are invalidated. A fake query client holds literal keys, shaped as the pages
// build them, and records which ones each event invalidated.
import { describe, expect, it } from 'vitest'
import { invalidateForChange, parseChanges } from '../src/use-live.ts'

const KEYS: readonly (readonly unknown[])[] = [
  ['inbox'],
  ['runs'],
  ['metrics'],
  ['engine-health'],
  ['health'],
  ['staging-config'],
  ['run', 'github.com/acme/billing', 'csv-export'],
  ['artifact', 'github.com/acme/billing', 'csv-export', 'spec.md'],
  ['escalation', 'github.com/acme/billing', 'csv-export', 0],
  ['diff', 'github.com/acme/billing', 'refunds'],
  ['run', 'github.com/acme/ledger', 'csv-export'],
  ['lexicon', 'github.com/acme/ledger', 'csv-export'],
]

/** Records the keys an invalidation reached; no filter reaches every key, as react-query does. */
function fakeClient() {
  const invalidated: string[] = []
  return {
    invalidated,
    invalidateQueries: async (filters?: { predicate?: (query: { queryKey: readonly unknown[] }) => boolean }) => {
      for (const queryKey of KEYS) if (!filters?.predicate || filters.predicate({ queryKey })) invalidated.push(JSON.stringify(queryKey))
    },
  }
}

const invalidatedBy = async (data: unknown) => {
  const client = fakeClient()
  await invalidateForChange(client as never, data)
  return client.invalidated
}

describe('invalidating on a change event', () => {
  it('a run change reaches that run and the views across repositories, and not the same slug in another repository', async () => {
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 'github.com/acme/billing', slug: 'csv-export' }] }))).toEqual([
      '["inbox"]',
      '["runs"]',
      '["metrics"]',
      '["run","github.com/acme/billing","csv-export"]',
      '["artifact","github.com/acme/billing","csv-export","spec.md"]',
      '["escalation","github.com/acme/billing","csv-export",0]',
    ])
  })

  it('a repository change reaches every query of that repository, and the staging form', async () => {
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 'github.com/acme/billing', slug: null }] }))).toEqual([
      '["inbox"]',
      '["runs"]',
      '["metrics"]',
      '["staging-config"]',
      '["run","github.com/acme/billing","csv-export"]',
      '["artifact","github.com/acme/billing","csv-export","spec.md"]',
      '["escalation","github.com/acme/billing","csv-export",0]',
      '["diff","github.com/acme/billing","refunds"]',
    ])
  })

  it('matches the repository without regard to case, and the slug exactly', async () => {
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 'GitHub.com/Acme/Ledger', slug: 'csv-export' }] }))).toEqual([
      '["inbox"]',
      '["runs"]',
      '["metrics"]',
      '["run","github.com/acme/ledger","csv-export"]',
      '["lexicon","github.com/acme/ledger","csv-export"]',
    ])
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 'github.com/acme/ledger', slug: 'CSV-export' }] }))).toEqual([
      '["inbox"]',
      '["runs"]',
      '["metrics"]',
    ])
  })

  it('a coalesced event reaches the union of what it lists', async () => {
    const data = JSON.stringify({
      changes: [
        { source: 'github.com/acme/billing', slug: 'refunds' },
        { source: 'github.com/acme/ledger', slug: null },
      ],
    })
    expect(await invalidatedBy(data)).toEqual([
      '["inbox"]',
      '["runs"]',
      '["metrics"]',
      '["staging-config"]',
      '["diff","github.com/acme/billing","refunds"]',
      '["run","github.com/acme/ledger","csv-export"]',
      '["lexicon","github.com/acme/ledger","csv-export"]',
    ])
  })

  it('an event it cannot read — an older server sends {} — invalidates everything', async () => {
    const everything = KEYS.map((k) => JSON.stringify(k))
    expect(await invalidatedBy('{}')).toEqual(everything)
    expect(await invalidatedBy('not json')).toEqual(everything)
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 'github.com/acme/billing' }] }))).toEqual(everything)
    expect(await invalidatedBy(JSON.stringify({ changes: [{ source: 7, slug: null }] }))).toEqual(everything)
    expect(await invalidatedBy(undefined)).toEqual(everything)
  })
})

describe('parseChanges', () => {
  it('reads the list, and nothing else', () => {
    expect(parseChanges('{"changes":[{"source":"local/scratch","slug":null},{"source":"local/scratch","slug":"a"}]}')).toEqual([
      { source: 'local/scratch', slug: null },
      { source: 'local/scratch', slug: 'a' },
    ])
    expect(parseChanges('{"changes":[]}')).toEqual([])
    expect(parseChanges('{"changes":{}}')).toBeNull()
    expect(parseChanges('null')).toBeNull()
  })
})
