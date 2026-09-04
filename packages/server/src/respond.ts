/**
 * The two ways a handler may answer, both checked against `contract.ts`.
 *
 * These live outside `contract.ts` on purpose: that module is imported by the
 * browser and may never touch Hono. This one is the server's half of the same
 * contract.
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { ApiErrorBody, ApiRoute, ResponseOf } from './contract.ts'

/**
 * A success response, named by its route.
 *
 * The route key is explicit (`respond<'GET /api/inbox'>(c, …)`) because there
 * is nothing in a handler's arguments for TypeScript to infer it from. That
 * verbosity is the feature: the key ties the body to the declaration, an
 * object literal that grows a field it did not declare is an excess-property
 * error, and one that loses a field is a missing-property error. Either way
 * `npm run typecheck` fails here rather than the page failing in a browser.
 */
export function respond<K extends ApiRoute>(c: Context, body: ResponseOf<K>, status?: ContentfulStatusCode) {
  return status === undefined ? c.json(body as never) : c.json(body as never, status)
}

/**
 * An error response. One shape at every route and every status (R3's `problems`
 * is the single optional addition), so a client needs one way to read a
 * failure.
 */
export function fail(c: Context, status: ContentfulStatusCode, body: ApiErrorBody) {
  return c.json(body, status)
}
