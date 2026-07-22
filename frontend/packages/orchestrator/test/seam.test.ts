// The dispatch seam's wall clock: at timeout the whole harness process group
// dies, promptly and visibly — children can neither outlive the kill and
// keep spending, nor hold the stdio pipes open and delay the closing commit
// (the fleetview-design task-11 failure: a 30-min kill whose close landed 17
// minutes late, labeled only "Command failed: claude -p …").
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import type { HeadlessManifest } from '../src/manifest.ts'
import { HeadlessDispatcher } from '../src/seam.ts'

const shManifest = (script: string): HeadlessManifest => ({
  adapter: 'toy-sh',
  command: ['sh', '-c', script],
  dispatchPrompt: '{body}',
  usage: { format: 'json-stdout', fields: { cost_usd: 'cost', tokens_in: 'in', tokens_out: 'out' } },
  modelMap: {},
  modelOverrides: {},
  modelVendors: {},
})

const req = { cwd: tmpdir(), role: 'implementer', body: 'x', timeoutMs: 300 }

describe('the dispatch seam timeout', () => {
  it('parses usage when the harness completes in time', async () => {
    const dispatcher = new HeadlessDispatcher(shManifest('echo \'{"cost":1.5,"in":10,"out":20}\''))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(true)
    expect(outcome.error).toBeNull()
    expect(outcome.costUsd).toBe(1.5)
    expect(outcome.tokensIn).toBe(10)
    expect(outcome.tokensOut).toBe(20)
  })

  it('names a timeout instead of the generic exec failure', async () => {
    const dispatcher = new HeadlessDispatcher(shManifest('sleep 30'))
    const outcome = await dispatcher.dispatch(req)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/timed out after .* wall clock .*SIGKILL/)
    expect(outcome.costUsd).toBeNull() // the engine meters at the static estimate
  })

  it('kills the whole group: a child holding stdout cannot delay the close', { timeout: 15_000 }, async () => {
    // The backgrounded sleep inherits the stdout pipe; killing only the
    // shell would leave the callback — and so the closing commit — waiting
    // on the orphan for the remaining ~30s.
    const dispatcher = new HeadlessDispatcher(shManifest('sleep 30 & sleep 30'))
    const started = Date.now()
    const outcome = await dispatcher.dispatch(req)
    expect(outcome.ok).toBe(false)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('reports a prompt exit-code failure with the harness message intact', async () => {
    const dispatcher = new HeadlessDispatcher(shManifest('echo boom >&2; exit 3'))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).not.toMatch(/timed out/)
    expect(outcome.error).toContain('Command failed')
  })
})
