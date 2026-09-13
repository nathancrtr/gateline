// Remote sync (hosted cockpit): a clone polls origin, remote runs appear,
// clean local branches fast-forward, unpushed local decisions survive.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Git, LocalGitSource, loadSources } from '../src/index.ts'
import { dropDir, dropFixture, type FixtureContext, makeFixture } from './fixture.helper.ts'

let upstream: FixtureContext
let scratch: string
let cloneDir: string
let clone: LocalGitSource

beforeEach(async () => {
  upstream = await makeFixture()
  scratch = await mkdtemp(join(tmpdir(), 'gateline-sync-'))
  await new Git(scratch).run(['clone', '--quiet', upstream.repo.dir, 'clone'])
  cloneDir = join(scratch, 'clone')
  const git = new Git(cloneDir)
  await git.run(['config', 'user.name', 'Hosted Operator'])
  await git.run(['config', 'user.email', 'hosted@example.test'])
  // The hosted recipe detaches HEAD so fetch can fast-forward every local
  // branch, including the default one.
  await git.run(['switch', '--detach'])
  clone = new LocalGitSource('clone', cloneDir)
})
afterEach(async () => {
  await dropFixture(upstream)
  await dropDir(scratch)
})

/** A branch run in the fixture whose state parses (bad-state exists on purpose). */
async function goodTemplate() {
  for (const ref of await upstream.source.listRuns()) {
    if (ref.kind !== 'branch') continue
    if ((await upstream.source.readState(ref)).state) return ref
  }
  throw new Error('fixture has no parseable branch run')
}

/** Seed a new run branch on the upstream repo without touching its checkout. */
async function addUpstreamRun(slug: string): Promise<string> {
  const git = upstream.source.git
  const template = await goodTemplate()
  const raw = (await git.show(template.ref, `runs/${template.slug}/state.yaml`))!
  const blob = await git.hashObject(raw.replaceAll(template.slug, slug))
  const tip = (await git.revParse('main'))!
  const tree = await git.writeTreeWithBlob(tip, `runs/${slug}/state.yaml`, blob)
  const commit = await git.commitTree(tree, tip, `seed ${slug}`)
  await git.run(['update-ref', `refs/heads/run/${slug}`, commit])
  return commit
}

/** Advance an upstream branch by one state-touching commit; returns the new tip. */
async function advanceUpstream(branch: string, slug: string): Promise<string> {
  const git = upstream.source.git
  const tip = (await git.revParse(`refs/heads/${branch}`))!
  const raw = (await git.show(tip, `runs/${slug}/state.yaml`))!
  const blob = await git.hashObject(`${raw}# upstream edit\n`)
  const tree = await git.writeTreeWithBlob(tip, `runs/${slug}/state.yaml`, blob)
  const commit = await git.commitTree(tree, tip, `advance ${branch}`)
  await git.run(['update-ref', `refs/heads/${branch}`, commit])
  return commit
}

describe('syncFromRemote', () => {
  it('a run pushed to origin appears after a sync, addressable as a remote branch', async () => {
    await addUpstreamRun('remote-fresh')
    expect((await clone.listRuns()).map((r) => r.slug)).not.toContain('remote-fresh')

    await clone.syncFromRemote()

    const ref = (await clone.listRuns()).find((r) => r.slug === 'remote-fresh')
    expect(ref).toBeDefined()
    expect(ref!.kind).toBe('remote')
    expect((await clone.readState(ref!)).state).not.toBeNull()
  })

  it('fast-forwards clean local branches, including the detached default branch', async () => {
    const template = await goodTemplate()
    const git = clone.git
    await git.run(['branch', template.branch, `origin/${template.branch}`])

    const newRunTip = await advanceUpstream(template.branch, template.slug)
    const doneSlug = (await upstream.source.listRuns()).find((r) => r.kind === 'default')!.slug
    const newMainTip = await advanceUpstream('main', doneSlug)

    await clone.syncFromRemote()

    expect(await git.revParse(`refs/heads/${template.branch}`)).toBe(newRunTip)
    expect(await git.revParse('refs/heads/main')).toBe(newMainTip)
  })

  it('never clobbers a local branch holding an unpushed decision', async () => {
    await addUpstreamRun('contested')
    await clone.syncFromRemote()

    const ref = (await clone.listRuns()).find((r) => r.slug === 'contested')!
    const write = await clone.writeState(ref, (doc) => doc.set('phase', 'plan'), 'state(contested): local decision')
    expect(write.ok).toBe(true)

    const upstreamTip = await advanceUpstream('run/contested', 'contested')
    await clone.syncFromRemote()

    // The diverged local branch is untouched; the news still lands remote-side.
    expect(await clone.git.revParse('refs/heads/run/contested')).toBe(write.commit)
    expect(await clone.git.revParse('refs/remotes/origin/run/contested')).toBe(upstreamTip)
  })
})

describe('push through the worktree write path', () => {
  it('a decision committed via a checked-out branch still reaches origin', async () => {
    await addUpstreamRun('checked-out')
    const pusher = new LocalGitSource('clone', cloneDir, { push: true })
    await pusher.syncFromRemote()
    const ref = (await pusher.listRuns()).find((r) => r.slug === 'checked-out')!

    // Materialize the local branch, then check it out in a worktree so
    // writeState takes the worktree commit path instead of plumbing+CAS.
    const git = pusher.git
    await git.run(['branch', 'run/checked-out', 'origin/run/checked-out'])
    const wt = join(scratch, 'wt-checked-out')
    await git.run(['worktree', 'add', '--quiet', wt, 'run/checked-out'])

    const write = await pusher.writeState(ref, (doc) => doc.set('phase', 'plan'), 'state(checked-out): decision via worktree')
    expect(write.ok).toBe(true)
    expect(write.message ?? '').not.toContain('push failed')
    expect(await upstream.source.git.revParse('refs/heads/run/checked-out')).toBe(write.commit)
  })
})

describe('syncFromRemote under local-only (AC2.4)', () => {
  it('returns before any git invocation when localOnly is set', async () => {
    const localOnlySource = new LocalGitSource('clone', cloneDir, { localOnly: true })
    const runSpy = vi.spyOn(localOnlySource.git, 'run')

    await localOnlySource.syncFromRemote()

    expect(runSpy).not.toHaveBeenCalled()
  })
})

describe('fetch_interval config plumbing', () => {
  it('reaches the source as fetchIntervalSeconds', async () => {
    const configPath = join(scratch, 'config.yaml')
    await writeFile(configPath, `sources:\n  - name: clone\n    path: ${cloneDir}\n    push: false\n    fetch_interval: 45\n`)
    const { sources } = await loadSources({ configPath })
    expect((sources[0] as LocalGitSource).fetchIntervalSeconds).toBe(45)
  })
})
