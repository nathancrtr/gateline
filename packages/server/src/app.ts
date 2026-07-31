// The HTTP layer: thin JSON views over @gateline/core. Every mutation rides
// its own sanctioned core seam (ADR-2): decisions over
// planDecision/writeState, staging over planRunScaffold/stageRun. No route
// here composes a sources/git.ts primitive directly (AC1.1).
import { timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import {
  buildEvidenceRollup,
  buildLexicon,
  buildPortfolio,
  buildTaskSet,
  BUILTIN_SECTIONS,
  collectRunDecisions,
  computeMetrics,
  deriveReadiness,
  DecisionError,
  engineHealthStale,
  extractSections,
  hostBranchUrl,
  ID_PATTERN,
  parseReview,
  missingSections,
  parseLedgerSubject,
  parseUnifiedDiff,
  planDecision,
  scopeDiff,
  planRunScaffold,
  PROFILES,
  readEngineHealth,
  ScaffoldError,
  SLUG_PATTERN,
  summarizeRun,
  validateArtifact,
  type Burden,
  type DecisionAction,
  type Disposition,
  type GateId,
  type Phase,
  type Profile,
  type RunRef,
  type RunSource,
} from '@gateline/core'
import { GenerationCache } from './cache.ts'
import type { DispatchOutcome, RunnerApi } from './runner-api.ts'
import { verifySignature, type WebhookConfig } from './webhook.ts'

export interface AppDeps {
  sources: RunSource[]
  cache?: GenerationCache
  /** Called once per SSE client; returns an unsubscribe. */
  subscribe?: (send: (event: string) => void) => () => void
  /** GitHub webhook intake; absent → the route does not exist. */
  webhook?: WebhookConfig
  /** Runner-agent poll/claim/report surface (R6); absent → the routes do not exist. */
  runnerApi?: RunnerApi
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

  // Runner-agent surface (R6): every route is service-token authenticated,
  // matching the webhook's config-gated existence — absent the token (or a
  // callback to serve it), the routes above never mount at all.
  if (deps.runnerApi) {
    const runner = deps.runnerApi
    // Constant-time, matching webhook.ts's own convention (verifySignature) —
    // a naive `===` compare leaks token-prefix timing to anyone who can reach
    // the port (review-03.md F4).
    const authorized = (c: Context): boolean => {
      const header = c.req.header('authorization') ?? ''
      const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
      if (!presented) return false
      const a = Buffer.from(presented)
      const b = Buffer.from(runner.token)
      return a.length === b.length && timingSafeEqual(a, b)
    }

    app.get('/api/runner/intents', async (c) => {
      if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
      // repoUrl rides the same response (review-03.md F6): task 04's
      // workstation agent clones from this rather than requiring
      // `--repo-url` on every invocation; null when unconfigured/
      // unresolvable, in which case the agent's `--repo-url` flag is the
      // documented fallback.
      const [intents, repoUrl] = await Promise.all([runner.listIntents(), runner.repoUrl()])
      return c.json({ intents, repoUrl })
    })

    app.post('/api/runner/claim', async (c) => {
      if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
      let body: { key?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400)
      }
      if (!body.key) return c.json({ error: 'key is required' }, 400)
      const claimed = runner.claim(body.key)
      return c.json(claimed ? { claimed: true } : { claimed: false, reason: 'already-claimed' })
    })

    app.post('/api/runner/report', async (c) => {
      if (!authorized(c)) return c.json({ error: 'unauthorized' }, 401)
      let body: { key?: string; outcome?: DispatchOutcome }
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400)
      }
      if (!body.key || !body.outcome) return c.json({ error: 'key and outcome are required' }, 400)
      const resolved = runner.report(body.key, body.outcome)
      return c.json({ resolved })
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

  // The one derivation of "required intent-brief.md sections" from a
  // (possibly absent) template, shared verbatim by GET /api/staging (form
  // config) and POST /api/runs (server-side check) — AC2.2's single-truth
  // demand.
  const requiredBriefSections = (template: string | null): string[] => {
    const fromTemplate = template ? extractSections(template) : []
    return fromTemplate.length ? fromTemplate : BUILTIN_SECTIONS['intent-brief.md']!
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
        codeReason?: string
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
            codeReason: health.codeReason,
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

  // The staging form's configuration (plan "Server routes"): per-source
  // identity and required brief sections, plus the slug grammar as data —
  // core stays out of the browser bundle (ADR-6).
  app.get('/api/staging', async (c) => {
    const sources = await Promise.all(
      deps.sources.map(async (s) => {
        const [identity, briefTemplate] = await Promise.all([s.identity(), s.templates.read('intent-brief.md')])
        return { id: s.id, identity, briefSections: requiredBriefSections(briefTemplate), briefTemplate }
      }),
    )
    return c.json({ sources, slugPattern: SLUG_PATTERN })
  })

  // Staging a new run (R1/R4/R8): a second mutating route riding its own
  // core seam (planRunScaffold + stageRun, ADR-1/ADR-2) — the only
  // branch-minting path, never a git primitive called directly (AC1.1).
  app.post('/api/runs', async (c) => {
    let body: {
      source?: string
      slug?: string
      title?: string
      profile?: Profile
      briefMarkdown?: string
      costLimitUsd?: number | null
      intake?: { source: string | null; ref: string | null; url: string | null; clientKey: string | null }
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ outcome: 'refused', reason: 'invalid-input', message: 'invalid JSON body' }, 400)
    }

    if (!body.slug || !body.title || !body.profile || !body.briefMarkdown || !PROFILES.includes(body.profile))
      return c.json({ outcome: 'refused', reason: 'invalid-input', message: 'slug, title, a valid profile, and briefMarkdown are required' }, 400)

    // Source resolution (AC1.3): named only when more than one is configured.
    let source: RunSource
    if (body.source) {
      const found = sourceById(body.source)
      if (!found) return c.json({ outcome: 'refused', reason: 'invalid-input', message: `unknown source "${body.source}"` }, 400)
      source = found
    } else if (deps.sources.length === 1) {
      source = deps.sources[0]!
    } else {
      return c.json(
        { outcome: 'refused', reason: 'invalid-input', message: 'source is required when more than one source is configured' },
        400,
      )
    }

    // Same section derivation GET /api/staging serves the form (AC2.2).
    const required = requiredBriefSections(await source.templates.read('intent-brief.md'))
    const missing = missingSections(body.briefMarkdown, required)
    if (missing.length)
      return c.json(
        {
          outcome: 'refused',
          reason: 'missing-sections',
          missing,
          message: `intent-brief.md is missing required section(s): ${missing.join(', ')}`,
        },
        422,
      )

    // stagedBy/author come only from the source's own identity (AC4.2) — the
    // body carries no free-text "your name" field. `stageRun` below is the
    // one that actually guards identity; this call only needs a string.
    const who = await source.identity()
    let scaffold
    try {
      scaffold = planRunScaffold({
        slug: body.slug,
        title: body.title,
        profile: body.profile,
        briefMarkdown: body.briefMarkdown,
        costLimitUsd: body.costLimitUsd ?? null,
        intake: body.intake ?? { source: null, ref: null, url: null, clientKey: null },
        stagedBy: who?.name ?? '',
      })
    } catch (e) {
      if (e instanceof ScaffoldError) return c.json({ outcome: 'refused', reason: 'invalid-input', message: e.message }, 400)
      throw e
    }

    const result = await source.stageRun(scaffold, who ?? { name: '', email: '' })
    if (result.outcome === 'created') {
      cache.bump()
      return c.json(
        result.pushFailed
          ? { outcome: 'created', slug: result.slug, branch: result.branch, commit: result.commit, pushFailed: result.pushFailed }
          : { outcome: 'created', slug: result.slug, branch: result.branch, commit: result.commit },
        201,
      )
    }
    if (result.outcome === 'exists') return c.json({ outcome: 'exists', slug: result.slug, branch: result.branch }, 200)
    // refused: no-identity is a 400 (nothing to retry against); slug-taken
    // and conflict are 409s naming the branch that already holds the slug.
    const status = result.reason === 'no-identity' ? 400 : 409
    return c.json({ outcome: 'refused', reason: result.reason, message: result.message }, status)
  })

  app.get('/api/runs/:src/:slug', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const key = `run:${ref.source}:${ref.slug}`
    const payload = await cache.get(key, async () => {
      const [{ summary, items }, { state, error, raw }, readiness, artifacts, history, origin] = await Promise.all([
        summarizeRun(source, ref),
        source.readState(ref),
        deriveReadiness(source, ref),
        source.listArtifacts(ref),
        source.stateHistory(ref),
        source.originUrl?.() ?? null,
      ])
      return {
        summary,
        items,
        state,
        stateError: error,
        stateRaw: raw,
        validations: readiness.validations,
        artifacts,
        // The link out to the host (#267). A `default`-kind run is one whose
        // branch exists neither locally nor on origin — it merged and was
        // cleaned up — so there is no branch page to send anyone to, and the
        // rule is degrade to the local view, never to a dead end. Everything
        // else is decided by host-link.ts, which returns null for any remote
        // it cannot resolve without guessing.
        branchUrl: ref.kind === 'default' ? null : hostBranchUrl(origin, ref.branch),
        history: history.map((h) => ({
          oid: h.oid,
          time: h.time,
          author: h.author,
          subject: h.subject,
          phase: h.state?.phase ?? null,
          // The ledger reading (#268). Parsed here rather than in the browser
          // because web takes only types from core, never values.
          ledger: parseLedgerSubject(h.subject),
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

  // Typed review reports (#214): findings, severities, verdicts and rounds,
  // parsed from this run's own review-NN.md and shipped as data — the browser
  // must not bundle the core runtime. Every field is a verbatim slice of the
  // committed artifact; nothing here summarizes or judges.
  app.get('/api/runs/:src/:slug/reviews', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const reports = await cache.get(`reviews:${ref.source}:${ref.slug}`, async () => {
      const artifacts = await source.listArtifacts(ref)
      return Promise.all(
        artifacts
          .filter((p) => /^review-\d+.*\.md$/.test(p))
          .map(async (p) => parseReview(p, (await source.readArtifact(ref, p)) ?? '')),
      )
    })
    return c.json({ reports })
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

  // The diff, labelled with the contact surface each work item declared (#270).
  // `files` stays the whole diff — the scoping labels it and never filters it —
  // and `surface` is positional against that list. A run with no readable task
  // set still gets its diff, with `surface.withheld` naming why it carries no
  // labels (FRONTEND.md §4.1).
  app.get('/api/runs/:src/:slug/diff', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return c.json({ error: 'run not found' }, 404)
    const { source, ref } = found
    const { text, tasks } = await cache.get(`diff:${ref.source}:${ref.slug}`, async () => {
      const [text, artifacts] = await Promise.all([source.readDiff(ref), source.listArtifacts(ref)])
      const tasks = await Promise.all(
        artifacts
          .filter((p) => /^tasks\/.*\.yaml$/.test(p))
          .map(async (p) => ({ path: p, content: (await source.readArtifact(ref, p)) ?? '' })),
      )
      return { text, tasks }
    })
    const files = parseUnifiedDiff(text)
    return c.json({ files, merged: ref.kind === 'default', surface: scopeDiff(files, buildTaskSet(tasks)) })
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
      disposition?: Disposition
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
