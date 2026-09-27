// The CLI over the operator's list (#495) and the repository in its next
// steps (#497), spawning the real binary against a throwaway config:
// XDG_CONFIG_HOME points at a temp directory, so the operator's own
// ~/.config/gateline is never read or written. Expected output is literal.
import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { type FixtureRepo, generateFixtureRepo } from '@gateline/fixtures'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrationOffer } from '../src/main.ts'

const exec = promisify(execFile)
const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/main.ts')
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { env: gitEnv, encoding: 'utf8' })

interface Ran {
  code: number
  stdout: string
  stderr: string
}

/** Run `gateline <args>` with its config under `xdg`, from `cwd` (a directory that is not a repository). */
async function cli(xdg: string, cwd: string, args: string[]): Promise<Ran> {
  try {
    const { stdout, stderr } = await exec('node', [cliPath, ...args], { cwd, env: { ...process.env, XDG_CONFIG_HOME: xdg } })
    return { code: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** A throwaway config home and a working directory outside any repository. */
async function sandbox(): Promise<{ xdg: string; cwd: string; configPath: string; drop: () => Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gateline-495-cli-')))
  const xdg = join(root, 'xdg')
  const cwd = join(root, 'elsewhere')
  await mkdir(cwd, { recursive: true })
  return { xdg, cwd, configPath: join(xdg, 'gateline', 'config.yaml'), drop: () => rm(root, { recursive: true, force: true }) }
}

const fixtures: FixtureRepo[] = []
function fixture(name: string): FixtureRepo {
  const f = generateFixtureRepo(undefined, { name })
  fixtures.push(f)
  return f
}
afterAll(async () => {
  for (const f of fixtures) await rm(f.root, { recursive: true, force: true })
})

describe('gateline repo add | list | remove', () => {
  let box: Awaited<ReturnType<typeof sandbox>>
  let demo: FixtureRepo
  let small: FixtureRepo
  let billing: string

  beforeAll(async () => {
    box = await sandbox()
    demo = fixture('demo')
    small = fixture('demo-small')
    // A repository whose origin gives it the id github.com/acme/demo, and so
    // the display name "demo", which the demo fixture already has.
    billing = join(box.cwd, '..', 'acme-demo')
    await mkdir(join(billing, 'roles'), { recursive: true })
    await mkdir(join(billing, 'contracts'))
    await mkdir(join(billing, 'registry'))
    for (const t of ['roles', 'contracts', 'registry']) await writeFile(join(billing, t, 'README'), `${t}\n`)
    git(billing, 'init', '-q', '-b', 'main')
    git(billing, 'add', '-A')
    git(billing, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
    git(billing, 'remote', 'add', 'origin', 'git@github.com:acme/demo.git')
  })
  afterAll(() => box.drop())

  it('says where the file would be when there is none', async () => {
    const r = await cli(box.xdg, box.cwd, ['repo', 'list'])
    expect(r).toEqual({
      code: 0,
      stdout:
        `no config file at ${box.configPath}: the set is the repository you run in, or --repo.\n` +
        'Start one with: gateline repo add <path> --mode <view|decide|dispatch>\n',
      stderr: '',
    })
  })

  it('adds, lists, refuses duplicates, and removes by id and by display name', async () => {
    expect(await cli(box.xdg, box.cwd, ['repo', 'add', demo.dir, '--mode', 'decide'])).toEqual({
      code: 0,
      stdout: `added local/demo (demo) as decide, no lock, to ${box.configPath}\n`,
      stderr: '',
    })
    expect(await cli(box.xdg, box.cwd, ['repo', 'add', join(small.dir, 'runs'), '--mode', 'view'])).toEqual({
      code: 0,
      stdout: `added local/demo-small (demo-small) as view, no lock, to ${box.configPath}\n`,
      stderr: '',
    })
    // The path written is the repository's top as git reports it.
    expect(await readFile(box.configPath, 'utf8')).toBe(
      `repositories:\n  - path: ${await realpath(demo.dir)}\n    mode: decide\n  - path: ${await realpath(small.dir)}\n    mode: view\n`,
    )

    expect(await cli(box.xdg, box.cwd, ['repo', 'list'])).toEqual({
      code: 0,
      stdout: [
        'ID                ORIGIN  NAME        MODE    FRAMEWORK',
        'local/demo        none    demo        decide  no lock',
        'local/demo-small  none    demo-small  view    no lock',
        '',
      ].join('\n'),
      stderr: '',
    })

    const sameId = await cli(box.xdg, box.cwd, ['repo', 'add', demo.dir, '--mode', 'view', '--name', 'again'])
    expect(sameId.code).toBe(1)
    expect(sameId.stderr).toBe(
      `${await realpath(demo.dir)} is already listed, as demo. List each repository once; to change its entry, \`gateline repo remove demo\` first\n`,
    )
    const sameName = await cli(box.xdg, box.cwd, ['repo', 'add', billing, '--mode', 'view'])
    expect(sameName.code).toBe(1)
    expect(sameName.stderr).toBe('the display name "demo" is already taken by local/demo. Give this repository another with --name\n')

    expect(await cli(box.xdg, box.cwd, ['repo', 'remove', 'DEMO-small'])).toEqual({
      code: 0,
      stdout: `removed local/demo-small (demo-small) from ${box.configPath}\n`,
      stderr: '',
    })
    expect(await cli(box.xdg, box.cwd, ['repo', 'remove', 'local/demo'])).toEqual({
      code: 0,
      stdout: `removed local/demo (demo) from ${box.configPath}\n`,
      stderr: '',
    })
    expect(await readFile(box.configPath, 'utf8')).toBe('repositories: []\n')
  })

  it('refuses a mode that is not one of the three, and requires one', async () => {
    const bad = await cli(box.xdg, box.cwd, ['repo', 'add', demo.dir, '--mode', 'watch'])
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain("error: option '--mode <mode>' argument 'watch' is invalid. Allowed choices are view, decide, dispatch.")
    const none = await cli(box.xdg, box.cwd, ['repo', 'add', demo.dir])
    expect(none.code).toBe(1)
    expect(none.stderr).toContain("error: required option '--mode <mode>' not specified")
  })

  it('shows the pinned ref for a lock, and "refused" with the reason for a repository that no longer passes', async () => {
    const lockRepo = join(box.cwd, '..', 'locked')
    await mkdir(join(lockRepo, '.gateline'), { recursive: true })
    await writeFile(
      join(lockRepo, '.gateline', 'framework-lock.json'),
      JSON.stringify({ source: { repo: null, ref: '0123456789abcdef0123456789abcdef01234567', version: 'unreleased' }, layout: 'prefixed', prefix: '.gateline' }),
    )
    git(lockRepo, 'init', '-q', '-b', 'main')
    git(lockRepo, 'add', '-A')
    git(lockRepo, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
    const empty = join(box.cwd, '..', 'empty')
    await mkdir(empty)
    git(empty, 'init', '-q', '-b', 'main')
    await writeFile(box.configPath, `repositories:\n  - path: ${lockRepo}\n    mode: dispatch\n  - path: ${empty}\n    mode: view\n`)
    const r = await cli(box.xdg, box.cwd, ['repo', 'list'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(
      ['ID            ORIGIN  NAME    MODE      FRAMEWORK', 'local/locked  none    locked  dispatch  0123456789', 'local/empty   none    empty   view      refused', ''].join('\n'),
    )
    expect(r.stderr).toBe(
      `warning: ${await realpath(empty)} does not carry the framework: its default branch (main) has no commits. ` +
        'Integrate it with `gateline init <path> --provenance <redistribute|private>`, merge that change to main, and add it again\n',
    )
  })

  it('refuses at startup a config entry with no mode, saying what to add', async () => {
    await writeFile(box.configPath, `sources:\n  - name: demo\n    path: ${demo.dir}\n`)
    const r = await cli(box.xdg, box.cwd, ['status'])
    expect(r.code).toBe(1)
    expect(r.stderr).toBe(
      `config at ${box.configPath}: sources[0] (${demo.dir}) states no mode. Every entry needs one: add ` +
        '`mode: view` (read only), `mode: decide` (also record decisions) or `mode: dispatch` (also run an engine under `up`)\n',
    )
  })
})

// Every write verb, with arguments that would succeed in a decide repository.
// The list is this test's decision; the enumeration below holds `--help` to it.
const WRITE_VERBS: Record<string, string[]> = {
  approve: ['approve', 'g0-pending', 'G0', '--burden', 'confirmation'],
  decline: ['decline', 'g1-pending', 'G1', '--reason', 'the plan skips R2'],
  'resolve-escalation': ['resolve-escalation', 'escalated', '0', '--note', 'proceed'],
  pause: ['pause', 'g2-pending'],
  resume: ['resume', 'paused-budget', '--cost-limit', '20'],
  close: ['close', 'g3-pending', '--as', 'obsolete', '--reason', 'superseded by a later run'],
  reopen: ['reopen', 'closed-delivered'],
  new: ['new', '--slug', 'csv-export', '--title', 'CSV export', '--brief-file', 'BRIEF'],
  arm: ['arm', 'staged'],
  sync: ['sync', '--live'],
}
const READ_VERBS = ['status', 'inbox', 'show']
// Commands that record no decision in a listed repository: they serve,
// render or integrate a tree named on their command line, edit the
// operator's config file, or update the code checkout.
const OTHER_COMMANDS = ['up', 'ui', 'render', 'init', 'validate', 'fork', 'self-update', 'repo', 'help']

describe('modes in the CLI (§7.3)', () => {
  let box: Awaited<ReturnType<typeof sandbox>>
  let watched: FixtureRepo
  let decided: FixtureRepo
  let briefPath: string

  beforeAll(async () => {
    box = await sandbox()
    watched = fixture('watched')
    decided = fixture('decided')
    briefPath = join(box.cwd, 'brief.md')
    await writeFile(briefPath, '# Intent Brief: CSV export\n\n## Problem\nx\n\n## Motivation\nx\n\n## Constraints\nx\n\n## Out of scope\nx\n')
    await mkdir(dirname(box.configPath), { recursive: true })
    await writeFile(box.configPath, `repositories:\n  - path: ${watched.dir}\n    mode: view\n  - path: ${decided.dir}\n    mode: decide\n`)
  })
  afterAll(() => box.drop())

  const REFUSAL =
    'refused (view-mode): watched (local/watched) is in view mode: it is read here and nothing is written to it. ' +
    'To record decisions in it, set `mode: decide` on its entry in the config file\n'

  it('refuses every write verb in a view repository, and nothing moves', async () => {
    const refs = () => git(watched.dir, 'for-each-ref', '--format=%(refname) %(objectname)')
    const before = refs()
    for (const [verb, args] of Object.entries(WRITE_VERBS)) {
      const r = await cli(box.xdg, box.cwd, [...args.map((a) => (a === 'BRIEF' ? briefPath : a)), '--repository', 'watched'])
      expect([verb, r.code, r.stderr]).toEqual([verb, 1, REFUSAL])
    }
    expect(refs()).toBe(before)
  })

  it('records a decision in a decide repository', async () => {
    const r = await cli(box.xdg, box.cwd, [...WRITE_VERBS.approve!, '--repository', 'decided'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('G0 approved by Fixture Operator')
  })

  it('prints no command for a view repository in the inbox, and says why', async () => {
    const r = await cli(box.xdg, box.cwd, ['inbox'])
    const lines = r.stdout.split('\n')
    const at = lines.findIndex((l) => l.includes('watched/staged '))
    const end = lines.findIndex((l, i) => i > at && /^\S/.test(l))
    expect(lines.slice(at + 1, end)).toEqual([
      '                 staged    by Fixture Operator, profile standard, cost_limit_usd $18.50',
      '                 mode      view: this deployment records no decisions in this repository (`gateline repo list`)',
    ])
  })

  it("lists every command in --help under a decision about its mode", async () => {
    const help = (await cli(box.xdg, box.cwd, ['--help'])).stdout
    const commands = help
      .slice(help.indexOf('Commands:'))
      .split('\n')
      .slice(1)
      .map((l) => /^ {2}(\S+)/.exec(l)?.[1])
      .filter((c): c is string => !!c)
      .sort()
    expect(commands).toEqual([...Object.keys(WRITE_VERBS), ...READ_VERBS, ...OTHER_COMMANDS].sort())
  })
})

describe('next steps name the repository when the set has several (#497)', () => {
  let box: Awaited<ReturnType<typeof sandbox>>
  let demo: FixtureRepo
  let small: FixtureRepo

  beforeAll(async () => {
    box = await sandbox()
    demo = fixture('demo')
    small = fixture('demo-small')
  })
  afterAll(() => box.drop())

  const entryOf = (stdout: string, label: string) => {
    const lines = stdout.split('\n')
    const at = lines.findIndex((l) => l.includes(`${label} `))
    const end = lines.findIndex((l, i) => i > at && /^\S/.test(l))
    return lines.slice(at, end === -1 ? undefined : end)
  }

  it('stays bare with one repository', async () => {
    await mkdir(dirname(box.configPath), { recursive: true })
    await writeFile(box.configPath, `repositories:\n  - path: ${demo.dir}\n    mode: decide\n`)
    const { stdout } = await cli(box.xdg, box.cwd, ['inbox'])
    expect(entryOf(stdout, 'demo/staged')[2]).toBe('                 next      gateline arm staged — dispatch begins and the budget starts metering')
    expect(entryOf(stdout, 'demo/escalated')).toContain('                 resolve   gateline resolve-escalation escalated 0 --note <text>')
  })

  it('carries --repository <display name> with several, and the printed command runs as printed', async () => {
    await writeFile(box.configPath, `repositories:\n  - path: ${demo.dir}\n    mode: decide\n  - path: ${small.dir}\n    mode: decide\n`)
    const { stdout } = await cli(box.xdg, box.cwd, ['inbox'])
    expect(entryOf(stdout, 'demo/staged')[2]).toBe(
      '                 next      gateline arm staged --repository demo — dispatch begins and the budget starts metering',
    )
    expect(entryOf(stdout, 'demo-small/staged')[2]).toBe(
      '                 next      gateline arm staged --repository demo-small — dispatch begins and the budget starts metering',
    )
    expect(entryOf(stdout, 'demo-small/escalated')).toContain(
      '                 resolve   gateline resolve-escalation escalated 0 --repository demo-small --note <text>',
    )
    expect(entryOf(stdout, 'demo/paused-budget')).toContain(
      '                 next      gateline resume paused-budget --repository demo --cost-limit <usd> (a higher limit; resuming without one re-pauses), or gateline close paused-budget --repository demo --as <disposition> --reason <text>',
    )

    // The bare form is ambiguous now, and says what to pass.
    const bare = await cli(box.xdg, box.cwd, ['arm', 'staged'])
    expect(bare.code).toBe(1)
    expect(bare.stderr).toBe(
      'run "staged" exists in several repositories (demo: local/demo, demo-small: local/demo-small) — pass --repository, as in: --repository demo\n',
    )

    // Run the step exactly as printed.
    const printed = /next {6}(gateline arm staged --repository demo-small) —/.exec(entryOf(stdout, 'demo-small/staged')[2]!)![1]!
    const r = await cli(box.xdg, box.cwd, printed.split(' ').slice(1))
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('armed')
    expect(git(small.dir, 'show', 'run/staged:runs/staged/state.yaml')).toMatch(/^phase: spec /m)
    expect(git(demo.dir, 'show', 'run/staged:runs/staged/state.yaml')).toMatch(/^phase: paused /m)
  })

  it('quotes a display name the shell would split', async () => {
    // A display name may hold a space only where it is not also the id, so
    // this repository has an origin: its id is github.com/acme/demo.
    const quoted = fixture('quoted')
    git(quoted.dir, 'remote', 'add', 'origin', 'git@github.com:acme/demo.git')
    await writeFile(
      box.configPath,
      `repositories:\n  - path: ${quoted.dir}\n    name: the demo\n    mode: decide\n  - path: ${small.dir}\n    mode: decide\n`,
    )
    const { stdout } = await cli(box.xdg, box.cwd, ['inbox'])
    expect(entryOf(stdout, 'the demo/escalated')).toContain(
      "                 resolve   gateline resolve-escalation escalated 0 --repository 'the demo' --note <text>",
    )
  })
})

describe('gateline init offers to register the host, and never does', () => {
  it('prints the command, adding --gateline-prefix only for a custom prefix', async () => {
    const box = await sandbox()
    try {
      const host = join(box.cwd, 'host')
      await mkdir(join(host, 'src'), { recursive: true })
      git(host, 'init', '-q', '-b', 'main')
      expect(await registrationOffer(join(host, 'src'), '.gateline')).toBe(
        [
          '  4. once that PR is merged to the default branch, you may register the repository',
          '     with this machine (nothing is registered for you; view reads, decide also',
          '     records decisions, dispatch also lets `up` run an engine):',
          `       gateline repo add ${host} --mode decide`,
        ].join('\n'),
      )
      expect((await registrationOffer(host, '.framework')).split('\n').at(-1)).toBe(`       gateline repo add ${host} --mode decide --gateline-prefix .framework`)
    } finally {
      await box.drop()
    }
  })

  it('ends a real init with the offer, writes no config, and the printed command runs once the change is merged', async () => {
    const box = await sandbox()
    try {
      const host = join(box.cwd, 'host')
      await mkdir(host, { recursive: true })
      git(host, 'init', '-q', '-b', 'main')
      await writeFile(join(host, 'README.md'), '# host\n')
      git(host, 'add', '-A')
      git(host, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'seed')
      const r = await cli(box.xdg, box.cwd, ['init', host, '--provenance', 'private', '--adapters', 'claude-code'])
      expect(r.code).toBe(0)
      const offer = r.stdout.trimEnd().split('\n').slice(-4)
      expect(offer).toEqual([
        '  4. once that PR is merged to the default branch, you may register the repository',
        '     with this machine (nothing is registered for you; view reads, decide also',
        '     records decisions, dispatch also lets `up` run an engine):',
        `       gateline repo add ${host} --mode decide`,
      ])
      await expect(readFile(box.configPath, 'utf8')).rejects.toThrow()

      // Before the merge the check refuses; after it, the printed command runs.
      const command = offer[3]!.trim().split(' ').slice(1)
      expect((await cli(box.xdg, box.cwd, command)).code).toBe(1)
      git(host, 'add', '-A')
      git(host, '-c', 'user.name=Seed', '-c', 'user.email=seed@example.test', 'commit', '-q', '-m', 'gateline init')
      const added = await cli(box.xdg, box.cwd, command)
      expect(added).toEqual({
        code: 0,
        stdout: `added local/host (host) as decide, lock at .gateline/framework-lock.json, to ${box.configPath}\n`,
        stderr: '',
      })
    } finally {
      await box.drop()
    }
  })
})
