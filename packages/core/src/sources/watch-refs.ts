// Freshness for a local clone: watch where its refs are stored (refs/ and
// packed-refs) and say, debounced, that they are worth reading again. Agents
// commit, refs move, and the server asks which views that touched.
//
// Moved here from the server (#496) so the server reaches a repository's
// directory only through `RunSource.watchRefs` (docs/MULTI-REPO.md §5 rule 3).
import { type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'
import { Git } from './git.ts'

export type Unwatch = () => void

/**
 * `onChange` fires once the writes have settled; `onTouch` fires at once, on
 * every write. Neither means a ref moved — the git directory is also written
 * by an index refresh or a fetch that brought nothing (#461) — only that the
 * refs are worth reading again.
 */
export async function watchRepoRefs(
  dir: string,
  onChange: () => void,
  debounceMs = 300,
  onTouch: () => void = () => {},
): Promise<Unwatch> {
  const git = new Git(dir)
  // --git-common-dir: worktree-correct home of refs/ and packed-refs.
  const commonDir = (await git.run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()

  let timer: NodeJS.Timeout | null = null
  const fire = () => {
    onTouch()
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, debounceMs)
  }

  const watchers: FSWatcher[] = []
  const tryWatch = (path: string, recursive: boolean) => {
    try {
      watchers.push(watch(path, { recursive }, fire))
    } catch {
      /* path may not exist yet (no packed-refs, empty refs dir) — fine */
    }
  }
  tryWatch(join(commonDir, 'refs'), true)
  tryWatch(commonDir, false) // catches packed-refs rewrites and new files

  return () => {
    if (timer) clearTimeout(timer)
    for (const w of watchers) w.close()
  }
}
