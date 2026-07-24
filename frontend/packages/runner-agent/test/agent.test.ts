import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HeadlessManifest } from '@agentic/orchestrator'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCommand,
  computeOutcome,
  ControlPlaneClient,
  executeIntent,
  runAgent,
  type DispatchOutcome,
  type PendingIntent,
} from '../src/agent.ts'
import type { Workspace } from '../src/workspace.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(__dirname, '..', 'src')
const sourceOf = (file: string) => readFileSync(join(SRC_DIR, file), 'utf8')

const shManifest = (script: string, opts: Partial<HeadlessManifest['usage']> = {}): HeadlessManifest => ({
  adapter: 'toy-sh',
  command: ['sh', '-c', script],
  dispatchPrompt: '{body}',
  usage: { format: 'json-stdout', fields: { cost_usd: 'cost', tokens_in: 'in', tokens_out: 'out' }, ...opts },
  modelMap: {},
  modelOverrides: {},
  modelVendors: {},
})

const INTENT: PendingIntent = {
  key: 'toy|implementer|01-core|1',
  slug: 'toy',
  branch: 'run/toy',
  role: 'implementer',
  task: '01-core',
  round: 1,
  body: 'build the thing',
  timeoutMs: 30_000,
}

describe('buildCommand (adapter-generic argv construction, AC8.1/AC8.2)', () => {
  it('substitutes {role}/{body} into dispatchPrompt, then {prompt}/{role} into command', () => {
    const manifest: HeadlessManifest = {
      adapter: 'toy-a',
      command: ['run-toy-a', '--role', '{role}', '--prompt', '{prompt}'],
      dispatchPrompt: 'You are the {role}. Task: {body}',
      usage: { format: 'static-estimate' },
      modelMap: {},
      modelOverrides: {},
      modelVendors: {},
    }
    const argv = buildCommand(manifest, 'implementer', 'build the thing')
    expect(argv).toEqual(['run-toy-a', '--role', 'implementer', '--prompt', 'You are the implementer. Task: build the thing'])
  })

  it('a different adapter manifest produces a different command from the same function — zero code branching on adapter identity (AC8.2)', () => {
    const manifestA: HeadlessManifest = {
      adapter: 'toy-a',
      command: ['toy-a-cli', '-p', '{prompt}'],
      dispatchPrompt: '{body}',
      usage: { format: 'static-estimate' },
      modelMap: {},
      modelOverrides: {},
      modelVendors: {},
    }
    const manifestB: HeadlessManifest = {
      adapter: 'toy-b',
      command: ['toy-b-harness', '--json', '--message', '{prompt}'],
      dispatchPrompt: '[{role}] {body}',
      usage: { format: 'static-estimate' },
      modelMap: {},
      modelOverrides: {},
      modelVendors: {},
    }
    const argvA = buildCommand(manifestA, 'implementer', 'do X')
    const argvB = buildCommand(manifestB, 'implementer', 'do X')
    expect(argvA).toEqual(['toy-a-cli', '-p', 'do X'])
    expect(argvB).toEqual(['toy-b-harness', '--json', '--message', '[implementer] do X'])
    expect(argvA).not.toEqual(argvB)
  })
})

describe('computeOutcome (a direct port of HeadlessDispatcher.dispatch()\'s usage_report branches)', () => {
  it('static-estimate: ok with null usage on a clean run', () => {
    const outcome = computeOutcome(shManifest('exit 0', { format: 'static-estimate' }), { stdout: '', error: null, timedOut: false }, 30_000)
    expect(outcome).toEqual({ ok: true, costUsd: null, tokensIn: null, tokensOut: null, error: null })
  })

  it('json-stdout: parses fields out of the one JSON object on stdout', () => {
    const manifest = shManifest('irrelevant')
    const outcome = computeOutcome(manifest, { stdout: '{"cost":1.5,"in":10,"out":20}', error: null, timedOut: false }, 30_000)
    expect(outcome).toEqual({ ok: true, costUsd: 1.5, tokensIn: 10, tokensOut: 20, error: null })
  })

  it('json-stdout: no parseable JSON is a failure naming the harness output', () => {
    const manifest = shManifest('irrelevant')
    const outcome = computeOutcome(manifest, { stdout: 'not json', error: null, timedOut: false }, 30_000)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('harness produced no parseable JSON output')
  })

  it('names a timeout distinctly from a generic command failure', () => {
    const manifest = shManifest('irrelevant')
    const outcome = computeOutcome(manifest, { stdout: '', error: null, timedOut: true }, 60_000)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toMatch(/timed out after 1min wall clock.*SIGKILL/)
    expect(outcome.costUsd).toBeNull()
  })

  it('a non-timeout process error is reported verbatim', () => {
    const manifest = shManifest('irrelevant')
    const err = new Error('Command failed (exit 3): sh -c exit 3\nboom')
    const outcome = computeOutcome(manifest, { stdout: '', error: err, timedOut: false }, 30_000)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe(err.message)
  })

  it('ndjson-sum: sums a numeric field across every line matching line_filter, ignoring the rest', () => {
    const manifest = shManifest('irrelevant', {
      format: 'ndjson-sum',
      lineFilter: { type: 'step_finish' },
      fields: { cost_usd: 'part.cost', tokens_in: 'part.tokens.input', tokens_out: 'part.tokens.output' },
    })
    const stdout = [
      '{"type":"step_start"}',
      '{"type":"step_finish","part":{"cost":0.1,"tokens":{"input":10,"output":5}}}',
      '{"type":"step_finish","part":{"cost":0.2,"tokens":{"input":20,"output":15}}}',
    ].join('\n')
    const outcome = computeOutcome(manifest, { stdout, error: null, timedOut: false }, 30_000)
    expect(outcome.ok).toBe(true)
    expect(outcome.costUsd).toBeCloseTo(0.3, 9)
    expect(outcome.tokensIn).toBe(30)
    expect(outcome.tokensOut).toBe(20)
  })

  it('errorField on the last event marks the outcome as not-ok even with exit code 0', () => {
    const manifest = shManifest('irrelevant', { errorField: 'is_error', resultField: 'result' })
    const outcome = computeOutcome(manifest, { stdout: '{"is_error":true,"result":"blew up","cost":0}', error: null, timedOut: false }, 30_000)
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toBe('blew up')
  })
})

describe('executeIntent (workspace + manifest + spawn + outcome, end to end)', () => {
  const fakeWorkspace = (path = '/tmp/fake-ws', removed: { count: number } = { count: 0 }): Workspace => ({
    path,
    remove: async () => {
      removed.count++
    },
  })

  it('produces a DispatchOutcome equivalent in shape to a local HeadlessDispatcher run (AC3.2)', async () => {
    const removed = { count: 0 }
    const outcome = await executeIntent({
      intent: INTENT,
      repoUrl: 'https://example.test/repo.git',
      adapter: 'toy-sh',
      workDir: '/tmp',
      createWorkspaceImpl: async () => fakeWorkspace('/tmp', removed),
      manifestLoaderImpl: async () => shManifest('echo \'{"cost":1,"in":2,"out":3}\''),
      runCommandImpl: async (cmd, args, cwd, timeoutMs) => {
        // Prove the real spawn path runs (not stubbed away) and that cwd/args
        // it was handed came straight through from executeIntent.
        expect(cwd).toBe('/tmp')
        const { runCommand } = await import('../src/agent.ts')
        return runCommand(cmd, args, cwd, timeoutMs)
      },
    })
    expect(outcome).toEqual({ ok: true, costUsd: 1, tokensIn: 2, tokensOut: 3, error: null })
    expect(removed.count).toBe(1) // the workspace is always torn down
  })

  it('removes the workspace even when the command fails', async () => {
    const removed = { count: 0 }
    const outcome = await executeIntent({
      intent: INTENT,
      repoUrl: 'https://example.test/repo.git',
      adapter: 'toy-sh',
      workDir: '/tmp',
      createWorkspaceImpl: async () => fakeWorkspace('/tmp', removed),
      manifestLoaderImpl: async () => shManifest('echo boom >&2; exit 3'),
      runCommandImpl: async (cmd, args, cwd, timeoutMs) => {
        const { runCommand } = await import('../src/agent.ts')
        return runCommand(cmd, args, cwd, timeoutMs)
      },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('Command failed')
    expect(removed.count).toBe(1)
  })

  it('removes the workspace even when the manifest cannot be loaded', async () => {
    const removed = { count: 0 }
    const outcome = await executeIntent({
      intent: INTENT,
      repoUrl: 'https://example.test/repo.git',
      adapter: 'toy-sh',
      workDir: '/tmp',
      createWorkspaceImpl: async () => fakeWorkspace('/tmp', removed),
      manifestLoaderImpl: async () => {
        throw new Error('adapter "toy-sh" has no headless section')
      },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.error).toContain('no headless section')
    expect(removed.count).toBe(1)
  })

  it('threads {role} and {body} from the intent into the actual argv the command sees', async () => {
    const removed = { count: 0 }
    const manifest: HeadlessManifest = {
      adapter: 'toy-echo',
      // Echo the substituted prompt back as JSON so the assertion reads it
      // straight out of the resulting DispatchOutcome-adjacent parse.
      command: ['sh', '-c', 'printf \'{"cost":0,"in":0,"out":0,"seen":"%s"}\' "$1"', 'sh', '{prompt}'],
      dispatchPrompt: 'role={role} body={body}',
      usage: { format: 'json-stdout', fields: { cost_usd: 'cost', tokens_in: 'in', tokens_out: 'out' } },
      modelMap: {},
      modelOverrides: {},
      modelVendors: {},
    }
    const argv = buildCommand(manifest, INTENT.role, INTENT.body)
    expect(argv).toEqual(['sh', '-c', 'printf \'{"cost":0,"in":0,"out":0,"seen":"%s"}\' "$1"', 'sh', 'role=implementer body=build the thing'])

    const outcome = await executeIntent({
      intent: INTENT,
      repoUrl: 'https://example.test/repo.git',
      adapter: 'toy-echo',
      workDir: '/tmp',
      createWorkspaceImpl: async () => fakeWorkspace('/tmp', removed),
      manifestLoaderImpl: async () => manifest,
      runCommandImpl: async (cmd, args, cwd, timeoutMs) => {
        const { runCommand } = await import('../src/agent.ts')
        return runCommand(cmd, args, cwd, timeoutMs)
      },
    })
    expect(outcome.ok).toBe(true)
  })
})

describe('ControlPlaneClient (outbound HTTP only, matching the runner-api.ts contract exactly)', () => {
  it('validate() accepts a 200 and rejects 401/404 with a descriptive error', async () => {
    const ok = new ControlPlaneClient('http://cp.test', 'tok', async () => new Response(JSON.stringify({ intents: [], repoUrl: null }), { status: 200 }))
    await expect(ok.validate()).resolves.toBeUndefined()

    const unauthorized = new ControlPlaneClient('http://cp.test', 'bad', async () => new Response('{}', { status: 401 }))
    await expect(unauthorized.validate()).rejects.toThrow(/401/)

    const notFound = new ControlPlaneClient('http://cp.test', 'tok', async () => new Response('{}', { status: 404 }))
    await expect(notFound.validate()).rejects.toThrow(/404/)
  })

  it('claim() posts the key and reports the server\'s claimed flag', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ key: INTENT.key })
      return new Response(JSON.stringify({ claimed: true }), { status: 200 })
    })
    const client = new ControlPlaneClient('http://cp.test', 'tok', fetchImpl)
    await expect(client.claim(INTENT.key)).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('http://cp.test/api/runner/claim', expect.anything())
  })

  it('report() posts the key and outcome, returning the server\'s resolved flag', async () => {
    const outcome: DispatchOutcome = { ok: true, costUsd: 1, tokensIn: 2, tokensOut: 3, error: null }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ key: INTENT.key, outcome })
      return new Response(JSON.stringify({ resolved: true }), { status: 200 })
    })
    const client = new ControlPlaneClient('http://cp.test', 'tok', fetchImpl)
    await expect(client.report(INTENT.key, outcome)).resolves.toBe(true)
  })
})

describe('runAgent (poll → claim → execute → report lifecycle, against a mock server)', () => {
  it('claims an available intent, executes it, and reports the outcome — never touching the network any other way', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${u}`)
      if (u.endsWith('/api/runner/intents')) {
        return new Response(JSON.stringify({ intents: [INTENT], repoUrl: 'https://example.test/repo.git' }), { status: 200 })
      }
      if (u.endsWith('/api/runner/claim')) {
        expect(JSON.parse(String(init?.body))).toEqual({ key: INTENT.key })
        return new Response(JSON.stringify({ claimed: true }), { status: 200 })
      }
      if (u.endsWith('/api/runner/report')) {
        const body = JSON.parse(String(init?.body)) as { key: string; outcome: DispatchOutcome }
        expect(body.key).toBe(INTENT.key)
        expect(body.outcome).toEqual({ ok: true, costUsd: 1, tokensIn: 2, tokensOut: 3, error: null })
        return new Response(JSON.stringify({ resolved: true }), { status: 200 })
      }
      throw new Error(`unexpected request: ${method} ${u}`)
    })

    const removed = { count: 0 }
    await runAgent({
      controlPlane: 'http://cp.test',
      token: 'tok',
      adapter: 'toy-sh',
      workDir: '/tmp',
      pollIntervalMs: 1,
      maxCycles: 1,
      fetchImpl,
      createWorkspaceImpl: async () => ({ path: '/tmp', remove: async () => void removed.count++ }),
      manifestLoaderImpl: async () => shManifest('echo \'{"cost":1,"in":2,"out":3}\''),
      log: () => {},
    })

    // Startup validate() plus one poll cycle's intents/claim/report — every
    // call went through the injected fetch, i.e. this process opened no
    // socket of its own (AC3.1).
    expect(calls.filter((c) => c.endsWith('/api/runner/intents')).length).toBeGreaterThanOrEqual(2)
    expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/api/runner/claim'))).toBe(true)
    expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/api/runner/report'))).toBe(true)
    expect(removed.count).toBe(1)
  })

  it('skips an intent it fails to claim (already claimed by another workstation) without executing it', async () => {
    let manifestLoaded = false
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/api/runner/intents')) return new Response(JSON.stringify({ intents: [INTENT], repoUrl: 'https://example.test/repo.git' }), { status: 200 })
      if (u.endsWith('/api/runner/claim')) return new Response(JSON.stringify({ claimed: false, reason: 'already-claimed' }), { status: 200 })
      throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${u}`)
    })
    await runAgent({
      controlPlane: 'http://cp.test',
      token: 'tok',
      adapter: 'toy-sh',
      workDir: '/tmp',
      pollIntervalMs: 1,
      maxCycles: 1,
      fetchImpl,
      manifestLoaderImpl: async () => {
        manifestLoaded = true
        return shManifest('echo {}')
      },
      log: () => {},
    })
    expect(manifestLoaded).toBe(false)
  })

  it('falls back to --repo-url only when the control plane reports no repoUrl of its own', async () => {
    let usedRepoUrl: string | undefined
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/api/runner/intents')) return new Response(JSON.stringify({ intents: [INTENT], repoUrl: null }), { status: 200 })
      if (u.endsWith('/api/runner/claim')) return new Response(JSON.stringify({ claimed: true }), { status: 200 })
      if (u.endsWith('/api/runner/report')) return new Response(JSON.stringify({ resolved: true }), { status: 200 })
      throw new Error(`unexpected request: ${u}`)
    })
    await runAgent({
      controlPlane: 'http://cp.test',
      token: 'tok',
      adapter: 'toy-sh',
      workDir: '/tmp',
      pollIntervalMs: 1,
      maxCycles: 1,
      repoUrl: 'https://fallback.test/repo.git',
      fetchImpl,
      createWorkspaceImpl: async (opts) => {
        usedRepoUrl = opts.repoUrl
        return { path: '/tmp', remove: async () => {} }
      },
      manifestLoaderImpl: async () => shManifest('echo \'{"cost":0,"in":0,"out":0}\''),
      log: () => {},
    })
    expect(usedRepoUrl).toBe('https://fallback.test/repo.git')
  })

  it('a poll cycle that throws does not crash the agent — it logs and continues to the next cycle', async () => {
    let cycleCount = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/api/runner/intents')) {
        cycleCount++
        if (cycleCount === 1) return new Response(JSON.stringify({ intents: [], repoUrl: null }), { status: 200 }) // validate()
        if (cycleCount === 2) throw new Error('ECONNRESET')
        return new Response(JSON.stringify({ intents: [], repoUrl: null }), { status: 200 })
      }
      throw new Error(`unexpected request: ${u}`)
    })
    const logs: string[] = []
    await runAgent({
      controlPlane: 'http://cp.test',
      token: 'tok',
      adapter: 'toy-sh',
      workDir: '/tmp',
      pollIntervalMs: 1,
      maxCycles: 2,
      fetchImpl,
      log: (line) => logs.push(line),
    })
    expect(logs.some((l) => l.includes('poll cycle failed') && l.includes('ECONNRESET'))).toBe(true)
  })
})

describe('R3 — outbound connections only (AC3.1)', () => {
  it('the agent source never listens for inbound connections', () => {
    for (const file of ['agent.ts', 'main.ts', 'workspace.ts']) {
      const src = sourceOf(file)
      expect(src).not.toMatch(/createServer\s*\(/)
      expect(src).not.toMatch(/\.listen\s*\(/)
      expect(src).not.toMatch(/Bun\.serve/)
      expect(src).not.toMatch(/node:net['"]/)
      expect(src).not.toMatch(/node:http['"]/)
    }
  })
})

describe('R5 — the control plane remains the sole writer (AC5.1)', () => {
  it('a grep of the agent source shows no call that writes to a run branch, state.yaml, or gates.*', () => {
    for (const file of ['agent.ts', 'main.ts', 'workspace.ts']) {
      const src = sourceOf(file)
      // No git subcommand this file ever passes to execFile/spawn mutates
      // the source repo's history or refs (clone + checkout are read-only
      // from origin's perspective) — in particular, never push or commit.
      expect(src).not.toMatch(/['"`]push['"`]/)
      expect(src).not.toMatch(/['"`]commit['"`]/)
      // No write call targets state.yaml or gates.* (documentation prose
      // mentioning those filenames, e.g. this file's own header comment
      // explaining R5, is not a write call).
      expect(src).not.toMatch(/write\w*\([^)]*state\.yaml/is)
      expect(src).not.toMatch(/write\w*\([^)]*gates\./is)
      expect(src).not.toMatch(/updateRefCAS/)
      expect(src).not.toMatch(/writeState/)
    }
  })
})

describe('R8 — adapter-generic dispatch-execution code (AC8.1)', () => {
  it('a grep of the dispatch-execution source shows no role names or harness/vendor names outside manifest-driven data', () => {
    const roleNames = ['analyst', 'architect', 'implementer', 'reviewer', 'historian', 'integrator', 'verifier']
    const harnessNames = ['claude-code', 'claude', 'copilot-cli', 'copilot', 'opencode', 'anthropic', 'openai', 'gpt-', 'gemini']
    for (const file of ['agent.ts', 'workspace.ts']) {
      const src = sourceOf(file).toLowerCase()
      for (const name of [...roleNames, ...harnessNames]) {
        expect(src.includes(name), `${file} should not mention "${name}"`).toBe(false)
      }
    }
  })
})
