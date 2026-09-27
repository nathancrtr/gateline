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
  ArtifactFormat,
  ArtifactKind,
  ArtifactRef,
  AssumptionPassage,
  BounceFact,
  Burden,
  Closure,
  ClosureRecord,
  CodeTreeCause,
  InboxItem as CoreInboxItem,
  CoverageRow,
  CriterionEvidence,
  DecisionAction,
  DeferralLimit,
  DiffFile,
  Disposition,
  EscalationFact,
  EscalationPacket,
  EvidenceRollup,
  Field,
  FieldCount,
  FieldEntry,
  FieldGroup,
  FieldKind,
  FieldView,
  G0Packet,
  G0Requirement,
  G1Packet,
  GateDecisionRecord,
  GateId,
  GateMetrics,
  HandEdit,
  InboxCollapse,
  LedgerEntry,
  LedgerQuote,
  LedgerTarget,
  LexiconEntry,
  ListEntry,
  Metrics,
  NeedFact,
  PausedFact,
  Phase,
  Profile,
  Quotation,
  QuoteAt,
  QuotedSection,
  ReleasePacket,
  ReleaseStep,
  RepositoryMode,
  ReviewFinding,
  ReviewReport,
  RoundCapFact,
  RunMetricsSummary,
  RunState,
  RunSummary,
  Severity,
  StagedFact,
  StageRefusal,
  StateProblem,
  SurfaceItemRef,
  SurfaceOverlap,
  SurfaceScopedDiff,
  UnreadableRepository,
  Validation,
  Verdict,
  WaitingOn,
  WithheldReason,
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
 *
 * 2 (#424): every packet's withheld reason is a `WithheldReason` — the grammar
 * looked for and the artifact looked in — where it was a sentence string.
 *
 * 3 (#494): per-run routes moved from `/api/runs/<source>/<slug>` to
 * `/api/repos/<repository id>/-/runs/<slug>`, and a source's id is now its
 * repository id (`github.com/acme/billing`, `local/demo`). The old routes do
 * not exist; old web links redirect, old API paths do not.
 */
export const API_VERSION = 3

/** Core types that cross the wire. Re-exported so a client imports one module. */
export type {
  ArtifactFamily,
  ArtifactFormat,
  ArtifactKind,
  ArtifactRef,
  AssumptionPassage,
  BounceFact,
  Burden,
  Closure,
  ClosureRecord,
  CodeTreeCause,
  CoverageRow,
  CriterionEvidence,
  DecisionAction,
  DeferralLimit,
  DiffFile,
  Disposition,
  EscalationFact,
  EscalationPacket,
  EvidenceRollup,
  Field,
  FieldCount,
  FieldEntry,
  FieldGroup,
  FieldKind,
  FieldView,
  G0Packet,
  G0Requirement,
  G1Packet,
  GateDecisionRecord,
  GateId,
  GateMetrics,
  HandEdit,
  InboxCollapse,
  LedgerEntry,
  LedgerQuote,
  LedgerTarget,
  LexiconEntry,
  ListEntry,
  NeedFact,
  PausedFact,
  Phase,
  Profile,
  Quotation,
  QuoteAt,
  QuotedSection,
  ReleasePacket,
  ReleaseStep,
  RepositoryMode,
  ReviewFinding,
  ReviewReport,
  RoundCapFact,
  RunMetricsSummary,
  RunState,
  RunSummary,
  Severity,
  StagedFact,
  StateProblem,
  SurfaceItemRef,
  SurfaceOverlap,
  SurfaceScopedDiff,
  UnreadableRepository,
  Validation,
  Verdict,
  WaitingOn,
  WithheldReason,
  WorkItem,
}

/** The facts #433 added to an inbox item (#411 step 8). */
type InboxFactKey = 'question' | 'waitingOn' | 'superseded' | 'bouncedBy' | 'escalation' | 'paused' | 'staged' | 'roundCap'

/**
 * An inbox item on the wire. The facts are optional here, though core always
 * sends them: during `self-update` a new Gatehouse can be served by a server
 * built before #433, whose items carry only `title` and `detail`. A client
 * reads an absent fact (`undefined`, never `null`) as "this server predates
 * the facts" and falls back to the kept sentences for the one release they
 * are kept (#411 step 8). Not a version bump: the change is additive.
 */
export type InboxItem = Omit<CoreInboxItem, InboxFactKey> & Partial<Pick<CoreInboxItem, InboxFactKey>>

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
  /** Each served repository's id. */
  sources: string[]
  /**
   * Each served repository as an interface names it and what this deployment
   * may do in it (#499), in the order of `sources`. Optional on the wire,
   * though this server always sends it: a server built before #499 omits
   * it, and a client then names a repository by its id and assumes no mode.
   * Additive, so not a version bump.
   */
  repositories?: ServedRepository[]
}

/** One served repository, on `/api/health`. */
export interface ServedRepository {
  /** The repository id (docs/MULTI-REPO.md §6). */
  id: string
  /** The display name (§6.2): presentation only. */
  name: string
  /**
   * The mode this process gives it (§7.3): what the server enforces, so a
   * `dispatch` entry served by `ui` reads `decide`. Null when the source
   * states none, which the server treats as unrestricted and which the
   * liveness table reads as it read every repository before modes: a
   * heartbeat's presence is the expectation of an engine.
   */
  mode: RepositoryMode | null
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
  /**
   * The governor limit that held it (#513), when the governor did. Absent
   * from older engines. A value outside `DeferralLimit` is a newer engine's,
   * passed on as written. Additive, so not a version bump.
   */
  limit?: DeferralLimit | (string & {})
  /** The repository the deferral belongs to, as the governor keys it (#513). Additive. */
  repository?: string
}

export interface EngineHealthResponse {
  /**
   * Per source id; null = no heartbeat has been written in that repository.
   * Whether that is an outage depends on the repository's mode, on
   * `/api/health` (docs/MULTI-REPO.md §9.5): it is one only where an engine
   * is expected, in a `dispatch` repository.
   */
  engines: Record<string, EngineHealthEntry | null>
  now: number
}

/**
 * The repositories a cross-repository view left out because reading them
 * failed (docs/MULTI-REPO.md §10, #496), each with its id, display name and a
 * one-line error. Every other repository's rows are in the response. Empty
 * when all were read; when none could be, the rows are empty and this names
 * every one, and the status is still 200.
 *
 * Optional on the wire, though this server always sends it: a server built
 * before #496 omits it, and a client reads its absence as "nothing was left
 * out". Additive, so not a version bump.
 */
type Unreadable = { unreadable?: UnreadableRepository[] }

export interface InboxResponse extends Unreadable {
  /** Every item, oldest first. Collapsing never removes one from this list. */
  items: InboxItem[]
  /**
   * The repositories whose `malformed` items a client shows as one row
   * (docs/MULTI-REPO.md §9.3, #499): core's `inboxCollapses` over `items`.
   * The rule is core's; the row's sentence is the client's. Optional on the
   * wire, though this server always sends it: a client reads its absence (a
   * server built before #499) as nothing collapsing. Additive, so not a
   * version bump.
   */
  collapsed?: InboxCollapse[]
  now: number
}

export interface RunsResponse extends Unreadable {
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
   * rendered verbatim. Joined to the state the commit wrote (#426): a
   * decision's `notes`, a closure's `reason`, an escalation's `escalatedBy` /
   * `escalatedAbout`, an engine row's `target` — facts, which History composes.
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
  /** The bytes, verbatim. Every view below is beside them, never instead of them. */
  content: string
  validation: Validation
  /**
   * The typed view of a YAML artifact (#434): a work item over its
   * contract's keys, `state.yaml` as the run's ledger. Null for every other
   * kind. Added here rather than on a route of its own because the reader
   * already fetches this response for the bytes the view sits beside, and
   * "show bytes" must show exactly the bytes the view was read from.
   * Optional: an older server omits it, and the reader then shows the bytes.
   */
  fields?: FieldView | null
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
   * set — the grammar looked for and the work item looked in (#424) — and the
   * view then renders the plain diff under a withheld notice composed from it.
   */
  surface: SurfaceScopedDiff
}

/**
 * `GET /api/metrics` serves core's `Metrics` verbatim. Aliased rather than
 * restated: the previous hand-written client copy dropped `readyAt` and
 * `notes` from each decision and nothing noticed.
 */
export type MetricsResponse = Omit<Metrics, 'unreadable'> & Unreadable

/**
 * One thing a `change` event on `GET /api/events` says moved (#496).
 *
 * `source` is a repository id. `slug` names the run whose refs moved (its run
 * branch, locally or on a remote), or is null when the change is to the
 * repository as a whole: its default branch moved, which every run's views
 * read (diffs, contract templates, whether a run has landed), or a run's refs
 * could not be told apart this time. A client refreshes a named run's views
 * for a run change, and every view of the repository for a null one. Views
 * across repositories (inbox, runs, metrics) are refreshed for any change.
 */
export interface RefChange {
  source: string
  slug: string | null
}

/**
 * The data of one `change` event: everything the server saw move since the
 * last event, coalesced. A repository appears either once with a null slug or
 * once per run that moved, never both, and the list is ordered as the
 * repositories are served, then by slug. Before #496 the data was `{}`; a
 * client that cannot read this shape refreshes everything.
 */
export interface ChangeEvent {
  changes: RefChange[]
}

export interface StagingSourceConfig {
  id: string
  /**
   * The display name (§6.2) and the mode (§7.3), so the form can name the
   * repository and leave out one it cannot stage into (#499): a `view`
   * repository refuses the write with a 403. Optional on the wire, though
   * this server always sends both; an older server's entries are named by
   * id and offered as before. Additive, so not a version bump.
   */
  name?: string
  mode?: RepositoryMode | null
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
 * rather than restating them. If core ever adds a refusal reason, it widens
 * here automatically instead of arriving as a value the wire type says is
 * impossible — as `view-mode` did (MULTI-REPO.md §7.3, answered with a 403).
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
 * `GET /api/events` is Server-Sent Events, not JSON, so it has no entry; its
 * `change` event's data is a `ChangeEvent`.
 *
 * `:id` is a repository id and spans segments (`github.com/acme/billing`, or
 * deeper for a nested GitLab group); the route registers it as `:id{.+}`, and
 * the `-` segment after it is where it ends, since no id segment may be `-`
 * (docs/MULTI-REPO.md §6.4). Each segment of the id and the slug travel
 * percent-encoded.
 */
export interface ApiRoutes {
  'GET /api/health': { response: HealthResponse }
  'GET /api/engine-health': { response: EngineHealthResponse }
  'GET /api/inbox': { response: InboxResponse }
  'GET /api/runs': { response: RunsResponse }
  'GET /api/staging': { response: StagingConfigResponse }
  'POST /api/runs': { request: StageRequest; response: StageResponse }
  'GET /api/repos/:id/-/runs/:slug': { response: RunDetailResponse }
  'GET /api/repos/:id/-/runs/:slug/artifact': { response: ArtifactResponse }
  'GET /api/repos/:id/-/runs/:slug/lexicon': { response: LexiconResponse }
  'GET /api/repos/:id/-/runs/:slug/reviews': { response: ReviewsResponse }
  'GET /api/repos/:id/-/runs/:slug/evidence': { response: EvidenceRollup }
  'GET /api/repos/:id/-/runs/:slug/g0': { response: G0Packet }
  'GET /api/repos/:id/-/runs/:slug/g1': { response: G1Packet }
  'GET /api/repos/:id/-/runs/:slug/g3': { response: ReleasePacket }
  'GET /api/repos/:id/-/runs/:slug/escalation/:index': { response: EscalationPacket }
  'GET /api/repos/:id/-/runs/:slug/diff': { response: DiffResponse }
  'GET /api/repos/:id/-/runs/:slug/decisions': { response: DecisionsResponse }
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
