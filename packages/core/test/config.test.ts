// #83 regression: loadSources roots every source at the work-tree toplevel.
// A subdirectory source reads state fine (`show ref:path` is root-relative)
// but lists no artifacts (pathspecs are cwd-relative), so gates vanish from
// the inbox without an error. All three acceptance paths must normalize.
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildPortfolio, loadSources, LocalOnlyPushConflictError, planDecision, type LocalGitSource } from '../src/index.ts'
import { dropFixture, makeFixture, type FixtureContext } from './fixture.helper.ts'

let ctx: FixtureContext
let toplevel: string
let subdir: string
// A config path that never exists, so loadSources exercises the cwd fallback
// instead of reading the developer's real ~/.config/gateline/config.yaml.
const noConfig = { configPath: '/nonexistent/gateline-83/config.yaml' }

beforeAll(async () => {
  ctx = await makeFixture()
  toplevel = await realpath(ctx.repo.dir)
  subdir = join(ctx.repo.dir, 'subdir-83')
  await mkdir(subdir, { recursive: true })
})

afterAll(async () => {
  await dropFixture(ctx)
})

describe('loadSources roots sources at the repo toplevel (#83)', () => {
  it('cwd fallback from a subdirectory resolves to the toplevel', async () => {
    const { sources, warnings } = await loadSources({ cwd: subdir, ...noConfig })
    expect(warnings).toEqual([])
    expect(sources).toHaveLength(1)
    expect((sources[0] as LocalGitSource).dir).toBe(toplevel)
  })

  it('--repo pointing at a subdirectory resolves to the toplevel', async () => {
    const { sources } = await loadSources({ repoOverrides: [subdir], cwd: subdir, ...noConfig })
    expect(sources).toHaveLength(1)
    expect((sources[0] as LocalGitSource).dir).toBe(toplevel)
  })

  it('inbox derived from a subdirectory launch matches the repo root', async () => {
    const { sources } = await loadSources({ cwd: subdir, ...noConfig })
    const fromSub = await buildPortfolio(sources)
    const fromRoot = await buildPortfolio([ctx.source])
    const key = (i: { kind: string; slug: string; gate: string | null }) => `${i.kind}:${i.slug}:${i.gate}`
    expect(fromSub.inbox.length).toBeGreaterThan(0) // parity must not hold vacuously
    expect(fromSub.inbox.map(key)).toEqual(fromRoot.inbox.map(key))
    // The symptom that shipped: runs render while the inbox is empty.
    expect(fromSub.runs.length).toBe(fromRoot.runs.length)
  })
})

// --- Mode resolution table (plan "Mode resolution table") ------------------
describe('local-only mode resolution', () => {
  let fx: FixtureContext
  const cleanups: string[] = []
  const modeNoConfig = { configPath: '/nonexistent/gateline-01/config.yaml' }

  beforeEach(async () => {
    fx = await makeFixture()
  })
  afterEach(async () => {
    await dropFixture(fx)
    for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** Gives the fixture repo a real, reachable bare origin, returning its path
   * so callers can observe whether a decision actually pushed to it — via
   * `originTip`, the same discriminator `divergence.test.ts` uses. A reachable
   * origin means `pushFailed` alone never tells apart "push suppressed" from
   * "push succeeded"; only the origin's own ref tip does. */
  function addOrigin(dir: string): string {
    const bare = `${dir}-origin.git`
    cleanups.push(bare)
    execFileSync('git', ['clone', '--quiet', '--bare', dir, bare])
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', bare])
    return bare
  }

  /** The current tip of `branch` in a bare origin, or null if the ref doesn't exist there yet. */
  function originTip(bare: string, branch: string): string | null {
    try {
      return execFileSync('git', ['-C', bare, 'rev-parse', `refs/heads/${branch}`], { encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  }

  /** Approve G0 on the fixture's pending run through `source`, returning the write result. */
  async function decide(source: LocalGitSource) {
    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const { state } = await source.readState(ref)
    const planned = planDecision(state!, { action: 'approve', gate: 'G0', burden: 'confirmation' }, { name: 'Op', email: 'op@example.test' })
    return source.writeState(ref, planned.mutate, planned.message)
  }

  /** Writes a one-source config.yaml body to a fresh temp file, returning its path. */
  async function writeConfig(body: string): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'gateline-mode-'))
    cleanups.push(tmpDir)
    const configPath = join(tmpDir, 'config.yaml')
    await writeFile(configPath, body)
    return configPath
  }

  it('AC1.1: a remoteless zero-config source auto-detects local-only (trigger unchanged)', async () => {
    const { sources } = await loadSources({ repoOverrides: [fx.repo.dir], ...modeNoConfig })
    expect((sources[0] as LocalGitSource).localOnly).toBe(true)
  })

  it('AC1.2: explicit opts.localOnly on an origin repo forces push off', async () => {
    const bare = addOrigin(fx.repo.dir)
    const { sources } = await loadSources({ repoOverrides: [fx.repo.dir], localOnly: true, ...modeNoConfig })
    const source = sources[0] as LocalGitSource
    expect(source.localOnly).toBe(true)

    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const before = originTip(bare, ref.branch)
    const result = await decide(source)
    expect(result.ok).toBe(true)
    expect(result.pushFailed).toBeUndefined() // push never attempted
    expect(originTip(bare, ref.branch)).toBe(before) // origin untouched — a reachable origin would otherwise accept the push
  })

  it('opts.push=false implies local-only at the CLI tier (ADR-1)', async () => {
    addOrigin(fx.repo.dir)
    const { sources } = await loadSources({ repoOverrides: [fx.repo.dir], push: false, ...modeNoConfig })
    expect((sources[0] as LocalGitSource).localOnly).toBe(true)
  })

  it("config push:false with an origin stays localOnly=false (ADR-2's poller case)", async () => {
    const bare = addOrigin(fx.repo.dir)
    const configPath = await writeConfig(`sources:\n  - name: poller\n    path: ${fx.repo.dir}\n    push: false\n`)

    const { sources } = await loadSources({ configPath })
    const source = sources[0] as LocalGitSource
    expect(source.localOnly).toBe(false)

    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const before = originTip(bare, ref.branch)
    const result = await decide(source)
    expect(result.ok).toBe(true)
    expect(originTip(bare, ref.branch)).toBe(before) // push:false ceiling honored — origin untouched either way
  })

  it('a remoteless config entry auto-detects local-only', async () => {
    const configPath = await writeConfig(`sources:\n  - name: remoteless\n    path: ${fx.repo.dir}\n`)

    const { sources } = await loadSources({ configPath })
    expect((sources[0] as LocalGitSource).localOnly).toBe(true)
  })

  it('AC1.3: a config entry with an origin and no push key stays push:false (existing default)', async () => {
    // Unlike the CLI tier, a config entry with no explicit `push` key does not
    // auto-detect on origin existence — it keeps the pre-diff default of
    // push:false (plan table rule 3, config-tier branch). Only `localOnly`
    // itself auto-detects from origin existence (here: false, since one exists).
    const bare = addOrigin(fx.repo.dir)
    const configPath = await writeConfig(`sources:\n  - name: quiet\n    path: ${fx.repo.dir}\n`)

    const { sources } = await loadSources({ configPath })
    const source = sources[0] as LocalGitSource
    expect(source.localOnly).toBe(false)

    const ref = (await source.listRuns()).find((r) => r.slug === 'g0-pending')!
    const before = originTip(bare, ref.branch)
    const result = await decide(source)
    expect(result.ok).toBe(true)
    expect(originTip(bare, ref.branch)).toBe(before) // config-tier default is push:false — origin untouched
  })

  it('AC4.1: config local_only:true + push:true throws LocalOnlyPushConflictError', async () => {
    const configPath = await writeConfig(`sources:\n  - name: conflict\n    path: ${fx.repo.dir}\n    local_only: true\n    push: true\n`)

    await expect(loadSources({ configPath })).rejects.toThrow(LocalOnlyPushConflictError)
  })

  it('AC4.1: opts.localOnly + opts.push both true throws LocalOnlyPushConflictError', async () => {
    await expect(
      loadSources({ repoOverrides: [fx.repo.dir], localOnly: true, push: true, ...modeNoConfig }),
    ).rejects.toThrow(LocalOnlyPushConflictError)
  })

  it('AC1.3: existing push precedence is unchanged — explicit push:true still overrides auto-detect', async () => {
    // No origin at all: auto-detect alone would resolve push=false, but an
    // explicit push:true must still win (and stays a plain push ceiling,
    // not local-only).
    const { sources } = await loadSources({ repoOverrides: [fx.repo.dir], push: true, ...modeNoConfig })
    const source = sources[0] as LocalGitSource
    expect(source.localOnly).toBe(false)

    const result = await decide(source)
    expect(result.ok).toBe(true)
    expect(result.pushFailed).toBeDefined() // push was attempted against a nonexistent origin
  })

  it('a source resolving local-only with fetch_interval set warns that the interval is inert', async () => {
    const configPath = await writeConfig(`sources:\n  - name: inert-poller\n    path: ${fx.repo.dir}\n    local_only: true\n    fetch_interval: 30\n`)

    const { warnings } = await loadSources({ configPath })
    expect(warnings).toContain('source inert-poller: fetch_interval ignored — local-only')
  })
})
