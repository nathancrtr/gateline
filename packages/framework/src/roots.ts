// Where a repository's core-layer trees (roles/, contracts/, adapters/,
// overlays/) actually live. Most repositories keep them at their own root; a
// repository scaffolded with the prefixed layout keeps them under a metadata
// prefix instead. The lockfile is written either way, so probing it is how a
// consumer tells the two apart without being told which one it is.
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const DEFAULT_FRAMEWORK_PREFIX = '.gateline'

/**
 * The core-layer root recorded by a lock, relative to the repository root:
 * the empty string for the root layout, the prefix for the prefixed one.
 * Pure, so the git-revision reader in `@gateline/core` can share it.
 */
export function coreRootFromLock(raw: string | null, prefix: string): string {
  if (raw === null) return ''
  let lock: { layout?: unknown; prefix?: unknown }
  try {
    lock = JSON.parse(raw) as { layout?: unknown; prefix?: unknown }
  } catch {
    return ''
  }
  if (lock.layout !== 'prefixed') return ''
  return typeof lock.prefix === 'string' ? lock.prefix : prefix
}

/**
 * Absolute core-layer root for a checkout on disk. An unreadable or absent
 * lock means the root layout, which is what this framework's own repository
 * and any pre-tool host look like.
 */
export async function resolveCoreRoot(repoDir: string, prefixHint?: string): Promise<string> {
  const prefix = prefixHint ?? DEFAULT_FRAMEWORK_PREFIX
  let raw: string | null = null
  try {
    raw = await readFile(join(repoDir, prefix, 'framework-lock.json'), 'utf8')
  } catch {
    raw = null
  }
  // resolve, not join: the root layout appends nothing, and `join(dir, '')`
  // would hand back a trailing slash that every caller then has to think about.
  return resolve(repoDir, coreRootFromLock(raw, prefix))
}
