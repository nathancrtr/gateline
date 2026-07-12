// Freshness: watch each repo's ref storage (refs/ + packed-refs) and emit a
// debounced change signal. Agents commit → refs move → clients revalidate.
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { Git } from '@agentic/core'

export type Unwatch = () => void

export async function watchRepoRefs(dir: string, onChange: () => void, debounceMs = 300): Promise<Unwatch> {
  const git = new Git(dir)
  // --git-common-dir: worktree-correct home of refs/ and packed-refs.
  const commonDir = (await git.run(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()

  let timer: NodeJS.Timeout | null = null
  const fire = () => {
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
