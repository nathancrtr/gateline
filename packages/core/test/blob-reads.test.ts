// Blob reads go through one long-lived `git cat-file --batch` per repository,
// and a parsed state.yaml is remembered by the commit that carries it. Both
// are invisible when they work: `Git.show` must answer exactly what
// `git show` answers, and a second history walk must read nothing.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeMetrics, Git, LocalGitSource } from '../src/index.ts'
import { CatFileBatch } from '../src/sources/cat-file.ts'
import { dropDir } from './fixture.helper.ts'

let dir: string

function git(args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function write(path: string, content: string): void {
  mkdirSync(join(dir, dirname(path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

function commit(message: string): void {
  git(['add', '-A'])
  git(['commit', '-q', '-m', message])
}

const UNDECIDED = '{ approved: false, by: null, at: null, notes: null }'
const DECIDED = '{ approved: true, by: Fixture Operator, at: 2026-07-01T00:00:00Z, notes: null }'
const state = (phase: string, approved: boolean) =>
  `run: toy\nbranch: run/toy\nphase: ${phase}\nprofile: standard\ngates:\n  G0: ${approved ? DECIDED : UNDECIDED}\n  G1: ${UNDECIDED}\n  G2: ${UNDECIDED}\ntasks: []\nescalations: []\n`

// Larger than a pipe's buffer, so its content arrives in several chunks.
const LARGE = `${'0123456789abcdef'.repeat(64)}\n`.repeat(400)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gateline-blob-reads-'))
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Operator'])
  git(['config', 'user.email', 'operator@example.test'])
  write('README.md', '# fixture\n')
  write('docs/with space.md', 'spaced\n')
  write('docs/unicode.md', 'naïve — café\n')
  write('docs/empty.md', '')
  write('docs/no-newline.md', 'no trailing newline')
  write('docs/large.txt', LARGE)
  commit('base')
  git(['checkout', '-q', '-b', 'run/toy'])
  write('runs/toy/state.yaml', state('spec', false))
  commit('state: staged')
  write('runs/toy/spec.md', '# Spec\n')
  write('runs/toy/state.yaml', state('plan', true))
  commit('state: G0 approved by Fixture Operator')
  write('runs/toy/state.yaml', state('implement', true))
  commit('state: advanced')
  git(['checkout', '-q', 'main'])
})

afterEach(async () => {
  await dropDir(dir)
})

describe('Git.show over the batch reader', () => {
  const paths = ['README.md', 'docs/with space.md', 'docs/unicode.md', 'docs/empty.md', 'docs/no-newline.md', 'docs/large.txt']

  it('answers what `git show` answers, blob for blob', async () => {
    const reader = new Git(dir)
    for (const path of paths) {
      expect(await reader.show('main', path), path).toBe(git(['show', `main:${path}`]))
    }
  })

  it('keeps answers matched to their requests when many are in flight at once', async () => {
    const reader = new Git(dir)
    const asked = [...paths, 'docs/absent.md', ...paths.toReversed(), 'docs/absent.md', ...paths]
    const answers = await Promise.all(asked.map((p) => reader.show('main', p)))
    for (const [i, path] of asked.entries()) {
      expect(answers[i], `${i}: ${path}`).toBe(path === 'docs/absent.md' ? null : git(['show', `main:${path}`]))
    }
  })

  it('answers null for a path or a rev that does not exist', async () => {
    const reader = new Git(dir)
    expect(await reader.show('main', 'docs/absent.md')).toBeNull()
    expect(await reader.show('no-such-branch', 'README.md')).toBeNull()
  })

  it('sees a commit made after the reader started', async () => {
    const reader = new Git(dir)
    expect(await reader.show('main', 'late.md')).toBeNull()
    write('late.md', 'arrived later\n')
    commit('late')
    expect(await reader.show('main', 'late.md')).toBe('arrived later\n')
  })

  it('still prints a directory the way `git show` prints one', async () => {
    const reader = new Git(dir)
    expect(await reader.show('main', 'docs')).toBe(git(['show', 'main:docs']))
  })

  it('never lets a line break in a path become a second request', async () => {
    const reader = new Git(dir)
    expect(CatFileBatch.accepts('main:docs/a\nmain:README.md')).toBe(false)
    const [injected, after] = await Promise.all([reader.show('main', 'docs/a\nmain:README.md'), reader.show('main', 'README.md')])
    expect(injected).toBeNull()
    expect(after).toBe('# fixture\n')
  })

  it('reports a directory that is not a repository as an error', async () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'gateline-not-a-repo-'))
    try {
      await expect(new Git(elsewhere).show('main', 'README.md')).rejects.toThrow(/not a git repository/i)
    } finally {
      await dropDir(elsewhere)
    }
  })
})

describe('CatFileBatch', () => {
  it('starts a fresh child after being closed', async () => {
    const batch = new CatFileBatch(dir)
    expect((await batch.read('main:README.md'))?.content.toString()).toBe('# fixture\n')
    batch.close()
    expect((await batch.read('main:README.md'))?.content.toString()).toBe('# fixture\n')
    batch.close()
  })

  it('rejects the requests in flight when closed', async () => {
    const batch = new CatFileBatch(dir)
    const inFlight = batch.read('main:docs/large.txt')
    batch.close()
    await expect(inFlight).rejects.toThrow(/closed/)
  })
})

describe('state history', () => {
  it('reads each state.yaml once, however often the history is walked', async () => {
    const source = new LocalGitSource('toy', dir)
    const [ref] = await source.listRuns()
    const show = vi.spyOn(source.git, 'show')

    const first = await source.stateHistory(ref!)
    expect(first.map((c) => c.state?.phase)).toEqual(['implement', 'plan', 'spec'])
    expect(show).toHaveBeenCalledTimes(3)

    const second = await source.stateHistory(ref!)
    expect(second).toEqual(first)
    expect(show).toHaveBeenCalledTimes(3)
  })

  it('reads only the new commit when the branch moves', async () => {
    const source = new LocalGitSource('toy', dir)
    const [ref] = await source.listRuns()
    await source.stateHistory(ref!)
    const show = vi.spyOn(source.git, 'show')

    git(['checkout', '-q', 'run/toy'])
    write('runs/toy/state.yaml', state('integrate', true))
    commit('state: advanced again')
    git(['checkout', '-q', 'main'])

    const history = await source.stateHistory(ref!)
    expect(history.map((c) => c.state?.phase)).toEqual(['integrate', 'implement', 'plan', 'spec'])
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('hands out states that a caller cannot change for the next caller', async () => {
    const source = new LocalGitSource('toy', dir)
    const [ref] = await source.listRuns()
    const [tip] = await source.stateHistory(ref!)
    expect(() => {
      tip!.state!.gates.G0!.approved = false
    }).toThrow(/read only|read-only|frozen/i)
    expect((await source.stateHistory(ref!))[0]!.state!.gates.G0!.approved).toBe(true)
  })
})

describe('computeMetrics', () => {
  it("walks each run's history once", async () => {
    const source = new LocalGitSource('toy', dir)
    const walk = vi.spyOn(source, 'stateHistory')
    const metrics = await computeMetrics([source])
    expect(metrics.decisions.map((d) => `${d.slug} ${d.gate} ${d.approved}`)).toEqual(['toy G0 true'])
    expect(walk).toHaveBeenCalledTimes((await source.listRuns()).length)
  })
})
