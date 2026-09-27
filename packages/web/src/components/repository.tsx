// A run's repository, named (#497; docs/MULTI-REPO.md §6.2, §9.2).
//
// A run's full name is `<repository id>/<slug>` — `github.com/acme/billing/
// add-export`. Interfaces show the repository by its display name instead,
// the config `name` or else the id's last segment, which core puts on every
// view-model record beside the id (`sourceName`); web never derives it from
// the id. Decision D7: the name is text, and the repository precedes the slug
// wherever a run is named, with no colour and no per-repository mark, because
// colour in Gatehouse carries run state.
//
// The structure follows the surface. An inbox row is a sentence, so the
// repository stands inline before the slug (`RunName`). The Portfolio and the
// Metrics budget table are registers, and a register aligns: there the
// repository is a column of its own to the left of the run (`RepositoryName`
// in a cell), so slugs start at one x down the column.
//
// Which vocabulary kind each part is (docs/SEAM.md §5): the display name
// names a thing the reader meets on other rows, so it is a Name in the
// table's sense, set in the muted ink at regular weight as the run name's
// qualifier. It is not rendered through `Name`, which is ink (it would
// outrank the slug) and refuses a trailing `.ext`, which a config name such
// as `gateline.dev` may carry. The full id is an Address: it contains
// slashes, it locates the repository, and it is what an operator pastes. An
// address never stands alone, so it is never printed in place of the display
// name; it follows it, on hover. A copy gives what is on screen.

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../api.ts'

/** The run's full name, `<repository id>/<slug>` (§6.2): what a run name's tooltip shows. */
export const fullRunName = (source: string, slug: string): string => `${source}/${slug}`

/**
 * The display name, or the id when a server built before #497 sent none.
 * During `self-update` a new Gatehouse can be served by an old server, whose
 * records carry only `source`; such a row then reads as it did before this
 * change, rather than with an empty name.
 */
export const shownName = (source: string, sourceName: string | undefined): string => sourceName || source

/**
 * Whether rows name their repository. Interfaces shorten in one case today
 * (§6.2): when the set has one repository, a row drops the name, so a
 * single-repository deployment looks as it did. The other case, a scope of
 * one repository, arrives with the scope control (#498).
 *
 * The set's size is read from `/api/health`, which lists every repository the
 * server serves — the set as configured, whether or not each has runs.
 * Counting the repositories the rows happen to mention would drop the name
 * from the inbox while a second repository had nothing waiting, and put it
 * back when it did. While the list is loading `ready` is false and a page
 * holds its rows; if it cannot be read, rows name the repository, which is
 * never ambiguous.
 */
export function useNamesRepository(): { ready: boolean; show: boolean } {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: Number.POSITIVE_INFINITY })
  if (data) return { ready: true, show: data.sources.length !== 1 }
  return { ready: isError, show: true }
}

/**
 * A run's name in a sentence — an inbox row: `billing / add-export`, or
 * `add-export` alone when the set has one repository. The repository takes
 * the face and size of the run name it qualifies (`className`), in the muted
 * ink at regular weight; the slug keeps the row's own style.
 *
 * Inline text on one line, so the name reads and copies as one run of words:
 * a flex layout would make each part a block, and a browser copies blocks
 * with line breaks between them. A display name longer than 20 characters is
 * cut there with an ellipsis, so the slug after it stays in view; past that
 * the row's own overflow rule applies, as it did to the `source/slug` this
 * replaces. The whole name stays in the markup, so a screen reader reads it
 * with the row, and the full name (`github.com/acme/billing/add-export`) is
 * the tooltip.
 */
export function RunName({
  source,
  sourceName,
  slug,
  showRepository,
  className,
  clipped = false,
}: {
  source: string
  sourceName: string | undefined
  slug: string
  showRepository: boolean
  /**
   * The row's own style for its run name — face, size, weight, ink, and its
   * overflow rule — as the row set it before the repository was named. The
   * slug keeps it; the repository keeps the face and size and takes the
   * muted ink.
   */
  className?: string
  /**
   * The row gives the name a line of its own width and truncates it there
   * (the inbox). The repository's cap then also yields to that width, less
   * the separator's three characters, so on a phone-width line the name and
   * its ` / ` are cut inside the line rather than past it.
   */
  clipped?: boolean
}) {
  const cap = clipped ? 'max-w-[min(20ch,calc(100%-3ch))]' : 'max-w-[20ch]'
  return (
    <span className={`whitespace-nowrap ${className ?? ''}`} title={fullRunName(source, slug)} data-run-name>
      {showRepository && (
        <>
          <span className={`inline-block ${cap} truncate align-bottom font-normal text-muted`} data-repository-name>
            {shownName(source, sourceName)}
          </span>
          <span className="font-normal text-muted"> / </span>
        </>
      )}
      {/* A text node, not an element: a clipped inline element still
          measures its full width, which the geometry sweep reads as text
          painting past the cell (#280). */}
      {slug}
    </span>
  )
}

/**
 * Where a register's repository column shows. From 1280px up the Portfolio
 * has its full width and the column fits beside the others; below that the
 * table already scrolls sideways in its pane, and a column to the left of
 * the run would push the slug — the column the page exists for — out of
 * view. So below 1280px the column is not drawn and the name folds under the
 * slug as a subline (`REPOSITORY_FOLD`), the way the profile already sits
 * under it.
 */
export const REPOSITORY_COLUMN = 'max-xl:hidden'
/** The subline a register's repository folds into below 1280px: the column's counterpart. */
export const REPOSITORY_FOLD = 'xl:hidden'

/**
 * A repository's display name in a register: its own column, or the subline
 * it folds into. Cut at 20 characters with an ellipsis; the full id is the
 * tooltip. Face and size come from the register (`className`); the ink is
 * always the muted one.
 */
export function RepositoryName({ source, sourceName, className }: { source: string; sourceName: string | undefined; className?: string }) {
  return (
    <span className={`block max-w-[20ch] truncate font-normal text-muted ${className ?? ''}`} title={source} data-repository-name>
      {shownName(source, sourceName)}
    </span>
  )
}

/** The run link's accessible name in a register: the repository, then the run — "billing, add-export". */
export const runLinkLabel = (source: string, sourceName: string | undefined, slug: string): string => `${shownName(source, sourceName)}, ${slug}`

/** The browser tab's title on a run page: the run, then its repository, so two tabs can be told apart. */
export const runPageTitle = (slug: string, repository: string): string => `${slug} · ${repository} — Gatehouse`

/**
 * Sets `document.title` while the page is mounted, and puts back what was
 * there when it unmounts. Null leaves the title alone (a page still loading).
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return
    const before = document.title
    document.title = title
    return () => {
      document.title = before
    }
  }, [title])
}
