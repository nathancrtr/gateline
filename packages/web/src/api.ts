// API client. Types come from @gateline/core as TYPE-ONLY imports — the core
// runtime touches node:child_process and must never enter the browser bundle.
// EXCEPTION (ADR-6, genesis-preview candidate): pages/new-run.tsx value-imports
// planRunScaffold from '@gateline/core/record' for its live commit preview —
// the record layer is probed browser-safe (yaml + zod only, no node builtins,
// core/test/layering.test.ts enforces the ceiling). This file itself stays
// type-only; the exception is scoped to that one subpath and that one page.
import type {
  Burden,
  DecisionAction,
  Disposition,
  DiffFile,
  GateId,
  GateMetrics,
  InboxItem,
  CriterionEvidence,
  EvidenceRollup,
  LexiconEntry,
  Phase,
  GateDecisionRecord,
  LedgerEntry,
  Profile,
  RunMetricsSummary,
  RunState,
  ReviewFinding,
  ReviewReport,
  RunSummary,
  Severity,
  Validation,
  Verdict,
} from '@gateline/core'

export type {
  Burden,
  CriterionEvidence,
  DiffFile,
  Disposition,
  EvidenceRollup,
  GateDecisionRecord,
  GateId,
  InboxItem,
  LedgerEntry,
  LexiconEntry,
  Profile,
  ReviewFinding,
  ReviewReport,
  RunState,
  RunSummary,
  Severity,
  Validation,
  Verdict,
}

/** Mirror of core's PROFILE_GATES (DESIGN.md §4.1) — a value import from core would pull the node runtime into the browser bundle. */
export const PROFILE_GATES: Record<Profile, GateId[]> = {
  patch: ['G1', 'G2'],
  standard: ['G0', 'G1', 'G2'],
  full: ['G0', 'G1', 'G2', 'G3'],
}

/** Typed review reports for a run (#214), keyed by artifact path. */
export interface ReviewsResponse {
  reports: ReviewReport[]
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
   * the browser takes types from core but never values (see PROFILE_GATES).
   * `kind: 'other'` means the subject matched no known grammar and must be
   * rendered verbatim.
   */
  ledger: LedgerEntry
}

/** Gate decision records for one run (#268 AC1) — approver, burden and notes. */
export interface DecisionsResponse {
  decisions: GateDecisionRecord[]
}

export interface RunDetailResponse {
  summary: RunSummary
  items: InboxItem[]
  state: RunState | null
  stateError: string | null
  stateRaw: string | null
  validations: Record<string, Validation>
  artifacts: string[]
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

export interface DiffResponse {
  files: DiffFile[]
  merged: boolean
}

export interface MetricsResponse {
  perGate: GateMetrics[]
  runs: RunMetricsSummary[]
  decisions: {
    source: string
    slug: string
    gate: GateId
    approved: boolean
    by: string | null
    decidedAt: number
    latencySeconds: number | null
    burden: Burden | null
  }[]
}

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

/** The five-way submission outcome taxonomy (R8, ux REC7) — refusals resolve
 * as values here, never as thrown errors, so the form renders the taxonomy
 * instead of a generic toast (ux A5). */
export type StageOutcomeView =
  | { outcome: 'created'; slug: string; branch: string; commit: string; pushFailed?: string }
  | { outcome: 'exists'; slug: string; branch: string }
  | {
      outcome: 'refused'
      reason: 'slug-taken' | 'conflict' | 'no-identity' | 'missing-sections' | 'invalid-input'
      message: string
      missing?: string[]
      status: number
    }

export interface DecisionRequest {
  source: string
  slug: string
  action: DecisionAction
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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  return res.json() as Promise<T>
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
}

export interface EngineHealthResponse {
  /** Per source id; null = no co-located engine has ever reported here (viewer-only install, not an outage). */
  engines: Record<string, EngineHealthEntry | null>
  now: number
}

export const api = {
  inbox: () => getJson<InboxResponse>('/api/inbox'),
  engineHealth: () => getJson<EngineHealthResponse>('/api/engine-health'),
  runs: () => getJson<RunsResponse>('/api/runs'),
  stagingConfig: () => getJson<StagingConfigResponse>('/api/staging'),
  /** Refusals (`outcome: 'refused'`) resolve as a value, carrying the HTTP
   * status alongside the server's reason/message/missing — only a network
   * failure or an unparseable/unrecognized body throws ApiError. */
  stage: async (req: StageRequest): Promise<StageOutcomeView> => {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const body = (await res.json().catch(() => null)) as {
      outcome?: 'created' | 'exists' | 'refused'
      slug?: string
      branch?: string
      commit?: string
      pushFailed?: string
      reason?: 'slug-taken' | 'conflict' | 'no-identity' | 'missing-sections' | 'invalid-input'
      message?: string
      missing?: string[]
      error?: string
    } | null
    if (body === null) throw new ApiError(`${res.status} ${res.statusText}`, res.status)
    if (body.outcome === 'created' && body.slug && body.branch && body.commit)
      return { outcome: 'created', slug: body.slug, branch: body.branch, commit: body.commit, pushFailed: body.pushFailed }
    if (body.outcome === 'exists' && body.slug && body.branch) return { outcome: 'exists', slug: body.slug, branch: body.branch }
    if (body.outcome === 'refused' && body.reason && body.message)
      return { outcome: 'refused', reason: body.reason, message: body.message, missing: body.missing, status: res.status }
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status)
  },
  run: (src: string, slug: string) => getJson<RunDetailResponse>(`/api/runs/${src}/${slug}`),
  artifact: (src: string, slug: string, path: string) =>
    getJson<ArtifactResponse>(`/api/runs/${src}/${slug}/artifact?path=${encodeURIComponent(path)}`),
  lexicon: (src: string, slug: string) => getJson<LexiconResponse>(`/api/runs/${src}/${slug}/lexicon`),
  evidence: (src: string, slug: string) => getJson<EvidenceRollup>(`/api/runs/${src}/${slug}/evidence`),
  reviews: (src: string, slug: string) => getJson<ReviewsResponse>(`/api/runs/${src}/${slug}/reviews`),
  decisions: (src: string, slug: string) => getJson<DecisionsResponse>(`/api/runs/${src}/${slug}/decisions`),
  diff: (src: string, slug: string) => getJson<DiffResponse>(`/api/runs/${src}/${slug}/diff`),
  metrics: () => getJson<MetricsResponse>('/api/metrics'),
  decide: async (req: DecisionRequest): Promise<{ ok: boolean; commit?: string; summary?: string; note?: string | null }> => {
    const res = await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
    return body as { ok: boolean; commit?: string; summary?: string; note?: string | null }
  },
}

/** Compact age like "3d", "5h", "12m"; em dash when unknown. */
export function formatAge(since: number | null, now: number): string {
  if (since === null) return '—'
  const s = Math.max(0, now - since)
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`
  if (s < 86_400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86_400)}d`
}

export function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
