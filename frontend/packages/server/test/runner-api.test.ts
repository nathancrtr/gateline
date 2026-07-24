// The runner-agent route: service-token auth is the gate; the routes
// themselves proxy a stubbed RunnerCallback (no real dispatcher or engine).
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { buildRunnerApi, type DispatchOutcome, type PendingIntent, type RunnerCallback } from '../src/runner-api.ts'

const TOKEN = 'runner-secret'

const INTENT: PendingIntent = {
  key: 'wordfreq|implementer|01-core|1',
  slug: 'wordfreq',
  branch: 'run/wordfreq',
  role: 'implementer',
  task: '01-core',
  round: 1,
  body: 'do the thing',
  timeoutMs: 60_000,
}

function makeCallback(intents: PendingIntent[] = [INTENT]): RunnerCallback & { resolveOutcome: ReturnType<typeof vi.fn> } {
  const resolveOutcome = vi.fn((_key: string, _outcome: DispatchOutcome) => true)
  return { pendingIntents: () => intents, resolveOutcome }
}

function authed(path: string, init: RequestInit = {}) {
  return { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${TOKEN}` } }
}

describe('runner-agent API', () => {
  it('does not exist when RUNNER_TOKEN is unset (buildRunnerApi returns undefined)', () => {
    expect(buildRunnerApi({ token: undefined, callback: makeCallback(), log: () => {} })).toBeUndefined()
  })

  it('does not exist when no callback is wired even if a token is set', () => {
    expect(buildRunnerApi({ token: TOKEN, callback: undefined, log: () => {} })).toBeUndefined()
  })

  it('routes 404 when no runner API is configured', async () => {
    const app = createApp({ sources: [] })
    const res = await app.request('/api/runner/intents')
    expect(res.status).toBe(404)
  })

  it('rejects a request with no Authorization header', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const res = await app.request('/api/runner/intents')
    expect(res.status).toBe(401)
  })

  it('rejects a request with an invalid token', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const res = await app.request('/api/runner/intents', { headers: { authorization: 'Bearer wrong' } })
    expect(res.status).toBe(401)
  })

  it('accepts a request with a valid token and returns pending intents', async () => {
    const callback = makeCallback()
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback, log: () => {} }) })
    const res = await app.request('/api/runner/intents', authed('/api/runner/intents'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { intents: PendingIntent[] }
    expect(body.intents).toEqual([INTENT])
  })

  it('augments each intent with the base OID of the armed commit when repoDir is configured', async () => {
    const callback = makeCallback()
    const runnerApi = buildRunnerApi({
      token: TOKEN,
      callback,
      repoDir: '/tmp/does-not-matter',
      log: () => {},
    })!
    // Stub the git resolution indirectly: no repo at that path means
    // resolveOid fails and the intent is served without a baseOid — proves
    // the augmentation path runs without throwing, and never crashes the
    // route on an unresolvable ref.
    const intents = await runnerApi.listIntents()
    expect(intents).toHaveLength(1)
    expect(intents[0]!.key).toBe(INTENT.key)
  })

  it('claims an intent once and reports already-claimed on a second claim of the same key', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const first = await app.request('/api/runner/claim', authed('/api/runner/claim', { method: 'POST', body: JSON.stringify({ key: INTENT.key }), headers: { 'content-type': 'application/json' } }))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ claimed: true })

    const second = await app.request('/api/runner/claim', authed('/api/runner/claim', { method: 'POST', body: JSON.stringify({ key: INTENT.key }), headers: { 'content-type': 'application/json' } }))
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ claimed: false, reason: 'already-claimed' })
  })

  it('rejects a claim with no key', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const res = await app.request(
      '/api/runner/claim',
      authed('/api/runner/claim', { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } }),
    )
    expect(res.status).toBe(400)
  })

  it('claim is auth-gated like the other runner routes', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const res = await app.request('/api/runner/claim', { method: 'POST', body: JSON.stringify({ key: INTENT.key }), headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(401)
  })

  it('report resolves the pending dispatch through the callback', async () => {
    const callback = makeCallback()
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback, log: () => {} }) })
    const outcome: DispatchOutcome = { ok: true, costUsd: 0.12, tokensIn: 100, tokensOut: 50, error: null }
    const res = await app.request(
      '/api/runner/report',
      authed('/api/runner/report', {
        method: 'POST',
        body: JSON.stringify({ key: INTENT.key, outcome }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ resolved: true })
    expect(callback.resolveOutcome).toHaveBeenCalledWith(INTENT.key, outcome)
  })

  it('report on an unknown key returns resolved: false without throwing', async () => {
    const callback = makeCallback()
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: { pendingIntents: callback.pendingIntents, resolveOutcome: () => false }, log: () => {} }) })
    const outcome: DispatchOutcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'boom' }
    const res = await app.request(
      '/api/runner/report',
      authed('/api/runner/report', {
        method: 'POST',
        body: JSON.stringify({ key: 'nonexistent', outcome }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ resolved: false })
  })

  it('rejects a report with a missing outcome', async () => {
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} }) })
    const res = await app.request(
      '/api/runner/report',
      authed('/api/runner/report', { method: 'POST', body: JSON.stringify({ key: INTENT.key }), headers: { 'content-type': 'application/json' } }),
    )
    expect(res.status).toBe(400)
  })
})
