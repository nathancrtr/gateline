// Links made under a repository's old names (#494, docs/MULTI-REPO.md §6.3,
// §6.4). Before #494 a run page lived at `/runs/<source>/<slug>`, where the
// source was a config `name` or a directory's basename — with `-2` appended
// on a clash. Now it lives at `/repos/<repository id>/-/runs/<slug>`. A
// bookmark or a pasted link under the old shape, or under an id listed in a
// config's `former_ids:`, is sent to the repository it meant when exactly one
// matches, and to a page that asks which one when several do.
//
// Web routes only. Bookmarked links are web routes; the API is read by
// Gatehouse, which is served by the same process that serves the API, and
// the wire version (API_VERSION 3) records that the old API paths are gone.
import { displayNameOf, type RunSource, sameRepositoryId } from '@gateline/core'

/** The web path of one run, each id segment and the slug percent-encoded. */
export function runPagePath(id: string, slug: string): string {
  const encodedId = id
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `/repos/${encodedId}/-/runs/${encodeURIComponent(slug)}`
}

/** The source whose id is `id`, compared without case (§6.1). */
export function sourceWithId(sources: readonly RunSource[], id: string): RunSource | undefined {
  return sources.find((s) => sameRepositoryId(s.id, id))
}

/**
 * The sources an old name may have meant. A current id wins outright; after
 * that, every source that lists the name among its former ids. Compared
 * without case, as ids are: the old routes compared exactly, but no two
 * repositories here can differ only in case, so the looser match finds
 * nothing the exact one would have missed.
 */
export function sourcesFormerlyNamed(sources: readonly RunSource[], name: string): RunSource[] {
  const current = sourceWithId(sources, name)
  if (current) return [current]
  return sources.filter((s) => (s.formerIds ?? []).some((former) => sameRepositoryId(former, name)))
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The page shown when an old name matches several repositories: which did
 * the link mean? Plain text links, each to the run in one repository. It
 * borrows nothing from Gatehouse's styling on purpose — it is a fork in a
 * URL, not a screen of the product.
 */
export function chooserPage(name: string, slug: string, candidates: readonly RunSource[], search: string): string {
  const items = candidates
    .map((s) => {
      const href = `${runPagePath(s.id, slug)}${search}`
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(s.id)}</a> (${escapeHtml(displayNameOf(s))})</li>`
    })
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Which repository?</title>
</head>
<body>
<h1>Which repository?</h1>
<p>This link names the run <code>${escapeHtml(slug)}</code> in <code>${escapeHtml(name)}</code>, an older name that more than one repository here once had. Choose the one you meant.</p>
<ul>
${items}
</ul>
</body>
</html>
`
}
