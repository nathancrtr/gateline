// Where a source's core-layer trees actually live. Most repos keep the
// framework at their own root; a repo integrated via `gateline init`
// (the tool's own default: --layout prefixed --prefix .gateline) keeps them
// under a metadata prefix instead. Probing framework-lock.json (which
// gateline init always writes, regardless of layout) is how a consumer tells
// the two apart without being told which one it is.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { coreRootFromLock, DEFAULT_FRAMEWORK_PREFIX as FRAMEWORK_PREFIX } from '@gateline/framework'
import type { Git } from './git.ts'

export interface FrameworkRoots {
  runs: string
  contracts: string
  /** Directory containing `models.yaml` (the orchestrator's registry read). */
  registry: string
  /** Directory containing `<adapter>/manifest.json` (the orchestrator's dispatch seam). */
  adapters: string
  /** Directory containing `<role>.md` specs (the orchestrator's capability read). */
  roles: string
}

// Re-exported so consumers of this module need not also import the package that
// writes the lock; the value is the tool's own default and lives there.
export const DEFAULT_FRAMEWORK_PREFIX = FRAMEWORK_PREFIX

/**
 * Reading the lock's layout is `gateline init`'s own question, so
 * `@gateline/framework` answers it — the package that writes the lock is the one
 * that knows how to read it, and a layout it starts recording cannot be one this
 * module silently misreads. What stays here is the mapping from that single core
 * root to the five trees this repository's consumers ask for by name.
 */
function rootsFromLock(raw: string | null, prefix: string): FrameworkRoots {
  const core = coreRootFromLock(raw, prefix)
  const under = (tree: string) => (core ? `${core}/${tree}` : tree)
  return {
    runs: under('runs'),
    contracts: under('contracts'),
    registry: under('registry'),
    adapters: under('adapters'),
    roles: under('roles'),
  }
}

/**
 * Resolve core-layer roots for `rev`, reading the lock through git (never the
 * working tree). `prefixHint` overrides the default probe location
 * (`.gateline`) for a host integrated with a custom `--prefix`; absent a
 * recognized lock at that location, the repo is assumed to carry the
 * framework at its own root.
 */
export async function resolveFrameworkRoots(git: Git, rev: string, prefixHint?: string): Promise<FrameworkRoots> {
  const prefix = prefixHint ?? DEFAULT_FRAMEWORK_PREFIX
  const raw = await git.show(rev, `${prefix}/framework-lock.json`)
  return rootsFromLock(raw, prefix)
}

/**
 * Same resolution, but from a live checkout on disk — for the orchestrator's
 * adapter manifests, which it shells out to as installed files rather than
 * reading through git history.
 */
export async function resolveFrameworkRootsFromDisk(repoDir: string, prefixHint?: string): Promise<FrameworkRoots> {
  const prefix = prefixHint ?? DEFAULT_FRAMEWORK_PREFIX
  let raw: string | null
  try {
    raw = await readFile(join(repoDir, prefix, 'framework-lock.json'), 'utf8')
  } catch {
    raw = null
  }
  return rootsFromLock(raw, prefix)
}

/**
 * A source's integration layout doesn't change within a process's lifetime;
 * this memoizes the one git round-trip (defaultBranch + lock probe) behind a
 * repeatable getter, shared by every consumer resolving paths against `git`.
 */
export function memoizedFrameworkRoots(git: Git, prefixHint?: string): () => Promise<FrameworkRoots> {
  let cached: Promise<FrameworkRoots> | null = null
  return () => {
    if (!cached) cached = git.defaultBranch().then((rev) => resolveFrameworkRoots(git, rev, prefixHint))
    return cached
  }
}
