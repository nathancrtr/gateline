// A run's repository, named (#497; docs/MULTI-REPO.md §6.2, §9.2).
//
// A run's full name is `<repository id>/<slug>` — `github.com/acme/billing/
// add-export`. Interfaces show the repository by its display name instead,
// the config `name` or else the id's last segment, which core puts on every
// view-model record beside the id (`sourceName`); web never derives it from
// the id. Decision D7: the name is text, in the same position on every row,
// card and page, with no colour and no per-repository mark, because colour in
// Gatehouse carries run state.
//
// Which vocabulary kind each part is (docs/SEAM.md §5): the display name
// names a thing the reader meets on other rows, so it is a Name in the
// table's sense, set as the qualifier of the run's name it precedes — the
// same face and size, muted, regular weight. It is not rendered through
// `Name`, which is ink (it would outrank the slug) and refuses a trailing
// `.ext`, which a config name such as `gateline.dev` may carry. The full id
// is an Address: it contains slashes, it locates the repository, and it is
// what an operator pastes. An address never stands alone, so it is never
// printed in place of the display name; it follows it, on hover and in
// anything copied.

import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../api.ts'

/** The run's full name, `<repository id>/<slug>` (§6.2): what a tooltip shows and a copy carries. */
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
 * A run's name on a row: `billing / add-export`, or `add-export` alone when
 * the set has one repository. The repository takes the face and size of the
 * run name it qualifies (`className`), in the muted ink at regular weight;
 * the slug keeps the row's own style.
 *
 * Inline text on one line, so the name reads and copies as one run of words: a flex layout would make each part a block, and a browser copies
 * blocks with line breaks between them. A display name longer than 20
 * characters is cut there with an ellipsis, so the slug after it stays in
 * view; past that the row's own overflow rule applies, as it did to the
 * `source/slug` this replaces. The whole name stays in the markup, so a
 * screen reader reads it with the row, and the full name
 * (`github.com/acme/billing/add-export`) is the tooltip and what a copy of
 * the name puts on the clipboard.
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
   * its ` / ` are cut inside the line rather than past it. Off in a table, where a percentage would size the
   * column for the whole name and then leave the cut name in a gap.
   */
  clipped?: boolean
}) {
  const full = fullRunName(source, slug)
  const cap = clipped ? 'max-w-[min(20ch,calc(100%-3ch))]' : 'max-w-[20ch]'
  return (
    <span className={`whitespace-nowrap ${className ?? ''}`} title={full} data-run-name data-full-name={full}>
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
 * The copy rule (§6.2: "anything copied to the clipboard uses the full
 * name"): in the selected text, each name the selection wholly holds is
 * replaced by the full name it stands for, in document order. A name the
 * selection only cuts through is left as selected — the reader chose those
 * characters. Returns null when nothing is replaced, and the copy is then the
 * browser's own.
 */
export function substituteFullNames(selected: string, names: { shown: string; full: string }[]): string | null {
  let out = ''
  let from = 0
  let replaced = false
  for (const { shown, full } of names) {
    if (!shown) continue
    const at = selected.indexOf(shown, from)
    if (at < 0) continue
    out += selected.slice(from, at) + full
    from = at + shown.length
    replaced = true
  }
  return replaced ? out + selected.slice(from) : null
}

/**
 * Whether a selected range holds all of an element's text. Asked of the text
 * rather than of the nodes: a reader who drags across a name selects inside
 * its text nodes, and `Selection.containsNode` would call that partial.
 */
function holdsAllOf(range: Range, el: Element): boolean {
  if (!range.intersectsNode(el)) return false
  const whole = document.createRange()
  whole.selectNodeContents(el)
  const part = whole.cloneRange()
  if (range.compareBoundaryPoints(Range.START_TO_START, whole) > 0) part.setStart(range.startContainer, range.startOffset)
  if (range.compareBoundaryPoints(Range.END_TO_END, whole) < 0) part.setEnd(range.endContainer, range.endOffset)
  const text = whole.toString()
  return text !== '' && part.toString() === text
}

/**
 * Installs the copy rule once for the app. A `copy` event is dispatched to
 * the focused element or the body, never to the text that was selected, so
 * the rule listens on the document and finds the names by their
 * `data-full-name` hook.
 */
export function useFullNamesOnCopy(): void {
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const selection = document.getSelection()
      if (!selection || selection.isCollapsed || !e.clipboardData) return
      const ranges = Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i))
      const names = [...document.querySelectorAll<HTMLElement>('[data-full-name]')]
        .filter((el) => ranges.some((r) => holdsAllOf(r, el)))
        .map((el) => ({ shown: el.textContent ?? '', full: el.dataset.fullName ?? '' }))
      if (names.length === 0) return
      const text = substituteFullNames(selection.toString(), names)
      if (text === null) return
      e.clipboardData.setData('text/plain', text)
      e.preventDefault()
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [])
}

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
