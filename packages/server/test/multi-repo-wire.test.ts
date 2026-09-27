// What #499 puts on the wire, through the real routes: each served
// repository's display name and mode on /api/health, the heartbeat's
// deferral with its limit and repository (and nothing it does not name), the
// repositories whose unreadable runs collapse on /api/inbox, and the staging
// picker's names and modes. Expected values are literals.
import { rm } from 'node:fs/promises'
import { LocalGitSource, writeEngineHealth } from '@gateline/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { floodedRepo, scenarioRoot } from '../../e2e/scenarios.ts'
import { createApp } from '../src/app.ts'

let root: string
let website: ReturnType<typeof floodedRepo>
let billing: ReturnType<typeof floodedRepo>

beforeAll(() => {
  root = scenarioRoot()
  website = floodedRepo(root, 'website', 4)
  billing = floodedRepo(root, 'billing', 3)
}, 120_000)
afterAll(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))

const get = async <T>(app: ReturnType<typeof createApp>, path: string): Promise<T> => {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return (await res.json()) as T
}

describe('/api/health', () => {
  it('lists each repository with its display name and mode, beside the ids it always sent', async () => {
    const app = createApp({
      sources: [
        new LocalGitSource('local/website', website.dir, { displayName: 'marketing', mode: 'decide' }),
        new LocalGitSource('local/billing', billing.dir, { mode: 'view' }),
        new LocalGitSource('local/other', billing.dir),
      ],
    })
    const body = await get<Record<string, unknown>>(app, '/api/health')
    expect(body.sources).toEqual(['local/website', 'local/billing', 'local/other'])
    expect(body.repositories).toEqual([
      { id: 'local/website', name: 'marketing', mode: 'decide' },
      { id: 'local/billing', name: 'billing', mode: 'view' },
      { id: 'local/other', name: 'other', mode: null },
    ])
  })
})

describe('/api/inbox', () => {
  it('names the repository whose unreadable runs collapse, and keeps every item in the list', async () => {
    const app = createApp({ sources: [new LocalGitSource('local/website', website.dir), new LocalGitSource('local/billing', billing.dir)] })
    const body = await get<{ items: { source: string; kind: string }[]; collapsed: unknown[] }>(app, '/api/inbox')
    // website: 4 unreadable runs, collapsed; billing: 3, not.
    expect(body.collapsed).toEqual([
      { source: 'local/website', sourceName: 'website', kind: 'malformed', count: 4, since: expect.any(Number) },
    ])
    expect(body.items.filter((i) => i.kind === 'malformed' && i.source === 'local/website').length).toBe(4)
    expect(body.items.filter((i) => i.kind === 'malformed' && i.source === 'local/billing').length).toBe(3)
    // Three decisions from each small set, plus the unreadable runs: 3 + 4 + 3 + 3.
    expect(body.items.length).toBe(13)
  })
})

describe('/api/engine-health', () => {
  it('passes the deferral on with its limit and repository, and leaves off fields the contract does not name', async () => {
    await writeEngineHealth(website.dir, {
      at: new Date().toISOString(),
      pid: 1,
      heartbeatMs: 30_000,
      inFlight: 0,
      pushRejections: {},
      deferrals: [{ slug: 'csv-export', rule: 'MC', reason: '2/2 running', since: '2026-09-27T10:00:00Z', limit: 'concurrency', repository: 'local/website' }],
      // A later engine's fields (#502): read without error, never sent on.
      ...({ failed: { reason: 'x' }, unseeded: ['local/billing'] } as object),
    })
    const app = createApp({ sources: [new LocalGitSource('local/website', website.dir), new LocalGitSource('local/billing', billing.dir)] })
    const body = await get<{ engines: Record<string, Record<string, unknown> | null> }>(app, '/api/engine-health')
    expect(body.engines['local/billing']).toBeNull()
    const entry = body.engines['local/website']!
    expect(entry.deferrals).toEqual([{ slug: 'csv-export', rule: 'MC', reason: '2/2 running', since: '2026-09-27T10:00:00Z', limit: 'concurrency', repository: 'local/website' }])
    expect(entry.stale).toBe(false)
    expect('failed' in entry).toBe(false)
    expect('unseeded' in entry).toBe(false)
  })
})

describe('/api/staging', () => {
  it('names each repository and says its mode, so the form can leave out a view repository', async () => {
    const app = createApp({
      sources: [
        new LocalGitSource('local/website', website.dir, { displayName: 'marketing', mode: 'decide' }),
        new LocalGitSource('local/billing', billing.dir, { mode: 'view' }),
      ],
    })
    const body = await get<{ sources: { id: string; name: string; mode: string | null }[] }>(app, '/api/staging')
    expect(body.sources.map(({ id, name, mode }) => ({ id, name, mode }))).toEqual([
      { id: 'local/website', name: 'marketing', mode: 'decide' },
      { id: 'local/billing', name: 'billing', mode: 'view' },
    ])
  })
})
