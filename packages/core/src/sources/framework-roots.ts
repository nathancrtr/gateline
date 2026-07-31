// Where a source's core-layer trees actually live. Most repos keep the
// framework at their own root; a repo integrated via `integrate.py init`
// (the tool's own default: --layout prefixed --prefix .gateline) keeps them
// under a metadata prefix instead. Probing framework-lock.json (which
// integrate.py always writes, regardless of layout) is how a consumer tells
// the two apart without being told which one it is.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
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

export const DEFAULT_FRAMEWORK_PREFIX = '.gateline'

const ROOT_LAYOUT: FrameworkRoots = { runs: 'runs', contracts: 'contracts', registry: 'registry', adapters: 'adapters', roles: 'roles' }

function rootsForPrefix(prefix: string): FrameworkRoots {
  return {
    runs: `${prefix}/runs`,
    contracts: `${prefix}/contracts`,
    registry: `${prefix}/registry`,
    adapters: `${prefix}/adapters`,
    roles: `${prefix}/roles`,
  }
}

function rootsFromLock(raw: string | null, prefix: string): FrameworkRoots {
  if (raw === null) return ROOT_LAYOUT
  let lock: { layout?: unknown; prefix?: unknown }
  try {
    lock = JSON.parse(raw)
  } catch {
    return ROOT_LAYOUT
  }
  if (lock.layout !== 'prefixed') return ROOT_LAYOUT
  const resolvedPrefix = typeof lock.prefix === 'string' ? lock.prefix : prefix
  return rootsForPrefix(resolvedPrefix)
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
