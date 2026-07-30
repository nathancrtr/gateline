// Live smoke of the runner-agent path (run "runner-agent", task 06, R10): one
// real dispatch round-trips through the FULL remote path — a real HTTP
// control plane, a real workstation agent child process, and a real
// claude-code headless invocation — proving the plumbing this run built
// (RemoteDispatcher, the runner API, the workstation agent) against the
// actual harness, not stubs. `live-smoke.test.ts` proves HeadlessDispatcher's
// invocation+usage plumbing in isolation, one level down the stack; this
// proves the same plumbing survives a real network hop to a real child
// process, a real disposable git clone, and back through the engine's
// closing bookkeeping (AC10.1). Opt-in (real spend): ORCH_LIVE_SMOKE_RUNNER=1.
// Run from the repo root:
//   ORCH_LIVE_SMOKE_RUNNER=1 npx vitest run packages/orchestrator/test/live-smoke-runner.test.ts
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

const live = process.env.ORCH_LIVE_SMOKE_RUNNER === '1'

const BOT = { name: 'agentic-orchestrator', email: 'orchestrator@agentic.invalid' }
const TOKEN = 'runner-live-smoke-secret'
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: GIT_ENV }).trim()

/** A real bare "origin" — a snapshot of `dir` at call time — the workstation
 *  agent clones from, and `foldHarvestBranch`/`repoUrl()` (control plane
 *  side) fetch/resolve against. Mirrors harvest-fold.test.ts's own
 *  `addOrigin` helper, duplicated here rather than shared — this file's
 *  file_contact_surface is only itself. */
function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  return bare
}

/** A minimal fetch-handler HTTP listener for a real socket the workstation's
 *  child process can reach. Deliberately not `@hono/node-server` (not a
 *  declared dependency of this package — wiring.test.ts already relies on
 *  `hono`'s *types* transitively through `@agentic/server`'s `createApp`
 *  return type, but a real listening socket needs no additional runtime
 *  dependency: `node:http` plus the platform's own Fetch API, global since
 *  Node 18, is enough to adapt one to the other). */
function listen(app: { fetch: (req: Request) => Response | Promise<Response> }): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const body = chunks.length ? Buffer.concat(chunks) : undefined
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) headers.set(k, v.join(', '))
          else if (v) headers.set(k, v)
        }
        const noBody = req.method === 'GET' || req.method === 'HEAD'
        const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: noBody ? undefined : body })
        const response = await app.fetch(request)
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })()
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolvePromise({ url: `http://127.0.0.1:${port}`, close: () => new Promise((res) => server.close(() => res())) })
    })
  })
}

describe.skipIf(!live)('runner-agent path (live)', () => {
  it(
    'a real dispatch round-trips control plane -> workstation agent child process -> real claude-code harness -> ledger',
    { timeout: 300_000 },
    async () => {
      const { dir } = makeToyRepo()
      let bare = ''
      let workDir = ''
      let stop: (() => Promise<void>) | undefined
      let child: ChildProcess | undefined
      try {
        // The real claude-code adapter manifest, with the same override the
        // local HeadlessDispatcher smoke test (live-smoke.test.ts) uses: the
        // manifest normally names a subagent via {role}/{body}, but this
        // smoke only proves invocation+metering plumbing, not a real analyst
        // run — hardcoding dispatch_prompt to the neutral prompt keeps the
        // real, paid harness invocation cheap and predictable regardless of
        // what body the engine's own promptBody() generates for whichever
        // role it dispatches first (buildCommand's {prompt} substitution has
        // nothing left to substitute against once {role}/{body} are absent
        // from the template, so the literal string is what the harness sees).
        const repoRoot = resolve(fileURLToPath(import.meta.url), '../../../..')
        const manifest = JSON.parse(readFileSync(join(repoRoot, 'adapters/claude-code/manifest.json'), 'utf8'))
        manifest.headless.dispatch_prompt = 'Reply with exactly the word: pong'

        git(dir, ['checkout', '-q', 'run/toy'])
        mkdirSync(join(dir, 'adapters/claude-code'), { recursive: true })
        writeFileSync(join(dir, 'adapters/claude-code/manifest.json'), JSON.stringify(manifest, null, 2))
        git(dir, ['add', '-A'])
        git(dir, ['commit', '-q', '-m', 'toy: claude-code adapter (live smoke)'])
        git(dir, ['checkout', '-q', 'main'])
        bare = addOrigin(dir)

        const remote = new RemoteDispatcher()
        const engine = new Engine({
          repoDir: dir,
          identity: BOT,
          dispatcher: remote,
          registry: TEST_REGISTRY,
          staleMs: 10 * 60_000,
          roleTimeoutMs: 240_000,
        })
        // Decorates the production callback (start.ts's own adapter, used by
        // the real orchestrator assembly) rather than reimplementing it, so
        // this test rides the same wiring wiring.test.ts already proves —
        // only capturing the reported outcome for direct assertions below,
        // mirroring live-smoke.test.ts's assertions on `dispatch()`'s own
        // return value (not just the ledger it eventually lands in).
        const baseCallback = makeRunnerCallback(engine, remote)
        let capturedOutcome: DispatchOutcome | undefined
        const callback = {
          pendingIntents: baseCallback.pendingIntents,
          resolveOutcome: (key: string, outcome: DispatchOutcome) => {
            capturedOutcome = outcome
            return baseCallback.resolveOutcome(key, outcome)
          },
        }
        const runnerApi = buildRunnerApi({ token: TOKEN, callback, repoDir: dir, log: (l) => console.log(`[control-plane] ${l}`) })!
        const app = createApp({ sources: [], runnerApi })
        const server = await listen(app)
        stop = server.close

        workDir = mkdtempSync(join(tmpdir(), 'agentic-runner-agent-live-work-'))
        const mainTs = resolve(dirname(fileURLToPath(import.meta.url)), '../../runner-agent/src/main.ts')
        child = spawn(
          process.execPath,
          [mainTs, '--control-plane', server.url, '--token', TOKEN, '--adapter', 'claude-code', '--work-dir', workDir, '--poll-interval', '2'],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        child.stdout?.on('data', (d: Buffer) => console.log(`[runner-agent] ${d.toString().trimEnd()}`))
        child.stderr?.on('data', (d: Buffer) => console.error(`[runner-agent] ${d.toString().trimEnd()}`))

        const outcomes = await engine.tick()
        expect(outcomes[0]?.launched).toBe(1)
        expect(engine.inFlight()).toBe(1)

        // Waits for the workstation to claim, execute (via the real `claude`
        // CLI login the operator's environment provides — the same
        // assumption live-smoke.test.ts makes), and report; `drain()` only
        // resolves once the engine's own closing commit (closeDispatch) has
        // landed, so this also proves the ledger-closing half, not just the
        // dispatcher promise settling.
        await engine.drain()
        expect(engine.inFlight()).toBe(0)

        expect(capturedOutcome?.ok).toBe(true)
        expect(capturedOutcome?.error).toBeNull()
        expect(capturedOutcome?.costUsd).toBeGreaterThan(0)
        expect(capturedOutcome?.tokensIn).toBeGreaterThan(0)
        expect(capturedOutcome?.tokensOut).toBeGreaterThan(0)

        const source = new LocalGitSource('check', dir)
        const { state } = await source.readState(toyRef(dir))
        const ledger = parseLedger(state)
        expect(ledger).toHaveLength(1)
        const entry = ledger[0]!
        expect(entry.failed).toBe(false)
        expect(entry.cost_usd).toBeGreaterThan(0)
        expect(entry.tokens_in).toBeGreaterThan(0)
        expect(entry.tokens_out).toBeGreaterThan(0)
      } finally {
        child?.kill('SIGKILL')
        await stop?.()
        rmSync(dir, { recursive: true, force: true })
        if (bare) rmSync(bare, { recursive: true, force: true })
        if (workDir) rmSync(workDir, { recursive: true, force: true })
      }
    },
  )
})
