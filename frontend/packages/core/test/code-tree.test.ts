// Self-supersede drift monitor (#141). Builds real throwaway git repos —
// no mocked git plumbing — matching the idiom used elsewhere in this repo
// (orchestrator/test/engine.helper.ts's makeToyRepo) but kept local: core
// must not import from orchestrator.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeTreeMonitor, resolveCodeRepo } from '../src/sources/code-tree.ts'

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// Isolate from the operator's real ~/.gitconfig, same as engine.helper.ts.
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } })
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, 'file.txt'), `${message}\n${Math.random()}`)
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-codetree-'))
  cleanups.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Toy'])
  git(dir, ['config', 'user.email', 'toy@example.com'])
  commit(dir, 'initial')
  return dir
}

describe('CodeTreeMonitor (#141)', () => {
  it('reports fresh when the tree has not moved', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const status = await monitor.check()
    expect(status).toEqual({ state: 'fresh', startHead: monitor.startHead, codeHead: monitor.startHead })
  })

  it('debounces a clean fast-forward: pending on the first check, confirmed on the second', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const next = commit(dir, 'second')

    const first = await monitor.check()
    expect(first.state).toBe('superseded-pending')
    expect(first.codeHead).toBe(next)

    const second = await monitor.check()
    expect(second.state).toBe('supersede-confirmed')
    expect(second.codeHead).toBe(next)

    // Steady state: repeated checks on the same unmoved head stay confirmed.
    const third = await monitor.check()
    expect(third.state).toBe('supersede-confirmed')
  })

  it('a further commit between checks resets the debounce to the new head', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    commit(dir, 'second')

    const first = await monitor.check()
    expect(first.state).toBe('superseded-pending')

    const third = commit(dir, 'third')
    const second = await monitor.check()
    expect(second.state).toBe('superseded-pending')
    expect(second.codeHead).toBe(third)

    const confirmed = await monitor.check()
    expect(confirmed.state).toBe('supersede-confirmed')
    expect(confirmed.codeHead).toBe(third)
  })

  it('pauses with a reason when the working tree is dirty', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    writeFileSync(join(dir, 'scratch.txt'), 'wip')

    const status = await monitor.check()
    expect(status.state).toBe('paused')
    expect(status.reason).toBeTruthy()
  })

  it('pauses when HEAD moves backwards (non-fast-forward)', async () => {
    const dir = makeRepo()
    commit(dir, 'second')
    const monitor = await CodeTreeMonitor.create(dir)
    git(dir, ['reset', '--hard', 'HEAD~1'])

    const status = await monitor.check()
    expect(status.state).toBe('paused')
    expect(status.reason).toBeTruthy()
  })

  it('pauses on a detached HEAD', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const next = commit(dir, 'second')
    git(dir, ['checkout', '-q', next])

    const status = await monitor.check()
    expect(status.state).toBe('paused')
    expect(status.reason).toContain('detached')
  })

  it('pauses on a branch switch away from the default branch', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    commit(dir, 'second')
    git(dir, ['checkout', '-q', '-b', 'other'])

    const status = await monitor.check()
    expect(status.state).toBe('paused')
  })

  it('recovers to fresh after resetting back to startHead', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    commit(dir, 'second')
    expect((await monitor.check()).state).toBe('superseded-pending')

    git(dir, ['reset', '--hard', monitor.startHead])
    const status = await monitor.check()
    expect(status.state).toBe('fresh')
  })

  it('a paused observation resets the debounce, so recovery to clean-ff starts over', async () => {
    const dir = makeRepo()
    const monitor = await CodeTreeMonitor.create(dir)
    const next = commit(dir, 'second')

    const first = await monitor.check()
    expect(first.state).toBe('superseded-pending')

    writeFileSync(join(dir, 'scratch.txt'), 'wip')
    expect((await monitor.check()).state).toBe('paused')

    rmSync(join(dir, 'scratch.txt'))
    const resumed = await monitor.check()
    expect(resumed.state).toBe('superseded-pending')
    expect(resumed.codeHead).toBe(next)

    const confirmed = await monitor.check()
    expect(confirmed.state).toBe('supersede-confirmed')
  })
})

describe('resolveCodeRepo (#141)', () => {
  it('resolves the toplevel for a file inside the repo', () => {
    const dir = makeRepo()
    mkdirSync(join(dir, 'sub'))
    const fileUrl = pathToFileURL(join(dir, 'sub', 'module.ts')).href

    expect(resolveCodeRepo(fileUrl)).toBe(realpathSync(dir))
  })

  it('returns null for a path outside any git checkout', () => {
    // os.tmpdir() itself must not be inside a repo (it isn't); a fresh
    // tmpdir with no .git and no repo among its ancestors proves the miss.
    const outside = mkdtempSync(join(tmpdir(), 'agentic-nogit-'))
    cleanups.push(outside)
    const fileUrl = pathToFileURL(join(outside, 'module.ts')).href

    expect(resolveCodeRepo(fileUrl)).toBeNull()
  })
})
