// #500: the engine reads adapter manifests through git at the host's
// default-branch tip, never from the working tree. `headless.command` is the
// argv the engine executes, so a branch that happens to be checked out, or an
// uncommitted edit, must not change what runs before it is merged.
import { Git } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { loadHeadlessManifestAt } from '../src/manifest.ts'
import { type HostRepo, makeHostRepo, manifestJson, prefixedLock } from './host-repo.helper.ts'

const repos: HostRepo[] = []
afterEach(() => {
  for (const r of repos.splice(0)) r.remove()
})
function host(): HostRepo {
  const r = makeHostRepo()
  repos.push(r)
  return r
}

describe('loadHeadlessManifestAt (#500)', () => {
  it('returns the default branch’s manifest while another branch is checked out', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-main') }, 'fake adapter')
    repo.checkout('feature', true)
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-feature') }, 'feature: change the command')

    const git = new Git(repo.dir)
    const rev = await git.defaultBranch()
    expect(rev).toBe('main')
    const manifest = await loadHeadlessManifestAt(git, rev, 'fake')
    expect(manifest.command).toEqual(['from-main', '{prompt}'])
  })

  it('ignores an uncommitted edit to the manifest on the default branch itself', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-main') }, 'fake adapter')
    repo.write({ 'adapters/fake/manifest.json': manifestJson('uncommitted') })

    const git = new Git(repo.dir)
    const manifest = await loadHeadlessManifestAt(git, await git.defaultBranch(), 'fake')
    expect(manifest.command).toEqual(['from-main', '{prompt}'])
  })

  it('fails, naming the file and the ref, when the adapter exists only on an unmerged branch', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')
    repo.checkout('add-adapter', true)
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('unmerged') }, 'add the fake adapter')

    const git = new Git(repo.dir)
    const err = await loadHeadlessManifestAt(git, await git.defaultBranch(), 'fake').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(
      'adapter "fake": no adapters/fake/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there; ' +
        'the working tree has one, which is not used until it is merged',
    )
  })

  it('fails without the working-tree note when the adapter exists nowhere', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')

    const git = new Git(repo.dir)
    await expect(loadHeadlessManifestAt(git, 'main', 'fake')).rejects.toThrow(
      /^adapter "fake": no adapters\/fake\/manifest\.json at main, the default-branch tip — the engine runs only an adapter merged there$/,
    )
  })

  it('reads a custom-prefix host (gateline init --prefix) at the tip, and the lock there decides the layout', async () => {
    const repo = host()
    repo.commit(
      {
        '.framework/framework-lock.json': prefixedLock('.framework'),
        '.framework/adapters/fake/manifest.json': manifestJson('prefixed-main'),
      },
      'integrate under .framework',
    )
    repo.checkout('feature', true)
    repo.commit({ '.framework/adapters/fake/manifest.json': manifestJson('prefixed-feature') }, 'feature: change the command')

    const git = new Git(repo.dir)
    const rev = await git.defaultBranch()
    const manifest = await loadHeadlessManifestAt(git, rev, 'fake', '.framework')
    expect(manifest.command).toEqual(['prefixed-main', '{prompt}'])

    // Without the hint the lock is not found at the default `.gateline`
    // location, so the root layout is assumed and the error names that path.
    await expect(loadHeadlessManifestAt(git, rev, 'fake')).rejects.toThrow(/no adapters\/fake\/manifest\.json at main/)
  })

  it('names the ref and path when the committed manifest is not valid JSON', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': '{ not json' }, 'broken adapter')

    const git = new Git(repo.dir)
    await expect(loadHeadlessManifestAt(git, 'main', 'fake')).rejects.toThrow(/^main:adapters\/fake\/manifest\.json: /)
  })
})
