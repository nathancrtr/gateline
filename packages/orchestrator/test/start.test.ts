// #500: the assembled orchestrator resolves the host's default branch to one
// commit at startup and reads the adapter manifests there, refuses to start
// on an adapter that is not on that branch, warns when no default branch
// could be determined, and its stale-manifest probe watches that branch
// rather than the file on disk.
import { afterEach, describe, expect, it } from 'vitest'
import { assembleOrchestrator } from '../src/start.ts'
import { type HostRepo, makeHostRepo, manifestJson } from './host-repo.helper.ts'

const repos: HostRepo[] = []
afterEach(() => {
  for (const r of repos.splice(0)) r.remove()
})
function host(branch?: string): HostRepo {
  const r = makeHostRepo(branch)
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

  it('loads the default branch’s command on a local-only host while another branch is checked out', async () => {
    const repo = host()
    repo.commit({ [MANIFEST]: manifestJson('from-main') }, 'claude-code adapter')
    repo.checkout('feature', true)
    repo.commit({ [MANIFEST]: manifestJson('from-feature') }, 'feature: change the command')
    repo.write({ [MANIFEST]: manifestJson('uncommitted') })

    const { engine, manifests } = await assembleOrchestrator({ repoDir: repo.dir })
    expect(engine.source.localOnly).toBe(true)
    expect(manifests.map((m) => m.command)).toEqual([['from-main', '{prompt}']])
  })

  it('reads the branch named main, not a tag named main', async () => {
    const repo = host()
    repo.commit({ [MANIFEST]: manifestJson('tagged-old') }, 'claude-code adapter')
    repo.git(['tag', 'main'])
    repo.commit({ [MANIFEST]: manifestJson('branch-new') }, 'change the command')

    const { manifests, hostTip } = await assembleOrchestrator({ repoDir: repo.dir })
    expect(hostTip.ref).toBe('refs/heads/main')
    expect(hostTip.commit).toBe(repo.git(['rev-parse', 'refs/heads/main']).trim())
    expect(manifests[0]!.command).toEqual(['branch-new', '{prompt}'])
  })

  it('warns once, naming the branch, when no default branch could be determined', async () => {
    const repo = host('trunk')
    repo.commit({ [MANIFEST]: manifestJson('from-trunk') }, 'claude-code adapter')

    const lines: string[] = []
    const { manifests } = await assembleOrchestrator({ repoDir: repo.dir, log: (l) => lines.push(l) })
    expect(manifests[0]!.command).toEqual(['from-trunk', '{prompt}'])
    expect(lines.filter((l) => l.startsWith('WARNING'))).toEqual([
      `WARNING: no default branch could be determined for ${repo.dir} (no origin/HEAD, no main or master) — ` +
        'host configuration (registry, adapter manifests, role capabilities) is being read from the checked-out branch "trunk"',
    ])
  })

  it('does not warn when the default branch is main', async () => {
    const repo = host()
    repo.commit({ [MANIFEST]: manifestJson('from-main') }, 'claude-code adapter')

    const lines: string[] = []
    await assembleOrchestrator({ repoDir: repo.dir, log: (l) => lines.push(l) })
    expect(lines.filter((l) => l.startsWith('WARNING'))).toEqual([])
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
      'adapter manifest "claude-code" changed on main after load — manifests are read once at startup, from the default branch; ' +
        `restart to apply (${MANIFEST})`,
    ])
    expect(await manifestStaleProbe()).toEqual([])
  })
})
