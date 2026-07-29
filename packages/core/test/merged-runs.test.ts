// #213: what counts as "this run has landed". Ancestry answers it for a merge
// commit and never for a squash or rebase merge — the strategy GitHub defaults
// to and this project uses — so a squash-merged run stayed classified as an
// active branch: derived on every tick, listed as live in the viewer, and (the
// symptom that surfaced it) handed a fresh ready-for-review PR on shipped work
// by the draft-PR ensure. Content identity of the run record is the second
// answer, and the one that holds whatever the host squashes.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalGitSource } from '../src/index.ts'

let dir: string
let source: LocalGitSource

function git(args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

function write(path: string, content: string): void {
  mkdirSync(join(dir, dirname(path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

function commit(message: string): void {
  git(['add', '-A'])
  git(['commit', '-q', '-m', message])
}

const state = (slug: string, phase: string) =>
  `run: ${slug}\nbranch: run/${slug}\nphase: ${phase}\nprofile: standard\ngates:\n  G0: { approved: true, by: Fixture Operator, at: 2026-07-01T00:00:00Z, notes: null }\ntasks: []\nescalations: []\n`

/** A run branch carrying a finished record, plus the code it shipped. */
function runBranch(slug: string): void {
  git(['checkout', '-q', '-b', `run/${slug}`, 'main'])
  write(`runs/${slug}/intent-brief.md`, `# Intent Brief: ${slug}\n`)
  write(`runs/${slug}/state.yaml`, state(slug, 'done'))
  write(`src/${slug}.ts`, `export const ${slug.replace(/-/g, '_')} = true\n`)
  commit(`state(${slug}): run complete`)
  git(['checkout', '-q', 'main'])
}

/** Land `run/<slug>` the way GitHub's "Squash and merge" does: one new commit, branch untouched. */
function squashMerge(slug: string): void {
  git(['merge', '--squash', '-q', `run/${slug}`])
  commit(`${slug}: shipped (#1)`)
}

function isAncestor(maybeAncestor: string, of: string): boolean {
  try {
    git(['merge-base', '--is-ancestor', maybeAncestor, of])
    return true
  } catch {
    return false
  }
}

const kindOf = async (slug: string) => (await source.listRuns()).find((r) => r.slug === slug)?.kind

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agentic-merged-runs-'))
  source = new LocalGitSource('fixture', dir)
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.name', 'Fixture Operator'])
  git(['config', 'user.email', 'operator@example.test'])
  write('README.md', '# fixture\n')
  commit('root')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listRuns: a landed run is history however it was merged', () => {
  it('classifies a squash-merged run as historical, though its branch is an ancestor of nothing', async () => {
    runBranch('squashed')
    squashMerge('squashed')

    expect(isAncestor('run/squashed', 'main')).toBe(false) // the premise: a squash leaves no ancestry to find
    expect(await kindOf('squashed')).toBe('default')
  })

  it('still classifies a merge-commit run as historical', async () => {
    runBranch('merged')
    git(['merge', '-q', '--no-ff', '-m', 'merge run/merged', 'run/merged'])

    expect(await kindOf('merged')).toBe('default')
  })

  it('leaves an unmerged run active', async () => {
    runBranch('in-flight')

    expect(await kindOf('in-flight')).toBe('branch')
  })

  it('leaves a merged branch that kept committing active — a diverged record is not history (#213)', async () => {
    runBranch('reused')
    squashMerge('reused')
    git(['checkout', '-q', 'run/reused'])
    write('runs/reused/state.yaml', state('reused', 'implement'))
    commit('state(reused): advanced — a second attempt on a shipped slug')
    git(['checkout', '-q', 'main'])

    expect(await kindOf('reused')).toBe('branch')
  })

  it('leaves a branch alone when the default branch carries an unrelated run of the same name only in part', async () => {
    runBranch('partial')
    // Land the record but not the code: the trees differ, so nothing claims it landed.
    git(['checkout', '-q', 'main'])
    write('runs/partial/state.yaml', state('partial', 'done'))
    commit('partial: record copied to main by hand')

    expect(await kindOf('partial')).toBe('branch')
  })
})
