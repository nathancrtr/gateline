// #149: a human write that only lands locally waits on someone else's push
// to reach origin — until then the viewer and origin consumers see different
// runs. Two defenses under test: zero-config sources push human writes when
// an origin exists, and summaries carry an ahead-of-origin count so any
// remaining divergence is visible instead of silent.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureDraftPr,
  LocalGitSource,
  loadSources,
  type PrProvider,
  planDecision,
  planSyncForSource,
  type RunRef,
  summarizeRun,
} from '../src/index.ts'
import { dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let ctx: FixtureContext
const cleanups: string[] = []

beforeEach(async () => {
  ctx = await makeFixture()
})
afterEach(async () => {
  await dropFixture(ctx)
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Give the fixture repo a bare origin holding all current branches. */
function addOrigin(dir: string): string {
  const bare = `${dir}-origin.git`
  cleanups.push(bare)
  execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
  execFileSync('git', ['-C', dir, 'fetch', '--quiet', 'origin'])
  return bare
}

const originTip = (bare: string, branch: string): string =>
  execFileSync('git', ['-C', bare, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim()

async function refFor(source: { listRuns(): Promise<RunRef[]> }, slug: string): Promise<RunRef> {
  const refs = await source.listRuns()
  return refs.find((r) => r.slug === slug)!
}

/** An unpushed human write on the run branch, via a deliberately non-pushing source. */
async function localOnlyDecision(dir: string, slug: string): Promise<void> {
  const source = new LocalGitSource('local-only', dir)
  const ref = await refFor(source, slug)
  const { state } = await source.readState(ref)
  const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
  const result = await source.writeState(ref, planned.mutate, planned.message)
  expect(result.ok).toBe(true)
  expect(result.pushFailed).toBeUndefined()
}

describe('aheadOfOrigin (#149)', () => {
  it('is null without origin tracking — unknowable, not zero', async () => {
    const ref = await refFor(ctx.source, 'g0-pending')
    expect(await ctx.source.aheadOfOrigin(ref)).toBeNull()
    const { summary } = await summarizeRun(ctx.source, ref)
    expect(summary.aheadOfOrigin).toBeNull()
  })

  it('counts unpushed commits and surfaces them in the run summary', async () => {
    addOrigin(ctx.repo.dir)
    const ref = await refFor(ctx.source, 'g0-pending')
    expect(await ctx.source.aheadOfOrigin(ref)).toBe(0)

    await localOnlyDecision(ctx.repo.dir, 'g0-pending')
    expect(await ctx.source.aheadOfOrigin(ref)).toBe(1)
    const { summary } = await summarizeRun(ctx.source, ref)
    expect(summary.aheadOfOrigin).toBe(1)
  })
})

describe('zero-config sources push human writes when an origin exists (#149)', () => {
  it('a decision through a loadSources source reaches origin in the same write', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir] })
    const source = sources[0]!
    const ref = await refFor(source, 'g0-pending')
    const before = originTip(bare, ref.branch)

    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    expect(result.pushFailed).toBeUndefined()

    expect(originTip(bare, ref.branch)).not.toBe(before)
    expect(originTip(bare, ref.branch)).toBe(result.commit)
  })

  it('an explicit push:false ceiling silences the auto-push (gateline up --no-push)', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir], push: false })
    const source = sources[0]!
    const ref = await refFor(source, 'g0-pending')
    const before = originTip(bare, ref.branch)

    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    expect(originTip(bare, ref.branch)).toBe(before) // ceiling honored — nothing pushed
  })

  it('a remoteless repo stays local-only, with no push noise', async () => {
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir] })
    const source = sources[0]!
    const ref = await refFor(source, 'g0-pending')
    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)
    expect(result.pushFailed).toBeUndefined()
  })
})

// --- #99: a local branch pinned behind origin must not freeze observation ---

import { readFileSync, writeFileSync } from 'node:fs'

/** Advance origin's copy of the branch: flip G0 approved in a throwaway clone and push. */
function advanceOrigin(bare: string, branch: string, slug: string): string {
  const clone = `${bare}-clone-${Math.random().toString(36).slice(2, 8)}`
  cleanups.push(clone)
  execFileSync('git', ['clone', '--quiet', '--branch', branch, bare, clone])
  execFileSync('git', ['-C', clone, 'config', 'user.name', 'Origin Op'])
  execFileSync('git', ['-C', clone, 'config', 'user.email', 'oo@example.test'])
  const p = `${clone}/runs/${slug}/state.yaml`
  writeFileSync(p, readFileSync(p, 'utf8').replace('G0: {approved: false, by: null', 'G0: {approved: true, by: Origin Op'), 'utf8')
  execFileSync('git', ['-C', clone, 'commit', '-aqm', `state(${slug}): G0 approved by Origin Op [burden: confirmation]`])
  execFileSync('git', ['-C', clone, 'push', '--quiet', 'origin', branch])
  return execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

describe('stale local branch (#99)', () => {
  it('behind + checked out in a worktree: observation serves the remote tip, not the pinned local', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const wt = `${ctx.repo.dir}-wt`
    cleanups.push(wt)
    execFileSync('git', ['-C', ctx.repo.dir, 'worktree', 'add', '--quiet', wt, 'run/g0-pending'])
    advanceOrigin(bare, 'run/g0-pending', 'g0-pending')
    await ctx.source.syncFromRemote() // fetches; deliberately cannot move the checked-out branch

    const ref = await refFor(ctx.source, 'g0-pending')
    expect(ref.kind).toBe('remote')
    expect(ref.ref).toBe('origin/run/g0-pending')
    const { state } = await ctx.source.readState(ref)
    expect(state!.gates.G0.approved).toBe(true) // origin's world, not the worktree-pinned one
  })

  it('ahead (unpushed decision): local still wins, as today', async () => {
    addOrigin(ctx.repo.dir)
    await localOnlyDecision(ctx.repo.dir, 'g0-pending')
    const ref = await refFor(ctx.source, 'g0-pending')
    expect(ref.kind).toBe('branch')
    expect(await ctx.source.behindOrigin(ref)).toBe(0)
  })

  it('diverged: local wins deterministically, and the summary carries both counts', async () => {
    const bare = addOrigin(ctx.repo.dir)
    await localOnlyDecision(ctx.repo.dir, 'g0-pending')
    advanceOrigin(bare, 'run/g0-pending', 'g0-pending')
    execFileSync('git', ['-C', ctx.repo.dir, 'fetch', '--quiet', 'origin'])

    const ref = await refFor(ctx.source, 'g0-pending')
    expect(ref.kind).toBe('branch')
    const { summary } = await summarizeRun(ctx.source, ref)
    expect(summary.aheadOfOrigin).toBe(1)
    expect(summary.behindOrigin).toBe(1)
  })

  it('writeState on a behind local (not checked out) fast-forwards first — never builds on a stale base', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const newTip = advanceOrigin(bare, 'run/g0-pending', 'g0-pending')
    execFileSync('git', ['-C', ctx.repo.dir, 'fetch', '--quiet', 'origin']) // remote-tracking only

    const source = new LocalGitSource('local-only', ctx.repo.dir)
    const ref = await refFor(source, 'g0-pending')
    const { state } = await source.readState(ref)
    expect(state!.gates.G0.approved).toBe(true) // observed at origin's tip
    const planned = planDecision(state!, { action: 'approve', gate: 'G1', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)

    const parent = execFileSync('git', ['-C', ctx.repo.dir, 'rev-parse', 'run/g0-pending^'], { encoding: 'utf8' }).trim()
    expect(parent).toBe(newTip) // the decision sits on origin's tip, not the stale local one
    const after = await source.readState(await refFor(source, 'g0-pending'))
    expect(after.state!.gates.G0.approved).toBe(true)
    expect(after.state!.gates.G1.approved).toBe(true)
  })

  it('writeState through a clean but behind checkout fast-forwards the worktree, then commits', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const wt = `${ctx.repo.dir}-wt2`
    cleanups.push(wt)
    execFileSync('git', ['-C', ctx.repo.dir, 'worktree', 'add', '--quiet', wt, 'run/g0-pending'])
    const newTip = advanceOrigin(bare, 'run/g0-pending', 'g0-pending')
    execFileSync('git', ['-C', ctx.repo.dir, 'fetch', '--quiet', 'origin'])

    const source = new LocalGitSource('local-only', ctx.repo.dir)
    const ref = await refFor(source, 'g0-pending')
    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G1', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)
    expect(result.ok).toBe(true)

    const parent = execFileSync('git', ['-C', ctx.repo.dir, 'rev-parse', 'run/g0-pending^'], { encoding: 'utf8' }).trim()
    expect(parent).toBe(newTip)
    const wtHead = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    expect(wtHead).toBe(result.commit) // the checkout advanced with the write — no silent desync
  })
})

// --- local-only as a first-class mode: named-mode resolution and the two closed egress leaks ---

describe('local-only names the mode, not just infers it (AC1.1, AC1.2)', () => {
  it('a remoteless loadSources source auto-detects local-only (trigger unchanged); adding an origin flips it off', async () => {
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir] })
    const source = sources[0] as LocalGitSource
    expect(source.localOnly).toBe(true)

    addOrigin(ctx.repo.dir)
    const { sources: withOrigin } = await loadSources({ repoOverrides: [ctx.repo.dir] })
    expect((withOrigin[0] as LocalGitSource).localOnly).toBe(false)
  })

  it('an explicit localOnly designator overrides auto-detect on a live origin: the decision writes, origin stays untouched', async () => {
    const bare = addOrigin(ctx.repo.dir)
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir], localOnly: true })
    const source = sources[0]!
    const ref = await refFor(source, 'g0-pending')
    const before = originTip(bare, ref.branch)

    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    const result = await source.writeState(ref, planned.mutate, planned.message)

    expect(result.ok).toBe(true)
    expect(originTip(bare, ref.branch)).toBe(before) // ceiling honored under the named mode, not just push:false
  })
})

describe('local-only closes the PR-ensure leak (AC2.2)', () => {
  it('suppresses ensureDraftPr even when origin exists and the branch was already pushed before local-only was requested', async () => {
    addOrigin(ctx.repo.dir)
    const ref = await refFor(ctx.source, 'g0-pending')
    // Simulate the brief's leak shape: the branch reached origin before this
    // run went local-only (pr-ensure.test.ts's own pattern for "pushed").
    const sha = execFileSync('git', ['-C', ctx.repo.dir, 'rev-parse', ref.branch], { encoding: 'utf8' }).trim()
    execFileSync('git', ['-C', ctx.repo.dir, 'update-ref', `refs/remotes/origin/${ref.branch}`, sha])

    const exec = vi.fn(async () => {
      throw new Error('gh should not be invoked under local-only')
    })

    const result = await ensureDraftPr(ctx.repo.dir, ref.branch, ref.slug, { localOnly: true, exec })

    expect(result.status).toBe('skipped')
    expect(result.note).toMatch(/local-only/i)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('local-only closes the PR-approval sync leak (AC2.3)', () => {
  it('planSyncForSource resolves a remoteless loadSources source to local-only without ever invoking the provider factory', async () => {
    const { sources } = await loadSources({ repoOverrides: [ctx.repo.dir] })
    const source = sources[0]!
    expect((source as LocalGitSource).localOnly).toBe(true)

    const factory = vi.fn((): PrProvider => ({ approval: async () => null }))
    const result = await planSyncForSource(source, factory)

    expect(result).toBe('local-only')
    expect(factory).not.toHaveBeenCalled()
  })
})
