// #406: every local dispatch works in its own worktree. Reviewers verify by
// applying mutants in place and restoring them; two reviewers of one run in
// a shared checkout could each see, test against, or restore the other's
// mutant. So no two jobs may share a working tree, and nothing reaches the
// run branch except through a fold.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LocalGitSource } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Engine } from '../src/engine.ts'
import { dispatchBranchName } from '../src/workspace.ts'
import { agentCommit, FakeDispatcher, log, makeToyRepo, PLAN, REVIEW, SPEC, TEST_REGISTRY, taskYaml, toyRef } from './engine.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const git = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })

/** Land files on `run/toy`, then return to main. */
function land(dir: string, files: Record<string, string>, message: string): void {
  git(dir, ['checkout', '-q', 'run/toy'])
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  git(dir, ['checkout', '-q', 'main'])
}

/** A run in `implement` with two tasks awaiting their first review: two reviewer dispatches on one tick. */
const TWO_IN_REVIEW = `run: toy
branch: run/toy
phase: implement
paused_reason: null

budget:
  cost_limit_usd: 50
  cost_spent_usd: 0

gates:
  G0: {approved: true, by: Toy Operator, at: 2026-01-01T00:00:00Z, notes: null}
  G1: {approved: true, by: Toy Operator, at: 2026-01-02T00:00:00Z, notes: null}
  G2: {approved: false, by: null, at: null, notes: null}
  G3: {approved: false, by: null, at: null, notes: null}

tasks:
  - {id: 01-core, status: in-review, review_rounds: 0}
  - {id: 02-cli, status: in-review, review_rounds: 0}

escalations: []
`

const worktreeBranches = (dir: string): string[] =>
  git(dir, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((l) => l.startsWith('branch '))
    .map((l) => l.slice('branch '.length))

describe('per-dispatch isolation (#406)', () => {
  it('names a dispatch branch by what it is', () => {
    expect(dispatchBranchName('run/toy', { role: 'implementer', task: '01-core', round: 1 })).toBe('run/toy--task/01-core')
    expect(dispatchBranchName('run/toy', { role: 'reviewer', task: '01-core', round: 2 })).toBe('run/toy--job/reviewer-01-core-r2')
    expect(dispatchBranchName('run/toy', { role: 'analyst', task: null, round: null })).toBe('run/toy--job/analyst')
    expect(dispatchBranchName('run/toy', { role: 'verifier', task: null, round: 1 })).toBe('run/toy--job/verifier-r1')
  })

  it('two reviewers of one run work in separate worktrees, and neither sees the other\'s mutant', async () => {
    const { dir, clock } = makeToyRepo()
    cleanups.push(dir)
    land(
      dir,
      {
        'src/core.py': 'def core():\n    return 1\n',
        'runs/toy/spec.md': SPEC,
        'runs/toy/plan.md': PLAN,
        'runs/toy/tasks/01-core.yaml': taskYaml('01-core', 'src/core.py'),
        'runs/toy/tasks/02-cli.yaml': taskYaml('02-cli', 'src/cli.py'),
        'runs/toy/state.yaml': TWO_IN_REVIEW,
      },
      'toy: two tasks in review',
    )
    const runTipBefore = git(dir, ['rev-parse', 'run/toy']).trim()

    // Both reviewers must be in flight together before either mutates, or
    // the test proves nothing about sharing. A barrier: the second arrival
    // releases both.
    const cwds: string[] = []
    let release: () => void = () => {}
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve
    })
    const dispatcher = new FakeDispatcher(async (req) => {
      expect(req.role).toBe('reviewer')
      cwds.push(req.cwd)
      if (cwds.length === 2) release()
      await bothStarted
      // The reviewer's mutant: a change to the code under review, applied in
      // place. It must be invisible from the other reviewer's tree.
      const mutant = `def core():\n    return 'mutant from ${req.task}'\n`
      writeFileSync(join(req.cwd, 'src/core.py'), mutant)
      const other = cwds.find((c) => c !== req.cwd)!
      expect(readFileSync(join(other, 'src/core.py'), 'utf8')).not.toContain('mutant')
      // Restore, as a reviewer does, then commit the verdict on this branch.
      git(req.cwd, ['checkout', '--', 'src/core.py'])
      const nn = req.task!.slice(0, 2)
      agentCommit(req.cwd, clock, { [`runs/toy/review-${nn}.md`]: REVIEW(req.task!, 'approve') }, `toy: review task ${req.task} round 1`)
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 10 * 60 * 1000, maxConcurrentDispatches: 2 })

    const outcomes = await engine.tick()
    expect(outcomes.reduce((n, o) => n + o.launched, 0)).toBe(2)
    await engine.drain()

    // Two jobs, two trees, both the orchestrator's own, neither the run branch.
    expect(cwds).toHaveLength(2)
    expect(cwds[0]).not.toBe(cwds[1])
    for (const cwd of cwds) expect(cwd).toContain('gateline-orchestrator')
    expect(worktreeBranches(dir)).not.toContain('refs/heads/run/toy')

    // Both verdicts landed on the run branch through the fold, the mutants did not,
    // and the job worktrees and branches are gone.
    const source = new LocalGitSource('check', dir)
    const ref = toyRef(dir)
    expect(await source.readArtifact(ref, 'review-01.md')).toContain('01-core')
    expect(await source.readArtifact(ref, 'review-02.md')).toContain('02-cli')
    expect(git(dir, ['show', 'run/toy:src/core.py'])).toBe('def core():\n    return 1\n')
    expect(git(dir, ['rev-parse', 'run/toy']).trim()).not.toBe(runTipBefore)
    expect(log(dir).filter((l) => /toy: review task 0[12]-/.test(l))).toHaveLength(2)
    expect(worktreeBranches(dir).filter((b) => b.includes('--job/'))).toEqual([])
    expect(git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/run/toy--job/*']).trim()).toBe('')
  })
})
