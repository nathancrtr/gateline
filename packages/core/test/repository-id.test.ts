// A repository's id (#494, docs/MULTI-REPO.md §6): the one parser of origin
// URLs, the rules an id must satisfy, and how `loadSources` names a set of
// repositories. Every expected id here is a literal — computing it with the
// function under test would prove nothing.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  deriveRepositoryId,
  displayNameOf,
  Git,
  idFromOrigin,
  LocalGitSource,
  loadSources,
  localNameProblem,
  parseGitHubRemote,
  parseOriginUrl,
  RepositoryIdError,
  repositoryIdProblem,
  sameRepositoryId,
} from '../src/index.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' })

describe('idFromOrigin — the one parser of origin URLs', () => {
  const cases: [string, string][] = [
    // SSH, scp-like
    ['git@github.com:acme/billing.git', 'github.com/acme/billing'],
    ['git@github.com:acme/billing', 'github.com/acme/billing'],
    // ssh:// with a user and a port
    ['ssh://git@github.com:22/acme/billing.git', 'github.com/acme/billing'],
    ['ssh://deploy@git.example.com:2222/acme/billing', 'git.example.com/acme/billing'],
    // HTTPS, with and without credentials, trailing slash and .git
    ['https://github.com/acme/billing', 'github.com/acme/billing'],
    ['https://github.com/acme/billing.git', 'github.com/acme/billing'],
    ['https://github.com/acme/billing/', 'github.com/acme/billing'],
    ['https://github.com/acme/billing.git/', 'github.com/acme/billing'],
    ['https://ci-bot:s3cret@github.com:443/acme/billing.git', 'github.com/acme/billing'],
    ['git://git.example.com/acme/billing.git', 'git.example.com/acme/billing'],
    // Surrounding whitespace, as a shell or a config line may leave it
    ['  git@github.com:acme/billing.git\n', 'github.com/acme/billing'],
  ]
  for (const [url, id] of cases) {
    it(`${JSON.stringify(url)} → ${id}`, () => {
      expect(idFromOrigin(url)).toBe(id)
    })
  }

  it('gives the SSH and HTTPS forms of one repository the same id', () => {
    const forms = [
      'git@github.com:acme/billing.git',
      'ssh://git@github.com/acme/billing',
      'ssh://git@github.com:22/acme/billing.git',
      'https://github.com/acme/billing',
      'https://user@github.com/acme/billing.git/',
    ]
    expect(new Set(forms.map(idFromOrigin))).toEqual(new Set(['github.com/acme/billing']))
  })

  it('lowercases the host and keeps the case of owner and name', () => {
    expect(idFromOrigin('git@GitHub.COM:Acme/Billing.git')).toBe('github.com/Acme/Billing')
    expect(idFromOrigin('https://GITHUB.com/AcmeCorp/BillingService')).toBe('github.com/AcmeCorp/BillingService')
  })

  it('keeps every level of a nested GitLab group', () => {
    expect(idFromOrigin('git@gitlab.com:acme/platform/payments/billing.git')).toBe('gitlab.com/acme/platform/payments/billing')
    expect(idFromOrigin('https://gitlab.example.com/acme/platform/payments/billing')).toBe('gitlab.example.com/acme/platform/payments/billing')
    expect(parseOriginUrl('ssh://git@gitlab.com:2222/acme/platform/payments/billing.git')).toEqual({
      host: 'gitlab.com',
      path: ['acme', 'platform', 'payments', 'billing'],
    })
  })

  it('gives no id for a filesystem path or a file:// URL', () => {
    for (const url of [
      '/srv/git/billing.git',
      '/var/folders/xy/T/gateline-origin.git',
      '../billing.git',
      './billing',
      'billing.git',
      '~/repos/billing',
      'file:///srv/git/billing.git',
      'FILE:///srv/git/billing.git',
      'C:\\repos\\billing',
      'C:/repos/billing',
      './dir:with-colon/billing',
    ]) {
      expect(idFromOrigin(url), url).toBeNull()
    }
  })

  it('gives no id for nothing at all', () => {
    expect(idFromOrigin(null)).toBeNull()
    expect(idFromOrigin(undefined)).toBeNull()
    expect(idFromOrigin('')).toBeNull()
    expect(idFromOrigin('https://github.com/')).toBeNull()
    expect(idFromOrigin('git@github.com:')).toBeNull()
  })
})

describe('parseGitHubRemote reads through the same parser', () => {
  it('answers for github.com in every form the parser accepts', () => {
    expect(parseGitHubRemote('ssh://git@github.com:22/acme/billing.git')).toEqual({ owner: 'acme', repo: 'billing' })
    expect(parseGitHubRemote('git@GitHub.com:acme/billing')).toEqual({ owner: 'acme', repo: 'billing' })
  })

  it('answers for nothing else, and not for a path deeper than owner/repo', () => {
    expect(parseGitHubRemote('git@gitlab.com:acme/billing.git')).toBeNull()
    expect(parseGitHubRemote('https://github.com/acme/billing/tree/main')).toBeNull()
    expect(parseGitHubRemote('/srv/git/billing.git')).toBeNull()
  })
})

describe('the rules an id must satisfy', () => {
  it('refuses a segment that is "-", which the URL shape reserves', () => {
    expect(repositoryIdProblem('github.com/-/billing')).toMatch(/segment that is "-"/)
    expect(repositoryIdProblem('github.com/acme/-')).toMatch(/segment that is "-"/)
    expect(repositoryIdProblem('local/-')).not.toBeNull()
  })

  it('accepts dashes inside a segment', () => {
    expect(repositoryIdProblem('github.com/acme-corp/billing-api')).toBeNull()
    expect(repositoryIdProblem('local/demo-small')).toBeNull()
  })

  it('refuses empty, dot and single-segment ids', () => {
    expect(repositoryIdProblem('billing')).toMatch(/at least two segments/)
    expect(repositoryIdProblem('github.com//billing')).toMatch(/empty segment/)
    expect(repositoryIdProblem('github.com/acme/..')).toMatch(/"\." or "\.\."/)
    expect(repositoryIdProblem('github.com/acme bill/x')).toMatch(/whitespace/)
  })

  it('limits a local name to letters, digits, ".", "_" and "-", and not "-" alone', () => {
    for (const ok of ['demo', 'demo-small', 'Billing_2', 'v1.2', 'a']) expect(localNameProblem(ok), ok).toBeNull()
    for (const bad of ['-', '.', '..', 'my repo', 'billing!', 'caf\u00e9', 'a/b', '']) expect(localNameProblem(bad), bad).not.toBeNull()
    expect(repositoryIdProblem('local/demo/extra')).toMatch(/exactly one name/)
    expect(repositoryIdProblem('local/my%20repo')).toMatch(/may contain only/)
  })

  it('compares ids without case', () => {
    expect(sameRepositoryId('github.com/Acme/Billing', 'GITHUB.COM/acme/billing')).toBe(true)
    expect(sameRepositoryId('github.com/acme/billing', 'github.com/acme/billing-2')).toBe(false)
  })
})

describe('deriveRepositoryId — precedence', () => {
  it('prefers a configured id, then the origin, then local/<name>, then local/<basename>', () => {
    const origin = 'git@github.com:acme/billing.git'
    expect(deriveRepositoryId({ origin, explicitId: 'git.example.com/acme/billing', name: 'bills', dir: '/r/billing' })).toEqual({
      id: 'git.example.com/acme/billing',
      from: 'config',
    })
    expect(deriveRepositoryId({ origin, name: 'bills', dir: '/r/billing' })).toEqual({ id: 'github.com/acme/billing', from: 'origin' })
    expect(deriveRepositoryId({ origin: null, name: 'bills', dir: '/r/billing' })).toEqual({ id: 'local/bills', from: 'local' })
    expect(deriveRepositoryId({ origin: null, dir: '/r/billing/' })).toEqual({ id: 'local/billing', from: 'local' })
    expect(deriveRepositoryId({ origin: '/srv/git/billing.git', dir: '/r/billing' })).toEqual({ id: 'local/billing', from: 'local' })
  })

  it('refuses an unusable configured id, and a basename that is not a usable local name', () => {
    expect(() => deriveRepositoryId({ origin: null, explicitId: 'github.com/-/billing', dir: '/r/b' })).toThrow(RepositoryIdError)
    expect(() => deriveRepositoryId({ origin: null, dir: '/r/my repo' })).toThrow(/give it a `name`/)
    expect(() => deriveRepositoryId({ origin: null, name: 'bad name', dir: '/r/b' })).toThrow(/its configured name/)
  })
})

describe('Git.remoteUrl — what the id is read from', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gateline-494-remote-'))
    git(dir, 'init', '-q', '-b', 'main')
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('is null with no origin at all', async () => {
    expect(await new Git(dir).remoteUrl('origin')).toBeNull()
  })

  it('honours an insteadOf rewrite set in the repository’s config', async () => {
    git(dir, 'config', 'url.git@github.com:.insteadOf', 'gh:')
    git(dir, 'remote', 'add', 'origin', 'gh:acme/billing.git')
    // The raw config line is the alias; git resolves it, and so the id.
    expect(git(dir, 'config', '--get', 'remote.origin.url').trim()).toBe('gh:acme/billing.git')
    expect(await new Git(dir).remoteUrl('origin')).toBe('git@github.com:acme/billing.git')
    expect(idFromOrigin(await new Git(dir).remoteUrl('origin'))).toBe('github.com/acme/billing')
  })
})

describe('loadSources names the set (§6)', () => {
  let base: string
  const noConfig = { configPath: '/nonexistent/gateline-494/config.yaml' }

  /** A fresh repository at `<base>/<rel>`, with an origin when one is given; returns its real top. */
  async function repo(rel: string, origin?: string): Promise<string> {
    const dir = join(base, rel)
    await mkdir(dir, { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    // The root layout, so a config entry passes the framework check (§7.2).
    for (const tree of ['roles', 'contracts', 'registry']) {
      await mkdir(join(dir, tree))
      await writeFile(join(dir, tree, 'README'), `${tree}\n`)
    }
    git(dir, 'add', '-A')
    git(dir, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
    if (origin) git(dir, 'remote', 'add', 'origin', origin)
    return realpath(dir)
  }

  async function config(body: string): Promise<string> {
    const path = join(base, `config-${Math.random().toString(36).slice(2)}.yaml`)
    await writeFile(path, body)
    return path
  }

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'gateline-494-set-'))
  })
  afterAll(() => rm(base, { recursive: true, force: true }))

  it('names a repository by its origin, and one without by local/<basename>', async () => {
    const withOrigin = await repo('a/billing-clone', 'git@github.com:acme/billing.git')
    const without = await repo('a/scratch')
    const { sources } = await loadSources({ repoOverrides: [withOrigin, without], ...noConfig })
    expect(sources.map((s) => s.id)).toEqual(['github.com/acme/billing', 'local/scratch'])
    expect(sources.map(displayNameOf)).toEqual(['billing', 'scratch'])
  })

  it('treats a filesystem origin as none', async () => {
    const dir = await repo('b/mirror', '/srv/git/billing.git')
    const { sources } = await loadSources({ repoOverrides: [dir], ...noConfig })
    expect(sources[0]!.id).toBe('local/mirror')
  })

  it('reads a config name as the display name when there is an origin, and as the local name when there is not', async () => {
    const withOrigin = await repo('c/one', 'https://github.com/acme/billing')
    const without = await repo('c/two')
    const path = await config(`sources:\n  - name: bills\n    path: ${withOrigin}\n    mode: decide\n  - name: notes\n    path: ${without}\n    mode: view\n`)
    const { sources } = await loadSources({ configPath: path })
    expect(sources.map((s) => [s.id, displayNameOf(s)])).toEqual([
      ['github.com/acme/billing', 'bills'],
      ['local/notes', 'notes'],
    ])
  })

  it('takes an id: stated outright over the origin', async () => {
    const dir = await repo('d/aliased', 'work-gh:acme/billing.git')
    const path = await config(`repositories:\n  - path: ${dir}\n    mode: decide\n    id: github.com/acme/billing\n`)
    const { sources } = await loadSources({ configPath: path })
    expect(sources[0]!.id).toBe('github.com/acme/billing')
    expect(displayNameOf(sources[0]!)).toBe('billing')
  })

  it('refuses an id: that breaks the rules, at startup', async () => {
    const dir = await repo('d2/x')
    const path = await config(`repositories:\n  - path: ${dir}\n    mode: decide\n    id: github.com/acme/-\n`)
    await expect(loadSources({ configPath: path })).rejects.toThrow(RepositoryIdError)
  })

  it('refuses a directory name that is not a usable local name, asking for a name', async () => {
    const dir = await repo('d3/my repo')
    await expect(loadSources({ repoOverrides: [dir], ...noConfig })).rejects.toThrow(/has no origin, so it is named local\/<name> from its directory name/)
  })

  it('lists the old names and former_ids a link may carry', async () => {
    const dir = await repo('e/billing-checkout', 'git@github.com:acme/billing.git')
    const path = await config(`repositories:\n  - name: bills\n    path: ${dir}\n    mode: decide\n    former_ids: [github.com/acme/old-billing]\n`)
    const { sources } = await loadSources({ configPath: path })
    expect([...(sources[0]!.formerIds ?? [])].sort()).toEqual(
      ['bills', 'bills-2', 'billing-checkout', 'billing-checkout-2', 'github.com/acme/old-billing'].sort(),
    )
  })

  it('refuses two entries with one id, naming both paths', async () => {
    const first = await repo('f/billing', 'git@github.com:acme/billing.git')
    const second = await repo('f/billing-again', 'https://github.com/acme/billing')
    const path = await config(`repositories:\n  - path: ${first}\n    mode: decide\n  - name: other\n    path: ${second}\n    mode: decide\n`)
    const err = await loadSources({ configPath: path }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepositoryIdError)
    expect((err as Error).message).toContain('two repositories resolve to the id github.com/acme/billing')
    expect((err as Error).message).toContain(first)
    expect((err as Error).message).toContain(second)
  })

  it('refuses two ids that differ only in case', async () => {
    const first = await repo('g/one', 'git@github.com:Acme/Billing.git')
    const second = await repo('g/two', 'git@github.com:acme/billing.git')
    const path = await config(`repositories:\n  - name: a\n    path: ${first}\n    mode: decide\n  - name: b\n    path: ${second}\n    mode: decide\n`)
    await expect(loadSources({ configPath: path })).rejects.toThrow(/resolve to the id github\.com\/Acme\/Billing/)
  })

  it('refuses one repository listed twice under two names, which would otherwise get two local ids', async () => {
    const dir = await repo('h0/twice')
    const path = await config(`repositories:\n  - name: one\n    path: ${dir}\n    mode: decide\n  - name: two\n    path: ${dir}\n    mode: view\n`)
    await expect(loadSources({ configPath: path })).rejects.toThrow(`${dir} is listed twice, as local/one and local/two. List each repository once`)
  })

  it('refuses two local repositories of the same name, where #494 retired the -2 suffix', async () => {
    const first = await repo('h1/demo')
    const second = await repo('h2/demo')
    const err = await loadSources({ repoOverrides: [first, second], ...noConfig }).catch((e: unknown) => e)
    expect((err as Error).message).toContain('two repositories resolve to the id local/demo')
    expect((err as Error).message).toContain(first)
    expect((err as Error).message).toContain(second)
  })

  it('refuses two repositories with one display name, asking for a name', async () => {
    const first = await repo('i/one', 'git@github.com:acme/billing.git')
    const second = await repo('i/two', 'git@gitlab.com:other/billing.git')
    const path = await config(`repositories:\n  - path: ${first}\n    mode: decide\n  - path: ${second}\n    mode: decide\n`)
    await expect(loadSources({ configPath: path })).rejects.toThrow(/two repositories have the display name "billing".*Give one of them a `name`/)
    // …and a name settles it.
    const named = await config(`repositories:\n  - path: ${first}\n    mode: decide\n  - name: other-billing\n    path: ${second}\n    mode: decide\n`)
    const { sources } = await loadSources({ configPath: named })
    expect(sources.map(displayNameOf)).toEqual(['billing', 'other-billing'])
  })

  it('writes nothing into the repository to name it', async () => {
    const dir = await repo('j/quiet', 'git@github.com:acme/quiet.git')
    const before = git(dir, 'config', '--list', '--local')
    await loadSources({ repoOverrides: [dir], ...noConfig })
    expect(git(dir, 'config', '--list', '--local')).toBe(before)
    expect(git(dir, 'status', '--porcelain')).toBe('')
  })
})

describe('a directly built source', () => {
  it('reports the id it was given, and the last segment as its display name', () => {
    const s = new LocalGitSource('github.com/acme/billing', '/nowhere')
    expect(s.id).toBe('github.com/acme/billing')
    expect(displayNameOf(s)).toBe('billing')
    expect(displayNameOf(new LocalGitSource('orchestrator', '/nowhere'))).toBe('orchestrator')
    expect(displayNameOf({ id: 'local/demo' })).toBe('demo')
  })
})
