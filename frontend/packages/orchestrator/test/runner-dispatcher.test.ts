// The relay half of the runner (run "runner-agent", task 02): dispatch() never
// touches a process or a filesystem — it parks a promise that only a stubbed
// "remote agent" here (calling pendingIntents()/resolveOutcome() directly, the
// same surface the runner API — task 03 — will expose over HTTP) ever settles.
import { describe, expect, it } from 'vitest'
import type { DispatchOutcome, DispatchRequest } from '../src/seam.ts'
import { RemoteDispatcher, type OpenLedgerEntry } from '../src/runner-dispatcher.ts'

const req = (over: Partial<DispatchRequest> = {}): DispatchRequest => ({
  cwd: '/nonexistent/never-read',
  role: 'implementer',
  body: 'do the thing',
  timeoutMs: 30_000,
  slug: 'toy',
  branch: 'run/toy',
  ...over,
})

const OK: DispatchOutcome = { ok: true, costUsd: 0.42, tokensIn: 100, tokensOut: 50, error: null }
const FAIL: DispatchOutcome = { ok: false, costUsd: null, tokensIn: null, tokensOut: null, error: 'harness reported an error' }

describe('RemoteDispatcher.dispatch — validation', () => {
  it('throws when slug is missing', () => {
    const dispatcher = new RemoteDispatcher()
    expect(() => dispatcher.dispatch(req({ slug: undefined }))).toThrow(/slug/)
  })

  it('throws when branch is missing', () => {
    const dispatcher = new RemoteDispatcher()
    expect(() => dispatcher.dispatch(req({ branch: undefined }))).toThrow(/branch/)
  })

  it('never reads req.cwd to resolve a workstation path (AC2.1: no shared-filesystem assumption)', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req())
    const [intent] = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: null, round: null }])
    expect(intent).toBeDefined()
    // The intent carries only run-identity fields the workstation can act on
    // remotely — never req.cwd's local path.
    expect(Object.values(intent!)).not.toContain(req().cwd)
    dispatcher.resolveOutcome(intent!.key, OK)
    await pending
  })
})

describe('RemoteDispatcher — success path', () => {
  it('dispatch() resolves with the outcome the stubbed remote agent reports', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req({ role: 'analyst', body: 'write the spec' }))

    const openEntries: OpenLedgerEntry[] = [{ slug: 'toy', role: 'analyst', task: null, round: null }]
    const intents = dispatcher.pendingIntents(openEntries)
    expect(intents).toHaveLength(1)
    expect(intents[0]).toMatchObject({
      slug: 'toy',
      branch: 'run/toy',
      role: 'analyst',
      task: null,
      round: null,
      body: 'write the spec',
      timeoutMs: 30_000,
    })

    // The workstation "reports" — stubbed here as a direct resolveOutcome call.
    const resolved = dispatcher.resolveOutcome(intents[0]!.key, OK)
    expect(resolved).toBe(true)

    const outcome = await pending
    expect(outcome).toEqual(OK)
  })

  it('pendingIntents is idempotent: a second poll before resolution returns the same key', () => {
    const dispatcher = new RemoteDispatcher()
    dispatcher.dispatch(req({ role: 'architect' }))
    const openEntries: OpenLedgerEntry[] = [{ slug: 'toy', role: 'architect', task: null, round: null }]
    const first = dispatcher.pendingIntents(openEntries)
    const second = dispatcher.pendingIntents(openEntries)
    expect(second).toHaveLength(1)
    expect(second[0]!.key).toBe(first[0]!.key)
  })

  it('an open ledger entry with no matching pending dispatch yields no intent', () => {
    const dispatcher = new RemoteDispatcher()
    const intents = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: 't1', round: null }])
    expect(intents).toHaveLength(0)
  })

  it('correlates parallel same-role dispatches (distinct tasks) to distinct ledger entries in issue order', async () => {
    const dispatcher = new RemoteDispatcher()
    const first = dispatcher.dispatch(req({ role: 'implementer', body: 'task one' }))
    const second = dispatcher.dispatch(req({ role: 'implementer', body: 'task two' }))

    const openEntries: OpenLedgerEntry[] = [
      { slug: 'toy', role: 'implementer', task: '01-a', round: null },
      { slug: 'toy', role: 'implementer', task: '02-b', round: null },
    ]
    const intents = dispatcher.pendingIntents(openEntries)
    expect(intents).toHaveLength(2)
    expect(intents[0]).toMatchObject({ task: '01-a', body: 'task one' })
    expect(intents[1]).toMatchObject({ task: '02-b', body: 'task two' })

    dispatcher.resolveOutcome(intents[0]!.key, OK)
    dispatcher.resolveOutcome(intents[1]!.key, FAIL)
    await expect(first).resolves.toEqual(OK)
    await expect(second).resolves.toEqual(FAIL)
  })
})

describe('RemoteDispatcher — failure path', () => {
  it('dispatch() resolves (not rejects) with an ok:false outcome when the workstation reports a failure', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req())
    const [intent] = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: null, round: null }])
    dispatcher.resolveOutcome(intent!.key, FAIL)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('harness reported an error')
  })

  it('resolveOutcome on an unknown key is a no-op that returns false', () => {
    const dispatcher = new RemoteDispatcher()
    expect(dispatcher.resolveOutcome('toy|implementer||', OK)).toBe(false)
  })

  it('resolveOutcome twice for the same key only settles the promise once (second call is a no-op)', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req())
    const [intent] = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: null, round: null }])
    expect(dispatcher.resolveOutcome(intent!.key, OK)).toBe(true)
    expect(dispatcher.resolveOutcome(intent!.key, FAIL)).toBe(false)
    await expect(pending).resolves.toEqual(OK)
  })
})

describe('RemoteDispatcher — timeout path', () => {
  it('dispatch() rejects when no report arrives before timeoutMs', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req({ timeoutMs: 20 }))
    await expect(pending).rejects.toThrow(/timed out/)
  })

  it('a timed-out dispatch is no longer resolvable — a late report is a no-op', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req({ timeoutMs: 20 }))
    const [intent] = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: null, round: null }])
    await expect(pending).rejects.toThrow(/timed out/)
    expect(dispatcher.resolveOutcome(intent!.key, OK)).toBe(false)
  })

  it('a timed-out dispatch is removed from pendingIntents on the next poll', async () => {
    const dispatcher = new RemoteDispatcher()
    const pending = dispatcher.dispatch(req({ timeoutMs: 20 }))
    await pending.catch(() => {})
    const intents = dispatcher.pendingIntents([{ slug: 'toy', role: 'implementer', task: null, round: null }])
    expect(intents).toHaveLength(0)
  })
})

describe('RemoteDispatcher.adapter', () => {
  it('defaults to "runner" and is overridable, for the ledger\'s adapter field', () => {
    expect(new RemoteDispatcher().adapter).toBe('runner')
    expect(new RemoteDispatcher('copilot-cli').adapter).toBe('copilot-cli')
  })
})
