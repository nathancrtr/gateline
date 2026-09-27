// #500: the engine reads adapter manifests through git at the host's local
// default-branch ref, never from the working tree. `headless.command` is the
// argv the engine executes, so a branch that happens to be checked out, or an
// uncommitted edit, must not change what runs.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { Git } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { loadHeadlessManifestAt, resolveHostTip } from '../src/manifest.ts'
import { type HostRepo, makeHostRepo, manifestJson, prefixedLock } from './host-repo.helper.ts'

const repos: HostRepo[] = []
const extraDirs: string[] = []
afterEach(() => {
  for (const r of repos.splice(0)) r.remove()
  for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function host(branch?: string): HostRepo {
  const r = makeHostRepo(branch)
  repos.push(r)
  return r
}

/** Load at the resolved host tip, the way `assembleOrchestrator` does. */
async function loadAtTip(repo: HostRepo, adapter: string, prefixHint?: string) {
  const git = new Git(repo.dir)
  const tip = await resolveHostTip(git)
  return loadHeadlessManifestAt(git, tip.commit, adapter, prefixHint, tip.name)
}

describe('loadHeadlessManifestAt (#500)', () => {
  it('returns the default branch’s manifest while another branch is checked out', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-main') }, 'fake adapter')
    repo.checkout('feature', true)
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-feature') }, 'feature: change the command')

    const manifest = await loadAtTip(repo, 'fake')
    expect(manifest.command).toEqual(['from-main', '{prompt}'])
  })

  it('ignores an uncommitted edit to the manifest on the default branch itself', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('from-main') }, 'fake adapter')
    repo.write({ 'adapters/fake/manifest.json': manifestJson('uncommitted') })

    const manifest = await loadAtTip(repo, 'fake')
    expect(manifest.command).toEqual(['from-main', '{prompt}'])
  })

  it('fails, naming the file and the ref, when the adapter exists only on an unmerged branch', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')
    repo.checkout('add-adapter', true)
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('unmerged') }, 'add the fake adapter')

    const err = await loadAtTip(repo, 'fake').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(
      'adapter "fake": no adapters/fake/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there; ' +
        'the working tree has one, which is not used until it is merged',
    )
  })

  it('fails without the working-tree note when the adapter exists nowhere', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')

    await expect(loadAtTip(repo, 'fake')).rejects.toThrow(
      /^adapter "fake": no adapters\/fake\/manifest\.json at main, the default-branch tip — the engine runs only an adapter merged there$/,
    )
  })

  it('reads a custom-prefix host (gateline init --prefix) by the lock at the tip, even when the working tree’s lock disagrees', async () => {
    const repo = host()
    repo.commit(
      {
        '.framework/framework-lock.json': prefixedLock('.framework'),
        '.framework/adapters/fake/manifest.json': manifestJson('prefixed-main'),
      },
      'integrate under .framework',
    )
    // The checked-out branch switches the lock to the root layout and adds a
    // root-layout adapter with another command. Read from the working tree,
    // the lock would send the loader to adapters/fake and run `root-feature`.
    repo.checkout('feature', true)
    repo.commit(
      {
        '.framework/framework-lock.json': JSON.stringify({ layout: 'root' }),
        'adapters/fake/manifest.json': manifestJson('root-feature'),
      },
      'feature: move to the root layout',
    )

    const manifest = await loadAtTip(repo, 'fake', '.framework')
    expect(manifest.command).toEqual(['prefixed-main', '{prompt}'])
  })

  it('names the missing lock and the ref when a prefixed integration exists only on an unmerged branch', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')
    repo.checkout('integrate', true)
    repo.commit(
      {
        '.framework/framework-lock.json': prefixedLock('.framework'),
        '.framework/adapters/fake/manifest.json': manifestJson('unmerged'),
      },
      'integrate under .framework',
    )

    await expect(loadAtTip(repo, 'fake', '.framework')).rejects.toThrow(
      'adapter "fake": no .framework/framework-lock.json at main, the default-branch tip, so the framework is not integrated there ' +
        'and adapters/fake/manifest.json was looked for instead — the engine runs only an integration merged there; ' +
        'the working tree has one, which is not used until it is merged',
    )
  })

  it('names the ref and path when the committed manifest is not valid JSON', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': '{ not json' }, 'broken adapter')

    await expect(loadAtTip(repo, 'fake')).rejects.toThrow(/^main:adapters\/fake\/manifest\.json: /)
  })
})

describe('resolveHostTip (#500)', () => {
  it('resolves the branch, not a tag that shares its name', async () => {
    const repo = host()
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('tagged-old') }, 'fake adapter')
    repo.git(['tag', 'main'])
    repo.commit({ 'adapters/fake/manifest.json': manifestJson('branch-new') }, 'change the command')
    const branchTip = repo.git(['rev-parse', 'refs/heads/main']).trim()
    expect(repo.git(['rev-parse', 'refs/tags/main']).trim()).not.toBe(branchTip)

    const tip = await resolveHostTip(new Git(repo.dir))
    expect(tip).toEqual({ name: 'main', ref: 'refs/heads/main', commit: branchTip, fallback: false })
    expect((await loadAtTip(repo, 'fake')).command).toEqual(['branch-new', '{prompt}'])
  })

  it('resolves a remote-tracking default branch through refs/remotes when there is no local one', async () => {
    const origin = host()
    origin.commit({ 'adapters/fake/manifest.json': manifestJson('from-origin') }, 'fake adapter')
    const clone = `${origin.dir}-clone`
    extraDirs.push(clone)
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
    execFileSync('git', ['clone', '-q', origin.dir, clone], { env })
    execFileSync('git', ['-C', clone, 'checkout', '-q', '-b', 'work'], { env })
    execFileSync('git', ['-C', clone, 'branch', '-q', '-D', 'main'], { env })

    const git = new Git(clone)
    const tip = await resolveHostTip(git)
    expect(tip.name).toBe('origin/main')
    expect(tip.ref).toBe('refs/remotes/origin/main')
    expect(tip.fallback).toBe(false)
    expect((await loadHeadlessManifestAt(git, tip.commit, 'fake', undefined, tip.name)).command).toEqual(['from-origin', '{prompt}'])
  })

  it('flags the checked-out-branch fallback when there is no origin/HEAD, main or master', async () => {
    const repo = host('trunk')
    repo.commit({ 'README.md': 'host\n' }, 'seed')

    const tip = await resolveHostTip(new Git(repo.dir))
    expect(tip).toMatchObject({ name: 'trunk', ref: 'refs/heads/trunk', fallback: true })
  })

  it('does not flag a host whose default branch is main, whatever is checked out', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')
    repo.checkout('feature', true)

    expect(await resolveHostTip(new Git(repo.dir))).toMatchObject({ name: 'main', fallback: false })
  })
})
