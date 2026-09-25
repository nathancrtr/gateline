// URL resolution for the two builds of this SPA (ADR-4). The live build talks
// to the cockpit server at a base of `/`; the static demo build is served
// from files under `/demo/` with no server behind it, so every GET becomes a
// `.json` file and no write or event stream can be answered.
//
// Both builds share one client. Every module that constructs a URL goes
// through the helpers here rather than hand-writing `/api/…`, so the one flag
// this file reads is the only place the two builds diverge.

/** The two facts every URL helper here needs: where the app is mounted, and
 * whether it was built for the static demo. */
export interface StaticModeEnv {
  baseUrl: string
  isStatic: boolean
}

/** Read once from Vite's build-time env (ADR-4): `BASE_URL` is `/` for the
 * live build and `/demo/` for `vite build --mode static`; the static flag
 * comes from `.env.static`. Every helper below defaults to this so call sites
 * pass nothing, and tests pass their own `StaticModeEnv` instead. */
export const env: StaticModeEnv = {
  baseUrl: import.meta.env.BASE_URL,
  isStatic: import.meta.env.VITE_GATELINE_STATIC === '1',
}

/** `/` → `''`, `/demo/` → `/demo` — a prefix meant to be concatenated
 * directly onto a path that already starts with `/`. */
export function pathPrefix(e: StaticModeEnv): string {
  return e.baseUrl.replace(/\/$/, '')
}

/** URL for a GET. In the live build this is `prefix + path`, byte-identical
 * to today. In the static build the response is a file, so the path gains a
 * `.json` suffix — which means the path itself must be query-free; a `path`
 * carrying `?` cannot be a filename, so this throws rather than silently
 * dropping the query. */
export function readUrl(path: string, e: StaticModeEnv = env): string {
  if (e.isStatic && path.includes('?')) {
    throw new Error(`readUrl: static mode cannot address a query string as a file: ${path}`)
  }
  return pathPrefix(e) + path + (e.isStatic ? '.json' : '')
}

/** URL for a POST. Never suffixed — the static host has no file at any write
 * route, which is what lets the app's existing failure path render (R5). */
export function writeUrl(path: string, e: StaticModeEnv = env): string {
  return pathPrefix(e) + path
}

/** The live-invalidation stream's URL, or `null` when the app was built
 * static — the static demo opens no `EventSource` at all (R4). */
export function eventsUrl(e: StaticModeEnv = env): string | null {
  return e.isStatic ? null : `${pathPrefix(e)}/api/events`
}

/** `createBrowserRouter`'s `basename`: the prefix, or `/` when there is
 * none — React Router requires a non-empty basename. */
export function routerBasename(e: StaticModeEnv = env): string {
  return pathPrefix(e) || '/'
}
