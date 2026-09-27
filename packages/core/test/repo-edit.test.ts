// Editing the operator's list (#495, docs/MULTI-REPO.md §7.1): what
// `gateline repo add|remove|list` do to the config file. Edits keep the file's
// comments and the order of what is there; duplicates are refused under
// #494's rules (ids and display names compared without case). Expected file
// text and messages are literals.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addRepository, ConfigError, listRepositories, loadSources, removeRepository } from '../src/index.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' })

let base: string
let billing: string // github.com/acme/billing, root layout
let website: string // local/website, a lock at .gateline pinning v0.3.0
let notes: string // local/notes, root layout
let unrelated: string // carries nothing
let otherBilling: string // gitlab.com/other/billing, root layout: display name "billing" too
let billingClone: string // a second clone of github.com/acme/billing

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'gateline-495-edit-'))
  const root = { 'roles/README': 'r\n', 'contracts/README': 'c\n', 'registry/README': 'g\n' }
  billing = await repo('work/billing', root, 'git@github.com:acme/billing.git')
  website = await repo('work/website', {
    '.gateline/framework-lock.json': `${JSON.stringify({ source: { repo: null, ref: 'v0.3.0', version: '0.3.0' }, layout: 'prefixed', prefix: '.gateline' })}\n`,
  })
  notes = await repo('work/notes', root)
  unrelated = await repo('work/unrelated', {})
  otherBilling = await repo('side/billing', root, 'https://gitlab.com/other/billing.git')
  billingClone = await repo('side/billing-clone', root, 'https://github.com/acme/billing')
})
afterAll(() => rm(base, { recursive: true, force: true }))

async function repo(rel: string, files: Record<string, string>, origin?: string): Promise<string> {
  const dir = join(base, rel)
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  await writeFile(join(dir, 'README.md'), 'x\n')
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
  if (origin) git(dir, 'remote', 'add', 'origin', origin)
  return realpath(dir)
}

const fresh = () => join(base, `cfg-${Math.random().toString(36).slice(2)}`, 'config.yaml')

describe('repo add', () => {
  it('creates the file when there is none', async () => {
    const configPath = fresh()
    const added = await addRepository({ configPath, path: billing, mode: 'dispatch' })
    expect([added.id, added.displayName, added.mode, added.framework.carries, added.stillInvalid]).toEqual([
      'github.com/acme/billing',
      'billing',
      'dispatch',
      'root',
      null,
    ])
    expect(await readFile(configPath, 'utf8')).toBe(`repositories:\n  - path: ${billing}\n    mode: dispatch\n`)
  })

  it('resolves a path inside the repository to its top', async () => {
    const configPath = fresh()
    await addRepository({ configPath, path: join(billing, 'roles'), mode: 'decide' })
    expect(await readFile(configPath, 'utf8')).toBe(`repositories:\n  - path: ${billing}\n    mode: decide\n`)
  })

  it("appends to an existing file, keeping its comments, its other keys and its entries' order", async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    const before = [
      '# The machine this runs on.',
      'limits:',
      '  spend_limit_usd: 40 # across every dispatch repository',
      '',
      'repositories:',
      '  # The first one.',
      `  - path: ${billing}`,
      '    name: bills',
      '    mode: dispatch',
      '',
    ].join('\n')
    await writeFile(configPath, before)
    await addRepository({ configPath, path: notes, mode: 'view', name: 'jot' })
    await addRepository({ configPath, path: website, mode: 'decide', gatelinePrefix: '.gateline' })
    expect(await readFile(configPath, 'utf8')).toBe(
      [
        '# The machine this runs on.',
        'limits:',
        '  spend_limit_usd: 40 # across every dispatch repository',
        '',
        'repositories:',
        '  # The first one.',
        `  - path: ${billing}`,
        '    name: bills',
        '    mode: dispatch',
        `  - path: ${notes}`,
        '    name: jot',
        '    mode: view',
        `  - path: ${website}`,
        '    mode: decide',
        '    gateline_prefix: .gateline',
        '',
      ].join('\n'),
    )
    const { sources } = await loadSources({ configPath })
    expect(sources.map((s) => [s.id, s.displayName, s.mode])).toEqual([
      ['github.com/acme/billing', 'bills', 'decide'],
      ['local/jot', 'jot', 'view'],
      ['local/website', 'website', 'decide'],
    ])
  })

  it('adds under `sources:` when that is the key the file uses', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, `sources:\n  - path: ${billing}\n    mode: decide\n`)
    await addRepository({ configPath, path: notes, mode: 'view' })
    expect(await readFile(configPath, 'utf8')).toBe(`sources:\n  - path: ${billing}\n    mode: decide\n  - path: ${notes}\n    mode: view\n`)
  })

  it('refuses a repository already listed under the same id, compared without case', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, `repositories:\n  - path: ${billing}\n    mode: decide\n    id: GitHub.com/ACME/Billing\n`)
    const before = await readFile(configPath, 'utf8')
    const err = await addRepository({ configPath, path: billingClone, mode: 'view', name: 'another' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toBe(
      `github.com/acme/billing is already listed, as Billing at ${billing}. ` +
        'List each repository once; to change its entry, `gateline repo remove Billing` first',
    )
    expect(await readFile(configPath, 'utf8')).toBe(before)
  })

  // With no origin, a new name would give the same repository a new id
  // (local/<name>), so the path is compared too.
  it('refuses the same repository under another name', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, `repositories:\n  - path: ${notes}\n    mode: decide\n`)
    await expect(addRepository({ configPath, path: notes, mode: 'view', name: 'jot' })).rejects.toThrow(
      `${notes} is already listed, as notes. List each repository once; to change its entry, \`gateline repo remove notes\` first`,
    )
  })

  it('refuses a display name already taken, compared without case, and a --name settles it', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, `repositories:\n  - path: ${billing}\n    mode: decide\n`)
    const err = await addRepository({ configPath, path: otherBilling, mode: 'view' }).catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      'the display name "billing" is already taken by github.com/acme/billing. Give this repository another with --name',
    )
    const upper = await addRepository({ configPath, path: otherBilling, mode: 'view', name: 'BILLING' }).catch((e: unknown) => e)
    expect((upper as Error).message).toBe(
      'the display name "BILLING" is already taken by github.com/acme/billing. Give this repository another with --name',
    )
    const added = await addRepository({ configPath, path: otherBilling, mode: 'view', name: 'other-billing' })
    expect(added.id).toBe('gitlab.com/other/billing')
  })

  it('refuses a repository that does not carry the framework, writing nothing', async () => {
    const configPath = fresh()
    const err = await addRepository({ configPath, path: unrelated, mode: 'decide' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as Error).message).toContain('does not carry the framework')
    expect((err as Error).message).toContain('gateline init')
    await expect(readFile(configPath, 'utf8')).rejects.toThrow()
  })

  it('refuses an unknown mode and a path that is not a repository', async () => {
    await expect(addRepository({ configPath: fresh(), path: billing, mode: 'watch' })).rejects.toThrow(
      '--mode must be one of view, decide, dispatch (got "watch")',
    )
    await expect(addRepository({ configPath: fresh(), path: base, mode: 'view' })).rejects.toThrow(`${base} is not a git repository`)
  })

  it('makes the edit but says so when an older entry still has no mode', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, `sources:\n  - path: ${billing}\n`)
    const added = await addRepository({ configPath, path: notes, mode: 'view' })
    expect(added.stillInvalid).toBe(
      `config at ${configPath}: sources[0] (${billing}) states no mode. Every entry needs one: add ` +
        '`mode: view` (read only), `mode: decide` (also record decisions) or `mode: dispatch` (also run an engine under `up`)',
    )
    expect(await readFile(configPath, 'utf8')).toBe(`sources:\n  - path: ${billing}\n  - path: ${notes}\n    mode: view\n`)
  })
})

describe('repo remove', () => {
  const three = () =>
    [
      '# my repositories',
      'repositories:',
      `  - path: ${billing}   # the busy one`,
      '    mode: dispatch',
      `  - path: ${notes}`,
      '    name: jot',
      '    mode: view',
      `  - path: ${website}`,
      '    mode: decide',
      '',
    ].join('\n')

  it('removes by id, keeping the rest of the file as it was', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, three())
    const removed = await removeRepository({ configPath, which: 'local/JOT' })
    expect([removed.id, removed.displayName]).toEqual(['local/jot', 'jot'])
    expect(await readFile(configPath, 'utf8')).toBe(
      ['# my repositories', 'repositories:', `  - path: ${billing} # the busy one`, '    mode: dispatch', `  - path: ${website}`, '    mode: decide', ''].join('\n'),
    )
  })

  it('removes by display name, compared without case', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, three())
    const removed = await removeRepository({ configPath, which: 'Billing' })
    expect(removed.id).toBe('github.com/acme/billing')
    expect(await readFile(configPath, 'utf8')).toBe(
      ['# my repositories', 'repositories:', `  - path: ${notes}`, '    name: jot', '    mode: view', `  - path: ${website}`, '    mode: decide', ''].join('\n'),
    )
  })

  it('refuses a name that matches nothing', async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(configPath, three())
    await expect(removeRepository({ configPath, which: 'payroll' })).rejects.toThrow(
      `no repository "payroll" in ${configPath}; \`gateline repo list\` prints each one's id and display name`,
    )
  })
})

describe('repo list', () => {
  it("reads each entry's id, origin, display name, mode and framework", async () => {
    const configPath = fresh()
    await mkdir(join(configPath, '..'), { recursive: true })
    await writeFile(
      configPath,
      `repositories:\n  - path: ${billing}\n    mode: dispatch\n  - path: ${website}\n    mode: view\n  - path: ${unrelated}\n    mode: decide\n`,
    )
    const list = await listRepositories({ configPath })
    expect(list.entries.map((e) => [e.id, e.origin, e.displayName, e.mode, e.framework?.ok, e.framework?.ok && e.framework.carries])).toEqual([
      ['github.com/acme/billing', 'git@github.com:acme/billing.git', 'billing', 'dispatch', true, 'root'],
      ['local/website', null, 'website', 'view', true, 'lock'],
      ['local/unrelated', null, 'unrelated', 'decide', false, false],
    ])
  })
})
