// The webhook route: HMAC is the gate; each event syncs the one repository
// its payload names (#496, docs/MULTI-REPO.md §8.4). Expected answers are
// literals.
import { createHmac } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { RunSource } from '@gateline/core'
import { generateFixtureRepo } from '@gateline/fixtures'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { startServer } from '../src/main.ts'
import { buildWebhook, unroutableSources } from '../src/webhook.ts'

const SECRET = 'hook-secret'

const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`

function post(app: ReturnType<typeof createApp>, body: string, headers: Record<string, string>) {
  return app.request('/api/webhooks/github', { method: 'POST', body, headers })
}

describe('POST /api/webhooks/github', () => {
  const makeApp = (onEvent = vi.fn(async () => 'done')) => ({
    onEvent,
    app: createApp({ sources: [], webhook: { secret: SECRET, onEvent } }),
  })

  it('accepts a correctly signed event and dispatches it', async () => {
    const { app, onEvent } = makeApp()
    const body = JSON.stringify({ zen: 'Design for failure.' })
    const res = await post(app, body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'ping' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, detail: 'done' })
    expect(onEvent).toHaveBeenCalledWith('ping', { zen: 'Design for failure.' })
  })

  it('rejects a bad signature without dispatching', async () => {
    const { app, onEvent } = makeApp()
    const body = JSON.stringify({})
    const res = await post(app, body, { 'x-hub-signature-256': sign(`${body}tampered`), 'x-github-event': 'push' })
    expect(res.status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('rejects a missing signature', async () => {
    const { app, onEvent } = makeApp()
    const res = await post(app, '{}', { 'x-github-event': 'push' })
    expect(res.status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('rejects a signed non-JSON body', async () => {
    const { app } = makeApp()
    const body = 'not json'
    const res = await post(app, body, { 'x-hub-signature-256': sign(body) })
    expect(res.status).toBe(400)
  })

  it('does not exist when no webhook is configured', async () => {
    const app = createApp({ sources: [] })
    const res = await post(app, '{}', {})
    expect(res.status).toBe(404)
  })
})

/** A source as the webhook sees it, counting its fetches. Only what the webhook reads is filled in. */
function fakeSource(
  id: string,
  origin: string | null,
  synced: string[],
  extra: { displayName?: string; mode?: RunSource['mode']; fail?: string } = {},
): RunSource {
  return {
    id,
    displayName: extra.displayName,
    mode: extra.mode,
    originUrl: async () => origin,
    syncFromRemote: async () => {
      synced.push(id)
      if (extra.fail) throw new Error(extra.fail)
    },
  } as unknown as RunSource
}

/** What GitHub sends about the repository an event is for (the fields routing may read). */
const eventFor = (cloneUrl: string) => ({
  ref: 'refs/heads/run/csv-export',
  repository: { full_name: 'ignored/by-routing', clone_url: cloneUrl, html_url: cloneUrl.replace(/\.git$/, '') },
})

describe('buildWebhook', () => {
  it('returns undefined without a secret — the route must not exist unsigned', () => {
    expect(buildWebhook({ sources: [], secret: undefined, githubToken: undefined, log: () => {} })).toBeUndefined()
  })

  describe('routing by the repository the payload names (#496)', () => {
    const three = (synced: string[]) => [
      fakeSource('github.com/acme/billing', 'git@github.com:acme/billing.git', synced),
      fakeSource('github.com/acme/ledger', 'https://github.com/acme/ledger.git', synced),
      fakeSource('gitlab.example.com/ops/infra', 'https://gitlab.example.com/ops/infra.git', synced),
    ]
    const hook = (sources: RunSource[], log: (l: string) => void = () => {}) =>
      buildWebhook({ sources, secret: SECRET, githubToken: undefined, log })!

    it('a push naming one repository syncs that repository and no other', async () => {
      const synced: string[] = []
      const webhook = hook(three(synced))
      expect(await webhook.onEvent('push', eventFor('https://github.com/acme/ledger.git'))).toBe('synced github.com/acme/ledger')
      expect(synced).toEqual(['github.com/acme/ledger'])
    })

    it('matches the id without regard to case', async () => {
      const synced: string[] = []
      const webhook = hook(three(synced))
      expect(await webhook.onEvent('push', eventFor('https://github.com/Acme/Billing.git'))).toBe('synced github.com/acme/billing')
      expect(synced).toEqual(['github.com/acme/billing'])
    })

    it('falls back to the html URL when the payload has no clone URL', async () => {
      const synced: string[] = []
      const webhook = hook(three(synced))
      const payload = { repository: { html_url: 'https://gitlab.example.com/ops/infra' } }
      expect(await webhook.onEvent('push', payload)).toBe('synced gitlab.example.com/ops/infra')
      expect(synced).toEqual(['gitlab.example.com/ops/infra'])
    })

    it('a repository not in the set syncs nothing', async () => {
      const synced: string[] = []
      const webhook = hook(three(synced))
      expect(await webhook.onEvent('push', eventFor('https://github.com/acme/payroll.git'))).toBe(
        'github.com/acme/payroll is not served here; nothing synced',
      )
      expect(await webhook.onEvent('push', {})).toBe('the event names no repository; nothing synced')
      expect(synced).toEqual([])
    })

    it('never reaches a local/ repository, even when a payload spells its id', async () => {
      const synced: string[] = []
      const webhook = hook([fakeSource('local/billing', null, synced)])
      // A host literally called `local` parses to the same id.
      expect(await webhook.onEvent('push', eventFor('https://local/billing.git'))).toBe('local/billing is not served here; nothing synced')
      expect(synced).toEqual([])
    })

    it('never reaches a repository whose id was stated by hand and differs from its origin', async () => {
      const synced: string[] = []
      const webhook = hook([fakeSource('github.com/acme/billing-v2', 'git@github.com:acme/billing.git', synced)])
      expect(await webhook.onEvent('push', eventFor('https://github.com/acme/billing-v2.git'))).toBe(
        'github.com/acme/billing-v2 is not served here; nothing synced',
      )
      expect(await webhook.onEvent('push', eventFor('https://github.com/acme/billing.git'))).toBe(
        'github.com/acme/billing is not served here; nothing synced',
      )
      expect(synced).toEqual([])
    })

    it('lists the repositories no webhook reaches, for the startup log', async () => {
      const synced: string[] = []
      const sources = [
        ...three(synced),
        fakeSource('local/scratch', null, synced),
        fakeSource('github.com/acme/billing-v2', 'git@github.com:acme/billing.git', synced),
      ]
      expect((await unroutableSources(sources)).map((s) => s.id)).toEqual(['local/scratch', 'github.com/acme/billing-v2'])
    })

    it('a failed fetch is reported in the answer, not thrown', async () => {
      const synced: string[] = []
      const lines: string[] = []
      const failing = fakeSource('github.com/acme/billing', 'git@github.com:acme/billing.git', synced, { fail: 'could not read from remote' })
      const webhook = hook([failing], (l) => lines.push(l))
      expect(await webhook.onEvent('push', eventFor('https://github.com/acme/billing.git'))).toBe(
        'sync of github.com/acme/billing failed: could not read from remote',
      )
      expect(lines).toEqual(['webhook: sync of github.com/acme/billing failed: could not read from remote'])
    })

    it('routes through the real route, signature checked first', async () => {
      const synced: string[] = []
      const app = createApp({ sources: [], webhook: hook(three(synced)) })
      const body = JSON.stringify(eventFor('https://github.com/acme/billing.git'))
      const bad = await post(app, body, { 'x-hub-signature-256': sign(`${body} `), 'x-github-event': 'push' })
      expect(bad.status).toBe(401)
      expect(synced).toEqual([])
      const res = await post(app, body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'push' })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, detail: 'synced github.com/acme/billing' })
      expect(synced).toEqual(['github.com/acme/billing'])
      const other = JSON.stringify(eventFor('https://github.com/acme/payroll.git'))
      const unserved = await post(app, other, { 'x-hub-signature-256': sign(other), 'x-github-event': 'push' })
      expect(unserved.status).toBe(200)
      expect(await unserved.json()).toEqual({ ok: true, detail: 'github.com/acme/payroll is not served here; nothing synced' })
      expect(synced).toEqual(['github.com/acme/billing'])
    })
  })

  describe('review events', () => {
    const REFUSAL =
      'watched (github.com/acme/watched) is in view mode: it is read here and nothing is written to it. ' +
      'To record decisions in it, set `mode: decide` on its entry in the config file'

    it('follow the same routing, and without a token fetch and say the sync was skipped', async () => {
      const synced: string[] = []
      const sources = [
        fakeSource('github.com/acme/billing', 'git@github.com:acme/billing.git', synced),
        fakeSource('github.com/acme/ledger', 'git@github.com:acme/ledger.git', synced),
      ]
      const webhook = buildWebhook({ sources, secret: SECRET, githubToken: undefined, log: () => {} })!
      expect(await webhook.onEvent('pull_request_review', eventFor('https://github.com/acme/ledger.git'))).toBe(
        'review received; GITHUB_TOKEN unset — PR-approval sync skipped',
      )
      expect(synced).toEqual(['github.com/acme/ledger'])
      expect(await webhook.onEvent('pull_request_review', eventFor('https://github.com/acme/payroll.git'))).toBe(
        'github.com/acme/payroll is not served here; nothing synced',
      )
      expect(synced).toEqual(['github.com/acme/ledger'])
    })

    it('on a view repository report the refusal, write nothing, and never ask GitHub', async () => {
      const synced: string[] = []
      const watched = fakeSource('github.com/acme/watched', 'git@github.com:acme/watched.git', synced, {
        displayName: 'watched',
        mode: 'view',
      })
      const listRuns = vi.fn()
      const writeState = vi.fn()
      Object.assign(watched, { listRuns, writeState })
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      try {
        const webhook = buildWebhook({ sources: [watched], secret: SECRET, githubToken: 'ghp_test', log: () => {} })!
        const app = createApp({ sources: [], webhook })
        const body = JSON.stringify(eventFor('https://github.com/acme/watched.git'))
        const res = await post(app, body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'pull_request_review' })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true, detail: `PR-approval sync skipped: ${REFUSAL}` })
        expect(fetchSpy).not.toHaveBeenCalled()
      } finally {
        fetchSpy.mockRestore()
      }
      expect(synced).toEqual(['github.com/acme/watched'])
      expect(listRuns).not.toHaveBeenCalled()
      expect(writeState).not.toHaveBeenCalled()
    })
  })

  it('unknown events are acknowledged and ignored', async () => {
    const webhook = buildWebhook({ sources: [], secret: SECRET, githubToken: undefined, log: () => {} })!
    expect(await webhook.onEvent('issues', {})).toBe('ignored event issues')
  })
})

describe('the startup log', () => {
  it('says once which repositories no webhook reaches, when a secret is set', async () => {
    const fixture = generateFixtureRepo(undefined, { name: 'scratch' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const before = process.env.GITHUB_WEBHOOK_SECRET
    process.env.GITHUB_WEBHOOK_SECRET = SECRET
    try {
      const server = await startServer({ repoOverrides: [fixture.dir], port: 0, host: '127.0.0.1', push: false })
      server.close()
      const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('webhook: '))
      expect(lines).toEqual([
        'webhook: local/scratch is not reached by webhook events (its id is local: it has no origin)',
      ])
    } finally {
      if (before === undefined) delete process.env.GITHUB_WEBHOOK_SECRET
      else process.env.GITHUB_WEBHOOK_SECRET = before
      log.mockRestore()
      await rm(fixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
})
