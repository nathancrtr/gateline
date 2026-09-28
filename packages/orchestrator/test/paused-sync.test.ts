// A paused engine still fetches from origin on its heartbeat and dispatches
// nothing (second review of #550): under `gateline up` the server keeps no
// fetch timer for a repository with an engine, so while the code tree pauses
// dispatch the engine's heartbeat is the only fetch there is. Toy repository,
// fake dispatcher, a throwaway code checkout, a bare origin on disk.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startOrchestrators } from '../src/start.ts'
import { FakeDispatcher, makeToyRepo } from './engine.helper.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const NO_CONFIG = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...NO_CONFIG } }).trim()

describe('a paused engine', () => {
  it('fetches from origin on its heartbeat and dispatches nothing', { timeout: 60_000 }, async () => {
    const toy = makeToyRepo()
    cleanups.push(toy.dir)
    const bare = `${toy.dir}-origin.git`
    cleanups.push(bare)
    execFileSync('git', ['clone', '-q', '--bare', toy.dir, bare], { env: { ...process.env, ...NO_CONFIG } })
    git(toy.dir, ['remote', 'add', 'origin', bare])
    git(toy.dir, ['fetch', '-q', 'origin'])
    git(toy.dir, ['remote', 'set-head', 'origin', 'main'])
    // The code checkout is dirty from the start: dispatch is paused.
    const code = mkdtempSync(join(tmpdir(), 'gateline-paused-code-'))
    cleanups.push(code)
    git(code, ['init', '-q', '-b', 'main'])
    writeFileSync(join(code, 'file.txt'), 'x\n')
    git(code, ['add', '.'])
    git(code, ['-c', 'user.name=Toy', '-c', 'user.email=toy@example.test', 'commit', '-q', '-m', 'initial'])
    writeFileSync(join(code, 'scratch.txt'), 'wip\n')

    const dispatcher = new FakeDispatcher(() => ({}))
    const lines: string[] = []
    const handle = await startOrchestrators({
      repositories: [{ repoDir: toy.dir, repositoryId: 'local/toy', displayName: 'toy', push: false, localOnly: false, dispatcher }],
      heartbeatSeconds: 600,
      codeRepo: code,
      engineName: 'test-engine',
      log: (l) => lines.push(l),
    })
    try {
      await handle.started
      const tipBefore = git(toy.dir, ['rev-parse', 'run/toy'])
      // Origin moves on: a branch appears there that this clone has not fetched.
      git(bare, ['branch', 'moved-on', 'main'])
      expect(git(toy.dir, ['for-each-ref', 'refs/remotes/origin/moved-on'])).toBe('')
      await handle.engines[0]!.loop.trigger('heartbeat')
      expect(git(toy.dir, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/moved-on'])).toBe('refs/remotes/origin/moved-on')
      // Nothing was derived or dispatched while paused.
      expect(dispatcher.calls).toEqual([])
      expect(git(toy.dir, ['rev-parse', 'run/toy'])).toBe(tipBefore)
      expect(lines.some((l) => l.startsWith('[toy] code tree paused'))).toBe(true)
    } finally {
      await handle.stop()
    }
  })
})
