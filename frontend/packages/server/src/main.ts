#!/usr/bin/env node
// `agentic ui` / `npm run dev` entrypoint: resolve sources, watch refs, serve
// the API and (when built) the SPA on localhost.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { loadSources } from '@agentic/core'
import { createApp } from './app.ts'
import { GenerationCache } from './cache.ts'
import { watchRepoRefs } from './watch.ts'
import { buildWebhook } from './webhook.ts'

export interface ServeOptions {
  port?: number
  host?: string
  repoOverrides?: string[]
  demo?: boolean
  open?: boolean
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

export async function startServer(opts: ServeOptions = {}): Promise<{ url: string; close: () => void }> {
  let repoOverrides = opts.repoOverrides
  if (opts.demo) {
    const { generateFixtureRepo } = await import('@agentic/fixtures')
    const fixture = generateFixtureRepo()
    console.log(`demo repository generated at ${fixture.dir}`)
    repoOverrides = [fixture.dir]
  }

  const { sources, configPath, warnings } = await loadSources({ repoOverrides })
  for (const w of warnings) console.warn(`warning: ${w}`)
  if (sources.length === 0) {
    throw new Error('no run sources — run inside a repository, pass --repo <path>, or create ~/.config/agentic/config.yaml')
  }
  console.log(
    `sources: ${sources.map((s) => s.id).join(', ')}${configPath ? ` (from ${configPath})` : ''}`,
  )

  const cache = new GenerationCache()
  const clients = new Set<(event: string) => void>()
  const unwatchers: (() => void)[] = []
  for (const source of sources) {
    const dir = (source as { dir?: string }).dir
    if (!dir) continue
    unwatchers.push(
      await watchRepoRefs(dir, () => {
        cache.bump()
        for (const send of clients) send('change')
      }),
    )
  }

  // Periodic remote sync: a source configured with fetch_interval polls its
  // origin so runs pushed elsewhere show up here; each fetch moves refs, and
  // the ref watcher above turns that into an SSE change signal.
  const syncTimers: NodeJS.Timeout[] = []
  for (const source of sources) {
    const s = source as { id: string; fetchIntervalSeconds?: number; syncFromRemote?: () => Promise<void> }
    if (!s.fetchIntervalSeconds || !s.syncFromRemote) continue
    let inFlight = false
    const sync = async () => {
      if (inFlight) return
      inFlight = true
      try {
        await s.syncFromRemote!()
      } catch (e) {
        console.warn(`warning: sync of ${s.id} failed: ${(e as Error).message}`)
      } finally {
        inFlight = false
      }
    }
    void sync()
    syncTimers.push(setInterval(sync, s.fetchIntervalSeconds * 1000))
    console.log(`syncing ${s.id} from origin every ${s.fetchIntervalSeconds}s`)
  }

  // Webhook intake (hosted mode): GITHUB_WEBHOOK_SECRET arms the route;
  // GITHUB_TOKEN additionally enables PR-approval sync on review events.
  const webhook = buildWebhook({
    sources,
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    githubToken: process.env.GITHUB_TOKEN,
    log: (line) => console.log(line),
  })
  if (webhook) console.log('github webhook armed at /api/webhooks/github')

  const app = createApp({
    sources,
    cache,
    subscribe: (send) => {
      clients.add(send)
      return () => clients.delete(send)
    },
    webhook,
  })

  // Static SPA (when built). In dev, Vite serves the UI and proxies /api here.
  const webDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  const hasSpa = existsSync(join(webDist, 'index.html'))
  if (hasSpa) {
    app.get('*', async (c) => {
      const urlPath = new URL(c.req.url).pathname
      if (urlPath.startsWith('/api/')) return c.notFound()
      const candidate = join(webDist, urlPath.replace(/^\/+/, ''))
      const file = existsSync(candidate) && !candidate.endsWith('/') && urlPath !== '/' ? candidate : join(webDist, 'index.html')
      const body = await readFile(file)
      return c.body(body, 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    })
  }

  const port = opts.port ?? 4310
  const host = opts.host ?? '127.0.0.1'
  const server = serve({ fetch: app.fetch, port, hostname: host })
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`
  console.log(`agentic ui listening on ${url}${hasSpa ? '' : '  (API only — run `npm run build` for the SPA, or `npm run dev -w @agentic/web`)'}`)

  if (opts.open) {
    const { exec } = await import('node:child_process')
    exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} ${url}`)
  }

  return {
    url,
    close: () => {
      for (const t of syncTimers) clearInterval(t)
      for (const u of unwatchers) u()
      server.close()
    },
  }
}

// Direct invocation: node src/main.ts [--port N] [--host H] [--repo path]... [--demo] [--open]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const opts: ServeOptions = { repoOverrides: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--port') opts.port = Number(args[++i])
    else if (a === '--host') opts.host = args[++i]
    else if (a === '--repo') opts.repoOverrides!.push(args[++i]!)
    else if (a === '--demo') opts.demo = true
    else if (a === '--open') opts.open = true
  }
  if (!opts.repoOverrides!.length) delete opts.repoOverrides
  startServer(opts).catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
