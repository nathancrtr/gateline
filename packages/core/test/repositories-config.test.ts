// The operator's config file under #495 (docs/MULTI-REPO.md §7): the
// `repositories:` key and its `sources:` alias, the required `mode` (R3), the
// machine's limits and engine defaults, unknown keys, the repository ceiling
// (P3), the mode each source resolves to (§7.3), and the push default each
// mode takes (R2, TOPOLOGY.md §3.6). Expected values are literals.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConfigError, type LocalGitSource, LocalOnlyPushConflictError, loadSources, planDecision } from '../src/index.ts'
import { dropFixture, makeFixture } from './fixture.helper.ts'

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env, encoding: 'utf8' })
const noConfig = { configPath: '/nonexistent/gateline-495/config.yaml' }

let base: string
let billing: string // has an origin: github.com/acme/billing
let website: string // has no origin: local/website
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'gateline-495-config-'))
  billing = await repo('billing', 'git@github.com:acme/billing.git')
  website = await repo('website')
})
afterAll(() => rm(base, { recursive: true, force: true }))

/** A repository carrying the root layout, with an origin when one is given. */
async function repo(name: string, origin?: string): Promise<string> {
  const dir = join(base, name)
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
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

const refusal = async (configPath: string) => {
  const err = await loadSources({ configPath }).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ConfigError)
  return (err as Error).message
}

describe('the list key', () => {
  it('reads `repositories:`', async () => {
    const path = await config(`repositories:\n  - path: ${billing}\n    mode: decide\n`)
    const { sources } = await loadSources({ configPath: path })
    expect(sources.map((s) => s.id)).toEqual(['github.com/acme/billing'])
  })

  it('reads `sources:` as an alias', async () => {
    const path = await config(`sources:\n  - path: ${website}\n    mode: view\n`)
    const { sources } = await loadSources({ configPath: path })
    expect(sources.map((s) => s.id)).toEqual(['local/website'])
  })

  it('refuses a file with both', async () => {
    const path = await config(`repositories:\n  - path: ${billing}\n    mode: decide\nsources:\n  - path: ${website}\n    mode: decide\n`)
    expect(await refusal(path)).toBe(
      `config at ${path}: both \`repositories:\` and \`sources:\` appear. \`sources:\` is the older name of the same list; move its entries under \`repositories:\` and delete it`,
    )
  })
})

describe('mode is required (R3)', () => {
  it('refuses an entry with no mode, naming the entry and the three modes', async () => {
    const path = await config(`sources:\n  - name: billing\n    path: ${billing}\n`)
    expect(await refusal(path)).toBe(
      `config at ${path}: sources[0] (${billing}) states no mode. Every entry needs one: add ` +
        '`mode: view` (read only), `mode: decide` (also record decisions) or `mode: dispatch` (also run an engine under `up`)',
    )
  })

  it('names the second entry when it is the one without', async () => {
    const path = await config(`repositories:\n  - path: ${billing}\n    mode: decide\n  - path: ${website}\n`)
    expect(await refusal(path)).toContain(`repositories[1] (${website}) states no mode`)
  })

  it('refuses a mode that is not one of the three', async () => {
    const path = await config(`repositories:\n  - path: ${billing}\n    mode: watch\n`)
    expect(await refusal(path)).toBe(`config at ${path}: repositories[0] (${billing}): mode "watch" is not one of view, decide, dispatch`)
  })
})

describe('limits and engine defaults (§7.4)', () => {
  const full = (repoLimit = 25) =>
    [
      'limits:',
      '  max_concurrent_dispatches: 2',
      '  spend_limit_usd: 40',
      '  spend_window_hours: 24',
      'engine:',
      '  adapters: [claude-code]',
      '  role_timeout_seconds: 1800',
      '  heartbeat_seconds: 180',
      'repositories:',
      `  - path: ${billing}`,
      '    name: billing',
      '    mode: dispatch',
      '    limits:',
      `      spend_limit_usd: ${repoLimit}`,
      `  - path: ${website}`,
      '    mode: decide',
      '',
    ].join('\n')

  it('parses them and exposes them on the loaded config', async () => {
    const loaded = await loadSources({ configPath: await config(full()) })
    expect(loaded.limits).toEqual({ maxConcurrentDispatches: 2, spendLimitUsd: 40, spendWindowHours: 24 })
    expect(loaded.engine).toEqual({ adapters: ['claude-code'], roleTimeoutSeconds: 1800, heartbeatSeconds: 180 })
    expect(loaded.repositoryLimits).toEqual({ 'github.com/acme/billing': { spendLimitUsd: 25 } })
  })

  it('allows a repository limit equal to the machine limit', async () => {
    const loaded = await loadSources({ configPath: await config(full(40)) })
    expect(loaded.repositoryLimits).toEqual({ 'github.com/acme/billing': { spendLimitUsd: 40 } })
  })

  it('refuses a repository limit above the machine limit: the operator sets the ceiling (P3)', async () => {
    const path = await config(full(41))
    expect(await refusal(path)).toBe(
      `config at ${path}: repositories[0] (${billing}): limits.spend_limit_usd 41 is above the machine's limits.spend_limit_usd 40. ` +
        "The machine's limit is the ceiling; a repository may only set a lower one",
    )
  })

  it('leaves both empty with no config file', async () => {
    const loaded = await loadSources({ repoOverrides: [billing], ...noConfig })
    expect(loaded.limits).toEqual({})
    expect(loaded.engine).toEqual({})
    expect(loaded.repositoryLimits).toEqual({})
  })

  it.each([
    ['at the top level', `budget: 3\nrepositories:\n  - path: BILLING\n    mode: decide\n`, 'the top level: unknown key "budget"'],
    ['in limits', `limits:\n  spend_limit: 40\nrepositories:\n  - path: BILLING\n    mode: decide\n`, 'limits: unknown key "spend_limit"'],
    ['in engine', `engine:\n  adapter: claude-code\nrepositories:\n  - path: BILLING\n    mode: decide\n`, 'engine: unknown key "adapter"'],
    ['in an entry', `repositories:\n  - path: BILLING\n    mode: decide\n    pushes: true\n`, 'repositories[0] (BILLING): unknown key "pushes"'],
    [
      "in an entry's limits",
      `repositories:\n  - path: BILLING\n    mode: decide\n    limits:\n      max_concurrent_dispatches: 1\n`,
      'repositories[0] (BILLING), limits: unknown key "max_concurrent_dispatches"',
    ],
  ])('refuses an unknown key %s, naming it', async (_where, body, expected) => {
    const path = await config(body.replaceAll('BILLING', billing))
    expect(await refusal(path)).toBe(`config at ${path}: ${expected.replaceAll('BILLING', billing)}`)
  })
})

describe('the mode each source resolves to (§7.3)', () => {
  const modes = async (opts: { configPath: string; engine?: boolean }) =>
    (await loadSources(opts)).sources.map((s) => [s.id, s.mode])

  it('takes a config entry at its word, except that dispatch reads as decide with no engine', async () => {
    const path = await config(
      `repositories:\n  - path: ${billing}\n    mode: dispatch\n  - path: ${website}\n    mode: view\n`,
    )
    expect(await modes({ configPath: path })).toEqual([
      ['github.com/acme/billing', 'decide'],
      ['local/website', 'view'],
    ])
    expect(await modes({ configPath: path, engine: true })).toEqual([
      ['github.com/acme/billing', 'dispatch'],
      ['local/website', 'view'],
    ])
  })

  it('gives a repository with no entry decide, or dispatch under an engine', async () => {
    const at = async (engine: boolean) => (await loadSources({ repoOverrides: [website], ...noConfig, engine })).sources.map((s) => s.mode)
    expect(await at(false)).toEqual(['decide'])
    expect(await at(true)).toEqual(['dispatch'])
    const cwd = await loadSources({ cwd: website, ...noConfig })
    expect(cwd.sources.map((s) => s.mode)).toEqual(['decide'])
  })
})

describe('push by mode (R2, TOPOLOGY.md §3.6)', () => {
  const resolved = async (body: string) => {
    const { sources } = await loadSources({ configPath: await config(body) })
    const s = sources[0] as LocalGitSource
    return { push: s.push, localOnly: s.localOnly }
  }
  const entry = (path: string, mode: string, extra = '') => `repositories:\n  - path: ${path}\n    mode: ${mode}\n${extra}`

  it.each([
    ['view', { push: false, localOnly: false }],
    ['decide', { push: false, localOnly: false }],
    ['dispatch', { push: true, localOnly: false }],
  ])('a %s entry with an origin', async (mode, expected) => {
    expect(await resolved(entry(billing, mode))).toEqual(expected)
  })

  it.each(['view', 'decide', 'dispatch'])('a %s entry with no origin is local-only and never pushes', async (mode) => {
    expect(await resolved(entry(website, mode))).toEqual({ push: false, localOnly: true })
  })

  it('an explicit push: false wins over the dispatch default, and stays a poller, not local-only', async () => {
    expect(await resolved(entry(billing, 'dispatch', '    push: false\n'))).toEqual({ push: false, localOnly: false })
  })

  it('an explicit local_only: true wins over the dispatch default', async () => {
    expect(await resolved(entry(billing, 'dispatch', '    local_only: true\n'))).toEqual({ push: false, localOnly: true })
  })

  it('an explicit push: true wins over the decide default', async () => {
    expect(await resolved(entry(billing, 'decide', '    push: true\n'))).toEqual({ push: true, localOnly: false })
  })

  it('still refuses local_only: true with push: true on a dispatch entry', async () => {
    const path = await config(entry(billing, 'dispatch', '    local_only: true\n    push: true\n'))
    await expect(loadSources({ configPath: path })).rejects.toThrow(LocalOnlyPushConflictError)
  })

  // End to end: a decision in a dispatch repository reaches origin, as `up`'s
  // zero-config source does, while a decide repository's stays local.
  it('a decision in a dispatch entry with an origin is pushed, and one in a decide entry is not', async () => {
    for (const [mode, pushed] of [
      ['dispatch', true],
      ['decide', false],
    ] as const) {
      const fx = await makeFixture()
      const bare = `${fx.repo.root}/origin.git`
      try {
        execFileSync('git', ['clone', '--quiet', '--bare', fx.repo.dir, bare])
        git(fx.repo.dir, 'remote', 'add', 'origin', bare)
        const { sources } = await loadSources({ configPath: await config(entry(fx.repo.dir, mode)) })
        const source = sources[0]!
        const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
        const before = git(bare, 'rev-parse', `refs/heads/${ref.branch}`).trim()
        const { state } = await source.readState(ref)
        const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
        const result = await source.writeState(ref, planned.mutate, planned.message)
        expect(result.ok, mode).toBe(true)
        const after = git(bare, 'rev-parse', `refs/heads/${ref.branch}`).trim()
        expect(after === result.commit, mode).toBe(pushed)
        expect(after === before, mode).toBe(!pushed)
      } finally {
        await dropFixture(fx)
      }
    }
  })
})

describe('engine.name and engine.budget_enforcement (#502)', () => {
  it('parses both, as written: the orchestrator checks the name', async () => {
    const path = await config(`engine:\n  name: "my laptop"\n  budget_enforcement: false\nrepositories:\n  - path: ${billing}\n    mode: dispatch\n`)
    expect((await loadSources({ configPath: path })).engine).toEqual({ name: 'my laptop', budgetEnforcement: false })
  })

  it('refuses a budget_enforcement that is not a boolean', async () => {
    const path = await config(`engine:\n  budget_enforcement: "no"\nrepositories:\n  - path: ${billing}\n    mode: dispatch\n`)
    expect(await refusal(path)).toBe(`config at ${path}: engine.budget_enforcement: Invalid input: expected boolean, received string`)
  })
})

describe('how each repository is served, named for `up` (#502)', () => {
  const settings = async (opts: Parameters<typeof loadSources>[0]) => (await loadSources(opts)).repositorySettings
  const entry = (path: string, mode: string, extra = '') => `  - path: ${path}\n    mode: ${mode}\n${extra}`

  it.each([
    ['dispatch', '', { push: true, localOnly: false, pushBecause: 'origin auto-detected' }],
    ['decide', '', { push: false, localOnly: false, pushBecause: 'view and decide entries push only with push: true' }],
    ['dispatch', '    push: false\n', { push: false, localOnly: false, pushBecause: 'push: false' }],
    ['decide', '    push: true\n', { push: true, localOnly: false, pushBecause: 'push: true' }],
    ['dispatch', '    local_only: true\n', { push: false, localOnly: true, pushBecause: 'local_only: true' }],
    ['dispatch', '    local_only: false\n', { push: true, localOnly: false, pushBecause: 'origin auto-detected' }],
  ])('a %s entry with an origin and %j', async (mode, extra, expected) => {
    const path = await config(`repositories:\n${entry(billing, mode, extra)}`)
    expect(await settings({ configPath: path })).toEqual({ 'github.com/acme/billing': expected })
  })

  it('a config entry with no origin', async () => {
    const path = await config(`repositories:\n${entry(website, 'dispatch')}`)
    expect(await settings({ configPath: path })).toEqual({ 'local/website': { push: false, localOnly: true, pushBecause: 'no origin remote' } })
  })

  it('carries a gateline_prefix through', async () => {
    const prefixed = join(base, 'prefixed')
    await mkdir(join(prefixed, '.framework'), { recursive: true })
    git(prefixed, 'init', '-q', '-b', 'main')
    await writeFile(join(prefixed, '.framework', 'framework-lock.json'), '{}\n')
    git(prefixed, 'add', '-A')
    git(prefixed, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
    const top = await realpath(prefixed)
    const path = await config(`repositories:\n${entry(top, 'dispatch', '    gateline_prefix: .framework\n')}`)
    expect(await settings({ configPath: path })).toEqual({
      'local/prefixed': { push: false, localOnly: true, pushBecause: 'no origin remote', frameworkPrefix: '.framework' },
    })
  })

  it.each([
    [{}, { push: true, localOnly: false, pushBecause: 'origin auto-detected' }],
    [{ push: true }, { push: true, localOnly: false, pushBecause: '--push' }],
    [{ push: false }, { push: false, localOnly: true, pushBecause: '--no-push' }],
    [{ localOnly: true }, { push: false, localOnly: true, pushBecause: '--local-only' }],
  ])('a repository given by --repo, with %j', async (flags, expected) => {
    expect(await settings({ repoOverrides: [billing], ...noConfig, engine: true, ...flags })).toEqual({ 'github.com/acme/billing': expected })
  })

  it('the working directory, with no origin', async () => {
    expect(await settings({ cwd: website, ...noConfig, engine: true })).toEqual({
      'local/website': { push: false, localOnly: true, pushBecause: 'no origin remote' },
    })
  })

  it('a source reports its clone as its working directory', async () => {
    const { sources } = await loadSources({ repoOverrides: [billing], ...noConfig })
    expect(sources[0]!.workingDirectory?.()).toBe(billing)
  })
})

describe('a config file that lists no repositories keeps its limits (review of #550)', () => {
  it.each([
    ['no list key', 'limits:\n  spend_limit_usd: 5\nengine:\n  name: workstation-1\n  budget_enforcement: false\n'],
    ['an empty list', 'limits:\n  spend_limit_usd: 5\nengine:\n  name: workstation-1\n  budget_enforcement: false\nrepositories: []\n'],
  ])('%s: the working directory is served, under the file’s limits: and engine:', async (_name, body) => {
    const path = await config(body)
    const loaded = await loadSources({ configPath: path, cwd: website, engine: true })
    expect(loaded.sources.map((s) => s.id)).toEqual(['local/website'])
    expect([loaded.configPath, loaded.settingsPath]).toEqual([null, path])
    expect(loaded.limits).toEqual({ spendLimitUsd: 5 })
    expect(loaded.engine).toEqual({ name: 'workstation-1', budgetEnforcement: false })
    expect(loaded.warnings).toEqual([
      `config at ${path} lists no repositories; the working directory's repository is served, under the file's limits: and engine:`,
    ])
  })

  it('a file that lists the set reports it as both the set’s source and the settings’', async () => {
    const path = await config(`repositories:\n  - path: ${website}\n    mode: decide\n`)
    const loaded = await loadSources({ configPath: path })
    expect([loaded.configPath, loaded.settingsPath]).toEqual([path, path])
  })

  it('refuses a heartbeat above what a timer holds', async () => {
    const path = await config(`engine:\n  heartbeat_seconds: 2147484\nrepositories:\n  - path: ${website}\n    mode: decide\n`)
    expect(await refusal(path)).toBe(`config at ${path}: engine.heartbeat_seconds: Too big: expected number to be <=2147483`)
  })
})
