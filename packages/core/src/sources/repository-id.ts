// A repository's id (docs/MULTI-REPO.md §6, #494): the one parser of origin
// URLs, and the rules an id must satisfy.
//
// A repository with an origin is named `<host>/<owner>/<name>` — for example
// `github.com/acme/billing` — so that every machine that clones it computes
// the same name. One without an origin is `local/<name>`. The display name is
// separate and is presentation only.
//
// Pure: no I/O, no node builtins. The caller reads the URL (with
// `git remote get-url origin`, which applies the operator's `insteadOf`
// rewrites) and hands the string in. That keeps this module safe to import
// from `view-model/host-link.ts`, which decides links from the same parse.

/** An origin URL read for what it names: the host, and the path under it. */
export interface ParsedOrigin {
  /** Lowercased, with any user and port removed. */
  host: string
  /** The path's segments, case kept, with a trailing `.git` dropped. At least one. */
  path: string[]
}

/** Thrown by `loadSources` when the set of repositories cannot be named consistently. */
export class RepositoryIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RepositoryIdError'
  }
}

export const LOCAL_ID_PREFIX = 'local/'

/**
 * The host from a URL's authority: `user@host:port` → `host`. A bracketed
 * IPv6 literal keeps its brackets, since that is how a URL writes it.
 */
function hostOf(authority: string): string {
  const at = authority.lastIndexOf('@')
  let host = at === -1 ? authority : authority.slice(at + 1)
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    host = close === -1 ? host : host.slice(0, close + 1)
  } else {
    const colon = host.indexOf(':')
    if (colon !== -1) host = host.slice(0, colon)
  }
  return host.toLowerCase()
}

/**
 * Read an origin URL for the host and path it names, or null when it names
 * none: a filesystem path, a `file://` URL, or a string with no host or path.
 *
 * The SSH and HTTPS forms of one repository parse the same:
 * `git@github.com:acme/billing.git`, `ssh://git@github.com:22/acme/billing`
 * and `https://github.com/acme/billing/` all give `github.com` and
 * `['acme', 'billing']`. Git's own rule tells the two shapes apart: a URL has
 * `scheme://`, and the scp-like form has a colon before any slash.
 */
export function parseOriginUrl(url: string | null | undefined): ParsedOrigin | null {
  const raw = (url ?? '').trim()
  if (raw === '') return null
  let authority: string
  let path: string
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(raw)
  if (scheme) {
    if (scheme[1]!.toLowerCase() === 'file') return null
    const rest = raw.slice(scheme[0].length)
    const slash = rest.indexOf('/')
    authority = slash === -1 ? rest : rest.slice(0, slash)
    path = slash === -1 ? '' : rest.slice(slash)
  } else {
    const colon = raw.indexOf(':')
    const slash = raw.indexOf('/')
    // No colon, or a slash before it: a filesystem path, as git reads it.
    if (colon <= 0 || (slash !== -1 && slash < colon)) return null
    // A drive letter is a Windows path, not a host called `C`.
    if (/^[A-Za-z]:[\\/]/.test(raw)) return null
    authority = raw.slice(0, colon)
    path = raw.slice(colon + 1)
  }
  const host = hostOf(authority)
  if (host === '') return null
  const segments = path.split('/').filter((s) => s !== '')
  const last = segments.at(-1)
  if (last?.endsWith('.git')) {
    const bare = last.slice(0, -'.git'.length)
    if (bare === '') segments.pop()
    else segments[segments.length - 1] = bare
  }
  if (segments.length === 0) return null
  return { host, path: segments }
}

/**
 * The repository id an origin URL gives, or null when it gives none (the
 * repository is then treated as having no origin, and named `local/<name>`).
 */
export function idFromOrigin(url: string | null | undefined): string | null {
  const parsed = parseOriginUrl(url)
  return parsed ? [parsed.host, ...parsed.path].join('/') : null
}

/** The form two ids are compared in: ids that differ only in case name one repository. */
export function repositoryIdKey(id: string): string {
  return id.toLowerCase()
}

export function sameRepositoryId(a: string, b: string): boolean {
  return repositoryIdKey(a) === repositoryIdKey(b)
}

/** The id's last segment: the display name when the config gives none. */
export function lastIdSegment(id: string): string {
  return id.split('/').filter((s) => s !== '').at(-1) ?? id
}

/** The basename of a directory path, without node:path (this module is pure). */
export function directoryBasename(dir: string): string {
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? ''
}

/**
 * Why `name` cannot follow `local/`, or null when it can. Letters, digits,
 * `.`, `_` and `-`, and not `-` alone (§6.1). `.` and `..` alone are refused
 * too: a URL path normalizes them away, so the id could not be linked to.
 */
export function localNameProblem(name: string): string | null {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return `"${name}" may contain only letters, digits, ".", "_" and "-"`
  if (name === '-' || name === '.' || name === '..') return `"${name}" cannot be a name on its own`
  return null
}

/**
 * Why `id` is not a usable repository id, or null when it is.
 *
 * No segment may be `-`: the URL shape `/repos/<id>/-/runs/<slug>` finds where
 * the id ends by that segment, which is what lets an id nest to any depth
 * (§6.4). A `local/` id takes exactly one name, under the rules above.
 */
export function repositoryIdProblem(id: string): string | null {
  if (/\s/.test(id)) return `"${id}" contains whitespace`
  const segments = id.split('/')
  if (segments.length < 2) return `"${id}" needs at least two segments, as in github.com/acme/billing or local/billing`
  if (segments.some((s) => s === '')) return `"${id}" has an empty segment`
  if (segments.some((s) => s === '-')) return `"${id}" has a segment that is "-", which the URL shape reserves`
  if (segments.some((s) => s === '.' || s === '..')) return `"${id}" has a "." or ".." segment`
  if (segments[0] === 'local') {
    if (segments.length !== 2) return `"${id}" is a local id, which takes exactly one name after "local/"`
    const problem = localNameProblem(segments[1]!)
    if (problem) return `"${id}": ${problem}`
  }
  return null
}

/** How an id was arrived at, for error messages that tell the operator what to change. */
export type RepositoryIdOrigin = 'config' | 'origin' | 'local'

export interface DerivedRepositoryId {
  id: string
  from: RepositoryIdOrigin
}

/**
 * A repository's id, in precedence order: an `id:` stated in the config, else
 * the id its origin URL gives, else `local/<name>`, where the name is the
 * config entry's `name` or else the directory's basename (§6, R1).
 *
 * Throws `RepositoryIdError` when the result breaks the rules above, naming
 * what the operator can change.
 */
export function deriveRepositoryId(input: {
  /** What `git remote get-url origin` printed, or null when there is no origin. */
  origin: string | null
  /** The config entry's `id:`. */
  explicitId?: string
  /** The config entry's `name`. */
  name?: string
  /** The repository's top directory. */
  dir: string
}): DerivedRepositoryId {
  const { origin, explicitId, name, dir } = input
  if (explicitId !== undefined) {
    const problem = repositoryIdProblem(explicitId)
    if (problem) throw new RepositoryIdError(`repository at ${dir}: the configured id ${problem}`)
    return { id: explicitId, from: 'config' }
  }
  const fromOrigin = idFromOrigin(origin)
  if (fromOrigin !== null) {
    const problem = repositoryIdProblem(fromOrigin)
    if (problem)
      throw new RepositoryIdError(
        `repository at ${dir}: the id derived from its origin (${origin}) is unusable — ${problem}; state one with \`id:\` in the config`,
      )
    return { id: fromOrigin, from: 'origin' }
  }
  const localName = name ?? directoryBasename(dir)
  const problem = localNameProblem(localName)
  if (problem) {
    const what = name !== undefined ? 'its configured name' : 'its directory name'
    throw new RepositoryIdError(
      `repository at ${dir} has no origin, so it is named local/<name> from ${what}, and ${problem}; give it a \`name\` (or an \`id:\`) in the config`,
    )
  }
  return { id: `${LOCAL_ID_PREFIX}${localName}`, from: 'local' }
}
