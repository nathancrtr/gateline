// GitHub webhook intake for hosted deployments: push events turn into an
// immediate fetch (the interval poll stays as the fallback), and PR-review
// events run the G2 approval sync. The webhook path is authenticated by its
// HMAC signature, not by the proxy in front — document a bypass for it.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { applySync, parseGitHubRemote, planSync, RestPrProvider, type RunSource } from '@agentic/core'

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

interface SyncCapable {
  id: string
  dir?: string
  syncFromRemote?: () => Promise<void>
}

const originUrl = (dir: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    )
  })

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
  const syncable = opts.sources.filter((s): s is RunSource & Required<SyncCapable> => {
    const c = s as SyncCapable
    return typeof c.syncFromRemote === 'function' && typeof c.dir === 'string'
  })

  const syncAll = async (): Promise<string> => {
    let synced = 0
    for (const source of syncable) {
      try {
        await source.syncFromRemote()
        synced++
      } catch (e) {
        opts.log(`webhook: sync of ${source.id} failed: ${(e as Error).message}`)
      }
    }
    return `synced ${synced}/${syncable.length} source(s)`
  }

  const reviewSync = async (): Promise<string> => {
    if (!opts.githubToken) return 'review received; GITHUB_TOKEN unset — PR-approval sync skipped'
    const applied: string[] = []
    for (const source of syncable) {
      try {
        await source.syncFromRemote() // the review may follow a push we haven't fetched yet
        const remote = parseGitHubRemote(await originUrl(source.dir))
        if (!remote) continue
        const provider = new RestPrProvider(remote, opts.githubToken)
        const results = await applySync(source, await planSync(source, provider))
        for (const r of results) {
          opts.log(`webhook: sync ${r.slug} G2 ${r.ok ? `recorded (${r.approval.reviewer})` : `failed: ${r.error}`}`)
          if (r.ok) applied.push(r.slug)
        }
      } catch (e) {
        opts.log(`webhook: PR-approval sync of ${source.id} failed: ${(e as Error).message}`)
      }
    }
    return applied.length ? `G2 recorded for ${applied.join(', ')}` : 'no undecided G2 with an approved PR review'
  }

  return {
    secret: opts.secret,
    onEvent: async (event, _payload) => {
      switch (event) {
        case 'ping':
          return 'pong'
        case 'push':
          return syncAll()
        case 'pull_request_review':
          return reviewSync()
        default:
          return `ignored event ${event}`
      }
    },
  }
}
