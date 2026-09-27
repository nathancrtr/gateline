// The framework check (#495, docs/MULTI-REPO.md §7.2): a repository joins the
// set only when its default branch carries a framework lock, or the root
// layout (`roles/`, `contracts/`, `registry/`). It reads the default branch
// through git, never the working tree. Expected messages are literals.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, checkFramework, Git, loadSources } from '../src/index.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' })

const LOCK = (prefix: string, ref: string) =>
  `${JSON.stringify({ source: { repo: null, ref, version: 'unreleased' }, layout: 'prefixed', prefix }, null, 2)}\n`

let base: string
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'gateline-495-check-'))
})
afterAll(() => rm(base, { recursive: true, force: true }))

/** A repository at `<base>/<name>` on `main`, whose one commit holds `files`; returns its real path. */
async function repo(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  await writeFile(join(dir, 'README.md'), `# ${name}\n`)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
  return realpath(dir)
}

describe('checkFramework (§7.2)', () => {
  it('passes a lock at the default prefix, and reports the ref it pins', async () => {
    const dir = await repo('default-prefix', { '.gateline/framework-lock.json': LOCK('.gateline', 'v0.3.0') })
    expect(await checkFramework(new Git(dir))).toEqual({
      ok: true,
      carries: 'lock',
      prefix: '.gateline',
      pinnedRef: 'v0.3.0',
      defaultBranch: 'main',
    })
  })

  it('passes a lock at a custom prefix when gateline_prefix names it', async () => {
    const dir = await repo('custom-prefix', { '.framework/framework-lock.json': LOCK('.framework', '0123456789abcdef0123456789abcdef01234567') })
    const check = await checkFramework(new Git(dir), { prefix: '.framework' })
    expect(check).toEqual({
      ok: true,
      carries: 'lock',
      prefix: '.framework',
      pinnedRef: '0123456789abcdef0123456789abcdef01234567',
      defaultBranch: 'main',
    })
  })

  it('refuses a lock at a custom prefix without gateline_prefix, naming the setting and the directory', async () => {
    const dir = await repo('custom-unnamed', { '.framework/framework-lock.json': LOCK('.framework', 'v0.3.0') })
    const check = await checkFramework(new Git(dir), { label: '/repos/website' })
    expect(check.ok).toBe(false)
    expect(check.ok === false && check.locksElsewhere).toEqual(['.framework'])
    expect(check.ok === false && check.message).toBe(
      '/repos/website: no framework lock at .gateline/framework-lock.json on its default branch (main), but there is one at ' +
        '.framework/framework-lock.json. If it was integrated with `gateline init --prefix .framework`, set ' +
        '`gateline_prefix: .framework` on its entry (`gateline repo add <path> --mode <mode> --gateline-prefix .framework`). ' +
        'Otherwise integrate it with `gateline init <path> --provenance <redistribute|private>`',
    )
  })

  it('passes the root layout with no lock, which `repo list` marks "no lock"', async () => {
    const dir = await repo('root-layout', { 'roles/README': 'r\n', 'contracts/README': 'c\n', 'registry/README': 'g\n' })
    expect(await checkFramework(new Git(dir))).toEqual({ ok: true, carries: 'root', defaultBranch: 'main' })
  })

  it('refuses a repository with neither, naming `gateline init`', async () => {
    const dir = await repo('unrelated', { 'roles/README': 'only one of the three\n' })
    const check = await checkFramework(new Git(dir), { label: '/repos/unrelated' })
    expect(check.ok).toBe(false)
    expect(check.ok === false && check.message).toBe(
      '/repos/unrelated does not carry the framework: its default branch (main) has no .gateline/framework-lock.json, ' +
        'and no roles/, contracts/ and registry/ at its root. Integrate it with ' +
        '`gateline init <path> --provenance <redistribute|private>` and merge that change to main; the check reads main ' +
        'as committed, so an unmerged integration does not count yet',
    )
  })

  // The lock sits on an unmerged branch that is checked out, so the working
  // tree holds it: a check that read the working tree would pass this.
  it('refuses a lock that exists only on an unmerged branch, even with that branch checked out', async () => {
    const dir = await repo('unmerged', {})
    git(dir, 'checkout', '-q', '-b', 'integrate-gateline')
    await mkdir(join(dir, '.gateline'))
    await writeFile(join(dir, '.gateline', 'framework-lock.json'), LOCK('.gateline', 'v0.3.0'))
    git(dir, 'add', '-A')
    git(dir, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'gateline init')
    const check = await checkFramework(new Git(dir), { label: '/repos/unmerged' })
    expect(check.ok).toBe(false)
    expect(check.ok === false && check.message).toContain('Integrate it with `gateline init <path> --provenance <redistribute|private>`')
    expect(check.ok === false && check.message).toContain('its default branch (main) has no .gateline/framework-lock.json')
  })

  it('refuses a lock that is only in the working tree, uncommitted', async () => {
    const dir = await repo('uncommitted', {})
    await mkdir(join(dir, '.gateline'))
    await writeFile(join(dir, '.gateline', 'framework-lock.json'), LOCK('.gateline', 'v0.3.0'))
    for (const tree of ['roles', 'contracts', 'registry']) {
      await mkdir(join(dir, tree))
      await writeFile(join(dir, tree, 'README'), 'x\n')
    }
    expect((await checkFramework(new Git(dir))).ok).toBe(false)
  })

  it('applies to config entries: loadSources refuses a listed repository that fails it', async () => {
    const dir = await repo('listed-unrelated', {})
    const configPath = join(base, 'config-unrelated.yaml')
    await writeFile(configPath, `repositories:\n  - path: ${dir}\n    mode: decide\n`)
    const err = await loadSources({ configPath }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toBe(
      `config at ${configPath}: ${dir} does not carry the framework: its default branch (main) has no .gateline/framework-lock.json, ` +
        'and no roles/, contracts/ and registry/ at its root. Integrate it with ' +
        '`gateline init <path> --provenance <redistribute|private>` and merge that change to main; the check reads main ' +
        'as committed, so an unmerged integration does not count yet',
    )
  })

  it('reads gateline_prefix from the config entry', async () => {
    const dir = await repo('listed-custom', { '.framework/framework-lock.json': LOCK('.framework', 'v0.3.0') })
    const configPath = join(base, 'config-custom.yaml')
    await writeFile(configPath, `repositories:\n  - path: ${dir}\n    mode: decide\n    gateline_prefix: .framework\n`)
    const { sources } = await loadSources({ configPath })
    expect(sources.map((s) => s.id)).toEqual(['local/listed-custom'])
  })

  it('does not apply to --repo, which keeps serving an unchecked repository as before', async () => {
    const dir = await repo('zero-config-unrelated', {})
    const { sources } = await loadSources({ repoOverrides: [dir], configPath: '/nonexistent/gateline-495/config.yaml' })
    expect(sources.map((s) => s.id)).toEqual(['local/zero-config-unrelated'])
  })
})
