// The HTTP layer: thin JSON views over @agentic/core plus the single decision
// write path (rule R2 — POST /api/decisions is the only mutating route).
import { Hono } from 'hono'
import {
  buildEvidenceRollup,
  buildLexicon,
  buildPortfolio,
  collectRunDecisions,
  computeMetrics,
  deriveReadiness,
  DecisionError,
  engineHealthStale,
  ID_PATTERN,
  parseUnifiedDiff,
  planDecision,
  readEngineHealth,
  summarizeRun,
  validateArtifact,
  type Burden,
  type DecisionAction,
  type GateId,
  type Phase,
  type RunRef,
  type RunSource,
} from '@agentic/core'
import { GenerationCache } from './cache.ts'
import { verifySignature, type WebhookConfig } from './webhook.ts'

export interface AppDeps {
  sources: RunSource[]
  cache?: GenerationCache
  /** Called once per SSE client; returns an unsubscribe. */
  subscribe?: (send: (event: string) => void) => () => void
  /** GitHub webhook intake; absent → the route does not exist. */
  webhook?: WebhookConfig
}

export function createApp(deps: AppDeps): Hono {
  const cache = deps.cache ?? new GenerationCache()
  const app = new Hono()

  // R2 note: the webhook is not a second write path — pushes trigger a fetch,
  // and review events record a human's PR approval through writeState, the
  // same single path decisions take. HMAC is the route's authentication.
  if (deps.webhook) {
    const webhook = deps.webhook
    app.post('/api/webhooks/github', async (c) => {
      const raw = await c.req.text()
      if (!verifySignature(webhook.secret, raw, c.req.header('x-hub-signature-256'))) {
        return c.json({ error: 'invalid signature' }, 401)
      }
      try {
        JSON.parse(raw)
      } catch {
        return c.json({ error: 'body is not JSON' }, 400)
      }
      const event = c.req.header('x-github-event') ?? ''
      try {
        const detail = await webhook.onEvent(event, JSON.parse(raw))
        return c.json({ ok: true, detail })
      } catch (e) {
        return c.json({ error: (e as Error).message }, 500)
      }
    })
  }

  const sourceById = (id: string) => deps.sources.find((s) => s.id === id)

  const findRun = async (src: string, slug: string): Promise<{ source: RunSource; ref: RunRef } | null> => {
    const source = sourceById(src)
    if (!source) return null
    const runs = await cache.get(`runs:${src}`, () => source.listRuns())
    const ref = runs.find((r) => r.slug === slug)
    return ref ? { source, ref } : null
  }

  app.get('/api/health', (c) => c.json({ ok: true, sources: deps.sources.map((s) => s.id) }))

  // Engine liveness per source (#100): null = no co-located engine has ever
  // reported on this deployment (a viewer-only install — not an outage);
  // stale = one was configured here and has gone silent, which the UI
  // renders as an outage banner instead of "waiting on gate".
  app.get('/api/engine-health', async (c) => {
    const out: Record<
      string,
      {
        at: string
        inFlight: number
        pushRejections: Record<string, number>
        stale: boolean
        commit?: string
        codeHead?: string
        codeState?: 'fresh' | 'superseded-pending' | 'paused'
      } | null
    > = {}
    for (const s of deps.sources) {
      const dir = (s as { dir?: string }).dir
      if (!dir) continue
      const health = await readEngineHealth(dir)
      out[s.id] = health
        ? {
            at: health.at,
            inFlight: health.inFlight,
            pushRejections: health.pushRejections ?? {},
            stale: engineHealthStale(health),
            commit: health.commit,
            codeHead: health.codeHead,
            codeState: health.codeState,
          }
        : null
    }
    return c.json({ engines: out, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/inbox', async (c) => {
    const { inbox } = await cache.get('portfolio', () => buildPortfolio(deps.sources))
    return c.json({ items: inbox, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/runs', async (c) => {
    const { runs } = await cache.get('portfolio', () => buildPortfolio(deps.sources))
    return c.json({ runs, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/runs/:src/:slug', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const key = `run:${ref.source}:${ref.slug}`
    const payload = await cache.get(key, async () => {
      const [{ summary, items }, { state, error, raw }, readiness, artifacts, history] = await Promise.all([
        summarizeRun(source, ref),
        source.readState(ref),
        deriveReadiness(source, ref),
        source.listArtifacts(ref),
        source.stateHistory(ref),
      ])
      return {
        summary,
        items,
        state,
        stateError: error,
        stateRaw: raw,
        validations: readiness.validations,
        artifacts,
        history: history.map((h) => ({
          oid: h.oid,
          time: h.time,
          author: h.author,
          subject: h.subject,
          phase: h.state?.phase ?? null,
        })),
      }
    })
    return c.json({ ...payload, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/runs/:src/:slug/artifact', async (c) => {
    const path = c.req.query('path')
    if (!path) return c.json({ error: 'path query parameter required' }, 400)
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const content = await source.readArtifact(ref, path)
    if (content === null) return c.json({ error: `no artifact at ${path}` }, 404)
    const validation = await validateArtifact(path, content, source.templates)
    return c.json({ path, content, validation })
  })

  // The run lexicon (#163): verbatim R/AC/ADR definitions from this run's
  // own spec.md + plan.md, plus the id grammar as a regex source — shipped
  // as data because the browser must not bundle the core runtime.
  app.get('/api/runs/:src/:slug/lexicon', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const lexicon = await cache.get(`lexicon:${ref.source}:${ref.slug}`, async () => {
      const [spec, plan] = await Promise.all([source.readArtifact(ref, 'spec.md'), source.readArtifact(ref, 'plan.md')])
      return buildLexicon({ spec, plan })
    })
    return c.json({ entries: lexicon.entries, pattern: ID_PATTERN })
  })

  // Evidence-presence rollup (#165): which criteria the verification record
  // cites, computed from the artifacts. Presence, never verdicts — verdict
  // text in the payload is a verbatim quote from the report.
  app.get('/api/runs/:src/:slug/evidence', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const rollup = await cache.get(`evidence:${ref.source}:${ref.slug}`, async () => {
      const [spec, verification, artifacts] = await Promise.all([
        source.readArtifact(ref, 'spec.md'),
        source.readArtifact(ref, 'verification-report.md'),
        source.listArtifacts(ref),
      ])
      const reviews = await Promise.all(
        artifacts
          .filter((p) => /^review-\d+.*\.md$/.test(p))
          .map(async (p) => ({ path: p, content: (await source.readArtifact(ref, p)) ?? '' })),
      )
      return buildEvidenceRollup({ lexicon: buildLexicon({ spec }), verification, reviews })
    })
    return c.json(rollup)
  })

  app.get('/api/runs/:src/:slug/diff', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const text = await cache.get(`diff:${ref.source}:${ref.slug}`, () => source.readDiff(ref))
    return c.json({ files: parseUnifiedDiff(text), merged: ref.kind === 'default' })
  })

  app.get('/api/metrics', async (c) => {
    const metrics = await cache.get('metrics', () => computeMetrics(deps.sources))
    return c.json(metrics)
  })

  // The single write path (R2). Decisions carry name+timestamp+burden as a
  // side effect of deciding; CAS conflicts return 409 for re-present.
  app.post('/api/decisions', async (c) => {
    let body: {
      source?: string
      slug?: string
      action?: DecisionAction
      gate?: GateId
      notes?: string
      burden?: Burden
      escalationIndex?: number
      pauseReason?: string
      resumePhase?: Phase
      hold?: boolean
      holdReason?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    if (!body.source || !body.slug || !body.action) return c.json({ error: 'source, slug, and action are required' }, 400)

    const found = await findRun(body.source, body.slug)
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found

    const who = await source.identity()
    if (!who) return c.json({ error: 'git user.name/user.email are unset — decisions must be attributable to a named human' }, 400)

    const { state, error } = await source.readState(ref)
    if (!state) return c.json({ error: `run state is malformed: ${error}` }, 409)

    // R3 backstop: the UI never renders approve on a bounced packet, but the
    // API refuses too — a malformed packet is not approvable by any client.
    if (body.action === 'approve' && body.gate) {
      const { items } = await deriveReadiness(source, ref)
      const gateItem = items.find((i) => i.kind === 'gate' && i.gate === body.gate)
      if (gateItem && !gateItem.reviewable)
        return c.json({ error: `gate packet is malformed and was bounced: ${gateItem.problems.join('; ')}`, problems: gateItem.problems }, 422)
    }

    try {
      // source/slug/action were checked above; the rest planDecision validates.
      const planned = planDecision(state, { ...body, action: body.action }, who)
      const result = await source.writeState(ref, planned.mutate, planned.message)
      if (!result.ok) {
        const status = result.reason === 'ref-moved' ? 409 : result.reason === 'dirty-worktree' ? 423 : 400
        return c.json({ error: result.message ?? result.reason }, status)
      }
      cache.bump()
      return c.json({ ok: true, commit: result.commit, summary: planned.summary, note: result.message ?? null })
    } catch (e) {
      if (e instanceof DecisionError) return c.json({ error: e.message }, 400)
      throw e
    }
  })

  app.get('/api/runs/:src/:slug/decisions', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const records = await cache.get(`decisions:${found.ref.source}:${found.ref.slug}`, () =>
      collectRunDecisions(found.source, found.ref),
    )
    return c.json({ decisions: records })
  })

  // SSE: ref movement → one "change" event; clients revalidate their queries.
  app.get('/api/events', (c) => {
    const subscribe = deps.subscribe
    if (!subscribe) return c.json({ error: 'events unavailable' }, 501)
    return new Response(
      new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          const send = (event: string) => {
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: {}\n\n`))
            } catch {
              /* stream closed */
            }
          }
          send('hello')
          const unsubscribe = subscribe(send)
          const keepalive = setInterval(() => send('ping'), 25_000)
          c.req.raw.signal.addEventListener('abort', () => {
            clearInterval(keepalive)
            unsubscribe()
            try {
              controller.close()
            } catch {
              /* already closed */
            }
          })
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } },
    )
  })

  return app
}
