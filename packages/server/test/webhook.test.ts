// The webhook route: HMAC is the gate; events fan out to sync actions.
import { createHmac } from 'node:crypto'
import type { RunSource } from '@gateline/core'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { buildWebhook } from '../src/webhook.ts'

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

describe('buildWebhook', () => {
  it('returns undefined without a secret — the route must not exist unsigned', () => {
    expect(buildWebhook({ sources: [], secret: undefined, githubToken: undefined, log: () => {} })).toBeUndefined()
  })

  it('push events fetch every sync-capable source', async () => {
    const synced: string[] = []
    const source = {
      id: 's1',
      dir: '/tmp/nowhere',
      syncFromRemote: async () => {
        synced.push('s1')
      },
    } as unknown as RunSource
    const webhook = buildWebhook({ sources: [source], secret: SECRET, githubToken: undefined, log: () => {} })!
    expect(await webhook.onEvent('push', {})).toBe('synced 1/1 source(s)')
    expect(synced).toEqual(['s1'])
  })

  it('review events without a token skip the PR sync but say so', async () => {
    const webhook = buildWebhook({ sources: [], secret: SECRET, githubToken: undefined, log: () => {} })!
    expect(await webhook.onEvent('pull_request_review', {})).toContain('GITHUB_TOKEN unset')
  })

  it('unknown events are acknowledged and ignored', async () => {
    const webhook = buildWebhook({ sources: [], secret: SECRET, githubToken: undefined, log: () => {} })!
    expect(await webhook.onEvent('issues', {})).toBe('ignored event issues')
  })
})
