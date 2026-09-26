// API client. Every wire type comes from ONE place: @gateline/server/contract,
// the server's own declaration of what it accepts and returns (#317). This
// file used to hand-declare those shapes beside a type-only import of core,
// and the two agreed only by convention — the metrics type had already drifted,
// omitting two fields the server sends.
//
// The import stays type-only apart from API_VERSION, because core's runtime
// touches node:child_process and must never enter the browser bundle. The
// contract module is types plus that one number, so it erases to almost
// nothing.
//
// EXCEPTION (ADR-6, genesis-preview candidate): pages/new-run.tsx value-imports
// planRunScaffold from '@gateline/core/record' for its live commit preview —
// the record layer is probed browser-safe (yaml + zod only, no node builtins,
// core/test/layering.test.ts enforces the ceiling). `web/test/boundary.test.ts`
// holds the enumerated list of files allowed to do that, and the post-build
// bundle check proves no node builtin reached the output either way.

import type {
  ApiErrorBody,
  ArtifactResponse,
  Closure,
  DecisionRequest,
  DecisionResponse,
  DecisionsResponse,
  DiffResponse,
  EngineHealthResponse,
  EscalationPacket,
  EvidenceRollup,
  G0Packet,
  G1Packet,
  GateId,
  HealthResponse,
  InboxResponse,
  LexiconResponse,
  MetricsResponse,
  Phase,
  Profile,
  ReleasePacket,
  ReviewsResponse,
  RunDetailResponse,
  RunsResponse,
  StageRequest,
  StageResponse,
  StagingConfigResponse,
} from '@gateline/server/contract'
import { API_VERSION } from '@gateline/server/contract'

/**
 * The wire vocabulary, re-exported so the rest of web imports one module —
 * `../api` — rather than reaching across the workspace itself.
 */
export type {
  ApiErrorBody,
  ArtifactFamily,
  ArtifactFormat,
  ArtifactKind,
  ArtifactRef,
  ArtifactResponse,
  AssumptionPassage,
  BounceFact,
  Burden,
  Closure,
  ClosureRecord,
  CoverageRow,
  CriterionEvidence,
  DecisionAction,
  DecisionRequest,
  DecisionResponse,
  DecisionsResponse,
  DiffFile,
  DiffResponse,
  Disposition,
  EngineHealthEntry,
  EngineHealthResponse,
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
  HealthResponse,
  HistoryEntry,
  InboxItem,
  InboxResponse,
  LedgerEntry,
  LedgerQuote,
  LedgerTarget,
  LexiconEntry,
  LexiconResponse,
  ListEntry,
  MetricsResponse,
  PausedFact,
  Phase,
  Profile,
  Quotation,
  QuoteAt,
  QuotedSection,
  ReleasePacket,
  ReleaseStep,
  ReviewFinding,
  ReviewReport,
  ReviewsResponse,
  RoundCapFact,
  RunDetailResponse,
  RunMetricsSummary,
  RunState,
  RunSummary,
  RunsResponse,
  Severity,
  StagedFact,
  StageRefusalReason,
  StageRequest,
  StageResponse,
  StagingConfigResponse,
  StagingSourceConfig,
  StateProblem,
  SurfaceItemRef,
  SurfaceOverlap,
  SurfaceScopedDiff,
  Validation,
  Verdict,
  WaitingOn,
  WithheldReason,
  WorkItem,
} from '@gateline/server/contract'
export { API_VERSION }

/**
 * Mirrors of core's closed vocabulary (DESIGN.md §4.1, §4.2) — a value import
 * from core would pull the node runtime into the browser bundle.
 *
 * These are four fixed tables, not defaults: #249 closed the gate set, the
 * profile set, and what each gate asks, so a display layer is entitled to read
 * position off them. `packages/web/test/spine.test.ts` value-imports the core
 * originals and fails if any mirror drifts.
 */
export const PROFILE_GATES: Record<Profile, GateId[]> = {
  patch: ['G1', 'G2'],
  standard: ['G0', 'G1', 'G2'],
  full: ['G0', 'G1', 'G2', 'G3'],
}

/** Which phases a run of each profile passes through — the spine's sequence (#254). */
export const PROFILE_PHASES: Record<Profile, Phase[]> = {
  patch: ['plan', 'implement', 'integrate', 'done', 'paused', 'closed'],
  standard: ['spec', 'plan', 'implement', 'integrate', 'done', 'paused', 'closed'],
  full: ['spec', 'plan', 'implement', 'integrate', 'release', 'done', 'paused', 'closed'],
}

/** The phases in which each gate's decision is on the table. */
export const GATE_PHASES: Record<GateId, Phase[]> = {
  G0: ['spec'],
  G1: ['plan'],
  G2: ['implement', 'integrate'],
  G3: ['release'],
}

/** What each gate asks — the one thing `G2` alone cannot tell a newcomer. */
export const GATE_QUESTIONS: Record<GateId, string> = {
  G0: 'Is this what we actually want built?',
  G1: 'Is this how we’d want it built, cut into safe parallel pieces?',
  G2: 'Does the evidence support merging?',
  G3: 'Ship it?',
}

/** In a patch run G1 absorbs the G0 question — brief and work item are approved together. */
export const PATCH_G1_QUESTION = 'Is this the change we want, scoped this way?'

/** Why a run was closed short of `done` (#200) — mirror of core's CLOSURES. */
export const CLOSURES: Closure[] = ['already-delivered', 'superseded', 'obsolete', 'abandoned']

/** What each disposition asserts — mirror of core's CLOSURE_MEANINGS. */
export const CLOSURE_MEANINGS: Record<Closure, string> = {
  'already-delivered': 'the work shipped by another path; this record closes to match reality',
  superseded: 'later work overtook it; nothing here is wanted anymore',
  obsolete: 'the need itself went away',
  abandoned: 'a deliberate walk-away mid-flight',
}

/**
 * The five-way submission outcome taxonomy (R8, ux REC7) — refusals resolve as
 * values here, never as thrown errors, so the form renders the taxonomy instead
 * of a generic toast (ux A5).
 *
 * This is `StageResponse` (the wire union) plus the HTTP status the client
 * observed. The taxonomy itself is the server's; only `status` is added here.
 */
export type StageOutcomeView =
  | Extract<StageResponse, { outcome: 'created' }>
  | Extract<StageResponse, { outcome: 'exists' }>
  | (Extract<StageResponse, { outcome: 'refused' }> & { status: number })

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
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null
    throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  /** Liveness plus the server's wire version — compare against API_VERSION. */
  health: () => getJson<HealthResponse>('/api/health'),
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
    // Partial<> because this is untrusted input at runtime: the checks below
    // are what promote it to the declared union.
    const body = (await res.json().catch(() => null)) as
      | (Partial<Extract<StageResponse, { outcome: 'created' }>> &
          Partial<Extract<StageResponse, { outcome: 'refused' }>> &
          Partial<ApiErrorBody> & { outcome?: StageResponse['outcome'] })
      | null
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
  g0: (src: string, slug: string) => getJson<G0Packet>(`/api/runs/${src}/${slug}/g0`),
  g1: (src: string, slug: string) => getJson<G1Packet>(`/api/runs/${src}/${slug}/g1`),
  g3: (src: string, slug: string) => getJson<ReleasePacket>(`/api/runs/${src}/${slug}/g3`),
  escalation: (src: string, slug: string, index: number) =>
    getJson<EscalationPacket>(`/api/runs/${src}/${slug}/escalation/${index}`),
  reviews: (src: string, slug: string) => getJson<ReviewsResponse>(`/api/runs/${src}/${slug}/reviews`),
  decisions: (src: string, slug: string) => getJson<DecisionsResponse>(`/api/runs/${src}/${slug}/decisions`),
  diff: (src: string, slug: string) => getJson<DiffResponse>(`/api/runs/${src}/${slug}/diff`),
  metrics: () => getJson<MetricsResponse>('/api/metrics'),
  decide: async (req: DecisionRequest): Promise<DecisionResponse> => {
    const res = await fetch('/api/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    const body = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null
    if (!res.ok) throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`, res.status)
    return body as unknown as DecisionResponse
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
