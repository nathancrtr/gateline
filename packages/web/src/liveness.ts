// Liveness by mode (#499; docs/MULTI-REPO.md §9.5), computed.
//
// Whether an engine is expected in a repository comes from the repository's
// mode, not from whether a heartbeat file happens to be there. The server
// supplies the two facts separately — the mode on `/api/health`, the
// heartbeat on `/api/engine-health` — and this file applies the table:
//
// | mode              | heartbeat        | shown                                                    |
// |-------------------|------------------|----------------------------------------------------------|
// | dispatch          | fresh            | nothing; the engine is live                              |
// | dispatch          | stale or absent  | the outage banner, naming the repository                 |
// | view or decide    | absent           | "No engine in this deployment", a plain fact             |
// | view or decide    | fresh            | "An engine outside this deployment, last seen" and when  |
// | view or decide    | stale            | "No engine in this deployment"; no banner                |
//
// A repository whose mode the server does not state (a server built before
// #499, or a source that states none) is read as every repository was before
// modes: a heartbeat's presence is the expectation, so only a stale one is an
// outage, and nothing is said otherwise.
//
// Pure functions only. The markup is in `app.tsx` and `components/scope.tsx`.

import type { EngineHealthEntry, EngineHealthResponse, RepositoryMode } from './api.ts'

/**
 * What Gatehouse shows about a repository's engine:
 * - `live`: an expected engine is reporting. Nothing is shown.
 * - `silent`: an expected engine is not reporting. The outage banner.
 * - `none`: no engine is expected and none is reporting. A plain fact.
 * - `outside`: no engine is expected here, and one is reporting — an engine
 *   some other process runs over this clone. A plain fact, with its last
 *   heartbeat.
 * - `unknown`: the mode is not stated and no heartbeat is stale. Nothing is
 *   shown, as before modes.
 */
export type Liveness = 'live' | 'silent' | 'none' | 'outside' | 'unknown'

/**
 * The table above. `entry` is the repository's `/api/engine-health` entry:
 * null when no heartbeat has been written, undefined when the server could
 * not look (a driver that cannot see a local engine), which reads as absent.
 */
export function livenessOf(mode: RepositoryMode | null | undefined, entry: EngineHealthEntry | null | undefined): Liveness {
  const heartbeat = !entry ? 'absent' : entry.stale ? 'stale' : 'fresh'
  if (mode === 'dispatch') return heartbeat === 'fresh' ? 'live' : 'silent'
  if (mode === 'view' || mode === 'decide') return heartbeat === 'fresh' ? 'outside' : 'none'
  return heartbeat === 'stale' ? 'silent' : 'unknown'
}

/**
 * The drift between the running code and the code checkout (#141), shown
 * once (§9.5). Every engine writes it into its own repository's heartbeat,
 * but it describes the one code checkout the process runs from, so several
 * heartbeats reporting it are one fact, not several.
 *
 * The rule: drift is shown when any heartbeat reports it — a pause of the
 * code-tree monitor, or a loaded commit that differs from the checkout's
 * head — and the heartbeat written most recently among those speaks for it:
 * its commits, its pause and its reason. Newest, because the checkout only
 * moves forward and a later heartbeat has seen more of it. Ties go to the
 * first in the response's order, which is the order the repositories are
 * served in. Null when no heartbeat reports drift.
 */
export function driftOf(engines: EngineHealthResponse['engines']): EngineHealthEntry | null {
  let newest: EngineHealthEntry | null = null
  for (const entry of Object.values(engines)) {
    if (!entry || !drifted(entry)) continue
    if (newest === null || Date.parse(entry.at) > Date.parse(newest.at)) newest = entry
  }
  return newest
}

/** Whether one heartbeat reports drift: paused, or running a commit the checkout has moved past. */
export function drifted(entry: EngineHealthEntry): boolean {
  return entry.codeState === 'paused' || (entry.commit !== undefined && entry.codeHead !== undefined && entry.commit !== entry.codeHead)
}

/**
 * The words for which governor limit held a dispatch back (#513), in the
 * cockpit's voice. A limit this table does not know — a newer engine's — has
 * no words here, and the mark names it by its token as written.
 */
export const DEFERRAL_LIMIT_WORDS: Readonly<Record<string, string>> = {
  concurrency: 'the concurrency cap',
  turn: 'another repository’s turn for a slot',
  spend: 'the machine’s spend window',
  'repository-spend': 'the repository’s own spend ceiling',
}
