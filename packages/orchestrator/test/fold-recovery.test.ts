// The fold's record: what it rescues before it discards anything (#184), what
// it says went wrong (#223), what it does about dirt an obedient implementer
// leaves behind (#224), and what survives a fold that did not land (#225).
// Real git throughout — the whole subject is what `git rebase` actually does,
// so stubbing it would test the assumption that was the bug.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureTaskCheckout, foldTaskBranch, isPlanDefect, reapTaskBranches, type TaskHarvest } from '../src/workspace.ts'

const dirs: string[] = []

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
}

/** A repo with `run/toy` carrying one committed file, and nothing checked out on it. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-fold-'))
  dirs.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Fixture Operator'])
  git(dir, ['config', 'user.email', 'operator@example.test'])
  writeFileSync(join(dir, 'lock.json'), 'lockfile v1\n')
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'root'])
  git(dir, ['branch', 'run/toy'])
  return dir
}

/** Commit on `run/toy` in the main checkout, then step back off it. */
function commitOnRun(dir: string, file: string, body: string, message: string): void {
  git(dir, ['checkout', '-q', 'run/toy'])
  writeFileSync(join(dir, file), body)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  git(dir, ['checkout', '-q', 'main'])
}

const fileOnRun = (dir: string, file: string): string => git(dir, ['show', `run/toy:${file}`])

const subjects = (dir: string): string[] => git(dir, ['log', '--format=%s', 'run/toy']).trim().split('\n')

/** The task context the engine passes down from `obs.taskFiles` and `cfg.identity`. */
const harvestFor = (surface: string[]): TaskHarvest => ({
  slug: 'toy',
  task: '01-toy',
  round: 1,
  surface,
  identity: { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' },
})

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    git(dir, ['worktree', 'prune']).toString()
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('fold harvest: the surface is rescued before anything is discarded (#184)', () => {
  it('harvests a file the implementer left untracked inside its surface, and folds it', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')

    // The implementer produced its work and never `git add`ed it. Nothing
    // here blocks a rebase, which is exactly why it used to be lost in
    // silence: the fold's `finally` force-removes the worktree.
    mkdirSync(join(checkout.path, 'src'), { recursive: true })
    writeFileSync(join(checkout.path, 'src/new.ts'), 'export const b = 1\n')

    // The second surface entry is prose, not a path — task YAMLs carry those.
    // A pathspec matching nothing is ignored, never an error.
    const result = await foldTaskBranch(dir, 'run/toy', checkout, harvestFor(['src/', '(merge commit only — entire tree)']))

    expect(result.ok).toBe(true)
    expect(result.harvested).toEqual(['src/new.ts'])
    expect(result.message).toContain('harvested in surface: src/new.ts')
    expect(fileOnRun(dir, 'src/new.ts')).toBe('export const b = 1\n')

    // The closed commit grammar: the `harvested` verb, under the bot identity.
    expect(subjects(dir)[0]).toBe('state(toy): harvested implementer(01-toy r1) artifacts')
    expect(git(dir, ['log', '-1', '--format=%an', 'run/toy']).trim()).toBe('gateline-orchestrator')
  })

  it('harvests an in-surface edit to a tracked file rather than discarding it as dirt', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 9\n')

    const result = await foldTaskBranch(dir, 'run/toy', checkout, harvestFor(['app.ts']))

    // #224 would have reset --hard this away to let the rebase start; in
    // surface, it is the task's product and belongs on the run branch.
    expect(result.ok).toBe(true)
    expect(result.harvested).toEqual(['app.ts'])
    expect(result.discarded).toEqual([])
    expect(fileOnRun(dir, 'app.ts')).toBe('export const a = 9\n')
  })

  it('names an untracked file outside the surface instead of harvesting it', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 7\n')
    git(checkout.path, ['add', 'app.ts'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: bump a'])
    writeFileSync(join(checkout.path, 'probe.tsx'), 'scratch\n')

    const result = await foldTaskBranch(dir, 'run/toy', checkout, harvestFor(['app.ts']))

    expect(result.ok).toBe(true)
    expect(result.harvested).toEqual([])
    expect(result.leftBehind).toEqual(['probe.tsx'])
    expect(result.message).toContain('left behind (untracked, outside surface): probe.tsx')
    // Named, and still dropped: the worktree removal takes it, and it never
    // reaches the run branch.
    expect(() => fileOnRun(dir, 'probe.tsx')).toThrow()
    expect(existsSync(checkout.path)).toBe(false)
  })

  it('writes no harvest commit when nothing in surface is uncommitted', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 8\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: committed its own work'])

    const result = await foldTaskBranch(dir, 'run/toy', checkout, harvestFor(['app.ts']))

    expect(result.ok).toBe(true)
    expect(result.harvested).toEqual([])
    expect(result.message).not.toContain('harvested')
    expect(subjects(dir)).toEqual(['task 01: committed its own work', 'root'])
  })
})

describe('fold hygiene: out-of-surface dirt (#224)', () => {
  it('folds an implementer’s committed work even though running the suite left the lockfile dirty', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')

    // What a compliant implementer does: commit its product (in surface),
    // and leave the lockfile `npm install` rewrote alone (out of surface).
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 2\n')
    git(checkout.path, ['add', 'app.ts'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: bump a'])
    writeFileSync(join(checkout.path, 'lock.json'), 'lockfile v2 — npm rewrote this\n')
    writeFileSync(join(checkout.path, 'scratch.txt'), 'untracked scratch\n')

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    // Before #224 this was the escalation: the dirty tracked file made
    // `git rebase` refuse to start, so obeying the surface rule was what
    // made the work unfoldable.
    expect(result.ok).toBe(true)
    expect(result.cause).toBeNull()
    expect(result.discarded).toEqual(['lock.json'])
    expect(result.message).toContain('discarded uncommitted: lock.json')
    expect(fileOnRun(dir, 'app.ts')).toBe('export const a = 2\n')
    expect(fileOnRun(dir, 'lock.json')).toBe('lockfile v1\n') // the discard did not land
  })

  it('leaves a clean worktree’s result untouched and reports nothing discarded', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 3\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: clean'])

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(true)
    expect(result.discarded).toEqual([])
    expect(result.message).not.toContain('discarded')
  })

  it('does not treat untracked files as dirt — they never blocked a rebase', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 4\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01'])
    writeFileSync(join(checkout.path, 'probe.tsx'), 'scratch\n')

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(true)
    expect(result.discarded).toEqual([])
  })
})

describe('fold diagnosis: only a content conflict is a plan defect (#223)', () => {
  it('names a genuine overlapping surface, and only that case is fatal', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = "task"\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: edit app.ts'])
    // The run branch edits the same lines — the surfaces were not disjoint.
    commitOnRun(dir, 'app.ts', 'export const a = "run"\n', 'run: edit app.ts')

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(false)
    expect(result.cause).toBe('conflict')
    expect(isPlanDefect(result)).toBe(true)
    expect(result.message).toContain('overlapping file-contact surfaces')
  })

  it('reports a vanished run branch as infrastructure, not as a plan defect', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 5\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01'])
    git(dir, ['update-ref', '-d', 'refs/heads/run/toy'])

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(false)
    expect(result.cause).toBe('infra')
    // The heart of #223: the run escalated as a decomposition defect and sent
    // a human hunting for one, for failures that were nothing of the kind.
    expect(isPlanDefect(result)).toBe(false)
    expect(result.message).not.toContain('plan defect')
  })
})

describe('fold retention: a failed fold keeps the paid dispatch (#225)', () => {
  it('keeps the task branch, releases the worktree, and names the branch in the message', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = "task"\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01: the work that was paid for'])
    const paid = git(checkout.path, ['rev-parse', 'HEAD']).trim()
    commitOnRun(dir, 'app.ts', 'export const a = "run"\n', 'run: conflicting edit')

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(false)
    expect(result.retained).toBe(checkout.branch)
    expect(result.message).toContain(`task branch ${checkout.branch} kept for inspection`)
    // The commit is reachable by name — no reflog spelunking, no `git fsck`.
    expect(git(dir, ['rev-parse', checkout.branch]).trim()).toBe(paid)
    expect(git(dir, ['show', `${checkout.branch}:app.ts`])).toBe('export const a = "task"\n')
    // The worktree still goes: it holds a lock and a tmpdir path.
    expect(git(dir, ['worktree', 'list'])).not.toContain(checkout.path)
    expect(existsSync(checkout.path)).toBe(false)
  })

  it('still cleans up completely when the fold lands', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = 6\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01'])

    const result = await foldTaskBranch(dir, 'run/toy', checkout)

    expect(result.ok).toBe(true)
    expect(result.retained).toBeNull()
    expect(git(dir, ['branch', '--list', checkout.branch]).trim()).toBe('')
    expect(existsSync(checkout.path)).toBe(false)
  })

  it('reaps retained branches for a finished run, and leaves other runs’ branches alone', async () => {
    const dir = makeRepo()
    git(dir, ['branch', 'run/other'])
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    writeFileSync(join(checkout.path, 'app.ts'), 'export const a = "task"\n')
    git(checkout.path, ['add', '-A'])
    git(checkout.path, ['commit', '-q', '-m', 'task 01'])
    commitOnRun(dir, 'app.ts', 'export const a = "run"\n', 'run: conflicting edit')
    await foldTaskBranch(dir, 'run/toy', checkout)
    const neighbour = await ensureTaskCheckout(dir, 'run/other', '01-other')

    const reaped = await reapTaskBranches(dir, 'run/toy')

    expect(reaped).toEqual([checkout.branch])
    expect(git(dir, ['branch', '--list', checkout.branch]).trim()).toBe('')
    expect(git(dir, ['branch', '--list', neighbour.branch]).trim()).toContain(neighbour.branch)
    expect(await reapTaskBranches(dir, 'run/toy')).toEqual([]) // idempotent
  })
})
