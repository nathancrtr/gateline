// When one repository's engine cannot start, the others that did are stopped
// (review of #550): `start()` rejects naming the repository, and no loop is
// left watching refs, ticking on a timer or dispatching. An assembly error
// names its repository too. Toy repositories and fake dispatchers only.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { engineHealthPath } from '@gateline/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Governor } from '../src/governor.ts'
import { assembleOrchestrators } from '../src/start.ts'
import { agentCommit, type Clock, FakeDispatcher, makeToyRepo, SPEC } from './engine.helper.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG } }).trim()

function toy() {
  const made = makeToyRepo()
  cleanups.push(made.dir)
  return made
}

const promptSpec = (clock: Clock) =>
  new FakeDispatcher((req) => {
    agentCommit(req.cwd, clock, { [`runs/${req.slug}/spec.md`]: SPEC }, `${req.slug}: spec`)
    return {}
  })

describe('start() when one engine cannot start', () => {
  it('stops the loops that started, leaves the governor empty, and names the repository', { timeout: 60_000 }, async () => {
    const a = toy()
    const b = toy()
    const lines: string[] = []
    const set = await assembleOrchestrators({
      repositories: [
        { repoDir: a.dir, repositoryId: 'local/alpha', displayName: 'alpha', dispatcher: promptSpec(a.clock) },
        { repoDir: b.dir, repositoryId: 'local/beta', displayName: 'beta', dispatcher: promptSpec(b.clock) },
      ],
      limits: { maxConcurrentDispatches: 2 },
      heartbeatSeconds: 600,
      codeRepo: null,
      startupTimeoutMs: 5_000,
      engineName: 'test-engine',
      log: (l) => lines.push(l),
    })
    // beta's git directory goes away after assembly: its loop cannot be set up.
    rmSync(join(b.dir, '.git'), { recursive: true, force: true })
    const error = await set.start().then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(error?.message).toMatch(new RegExp(`^beta \\(local/beta at ${b.dir.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\): its engine could not start: `))
    // Nothing of either engine is left with the governor.
    expect(set.governor.registered('local/alpha')).toBe(false)
    expect(set.governor.registered('local/beta')).toBe(false)
    expect((set.governor as Governor).snapshot().occupied).toBe(0)
    // alpha's loop is stopped: a ref that moves now wakes no pass, and no health file is rewritten.
    const healthFile = await engineHealthPath(a.dir)
    // Its startup pass wrote the health file before the stop returned (a loop
    // still running would write it again below).
    await vi.waitFor(() => expect(existsSync(healthFile)).toBe(true), { timeout: 10_000, interval: 50 })
    await new Promise((r) => setTimeout(r, 500))
    const before = readFileSync(healthFile, 'utf8')
    const tipBefore = git(a.dir, ['rev-parse', 'run/toy'])
    git(a.dir, ['branch', 'poke', 'main'])
    writeFileSync(join(a.dir, 'poke.txt'), 'poke\n')
    await new Promise((r) => setTimeout(r, 1_500))
    expect(readFileSync(healthFile, 'utf8')).toBe(before)
    expect(git(a.dir, ['rev-parse', 'run/toy'])).toBe(tipBefore)
    expect(set.engines[0]!.engine.inFlightDetail()).toEqual([])
  })
})

describe('an assembly error names its repository', () => {
  it('prefixes the library’s message with the display name, id and directory', async () => {
    const a = toy()
    const b = toy()
    // No dispatcher for beta: its engine reads its adapter manifests, and it has none.
    const error = await assembleOrchestrators({
      repositories: [
        { repoDir: a.dir, repositoryId: 'local/alpha', displayName: 'alpha', dispatcher: promptSpec(a.clock) },
        { repoDir: b.dir, repositoryId: 'local/beta', displayName: 'beta' },
      ],
      codeRepo: null,
      engineName: 'test-engine',
    }).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(error?.message).toBe(
      `beta (local/beta at ${b.dir}): adapter "claude-code": no adapters/claude-code/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there`,
    )
  })
})
