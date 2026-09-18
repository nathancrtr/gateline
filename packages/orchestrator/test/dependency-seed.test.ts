// Seeding a task worktree's dependencies from a warm tree (#229). Real
// filesystems and a real `cp` throughout: the whole subject is what the host's
// copy actually does to a `node_modules` — in particular that it dereferences
// the workspace symlinks — so a stubbed copy would test the assumption rather
// than the behavior.
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { seedDependencies, warmTrees } from '../src/deps.ts'
import { ensureTaskCheckout } from '../src/workspace.ts'

const exec = promisify(execFile)
const dirs: string[] = []

function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * A repo with `run/toy`, a `packages/` workspace, and — unless `warm` is
 * false — an installed `packages/node_modules` carrying a third-party package,
 * a workspace symlink, and a `.bin` entry. `node_modules` is untracked, as a
 * real one is.
 */
function makeRepo(warm = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateline-seed-'))
  dirs.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.name', 'Fixture Operator'])
  git(dir, ['config', 'user.email', 'operator@example.test'])
  mkdirSync(join(dir, 'packages/core'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"root"}\n')
  writeFileSync(join(dir, 'packages/package.json'), '{"name":"packages","workspaces":["core"]}\n')
  writeFileSync(join(dir, 'packages/core/package.json'), '{"name":"@gateline/core"}\n')
  writeFileSync(join(dir, 'packages/core/index.ts'), 'export const core = 1\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', 'root'])
  git(dir, ['branch', 'run/toy'])
  if (warm) installInto(dir)
  return dir
}

/** What `npm install` leaves behind, in miniature. */
function installInto(root: string): void {
  const nm = join(root, 'packages/node_modules')
  mkdirSync(join(nm, 'left-pad'), { recursive: true })
  writeFileSync(join(nm, 'left-pad/index.js'), 'module.exports = 1\n')
  mkdirSync(join(nm, '@gateline'), { recursive: true })
  symlinkSync('../../core', join(nm, '@gateline/core'))
  mkdirSync(join(nm, '.bin'), { recursive: true })
  symlinkSync('../left-pad/index.js', join(nm, '.bin/left-pad'))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // Not every fixture is a repo — the bare seed targets are plain directories.
    try {
      git(dir, ['worktree', 'prune'])
    } catch {
      /* not a repo */
    }
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('seeding a task worktree from a warm dependency store (#229)', () => {
  it('seeds a fresh worktree from the repository, so nothing has to be installed', async () => {
    const dir = makeRepo()
    const log: string[] = []
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy', { log: (l) => log.push(l) })

    expect(readFileSync(join(checkout.path, 'packages/node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(log.join('\n')).toContain('seeded packages/node_modules')
  })

  it('re-creates the workspace symlinks the copy dereferenced', async () => {
    const dir = makeRepo()
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy')

    // The wrinkle #229 names: `cp -Rc` follows these, so an unrepaired seed
    // hands the implementer a stale snapshot of its own workspace packages
    // instead of a link to the ones it is editing.
    const link = join(checkout.path, 'packages/node_modules/@gateline/core')
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readlinkSync(link)).toBe('../../core')
    const bin = join(checkout.path, 'packages/node_modules/.bin/left-pad')
    expect(lstatSync(bin).isSymbolicLink()).toBe(true)
    expect(readlinkSync(bin)).toBe('../left-pad/index.js')
  })

  it('seeds a private tree, so one dispatch cannot observe or mutate another', async () => {
    const dir = makeRepo()
    const one = await ensureTaskCheckout(dir, 'run/toy', '01-toy')
    const two = await ensureTaskCheckout(dir, 'run/toy', '02-toy')

    writeFileSync(join(one.path, 'packages/node_modules/left-pad/index.js'), 'module.exports = 2\n')

    expect(readFileSync(join(two.path, 'packages/node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(readFileSync(join(dir, 'packages/node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 1\n')
  })

  it('skips the seed and says so when nothing warm exists', async () => {
    const dir = makeRepo(false)
    const log: string[] = []
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy', { log: (l) => log.push(l) })

    expect(existsSync(join(checkout.path, 'packages/node_modules'))).toBe(false)
    expect(log.join('\n')).toContain('no warm node_modules to seed from')
  })

  it('copies outright when the host does not take the clone flag', async () => {
    const dir = makeRepo()
    const log: string[] = []
    // A host whose `cp` has no `-c` — GNU cp, and macOS across volumes.
    const run = async (file: string, args: string[]) => {
      if (args.includes('-Rc')) throw new Error('cp: illegal option -- c')
      await exec(file, args)
    }
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy', { log: (l) => log.push(l), run })

    expect(readFileSync(join(checkout.path, 'packages/node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 1\n')
    expect(readlinkSync(join(checkout.path, 'packages/node_modules/@gateline/core'))).toBe('../../core')
    expect(log.join('\n')).toContain('by copy')
  })

  it('leaves the install to the implementer when a host that cannot clone would have to copy too much', async () => {
    const dir = makeRepo()
    const log: string[] = []
    const run = async (file: string, args: string[]) => {
      if (args.includes('-Rc')) throw new Error('cp: illegal option -- c')
      await exec(file, args)
    }
    const checkout = await ensureTaskCheckout(dir, 'run/toy', '01-toy', { log: (l) => log.push(l), run, maxPlainCopyBytes: 0 })

    expect(existsSync(join(checkout.path, 'packages/node_modules'))).toBe(false)
    expect(log.join('\n')).toContain('not seeding packages/node_modules')
    expect(log.join('\n')).toContain('this host cannot clone')
  })

  it('finds warm trees by package.json + node_modules, not by a hardcoded directory name', async () => {
    const dir = makeRepo(false)
    mkdirSync(join(dir, 'node_modules/left-pad'), { recursive: true })
    writeFileSync(join(dir, 'node_modules/left-pad/index.js'), 'module.exports = 3\n')

    // The root qualifies now; `packages/` has a package.json but no install,
    // and `packages/core` is a level too deep to be searched.
    expect(await warmTrees(dir)).toEqual([''])

    const target = mkdtempSync(join(tmpdir(), 'gateline-seed-target-'))
    dirs.push(target)
    const result = await seedDependencies(target, [dir])
    expect(result.seeded).toEqual([''])
    expect(readFileSync(join(target, 'node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 3\n')
  })

  it('leaves an existing node_modules alone rather than copying over it', async () => {
    const dir = makeRepo()
    const target = mkdtempSync(join(tmpdir(), 'gateline-seed-target-'))
    dirs.push(target)
    mkdirSync(join(target, 'packages/node_modules/left-pad'), { recursive: true })
    writeFileSync(join(target, 'packages/node_modules/left-pad/index.js'), 'module.exports = 9\n')

    const result = await seedDependencies(target, [dir])

    expect(result.seeded).toEqual([])
    expect(readFileSync(join(target, 'packages/node_modules/left-pad/index.js'), 'utf8')).toBe('module.exports = 9\n')
  })
})
