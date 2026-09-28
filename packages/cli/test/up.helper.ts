// Fixtures for `gateline up`'s tests (#502): toy repositories in directories
// with fixed names, so their ids are fixed (`local/<name>`), fake analysts,
// and a `runUp` harness that records what an operator would see. The toy
// repository and the fake dispatcher are the orchestrator suite's own.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Dispatcher } from '@gateline/orchestrator'
import { vi } from 'vitest'
import { agentCommit, type Clock, deferred, FakeDispatcher, makeToyRepo, SPEC } from '../../orchestrator/test/engine.helper.ts'
import { runUp, type UpDeps, type UpFlags, type UpOutcome } from '../src/up.ts'

export const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
export const git = (dir: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG, ...env } }).trim()

/** The port a refusal test passes to `up`, and then finds nothing listening on. */
export const REFUSAL_PORT = 4413

export interface Toy {
  dir: string
  clock: Clock
}

/**
 * A toy repository (`run/toy`, waiting for its analyst) at `<parent>/<name>`.
 * With `framework` (the default) its default branch also carries `roles/` and
 * `registry/`, so a config entry passes the framework check (MULTI-REPO.md
 * §7.2); without, it has `contracts/` alone and is left out of the set.
 */
export function toyRepo(parent: string, name: string, opts: { framework?: boolean } = {}): Toy {
  const made = makeToyRepo()
  const dir = join(parent, name)
  cpSync(made.dir, dir, { recursive: true })
  rmSync(made.dir, { recursive: true, force: true })
  if (opts.framework !== false) {
    for (const tree of ['roles', 'registry']) {
      mkdirSync(join(dir, tree), { recursive: true })
      writeFileSync(join(dir, tree, '.keep'), '')
    }
    git(dir, ['add', '-A'])
    const date = made.clock.next()
    git(dir, ['commit', '-q', '-m', 'Seed framework layout'], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  }
  return { dir: realpathSync(dir), clock: made.clock }
}

/** Give a toy repository an origin: a bare repository beside it holding its branches. */
export function withBareOrigin(toy: Toy): string {
  const bare = `${toy.dir}-origin.git`
  execFileSync('git', ['clone', '-q', '--bare', toy.dir, bare], { env: { ...process.env, ...NO_CONFIG } })
  git(toy.dir, ['remote', 'add', 'origin', bare])
  git(toy.dir, ['fetch', '-q', 'origin'])
  git(toy.dir, ['remote', 'set-head', 'origin', 'main'])
  return bare
}

/** An analyst that writes its spec at once. */
export const promptSpec = (clock: Clock): FakeDispatcher =>
  new FakeDispatcher((req) => {
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })

/** An analyst held until `open()`, so its job stays in flight. */
export function heldSpec(clock: Clock): { dispatcher: FakeDispatcher; open: () => void } {
  const gate = deferred<void>()
  const dispatcher = new FakeDispatcher(async (req) => {
    await gate.promise
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })
  return { dispatcher, open: () => gate.resolve() }
}

/** A directory of fake binaries put first on PATH: `gh` fails at once, so no test ever reaches GitHub. */
export function fakeGhOnPath(): string {
  const bin = mkdtempSync(join(tmpdir(), 'gateline-up-fake-gh-'))
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho "fake gh: gh is never called for real in these tests" >&2\nexit 1\n')
  chmodSync(join(bin, 'gh'), 0o755)
  process.env.PATH = `${bin}:${process.env.PATH}`
  return bin
}

/** True when nothing accepts a connection on the port. */
export function nothingListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
  })
}

/** Every line `up` printed, in order: `out: ` for standard output, `err: ` for standard error. */
export interface UpRun {
  outcome: UpOutcome
  lines: string[]
  exits: number[]
  signals: (() => void)[]
}

const running: UpOutcome[] = []

/**
 * Run `up` as the command would, with a fake dispatcher per repository and no
 * code-tree monitor unless one is given. `console` is captured for the whole
 * run, as an operator's terminal would show it: the server prints through it.
 */
export async function up(
  flags: Partial<UpFlags>,
  deps: Partial<UpDeps> & { dispatchers?: Record<string, Dispatcher> } = {},
): Promise<UpRun> {
  const lines: string[] = []
  const exits: number[] = []
  const signals: (() => void)[] = []
  const out = (...a: unknown[]) => lines.push(`out: ${a.join(' ')}`)
  const err = (...a: unknown[]) => lines.push(`err: ${a.join(' ')}`)
  const spies = [vi.spyOn(console, 'log').mockImplementation(out), vi.spyOn(console, 'error').mockImplementation(err), vi.spyOn(console, 'warn').mockImplementation(err)]
  const { dispatchers, ...rest } = deps
  const outcome = await runUp(
    { repo: [], port: 0, host: '127.0.0.1', open: false, adapter: [], ...flags },
    {
      log: (line) => console.log(line),
      error: (line) => console.error(line),
      exit: (code) => exits.push(code),
      onSignal: (handler) => signals.push(handler),
      codeRepo: null,
      // Outside any repository unless a test says otherwise, so a set from the
      // config file is not compared with this checkout.
      cwd: realpathSync(tmpdir()),
      dispatcher: dispatchers ? (id) => dispatchers[id] : undefined,
      ...rest,
    },
  )
  running.push(outcome)
  // Keep capturing: the engines log after `up` returns. Restored by `stopAll`.
  captured.push(...spies)
  return { outcome, lines, exits, signals }
}

const captured: { mockRestore(): void }[] = []

/** Stop every `up` a test started, and give `console` back. */
export async function stopAll(): Promise<void> {
  for (const outcome of running.splice(0)) {
    if (!outcome.ok) continue
    await outcome.orchestrators.stop()
    outcome.server.close()
  }
  for (const spy of captured.splice(0)) spy.mockRestore()
}
