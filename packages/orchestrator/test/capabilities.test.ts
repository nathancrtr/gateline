// #182: the engine's only signal for "does this role have a shell" is the
// role spec's own frontmatter — there is no adapter-side capability map. A
// prefixed layout (gateline init --layout prefixed) must resolve too,
// since roles/ travels under the metadata prefix same as adapters/contracts.
//
// #500: the specs are read through git at the default-branch tip, so a
// checked-out branch or an uncommitted edit changes nothing until merged.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Git } from '@gateline/core'
import { afterEach, describe, expect, it } from 'vitest'
import { hasShell, loadRoleCapabilities } from '../src/capabilities.ts'
import { Engine } from '../src/engine.ts'
import { removeRunCheckout } from '../src/workspace.ts'
import { FakeDispatcher, makeToyRepo, TEST_REGISTRY } from './engine.helper.ts'
import { type HostRepo, makeHostRepo, prefixedLock } from './host-repo.helper.ts'

const BOT = { name: 'gateline-orchestrator', email: 'orchestrator@gateline.invalid' }

const roleSpec = (capabilitiesLine: string | null) =>
  [
    '---',
    'role: toy',
    'dispatch: A toy role.',
    'capability_profile: balanced',
    ...(capabilitiesLine ? [capabilitiesLine] : []),
    'inputs: []',
    'outputs: []',
    'writes_code: false',
    'gate: G0',
    '---',
    '',
    '# Toy',
    '',
  ].join('\n')

const SHELL_LESS = roleSpec('capabilities: [read, search, write-artifacts]')
const SHELL_FUL = roleSpec('capabilities: [read, search, write-artifacts, shell]')

const repos: HostRepo[] = []
afterEach(() => {
  for (const r of repos.splice(0)) r.remove()
})

/** A host with `files` committed to main, which stays checked out. */
function host(files: Record<string, string>): HostRepo {
  const r = makeHostRepo()
  repos.push(r)
  r.commit({ 'README.md': 'host\n', ...files }, 'seed')
  return r
}

async function capsAtTip(repo: HostRepo, opts: Parameters<typeof loadRoleCapabilities>[2] = {}) {
  const git = new Git(repo.dir)
  return loadRoleCapabilities(git, await git.defaultBranch(), opts)
}

describe('loadRoleCapabilities', () => {
  it('parses a shell-less role: capabilities present, no shell', async () => {
    const caps = await capsAtTip(host({ 'roles/analyst.md': SHELL_LESS }))
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('parses a shell-ful role: capabilities present, shell included', async () => {
    const caps = await capsAtTip(host({ 'roles/reviewer.md': SHELL_FUL }))
    expect(hasShell(caps, 'reviewer')).toBe(true)
  })

  it('defaults an unknown role to shell-ful', async () => {
    const caps = await capsAtTip(host({ 'roles/analyst.md': SHELL_LESS }))
    expect(hasShell(caps, 'no-such-role')).toBe(true)
  })

  it('defaults a role file with no capabilities line to shell-ful', async () => {
    const caps = await capsAtTip(host({ 'roles/orchestrator.md': roleSpec(null) }))
    expect(hasShell(caps, 'orchestrator')).toBe(true)
  })

  it('defaults every role to shell-ful when the roles dir is missing entirely', async () => {
    const caps = await capsAtTip(host({}))
    expect(caps.size).toBe(0)
    expect(hasShell(caps, 'analyst')).toBe(true)
  })

  it('resolves roles/ under the metadata prefix for a prefixed layout', async () => {
    const caps = await capsAtTip(
      host({ '.gateline/framework-lock.json': prefixedLock('.gateline'), '.gateline/roles/analyst.md': SHELL_LESS }),
    )
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('resolves roles/ under a custom prefix (gateline init --prefix) given the hint', async () => {
    const repo = host({ '.framework/framework-lock.json': prefixedLock('.framework'), '.framework/roles/analyst.md': SHELL_LESS })
    expect(hasShell(await capsAtTip(repo, { prefixHint: '.framework' }), 'analyst')).toBe(false)
    // Without the hint the lock is not found, the root layout is assumed, and
    // there are no role specs at roles/.
    expect((await capsAtTip(repo)).size).toBe(0)
  })
})

describe('loadRoleCapabilities reads the default-branch tip (#500)', () => {
  it('returns the default branch’s capabilities while another branch is checked out', async () => {
    const repo = host({ 'roles/analyst.md': SHELL_LESS })
    repo.checkout('feature', true)
    repo.commit({ 'roles/analyst.md': SHELL_FUL }, 'feature: give the analyst a shell')

    const caps = await capsAtTip(repo)
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('ignores an uncommitted edit to a role spec on the default branch itself', async () => {
    const repo = host({ 'roles/analyst.md': SHELL_LESS })
    repo.write({ 'roles/analyst.md': SHELL_FUL })

    const caps = await capsAtTip(repo)
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('reads a custom-prefix host at the tip while a branch changes the spec', async () => {
    const repo = host({ '.framework/framework-lock.json': prefixedLock('.framework'), '.framework/roles/analyst.md': SHELL_LESS })
    repo.checkout('feature', true)
    repo.commit({ '.framework/roles/analyst.md': SHELL_FUL }, 'feature: give the analyst a shell')

    const caps = await capsAtTip(repo, { prefixHint: '.framework' })
    expect(hasShell(caps, 'analyst')).toBe(false)
  })

  it('names the file and the ref for a role spec that is only in the working tree, and does not read it', async () => {
    const repo = host({ 'roles/analyst.md': SHELL_LESS })
    repo.checkout('add-role', true)
    repo.commit({ 'roles/scout.md': SHELL_LESS }, 'add an unmerged role spec')

    const lines: string[] = []
    const caps = await capsAtTip(repo, { log: (line) => lines.push(line) })
    expect(caps.has('scout')).toBe(false)
    expect(hasShell(caps, 'scout')).toBe(true)
    expect(lines).toEqual([
      'role spec roles/scout.md is in the working tree but not at main, the default-branch tip — ' +
        'its capabilities are not read until it is merged, and "scout" defaults shell-ful',
    ])
  })
})

// The same property one level up: the engine's own capability read, not only
// the loader, must take the default branch's spec while another is checked out.
describe('Engine reads role capabilities at the default-branch tip (#500)', () => {
  it('treats the analyst as shell-less per main while a branch that gives it a shell is checked out', async () => {
    const { dir } = makeToyRepo()
    const toy = (args: string[]) => execFileSync('git', ['-C', dir, ...args])
    mkdirSync(join(dir, 'roles'), { recursive: true })
    writeFileSync(join(dir, 'roles', 'analyst.md'), SHELL_LESS)
    toy(['add', 'roles/analyst.md'])
    toy(['commit', '-q', '-m', 'toy: shell-less analyst'])
    toy(['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(dir, 'roles', 'analyst.md'), SHELL_FUL)
    toy(['commit', '-q', '-am', 'feature: give the analyst a shell'])

    const bodies: string[] = []
    const dispatcher = new FakeDispatcher((req) => {
      bodies.push(req.body)
      return {}
    })
    const engine = new Engine({ repoDir: dir, identity: BOT, dispatcher, registry: TEST_REGISTRY, staleMs: 600_000 })
    try {
      await engine.tick()
      await engine.drain()
      expect(bodies).toHaveLength(1)
      // The shell-less wording (#182): the fold harvests, so the prompt never asks for a commit.
      expect(bodies[0]).toContain('the orchestrator commits them for you')
      expect(bodies[0]).not.toContain('git add')
    } finally {
      await removeRunCheckout(dir, 'run/toy')
    }
  })
})

// The point of reading role specs through @gateline/framework rather than a
// second regex: the engine and the renderer cannot disagree about a frontmatter
// block. A role the renderer understands but this reader drops would silently
// default to shell-ful and lose its harvest, so assert coverage against the
// real specs rather than fixtures only. Read at HEAD, the commit this checkout
// is on, since the grep side reads the same checkout's files.
describe('against this repository’s own role specs', () => {
  const REPO = fileURLToPath(new URL('../../../', import.meta.url))
  const repoCaps = () => loadRoleCapabilities(new Git(REPO), 'HEAD')

  it('drops no role spec that declares capabilities', async () => {
    // Expectation derived by grep, independently of the parser under test: a
    // role goes missing here only because the parse failed, never because the
    // spec is silent. The Orchestrator is legitimately silent — it drives the
    // pipeline rather than being dispatched into it — so it is absent by right.
    const specs = readdirSync(join(REPO, 'roles')).filter((f) => f.endsWith('.md'))
    const declaring = specs
      .filter((f) => /^capabilities:/m.test(readFileSync(join(REPO, 'roles', f), 'utf8')))
      .map((f) => f.slice(0, -'.md'.length))
      .sort()
    const caps = await repoCaps()
    expect(declaring.length).toBeGreaterThan(0)
    expect([...caps.keys()].sort()).toEqual(declaring)
    expect(declaring).not.toContain('orchestrator')
  })

  it('agrees with the frontmatter on who has a shell', async () => {
    const caps = await repoCaps()
    expect(hasShell(caps, 'analyst')).toBe(false)
    expect(hasShell(caps, 'architect')).toBe(false)
    expect(hasShell(caps, 'implementer')).toBe(true)
    expect(hasShell(caps, 'reviewer')).toBe(true)
  })
})
