// The dispatch seam's wall clock: at timeout the whole harness process group
// dies, promptly and visibly — children can neither outlive the kill and
// keep spending, nor hold the stdio pipes open and delay the closing commit
// (the fleetview-design task-11 failure: a 30-min kill whose close landed 17
// minutes late, labeled only "Command failed: claude -p …").
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import type { HeadlessManifest } from '../src/manifest.ts'
import { HeadlessDispatcher } from '../src/seam.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import { agentCommit, FakeDispatcher, makeToyRepo, SPEC, TEST_REGISTRY } from './engine.helper.ts'

const shManifest = (script: string): HeadlessManifest => ({
  adapter: 'toy-sh',
  command: ['sh', '-c', script],
  dispatchPrompt: '{body}',
  usage: { format: 'json-stdout', fields: { cost_usd: 'cost', tokens_in: 'in', tokens_out: 'out' } },
  modelMap: {},
  modelOverrides: {},
  modelVendors: {},
})

const ndjsonManifest = (script: string, opts: Partial<HeadlessManifest['usage']> = {}): HeadlessManifest => ({
  adapter: 'toy-ndjson',
  command: ['sh', '-c', script],
  dispatchPrompt: '{body}',
  usage: {
    format: 'ndjson-sum',
    lineFilter: { type: 'step_finish' },
    fields: { cost_usd: 'part.cost', tokens_in: 'part.tokens.input', tokens_out: 'part.tokens.output' },
    ...opts,
  },
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

describe('usage_report format ndjson-sum (opencode: one step_finish event per agent turn)', () => {
  const twoTurnScript = [
    'printf',
    "'%s\\n'",
    `'{"type":"step_start"}'`,
    `'{"type":"tool_use"}'`,
    `'{"type":"step_finish","part":{"cost":0.004602636,"tokens":{"input":6099,"output":61}}}'`,
    `'{"type":"step_start"}'`,
    `'{"type":"text"}'`,
    `'{"type":"step_finish","part":{"cost":0.001549512,"tokens":{"input":192,"output":52}}}'`,
  ].join(' ')

  it('sums cost and tokens across every step_finish event, not just the last', async () => {
    const dispatcher = new HeadlessDispatcher(ndjsonManifest(twoTurnScript))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(true)
    // A single-object parse (json-stdout's fallback) would only see the last
    // line — cost 0.001549512, tokens_in 192 — silently dropping the first
    // turn. The real total is the sum of both step_finish events.
    expect(outcome.costUsd).toBeCloseTo(0.006152148, 9)
    expect(outcome.tokensIn).toBe(6291)
    expect(outcome.tokensOut).toBe(113)
  })

  it('ignores lines that do not match line_filter (step_start/tool_use/text have no cost)', async () => {
    const dispatcher = new HeadlessDispatcher(ndjsonManifest(twoTurnScript))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    // If non-matching lines leaked into the sum, this would throw (they carry no `part`).
    expect(outcome.costUsd).not.toBeNull()
  })

  it('skips malformed lines instead of failing the whole parse', async () => {
    const script = [
      'printf',
      "'%s\\n'",
      `'not json'`,
      `'{"type":"step_finish","part":{"cost":0.5,"tokens":{"input":10,"output":5}}}'`,
    ].join(' ')
    const dispatcher = new HeadlessDispatcher(ndjsonManifest(script))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(true)
    expect(outcome.costUsd).toBe(0.5)
  })

  it('reports null, not zero, when no line matches the filter', async () => {
    const dispatcher = new HeadlessDispatcher(ndjsonManifest(`printf '%s\\n' '{"type":"step_start"}'`))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(true)
    expect(outcome.costUsd).toBeNull()
    expect(outcome.tokensIn).toBeNull()
    expect(outcome.tokensOut).toBeNull()
  })

  it('falls back to the harness failure message when no JSON parses at all', async () => {
    const dispatcher = new HeadlessDispatcher(ndjsonManifest(`printf 'no json here at all'`))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('harness produced no parseable JSON output')
  })
})

describe('the engine threads run identity through the seam (R2)', () => {
  const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }

  it("launch() passes the run's slug and branch in the DispatchRequest", async () => {
    const { dir, clock } = makeToyRepo()
    const dispatcher = new FakeDispatcher((req) => {
      if (req.role === 'analyst') agentCommit(req.cwd, clock, { 'runs/toy/spec.md': SPEC }, 'toy: spec')
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000 })
    try {
      await engine.tick()
      await engine.drain()
      expect(dispatcher.calls.length).toBeGreaterThan(0)
      const call = dispatcher.calls[0]!
      expect(call.slug).toBe('toy')
      expect(call.branch).toBe('run/toy')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

describe('operator force-drain (#150)', () => {
  it('abortAll kills the live group and the outcome names the operator abort, not a generic failure', async () => {
    const dispatcher = new HeadlessDispatcher(shManifest('sleep 30'))
    const pending = dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    await new Promise((r) => setTimeout(r, 200)) // let the child spawn
    expect(dispatcher.abortAll()).toBe(1)
    const outcome = await pending
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/aborted by the operator during drain/)
    expect(outcome.error).not.toMatch(/timed out/)
  })

  it('abortAll with nothing live signals nothing', async () => {
    const dispatcher = new HeadlessDispatcher(shManifest("echo '{\"cost\":1,\"in\":1,\"out\":1}'"))
    const outcome = await dispatcher.dispatch({ ...req, timeoutMs: 30_000 })
    expect(outcome.ok).toBe(true)
    expect(dispatcher.abortAll()).toBe(0)
  })
})
