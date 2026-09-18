// Dependency seeding for task worktrees (#229). Per-task worktrees buy
// *source* isolation (ORCHESTRATOR.md §5.3): two implementers must never see
// each other's half-written code. They are not a reason for each implementer
// to own a private install of third-party packages — those are identical
// across worktrees by construction, pinned by the one lockfile all of them
// share. Paying for the second to get the first cost a full cold `npm
// install` on every dispatch and every review round, which is what burned
// the role timeout in #229.
//
// So a fresh task worktree is seeded from a warm tree instead: cloned
// copy-on-write where the filesystem offers it (`cp -Rc` on APFS — 134 MB in
// ~1.1s), copied outright where it does not, skipped when neither is cheap.
// Every seed is a private tree either way, so no dispatch can observe or
// mutate another's dependencies.
import { execFile } from 'node:child_process'
import { access, lstat, readdir, readlink, rm, stat, symlink } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const NODE_MODULES = 'node_modules'

/**
 * A tree a host without copy-on-write will still copy outright. Above it the
 * seed is skipped and the implementer installs: a plain copy of a very large
 * store is no longer obviously cheaper than the install it replaces.
 */
export const DEFAULT_MAX_PLAIN_COPY_BYTES = 512 * 1024 * 1024

export interface SeedOptions {
  /** Where the seed narrates itself — the engine's dispatch log. */
  log?: (line: string) => void
  /** Override `DEFAULT_MAX_PLAIN_COPY_BYTES`; 0 refuses every plain copy. */
  maxPlainCopyBytes?: number
  /**
   * How a command is run. Injected only by tests, to simulate a host whose
   * `cp` does not take the clone flag.
   */
  run?: (file: string, args: string[]) => Promise<void>
}

export interface SeedResult {
  /** Package directories seeded, relative to the worktree root (`''` is the root itself). */
  seeded: string[]
  /** How the last seed got there; `none` when nothing was seeded. */
  mode: 'clone' | 'copy' | 'none'
}

const runCommand = async (file: string, args: string[]): Promise<void> => {
  await exec(file, args, { maxBuffer: 16 * 1024 * 1024 })
}

const isDir = (path: string): Promise<boolean> =>
  stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false)

const exists = (path: string): Promise<boolean> =>
  access(path)
    .then(() => true)
    .catch(() => false)

/**
 * Directories under `root` that carry their own installed dependencies: a
 * `package.json` with a `node_modules` beside it. Deliberately generic — the
 * root and one level down, rather than this repository's `packages/` — so a
 * host repo with its own layout (`app/`, `web/`, or dependencies at the root)
 * is seeded by the same rule. Deeper nesting is not searched: a workspace
 * hoists to one of these two levels, and walking further would cost more than
 * the seed saves.
 */
export async function warmTrees(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates = ['', ...entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== NODE_MODULES).map((e) => e.name)]
  const warm: string[] = []
  for (const rel of candidates) {
    const dir = join(root, rel)
    if ((await exists(join(dir, 'package.json'))) && (await isDir(join(dir, NODE_MODULES)))) warm.push(rel)
  }
  return warm
}

/** Bytes on disk under `path`, or null when the host would not say. */
async function treeSize(path: string): Promise<number | null> {
  const out = await exec('du', ['-sk', path], { maxBuffer: 1024 * 1024 })
    .then((r) => r.stdout)
    .catch(() => null)
  const kb = out ? Number.parseInt(out.trim().split(/\s+/)[0] ?? '', 10) : Number.NaN
  return Number.isFinite(kb) ? kb * 1024 : null
}

type CopyOutcome = { how: 'clone' | 'copy'; why: null } | { how: null; why: string }

/**
 * Clone `from` to `to` if the filesystem can, copy it if it cannot, refuse if
 * copying it outright would be too expensive. The clone flag is probed by
 * running it, never by sniffing the platform: `cp -Rc` also fails across
 * volumes on a filesystem that supports it in general, and the answer that
 * matters is about this pair of paths.
 */
async function copyTree(from: string, to: string, opts: SeedOptions): Promise<CopyOutcome> {
  const run = opts.run ?? runCommand
  try {
    await run('cp', ['-Rc', from, to])
    return { how: 'clone', why: null }
  } catch {
    await rm(to, { recursive: true, force: true }).catch(() => {})
  }
  const limit = opts.maxPlainCopyBytes ?? DEFAULT_MAX_PLAIN_COPY_BYTES
  const size = await treeSize(from)
  if (size !== null && size > limit) return { how: null, why: `it is ${Math.round(size / 1024 / 1024)} MB and this host cannot clone` }
  try {
    await run('cp', ['-R', from, to])
    return { how: 'copy', why: null }
  } catch (e) {
    await rm(to, { recursive: true, force: true }).catch(() => {})
    return { how: null, why: `the copy failed: ${(e as Error).message}` }
  }
}

/**
 * Re-create, in the copy, every symlink the original holds. `cp -Rc`
 * dereferences symlinks: the workspace links under `node_modules/@scope/`
 * become stale copies of sibling packages, and the `node_modules/.bin`
 * entries become scripts whose relative requires resolve from the wrong
 * directory. Both are fixed by the same pass, so it runs after every copy
 * rather than only after a clone — where the copy preserved the links
 * already, re-creating them changes nothing.
 *
 * Link targets are carried over verbatim: the two trees have the same shape,
 * so a relative link means the same thing in both.
 */
export async function relinkSymlinks(from: string, to: string): Promise<number> {
  const out = await exec('find', [from, '-type', 'l', '-print0'], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
    .then((r) => r.stdout)
    .catch(() => '')
  let relinked = 0
  for (const link of out.split('\0').filter(Boolean)) {
    const target = await readlink(link).catch(() => null)
    if (target === null) continue
    const dest = join(to, relative(from, link))
    if (!(await exists(dirname(dest)))) continue
    const already = await lstat(dest)
      .then((s) => s.isSymbolicLink())
      .catch(() => false)
    if (already && (await readlink(dest).catch(() => null)) === target) continue
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    if (await symlink(target, dest).then(() => true).catch(() => false)) relinked++
  }
  return relinked
}

/**
 * Seed `target`'s package directories from the first of `sources` that has a
 * warm one. Sources are tried in order — the run checkout before the
 * repository — because the run checkout's install matches the run branch's
 * lockfile, and the repository's matches the default branch's.
 *
 * Nothing warm anywhere is not a failure: the seed is skipped, the reason is
 * logged, and the implementer installs as it did before.
 */
export async function seedDependencies(target: string, sources: string[], opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? (() => {})
  for (const source of sources) {
    if (source === target) continue
    const trees = await warmTrees(source)
    if (trees.length === 0) continue
    const seeded: string[] = []
    let mode: SeedResult['mode'] = 'none'
    for (const rel of trees) {
      const from = join(source, rel, NODE_MODULES)
      const to = join(target, rel, NODE_MODULES)
      const label = join(rel, NODE_MODULES)
      // The worktree does not have this package directory at all (the warm
      // tree is newer than the run branch, or older) — nothing to seed into.
      if (!(await isDir(join(target, rel)))) continue
      if (await exists(to)) continue
      const started = Date.now()
      const outcome = await copyTree(from, to, opts)
      if (outcome.how === null) {
        log(`not seeding ${label} — ${outcome.why}; the implementer installs`)
        continue
      }
      const relinked = await relinkSymlinks(from, to)
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      log(`seeded ${label} from ${source} by ${outcome.how} in ${secs}s (${relinked} symlink${relinked === 1 ? '' : 's'} re-created)`)
      seeded.push(rel)
      mode = outcome.how
    }
    return { seeded, mode }
  }
  log(`no warm ${NODE_MODULES} to seed from (looked in ${sources.join(', ')}) — the implementer installs`)
  return { seeded: [], mode: 'none' }
}
