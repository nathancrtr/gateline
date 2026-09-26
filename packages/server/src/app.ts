// The HTTP layer: thin JSON views over @gateline/core. Every mutation rides
// its own sanctioned core seam (ADR-2): decisions over
// planDecision/writeState, staging over planRunScaffold/stageRun. No route
// here composes a sources/git.ts primitive directly (AC1.1).
import { timingSafeEqual } from 'node:crypto'
import {
  armRefusal,
  artifactRef,
  artifactRefs,
  BUILTIN_SECTIONS,
  type Burden,
  bestEffortEscalations,
  buildEscalationPacket,
  buildEvidenceRollup,
  buildG1Packet,
  buildLexicon,
  buildPortfolio,
  buildReleasePacket,
  buildTaskSet,
  type Closure,
  collectRunDecisions,
  computeMetrics,
  type DecisionAction,
  DecisionError,
  type Disposition,
  deriveReadiness,
  describeArtifact,
  engineHealthStale,
  extractSections,
  type GateId,
  hostBranchUrl,
  ID_PATTERN,
  missingSections,
  type Phase,
  PROFILES,
  type Profile,
  parseReview,
  parseUnifiedDiff,
  planDecision,
  planRunScaffold,
  type RunRef,
  type RunScaffold,
  type RunSource,
  readEngineHealth,
  readLedger,
  ScaffoldError,
  SLUG_PATTERN,
  scopeDiff,
  summarizeRun,
  validateArtifact,
} from '@gateline/core'
import { type Context, Hono } from 'hono'
import { GenerationCache } from './cache.ts'
import { API_VERSION, type EngineHealthResponse } from './contract.ts'
import { fail, respond } from './respond.ts'
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
        return fail(c, 401, { error: 'invalid signature' })
      }
      try {
        JSON.parse(raw)
      } catch {
        return fail(c, 400, { error: 'body is not JSON' })
      }
      const event = c.req.header('x-github-event') ?? ''
      try {
        const detail = await webhook.onEvent(event, JSON.parse(raw))
        return respond<'POST /api/webhooks/github'>(c, { ok: true, detail })
      } catch (e) {
        return fail(c, 500, { error: (e as Error).message })
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
      if (!authorized(c)) return fail(c, 401, { error: 'unauthorized' })
      // repoUrl rides the same response (review-03.md F6): task 04's
      // workstation agent clones from this rather than requiring
      // `--repo-url` on every invocation; null when unconfigured/
      // unresolvable, in which case the agent's `--repo-url` flag is the
      // documented fallback.
      const [intents, repoUrl] = await Promise.all([runner.listIntents(), runner.repoUrl()])
      return respond<'GET /api/runner/intents'>(c, { intents, repoUrl })
    })

    app.post('/api/runner/claim', async (c) => {
      if (!authorized(c)) return fail(c, 401, { error: 'unauthorized' })
      let body: { key?: string }
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 400, { error: 'invalid JSON body' })
      }
      if (!body.key) return fail(c, 400, { error: 'key is required' })
      const claimed = runner.claim(body.key)
      return respond<'POST /api/runner/claim'>(c, claimed ? { claimed: true } : { claimed: false, reason: 'already-claimed' })
    })

    app.post('/api/runner/report', async (c) => {
      if (!authorized(c)) return fail(c, 401, { error: 'unauthorized' })
      let body: { key?: string; outcome?: DispatchOutcome }
      try {
        body = await c.req.json()
      } catch {
        return fail(c, 400, { error: 'invalid JSON body' })
      }
      if (!body.key || !body.outcome) return fail(c, 400, { error: 'key and outcome are required' })
      const resolved = runner.report(body.key, body.outcome)
      return respond<'POST /api/runner/report'>(c, { resolved })
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

  app.get('/api/health', (c) =>
    respond<'GET /api/health'>(c, { ok: true, apiVersion: API_VERSION, sources: deps.sources.map((s) => s.id) }),
  )

  // Engine liveness per source (#100): null = no co-located engine has ever
  // reported on this deployment (a viewer-only install — not an outage);
  // stale = one was configured here and has gone silent, which the UI
  // renders as an outage banner instead of "waiting on gate".
  app.get('/api/engine-health', async (c) => {
    const out: EngineHealthResponse['engines'] = {}
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
            codeCause: health.codeCause,
            codeUpgradeBlocked: health.codeUpgradeBlocked,
            deferrals: health.deferrals ?? [],
          }
        : null
    }
    return respond<'GET /api/engine-health'>(c, { engines: out, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/inbox', async (c) => {
    const { inbox } = await cache.get('portfolio', () => buildPortfolio(deps.sources))
    return respond<'GET /api/inbox'>(c, { items: inbox, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/runs', async (c) => {
    const { runs } = await cache.get('portfolio', () => buildPortfolio(deps.sources))
    return respond<'GET /api/runs'>(c, { runs, now: Math.floor(Date.now() / 1000) })
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
    return respond<'GET /api/staging'>(c, { sources, slugPattern: SLUG_PATTERN })
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
      return respond<'POST /api/runs'>(c, { outcome: 'refused', reason: 'invalid-input', message: 'invalid JSON body' }, 400)
    }

    if (!body.slug || !body.title || !body.profile || !body.briefMarkdown || !PROFILES.includes(body.profile))
      return respond<'POST /api/runs'>(
        c,
        { outcome: 'refused', reason: 'invalid-input', message: 'slug, title, a valid profile, and briefMarkdown are required' },
        400,
      )

    // Source resolution (AC1.3): named only when more than one is configured.
    let source: RunSource
    if (body.source) {
      const found = sourceById(body.source)
      if (!found)
        return respond<'POST /api/runs'>(c, { outcome: 'refused', reason: 'invalid-input', message: `unknown source "${body.source}"` }, 400)
      source = found
    } else if (deps.sources.length === 1) {
      source = deps.sources[0]!
    } else {
      return respond<'POST /api/runs'>(
        c,
        { outcome: 'refused', reason: 'invalid-input', message: 'source is required when more than one source is configured' },
        400,
      )
    }

    // Same section derivation GET /api/staging serves the form (AC2.2).
    const required = requiredBriefSections(await source.templates.read('intent-brief.md'))
    const missing = missingSections(body.briefMarkdown, required)
    if (missing.length)
      return respond<'POST /api/runs'>(
        c,
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
    let scaffold: RunScaffold
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
      if (e instanceof ScaffoldError)
        return respond<'POST /api/runs'>(c, { outcome: 'refused', reason: 'invalid-input', message: e.message }, 400)
      throw e
    }

    const result = await source.stageRun(scaffold, who ?? { name: '', email: '' })
    if (result.outcome === 'created') {
      cache.bump()
      return respond<'POST /api/runs'>(
        c,
        result.pushFailed
          ? { outcome: 'created', slug: result.slug, branch: result.branch, commit: result.commit, pushFailed: result.pushFailed }
          : { outcome: 'created', slug: result.slug, branch: result.branch, commit: result.commit },
        201,
      )
    }
    if (result.outcome === 'exists')
      return respond<'POST /api/runs'>(c, { outcome: 'exists', slug: result.slug, branch: result.branch }, 200)
    // refused: no-identity is a 400 (nothing to retry against); slug-taken
    // and conflict are 409s naming the branch that already holds the slug.
    const status = result.reason === 'no-identity' ? 400 : 409
    return respond<'POST /api/runs'>(
      c,
      { outcome: 'refused', reason: result.reason, message: result.message },
      status,
    )
  })

  // Typed review reports (#214): findings, severities, verdicts and rounds,
  // parsed from this run's own review-NN.md and shipped as data — the browser
  // must not bundle the core runtime. Every field is a verbatim slice of the
  // committed artifact; nothing here summarizes or judges.
  const reviewsFor = (source: RunSource, ref: RunRef) =>
    cache.get(`reviews:${ref.source}:${ref.slug}`, async () => {
      const artifacts = await source.listArtifacts(ref)
      return Promise.all(
        artifacts
          .filter((p) => describeArtifact(p).kind === 'review-report')
          .map(async (p) => parseReview(p, (await source.readArtifact(ref, p)) ?? '')),
      )
    })

  app.get('/api/runs/:src/:slug', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const key = `run:${ref.source}:${ref.slug}`
    const payload = await cache.get(key, async () => {
      const [{ summary, items }, { state, error, raw }, readiness, artifacts, reviews, history, origin] = await Promise.all([
        summarizeRun(source, ref),
        source.readState(ref),
        deriveReadiness(source, ref),
        source.listArtifacts(ref),
        // The review reports, from the cache the reviews route fills: a
        // review's ref names the task it reviews (#415), so the rail labels
        // it on first paint instead of relabelling once the reports arrive.
        // Best-effort: a report that cannot be read costs its `reviewOf`
        // (the rail falls back to the report's number), never the run page.
        reviewsFor(source, ref).catch(() => []),
        source.stateHistory(ref),
        source.originUrl?.() ?? null,
      ])
      const refs = artifactRefs(artifacts, reviews)
      // The ledger reading (#268), joined to the state each commit wrote
      // (#426). Read here rather than in the browser because web takes only
      // types from core, never values.
      const ledger = readLedger(history, artifacts)
      const refByPath = new Map(refs.map((r) => [r.path, r]))
      return {
        summary,
        // An item's packet refs are built from paths in readiness; resolve
        // them against this run's refs so one payload names a review one way.
        items: items.map((item) => ({ ...item, packetRefs: item.packet.map((p) => refByPath.get(p) ?? artifactRef(p)) })),
        state,
        stateError: error,
        stateRaw: raw,
        validations: readiness.validations,
        artifacts,
        artifactRefs: refs,
        // The link out to the host (#267). A `default`-kind run is one whose
        // branch exists neither locally nor on origin — it merged and was
        // cleaned up — so there is no branch page to send anyone to, and the
        // rule is degrade to the local view, never to a dead end. Everything
        // else is decided by host-link.ts, which returns null for any remote
        // it cannot resolve without guessing.
        branchUrl: ref.kind === 'default' ? null : hostBranchUrl(origin, ref.branch),
        history: history.map((h, i) => ({
          oid: h.oid,
          time: h.time,
          author: h.author,
          subject: h.subject,
          phase: h.state?.phase ?? null,
          ledger: ledger[i]!,
        })),
      }
    })
    return respond<'GET /api/runs/:src/:slug'>(c, { ...payload, now: Math.floor(Date.now() / 1000) })
  })

  app.get('/api/runs/:src/:slug/artifact', async (c) => {
    const path = c.req.query('path')
    if (!path) return fail(c, 400, { error: 'path query parameter required' })
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const content = await source.readArtifact(ref, path)
    if (content === null) return fail(c, 404, { error: `no artifact at ${path}` })
    const validation = await validateArtifact(path, content, source.templates)
    return respond<'GET /api/runs/:src/:slug/artifact'>(c, { path, content, validation })
  })

  // The run lexicon (#163): verbatim R/AC/ADR definitions from this run's
  // own spec.md + plan.md, plus the id grammar as a regex source — shipped
  // as data because the browser must not bundle the core runtime.
  app.get('/api/runs/:src/:slug/lexicon', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const lexicon = await cache.get(`lexicon:${ref.source}:${ref.slug}`, async () => {
      const [spec, plan] = await Promise.all([source.readArtifact(ref, 'spec.md'), source.readArtifact(ref, 'plan.md')])
      return buildLexicon({ spec, plan })
    })
    return respond<'GET /api/runs/:src/:slug/lexicon'>(c, { entries: lexicon.entries, pattern: ID_PATTERN })
  })

  app.get('/api/runs/:src/:slug/reviews', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const reports = await reviewsFor(source, ref)
    return respond<'GET /api/runs/:src/:slug/reviews'>(c, { reports })
  })

  // The escalation packet (#407): one `state.escalations[i]` entry joined
  // with the report its reason names. The record is read best-effort, as the
  // readiness item is (#49), so a malformed run's open escalation still gets
  // its packet; the reviews come from the same cache the reviews route fills.
  app.get('/api/runs/:src/:slug/escalation/:index', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const index = Number(c.req.param('index'))
    if (!Number.isInteger(index) || index < 0) return fail(c, 400, { error: 'escalation index must be a non-negative integer' })
    const raw = await source.readArtifact(ref, 'state.yaml')
    const escalation = raw === null ? undefined : bestEffortEscalations(raw)[index]
    if (!escalation) return fail(c, 404, { error: `no escalation at index ${index}` })
    const packet = await cache.get(`escalation:${ref.source}:${ref.slug}:${index}`, async () => {
      const [artifacts, reviews, verification] = await Promise.all([
        source.listArtifacts(ref),
        reviewsFor(source, ref),
        source.readArtifact(ref, 'verification-report.md'),
      ])
      return buildEscalationPacket({ index, escalation, artifacts, reviews, verification })
    })
    return respond<'GET /api/runs/:src/:slug/escalation/:index'>(c, packet)
  })

  // Evidence-presence rollup (#165): which criteria the verification record
  // cites, computed from the artifacts. Presence, never verdicts — verdict
  // text in the payload is a verbatim quote from the report.
  app.get('/api/runs/:src/:slug/evidence', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const rollup = await cache.get(`evidence:${ref.source}:${ref.slug}`, async () => {
      const [spec, verification, artifacts] = await Promise.all([
        source.readArtifact(ref, 'spec.md'),
        source.readArtifact(ref, 'verification-report.md'),
        source.listArtifacts(ref),
      ])
      const reviews = await Promise.all(
        artifacts
          .filter((p) => describeArtifact(p).kind === 'review-report')
          .map(async (p) => ({ path: p, content: (await source.readArtifact(ref, p)) ?? '' })),
      )
      return buildEvidenceRollup({ lexicon: buildLexicon({ spec }), verification, reviews })
    })
    return respond<'GET /api/runs/:src/:slug/evidence'>(c, rollup)
  })

  // G1's packet (#255): requirement coverage against the plan's own mapping
  // table, and the surface overlaps between work items no dependency orders.
  // Presence, never verdicts — an uncovered requirement is a statement about
  // the record, not a computed failure, and no plan is scored.
  app.get('/api/runs/:src/:slug/g1', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const packet = await cache.get(`g1:${ref.source}:${ref.slug}`, async () => {
      const [spec, plan, artifacts] = await Promise.all([
        source.readArtifact(ref, 'spec.md'),
        source.readArtifact(ref, 'plan.md'),
        source.listArtifacts(ref),
      ])
      const tasks = await Promise.all(
        artifacts
          .filter((p) => describeArtifact(p).kind === 'work-item')
          .map(async (p) => ({ path: p, content: (await source.readArtifact(ref, p)) ?? '' })),
      )
      return buildG1Packet({ lexicon: buildLexicon({ spec }), plan, tasks })
    })
    return respond<'GET /api/runs/:src/:slug/g1'>(c, packet)
  })

  // G3's packet (#403): the release plan read for what "Ship it?" asks —
  // the rollback facts, CI health, the ordered steps, the audit-time sections.
  // One artifact, one cache entry; the view composes it with the evidence
  // rollup it already has.
  app.get('/api/runs/:src/:slug/g3', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const packet = await cache.get(`g3:${ref.source}:${ref.slug}`, async () =>
      buildReleasePacket({ plan: await source.readArtifact(ref, 'release-plan.md') }),
    )
    return respond<'GET /api/runs/:src/:slug/g3'>(c, packet)
  })

  // The diff, labelled with the contact surface each work item declared (#270).
  // `files` stays the whole diff — the scoping labels it and never filters it —
  // and `surface` is positional against that list. A run with no readable task
  // set still gets its diff, with `surface.withheld` naming why it carries no
  // labels (FRONTEND.md §4.1).
  app.get('/api/runs/:src/:slug/diff', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found
    const { text, tasks } = await cache.get(`diff:${ref.source}:${ref.slug}`, async () => {
      const [text, artifacts] = await Promise.all([source.readDiff(ref), source.listArtifacts(ref)])
      const tasks = await Promise.all(
        artifacts
          .filter((p) => describeArtifact(p).kind === 'work-item')
          .map(async (p) => ({ path: p, content: (await source.readArtifact(ref, p)) ?? '' })),
      )
      return { text, tasks }
    })
    const files = parseUnifiedDiff(text)
    return respond<'GET /api/runs/:src/:slug/diff'>(c, {
      files,
      merged: ref.kind === 'default',
      surface: scopeDiff(files, buildTaskSet(tasks)),
    })
  })

  app.get('/api/metrics', async (c) => {
    const metrics = await cache.get('metrics', () => computeMetrics(deps.sources))
    return respond<'GET /api/metrics'>(c, metrics)
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
      closure?: Closure
      pauseReason?: string
      resumePhase?: Phase
      hold?: boolean
      holdReason?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return fail(c, 400, { error: 'invalid JSON body' })
    }
    if (!body.source || !body.slug || !body.action) return fail(c, 400, { error: 'source, slug, and action are required' })

    const found = await findRun(body.source, body.slug)
    if (!found) return fail(c, 404, { error: 'run not found' })
    const { source, ref } = found

    const who = await source.identity()
    if (!who) return fail(c, 400, { error: 'git user.name/user.email are unset — decisions must be attributable to a named human' })

    const { state, error } = await source.readState(ref)
    if (!state) return fail(c, 409, { error: `run state is malformed: ${error}` })

    // R3 backstop: the UI never renders approve on a bounced packet, but the
    // API refuses too — a malformed packet is not approvable by any client.
    if (body.action === 'approve' && body.gate) {
      const { items } = await deriveReadiness(source, ref)
      const gateItem = items.find((i) => i.kind === 'gate' && i.gate === body.gate)
      // `problems`, not `reviewable`: since #159 a gate is also non-reviewable
      // while its producer is in flight, and that is a surface judgment, not a
      // contract violation. Gatehouse withholds the button; the API still lets
      // a human who means it approve the packet that is on the branch.
      if (gateItem && gateItem.problems.length > 0)
        return fail(c, 422, {
          error: `gate packet is malformed and was bounced: ${gateItem.problems.join('; ')}`,
          problems: gateItem.problems,
        })
    }

    // A patch run arms only with a written work item (#221): the stub the
    // scaffold ships is well-formed and empty, and nothing downstream would
    // notice until an implementer was dispatched against it.
    if (body.action === 'arm') {
      const why = await armRefusal(source, ref, state)
      if (why) return fail(c, 422, { error: why })
    }

    try {
      // source/slug/action were checked above; the rest planDecision validates.
      const planned = planDecision(state, { ...body, action: body.action }, who)
      const result = await source.writeState(ref, planned.mutate, planned.message)
      if (!result.ok) {
        const status = result.reason === 'ref-moved' ? 409 : result.reason === 'dirty-worktree' ? 423 : 400
        // Neither field is required by WriteResult, and `{ error: undefined }`
        // serializes to `{}` — a client then renders "undefined" as the reason.
        return fail(c, status, { error: result.message ?? result.reason ?? 'the write was refused' })
      }
      cache.bump()
      return respond<'POST /api/decisions'>(c, {
        ok: true,
        commit: result.commit,
        summary: planned.summary,
        note: result.message ?? null,
      })
    } catch (e) {
      if (e instanceof DecisionError) return fail(c, 400, { error: e.message })
      throw e
    }
  })

  app.get('/api/runs/:src/:slug/decisions', async (c) => {
    const found = await findRun(c.req.param('src'), c.req.param('slug'))
    if (!found) return fail(c, 404, { error: 'run not found' })
    const records = await cache.get(`decisions:${found.ref.source}:${found.ref.slug}`, () =>
      collectRunDecisions(found.source, found.ref),
    )
    return respond<'GET /api/runs/:src/:slug/decisions'>(c, { decisions: records })
  })

  // SSE: ref movement → one "change" event; clients revalidate their queries.
  app.get('/api/events', (c) => {
    const subscribe = deps.subscribe
    if (!subscribe) return fail(c, 501, { error: 'events unavailable' })
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
