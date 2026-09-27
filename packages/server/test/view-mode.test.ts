// The server's write routes under modes (#495, docs/MULTI-REPO.md §7.3): a
// `view` repository's source refuses the write, and the route answers 403
// with the refusal; a `decide` repository records it. The last test lists
// every route that is not a GET and makes each one's relation to the
// repository a decision written here, so a new write route cannot be added
// without one. Messages are literals.
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { LocalGitSource } from '@gateline/core'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { startServer } from '../src/main.ts'
import { buildRunnerApi } from '../src/runner-api.ts'

let viewFixture: FixtureRepo
let decideFixture: FixtureRepo
let app: Hono

const REFUSAL =
  'watched (github.com/acme/watched) is in view mode: it is read here and nothing is written to it. ' +
  'To record decisions in it, set `mode: decide` on its entry in the config file'

const brief = `# Intent Brief: CSV export

## Problem
x

## Motivation
x

## Constraints
x

## Out of scope
x
`

const post = async (path: string, payload: object) => {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}
const tip = (dir: string, branch: string) =>
  execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', branch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

beforeAll(() => {
  viewFixture = generateFixtureRepo(undefined, { name: 'watched' })
  decideFixture = generateFixtureRepo(undefined, { name: 'decided' })
  app = createApp({
    sources: [
      new LocalGitSource('github.com/acme/watched', viewFixture.dir, { displayName: 'watched', mode: 'view' }),
      new LocalGitSource('github.com/acme/decided', decideFixture.dir, { displayName: 'decided', mode: 'decide' }),
    ],
  })
})
afterAll(async () => {
  await rm(viewFixture.root, { recursive: true, force: true })
  await rm(decideFixture.root, { recursive: true, force: true })
})

describe('POST /api/decisions', () => {
  const approve = (source: string) => ({ source, slug: 'g0-pending', action: 'approve', gate: 'G0', burden: 'confirmation' })

  it('refuses a view repository with 403, and nothing is committed', async () => {
    const before = tip(viewFixture.dir, 'run/g0-pending')
    const { status, body } = await post('/api/decisions', approve('github.com/acme/watched'))
    expect(status).toBe(403)
    expect(body).toEqual({ error: REFUSAL })
    expect(tip(viewFixture.dir, 'run/g0-pending')).toBe(before)
  })

  it('refuses arming in a view repository the same way', async () => {
    const { status, body } = await post('/api/decisions', { source: 'github.com/acme/watched', slug: 'staged', action: 'arm' })
    expect(status).toBe(403)
    expect(body).toEqual({ error: REFUSAL })
  })

  it('records a decision in a decide repository', async () => {
    const { status, body } = await post('/api/decisions', approve('github.com/acme/decided'))
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
  })
})

describe('POST /api/runs', () => {
  const stage = (source: string, slug: string) => ({ source, slug, title: 'CSV export', profile: 'standard', briefMarkdown: brief, costLimitUsd: 10 })

  it('refuses a view repository with 403 and the view-mode reason, and mints no branch', async () => {
    const { status, body } = await post('/api/runs', stage('github.com/acme/watched', 'csv-export'))
    expect(status).toBe(403)
    expect(body).toEqual({ outcome: 'refused', reason: 'view-mode', message: REFUSAL })
    expect(() => tip(viewFixture.dir, 'run/csv-export')).toThrow()
  })

  it('stages a run in a decide repository', async () => {
    const { status, body } = await post('/api/runs', stage('github.com/acme/decided', 'csv-export'))
    expect(status).toBe(201)
    expect(body.outcome).toBe('created')
  })
})

describe('every route that is not a GET', () => {
  // Each one's relation to the repository, decided here and nowhere else.
  const WRITES_TO_REPOSITORY = {
    // planDecision → source.writeState, which refuses a view source (403 above)
    'POST /api/decisions': 'source.writeState',
    // planRunScaffold → source.stageRun, which refuses a view source (403 above)
    'POST /api/runs': 'source.stageRun',
    // a review event → applySync → source.writeState, refused per entry for a
    // view source (core/test/view-mode.test.ts); a push event only fetches
    'POST /api/webhooks/github': 'applySync → source.writeState',
  }
  const WRITES_NOTHING = [
    // the runner relay: an in-memory claim and an outcome handed to the
    // engine, which writes through its own source
    'POST /api/runner/claim',
    'POST /api/runner/report',
  ]

  it('is classified, so a new one needs a decision about modes', () => {
    const full = createApp({
      sources: [],
      webhook: { secret: 's', onEvent: async () => 'ok' },
      runnerApi: buildRunnerApi({ token: 't', callback: { pendingIntents: () => [], resolveOutcome: () => false }, log: () => {} }),
    })
    const unsafe = [...new Set(full.routes.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`))].sort()
    expect(unsafe).toEqual([...Object.keys(WRITES_TO_REPOSITORY), ...WRITES_NOTHING].sort())
  })
})

describe('the startup log', () => {
  it("prints each repository's mode beside its id", async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const at = async (engine: boolean) => {
      log.mockClear()
      const server = await startServer({ repoOverrides: [decideFixture.dir], port: 0, host: '127.0.0.1', push: false, engine })
      server.close()
      return log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('sources: '))
    }
    try {
      expect(await at(false)).toBe('sources: local/decided (decide)')
      expect(await at(true)).toBe('sources: local/decided (dispatch)')
    } finally {
      log.mockRestore()
    }
  })
})
