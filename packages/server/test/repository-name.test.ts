// The display name on the wire (#497): every response that names a run's
// repository by id names it by display name too, and the id stays the id.
// The run detail response carries it on its summary and on every item, which
// is where the run page's header reads it.
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { InboxResponse, MetricsResponse, RunDetailResponse, RunsResponse } from '../src/contract.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = generateFixtureRepo()
})
afterAll(() => rm(fixture.root, { recursive: true, force: true }))

async function get<T>(app: ReturnType<typeof createApp>, path: string): Promise<T> {
  const res = await app.request(path)
  expect(res.status, path).toBe(200)
  return (await res.json()) as T
}

/** Every `[source, sourceName]` pair the four read routes send, as `id → name`. */
async function pairs(app: ReturnType<typeof createApp>): Promise<Set<string>> {
  const { runs } = await get<RunsResponse>(app, '/api/runs')
  const { items } = await get<InboxResponse>(app, '/api/inbox')
  const metrics = await get<MetricsResponse>(app, '/api/metrics')
  const detail = await get<RunDetailResponse>(app, '/api/repos/github.com/acme/billing/-/runs/g1-pending')
  expect(runs.length).toBeGreaterThan(10)
  expect(items.length).toBeGreaterThan(10)
  expect(detail.items.length).toBeGreaterThan(0)
  const all = [...runs, ...items, ...metrics.runs, ...metrics.decisions, detail.summary, ...detail.items]
  return new Set(all.map((r) => `${r.source} → ${r.sourceName}`))
}

describe('the display name on the wire (#497)', () => {
  it("carries the configured name beside the id", async () => {
    const app = createApp({ sources: [new LocalGitSource('github.com/acme/billing', fixture.dir, { displayName: 'billing-app' })] })
    expect(await pairs(app)).toEqual(new Set(['github.com/acme/billing → billing-app']))
  })

  it("carries the id's last segment when no name is configured", async () => {
    const app = createApp({ sources: [new LocalGitSource('github.com/acme/billing', fixture.dir)] })
    expect(await pairs(app)).toEqual(new Set(['github.com/acme/billing → billing']))
  })
})
