// The `up` command itself (review of #550): its flags reach `runUp` as typed,
// and its process wiring installs the staged shutdown. The command is spawned
// for real, always against a generated repository with NO adapter manifest,
// so assembly refuses every time and nothing can be dispatched: the startup
// summary is printed, then the refusal, then exit 1, before any server
// listens. The dependencies the command hands `runUp` are unit-tested through
// `processDeps`, since a spawned `up` that got as far as signals would be one
// that could dispatch.
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { processDeps } from '../src/up.ts'
import { git, nothingListening, REFUSAL_PORT, toyRepo } from './up.helper.ts'

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')
let xdg: string
let parent: string
let toy: string

beforeAll(() => {
  xdg = mkdtempSync(join(tmpdir(), 'gateline-up-cmd-xdg-'))
  parent = realpathSync(mkdtempSync(join(tmpdir(), 'gateline-up-cmd-')))
  toy = toyRepo(parent, 'toy').dir
})
afterAll(() => {
  rmSync(xdg, { recursive: true, force: true })
  rmSync(parent, { recursive: true, force: true })
})

/** Run `gateline --repo <toy> up <args>` for real; it always refuses. */
function upCommand(args: string[], opts: { repo?: boolean } = {}): Promise<{ code: number; out: string[]; err: string[] }> {
  const argv = [cliPath, ...(opts.repo === false ? [] : ['--repo', toy]), 'up', '--no-open', '--port', String(REFUSAL_PORT), ...args]
  return new Promise((resolvePromise) => {
    execFile(
      'node',
      argv,
      { cwd: parent, env: { ...process.env, XDG_CONFIG_HOME: xdg, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number }).code ?? 1) : 0
        resolvePromise({ code, out: stdout.split('\n').filter(Boolean), err: stderr.split('\n').filter(Boolean) })
      },
    )
  })
}

function config(body: string): void {
  mkdirSync(join(xdg, 'gateline'), { recursive: true })
  writeFileSync(join(xdg, 'gateline', 'config.yaml'), body)
}
const noConfig = () => rmSync(join(xdg, 'gateline', 'config.yaml'), { force: true })

const MISSING = (adapter: string) =>
  `toy (local/toy at ${toy}): adapter "${adapter}": no adapters/${adapter}/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there`

describe('the up command maps each flag onto what up runs under', () => {
  it('every limit and engine flag, as typed', { timeout: 60_000 }, async () => {
    noConfig()
    const r = await upCommand([
      '--spend-limit-usd',
      '12',
      '--spend-window',
      '6',
      '--max-concurrent-dispatches',
      '3',
      '--engine-name',
      'cmd-engine',
      '--heartbeat',
      '60',
      '--role-timeout',
      '900',
      '--adapter',
      'opencode',
      '--no-budget-enforcement',
    ])
    expect(r.code).toBe(1)
    expect(r.out).toEqual([
      'up: 1 repository from --repo; an engine in it',
      'limits: at most 3 dispatches at once across every repository (--max-concurrent-dispatches)',
      'limits: machine spend limit $12 per 6 h across every dispatch repository (--spend-limit-usd; window: --spend-window) — not enforced',
      'limits: budget enforcement OFF (--no-budget-enforcement) — spend is metered, and no spend limit, ceiling or per-run cap holds a dispatch back; the concurrency limit still does',
      'engine name: cmd-engine (--engine-name)',
      'engine: adapters opencode (--adapter); role timeout 900 s (--role-timeout); heartbeat 60 s (--heartbeat)',
      'repository local/toy (toy): dispatch, engine; local-only (no origin remote); no spend ceiling of its own',
    ])
    expect(r.err).toEqual([MISSING('opencode')])
    expect(await nothingListening(REFUSAL_PORT)).toBe(true)
    expect(git(toy, ['log', '--format=%s', '-1', 'run/toy'])).toBe('toy: intent brief')
  })

  it('with no flags, every value is the default', { timeout: 60_000 }, async () => {
    noConfig()
    const r = await upCommand(['--engine-name', 'cmd-engine'])
    expect(r.code).toBe(1)
    expect(r.out.slice(1, 6)).toEqual([
      'limits: at most 2 dispatches at once across every repository (default)',
      'limits: no machine spend limit (default)',
      'limits: budget enforcement on (default)',
      'engine name: cmd-engine (--engine-name)',
      'engine: adapters claude-code (default); role timeout 1800 s (default); heartbeat 180 s (default)',
    ])
    expect(r.err).toEqual([MISSING('claude-code')])
  })

  it('--budget-enforcement overrides the config’s false; both flags are refused', { timeout: 60_000 }, async () => {
    config(`engine:\n  budget_enforcement: false\nrepositories:\n  - path: ${toy}\n    mode: dispatch\n`)
    const on = await upCommand(['--budget-enforcement', '--engine-name', 'cmd-engine'], { repo: false })
    expect(on.out[3]).toBe("limits: budget enforcement on (--budget-enforcement, over the config's engine.budget_enforcement: false)")
    noConfig()
    const both = await upCommand(['--budget-enforcement', '--no-budget-enforcement'])
    expect([both.code, both.out, both.err]).toEqual([1, [], ['--budget-enforcement and --no-budget-enforcement are both given — pick one']])
  })

  it.each([
    [['--spend-limit-usd', '10abc'], '--spend-limit-usd must be a number'],
    [['--spend-limit-usd', '0x10'], '--spend-limit-usd must be a number'],
    [['--spend-limit-usd', ''], '--spend-limit-usd must be a number'],
    [['--max-concurrent-dispatches', '3x'], '--max-concurrent-dispatches must be a number'],
    [['--max-concurrent-dispatches', '2.5'], '--max-concurrent-dispatches must be a whole number (got 2.5)'],
    [['--heartbeat', '3000000'], '--heartbeat must be at most 2147483 seconds (got 3000000): a longer timer is cut to 1 ms by Node'],
    [['--role-timeout', '-1'], '--role-timeout must be greater than 0 (got -1)'],
    [['--port', 'abc'], '--port must be a whole number from 0 to 65535 (got NaN)'],
    [['--engine-name', 'a b'], '--engine-name: engine name "a b" may contain only letters, digits, ".", "_" and "-" (no ":", "#" or whitespace)'],
  ])('refuses %j before reading anything', { timeout: 60_000 }, async (args, message) => {
    noConfig()
    const r = await upCommand(args)
    expect([r.code, r.out, r.err]).toEqual([1, [], [message]])
  })
})

describe('processDeps: what the command hands runUp from the real process', () => {
  it('installs one handler for SIGINT and SIGTERM, exits through process.exit, and writes to the console', () => {
    const on: [string, unknown][] = []
    const exits: number[] = []
    const out: string[] = []
    const deps = processDeps(
      {
        on: ((event: string, handler: unknown) => {
          on.push([event, handler])
          return process
        }) as NodeJS.Process['on'],
        exit: ((code: number) => {
          exits.push(code)
        }) as NodeJS.Process['exit'],
      },
      { log: (line: string) => out.push(`log ${line}`), error: (line: string) => out.push(`error ${line}`) },
    )
    const handler = () => {}
    deps.onSignal(handler)
    expect(on).toEqual([
      ['SIGINT', handler],
      ['SIGTERM', handler],
    ])
    deps.exit(75)
    expect(exits).toEqual([75])
    deps.log('a')
    deps.error('b')
    expect(out).toEqual(['log a', 'error b'])
  })
})
