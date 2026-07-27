// The writeState kill window (plan "Interface contracts", ADR-1..ADR-4): a
// write-ahead intent commit under refs/agentic/wip/<branch> lets a later
// write recognize and clean up its own abandoned mid-write kill, while any
// dirt it cannot attribute to itself still refuses.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Git, planDecision, type RunRef } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
const who = { name: 'Fixture Operator', email: 'operator@example.test' }

beforeEach(async () => {
  ctx = await makeFixture()
})
afterEach(() => dropFixture(ctx))

async function refFor(slug: string): Promise<RunRef> {
  const refs = await ctx.source.listRuns()
  return refs.find((r) => r.slug === slug)!
}

/**
 * Reproduces the kill window per plan ADR-4: patches `Git.prototype.run` so
 * the checked-out branch's pathspec `commit` invocation throws — after the
 * intent ref and the working-tree write have already landed, since both
 * precede the `commit` call in `writeState` — then restores the original in
 * a `finally` block so the patch never leaks into another test.
 */
function killOnWorktreeCommit(): () => void {
  const original = Git.prototype.run
  Git.prototype.run = function (
    this: Git,
    args: string[],
    opts: { input?: string; env?: Record<string, string> } = {},
  ): Promise<string> {
    if (args[0] === 'commit') throw new Error('simulated kill between the worktree write and its commit')
    return original.call(this, args, opts)
  }
  return () => {
    Git.prototype.run = original
  }
}

async function reproduceKill(run: () => Promise<unknown>): Promise<void> {
  const restore = killOnWorktreeCommit()
  try {
    await expect(run()).rejects.toThrow(/simulated kill/)
  } finally {
    restore()
  }
}

describe('writeState kill-window recovery', () => {
  it('AC1.1/AC1.2/AC4.1: self-heals an abandoned mid-write kill and leaves exactly the two calls\' commits', async () => {
    const ref = await refFor('g1-pending')
    const branchRef = `refs/heads/${ref.branch}`
    const intentRef = `refs/agentic/wip/${ref.branch}`
    const relStatePath = 'runs/g1-pending/state.yaml'
    const statePath = join(ctx.repo.dir, relStatePath)
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])

    const baseline = Number((await git.run(['rev-list', '--count', branchRef])).trim())

    const { state: s1 } = await ctx.source.readState(ref)
    const planned1 = planDecision(s1!, { action: 'approve', gate: 'G1', burden: 'light-correction', notes: 'ADRs accepted' }, who)
    await reproduceKill(() => ctx.source.writeState(ref, planned1.mutate, planned1.message))

    // The kill window is reproduced: the working-tree write landed (dirty,
    // worktree-only), the commit never ran, and the intent ref is live.
    const midStatus = await git.run(['status', '--porcelain', '--', relStatePath])
    expect(midStatus.replace(/\n$/, '')).toBe(` M ${relStatePath}`)
    expect(await ctx.source.git.revParse(intentRef)).not.toBeNull()

    // A fresh write recovers: it discards the abandoned dirt and commits its
    // own mutation instead of finishing the abandoned one (ADR-2).
    const { state: s2 } = await ctx.source.readState(ref)
    const planned2 = planDecision(s2!, { action: 'approve', gate: 'G1', burden: 'light-correction', notes: 'ADRs accepted' }, who)
    const recovered = await ctx.source.writeState(ref, planned2.mutate, planned2.message)
    expect(recovered.ok).toBe(true) // AC1.1

    expect((await git.run(['status', '--porcelain'])).trim()).toBe('') // AC1.1
    expect(await ctx.source.git.revParse(intentRef)).toBeNull()

    // AC4.1: the checkout is fully reconciled with its branch.
    expect((await git.run(['rev-parse', 'HEAD'])).trim()).toBe((await git.run(['rev-parse', branchRef])).trim())

    // AC1.2: a second write immediately after recovery also succeeds, and
    // the branch holds exactly the two calls' commits — no orphan from the
    // abandoned intent.
    const { state: s3 } = await ctx.source.readState(ref)
    const planned3 = planDecision(s3!, { action: 'pause', pauseReason: 'follow-up check' }, who)
    const second = await ctx.source.writeState(ref, planned3.mutate, planned3.message)
    expect(second.ok).toBe(true)

    const log = await ctx.source.git.log(branchRef, [], { maxCount: baseline + 3 })
    expect(log.length).toBe(baseline + 2)
    expect(log[0]!.subject).toBe(planned3.message)
    expect(log[1]!.subject).toBe(planned2.message)

    const after = await readFile(statePath, 'utf8')
    expect(after).not.toContain('ADRs accepted\nADRs accepted') // the abandoned write's content never doubled up
  })

  it('AC2.2: a kill reproduced, then a further hand edit that diverges from the intent, still refuses byte-identical', async () => {
    const ref = await refFor('g1-pending')
    const relStatePath = 'runs/g1-pending/state.yaml'
    const statePath = join(ctx.repo.dir, relStatePath)
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])

    const { state: s1 } = await ctx.source.readState(ref)
    const planned1 = planDecision(s1!, { action: 'approve', gate: 'G1', burden: 'light-correction', notes: 'ADRs accepted' }, who)
    await reproduceKill(() => ctx.source.writeState(ref, planned1.mutate, planned1.message))

    // A human touches the checkout after the kill — the dirt no longer
    // matches the intent's recorded bytes, so it can't be attributed to the
    // engine (ADR-3).
    const handEdited = (await readFile(statePath, 'utf8')) + '# a human was here too\n'
    await writeFile(statePath, handEdited, 'utf8')

    const { state: s2 } = await ctx.source.readState(ref)
    const planned2 = planDecision(s2!, { action: 'approve', gate: 'G1', burden: 'light-correction' }, who)
    const result = await ctx.source.writeState(ref, planned2.mutate, planned2.message)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('dirty-worktree')
    expect(await readFile(statePath, 'utf8')).toBe(handEdited) // untouched
  })

  it('AC2.2: a hand edit with no intent ref (nothing to attribute) refuses byte-identical', async () => {
    const ref = await refFor('g1-pending')
    const relStatePath = 'runs/g1-pending/state.yaml'
    const statePath = join(ctx.repo.dir, relStatePath)
    const intentRef = `refs/agentic/wip/${ref.branch}`
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])

    const handEdited = (await readFile(statePath, 'utf8')) + '# local scribble\n'
    await writeFile(statePath, handEdited, 'utf8')
    expect(await ctx.source.git.revParse(intentRef)).toBeNull() // absent, never written

    const { state } = await ctx.source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G1', burden: 'confirmation' }, who)
    const result = await ctx.source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('dirty-worktree')
    expect(await readFile(statePath, 'utf8')).toBe(handEdited) // untouched
  })

  it('AC2.2: a stale intent ref (parent behind the current tip) refuses rather than recovering', async () => {
    const ref = await refFor('g1-pending')
    const branchRef = `refs/heads/${ref.branch}`
    const relStatePath = 'runs/g1-pending/state.yaml'
    const statePath = join(ctx.repo.dir, relStatePath)
    const git = new Git(ctx.repo.dir)
    await git.run(['checkout', '-q', 'run/g1-pending'])

    const { state: s1 } = await ctx.source.readState(ref)
    const planned1 = planDecision(s1!, { action: 'approve', gate: 'G1', burden: 'light-correction', notes: 'ADRs accepted' }, who)
    await reproduceKill(() => ctx.source.writeState(ref, planned1.mutate, planned1.message))
    const abandonedContent = await readFile(statePath, 'utf8')

    // The branch tip moves out from under the intent ref without the
    // checkout being touched — the intent's parent is now stale.
    const sourceGit = ctx.source.git
    const oldTip = (await sourceGit.revParse(branchRef))!
    const blob = await sourceGit.hashObject('unrelated: true\n')
    const tree = await sourceGit.writeTreeWithBlob(oldTip, 'runs/g1-pending/unrelated.txt', blob)
    const advanced = await sourceGit.commitTree(tree, oldTip, 'advance the tip out from under the intent ref')
    expect(await sourceGit.updateRefCAS(branchRef, advanced, oldTip)).toBe(true)

    const { state: s2 } = await ctx.source.readState(ref)
    const planned2 = planDecision(s2!, { action: 'approve', gate: 'G1', burden: 'light-correction' }, who)
    const result = await ctx.source.writeState(ref, planned2.mutate, planned2.message)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('dirty-worktree')
    expect(await readFile(statePath, 'utf8')).toBe(abandonedContent) // untouched
  })
})
