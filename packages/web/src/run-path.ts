// Where a run lives in a URL (#494, docs/MULTI-REPO.md §6.4).
//
// A repository id contains slashes (`github.com/acme/billing`) and a GitLab id
// nests to any depth, so the run page is `/repos/<id>/-/runs/<slug>` and its
// API is the same path under `/api`. The `-` segment is where the id ends: no
// id segment may be `-`, so the path parses at any depth without guessing.
// Every id segment and the slug are percent-encoded: a slug is the tail of a
// git branch name, which may carry `#`, `%`, `&` and non-ASCII characters.

const encodeId = (id: string): string =>
  id
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

/** The run page's path, with an optional query string (without its `?`). */
export function runPath(id: string, slug: string, query?: string): string {
  const base = `/repos/${encodeId(id)}/-/runs/${encodeURIComponent(slug)}`
  return query ? `${base}?${query}` : base
}

/** The run's API base: every per-run route is this path or a segment under it. */
export function runApiPath(id: string, slug: string): string {
  return `/api${runPath(id, slug)}`
}

const decode = (segment: string): string | null => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

/**
 * The repository id and slug a run page's pathname names, or null when it is
 * not one. Reads the raw, still-encoded pathname: react-router's own params
 * decode `%2F` back into a slash, which would erase the segment boundaries
 * this parse depends on.
 */
export function parseRunPath(pathname: string): { id: string; slug: string } | null {
  const segments = pathname.split('/').filter((s) => s !== '')
  if (segments[0] !== 'repos') return null
  const dash = segments.indexOf('-', 1)
  if (dash < 2 || segments[dash + 1] !== 'runs' || segments.length !== dash + 3) return null
  const idParts = segments.slice(1, dash).map(decode)
  const slug = decode(segments[dash + 2]!)
  if (slug === null || idParts.some((p) => p === null)) return null
  return { id: idParts.join('/'), slug }
}
