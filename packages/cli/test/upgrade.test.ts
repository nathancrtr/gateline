// runUpgrade against scratch repos, with a fake `npm` on PATH recording its
// invocations — pins the contract that an upgrade rebuilds the web dist (the
// one part of the tree that does not run from source; a stale dist serves the
// previous UI over current APIs, invisibly).
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runUpgrade } from '../src/main.ts'

let root: string
let binDir: string
let npmLog: string
const originalPath = process.env.PATH

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' })

/** A clone whose origin is one commit ahead, so `git pull --ff-only` moves HEAD. */
function scratchRepo(name: string, files: Record<string, string>): string {
  const origin = join(root, `${name}-origin.git`)
  execFileSync('git', ['init', '--bare', '-q', origin])
  const work = join(root, name)
  execFileSync('git', ['clone', '-q', origin, work])
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(work, path, '..'), { recursive: true })
    writeFileSync(join(work, path), content)
  }
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'c1')
  writeFileSync(join(work, 'moved.txt'), 'c2')
  git(work, 'add', '-A')
  git(work, 'commit', '-q', '-m', 'c2')
  git(work, 'push', '-q', '-u', 'origin', 'HEAD')
  git(work, 'reset', '--hard', '-q', 'HEAD~1')
  return work
}

const npmCalls = () => {
  try {
    return readFileSync(npmLog, 'utf8').trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentic-upgrade-'))
  binDir = join(root, 'bin')
  npmLog = join(root, 'npm.log')
  mkdirSync(binDir)
  writeFileSync(join(binDir, 'npm'), `#!/bin/sh\necho "$@" >> "${npmLog}"\n`)
  chmodSync(join(binDir, 'npm'), 0o755)
  process.env.PATH = `${binDir}:${process.env.PATH}`
})

afterAll(async () => {
  process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
})

describe('agentic upgrade', () => {
  it('pulls, installs, and rebuilds the web dist when the workspace carries the web app (packages/ layout)', async () => {
    const work = scratchRepo('with-web', {
      'packages/package.json': '{"name":"ws"}',
      'packages/web/package.json': '{"name":"web"}',
    })
    await rm(npmLog, { force: true })
    const lines: string[] = []
    const code = await runUpgrade(work, (l) => lines.push(l))
    expect(code).toBe(0)
    expect(npmCalls()).toEqual(['install', 'run build'])
    expect(lines.join('\n')).toMatch(/upgraded [0-9a-f]{7}\.\.[0-9a-f]{7}/)
  })

  it('finds the workspace in a pre-rename frontend/ layout (#133 fallback)', async () => {
    const work = scratchRepo('with-web-legacy', {
      'frontend/package.json': '{"name":"ws"}',
      'frontend/packages/web/package.json': '{"name":"web"}',
    })
    await rm(npmLog, { force: true })
    const lines: string[] = []
    const code = await runUpgrade(work, (l) => lines.push(l))
    expect(code).toBe(0)
    expect(npmCalls()).toEqual(['install', 'run build'])
    expect(lines.join('\n')).toMatch(/upgraded [0-9a-f]{7}\.\.[0-9a-f]{7}/)
  })

  it('installs without building when there is no web package', async () => {
    const work = scratchRepo('no-web', { 'frontend/package.json': '{"name":"ws"}' })
    await rm(npmLog, { force: true })
    const code = await runUpgrade(work, () => {})
    expect(code).toBe(0)
    expect(npmCalls()).toEqual(['install'])
  })

  it('skips npm entirely when no package.json exists, and refuses a dirty tree', async () => {
    const work = scratchRepo('bare-repo', { 'README.md': 'hi' })
    await rm(npmLog, { force: true })
    const lines: string[] = []
    expect(await runUpgrade(work, (l) => lines.push(l))).toBe(0)
    expect(npmCalls()).toEqual([])
    expect(lines.join('\n')).toContain('skipping npm install')

    writeFileSync(join(work, 'dirty.txt'), 'uncommitted')
    expect(await runUpgrade(work, () => {})).toBe(1)
  })
})
