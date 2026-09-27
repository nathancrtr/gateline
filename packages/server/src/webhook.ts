// GitHub webhook intake for hosted deployments: push events turn into an
// immediate fetch (the interval poll stays as the fallback), and PR-review
// events run the G2 approval sync. The webhook path is authenticated by its
// HMAC signature, not by the proxy in front — document a bypass for it.
//
// Each event is routed by the repository its payload names (#496,
// docs/MULTI-REPO.md §8.4, decision P8): only the source whose id matches it
// is synced. One secret covers every repository.

import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  applySync,
  idFromOrigin,
  parseGitHubRemote,
  planSync,
  RestPrProvider,
  type RunSource,
  sameRepositoryId,
  viewModeRefusal,
} from '@gateline/core'

export interface WebhookConfig {
  secret: string
  onEvent: (event: string, payload: unknown) => Promise<string>
}

/** Constant-time check of X-Hub-Signature-256 against the raw body. */
export function verifySignature(secret: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The repository id a GitHub event's payload names, derived from its
 * `repository.clone_url` (else `html_url`) by the same parser the sources'
 * ids come from, so `https://github.com/Acme/Billing.git` gives
 * `github.com/Acme/Billing`. Null when the payload names no repository.
 */
export function payloadRepositoryId(payload: unknown): string | null {
  const repository = (payload as { repository?: unknown } | null)?.repository
  if (!repository || typeof repository !== 'object') return null
  const { clone_url, html_url } = repository as { clone_url?: unknown; html_url?: unknown }
  for (const url of [clone_url, html_url]) {
    if (typeof url !== 'string') continue
    const id = idFromOrigin(url)
    if (id !== null) return id
  }
  return null
}

/**
 * Whether a webhook naming a repository can reach this source: its id must be
 * the one its origin gives. A `local/` id (no origin), a local-only source
 * (whose origin is not read) and an id stated with `id:` that differs from the
 * origin's never match, and rely on the fetch interval instead. An `id:` that
 * states exactly what the origin gives is indistinguishable from a derived
 * one here and is routed like one.
 */
export async function webhookRoutable(source: RunSource): Promise<boolean> {
  const fromOrigin = idFromOrigin((await source.originUrl?.().catch(() => null)) ?? null)
  return fromOrigin !== null && sameRepositoryId(fromOrigin, source.id)
}

/** The sources no webhook can reach (see `webhookRoutable`), for the startup log. */
export async function unroutableSources(sources: RunSource[]): Promise<RunSource[]> {
  const routable = await Promise.all(sources.map(webhookRoutable))
  return sources.filter((_, i) => !routable[i])
}

/**
 * Wire webhook events to the sources. Returns undefined when no secret is
 * configured — the route then never exists; an unsigned endpoint would let
 * anyone who can reach the port trigger work.
 */
export function buildWebhook(opts: {
  sources: RunSource[]
  secret: string | undefined
  githubToken: string | undefined
  log: (line: string) => void
}): WebhookConfig | undefined {
  if (!opts.secret) return undefined

  /** The one source the payload names and a webhook can reach, or a sentence saying why there is none. */
  const route = async (payload: unknown): Promise<RunSource | string> => {
    const id = payloadRepositoryId(payload)
    if (id === null) return 'the event names no repository; nothing synced'
    for (const source of opts.sources) {
      if (sameRepositoryId(source.id, id) && (await webhookRoutable(source))) return source
    }
    return `${id} is not served here; nothing synced`
  }

  const fetchFrom = async (source: RunSource): Promise<string | null> => {
    if (!source.syncFromRemote) return null
    try {
      await source.syncFromRemote()
      return null
    } catch (e) {
      const message = `sync of ${source.id} failed: ${(e as Error).message}`
      opts.log(`webhook: ${message}`)
      return message
    }
  }

  const push = async (payload: unknown): Promise<string> => {
    const source = await route(payload)
    if (typeof source === 'string') return source
    if (!source.syncFromRemote) return `${source.id} reads origin directly; nothing to sync`
    return (await fetchFrom(source)) ?? `synced ${source.id}`
  }

  const review = async (payload: unknown): Promise<string> => {
    const source = await route(payload)
    if (typeof source === 'string') return source
    // The review may follow a push we have not fetched yet; fetching is a
    // read, so it happens whatever the repository's mode.
    const failed = await fetchFrom(source)
    if (failed) return failed
    // A `view` repository records nothing (§7.3). Its source would refuse the
    // write anyway; asking here first reports that, and spares the call to
    // GitHub the refusal would waste.
    const refusal = viewModeRefusal(source)
    if (refusal) {
      opts.log(`webhook: PR-approval sync of ${source.id} skipped: ${refusal}`)
      return `PR-approval sync skipped: ${refusal}`
    }
    if (!opts.githubToken) return 'review received; GITHUB_TOKEN unset — PR-approval sync skipped'
    try {
      const remote = parseGitHubRemote((await source.originUrl?.()) ?? '')
      if (!remote) return `${source.id} has no GitHub origin; PR-approval sync skipped`
      const provider = new RestPrProvider(remote, opts.githubToken)
      const results = await applySync(source, await planSync(source, provider))
      const applied: string[] = []
      const refused: string[] = []
      for (const r of results) {
        opts.log(`webhook: sync ${r.slug} G2 ${r.ok ? `recorded (${r.approval.reviewer})` : `failed: ${r.error}`}`)
        if (r.ok) applied.push(r.slug)
        else refused.push(`${r.slug}: ${r.error}`)
      }
      const parts = [
        ...(applied.length ? [`G2 recorded for ${applied.join(', ')}`] : []),
        ...(refused.length ? [`not recorded for ${refused.join('; ')}`] : []),
      ]
      return parts.length ? parts.join('; ') : 'no undecided G2 with an approved PR review'
    } catch (e) {
      const message = `PR-approval sync of ${source.id} failed: ${(e as Error).message}`
      opts.log(`webhook: ${message}`)
      return message
    }
  }

  return {
    secret: opts.secret,
    onEvent: async (event, payload) => {
      switch (event) {
        case 'ping':
          return 'pong'
        case 'push':
          return push(payload)
        case 'pull_request_review':
          return review(payload)
        default:
          return `ignored event ${event}`
      }
    },
  }
}
