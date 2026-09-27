// #500: the assembled orchestrator loads its adapter manifests at the host's
// default-branch tip, refuses to start on an adapter that is not merged there,
// and its stale-manifest probe watches the tip rather than the file on disk.
import { afterEach, describe, expect, it } from 'vitest'
import { assembleOrchestrator } from '../src/start.ts'
import { type HostRepo, makeHostRepo, manifestJson } from './host-repo.helper.ts'

const repos: HostRepo[] = []
afterEach(() => {
  for (const r of repos.splice(0)) r.remove()
})
function host(): HostRepo {
  const r = makeHostRepo()
  repos.push(r)
  return r
}

const MANIFEST = 'adapters/claude-code/manifest.json'

describe('assembleOrchestrator reads adapter manifests at the default-branch tip (#500)', () => {
  it('refuses to start when the adapter’s manifest is only on the checked-out, unmerged branch', async () => {
    const repo = host()
    repo.commit({ 'README.md': 'host\n' }, 'seed')
    repo.checkout('add-adapter', true)
    repo.commit({ [MANIFEST]: manifestJson('unmerged') }, 'add the claude-code adapter')

    await expect(assembleOrchestrator({ repoDir: repo.dir })).rejects.toThrow(
      'adapter "claude-code": no adapters/claude-code/manifest.json at main, the default-branch tip — the engine runs only an adapter merged there; ' +
        'the working tree has one, which is not used until it is merged',
    )
  })

  it('starts on a local-only host whose manifest is merged, while another branch is checked out', async () => {
    const repo = host()
    repo.commit({ [MANIFEST]: manifestJson('from-main') }, 'claude-code adapter')
    repo.checkout('feature', true)
    repo.commit({ [MANIFEST]: manifestJson('from-feature') }, 'feature: change the command')

    const { engine } = await assembleOrchestrator({ repoDir: repo.dir })
    expect(engine.source.localOnly).toBe(true)
  })

  it('reports a manifest change on the default branch, once, and never a working-tree or branch edit', async () => {
    const repo = host()
    repo.commit({ [MANIFEST]: manifestJson('v1') }, 'claude-code adapter')
    const { manifestStaleProbe } = await assembleOrchestrator({ repoDir: repo.dir })
    expect(await manifestStaleProbe()).toEqual([])

    // An uncommitted edit, then the same edit committed on another branch:
    // neither changes what the engine would run, so neither is reported.
    repo.write({ [MANIFEST]: manifestJson('v2') })
    expect(await manifestStaleProbe()).toEqual([])
    repo.checkout('feature', true)
    repo.commit({ [MANIFEST]: manifestJson('v2') }, 'feature: change the command')
    expect(await manifestStaleProbe()).toEqual([])

    repo.checkout('main')
    repo.git(['merge', '-q', '--ff-only', 'feature'])
    expect(await manifestStaleProbe()).toEqual([
      'adapter manifest "claude-code" changed on main after load — manifests are read once at startup, from the default-branch tip; ' +
        `restart to apply (${MANIFEST})`,
    ])
    expect(await manifestStaleProbe()).toEqual([])
  })
})
