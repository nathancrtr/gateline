// #149: a human write that only lands locally waits on someone else's push
// to reach origin — until then the viewer and origin consumers see different
// runs. Two defenses under test: zero-config sources push human writes when
// an origin exists, and summaries carry an ahead-of-origin count so any
// remaining divergence is visible instead of silent.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadSources, LocalGitSource, planDecision, summarizeRun, type RunRef } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

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

  it('an explicit push:false ceiling silences the auto-push (agentic up --no-push)', async () => {
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
