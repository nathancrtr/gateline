// Where a source's runs/ and contracts/ trees actually live. Most repos keep
// the framework at their own root; a repo integrated via `integrate.py init`
// (the tool's own default: --layout prefixed --prefix .agentic) keeps them
// under a metadata prefix instead. Probing framework-lock.json (which
// integrate.py always writes, regardless of layout) is how a source tells
// the two apart without being told which one it is.
import type { Git } from './git.ts'

export interface FrameworkRoots {
  runs: string
  contracts: string
}

export const DEFAULT_FRAMEWORK_PREFIX = '.agentic'

const ROOT_LAYOUT: FrameworkRoots = { runs: 'runs', contracts: 'contracts' }

/**
 * Resolve `runs`/`contracts` roots for `rev`. `prefixHint` overrides the
 * default probe location (`.agentic`) for a host integrated with a custom
 * `--prefix`; absent a recognized lock at that location, the repo is assumed
 * to carry the framework at its own root.
 */
export async function resolveFrameworkRoots(git: Git, rev: string, prefixHint?: string): Promise<FrameworkRoots> {
  const prefix = prefixHint ?? DEFAULT_FRAMEWORK_PREFIX
  const raw = await git.show(rev, `${prefix}/framework-lock.json`)
  if (raw === null) return ROOT_LAYOUT

  let lock: { layout?: unknown; prefix?: unknown }
  try {
    lock = JSON.parse(raw)
  } catch {
    return ROOT_LAYOUT
  }
  if (lock.layout !== 'prefixed') return ROOT_LAYOUT

  const resolvedPrefix = typeof lock.prefix === 'string' ? lock.prefix : prefix
  return { runs: `${resolvedPrefix}/runs`, contracts: `${resolvedPrefix}/contracts` }
}
