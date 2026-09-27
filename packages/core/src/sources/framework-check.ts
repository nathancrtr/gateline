// Whether a repository carries the framework (docs/MULTI-REPO.md §7.2): the
// second of the two keys a repository needs to join the set, the first being
// the operator's config listing it (D6).
//
// Read through git at the default-branch tip, never the working tree, the way
// `resolveFrameworkRoots` reads the lock: an `init` that has not been merged
// does not count, and a checked-out branch cannot make a repository pass.
import { DEFAULT_FRAMEWORK_PREFIX } from './framework-roots.ts'
import type { Git } from './git.ts'

const LOCK_FILE = 'framework-lock.json'
const ROOT_TREES = ['roles', 'contracts', 'registry'] as const

export type FrameworkCheck =
  | {
      ok: true
      /** A framework lock at `<prefix>/framework-lock.json` (case 1). */
      carries: 'lock'
      prefix: string
      /** The framework ref the lock pins (`source.ref`), or null when the lock does not say. */
      pinnedRef: string | null
      defaultBranch: string
    }
  | {
      ok: true
      /** No lock, and `roles/`, `contracts/` and `registry/` at the root (case 2, "no lock"). */
      carries: 'root'
      defaultBranch: string
    }
  | {
      ok: false
      defaultBranch: string
      /** Directories on the default branch that hold a `framework-lock.json` other than the probed one. */
      locksElsewhere: string[]
      /** What is wrong and what to do, naming `gateline init` and, when a lock is elsewhere, `gateline_prefix`. */
      message: string
    }

/** The ref a lock pins, read leniently: a lock that cannot be parsed still exists. */
function pinnedRefOf(raw: string): string | null {
  try {
    const lock = JSON.parse(raw) as { source?: { ref?: unknown } }
    return typeof lock.source?.ref === 'string' ? lock.source.ref : null
  } catch {
    return null
  }
}

/** Top-level trees at `rev`, by name. */
async function rootTrees(git: Git, rev: string): Promise<Set<string>> {
  const out = await git.run(['ls-tree', '-z', '--format=%(objecttype) %(path)', rev])
  const trees = new Set<string>()
  for (const entry of out.split('\0')) if (entry.startsWith('tree ')) trees.add(entry.slice('tree '.length))
  return trees
}

/** Every directory at `rev` holding a `framework-lock.json`, root first ('' for the root itself). */
async function lockDirs(git: Git, rev: string): Promise<string[]> {
  const out = await git.run(['ls-tree', '-r', '-z', '--name-only', rev])
  return out
    .split('\0')
    .filter((p) => p === LOCK_FILE || p.endsWith(`/${LOCK_FILE}`))
    .map((p) => p.slice(0, -LOCK_FILE.length).replace(/\/$/, ''))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
}

/**
 * Check that the repository `git` reads carries the framework (§7.2). It
 * passes when a lock exists at `<prefix>/framework-lock.json` on the default
 * branch (`prefix` is the entry's `gateline_prefix`, `.gateline` by default),
 * or, with no lock there, when `roles/`, `contracts/` and `registry/` are all
 * directories at the default branch's root. Anything else is refused.
 *
 * `label` names the repository in the refusal, usually its path.
 */
export async function checkFramework(git: Git, opts: { prefix?: string; label?: string } = {}): Promise<FrameworkCheck> {
  const prefix = opts.prefix ?? DEFAULT_FRAMEWORK_PREFIX
  const label = opts.label ?? git.dir
  const defaultBranch = await git.defaultBranch()
  const init = '`gateline init <path> --provenance <redistribute|private>`'

  if ((await git.revParse(defaultBranch)) === null) {
    return {
      ok: false,
      defaultBranch,
      locksElsewhere: [],
      message:
        `${label} does not carry the framework: its default branch (${defaultBranch}) has no commits. ` +
        `Integrate it with ${init}, merge that change to ${defaultBranch}, and add it again`,
    }
  }

  const raw = await git.show(defaultBranch, `${prefix}/${LOCK_FILE}`)
  if (raw !== null) return { ok: true, carries: 'lock', prefix, pinnedRef: pinnedRefOf(raw), defaultBranch }

  const trees = await rootTrees(git, defaultBranch)
  if (ROOT_TREES.every((t) => trees.has(t))) return { ok: true, carries: 'root', defaultBranch }

  const locksElsewhere = (await lockDirs(git, defaultBranch)).filter((d) => d !== prefix)
  const found = locksElsewhere.find((d) => d !== '')
  const message = found
    ? `${label}: no framework lock at ${prefix}/${LOCK_FILE} on its default branch (${defaultBranch}), ` +
      `but there is one at ${found}/${LOCK_FILE}. If it was integrated with \`gateline init --prefix ${found}\`, ` +
      `set \`gateline_prefix: ${found}\` on its entry (\`gateline repo add <path> --mode <mode> --gateline-prefix ${found}\`). ` +
      `Otherwise integrate it with ${init}`
    : `${label} does not carry the framework: its default branch (${defaultBranch}) has no ${prefix}/${LOCK_FILE}, ` +
      `and no roles/, contracts/ and registry/ at its root. Integrate it with ${init} and merge that change to ` +
      `${defaultBranch}; the check reads ${defaultBranch} as committed, so an unmerged integration does not count yet`
  return { ok: false, defaultBranch, locksElsewhere, message }
}
