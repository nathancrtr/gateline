// Wiring (run "runner-agent", task 05): RemoteDispatcher plugged into a real
// Engine and polled/claimed/reported through the *real* runner API
// (@agentic/server's buildRunnerApi + createApp) — a mock HTTP server via
// hono's in-process app.request(), not a live socket or a hand-rolled
// substitute, per the task's own "no real workstation" constraint. Proves
// the whole relay chain end to end (AC7.1, AC7.2, AC9.2) and that R7's lease
// semantics need no new mechanism: `this.jobs` (engine.ts) already gates
// `sweepStale` for a live remote dispatch exactly like a live local one.
import { describe, expect, it } from 'vitest'
import { LocalGitSource } from '@agentic/core'
import { createApp } from '@agentic/server'
import { buildRunnerApi } from '@agentic/server/main'
import { Engine } from '../src/engine.ts'
import { parseLedger } from '../src/observe.ts'
import { RemoteDispatcher } from '../src/runner-dispatcher.ts'
import type { DispatchOutcome } from '../src/seam.ts'
import { makeRunnerCallback } from '../src/start.ts'
import { makeToyRepo, TEST_REGISTRY, toyRef } from './engine.helper.ts'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }
const TOKEN = 'runner-secret'

/** Structural mirror of runner-api.ts's `PendingIntent` — only the fields
 *  these tests assert on, read back off the wire as JSON. */
interface WireIntent {
  key: string
  slug: string
  branch: string
  role: string
  task: string | null
  round: number | null
}

const authedGet = (token: string) => ({ headers: { authorization: `Bearer ${token}` } })
const authedPost = (token: string, body: unknown) => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

/**
 * Polls `/api/runner/intents` until it reports at least one intent. `launch()`
 * (engine.ts) registers a job (so `engine.inFlight()` is already accurate)
 * synchronously, but only *calls* `dispatcher.dispatch()` — and so populates
 * `RemoteDispatcher`'s own pending-call map — after its checkout setup
 * (`ensureRunCheckout`/`ensureTaskCheckout`, real git-worktree I/O) resolves.
 * A poll issued the instant `engine.tick()` returns can race that setup; a
 * real workstation polling on an interval never notices, so this mirrors
 * that tolerance instead of coupling the test to engine internals.
 */
async function pollIntents(app: ReturnType<typeof createApp>, token: string, tries = 100): Promise<{ status: number; intents: WireIntent[] }> {
  for (let i = 0; i < tries; i++) {
    const res = await app.request('/api/runner/intents', authedGet(token))
    const { intents } = (await res.json()) as { intents: WireIntent[] }
    if (intents.length > 0) return { status: res.status, intents }
    await new Promise((r) => setTimeout(r, 10))
  }
  return { status: 200, intents: [] }
}

describe('RemoteDispatcher wired to the real runner API (AC7.1, AC7.2, AC9.2)', () => {
  it('dispatch() -> intents route -> claim -> report route -> the Promise resolves -> closeDispatch lands the ledger entry', async () => {
    const { dir } = makeToyRepo()
    const remote = new RemoteDispatcher()
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: remote, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
    const callback = makeRunnerCallback(engine, remote)
    const runnerApi = buildRunnerApi({ token: TOKEN, callback, repoDir: dir, log: () => {} })!
    const app = createApp({ sources: [], runnerApi })

    // Spec phase: the first tick commits the open ledger entry and launches
    // the analyst — dispatch() parks its promise, nothing else settles it.
    const outcomes = await engine.tick()
    expect(outcomes[0]?.launched).toBe(1)
    expect(engine.inFlight()).toBe(1)

    // Poll through the mock HTTP server surface, not the dispatcher directly.
    const { status, intents } = await pollIntents(app, TOKEN)
    expect(status).toBe(200)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({ slug: 'toy', branch: 'run/toy', role: 'analyst', task: null, round: null })

    const claimRes = await app.request('/api/runner/claim', authedPost(TOKEN, { key: intents[0]!.key }))
    expect(await claimRes.json()).toEqual({ claimed: true })

    const outcome: DispatchOutcome = { ok: true, costUsd: 0.31, tokensIn: 1000, tokensOut: 200, error: null }
    const reportRes = await app.request('/api/runner/report', authedPost(TOKEN, { key: intents[0]!.key, outcome }))
    expect(await reportRes.json()).toEqual({ resolved: true })

    // The report resolved dispatch()'s parked promise; drain waits for
    // closeDispatch — the engine's own "the harness finished" equivalent —
    // to actually land the ledger-closing commit.
    await engine.drain()
    expect(engine.inFlight()).toBe(0)

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    const ledger = parseLedger(state)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ role: 'analyst', cost_usd: 0.31, tokens_in: 1000, tokens_out: 200, adapter: 'runner', failed: false })

    // Nothing is left pending on a second poll.
    const afterRes = await app.request('/api/runner/intents', authedGet(TOKEN))
    expect(((await afterRes.json()) as { intents: WireIntent[] }).intents).toHaveLength(0)
  })

  it('a failure reported through the API retries once rather than resolving silently', async () => {
    const { dir } = makeToyRepo()
    const remote = new RemoteDispatcher()
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: remote, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
    const callback = makeRunnerCallback(engine, remote)
    const runnerApi = buildRunnerApi({ token: TOKEN, callback, repoDir: dir, log: () => {} })!
    const app = createApp({ sources: [], runnerApi })

    await engine.tick()
    const { intents } = await pollIntents(app, TOKEN)
    const outcome: DispatchOutcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'workstation reported a harness failure' }
    await app.request('/api/runner/report', authedPost(TOKEN, { key: intents[0]!.key, outcome }))
    await engine.drain()

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    expect(parseLedger(state)).toMatchObject([{ role: 'analyst', failed: true }])
    expect(state!.phase).toBe('spec') // one failure retries; it does not escalate
  })
})

describe('R7 lease semantics — no new mechanism beyond this.jobs (engine.ts)', () => {
  it('an open ledger entry with an active remote dispatch is NOT aged out by sweepStale', async () => {
    const { dir } = makeToyRepo()
    const remote = new RemoteDispatcher()
    // staleMs: 0 is the most aggressive stale window possible — if aging
    // were driven by elapsed time alone (ignoring `this.jobs`), this entry
    // would age out on the very next tick despite the promise still pending.
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher: remote, registry: TEST_REGISTRY, staleMs: 0 })

    await engine.tick() // dispatches analyst; the promise is parked, unresolved
    expect(engine.inFlight()).toBe(1)

    // sweepStale (engine.ts tick()) runs first on the second tick — the live
    // job in `this.jobs` must suppress aging despite staleMs: 0.
    await engine.tick()
    expect(engine.inFlight()).toBe(1) // still exactly the one live job: no duplicate, no age-out

    const source = new LocalGitSource('check', dir)
    const { state } = await source.readState(toyRef(dir))
    const ledger = parseLedger(state)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ role: 'analyst', cost_usd: null, failed: false }) // still open, never touched

    // Resolve it so the test leaves no dangling promise/timer behind.
    const callback = makeRunnerCallback(engine, remote)
    const [intent] = callback.pendingIntents()
    remote.resolveOutcome(intent!.key, { ok: true, costUsd: 0.1, tokensIn: 10, tokensOut: 5, error: null })
    await engine.drain()
  })

  it('a stale entry with no live remote dispatch IS aged out, and a killed workstation converges on retry', async () => {
    // Engine 1 dispatches, then is abandoned before the workstation ever
    // reports — the runner-agent analogue of hardening.test.ts's crash-recovery
    // drill (a killed workstation, not a killed local harness process). A 24h
    // roleTimeoutMs keeps RemoteDispatcher's own internal timeout — which,
    // unlike a hung local FakeDispatcher promise, is a real timer — from ever
    // firing within this (or any) test run; engine1 is simply never ticked or
    // drained again, exactly like the M4 drill's "process state is abandoned".
    const { dir } = makeToyRepo()
    const remote1 = new RemoteDispatcher()
    const engine1 = new Engine({
      repoDir: dir,
      identity: BOT,
      dispatcher: remote1,
      registry: TEST_REGISTRY,
      roleTimeoutMs: 24 * 60 * 60 * 1000,
    })
    await engine1.tick() // commits the intent, launches the never-reporting job

    const source = new LocalGitSource('check', dir)
    let { state } = await source.readState(toyRef(dir))
    let ledger = parseLedger(state)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ role: 'analyst', cost_usd: null, failed: false }) // open, no living job anywhere but engine1

    // Engine 2, the restart: a fresh RemoteDispatcher with no pending call
    // for that key. staleMs: 0 ages the orphan out on sight (no live job for
    // it in *this* engine's `this.jobs`) and re-dispatches.
    const remote2 = new RemoteDispatcher()
    const engine2 = new Engine({ repoDir: dir, identity: BOT, dispatcher: remote2, registry: TEST_REGISTRY, staleMs: 0 })
    for (let i = 0; i < 3 && engine2.inFlight() === 0; i++) await engine2.tick()
    expect(engine2.inFlight()).toBe(1)

    state = (await source.readState(toyRef(dir))).state
    ledger = parseLedger(state)
    const analyst = ledger.filter((e) => e.role === 'analyst')
    expect(analyst).toHaveLength(2) // the aged orphan + the fresh re-dispatch
    expect(analyst.filter((e) => e.failed)).toHaveLength(1)
    expect(analyst.filter((e) => !e.failed && e.cost_usd === null)).toHaveLength(1) // the new one, still open

    // The workstation reports success for the re-dispatch, through the same
    // real runner API surface the end-to-end test above exercises.
    const callback2 = makeRunnerCallback(engine2, remote2)
    const runnerApi2 = buildRunnerApi({ token: TOKEN, callback: callback2, repoDir: dir, log: () => {} })!
    const app2 = createApp({ sources: [], runnerApi: runnerApi2 })
    const { intents } = await pollIntents(app2, TOKEN)
    expect(intents).toHaveLength(1)
    const outcome: DispatchOutcome = { ok: true, costUsd: 0.2, tokensIn: 50, tokensOut: 20, error: null }
    await app2.request('/api/runner/claim', authedPost(TOKEN, { key: intents[0]!.key }))
    await app2.request('/api/runner/report', authedPost(TOKEN, { key: intents[0]!.key, outcome }))
    await engine2.drain()
    expect(engine2.inFlight()).toBe(0)

    state = (await source.readState(toyRef(dir))).state
    ledger = parseLedger(state)
    const analystFinal = ledger.filter((e) => e.role === 'analyst')
    expect(analystFinal).toHaveLength(2) // no duplicate re-dispatch beyond the one retry
    const closed = analystFinal.filter((e) => !e.failed)
    expect(closed).toHaveLength(1)
    expect(closed[0]!.cost_usd).toBe(0.2)
    expect(state!.phase).toBe('spec') // one lost dispatch converges to one success — a retry, never an escalation
  })
})
