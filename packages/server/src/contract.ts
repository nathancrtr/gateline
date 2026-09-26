/**
 * The HTTP contract between the server and any client of it — Gatehouse
 * today, anything else later (#317).
 *
 * Before this module the seam was thirty borrowed names: `web/src/api.ts`
 * type-imported core's view-model types and hand-declared its own response
 * interfaces, while every handler returned `c.json(<whatever it assembled>)`
 * with nothing checking one against the other. They agreed by convention, and
 * had already drifted — the client's metrics type omitted `readyAt` and
 * `notes`, two fields the server has always sent.
 *
 * Three rules keep this file honest:
 *
 * 1. **It is the server's, because the server owns its own wire shape.** The
 *    alternative — declaring it in `core/view-model` — was rejected: core
 *    describes derivations, not transport, and a route map in it would make
 *    every client of core a client of the HTTP API. The server legitimately
 *    depends on the view-model layer (it serializes 15 view-model symbols),
 *    so it can name these types without reaching anywhere it does not already.
 * 2. **Types only, and browser-safe.** Everything imported from core is
 *    `import type`, which erases at build. `API_VERSION` is the one value, and
 *    it is a number. Nothing here may import Hono, node builtins, or any core
 *    *value* — `web/test/boundary.test.ts` and the post-build bundle check
 *    both enforce that from the other side.
 * 3. **A response type is what the handler must produce.** `respond()` in
 *    `app.ts` is generic over the route key, so a handler whose body drifts
 *    from the declaration fails `npm run typecheck` on the server, rather than
 *    in someone's browser.
 */
import type {
  ArtifactFamily,
  ArtifactKind,
  ArtifactRef,
  Burden,
  Closure,
  ClosureRecord,
  CodeTreeCause,
  CoverageRow,
  CriterionEvidence,
  DecisionAction,
  DiffFile,
  Disposition,
  EscalationPacket,
  EvidenceRollup,
  G1Packet,
  GateDecisionRecord,
  GateId,
  GateMetrics,
  InboxItem,
  LedgerEntry,
  LexiconEntry,
  Metrics,
  Phase,
  Profile,
  ReleasePacket,
  ReleaseStep,
  ReviewFinding,
  ReviewReport,
  RunMetricsSummary,
  RunState,
  RunSummary,
  Severity,
  StageRefusal,
  SurfaceItemRef,
  SurfaceOverlap,
  SurfaceScopedDiff,
  Validation,
  Verdict,
  WorkItem,
} from '@gateline/core'

/**
 * The wire format's version, served on `GET /api/health`.
 *
 * Bump it when a change to this file would break a client compiled against the
 * previous one: a removed or renamed field, a narrowed type, a route that
 * stops existing. Adding an optional field is not a bump — clients ignore what
 * they do not read. A single-origin deployment serves the SPA that was built
 * with it, so this is not a compatibility negotiation; it is how a client that
 * arrives from somewhere else (a cached tab, a separately released Gatehouse)
 * can say so instead of failing in pieces.
 */
export const API_VERSION = 1

/** Core types that cross the wire. Re-exported so a client imports one module. */
export type {
  ArtifactFamily,
  ArtifactKind,
  ArtifactRef,
  Burden,
  Closure,
  ClosureRecord,
  CodeTreeCause,
  CoverageRow,
  CriterionEvidence,
  DecisionAction,
  DiffFile,
  Disposition,
  EscalationPacket,
  EvidenceRollup,
  G1Packet,
  GateDecisionRecord,
  GateId,
  GateMetrics,
  InboxItem,
  LedgerEntry,
  LexiconEntry,
  Phase,
  Profile,
  ReleasePacket,
  ReleaseStep,
  ReviewFinding,
  ReviewReport,
  RunMetricsSummary,
  RunState,
  RunSummary,
  Severity,
  SurfaceItemRef,
  SurfaceOverlap,
  SurfaceScopedDiff,
  Validation,
  Verdict,
  WorkItem,
}

/**
 * Every error response, at every status. `error` is the human-readable reason;
 * the optional members carry the machine-readable detail a specific route adds
 * (R3's bounce reasons on a malformed gate packet, for one).
 */
export interface ApiErrorBody {
  error: string
  /** Contract breaches that made a gate packet unreviewable (R3). */
  problems?: string[]
}

export interface HealthResponse {
  ok: true
  /** @see API_VERSION */
  apiVersion: number
  sources: string[]
}

export interface EngineHealthEntry {
  at: string
  inFlight: number
  pushRejections: Record<string, number>
  stale: boolean
  /** Self-supersede (#141) drift fields — absent on pre-#141 engines. */
  commit?: string
  codeHead?: string
  codeState?: 'fresh' | 'superseded-pending' | 'paused'
  /** The monitor's specific cause, present only while paused (and only from engines new enough to report it). */
  codeReason?: string
  /** The cause as a discriminant (#222): `dirty` is the ordinary, self-inflicted family; the rest are topology violations. Absent on older engines. */
  codeCause?: CodeTreeCause
  /** True while a dirty tree is also holding back a fast-forward the engine would restart onto (#222). */
  codeUpgradeBlocked?: boolean
  /** Runs the engine is holding back without pausing them, and why (#97) — empty from engines too old to report it. */
  deferrals?: EngineDeferral[]
}

/** One held-back run on the heartbeat (#97): a self-clearing ceiling's own words, at the host level. */
export interface EngineDeferral {
  slug: string
  rule: string
  reason: string
  /** ISO timestamp of the first pass that deferred this run for this rule. */
  since: string
}

export interface EngineHealthResponse {
  /** Per source id; null = no co-located engine has ever reported here (viewer-only install, not an outage). */
  engines: Record<string, EngineHealthEntry | null>
  now: number
}

export interface InboxResponse {
  items: InboxItem[]
  now: number
}

export interface RunsResponse {
  runs: RunSummary[]
  now: number
}

export interface HistoryEntry {
  oid: string
  time: number
  author: string
  subject: string
  phase: string | null
  /**
   * The subject read as a ledger entry (#268), parsed in core on the server —
   * the browser takes types from core but never values.
   * `kind: 'other'` means the subject matched no known grammar and must be
   * rendered verbatim.
   */
  ledger: LedgerEntry
}

export interface RunDetailResponse {
  summary: RunSummary
  items: InboxItem[]
  state: RunState | null
  stateError: string | null
  stateRaw: string | null
  validations: Record<string, Validation>
  /**
   * The run's artifact paths. Kept for one release beside `artifactRefs`
   * (docs/SEAM.md §8.5) so the change is additive; new code reads the refs.
   */
  artifacts: string[]
  /**
   * The same artifacts as references (#415), in the same order: kind, id,
   * contract, and — for a review report — the task it reviews, read from the
   * report on the server so the rail names it from the first render.
   */
  artifactRefs: ArtifactRef[]
  history: HistoryEntry[]
  /**
   * The run branch's page on the git host (#267), derived on the server from
   * `remote.origin.url` plus the run's branch. Null whenever no such page can
   * be named without guessing — a local-only source, no origin, a non-GitHub
   * remote, or a merged run whose branch is gone — and the page then keeps its
   * own view rather than offering a dead link (FRONTEND.md §4.1).
   */
  branchUrl: string | null
  now: number
}

export interface ArtifactResponse {
  path: string
  content: string
  validation: Validation
}

export interface LexiconResponse {
  /** Definitions in document order; duplicate ids (amended ADRs) all present. */
  entries: LexiconEntry[]
  /** The id-reference grammar as a regex source (core's ID_PATTERN, arriving as data). */
  pattern: string
}

/** Typed review reports for a run (#214), keyed by artifact path. */
export interface ReviewsResponse {
  reports: ReviewReport[]
}

/** Gate decision records for one run (#268 AC1) — approver, burden and notes. */
export interface DecisionsResponse {
  decisions: GateDecisionRecord[]
}

export interface DiffResponse {
  /** The whole diff, in git's order. Scoping labels this list; it never filters it. */
  files: DiffFile[]
  merged: boolean
  /**
   * Which work item declared each changed file (#270), positional against
   * `files`. `surface.withheld` is non-null when the run has no readable task
   * set, and the view then renders the plain diff with that reason.
   */
  surface: SurfaceScopedDiff
}

/**
 * `GET /api/metrics` serves core's `Metrics` verbatim. Aliased rather than
 * restated: the previous hand-written client copy dropped `readyAt` and
 * `notes` from each decision and nothing noticed.
 */
export type MetricsResponse = Metrics

export interface StagingSourceConfig {
  id: string
  identity: { name: string; email: string } | null
  briefSections: string[]
  briefTemplate: string | null
}

export interface StagingConfigResponse {
  sources: StagingSourceConfig[]
  slugPattern: string
}

export interface StageRequest {
  source?: string
  slug: string
  title: string
  profile: Profile
  briefMarkdown: string
  costLimitUsd: number | null
  intake: { source: string | null; ref: string | null; url: string | null; clientKey: string | null }
}

/**
 * Why a staging request was refused (R8) — the taxonomy the form renders.
 *
 * Defined as core's `StageRefusal` plus the two the route decides for itself,
 * rather than restating all five. If core ever adds a refusal reason, it widens
 * here automatically instead of arriving as a value the wire type says is
 * impossible.
 */
export type StageRefusalReason = StageRefusal | 'missing-sections' | 'invalid-input'

/**
 * The wire form of a staging outcome. Refusals are values with a status code,
 * never thrown errors, so the form can render the taxonomy instead of a
 * generic toast (ux A5). The client adds the HTTP status to this shape.
 */
export type StageResponse =
  | { outcome: 'created'; slug: string; branch: string; commit: string; pushFailed?: string }
  | { outcome: 'exists'; slug: string; branch: string }
  | { outcome: 'refused'; reason: StageRefusalReason; message: string; missing?: string[] }

export interface DecisionRequest {
  source: string
  slug: string
  action: DecisionAction
  gate?: GateId
  notes?: string
  burden?: Burden
  escalationIndex?: number
  disposition?: Disposition
  closure?: Closure
  pauseReason?: string
  resumePhase?: Phase
  /** resume: a new budget.cost_limit_usd, required from a budget-exhausted pause (#96). */
  costLimitUsd?: number
  hold?: boolean
  holdReason?: string
}

export interface DecisionResponse {
  ok: true
  /**
   * The commit the decision landed as. Optional because `WriteResult` does not
   * guarantee it — `ok` and `commit` are independent fields there rather than a
   * discriminated union, so a successful write is not typed as one that
   * committed. Narrowing that is core's to do (it would touch every writer);
   * until then the wire says what the server can actually promise.
   */
  commit?: string
  summary: string
  /** A note from the write path — e.g. a push that did not reach origin. */
  note: string | null
}

/* --- The machine surfaces. Config-gated: absent their deps, they never mount. --- */

export interface WebhookResponse {
  ok: true
  detail: string
}

export interface RunnerIntentsResponse {
  intents: unknown[]
  /** Where the runner should clone from; null when unconfigured — the agent's `--repo-url` is the documented fallback. */
  repoUrl: string | null
}

export type RunnerClaimResponse = { claimed: true } | { claimed: false; reason: string }

export interface RunnerReportResponse {
  resolved: boolean
}

/**
 * Route key → the request body it accepts and the success body it returns.
 *
 * Keys are `METHOD /path` with Hono's parameter syntax, so a route that is
 * renamed or removed breaks every reference to it at compile time. Error
 * responses are `ApiErrorBody` at every route and are not restated per entry.
 * `GET /api/events` is Server-Sent Events, not JSON, so it has no entry.
 */
export interface ApiRoutes {
  'GET /api/health': { response: HealthResponse }
  'GET /api/engine-health': { response: EngineHealthResponse }
  'GET /api/inbox': { response: InboxResponse }
  'GET /api/runs': { response: RunsResponse }
  'GET /api/staging': { response: StagingConfigResponse }
  'POST /api/runs': { request: StageRequest; response: StageResponse }
  'GET /api/runs/:src/:slug': { response: RunDetailResponse }
  'GET /api/runs/:src/:slug/artifact': { response: ArtifactResponse }
  'GET /api/runs/:src/:slug/lexicon': { response: LexiconResponse }
  'GET /api/runs/:src/:slug/reviews': { response: ReviewsResponse }
  'GET /api/runs/:src/:slug/evidence': { response: EvidenceRollup }
  'GET /api/runs/:src/:slug/g1': { response: G1Packet }
  'GET /api/runs/:src/:slug/g3': { response: ReleasePacket }
  'GET /api/runs/:src/:slug/escalation/:index': { response: EscalationPacket }
  'GET /api/runs/:src/:slug/diff': { response: DiffResponse }
  'GET /api/runs/:src/:slug/decisions': { response: DecisionsResponse }
  'GET /api/metrics': { response: MetricsResponse }
  'POST /api/decisions': { request: DecisionRequest; response: DecisionResponse }
  'POST /api/webhooks/github': { response: WebhookResponse }
  'GET /api/runner/intents': { response: RunnerIntentsResponse }
  'POST /api/runner/claim': { request: { key: string }; response: RunnerClaimResponse }
  'POST /api/runner/report': { request: { key: string; outcome: unknown }; response: RunnerReportResponse }
}

export type ApiRoute = keyof ApiRoutes

export type ResponseOf<K extends ApiRoute> = ApiRoutes[K]['response']

export type RequestOf<K extends ApiRoute> = ApiRoutes[K] extends { request: infer R } ? R : never
