// The repositories a page left out because they could not be read (#499;
// docs/MULTI-REPO.md §10). The server returns them beside the rows, each with
// its id, display name and the error on one line; this is the notice at the
// top of Inbox and Portfolio that names them.
//
// The caution field, as the scope's unknown-repository notice uses it:
// something to look at, with nothing wrong in any run's record. One notice
// for however many repositories. Each is named by its display name, then its
// full id as an Address (docs/SEAM.md §2: an address follows a name), then
// the error in the code face under a label saying it is the machine's words
// (SEAM.md §5, Diagnostic) — the server's read of the repository, which is
// usually git talking.

import type { UnreadableRepository } from '../api.ts'
import type { Scope } from '../scope.ts'
import { sameRepository } from '../scope.ts'
import { Address, Diagnostic } from './vocabulary.tsx'

/**
 * The notice, or nothing when every repository in view was read. Under a
 * one-repository scope it names that repository only, if it is one of them:
 * the page is about that repository, and the rail's scope control still marks
 * every repository that could not be read.
 */
export function UnreadableRepositoriesNotice({
  unreadable,
  scope,
  rows,
  left = 'shown here',
}: {
  unreadable: readonly UnreadableRepository[] | undefined
  scope: Scope
  /** What the page would have shown from it: "decisions", "runs", "figures". */
  rows: string
  /** What the page did not do with them: "shown here" on a list, "counted" on Metrics. */
  left?: 'shown here' | 'counted'
}) {
  const shown = (unreadable ?? []).filter((u) => scope.kind !== 'one' || sameRepository(u.source, scope.repository.id))
  if (shown.length === 0) return null
  const one = shown.length === 1
  return (
    <div className="mt-3 border border-warn-line bg-warn-bg px-2.5 py-2 font-ui text-[12.5px] leading-[1.5] break-words text-warn" role="status" data-unreadable-notice>
      <p>
        {one
          ? `One repository could not be read, so its ${rows} are not ${left}.`
          : `${shown.length} repositories could not be read, so their ${rows} are not ${left}.`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {shown.map((u) => (
          <li key={u.source} data-unreadable-repository={u.source}>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-[12.5px] font-semibold break-all text-ink" data-unreadable-name>
                {u.sourceName || u.source}
              </span>
              <Address className="break-all">{u.source}</Address>
            </span>
            <span className="mt-0.5 block [overflow-wrap:anywhere]">
              <Diagnostic producer="Reading it failed with" inline>
                {u.error}
              </Diagnostic>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
