// API client. Types come from @agentic/core as TYPE-ONLY imports — the core
// runtime touches node:child_process and must never enter the browser bundle.
import type {
  Burden,
  DecisionAction,
  DiffFile,
  GateId,
  GateMetrics,
  InboxItem,
  Phase,
  RunMetricsSummary,
  RunState,
  RunSummary,
  Validation,
} from '@agentic/core'

export type { Burden, DiffFile, GateId, InboxItem, RunState, RunSummary, Validation }

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
  now: number
}

export interface ArtifactResponse {
  path: string
  content: string
  validation: Validation
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

export interface DecisionRequest {
  source: string
  slug: string
  action: DecisionAction
  gate?: GateId
  notes?: string
  burden?: Burden
  escalationIndex?: number
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
  run: (src: string, slug: string) => getJson<RunDetailResponse>(`/api/runs/${src}/${slug}`),
  artifact: (src: string, slug: string, path: string) =>
    getJson<ArtifactResponse>(`/api/runs/${src}/${slug}/artifact?path=${encodeURIComponent(path)}`),
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
