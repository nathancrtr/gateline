// The runner-agent route: service-token auth is the gate; the routes
// themselves proxy a stubbed RunnerCallback (no real dispatcher or engine).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { buildRunnerApi, type DispatchOutcome, type PendingIntent, type RunnerCallback } from '../src/runner-api.ts'

const TOKEN = 'runner-secret'

// Isolate from the operator's real ~/.gitconfig, same as code-tree.test.ts.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A real throwaway git repo with one commit on `branch` — for pinning the
 *  base-OID augmentation against an actual `git rev-parse`, not just a
 *  no-throw assertion (review-03.md F3). */
function makeRepo(branch: string): { dir: string; oid: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-runner-api-'))
  cleanups.push(dir)
  const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
  git(['init', '-q', '-b', branch])
  git(['config', 'user.name', 'Toy'])
  git(['config', 'user.email', 'toy@example.com'])
  writeFileSync(join(dir, 'file.txt'), 'hello')
  git(['add', '.'])
  git(['commit', '-q', '-m', 'initial'])
  const oid = git(['rev-parse', branch]).trim()
  return { dir, oid }
}

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

function authed(_path: string, init: RequestInit = {}) {
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
    const repo = makeRepo(INTENT.branch)
    const callback = makeCallback()
    const runnerApi = buildRunnerApi({ token: TOKEN, callback, repoDir: repo.dir, log: () => {} })!
    const intents = await runnerApi.listIntents()
    expect(intents).toHaveLength(1)
    expect(intents[0]!.key).toBe(INTENT.key)
    // Discriminates the augmentation itself, not just that the route didn't
    // throw: the served baseOid must equal the branch's actual tip, and a
    // mutant resolving the wrong ref (or dropping the repoDir branch
    // entirely) would fail this — review-03.md F3.
    expect(intents[0]!.baseOid).toBe(repo.oid)
  })

  it('degrades gracefully (no baseOid, no throw) when repoDir has no repo or the branch is unresolvable', async () => {
    const callback = makeCallback()
    const runnerApi = buildRunnerApi({
      token: TOKEN,
      callback,
      repoDir: '/tmp/does-not-matter-and-has-no-repo',
      log: () => {},
    })!
    const intents = await runnerApi.listIntents()
    expect(intents).toHaveLength(1)
    expect(intents[0]!.key).toBe(INTENT.key)
    expect(intents[0]!.baseOid).toBeUndefined()
  })

  it('leaves intents unaugmented (no git call) when repoDir is not configured', async () => {
    const callback = makeCallback()
    const runnerApi = buildRunnerApi({ token: TOKEN, callback, log: () => {} })!
    const intents = await runnerApi.listIntents()
    expect(intents).toEqual([INTENT])
  })

  it('resolves the repo origin URL for the intents response when repoDir is configured', async () => {
    const repo = makeRepo(INTENT.branch)
    execFileSync('git', ['-C', repo.dir, 'remote', 'add', 'origin', 'https://example.test/repo.git'], { env: { ...process.env, ...GIT_ENV } })
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback: makeCallback(), repoDir: repo.dir, log: () => {} }) })
    const res = await app.request('/api/runner/intents', authed('/api/runner/intents'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { intents: PendingIntent[]; repoUrl: string | null }
    expect(body.repoUrl).toBe('https://example.test/repo.git')
  })

  it('repoUrl is null when repoDir is not configured, or has no origin remote', async () => {
    const noRepoDir = buildRunnerApi({ token: TOKEN, callback: makeCallback(), log: () => {} })!
    expect(await noRepoDir.repoUrl()).toBeNull()

    const repo = makeRepo(INTENT.branch) // no `origin` remote added
    const noOrigin = buildRunnerApi({ token: TOKEN, callback: makeCallback(), repoDir: repo.dir, log: () => {} })!
    expect(await noOrigin.repoUrl()).toBeNull()
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

  it('an expired claim can be re-claimed once its intent’s timeoutMs elapses — a crashed worker does not poison the key forever', async () => {
    // Deterministic clock (no wall-clock sleeps, per review-03.md F1's test
    // constraint): the callback's own intent supplies timeoutMs, which sizes
    // the claim's TTL.
    let clock = 0
    const shortIntent: PendingIntent = { ...INTENT, timeoutMs: 1_000 }
    const runnerApi = buildRunnerApi({ token: TOKEN, callback: makeCallback([shortIntent]), log: () => {}, now: () => clock })!

    expect(runnerApi.claim(shortIntent.key)).toBe(true) // first claim succeeds
    expect(runnerApi.claim(shortIntent.key)).toBe(false) // still held — a live worker owns it

    clock += 999
    expect(runnerApi.claim(shortIntent.key)).toBe(false) // 1ms shy of the intent's timeoutMs — still held

    clock += 2 // now past the 1000ms TTL: the worker that claimed it is presumed crashed
    expect(runnerApi.claim(shortIntent.key)).toBe(true) // re-claimable — no server restart required
  })

  it('a fresh claim after expiry gets a new full TTL, not the stale expiry', async () => {
    let clock = 0
    const shortIntent: PendingIntent = { ...INTENT, timeoutMs: 1_000 }
    const runnerApi = buildRunnerApi({ token: TOKEN, callback: makeCallback([shortIntent]), log: () => {}, now: () => clock })!

    expect(runnerApi.claim(shortIntent.key)).toBe(true)
    clock = 1_500 // past expiry
    expect(runnerApi.claim(shortIntent.key)).toBe(true) // re-claimed by a second worker
    clock = 1_500 + 999
    expect(runnerApi.claim(shortIntent.key)).toBe(false) // the second worker's claim is still live
  })

  it('reporting an outcome releases the claim immediately, before its TTL would otherwise expire', async () => {
    const clock = 0
    const shortIntent: PendingIntent = { ...INTENT, timeoutMs: 1_000 }
    const callback = makeCallback([shortIntent])
    const runnerApi = buildRunnerApi({ token: TOKEN, callback, log: () => {}, now: () => clock })!

    expect(runnerApi.claim(shortIntent.key)).toBe(true)
    runnerApi.report(shortIntent.key, { ok: true, costUsd: 0, tokensIn: 0, tokensOut: 0, error: null })
    expect(runnerApi.claim(shortIntent.key)).toBe(true) // released immediately, well before the 1000ms TTL
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

  it('rejects a report with no Authorization header', async () => {
    const callback = makeCallback()
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback, log: () => {} }) })
    const outcome: DispatchOutcome = { ok: true, costUsd: 0.12, tokensIn: 100, tokensOut: 50, error: null }
    const res = await app.request('/api/runner/report', {
      method: 'POST',
      body: JSON.stringify({ key: INTENT.key, outcome }),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
    // The mutant this pins against (review-03.md F2) is the dropped
    // `authorized(c)` guard on this route — proven by asserting the callback
    // was never reached, not just the status code.
    expect(callback.resolveOutcome).not.toHaveBeenCalled()
  })

  it('rejects a report with an invalid token', async () => {
    const callback = makeCallback()
    const app = createApp({ sources: [], runnerApi: buildRunnerApi({ token: TOKEN, callback, log: () => {} }) })
    const outcome: DispatchOutcome = { ok: true, costUsd: 0.12, tokensIn: 100, tokensOut: 50, error: null }
    const res = await app.request('/api/runner/report', {
      method: 'POST',
      body: JSON.stringify({ key: INTENT.key, outcome }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
    })
    expect(res.status).toBe(401)
    expect(callback.resolveOutcome).not.toHaveBeenCalled()
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
